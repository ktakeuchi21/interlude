import { AppError } from "./errors";
import { lessonSupplements, supplementRequest } from "./supplements";

export async function completeSupplement(db: D1Database, userId: string, raw: unknown) {
  const data = supplementRequest.parse(raw);
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can record learning.", 403);
  if (!await db.prepare("SELECT key FROM lesson_versions WHERE key=? AND status='ready'").bind(data.key).first()) throw new AppError("That lesson version is unavailable.", 404);
  const item = lessonSupplements(data.key).find(s => s.id === data.supplementId);
  if (!item) throw new AppError("This supplement is not attached to that lesson version.", 404);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([userId, data.key, item.id])));
  const id = `supplement:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("")}`;
  const payload = { key: data.key, supplementId: item.id, title: item.title, sourceUrl: item.sourceUrl, provider: item.provider, method: "manual", completed: true };
  await db.prepare("INSERT OR IGNORE INTO events(id,user_id,kind,payload,created_at) VALUES(?,?,'supplement',?,?)").bind(id, userId, JSON.stringify(payload), Date.now()).run();
  const saved = await db.prepare("SELECT user_id,kind,payload FROM events WHERE id=?").bind(id).first<{ user_id: string; kind: string; payload: string }>();
  if (!saved || saved.user_id !== userId || saved.kind !== "supplement" || JSON.parse(saved.payload).key !== data.key || JSON.parse(saved.payload).supplementId !== item.id) throw new AppError("That completion record needs checking before it can be changed.", 409);
  // A manual supplement record never changes the lesson, recall, minutes or cost.
  return { id, ...JSON.parse(saved.payload) };
}
