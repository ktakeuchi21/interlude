import { env } from "cloudflare:workers";
import { getLesson } from "./server";
import { prepareNarration } from "./narration-generation";
import { prepareChirpLesson } from "./chirp-narration";

async function narration(db: D1Database, key: string, onlySaved = false) {
  const lesson = await getLesson(db, key);
  // Recover old OpenAI parts, but never send a new OpenAI narration request.
  const legacy = await db.prepare("SELECT id FROM spending WHERE id LIKE ? LIMIT 1").bind(`tts:${key}:alloy:%`).first();
  if (legacy) return prepareNarration(db, lesson, { bucket: env.BUCKET, onlySaved: true });
  return prepareChirpLesson(db, lesson, { secret: env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON, bucket: env.BUCKET, onlySaved });
}
export const generateNarration = (db: D1Database, key: string) => narration(db, key);
export const recoverNarration = (db: D1Database, key: string) => narration(db, key, true);
