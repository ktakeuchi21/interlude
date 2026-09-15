import { z } from "zod";
import { AppError } from "./errors";
import { lessonKey, type Lesson } from "./content";
import { lessonContentHash } from "./lesson-release";
import type { LibraryItem } from "./contracts";

export const refreshRequest = z.object({ id: z.string().uuid(), key: z.string().min(3).max(120), reason: z.string().trim().max(600).default("") }).strict();
export type RefreshContext = { key: string; hash: string; requestedAt: number; lesson: Lesson };
export type RefreshTopic = { refresh_of?: string | null; refresh_hash?: string | null; created_at: number };

export async function readRefreshContext(db: D1Database, topic: RefreshTopic, requireCurrent = true): Promise<RefreshContext | undefined> {
  if (!topic.refresh_of && !topic.refresh_hash) return undefined;
  if (!topic.refresh_of || !topic.refresh_hash) throw new AppError("This update request needs its original lesson reference.", 409);
  const row = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(topic.refresh_of).first<{ content: string }>();
  if (!row) throw new AppError("The original lesson for this update is unavailable.", 409);
  const lesson: Lesson = JSON.parse(row.content);
  if (lessonKey(lesson) !== topic.refresh_of || await lessonContentHash(lesson) !== topic.refresh_hash) throw new AppError("The original lesson no longer matches this update request.", 409);
  if (requireCurrent) {
    const current = await db.prepare("SELECT key FROM lesson_versions WHERE lesson_id=? AND status='ready' ORDER BY version DESC LIMIT 1").bind(lesson.id).first<{ key: string }>();
    if (current?.key !== topic.refresh_of) throw new AppError("A newer lesson version exists. Start an update check from its current version.", 409);
  }
  return { key: topic.refresh_of, hash: topic.refresh_hash, requestedAt: topic.created_at, lesson };
}
export async function validateRefreshContext(db: D1Database, refresh: RefreshContext, requireCurrent: boolean) {
  const original = await readRefreshContext(db, { refresh_of: refresh.key, refresh_hash: refresh.hash, created_at: refresh.requestedAt }, requireCurrent);
  if (!original || await lessonContentHash(refresh.lesson) !== original.hash) throw new AppError("The retained original teaching no longer matches this update.", 409);
}

/** Saves an update request, without searching, generating, or replacing teaching. */
export async function requestLessonRefresh(db: D1Database, userId: string, raw: z.input<typeof refreshRequest>) {
  const data = refreshRequest.parse(raw), owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can request a lesson update.", 403);
  const row = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(data.key).first<{ content: string }>();
  if (!row) throw new AppError("That lesson is not ready for an update check.", 404);
  const lesson: Lesson = JSON.parse(row.content), hash = await lessonContentHash(lesson), title = `Update check: ${lesson.title}`.slice(0, 200);
  const detail = `Learning objective: ${lesson.objective}\nWhat to check: ${data.reason || "Material changes in evidence, capabilities, or guidance. Keep useful evergreen teaching stable."}`;
  async function existing() {
    const item = await db.prepare("SELECT * FROM library_items WHERE id=?").bind(data.id).first<LibraryItem & { user_id: string }>();
    if (!item) return null;
    if (item.user_id !== userId || item.kind !== "topic" || item.refresh_of !== data.key || item.refresh_hash !== hash || item.title !== title || item.detail !== detail) throw new AppError("This update-request ID already has different details.", 409);
    return item;
  }
  const saved = await existing(); if (saved) return saved;
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO library_items(id,user_id,kind,title,detail,status,created_at,refresh_of,refresh_hash)
    SELECT ?,?,'topic',?,?,'awaiting research',?,?,? WHERE
    (SELECT key FROM lesson_versions WHERE lesson_id=? AND status='ready' ORDER BY version DESC LIMIT 1)=?
    AND (SELECT COUNT(*) FROM library_items WHERE user_id=?)<1000`)
    .bind(data.id, userId, title, detail, now, data.key, hash, lesson.id, data.key, userId).run();
  const result = await existing();
  if (!result) throw new AppError("A newer lesson version exists or the saved-interest allowance is full. Open the current lesson before requesting an update.", 409);
  return result;
}
