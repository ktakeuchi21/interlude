import { AppError } from "./errors";
export type ProgressUpdate = { key: string; position?: number; section?: number; completed: boolean; observedAt: number };
export async function writeProgress(db: D1Database, userId: string, data: ProgressUpdate, now = Date.now()) {
  if (data.observedAt > now + 5000 || data.observedAt < now - 86_400_000) throw new AppError("Your device clock is out of sync. Check it, then try again.");
  // Independent clocks keep a reading update from resetting audio on another device.
  await db.prepare(`INSERT INTO progress(user_id,lesson_key,position,section,completed,observed_at,revision,position_at,section_at) VALUES(?,?,?,?,?,?,1,?,?)
    ON CONFLICT(user_id,lesson_key) DO UPDATE SET
    position=CASE WHEN excluded.position_at>progress.position_at THEN excluded.position ELSE progress.position END,
    section=CASE WHEN excluded.section_at>progress.section_at THEN excluded.section ELSE progress.section END,
    position_at=MAX(progress.position_at,excluded.position_at),section_at=MAX(progress.section_at,excluded.section_at),
    completed=MAX(progress.completed,excluded.completed),observed_at=MAX(progress.observed_at,excluded.observed_at),revision=progress.revision+1`)
    .bind(userId, data.key, Math.floor(data.position ?? 0), data.section ?? 0, data.completed ? 1 : 0, data.observedAt, data.position === undefined ? 0 : data.observedAt, data.section === undefined ? 0 : data.observedAt).run();
  if (data.completed) await db.prepare("INSERT OR IGNORE INTO events(id,user_id,kind,payload,created_at) VALUES(?,?,'completion',?,?)")
    .bind(`completion:${userId}:${data.key}`, userId, JSON.stringify({ key: data.key }), now).run();
  return db.prepare("SELECT * FROM progress WHERE user_id=? AND lesson_key=?").bind(userId, data.key).first();
}
