# AGENTS.md — AI GTM Engine (HackBay hackathon)

Guide for any coding agent (Codex, Claude Code, …) continuing this project. Read this first, then the Linear issue for the chunk you work on.

## What we are building
A web app that turns a plain-language product description into approved, tracked outreach to real buyers, with every claim backed by a source link. Spec: hackathon doc "AI GTM Engine – Product & Technical Requirements". Judging: ICP & discovery 20%, enrichment & outreach 20%, dashboard 15%, viability 15%, tech & demo 10%, **Band +20%**, **Flexprice +20%**. Moss is a sponsor too (semantic search).

- Live app: https://ai-gtm-engine-ten.vercel.app (Vercel auto-deploys `main`; every PR gets a preview)
- Repo: https://github.com/fridaytaev001/ai-gtm-engine (private until submission)
- Plan: Linear project "AI GTM Engine", team ALI, issues ALI-19…ALI-30 = chunks 1–12
- Design doc: https://claude.ai/artifact/VpKqtbA33hAW3fvHDq6VJz (note: it still says Claude is the model — it is now Meta Muse, see below)

## Status (2026-11-24)
| Chunk | Linear | State |
| --- | --- | --- |
| 1 Setup (monorepo, CI, Vercel) | ALI-19 | ✅ merged (#1) |
| 2 Data layer (Postgres + Neo4j + seed) | ALI-20 | ✅ merged (#2) |
| 3 Intake + ICP engine + expansion | ALI-21 | ✅ merged (#3) |
| 4 Discovery with verified citations + competitor map | ALI-22 | 🟡 PR #4 open, CI green, **awaiting the user's OK to merge** |
| 6 Flexprice metering + credit gate | ALI-24 | 🟡 draft PR #5 (stacked on #4); local provisioning, 0.5-credit debit, idempotent retry and insufficient-credit gate verified. Webhook, enrichment integration and dashboard remain pending. |
| 5 Graph reasoning UI, 7 Enrichment, 8 Outreach + HITL, 9 Dashboard, 10 Band agents, 11 Demo polish, 12 Moss | ALI-23, 25–30 | ⬜ not started |

Suggested order (judged items first): finish 6 → 7+8 together (enrichment uses the credit gate; outreach needs the approval gate) → 9 dashboard → 10 Band → 5 graph UI → 12 Moss → 11 polish.

## Stack and layout
pnpm workspace (Node 24+, pnpm 12), TypeScript everywhere.
```
apps/web        Next.js 16 (App Router, Cache Components on), Tailwind 4. Pages: /intake, /icp, /icp/[id], /icp/[id]/leads, /billing
apps/worker     Node service (tsx) — will host the Band agents; currently only /health
packages/core   env schema (zod) + shared constants
packages/db     Drizzle schema + migrations (Neon Postgres), Neo4j client/ontology/queries, seed
packages/ai     model provider layer (Muse / Claude), intake, ICP, expansion, discovery, competitors, quote verification
packages/billing Flexprice: metered features, wallet, gate, charge, top-up
```
- **Next.js 16 is newer than most training data.** Read `apps/web/node_modules/next/dist/docs/` before using an API. DB-reading server components need `await connection()` inside a `<Suspense>`; pages whose server actions call models set `export const maxDuration = 300`.
- Workspace packages ship TS source; new ones must be added to `transpilePackages` in `apps/web/next.config.ts`.

## Model provider — Meta Muse, not Claude
The user has **no Anthropic API credits**. `packages/ai/src/provider.ts` routes every call:
- `MODEL_API_KEY` set → **Meta Model API** (`https://api.meta.ai/v1`, OpenAI SDK, Responses protocol), model `muse-spark-1.3` (`MUSE_MODEL` overrides), JSON-schema output via `text.format`, built-in `web_search` tool (`include: ["web_search_call.results"]` returns URLs + snippets).
- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` → Claude path (kept, unused).
Use `generateStructured()` and `researchWithWebSearch()`; don't call SDKs directly from features.

## Non-negotiable rules
1. **No citation, no fact.** Evidence URLs must be ones the search tool actually returned; quotes must be found on the page or its search snippet (`packages/ai/src/verify.ts`). Unverified → dropped.
2. **Human approval gate is backend-enforced** (chunk 8): nothing is sent unless an `approvals` row with `approved`/`edited` exists. Never send real emails to real prospects in demos — only to the user's own test inbox.
3. **Secrets:** never print, log, commit or paste secrets. `.env` is git-ignored; so are `Neo4j-*.txt` / `*credentials*.txt` (the user downloads credential files into the repo folder — check `git status` before every commit). Copy secrets into `.env` by script without echoing values. Agents must not type API keys into web forms — the user pastes them.
4. **Billing:** costly actions call `gate(metric)` before and `bill(metric, stableEventId)` after (`apps/web/src/lib/billing.ts`).
5. **Every user/agent action writes an `events` row** (audit log; actor_type agent/rep/system).
6. **Workflow:** one branch + PR per chunk, branch name from the Linear issue's `gitBranchName`; PR body links the Linear issue; update the Linear checklist/state; **merge only when the user explicitly OKs that PR**. Commit messages end with a co-author line for the agent.
7. **Lean mode** (user's choice): one quick check per chunk (typecheck, build, one cheap live call), short reports, no long browser click-throughs.

## Environment
Keys live in Vercel project `friday-taev/ai-gtm-engine` and locally in root `.env` (template: `.env.example`).
- Pull Development values: `npx vercel env pull <tmpfile> --environment=development`, then copy needed keys into `.env` by script. **Secret-type Vercel vars can't be pulled**; each key exists as Secret (Production) + Config (Development/Preview).
- Set: `DATABASE_URL` (Neon via Vercel integration), `NEO4J_URI/USERNAME/PASSWORD/DATABASE` (Aura Free instance `47b99ee9`; `NEO4J_DATABASE` is not `neo4j`), `MODEL_API_KEY` (Muse).
- `FLEXPRICE_API_KEY` is configured locally and verified against the US endpoint (`https://us.api.flexprice.io/v1`); Vercel still needs configuration.
- Missing: enrichment keys (Apollo/Hunter/Prospeo), Gmail OAuth, Band agent keys, Moss keys.
- Production Vercel env does **not** have `NEO4J_*` yet (add when the web app starts querying the graph).
- Local tools on the user's Windows machine: Node at `%LOCALAPPDATA%\Programs\nodejs`, gh at `%LOCALAPPDATA%\Programs\gh\bin` (may need adding to PATH in old shells), Vercel CLI via `npx vercel` (logged in, project linked).

## Commands
```
pnpm install
pnpm dev | dev:web | dev:worker
pnpm lint && pnpm typecheck && pnpm build      # CI runs exactly these
pnpm db:generate   # after editing packages/db/src/schema
pnpm db:migrate    # applies to the shared Neon DB (dev and prod share it)
pnpm graph:setup && pnpm db:seed && pnpm db:check
pnpm billing:setup # Flexprice features + wallet + debit self-test
cd packages/ai && npx tsx --env-file=../../.env scripts/try-icp.ts [--expand]
cd packages/ai && npx tsx --env-file=../../.env scripts/try-discovery.ts [--competitors]
```

## Known gotchas
- Vercel functions stop at 300 s: discovery researches 3 angles in parallel and saves in parallel to fit. Keep long AI work parallel or move it to the worker.
- Neo4j: pass integers with `neo4j.int()` (LIMIT etc.).
- Postgres client uses `prepare: false` (pooler).
- Seed data is clearly fictional (`*.example` domains) — keep it that way.
- Flexprice wallet debits use `POST /wallets/{id}/debit`, with `credits` and `transaction_reason: "MANUAL_BALANCE_DEBIT"`. SDK 2.1.51 does not expose it, so the billing package calls the documented endpoint directly. Top-up rejects debit reasons. `billing:setup` verifies the balance drops, retries do not double-debit, and the credit gate blocks unaffordable actions.
- Single-workspace mode: `ensureWorkspace()` (org `…0010`, user `…0011`); all tables are org-scoped for later auth.
