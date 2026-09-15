import { z } from "zod";
import { AppError } from "./errors";
import { courses, type Lesson } from "./content";
import { partitionLessonVersions } from "./lesson-history";
import type { CoursePreference, LearningEvent, LibraryItem, Progress } from "./contracts";
import { learningWeek, selectWeekly, type WeeklyBatch, type WeeklyChoice, type WeeklySuggestion } from "./weekly-selection";
export const MAX_WEEKLY_BATCHES = 260;
export type WeeklyRow = { week: string; origin: "manual" | "scheduled"; items: string; created_at: number };
export function weeklyFromRow(row: WeeklyRow): WeeklyBatch { return { ...row, items: JSON.parse(row.items) as WeeklySuggestion[] }; }
async function requireOwner(db: D1Database, userId: string) { const row = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>(); if (row?.user_id !== userId) throw new AppError("Only the owner can manage weekly suggestions.", 403); }
export async function weeklyHistory(db: D1Database, userId: string) {
  const [batches, choices] = await Promise.all([
    db.prepare("SELECT week,origin,items,created_at FROM weekly_batches WHERE user_id=? ORDER BY week DESC").bind(userId).all<WeeklyRow>(),
    db.prepare("SELECT week,item_id,dismissed,revision,updated_at FROM weekly_choices WHERE user_id=? ORDER BY week DESC,item_id").bind(userId).all<WeeklyChoice>(),
  ]);
  return { batches: batches.results.map(weeklyFromRow), choices: choices.results };
}
/** Real application operation; an unattended trigger must still be configured separately. */
export async function prepareWeekly(db: D1Database, userId: string, now = Date.now(), origin: "manual" | "scheduled" = "manual") {
  await requireOwner(db, userId); const week = learningWeek(now), previous = await db.prepare("SELECT week,origin,items,created_at FROM weekly_batches WHERE user_id=? AND week=?").bind(userId, week).first<WeeklyRow>();
  if (previous) return weeklyFromRow(previous);
  const [versions, progress, events, preferences, library, history] = await Promise.all([
    db.prepare("SELECT content FROM lesson_versions WHERE status='ready' ORDER BY lesson_id,version DESC").all<{ content: string }>(),
    db.prepare("SELECT * FROM progress WHERE user_id=?").bind(userId).all<Progress>(),
    db.prepare("SELECT id,kind,payload,created_at FROM events WHERE user_id=? AND kind='quiz' ORDER BY created_at DESC").bind(userId).all<{ id: string; kind: string; payload: string; created_at: number }>(),
    db.prepare("SELECT value FROM preferences WHERE user_id=? AND key='courses'").bind(userId).first<{ value: string }>(),
    db.prepare("SELECT * FROM library_items WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<LibraryItem>(), weeklyHistory(db, userId),
  ]);
  if (history.batches.length >= MAX_WEEKLY_BATCHES) throw new AppError("The retained weekly history is full. Your existing suggestions remain available.", 429);
  const items = selectWeekly({ ...partitionLessonVersions(versions.results.map(r => JSON.parse(r.content) as Lesson)), progress: progress.results,
    events: events.results.map(r => ({ ...r, payload: JSON.parse(r.payload) })) as LearningEvent[],
    coursePreferences: preferences ? JSON.parse(preferences.value) as CoursePreference[] : courses.map(c => ({ id: c.id, active: true })), libraryItems: library.results }, history.batches, history.choices, now);
  const payload = JSON.stringify(items); if (new TextEncoder().encode(payload).length > 12000) throw new AppError("These suggestions need checking before they can be saved.", 422);
  await db.prepare("INSERT INTO weekly_batches(user_id,week,origin,items,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM weekly_batches WHERE user_id=?)<? ON CONFLICT(user_id,week) DO NOTHING").bind(userId, week, origin, payload, now, userId, MAX_WEEKLY_BATCHES).run();
  const saved = await db.prepare("SELECT week,origin,items,created_at FROM weekly_batches WHERE user_id=? AND week=?").bind(userId, week).first<WeeklyRow>();
  if (!saved) throw new AppError("The retained weekly history is full. Your existing suggestions remain available.", 429);
  return weeklyFromRow(saved);
}
const itemRef = { week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), itemId: z.string().uuid() };
export const weeklyChoiceRequest = z.object({ ...itemRef, dismissed: z.boolean(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
export const weeklyTopicRequest = z.object(itemRef).strict();
async function getItem(db: D1Database, userId: string, week: string, itemId: string) {
  await requireOwner(db, userId);
  const row = await db.prepare("SELECT week,origin,items,created_at FROM weekly_batches WHERE user_id=? AND week=?").bind(userId, week).first<WeeklyRow>();
  const item = row && weeklyFromRow(row).items.find(i => i.id === itemId); if (!item) throw new AppError("That weekly suggestion was not found.", 404); return item;
}
export async function chooseWeekly(db: D1Database, userId: string, raw: unknown) {
  const data = weeklyChoiceRequest.parse(raw); await getItem(db, userId, data.week, data.itemId);
  if (data.revision === 0) await db.prepare("INSERT OR IGNORE INTO weekly_choices(user_id,week,item_id,dismissed,revision,updated_at) VALUES(?,?,?,?,1,?)").bind(userId, data.week, data.itemId, Number(data.dismissed), Date.now()).run();
  else await db.prepare("UPDATE weekly_choices SET dismissed=?,revision=revision+1,updated_at=? WHERE user_id=? AND week=? AND item_id=? AND revision=? AND dismissed<>?").bind(Number(data.dismissed), Date.now(), userId, data.week, data.itemId, data.revision, Number(data.dismissed)).run();
  const choice = await db.prepare("SELECT week,item_id,dismissed,revision,updated_at FROM weekly_choices WHERE user_id=? AND week=? AND item_id=?").bind(userId, data.week, data.itemId).first<WeeklyChoice>();
  if (!choice || Boolean(choice.dismissed) !== data.dismissed) throw new AppError("This suggestion changed on another device. Refresh before choosing again.", 409);
  return choice;
}
export async function saveWeeklyTopic(db: D1Database, userId: string, raw: unknown) {
  const data = weeklyTopicRequest.parse(raw), item = await getItem(db, userId, data.week, data.itemId);
  if (item.kind !== "topic" || !item.topicId) throw new AppError("This suggestion already points to saved learning.", 409);
  const detail = `Suggested for ${courses.find(c => c.id === item.courseId)?.title ?? "your learning"}. Research this question using inspected sources before preparing a lesson.`;
  await db.prepare("INSERT OR IGNORE INTO library_items(id,user_id,kind,title,detail,status,created_at) VALUES(?,?,'topic',?,?,'awaiting research',?)").bind(item.topicId, userId, item.title, detail, Date.now()).run();
  const saved = await db.prepare("SELECT user_id,kind,title,detail FROM library_items WHERE id=?").bind(item.topicId).first<{ user_id: string; kind: string; title: string; detail: string }>();
  if (!saved || saved.user_id !== userId || saved.kind !== "topic" || saved.title !== item.title || saved.detail !== detail) throw new AppError("The saved topic has different details. Its existing information was preserved.", 409);
  return { itemId: item.topicId };
}
