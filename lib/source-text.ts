import { Parser } from "htmlparser2";
import { AppError } from "./errors";

export const MAX_SOURCE_BYTES = 48_000;
export const MAX_SOURCE_RESPONSE = 1_000_000;
// These publishers are part of the initial curriculum/source selection. Exact
// hosts avoid turning saved links or redirects into arbitrary server requests.
// Add a publisher after inspecting its public pages and redirect destinations.
const publishers: Record<string, string> = {
  "developers.openai.com": "OpenAI", "openai.com": "OpenAI",
  "www.anthropic.com": "Anthropic", "anthropic.com": "Anthropic",
  "pair.withgoogle.com": "Google PAIR", "research.google": "Google Research",
  "learn.microsoft.com": "Microsoft", "www.microsoft.com": "Microsoft", "microsoft.com": "Microsoft",
  "developer.mozilla.org": "MDN Web Docs", "developers.cloudflare.com": "Cloudflare",
  "www.nist.gov": "NIST", "nvlpubs.nist.gov": "NIST",
  "www.fda.gov": "FDA", "www.hhs.gov": "HHS", "www.cms.gov": "CMS", "www.cdc.gov": "CDC",
  "www.who.int": "WHO", "pubmed.ncbi.nlm.nih.gov": "PubMed", "pmc.ncbi.nlm.nih.gov": "PubMed Central",
  "clinicaltrials.gov": "ClinicalTrials.gov", "www.ema.europa.eu": "EMA",
  "www.svpg.com": "SVPG", "svpg.com": "SVPG",
  "www.lennysnewsletter.com": "Lenny’s Newsletter", "lennysnewsletter.com": "Lenny’s Newsletter",
  "www.npr.org": "NPR",
};
export const sourcePublisherHosts = Object.freeze(Object.keys(publishers));

export function sourceUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new AppError("Use a public HTTPS source link."); }
  if (value.length > 2000 || parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) throw new AppError("Use a public HTTPS source link without credentials or a custom port.");
  if (!Object.hasOwn(publishers, parsed.hostname)) throw new AppError("This publisher is not connected for source retrieval yet. Your saved link is still available.", 422);
  parsed.hash = "";
  return parsed;
}

const excluded = new Set(["script", "style", "noscript", "template", "nav", "footer", "aside", "form", "svg", "iframe", "canvas", "button", "select"]);
const blocks = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "div", "section", "article", "main", "br", "blockquote", "pre", "tr", "td", "th"]);
type Buffer = { chunks: string[]; length: number; truncated: boolean };
function buffer(): Buffer { return { chunks: [], length: 0, truncated: false }; }
function append(target: Buffer, text: string) {
  const room = MAX_SOURCE_BYTES * 2 - target.length;
  if (text.length > room) target.truncated = true;
  if (room > 0) { target.chunks.push(text.slice(0, room)); target.length += Math.min(room, text.length); }
}
function normalized(text: string) { return text.replace(/\r/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function dateValue(value: string | undefined) {
  const day = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!day) return null;
  const date = new Date(day);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

export type ExtractedSource = { title: string; publisher: string; published: string | null; text: string; truncated: boolean; bytes: number };
export function extractSource(raw: string, contentType: string, finalUrl: string): ExtractedSource {
  let title = "", heading = "", published: string | null = null;
  const publisher = publishers[sourceUrl(finalUrl).hostname], body = buffer(), main = buffer();
  let selected = body;
  if (contentType === "text/plain" || contentType === "text/markdown") {
    append(body, raw); title = normalized(raw.split("\n").find(line => line.trim()) ?? "").replace(/^#+\s*/, "").slice(0, 300);
  } else {
    const stack: { skip: boolean; main: boolean; title: boolean; heading: boolean }[] = [];
    let pageTitle = "", openGraphTitle = "", headingCaptured = false;
    const parser = new Parser({
      onopentag(name, attributes) {
        if (stack.length > 512) throw new AppError("This source page is too complex to read reliably.", 422);
        const parent = stack.at(-1), skip = Boolean(parent?.skip || excluded.has(name) || /(?:^|\s)(?:material-icons|material-symbols-outlined)(?:\s|$)/.test(attributes.class ?? "") || Object.hasOwn(attributes, "hidden") || attributes["aria-hidden"] === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.style ?? ""));
        const inMain = Boolean(parent?.main || name === "main" || name === "article" || attributes.role === "main");
        stack.push({ skip, main: inMain, title: Boolean(parent?.title || name === "title"), heading: Boolean(parent?.heading || name === "h1" && !headingCaptured && !skip) });
        if (name === "meta") {
          const field = (attributes.property ?? attributes.name ?? "").toLowerCase(), value = attributes.content ?? "";
          if (field === "og:title") openGraphTitle = value.slice(0, 300);
          if (["article:published_time", "citation_publication_date", "dc.date.issued"].includes(field)) published ??= dateValue(value);
        }
        if (!skip && blocks.has(name)) { append(body, "\n"); if (inMain) append(main, "\n"); }
      },
      ontext(text) {
        const element = stack.at(-1);
        if (element?.title) { pageTitle = (pageTitle + text).slice(0, 300); return; }
        if (element?.skip) return;
        if (element?.heading) heading = (heading + text).slice(0, 300);
        append(body, text); if (element?.main) append(main, text);
      },
      onclosetag(name) {
        const element = stack.pop();
        if (name === "h1" && element?.heading && !element.skip) headingCaptured = true;
        if (!element?.skip && blocks.has(name)) { append(body, "\n"); if (element?.main) append(main, "\n"); }
      },
    }, { decodeEntities: true });
    parser.end(raw);
    if (normalized(main.chunks.join("")).length >= 300) selected = main;
    title = normalized(heading || openGraphTitle || pageTitle);
  }
  const normalizedText = normalized(selected.chunks.join("")), encoded = new TextEncoder().encode(normalizedText);
  let text = normalizedText, truncated = selected.truncated || encoded.length > MAX_SOURCE_BYTES;
  if (encoded.length > MAX_SOURCE_BYTES) {
    // stream:true drops an incomplete trailing UTF-8 code point.
    text = new TextDecoder().decode(encoded.subarray(0, MAX_SOURCE_BYTES), { stream: true }).trimEnd();
  }
  if (!title || /^(just a moment|access denied|sign in|log in|attention required|verify you are human)/i.test(title) || text.length < 300 || text.split(/\s+/).length < 60) throw new AppError("The page did not expose enough readable public text. It may need a login or a different source.", 422);
  truncated ||= text.length < normalizedText.length;
  return { title: title.slice(0, 300), publisher, published, text, truncated, bytes: new TextEncoder().encode(text).length };
}

export async function materialHash(source: Pick<ExtractedSource, "title" | "publisher" | "published" | "text">, finalUrl: string) {
  const value = JSON.stringify({ finalUrl, title: source.title, publisher: source.publisher, published: source.published, text: source.text });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
