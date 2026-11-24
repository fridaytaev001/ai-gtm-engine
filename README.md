# AI GTM Engine

Turns a plain-language product description into approved, tracked outreach to real buyers, with every claim backed by a source link.

**Status:** design phase. See `docs/DESIGN.md` (coming soon) for the system design.

## Planned stack
- Next.js + Tailwind + Radix UI (web app)
- Node agent worker with Band multi-agent orchestration
- Postgres (app state, audit log) + Neo4j (knowledge graph)
- Claude for reasoning and copy, Tavily for discovery
- Apollo / Hunter / Prospeo enrichment, Gmail API sending
- Flexprice usage-based billing and credit gating
- Snyk SAST + SCA in GitHub Actions
