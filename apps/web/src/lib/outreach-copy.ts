import { z } from "zod";

export const openingOptions = ["Quick question for you.", "I wanted to reach out.", "I thought this might be relevant."] as const;
export const ctaOptions = ["Open to a 15-minute chat?", "Would it help if I sent a short overview?", "Is this a priority for your team?"] as const;

export const DraftChoices = z.object({
  source: z.number().int().min(0).max(5),
  opening: z.enum(openingOptions),
  cta: z.enum(ctaOptions),
  alternateCta: z.enum(ctaOptions),
});

export function draftVariants(leadId: string, name: string, product: string, citation: { quote: string; sourceUrl: string }, choice: z.infer<typeof DraftChoices>) {
  const first = name.trim().split(/\s+/)[0];
  const greeting = `Hi ${first},`;
  const cited = `“${citation.quote.replace(/\s+/g, " ").trim()}”\n${citation.sourceUrl}`;
  const alternate = choice.alternateCta === choice.cta ? ctaOptions.find((cta) => cta !== choice.cta)! : choice.alternateCta;
  return [
    { leadId, channel: "email" as const, step: 1, variant: "A", subject: "Quick introduction", body: `${greeting}\n\n${choice.opening}\n\n${cited}\n\nCould we talk about ${product}? ${choice.cta}` },
    { leadId, channel: "email" as const, step: 1, variant: "B", subject: "Worth a conversation?", body: `${greeting}\n\n${cited}\n\nWould you take a look at ${product}? ${alternate}` },
    { leadId, channel: "linkedin" as const, step: 2, variant: "A", subject: null, body: `${greeting} Would you be open to connecting? ${choice.cta}` },
    { leadId, channel: "email" as const, step: 3, variant: "A", subject: "Following up", body: `${greeting}\n\nJust checking in. ${alternate}` },
  ];
}
