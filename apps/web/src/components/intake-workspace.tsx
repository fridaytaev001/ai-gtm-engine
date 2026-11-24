"use client";

import { useRef, useState, useTransition } from "react";
import type { ChatTurn, ProductDraft } from "@gtm/ai";
import { createProductAndIcp, sendIntakeMessage } from "@/app/actions";
import { Button, Card, cx, ErrorNote } from "./ui";

const OPENER: ChatTurn = {
  role: "assistant",
  content: "Tell me about your product in a sentence or two: what it does and who it's for. You can also fill in the form on the right.",
};

const emptyDraft = (): ProductDraft => ({
  name: "",
  description: "",
  features: [],
  referenceCustomers: [],
  pricing: { model: "", annualContractValueUsd: null, notes: "" },
});

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  features: "Features",
  referenceCustomers: "Customers",
  pricing: "Pricing",
};

export function IntakeWorkspace() {
  const [chat, setChat] = useState<ChatTurn[]>([OPENER]);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [missing, setMissing] = useState<string[]>(["name", "description", "features", "referenceCustomers", "pricing"]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chatPending, startChat] = useTransition();
  const [generating, startGenerate] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  function send() {
    const text = input.trim();
    if (!text || chatPending) return;
    const next = [...chat, { role: "user" as const, content: text }];
    setChat(next);
    setInput("");
    setError(null);
    startChat(async () => {
      // The opener is UI-only; the model sees the conversation from the founder's first message.
      const res = await sendIntakeMessage(next.slice(1), draft);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(res.data.draft);
      setMissing(res.data.missing);
      setReady(res.data.ready);
      setChat((c) => [...c, { role: "assistant", content: res.data.reply }]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    });
  }

  function generate() {
    setError(null);
    startGenerate(async () => {
      const res = await createProductAndIcp(draft);
      if (res && !res.ok) setError(res.error);
    });
  }

  const canGenerate = draft.name.trim() !== "" && draft.description.trim() !== "";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <Card title="Chat" aside={<span className="text-xs text-zinc-500">Claude asks what&apos;s missing</span>}>
        <div className="flex h-[28rem] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            {chat.map((m, i) => (
              <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <p
                  className={cx(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6",
                    m.role === "user" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-900",
                  )}
                >
                  {m.content}
                </p>
              </div>
            ))}
            {chatPending && <p className="text-sm text-zinc-500">Thinking…</p>}
            <div ref={endRef} />
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="e.g. LogLens is AI log analysis that finds the root cause of incidents for SaaS teams…"
              className="flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Button type="submit" variant="primary" disabled={chatPending || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Card>

      <div className="space-y-4">
        <Card
          title="Product record"
          aside={
            <div className="flex flex-wrap gap-1">
              {Object.keys(FIELD_LABELS).map((f) => (
                <span
                  key={f}
                  className={cx(
                    "rounded px-1.5 py-0.5 text-xs",
                    missing.includes(f)
                      ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"
                      : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                  )}
                >
                  {missing.includes(f) ? "○" : "●"} {FIELD_LABELS[f]}
                </span>
              ))}
            </div>
          }
        >
          <ProductForm draft={draft} onChange={setDraft} />
        </Card>
        <ErrorNote message={error} />
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {ready ? "Enough detail to infer your ICP." : "Answer a few questions, or fill the form, then generate."}
          </p>
          <Button variant="primary" onClick={generate} disabled={!canGenerate || generating || chatPending}>
            {generating ? "Inferring ICP…" : "Generate ICP"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";

function ProductForm({ draft, onChange }: { draft: ProductDraft; onChange: (d: ProductDraft) => void }) {
  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) => onChange({ ...draft, [k]: v });
  return (
    <div className="grid gap-3 text-sm">
      <Field label="Product name">
        <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="What it does, for whom">
        <textarea className={inputCls} rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Features (one per line)">
        <textarea
          className={inputCls}
          rows={3}
          value={draft.features.join("\n")}
          onChange={(e) => set("features", e.target.value.split("\n"))}
        />
      </Field>
      <Field label="Customers (name, domain — one per line)">
        <textarea
          className={inputCls}
          rows={2}
          value={draft.referenceCustomers.map((c) => [c.name, c.domain].filter(Boolean).join(", ")).join("\n")}
          onChange={(e) =>
            set(
              "referenceCustomers",
              e.target.value.split("\n").map((line) => {
                const [name = "", domain = ""] = line.split(",").map((s) => s.trim());
                return { name, domain };
              }),
            )
          }
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pricing model">
          <input className={inputCls} value={draft.pricing.model} onChange={(e) => set("pricing", { ...draft.pricing, model: e.target.value })} />
        </Field>
        <Field label="Typical contract (USD / year)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={draft.pricing.annualContractValueUsd ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
              set("pricing", { ...draft.pricing, annualContractValueUsd: e.target.value.trim() && Number.isFinite(n) ? n : null });
            }}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
