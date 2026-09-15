import { AppError } from "./errors";
import { settleSpend } from "./budget";

export async function textFingerprint(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export async function reconcileNarrationPart(db: D1Database, saved: Pick<R2Object, "key" | "size" | "customMetadata">, operation: string, fingerprint: string, reservation: number) {
  const metadata = saved.customMetadata;
  if (!saved.size || saved.size % 2 || saved.size > 16_000_000 || metadata?.operation !== operation || metadata.inputSha256 !== fingerprint || metadata.reservedMicrodollars !== String(reservation)) throw new AppError("A saved audio segment needs inspection before it can be reused. No new narration was requested.", 409);
  await settleSpend(db, operation, reservation, metadata.providerRequest === "unavailable" ? null : metadata.providerRequest ?? null,
    JSON.stringify({ objectKey: saved.key, bytes: saved.size, costBasis: "character-rate upper bound, not provider invoice" }));
}
