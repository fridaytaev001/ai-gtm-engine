import "server-only";
import { resolveMx } from "node:dns/promises";
import { getEnv } from "@gtm/core";
import { z } from "zod";

type Contact = { name: string; title: string | null; domain: string; linkedinUrl: string | null };
type Lookup = {
  email: string | null;
  emailStatus: "valid" | "risky" | "invalid" | "unknown";
  mxValid: boolean | null;
  enrichSource: string;
  enrichConfidence: number | null;
  linkedinUrl: string | null;
};

const text = z.string().nullish();
const apolloPerson = z.object({ id: text, name: text, first_name: text, last_name: text, last_name_obfuscated: text, linkedin_url: text });
const apolloSearch = z.object({ people: z.array(apolloPerson) });
const apolloMatch = z.object({ person: apolloPerson.nullish() });
const hunterFind = z.object({ data: z.object({ email: text, score: z.number().nullish(), linkedin: text }) });
const hunterVerify = z.object({ data: z.object({ status: text, mx_records: z.boolean().nullish(), score: z.number().nullish() }) });
const prospeoMatch = z.object({
  error: z.boolean().optional(), error_code: text,
  person: z.object({
    linkedin_url: text,
    email: z.object({ email: text, status: text, revealed: z.boolean().optional() }).nullish(),
  }).nullish(),
});

function linkedInProfile(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+/.test(url.pathname)) {
      return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
    }
  } catch { /* ignore invalid profile URLs */ }
  return null;
}

function businessEmail(value: string | null | undefined, domain: string) {
  const parsed = z.email().safeParse(value?.trim().toLowerCase());
  return parsed.success && parsed.data.endsWith(`@${domain}`) ? parsed.data : null;
}

function confidence(score: number | null | undefined) {
  return typeof score === "number" ? Math.max(0, Math.min(1, score / 100)) : null;
}

class ProviderError extends Error {}

export async function resolveContact(contact: Contact, beforeCall: () => Promise<void>): Promise<Lookup> {
  const env = getEnv();
  if (!env.HUNTER_API_KEY && !env.PROSPEO_API_KEY) throw new Error("Configure Hunter or Prospeo to enrich contacts.");
  const domain = contact.domain.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || /\.(example|test|invalid|localhost)$/i.test(domain)) {
    throw new Error("Contact enrichment requires a real company domain.");
  }

  async function request<T>(provider: string, schema: z.ZodType<T>, url: string | URL, init: RequestInit, misses: number[] = []): Promise<T | null> {
    await beforeCall();
    try {
      const res = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(26_000) });
      if (misses.includes(res.status)) return null;
      if (!res.ok) throw new ProviderError(`${provider} returned HTTP ${res.status}.`);
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) throw new ProviderError(`${provider} returned an unexpected response.`);
      return parsed.data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`${provider} could not be reached.`);
    }
  }

  let linkedinUrl = linkedInProfile(contact.linkedinUrl);
  let providerFailure: ProviderError | undefined;
  const [firstName, ...rest] = contact.name.trim().split(/\s+/);
  const lastName = rest.join(" ");
  const matchesName = (value: string) => value.trim().toLowerCase() === contact.name.trim().toLowerCase();
  if (env.APOLLO_API_KEY && !linkedinUrl && contact.title && lastName) {
    try {
      const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
      url.searchParams.append("q_organization_domains_list[]", domain);
      url.searchParams.append("person_titles[]", contact.title);
      url.searchParams.set("per_page", "20");
      const headers = { "x-api-key": env.APOLLO_API_KEY };
      const result = await request("Apollo", apolloSearch, url, { method: "POST", headers });
      const exact = result?.people.find((person) => matchesName(person.name ?? `${person.first_name ?? ""} ${person.last_name ?? ""}`));
      linkedinUrl = linkedInProfile(exact?.linkedin_url);
      const possible = exact ?? result?.people.find((person) => person.first_name?.toLowerCase() === firstName.toLowerCase()
        && person.last_name_obfuscated?.[0]?.toLowerCase() === lastName[0]?.toLowerCase());
      if (possible?.id && !linkedinUrl) {
        const matched = await request("Apollo", apolloMatch, "https://api.apollo.io/api/v1/people/match", {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ id: possible.id, domain, reveal_personal_emails: false, reveal_phone_number: false }),
        }, [404]);
        if (matched?.person && matchesName(matched.person.name ?? `${matched.person.first_name ?? ""} ${matched.person.last_name ?? ""}`)) {
          linkedinUrl = linkedInProfile(matched.person.linkedin_url);
        }
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      providerFailure = error;
    }
  }

  let hunterResult: Lookup | undefined;
  if (env.HUNTER_API_KEY && lastName) {
    try {
      const hunterUrl = (endpoint: string, params: Record<string, string>) =>
        new URL(`https://api.hunter.io/v2/${endpoint}?${new URLSearchParams({ ...params, api_key: env.HUNTER_API_KEY! })}`);
      const found = await request("Hunter", hunterFind, hunterUrl("email-finder", { domain, full_name: contact.name }), {}, [404]);
      linkedinUrl ??= linkedInProfile(found?.data.linkedin);
      const email = businessEmail(found?.data.email, domain);
      if (email) {
        const url = hunterUrl("email-verifier", { email });
        let checked = await request("Hunter", hunterVerify, url, {}, [202, 404]);
        if (!checked) checked = await request("Hunter", hunterVerify, url, {}, [202, 404]);
        const status = checked?.data.status;
        const mxValid = checked?.data.mx_records ?? null;
        const emailStatus = status === "valid" && mxValid === true ? "valid"
          : status === "invalid" || mxValid === false ? "invalid"
          : status === "accept_all" || status === "disposable" ? "risky" : "unknown";
        hunterResult = { email, emailStatus, mxValid, enrichSource: "hunter", enrichConfidence: confidence(checked?.data.score ?? found?.data.score), linkedinUrl };
        if (emailStatus === "valid") return hunterResult;
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      providerFailure = error;
    }
  }

  if (env.PROSPEO_API_KEY) {
    try {
      const result = await request("Prospeo", prospeoMatch, "https://api.prospeo.io/enrich-person", {
        method: "POST", headers: { "X-KEY": env.PROSPEO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ only_verified_email: true, data: { full_name: contact.name, company_website: domain, ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}) } }),
      }, [404]);
      const candidate = result?.person?.email;
      const email = candidate?.revealed && candidate.status === "VERIFIED" ? businessEmail(candidate.email, domain) : null;
      if (email) {
        const mxValid = await resolveMx(domain).then((records) => records.some((record) => record.exchange && record.exchange !== "."), () => null);
        return {
          email, emailStatus: mxValid === true ? "valid" : mxValid === false ? "invalid" : "unknown",
          mxValid, enrichSource: "prospeo", enrichConfidence: null,
          linkedinUrl: linkedInProfile(result?.person?.linkedin_url) ?? linkedinUrl,
        };
      }
      if (result?.error && !["NO_MATCH", "NO_MATCH_FOUND", "NO_VERIFIED_EMAIL"].includes(result.error_code ?? "")) {
        throw new ProviderError("Prospeo could not complete the lookup.");
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      providerFailure = error;
    }
  }

  if (hunterResult) return hunterResult;
  if (providerFailure) throw providerFailure;
  return { email: null, emailStatus: "unknown", mxValid: null, enrichSource: "no_match", enrichConfidence: null, linkedinUrl };
}
