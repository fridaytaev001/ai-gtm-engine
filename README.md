# AI GTM Engine

Turns a plain-language product description into approved, tracked outreach to real buyers, with every claim backed by a source link.

Built for the HackBay hackathon with **Band** (multi-agent orchestration), **Flexprice** (usage-based billing) and **Moss** (real-time semantic search).

## Repository layout

```
apps/
  web/       Next.js app: intake, leads grid, review queue, Kanban, dashboard
  worker/    Node service: pipelines and the Band agents (Planner, Builder, Reviewer, Security)
packages/
  core/      Shared types, constants and environment validation
```

## Getting started

Requirements: Node.js 24+ (see `.nvmrc`) and pnpm.

```bash
pnpm install
cp .env.example .env          # fill in keys as each feature needs them
pnpm dev                      # web on http://localhost:3000, worker on http://localhost:8787
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `pnpm dev:web` | Run only the web app |
| `pnpm dev:worker` | Run only the worker |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm build` | Production build |

Health checks: `GET /api/health` (web) and `GET /health` (worker) report which integrations have keys configured (booleans only).

## CI

Every pull request runs lint, typecheck and build.

## Design

The full system design (architecture, data model, graph ontology, agent roles, billing and search design) lives in `docs/DESIGN.md` (added in the final chunk).
