import { generateStructured, type ChatMessage, type Usage } from "./provider";
import { IntakeTurnSchema, type IntakeTurn, type ProductDraft } from "./schemas";

const SYSTEM = `You run the product intake for a go-to-market engine used by B2B founders.
Your job is to fill a structured product record through a short chat, then hand off to ICP inference.

You need: product name, what it does, core features or technical constraints, existing customers or reference wins, and pricing (model and typical contract value).
- Ask one focused question per turn, about the most important missing field. Keep messages under 50 words.
- Never invent facts. Only record what the founder said; leave unknown fields empty.
- Merge new information into the existing record; never drop fields the founder gave earlier.
- If the founder says they have no customers yet or no pricing, record that in notes and do not ask again.
- Set ready=true once name, description and features are filled and customers and pricing have each been answered or declined.`;

export type ChatTurn = ChatMessage;

/** One intake chat turn: returns the assistant reply and the updated product record. */
export async function intakeTurn(history: ChatTurn[], draft: ProductDraft): Promise<{ turn: IntakeTurn; usage: Usage }> {
  const messages: ChatMessage[] = [
    ...history,
    {
      role: "user",
      content: `<current_record>\n${JSON.stringify(draft, null, 2)}\n</current_record>\nUpdate the record from the conversation and write your next message.`,
    },
  ];
  // The conversation must start with a user turn.
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "Hi, I want to find customers." });

  const { data, usage } = await generateStructured({
    name: "intake_turn",
    system: SYSTEM,
    messages,
    schema: IntakeTurnSchema,
    effort: "low",
    maxTokens: 4000,
  });
  return { turn: data, usage };
}
