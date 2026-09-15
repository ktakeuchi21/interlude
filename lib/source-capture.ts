import { AppError } from "./errors";
import { boundedBytes, withGenerationLock, type GenerationClaim } from "./jobs";
import { extractSource, materialHash, sourceUrl, MAX_SOURCE_RESPONSE } from "./source-text";
import type { SourceCapture, SourceMaterial } from "./contracts";

export const MAX_SOURCE_COPIES = 500;
export const MONTHLY_SOURCE_RETRIEVALS = 160;
export type SourceCaptureRow = { id: string; user_id: string; library_item_id: string; requested_url: string; status: SourceCapture["status"]; result: string | null; material: string | null; error: string | null; created_at: number; finished_at: number | null };
export function sourceCaptureFromRow(row: SourceCaptureRow): SourceCapture {
  return { id: row.id, library_item_id: row.library_item_id, requested_url: row.requested_url, status: row.status, result: row.result ? JSON.parse(row.result) : null, error: row.error, created_at: row.created_at, finished_at: row.finished_at };
}

async function fetchPublicSource(value: string, claim: GenerationClaim, fetcher: typeof fetch) {
  let target = sourceUrl(value);
  // One overall deadline covers redirects and body consumption; no page scripts,
  // cookies, credentials, images, or nested links are requested.
  const signal = AbortSignal.timeout(30_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await claim.assertActive();
    const response = await fetcher(target.href, { redirect: "manual", credentials: "omit", headers: { Accept: "text/html, text/plain;q=0.9, text/markdown;q=0.9", "User-Agent": "InterludeLearning/0.1 (public educational source retrieval)" }, signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new AppError("This source redirected too many times to retrieve reliably.", 422);
      target = sourceUrl(new URL(location, target).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new AppError("The publisher did not make this page available for retrieval. Your saved link is unchanged.", 422); }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!contentType || !["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(contentType)) {
      await response.body?.cancel(); throw new AppError("This source format is not readable here yet. PDF, video, and podcast support needs a separate retrieval path.", 415);
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response, MAX_SOURCE_RESPONSE));
    const source = extractSource(raw, contentType, target.href);
    return { ...source, finalUrl: target.href, contentType };
  }
  throw new AppError("The source could not be retrieved.", 422);
}

export async function getSourceCapture(db: D1Database, userId: string, id: string) {
  const row = await db.prepare("SELECT * FROM source_captures WHERE id=? AND user_id=?").bind(id, userId).first<SourceCaptureRow>();
  if (!row) throw new AppError("That source retrieval was not found.", 404);
  return sourceCaptureFromRow(row);
}

export async function captureSavedSource(db: D1Database, userId: string, data: { id: string; itemId: string }, services: { fetch?: typeof fetch } = {}) {
  const item = await db.prepare("SELECT url FROM library_items WHERE id=? AND user_id=? AND kind='source'").bind(data.itemId, userId).first<{ url: string }>();
  if (!item?.url) throw new AppError("Save a public source link before retrieving it.", 404);
  async function existing() {
    const row = await db.prepare("SELECT * FROM source_captures WHERE id=?").bind(data.id).first<SourceCaptureRow>();
    if (row && (row.user_id !== userId || row.library_item_id !== data.itemId || row.requested_url !== item!.url)) throw new AppError("This retrieval belongs to a different saved source.", 409);
    return row;
  }
  const previous = await existing();
  // A repeated request reads its saved result, including a failure or an
  // interrupted pending attempt. It never repeats outbound requests silently.
  if (previous) return sourceCaptureFromRow(previous);
  sourceUrl(item.url);
  return withGenerationLock(db, `source:${data.id}`, async claim => {
    const repeated = await existing(); if (repeated) return sourceCaptureFromRow(repeated);
    const now = Date.now(), monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const insert = await db.prepare(`INSERT OR IGNORE INTO source_captures(id,user_id,library_item_id,requested_url,status,created_at)
      SELECT ?,?,?,?,'retrieving',? WHERE (SELECT COUNT(*) FROM source_captures)<?
        AND (SELECT COUNT(*) FROM source_captures WHERE created_at>=?)<?`)
      .bind(data.id, userId, data.itemId, item.url, now, MAX_SOURCE_COPIES, monthStart, MONTHLY_SOURCE_RETRIEVALS).run();
    if (insert.meta.changes !== 1) throw new AppError("The source retrieval allowance is full. Saved sources and lessons remain available.", 402);
    try {
      const source = await fetchPublicSource(item.url, claim, services.fetch ?? fetch);
      const retrievedAt = Date.now();
      const preview = source.text.length > 420 ? source.text.slice(0, 420).replace(/\s+\S*$/, "") : source.text;
      const result: SourceMaterial = { finalUrl: source.finalUrl, title: source.title, publisher: source.publisher, published: source.published, retrievedAt, contentType: source.contentType, hash: await materialHash(source, source.finalUrl), bytes: source.bytes, truncated: source.truncated, preview };
      if (result.published && result.published > new Date(retrievedAt).toISOString().slice(0, 10)) throw new AppError("The source's publication date needs checking before it can be used.", 422);
      await claim.assertActive();
      await db.prepare("UPDATE source_captures SET status='retrieved',result=?,material=?,finished_at=? WHERE id=? AND user_id=? AND status='retrieving'").bind(JSON.stringify(result), source.text, retrievedAt, data.id, userId).run();
    } catch (error) {
      const message = error instanceof AppError ? error.message : "The source could not be read within its size or time limit. No AI charge was made. You can make a new retrieval attempt.";
      await claim.assertActive();
      await db.prepare("UPDATE source_captures SET status='unavailable',error=?,finished_at=? WHERE id=? AND user_id=? AND status='retrieving'").bind(message, Date.now(), data.id, userId).run();
    }
    return getSourceCapture(db, userId, data.id);
  });
}

/** Internal access for grounding/checking; raw source material is not included in the general UI state. */
export async function capturedMaterial(db: D1Database, userId: string, id: string) {
  const row = await db.prepare("SELECT * FROM source_captures WHERE id=? AND user_id=? AND status='retrieved'").bind(id, userId).first<SourceCaptureRow>();
  if (!row?.material || !row.result) throw new AppError("A readable source copy is required before checking its claims.", 422);
  const result = JSON.parse(row.result) as SourceMaterial;
  if (await materialHash({ ...result, text: row.material }, result.finalUrl) !== result.hash) throw new AppError("The saved source copy does not match its recorded fingerprint.", 422);
  return { ...result, text: row.material };
}
