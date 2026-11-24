export * from "./env";

export const APP_NAME = "AI GTM Engine";

/** Lead lifecycle stages, in order (Module 5). */
export const LEAD_STAGES = ["matched", "contacted", "replied", "meeting_booked", "closed_lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Who performed an action, for attribution and the audit log. */
export type ActorType = "agent" | "rep" | "system";

export function scoreSignals(fit: number, signals: { type: string; observedAt: string | Date }[], now = Date.now()) {
  let intent = 30;
  for (const signal of signals) {
    const weight = ["job_post", "funding", "exec_hire"].includes(signal.type) ? 20 : 12;
    const observed = new Date(signal.observedAt).getTime();
    const days = Number.isFinite(observed) ? (now - observed) / 86_400_000 : 120;
    intent += days <= 30 ? weight : days <= 120 ? weight * 0.6 : weight * 0.3;
  }
  intent = Math.round(Math.min(100, intent));
  const composite = Math.round(fit * 0.6 + intent * 0.4);
  const tier: "A" | "B" | "C" = composite >= 75 ? "A" : composite >= 50 ? "B" : "C";
  return { fit, intent, composite, tier };
}
