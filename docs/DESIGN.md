# AI GTM Engine design

The app takes a plain-language product description through targeting, sourced discovery, and review of outreach. The pipeline records changes and the actor responsible.

## Runtime and data flow

- Next.js on Vercel renders intake, ICPs, accounts, review, pipeline, billing, and agent activity. Server actions validate inputs and scope reads and writes to the workspace.
- Meta Muse provides structured ICP inference, expansion, web research, and bounded outreach choices. Postgres stores products, ICP versions, companies, people, signals, verified evidence, leads, approvals, events, and billing.
- The worker runs the daily score refresh and hosts the four Band SDK agents. It shares the web app's Postgres database.

## Discovery and verification

Discovery researches three angles concurrently. Each candidate requires a signal whose source URL came from search and whose quote is present on the page or search snippet. Verified negative signals explain filtered accounts. Product competitors are grouped as direct, indirect, or alternative with cited positioning and public prices when available.

The account score combines fit (60%) and intent (40%). Verified signals add intent, with lower weights after 30 and 120 days. A composite score of 75 or more is A, 50 to 74 is B, and below 50 is C. The daily job recalculates Tier A scores against stored signals.

## Neo4j evidence chains

Company, Person, Product, Competitor, and Signal nodes use Postgres UUIDs. School nodes can provide shared history. Verified discovery writes company matches, employment and signal edges. Reference data can supply customer, shared employer, school, and competitor use edges.

- A warm introduction starts at a matched person, follows a sourced past employer or school in common, and finds a connector at a reference customer.
- A buying cycle follows a company to a job-post signal observed in the past 30 days.
- Competitor displacement follows documented competitor use and a renewal or replacement signal.

The graph panel scopes queries to the active product and links each displayed path to evidence.

## Enrichment, outreach and billing

Apollo resolves LinkedIn profiles, Hunter finds and verifies company email, and Prospeo plus MX checks provide fallback. Verified leads enter the pipeline. Flexprice checks run before provider calls and successful enrichment bills against a stable event ID. Results are cached for seven days.

Drafts use a quote selected from verified evidence and two first-touch variants. Editing selects a call to action from a constrained list. Dispatch locks the lead and message, checks the latest approval and source, and claims the touch before calling Gmail. The destination is a configured test inbox. LinkedIn sends are manual. Reply sync reads thread metadata and updates the stage with an audit event.

Flexprice meters enrichment, outreach, and graph evaluations. Wallet debits and usage ledger rows use stable IDs. Svix verifies wallet notifications. The app reloads the balance from Flexprice after a change.

## Agent review and retrieval

Band creates a room for a draft review. The Planner requests evidence, the Builder loads the citation, the Security agent validates outbound links, and the Reviewer requests a decision from the designated human. Draft text and recipient details stay in the app. Band uses the same approval table as the web review.

Moss stores workspace-scoped verified entities and signals plus approved ICP text. Each hit is rechecked against Postgres. The dashboard blends keyword and semantic retrieval and links to the account and source. Discovery checks existing sources before requesting additional search results.
