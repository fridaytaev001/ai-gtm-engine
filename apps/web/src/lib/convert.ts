import "server-only";
import { emptyDraft, type IcpInference, type ProductDraft } from "@gtm/ai";
import type { IcpRow, ProductRow } from "./data";

/** Stored product row -> the shape the AI layer takes. */
export function toDraft(product: ProductRow): ProductDraft {
  return {
    ...emptyDraft(),
    name: product.name,
    description: product.description,
    features: product.features,
    referenceCustomers: product.referenceCustomers.map((c) => ({ name: c.name, domain: c.domain ?? "" })),
    pricing: {
      model: product.pricing.model ?? "",
      annualContractValueUsd: product.pricing.annualContractValueUsd ?? null,
      notes: product.pricing.notes ?? "",
    },
  };
}

/** Stored ICP row (incl. accepted expansion segments) -> the shape the AI layer takes. */
export function toInference(icp: IcpRow): IcpInference {
  return {
    industries: [
      ...icp.industries.map((i) => ({ ...i, confidence: i.confidence ?? 0.5 })),
      // Accepted expansion segments widen the target industries.
      ...icp.segments.map((s) => ({ naics: "", label: s.segment, confidence: 0.6 })),
    ],
    sizeBands: {
      headcountMin: icp.sizeBands.headcountMin ?? null,
      headcountMax: icp.sizeBands.headcountMax ?? null,
      revenueMinUsd: icp.sizeBands.revenueMinUsd ?? null,
      revenueMaxUsd: icp.sizeBands.revenueMaxUsd ?? null,
    },
    personas: icp.personas as IcpInference["personas"],
    triggers: icp.triggers as IcpInference["triggers"],
    regions: icp.regions,
    negativeSignals: icp.negativeSignals,
    fieldConfidence: icp.fieldConfidence as IcpInference["fieldConfidence"],
    rationale: icp.rationale ?? "",
  };
}
