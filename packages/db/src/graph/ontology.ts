/**
 * Knowledge-graph ontology (design doc → Data model).
 * Node ids are the same UUIDs as the matching Postgres rows, so the two stores join on id.
 * Every node and relationship carries `sourceUrl` and `observedAt` so graph answers stay citable.
 */
export const NODE_LABELS = ["Company", "Person", "Product", "Competitor", "Signal", "School"] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const REL_TYPES = [
  // From the hackathon spec
  "WORKS_AT", // Person -> Company
  "PREVIOUSLY_EMPLOYED_AT", // Person -> Company
  "COMPETES_WITH", // Competitor -> Product
  "MATCHED_TO", // Company|Person -> Product (ICP match)
  "CONTACTED_VIA", // Person -> Product (outreach sent; props: channel, messageId)
  "REPLIED_TO", // Person -> Product (reply received; props: messageId)
  // Added in the design doc
  "HAS_SIGNAL", // Company -> Signal
  "USES", // Company -> Competitor
  "STUDIED_AT", // Person -> School
  "CUSTOMER_OF", // Company -> Product (our user's existing customers)
] as const;
export type RelType = (typeof REL_TYPES)[number];

/** Allowed (from, to) label pairs per relationship, enforced by `upsertRel`. */
export const REL_ENDPOINTS: Record<RelType, readonly [NodeLabel[], NodeLabel[]]> = {
  WORKS_AT: [["Person"], ["Company"]],
  PREVIOUSLY_EMPLOYED_AT: [["Person"], ["Company"]],
  COMPETES_WITH: [["Competitor"], ["Product"]],
  MATCHED_TO: [["Company", "Person"], ["Product"]],
  CONTACTED_VIA: [["Person"], ["Product"]],
  REPLIED_TO: [["Person"], ["Product"]],
  HAS_SIGNAL: [["Company"], ["Signal"]],
  USES: [["Company"], ["Competitor"]],
  STUDIED_AT: [["Person"], ["School"]],
  CUSTOMER_OF: [["Company"], ["Product"]],
};

export type Provenance = { sourceUrl?: string | null; observedAt?: string | null };
