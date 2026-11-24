import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FALLBACK_BETA, getAnthropic, MODEL, ModelRefusalError, toUsage, type Usage } from "./client";
import { IcpSchema, type IcpInference, type ProductDraft } from "./schemas";

const SYSTEM = `You are a B2B go-to-market strategist. From a product record, infer the Ideal Customer Profile (ICP) that a small sales team should target first.

Rules:
- Ground every field in the product record: what it does, who already buys it, and what it costs. A $15k/yr product cannot target 10-person shops or Fortune 50 procurement; a product with no customers yet gets lower confidence.
- Industries: use NAICS 2022 codes. Prefer the most specific code you are sure of; fall back to a 3-4 digit code when unsure.
- Personas: the economic buyer first, then the champion. Use real job titles.
- Triggers: concrete events that are visible in public sources (job posts, funding announcements, executive hires, tech-stack changes, news), phrased so a search engine could find them.
- Negative signals: things that make an account a bad fit right now (hiring freeze, layoffs, existing customer, wrong region).
- Confidence: 0.00-1.00 per field. Be honest; below 0.60 means the founder should check it. Lower confidence when the record is thin.
- Do not invent customers, numbers or facts that are not implied by the record.`;

/** Infer a structured ICP with per-field confidence from the product record. */
export async function inferIcp(product: ProductDraft): Promise<{ icp: IcpInference; usage: Usage }> {
  const response = await getAnthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(IcpSchema) },
    messages: [
      {
        role: "user",
        content: `<product>\n${JSON.stringify(product, null, 2)}\n</product>\nInfer the ICP.`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new ModelRefusalError(response.stop_details?.category);
  if (!response.parsed_output) throw new Error("ICP response could not be parsed");
  return { icp: clampConfidence(response.parsed_output), usage: toUsage(response.usage) };
}

const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 100) / 100));

function clampConfidence(icp: IcpInference): IcpInference {
  return {
    ...icp,
    industries: icp.industries.map((i) => ({ ...i, confidence: clamp(i.confidence) })),
    fieldConfidence: Object.fromEntries(
      Object.entries(icp.fieldConfidence).map(([k, v]) => [k, clamp(v)]),
    ) as IcpInference["fieldConfidence"],
  };
}
