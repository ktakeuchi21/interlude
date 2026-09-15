import { lessonKey, type Lesson } from "./content";
import { waveHeader } from "./audio";
import { reserveSpend, uncertainSpend } from "./budget";
import { reconcileNarrationPart } from "./narration-records";
import { narrationPlan, narrationAttempts } from "./narration-attempts";
import { withGenerationLock, boundedBytes } from "./jobs";
import { reserveStorage, settleStorage } from "./storage";
import { AppError } from "./errors";

export async function prepareNarration(db: D1Database, lesson: Lesson, services: { apiKey?: string; bucket?: R2Bucket; onlySaved?: boolean; fetch?: typeof fetch; fixedLengthStream?: (length: number) => { readable: ReadableStream; writable: WritableStream } }) {
  const key = lessonKey(lesson), bucket = services.bucket;
  if (!bucket) throw new AppError("Audio storage is temporarily unavailable.", 503);
  if (await db.prepare("SELECT object_key FROM media WHERE lesson_key=?").bind(key).first()) return;
  return withGenerationLock(db, `narration:${key}`, async claim => {
    if (await db.prepare("SELECT object_key FROM media WHERE lesson_key=?").bind(key).first()) return;
    const plan = await narrationPlan(lesson), parts: { key: string; length: number }[] = [];
    let originalStorage = 0;
    // Reserve both recovery segments and the assembled file before writing any
    // object. Interrupted jobs retain their allocation so orphaned files count.
    const allocation = `audio:${key}`;
    for (const part of plan) {
      await claim.assertActive();
      const attempts = await narrationAttempts(db, part);
      let recovered = false;
      for (const attempt of attempts) {
        const saved = await bucket.head(attempt.key);
        if (!saved) continue;
        await reconcileNarrationPart(db, saved, attempt.operation, part.fingerprint, part.reservation);
        if (attempt.replacementId) await settleStorage(db, `audio-replacement:${attempt.replacementId}`, saved.size);
        parts.push({ key: attempt.key, length: saved.size });
        originalStorage += attempt.replacementId ? 16_000_000 : saved.size;
        recovered = true; break;
      }
      if (recovered) continue;
      if (services.onlySaved) throw new AppError("Some narration segments are still missing. Saved segments were checked; no new AI request was sent.", 409);
      if (!services.apiKey) throw new AppError("Narration setup is pending. You can read this lesson now.", 503);
      if (Date.now() > Date.UTC(2026, 10, 13)) throw new AppError("New narration is paused until its pricing is checked again. Saved audio remains available.", 402);
      const { operation, key: partKey, replacementId } = attempts.at(-1)!;
      const { reservation, fingerprint } = part;
      await reserveStorage(db, allocation, plan.length * 16_000_000 + 24_000_044);
      if (replacementId) await reserveStorage(db, `audio-replacement:${replacementId}`, 16_000_000);
      await reserveSpend(db, operation, "narration", reservation, "tts-1, $15/1M characters; UTF-8 byte upper bound; verified 2026-09-13", claim.token, replacementId);
      try {
        await claim.assertActive();
        const response = await (services.fetch ?? fetch)("https://api.openai.com/v1/audio/speech", {
          method: "POST", headers: { Authorization: `Bearer ${services.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "tts-1", voice: "alloy", input: part.text, response_format: "pcm", speed: 1 }), signal: AbortSignal.timeout(120_000),
        });
        await db.prepare("UPDATE spending SET provider_request=? WHERE id=? AND status='reserved'").bind(response.headers.get("x-request-id"), operation).run();
        if (!response.ok) throw new AppError("The narration service did not complete this request. The attempt is held for cost review; it will not be retried automatically.", 502);
        const bytes = await boundedBytes(response, 16_000_000);
        if (!bytes.length || bytes.length % 2) throw new AppError("The narration response was not a usable audio file.", 502);
        await claim.assertActive();
        const stored = await bucket.put(partKey, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { operation, inputSha256: fingerprint, providerRequest: response.headers.get("x-request-id") ?? "unavailable", reservedMicrodollars: String(reservation) } });
        if (!stored) throw new AppError("This narration could not be saved. Its cost remains reserved.", 503);
        await reconcileNarrationPart(db, stored, operation, fingerprint, reservation);
        if (replacementId) await settleStorage(db, `audio-replacement:${replacementId}`, bytes.length);
        originalStorage += replacementId ? 16_000_000 : bytes.length;
        parts.push({ key: partKey, length: bytes.length });
      } catch (error) { await uncertainSpend(db, operation); throw error; }
    }
    const pcmLength = parts.reduce((sum, p) => sum + p.length, 0);
    if (pcmLength > 24_000_000) throw new AppError("This narration is longer than the supported lesson size.");
    const objectKey = `narration/${key}/lesson.wav`;
    await claim.assertActive();
    await reserveStorage(db, allocation, plan.length * 16_000_000 + 24_000_044);
    // Stream the assembled file. Holding all parts plus the final WAV would risk
    // the Worker's shared memory limit. FixedLengthStream also gives R2 its length.
    const stream = services.fixedLengthStream?.(44 + pcmLength) ?? new FixedLengthStream(44 + pcmLength), writer = stream.writable.getWriter();
    const upload = bucket.put(objectKey, stream.readable, { httpMetadata: { contentType: "audio/wav" } });
    const assemble = async () => {
      try {
        await writer.write(waveHeader(pcmLength));
        for (const part of parts) {
          await claim.assertActive();
          const object = await bucket.get(part.key);
          if (!object) throw new AppError("A saved narration segment is unavailable. No new charge was attempted.", 503);
          const reader = object.body.getReader();
          try { while (true) { const { value, done } = await reader.read(); if (done) break; await writer.write(value); } }
          finally { reader.releaseLock(); }
        }
        await writer.close();
      } catch (error) { await writer.abort(error); throw error; }
    };
    const [stored] = await Promise.all([upload.catch(async error => { await writer.abort(error); throw error; }), assemble()]);
    if (!stored) throw new AppError("The assembled narration could not be saved. Its segments remain available for recovery.", 503);
    await claim.assertActive();
    await db.prepare("INSERT OR IGNORE INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,?,?,?,?,?)")
      .bind(key, objectKey, "audio/wav", 44 + pcmLength, Math.round(pcmLength / 48000), Date.now()).run();
    await settleStorage(db, allocation, originalStorage + pcmLength + 44);
  });
}
