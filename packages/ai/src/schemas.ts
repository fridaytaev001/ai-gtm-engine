import { z } from "zod";

/** What the founder tells us about their product (Module 1 intake). */
export const ProductDraftSchema = z.object({
  name: z.string().describe("Product name, or empty string if not given yet"),
  description: z.string().describe("One or two sentences: what it does and for whom"),
  features: z.array(z.string()).describe("Core features, capabilities and technical constraints"),
  referenceCustomers: z
    .array(z.object({ name: z.string(), domain: z.string().describe("Website domain, or empty string") }))
    .describe("Existing customers or reference wins"),
  pricing: z.object({
    model: z.string().describe("e.g. annual subscription, usage-based, per seat; empty if unknown"),
    annualContractValueUsd: z.number().nullable().describe("Typical yearly contract value in USD, or null"),
    notes: z.string().describe("Anything else about pricing; empty if none"),
  }),
});
export type ProductDraft = z.infer<typeof ProductDraftSchema>;

export const emptyDraft = (): ProductDraft => ({
  name: "",
  description: "",
  features: [],
  referenceCustomers: [],
  pricing: { model: "", annualContractValueUsd: null, notes: "" },
});

export const IntakeTurnSchema = z.object({
  reply: z.string().describe("Your next chat message to the founder: one short question, or a confirmation"),
  draft: ProductDraftSchema.describe("The full product record after this turn, merging old and new information"),
  missing: z
    .array(z.enum(["name", "description", "features", "referenceCustomers", "pricing"]))
    .describe("Fields still missing or too vague to infer an ICP"),
  ready: z.boolean().describe("True when there is enough to infer an ICP"),
});
export type IntakeTurn = z.infer<typeof IntakeTurnSchema>;

const confidence = z.number().describe("Confidence from 0.00 to 1.00 that this is right");

export const IcpSchema = z.object({
  industries: z
    .array(z.object({ naics: z.string().describe("NAICS 2022 code, 2-6 digits"), label: z.string(), confidence }))
    .describe("Target industries, most likely first"),
  sizeBands: z.object({
    headcountMin: z.number().nullable(),
    headcountMax: z.number().nullable(),
    revenueMinUsd: z.number().nullable(),
    revenueMaxUsd: z.number().nullable(),
  }),
  personas: z
    .array(
      z.object({
        title: z.string(),
        seniority: z.enum(["c_level", "vp", "director", "manager", "individual_contributor"]),
        function: z.string().describe("e.g. engineering, finance, operations"),
        role: z.enum(["economic_buyer", "champion", "user", "influencer"]),
      }),
    )
    .describe("Buyer personas, the decision-maker first"),
  triggers: z
    .array(
      z.object({
        type: z.enum(["job_post", "funding", "exec_hire", "tech_change", "news", "other"]),
        description: z.string().describe("A concrete, observable event, e.g. 'hiring 2+ SREs'"),
      }),
    )
    .describe("High-value buying signals that can be found in public sources"),
  regions: z.array(z.string()).describe("Target regions or countries"),
  negativeSignals: z.array(z.string()).describe("Signals that make an account a bad fit right now"),
  fieldConfidence: z.object({
    industries: confidence,
    sizeBands: confidence,
    personas: confidence,
    triggers: confidence,
    regions: confidence,
  }),
  rationale: z.string().describe("2-4 sentences: why this ICP follows from the product, customers and price"),
});
export type IcpInference = z.infer<typeof IcpSchema>;

export const ExpansionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        segment: z.string().describe("Short name of the adjacent segment"),
        reasoning: z.string().describe("Why the same pain exists there, 2-3 sentences, grounded in the sources"),
        evidenceUrls: z.array(z.string()).describe("Source URLs from the web search results that support this"),
      }),
    )
    .describe("2 to 4 adjacent or non-obvious segments"),
});
export type ExpansionSuggestions = z.infer<typeof ExpansionSchema>;
