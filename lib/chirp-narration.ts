import { lessonKey, narrationText, type Lesson } from "./content";
import { waveHeader } from "./audio";
import { AppError } from "./errors";
import { withGenerationLock } from "./jobs";
import { textFingerprint } from "./narration-records";
import { reserveStorage, settleStorage } from "./storage";
import { googleAccessToken, splitChirpText, synthesizeChirp } from "./google-tts";
import { reserveChirp, settleChirp } from "./chirp-usage";
import { CHIRP_SAMPLE, type ChirpAudio, type ChirpVoice } from "./chirp-voices";

export type ChirpServices = { secret?: string; bucket?: R2Bucket; onlySaved?: boolean; fetch?: typeof fetch; fixedLengthStream?: (length: number) => { readable: ReadableStream; writable: WritableStream } };
type AudioRow = ChirpAudio & { input_sha256: string };

async function renderChirp(db: D1Database, input: { id: string; voice: ChirpVoice; kind: ChirpAudio["kind"]; lessonKey: string | null; text: string }, services: ChirpServices) {
  const bucket = services.bucket;
  if (!bucket) throw new AppError("Audio storage is temporarily unavailable.", 503);
  const savedJob = () => db.prepare("SELECT * FROM chirp_audio WHERE id=?").bind(input.id).first<AudioRow>();
  const saved = await savedJob();
  if (saved?.object_key) return saved;
  return withGenerationLock(db, `chirp:${input.id}`, async claim => {
    const chunks = splitChirpText(input.text), fingerprint = await textFingerprint(chunks.join(" "));
    await db.prepare("INSERT OR IGNORE INTO chirp_audio(id,voice,kind,lesson_key,input_sha256,created_at) VALUES(?,?,?,?,?,?)").bind(input.id, input.voice, input.kind, input.lessonKey, fingerprint, Date.now()).run();
    const job = (await savedJob())!;
    if (job.object_key) return job;
    if (job.input_sha256 !== fingerprint || job.kind !== input.kind || job.lesson_key !== input.lessonKey) throw new AppError("This narration's text changed. Publish a new lesson version before generating new audio.", 409);
    // The first voice is pinned, so changing the default cannot resend a held job.
    const voice = job.voice, allocation = `chirp:${input.id}`, prefix = `chirp/${input.id}/${voice}`;
    const parts: { key: string; length: number }[] = [];
    let token: string | undefined;
    for (const [index, text] of chunks.entries()) {
      await claim.assertActive();
      const operation = `${input.id}:${index}`, key = `${prefix}/part-${index}.pcm`, hash = await textFingerprint(text), count = new TextEncoder().encode(text).length;
      const reconcile = async (part: Pick<R2Object, "size" | "customMetadata">) => {
        if (!part.size || part.size % 2 || part.size > 16_000_000 || part.customMetadata?.operation !== operation || part.customMetadata?.inputSha256 !== hash || part.customMetadata?.characters !== String(count) || part.customMetadata?.voice !== voice) throw new AppError("A saved Chirp segment needs inspection. No new narration was requested.", 409);
        await settleChirp(db, operation, hash, count);
        parts.push({ key, length: part.size });
      };
      const part = await bucket.head(key);
      if (part) { await reconcile(part); continue; }
      if (await db.prepare("SELECT id FROM chirp_requests WHERE id=?").bind(operation).first()) throw new AppError("A previous Chirp attempt has no saved audio. Its allowance remains held, and it will not be resent automatically.", 409);
      if (services.onlySaved) throw new AppError("Some narration segments are missing. Saved segments were checked; no new narration was requested.", 409);
      if (!services.secret) throw new AppError("Google narration is awaiting secure setup. You can read this lesson now.", 503);
      await reserveStorage(db, allocation, chunks.length * 16_000_000 + 24_000_044);
      token ??= await googleAccessToken(services.secret, services.fetch);
      await claim.assertActive();
      await reserveChirp(db, operation, input.id, hash, count);
      try {
        await claim.assertActive();
        const bytes = await synthesizeChirp(token, text, voice, services.fetch);
        await claim.assertActive();
        const stored = await bucket.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { operation, inputSha256: hash, characters: String(count), voice } });
        if (!stored) throw new AppError("This narration could not be saved. Its allowance remains held.", 503);
        await reconcile(stored);
      } catch (error) { await db.prepare("UPDATE chirp_requests SET status='uncertain' WHERE id=? AND status!='complete'").bind(operation).run(); throw error; }
    }
    const pcmLength = parts.reduce((sum, part) => sum + part.length, 0);
    if (!pcmLength || pcmLength > 24_000_000) throw new AppError("This narration exceeds the supported lesson length.");
    await claim.assertActive();
    await reserveStorage(db, allocation, pcmLength * 2 + 44);
    const objectKey = `${prefix}/lesson.wav`, stream = services.fixedLengthStream?.(pcmLength + 44) ?? new FixedLengthStream(pcmLength + 44), writer = stream.writable.getWriter();
    const upload = bucket.put(objectKey, stream.readable, { httpMetadata: { contentType: "audio/wav" } });
    const assemble = async () => {
      try {
        await writer.write(waveHeader(pcmLength));
        for (const part of parts) {
          await claim.assertActive();
          const object = await bucket.get(part.key);
          if (!object) throw new AppError("A saved narration segment is unavailable.", 503);
          const reader = object.body.getReader(); let read = 0;
          try { while (true) { const { value, done } = await reader.read(); if (done) break; read += value.byteLength; if (read > part.length) throw new AppError("Saved narration size changed.", 409); await writer.write(value); } }
          finally { reader.releaseLock(); }
          if (read !== part.length) throw new AppError("Saved narration is incomplete.", 409);
        }
        await writer.close();
      } catch (error) { await writer.abort(error); throw error; }
    };
    const [stored] = await Promise.all([upload.catch(async error => { await writer.abort(error); throw error; }), assemble()]);
    if (!stored) throw new AppError("The narration could not be assembled. Its saved segments can be recovered.", 503);
    await claim.assertActive();
    const duration = Math.round(pcmLength / 48000);
    // Settle before the commit marker, so a lost response remains recoverable.
    await settleStorage(db, allocation, pcmLength * 2 + 44);
    const writes = [db.prepare("UPDATE chirp_audio SET object_key=?,bytes=?,duration=? WHERE id=? AND object_key IS NULL").bind(objectKey, pcmLength + 44, duration, input.id)];
    if (input.kind === "lesson") writes.push(db.prepare("INSERT OR IGNORE INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,?,'audio/wav',?,?,?)").bind(input.lessonKey, objectKey, pcmLength + 44, duration, Date.now()));
    await db.batch(writes);
    return (await savedJob())!;
  });
}

export async function prepareChirpLesson(db: D1Database, lesson: Lesson, services: ChirpServices) {
  const key = lessonKey(lesson);
  if (await db.prepare("SELECT lesson_key FROM media WHERE lesson_key=?").bind(key).first()) return;
  const existing = await db.prepare("SELECT voice FROM chirp_audio WHERE id=?").bind(`lesson:${key}`).first<{ voice: ChirpVoice }>();
  const setting = await db.prepare("SELECT voice FROM chirp_settings WHERE id=1").first<{ voice: ChirpVoice }>();
  const voice = existing?.voice ?? setting?.voice;
  if (!voice) throw new AppError("Choose a tested Google voice in Settings before preparing narration.", 503);
  await renderChirp(db, { id: `lesson:${key}`, kind: "lesson", lessonKey: key, voice, text: narrationText(lesson) }, services);
}

export async function prepareChirpPreview(db: D1Database, kind: "sample" | "pilot", voice: ChirpVoice, lesson: Lesson, services: ChirpServices) {
  return renderChirp(db, { id: `${kind}:${voice.toLowerCase()}`, kind, voice, lessonKey: kind === "pilot" ? lessonKey(lesson) : null, text: kind === "sample" ? CHIRP_SAMPLE : narrationText(lesson) }, services);
}

export async function activateChirp(db: D1Database, voice: ChirpVoice) {
  return withGenerationLock(db, "chirp:select-voice", async () => {
    const sample = await db.prepare("SELECT id FROM chirp_audio WHERE id=? AND voice=? AND object_key IS NOT NULL").bind(`sample:${voice.toLowerCase()}`, voice).first();
    const pilot = await db.prepare("SELECT id FROM chirp_audio WHERE id=? AND voice=? AND object_key IS NOT NULL").bind(`pilot:${voice.toLowerCase()}`, voice).first();
    if (!sample || !pilot) throw new AppError("Prepare a voice sample and a full lesson preview before choosing this voice.", 409);
    await db.prepare("INSERT INTO chirp_settings(id,voice) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET voice=excluded.voice").bind(voice).run();
  });
}
