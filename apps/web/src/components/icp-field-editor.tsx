"use client";

import { useState, useTransition, type ReactNode } from "react";
import { editIcpField } from "@/app/actions";
import { Button, ErrorNote } from "./ui";

type Field = "industries" | "sizeBands" | "personas" | "triggers" | "regions" | "negativeSignals";

/**
 * Shows a field and lets the founder edit it as plain lines.
 * Saving creates a new ICP version with that field's confidence set to 1.00 (founder-confirmed).
 */
export function EditableField({ icpId, field, value, children }: { icpId: string; field: Field; value: unknown; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => toText(field, value));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="group relative">
        {children}
        <button
          onClick={() => setEditing(true)}
          className="mt-3 text-xs font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          Adjust
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        let parsed: unknown;
        try {
          parsed = fromText(field, text);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not read that.");
          return;
        }
        start(async () => {
          const res = await editIcpField(icpId, { field, value: parsed } as Parameters<typeof editIcpField>[1]);
          if (res && !res.ok) setError(res.error);
        });
      }}
    >
      <label className="block text-xs text-zinc-500" htmlFor={`edit-${field}`}>
        {HINTS[field]}
      </label>
      <textarea
        id={`edit-${field}`}
        rows={Math.max(3, text.split("\n").length + 1)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save as new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const HINTS: Record<Field, string> = {
  industries: "One per line: NAICS code | label",
  sizeBands: "headcount min | headcount max | revenue min USD | revenue max USD (leave blank for none)",
  personas: "One per line: title | seniority | function | role",
  triggers: "One per line: type | description (types: job_post, funding, exec_hire, tech_change, news, other)",
  regions: "One region per line",
  negativeSignals: "One signal per line",
};

const cells = (line: string) => line.split("|").map((s) => s.trim());
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const optNum = (s?: string) => {
  if (!s) return undefined;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return n;
};

type Rec = Record<string, unknown>;

function toText(field: Field, value: unknown): string {
  switch (field) {
    case "industries":
      return (value as Rec[]).map((i) => `${i.naics} | ${i.label}`).join("\n");
    case "sizeBands": {
      const v = value as Rec;
      return [v.headcountMin, v.headcountMax, v.revenueMinUsd, v.revenueMaxUsd].map((x) => x ?? "").join(" | ");
    }
    case "personas":
      return (value as Rec[]).map((p) => [p.title, p.seniority, p.function ?? "", p.role ?? ""].join(" | ")).join("\n");
    case "triggers":
      return (value as Rec[]).map((t) => `${t.type} | ${t.description}`).join("\n");
    default:
      return (value as string[]).join("\n");
  }
}

function fromText(field: Field, text: string): unknown {
  switch (field) {
    case "industries":
      return lines(text).map((l) => {
        const [naics = "", label = ""] = cells(l);
        if (!naics || !label) throw new Error(`Use "code | label": ${l}`);
        return { naics, label };
      });
    case "sizeBands": {
      const [a, b, c, d] = cells(text);
      return { headcountMin: optNum(a), headcountMax: optNum(b), revenueMinUsd: optNum(c), revenueMaxUsd: optNum(d) };
    }
    case "personas":
      return lines(text).map((l) => {
        const [title = "", seniority = "", fn, role] = cells(l);
        if (!title) throw new Error(`Missing title: ${l}`);
        return { title, seniority, function: fn || undefined, role: role || undefined };
      });
    case "triggers":
      return lines(text).map((l) => {
        const [type = "other", description = ""] = cells(l);
        if (!description) throw new Error(`Use "type | description": ${l}`);
        return { type, description };
      });
    default:
      return lines(text);
  }
}
