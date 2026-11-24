/**
 * Citation check ("no citation, no lead"): a quoted sentence only counts as evidence if it can be
 * found on the cited page, or in the search engine's snippet for that page when the site blocks fetching.
 */

export type QuoteCheck = { verified: boolean; via: "page" | "snippet" | null; reason?: string };

const pageCache = new Map<string, Promise<string | null>>();

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/[^a-z0-9$%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Fetch a public page as plain text (cached per process). Returns null when the site refuses or times out. */
export function fetchPageText(url: string, timeoutMs = 9000): Promise<string | null> {
  const cached = pageCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const res = await fetch(u, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "Mozilla/5.0 (compatible; GTMEngineCitationCheck/1.0)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      });
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml|json/.test(type)) return null;
      const body = (await res.text()).slice(0, 2_000_000);
      return normalize(htmlToText(body));
    } catch {
      return null;
    }
  })();
  pageCache.set(url, p);
  return p;
}

/**
 * True if the quote's words appear in the haystack: an exact normalized match, or any run of
 * 8 consecutive quote words (tolerates a model trimming or re-punctuating a long sentence).
 */
function contains(haystack: string, quote: string): boolean {
  const q = normalize(quote);
  if (!q || q.split(" ").length < 4) return false; // too short to prove anything
  if (haystack.includes(q)) return true;
  const words = q.split(" ");
  const window = Math.min(8, words.length);
  for (let i = 0; i + window <= words.length; i++) {
    if (haystack.includes(words.slice(i, i + window).join(" "))) return true;
  }
  return false;
}

export async function verifyQuote(url: string, quote: string, snippet?: string): Promise<QuoteCheck> {
  const page = await fetchPageText(url);
  if (page && contains(page, quote)) return { verified: true, via: "page" };
  if (snippet && contains(normalize(snippet), quote)) return { verified: true, via: "snippet" };
  return { verified: false, via: null, reason: page ? "quote not found on page" : "page could not be fetched" };
}

/** Bare registrable-looking domain: lowercase, no scheme, no www, no path. */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(d)) d = new URL(d).hostname;
  } catch {
    /* fall through */
  }
  return d.replace(/^www\./, "").replace(/\/.*$/, "");
}
