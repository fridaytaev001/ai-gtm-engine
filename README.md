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
  db/        Postgres schema (Drizzle), Neo4j graph client, ontology and seed scripts
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
| `pnpm db:migrate` | Apply Postgres migrations (needs `DATABASE_URL`) |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema` |
| `pnpm graph:setup` | Create Neo4j constraints and indexes (needs `NEO4J_*`) |
| `pnpm db:seed` | Load the fictional LogLens demo data into both databases |
| `pnpm db:check` | Check connectivity to both databases |

Health checks: `GET /api/health` (web) and `GET /health` (worker) report which integrations have keys configured (booleans only).

## Flexprice billing

Set a US-region Sandbox secret API key in `FLEXPRICE_API_KEY` in the root `.env`, then run `pnpm billing:setup`. This provisions the usage meters and wallet and checks a 0.5-credit debit, idempotent retry, and the insufficient-credit gate. The key stays on the server.

To enable wallet notifications:

1. Configure `FLEXPRICE_API_KEY` in the Vercel environment used by the preview. Open the preview once so the workspace wallet is linked in Postgres.
2. In Flexprice's webhook endpoint settings, register `https://<preview-host>/api/webhooks/flexprice`. The endpoint must be publicly reachable by Flexprice (Vercel deployment protection must permit webhook delivery).
3. Subscribe to `wallet.credit_balance.dropped` and `wallet.credit_balance.recovered`. Wallet update/transaction and ongoing-balance notifications are also supported.
4. Copy the endpoint's Svix signing secret into `FLEXPRICE_WEBHOOK_SECRET` in the matching Vercel environment, then redeploy the preview. This is a separate secret from the API key.

The handler verifies the raw body and timestamp, matches the saved workspace wallet, and inserts one audit event per Svix message ID. Unknown event types and unrelated wallets are acknowledged without changes; invalid signatures return 400 and database failures return 503 for retry. Open tabs check a database revision every 10 seconds while visible, then refresh the authoritative Flexprice balance only when it changes. Late or duplicate notifications never overwrite the balance.

Run `pnpm --filter @gtm/billing test` for signature, tampering, stale-message and replay-ID tests. See the [Flexprice webhook documentation](https://github.com/flexprice/javascript-sdk#handling-webhooks) and [Svix verification guide](https://docs.svix.com/receiving/verifying-payloads/how).

## Contact enrichment

Add `HUNTER_API_KEY` or `PROSPEO_API_KEY` alongside `FLEXPRICE_API_KEY`. Add `APOLLO_API_KEY` for LinkedIn matching. Open an approved ICP's Accounts page and select **Verify contact** beside a sourced person on a real account. [Apollo](https://docs.apollo.io/reference/people-api-search) looks up a LinkedIn profile, [Hunter](https://hunter.io/api-documentation/v2) looks up and verifies the work email, and [Prospeo](https://prospeo.io/api-docs/enrich-person) can provide a fallback. The app verifies company-domain MX records before marking a Prospeo email valid. Results are cached for seven days. A verified lead costs five credits once per lead, with a balance check before each provider request.

## Outreach review

Open **Review** and draft a sequence for a lead with verified evidence. Muse chooses a quote and calls to action. The app assembles two first-email variants, a LinkedIn note, and a follow-up from those choices. Review each touch separately. Editing offers calls to action that preserve the verified claim. The server checks the latest approval and locks each step before dispatch.

For a Gmail test, [enable Gmail API and set up OAuth](https://developers.google.com/workspace/gmail/api/auth/scopes) for a test account with the `gmail.send` and `gmail.metadata` scopes. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, and `GMAIL_TEST_RECIPIENT`. Use an inbox you own as the test recipient. After approving and sending the first email, reply from that inbox and choose **Check for reply** to update the lead stage. LinkedIn notes are copied and marked as sent by the rep. If a send's outcome is uncertain, inspect the test inbox before taking another action.

## Band review

Register Planner, Builder, Security and Reviewer agents in [Band](https://app.band.ai). Set each agent ID and API key, plus the designated human's `BAND_APPROVER_ID`, in the worker and web environments. Run the worker continuously with `pnpm --filter @gtm/worker start` against the same Postgres database as the web app. Choose **Review in Band** on a draft. The worker creates a room, hands off a draft reference and verified source, and asks the designated human for a decision after the security check. Open **Agents** for the corresponding activity. The room decision updates the app's approval record, and sending is a separate action. These review stages are deterministic and use no model tokens.

## CI

Every pull request runs lint, typecheck and build.

## Design

The full system design (architecture, data model, graph ontology, agent roles, billing and search design) lives in `docs/DESIGN.md` (added in the final chunk).
