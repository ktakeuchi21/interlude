import { z } from "zod";
import { capturedMaterial } from "./source-capture";
import { AppError } from "./errors";
import type { AnswerSourceCopy } from "./contracts";

export const MAX_QUESTION_SOURCES = 2;
export const SOURCE_CONTEXT_BYTES = 12_000;
export const sourceSelectionSchema = z.array(z.string().uuid()).max(MAX_QUESTION_SOURCES).default([])
  .refine(ids => new Set(ids).size === ids.length, "Choose each source copy only once.")
  .transform(ids => [...ids].sort());

/** A deterministic bounded excerpt. Never pass markup or fetch instructions to a tool. */
export function sourceContext(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= SOURCE_CONTEXT_BYTES) return { text, bytes: bytes.length, partial: false };
  const excerpt = new TextDecoder().decode(bytes.slice(0, SOURCE_CONTEXT_BYTES), { stream: true }).replace(/\s+\S*$/, "");
  return { text: excerpt, bytes: new TextEncoder().encode(excerpt).length, partial: true };
}

export async function questionGrounding(db: D1Database, userId: string, ids: string[]) {
  const copies: AnswerSourceCopy[] = [], contexts: { sourceId: string; text: string }[] = [];
  for (const snapshotId of ids) {
    // Owner filtering and fingerprint verification happen before any reservation.
    const { text, ...source } = await capturedMaterial(db, userId, snapshotId);
    if (copies.some(copy => copy.finalUrl === source.finalUrl)) throw new AppError("Choose one retrieved copy of each source page.");
    const context = sourceContext(text), sourceId = `snapshot:${snapshotId}`;
    copies.push({ ...source, snapshotId, sourceId, contextBytes: context.bytes, partialContext: source.truncated || context.partial });
    contexts.push({ sourceId, text: context.text });
  }
  return { copies, contexts };
}

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
export function checkAnswerEvidence(sourceIds: string[], evidence: { sourceId: string; quote: string }[], contexts: { sourceId: string; text: string }[]) {
  if (new Set(evidence.map(e => e.sourceId)).size !== evidence.length) throw new AppError("The answer repeated a source excerpt and was not saved.", 502);
  for (const item of evidence) {
    const context = contexts.find(c => c.sourceId === item.sourceId), quote = normalize(item.quote);
    if (!context || !sourceIds.includes(item.sourceId) || quote.length < 12 || quote.split(" ").length > 20 || !normalize(context.text).includes(quote)) {
      throw new AppError("The answer's source excerpt could not be verified against the text provided. The answer was not saved.", 502);
    }
  }
  if (contexts.some(c => sourceIds.includes(c.sourceId) && !evidence.some(e => e.sourceId === c.sourceId))) {
    throw new AppError("The answer cited a retrieved page without a verifiable excerpt and was not saved.", 502);
  }
  // Matching a quotation is a mechanical check, not a semantic or expert review.
}
