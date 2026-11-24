import { Agent, GenericAdapter } from "@band-ai/sdk";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getEnv, integrationStatus } from "@gtm/core";
import { ensureWorkspace, getDb, schema } from "@gtm/db";

const roles = ["planner", "builder", "security", "reviewer"] as const;
type Role = typeof roles[number];
const { agentRuns, approvals, events, evidence, leads, messages } = schema;
const uuid = z.uuid();

function safeSource(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) && !/\.(local|localhost|internal)$/i.test(url.hostname);
  } catch { return false; }
}

export async function startBand() {
  const env = getEnv();
  if (!integrationStatus(env).band || !env.DATABASE_URL) return null;
  const { orgId, userId } = await ensureWorkspace();
  const db = getDb();
  const config = {
    planner: { agentId: env.BAND_PLANNER_AGENT_ID!, apiKey: env.BAND_PLANNER_API_KEY! },
    builder: { agentId: env.BAND_BUILDER_AGENT_ID!, apiKey: env.BAND_BUILDER_API_KEY! },
    security: { agentId: env.BAND_SECURITY_AGENT_ID!, apiKey: env.BAND_SECURITY_API_KEY! },
    reviewer: { agentId: env.BAND_REVIEWER_AGENT_ID!, apiKey: env.BAND_REVIEWER_API_KEY! },
  };
  const agents = {} as Record<Role, Agent>;
  const approverId = env.BAND_APPROVER_ID!;
  const audit = (role: Role, type: string, payload: Record<string, unknown>) => db.insert(events)
    .values({ orgId, type: `band.${type}`, actorType: "agent", actorId: role, payload });

  for (const role of roles) agents[role] = Agent.create({
    ...config[role], restUrl: env.BAND_API_URL, wsUrl: env.BAND_WS_URL,
    adapter: new GenericAdapter(async ({ message, roomId, tools }) => {
      const command = message.content.match(/\/(approve|reject)\s+([\da-f-]{36})\s*$/i);
      const id = uuid.safeParse(command?.[2]);
      if (role !== "reviewer" || message.senderId !== approverId || message.senderType.toLowerCase() === "agent" || !id.success) {
        tools.turn.settle();
        return;
      }
      const [attestation] = await db.select().from(agentRuns).where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.bandRoomId, roomId),
        eq(agentRuns.agent, "security"), eq(agentRuns.task, `review:${id.data}`), eq(agentRuns.status, "succeeded"))).limit(1);
      if (!attestation) {
        await tools.sendMessage("No completed security check was found for this draft in this room.", [{ id: approverId }]);
        return;
      }
      const decision = command?.[1]?.toLowerCase() === "approve" ? "approved" : "rejected";
      const changed = await db.transaction(async (tx) => {
        const [row] = await tx.select({ draft: messages }).from(messages).innerJoin(leads, eq(messages.leadId, leads.id))
          .where(and(eq(messages.id, id.data), eq(leads.orgId, orgId))).for("update", { of: messages });
        // Any edit since the security check invalidates the in-room approval.
        if (!row || row.draft.status !== "draft" || row.draft.updatedAt > attestation.startedAt) return false;
        const at = new Date();
        await tx.update(messages).set({ status: decision, approvedBy: decision === "approved" ? userId : null,
          approvedAt: decision === "approved" ? at : null, updatedAt: at }).where(eq(messages.id, id.data));
        await tx.insert(approvals).values({ orgId, kind: "message_send", subjectId: id.data, decidedBy: userId, decision, source: "band", decidedAt: at });
        await tx.insert(events).values({ orgId, leadId: row.draft.leadId, type: `outreach.${decision}`, actorType: "rep", actorId: userId,
          payload: { messageId: id.data, roomId, source: "band" } });
        return true;
      });
      await tools.sendMessage(changed ? "Decision saved to the app’s review queue." : "Draft changed or was already reviewed.", [{ id: approverId }]);
    }),
  });
  await Promise.all(roles.map((role) => agents[role].start())).catch(async (error) => {
    await Promise.allSettled(roles.map((role) => agents[role].stop()));
    throw error;
  });

  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    let activeRun: string | undefined;
    try {
      const [job] = await db.select().from(agentRuns).where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.agent, "planner"),
        eq(agentRuns.status, "running"), isNull(agentRuns.bandRoomId))).orderBy(desc(agentRuns.startedAt)).limit(1);
      if (!job) return;
      const [claimed] = await db.update(agentRuns).set({ bandRoomId: "" }).where(and(eq(agentRuns.id, job.id), isNull(agentRuns.bandRoomId)))
        .returning({ id: agentRuns.id });
      if (!claimed) return;
      activeRun = job.id;
      const messageId = uuid.parse(job.task.replace(/^review:/, ""));
      const rest = agents.planner.runtime.link.rest;
      const room = await rest.createChat({ title: `HackBay review · ${job.id.slice(0, 8)}` });
      await db.update(agentRuns).set({ bandRoomId: room.id }).where(eq(agentRuns.id, job.id));
      for (const participantId of [config.builder.agentId, config.security.agentId, config.reviewer.agentId, approverId]) {
        const result = await rest.addChatParticipant(room.id, { participantId, role: "member" });
        if (result.ok === false) throw new Error("Band participant setup failed");
      }
      const scope = { runId: job.id, messageId, roomId: room.id };
      async function report(role: Role, type: string, summary: string, next: string, source?: string) {
        const api = agents[role].runtime.link.rest;
        const metadata = { ...scope, ...(source ? { sourceUrls: [source] } : {}), blocking: type === "attention" };
        await audit(role, type, { ...metadata, text: summary });
        await api.createChatEvent(room.id, { content: summary, messageType: type === "attention" ? "task" : type, metadata });
        const result = await api.createChatMessage(room.id, { content: summary, mentions: [{ id: next }], metadata });
        if (result.ok === false) throw new Error("Band message failed");
      }
      const finish = (id: string) => db.update(agentRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(agentRuns.id, id));
      const stage = async (role: Role) => (await db.insert(agentRuns).values({ orgId, agent: role, bandRoomId: room.id, task: job.task })
        .returning({ id: agentRuns.id }))[0]!.id;
      await report("planner", "task", "Review this draft’s evidence.", config.builder.agentId);
      await finish(job.id);
      activeRun = await stage("builder");
      const [row] = await db.select({ draft: messages }).from(messages).innerJoin(leads, eq(leads.id, messages.leadId))
        .where(and(eq(messages.id, messageId), eq(leads.orgId, orgId), eq(messages.status, "draft")));
      if (!row) throw new Error("Draft is no longer available");
      const citation = uuid.safeParse(row.draft.reviewerNotes?.replace(/^Cited evidence: /, ""));
      const [record] = citation.success ? await db.select().from(evidence).where(and(eq(evidence.id, citation.data), eq(evidence.orgId, orgId), eq(evidence.verified, true))) : [];
      await report("builder", "tool_call", "Loaded the draft and citation from Postgres.", config.security.agentId,
        record && safeSource(record.sourceUrl) ? record.sourceUrl : undefined);
      await finish(activeRun);
      activeRun = await stage("security");
      const links = row.draft.body.match(/https?:\/\/[^\s]+/gi) ?? [];
      const safe = row.draft.step === 1
        ? record && safeSource(record.sourceUrl) && links.length === 1 && links[0] === record.sourceUrl
        : row.draft.reviewerNotes === "No factual claims" && !links.length;
      if (!safe) throw new Error("Draft failed source validation");
      await report("security", "thought", "Source validation passed. The draft and recipient information stay in the app.", config.reviewer.agentId, record?.sourceUrl);
      await finish(activeRun);
      activeRun = await stage("reviewer");
      await report("reviewer", "attention", `Review draft ${messageId} in the app. Reply /approve ${messageId} or /reject ${messageId} here.`, approverId);
      await finish(activeRun);
    } catch {
      if (activeRun) await db.update(agentRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(agentRuns.id, activeRun));
      await audit("planner", "error", { runId: activeRun, text: "The Band review stopped before completion." });
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void poll().catch(() => console.error("[band] Could not poll queued reviews")); }, 5000);
  return async () => { clearInterval(timer); await Promise.allSettled(roles.map((role) => agents[role].stop())); };
}
