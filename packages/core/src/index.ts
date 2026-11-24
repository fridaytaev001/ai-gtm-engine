export * from "./env";

export const APP_NAME = "AI GTM Engine";

/** Lead lifecycle stages, in order (Module 5). */
export const LEAD_STAGES = ["matched", "contacted", "replied", "meeting_booked", "closed_lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Who performed an action, for attribution and the audit log. */
export type ActorType = "agent" | "rep" | "system";
