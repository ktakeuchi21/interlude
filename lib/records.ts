import { AppError } from "./errors";
import type { Lesson } from "./content";
export async function saveNote(db: D1Database, userId: string, data: { id: string; key: string; kind: string; text: string }) {
  await db.prepare("INSERT OR IGNORE INTO notes(id,user_id,lesson_key,kind,text,created_at) VALUES(?,?,?,?,?,?)").bind(data.id, userId, data.key, data.kind, data.text, Date.now()).run();
  const saved = await db.prepare("SELECT user_id,lesson_key,kind,text FROM notes WHERE id=?").bind(data.id).first<{ user_id: string; lesson_key: string; kind: string; text: string }>();
  if (!saved || saved.user_id !== userId || saved.lesson_key !== data.key || saved.kind !== data.kind || saved.text !== data.text) throw new AppError("That save identifier already belongs to a different note. Edit the note before saving it again.", 409);
}
export async function saveQuiz(db: D1Database, userId: string, lesson: Lesson, data: { id: string; key: string; answer: number }) {
  if (data.answer >= lesson.quiz.options.length) throw new AppError("Choose one of the answers.");
  const result = { correct: data.answer === lesson.quiz.answer, explanation: lesson.quiz.explanation };
  await db.prepare("INSERT OR IGNORE INTO events(id,user_id,kind,payload,created_at) VALUES(?,?,'quiz',?,?)").bind(data.id, userId, JSON.stringify({ ...data, ...result }), Date.now()).run();
  const saved = await db.prepare("SELECT user_id,kind,payload FROM events WHERE id=?").bind(data.id).first<{ user_id: string; kind: string; payload: string }>();
  const payload = saved ? JSON.parse(saved.payload) : null;
  if (!saved || saved.user_id !== userId || saved.kind !== "quiz" || payload?.key !== data.key || payload?.answer !== data.answer) throw new AppError("That attempt was already recorded with another answer. Choose your answer again.", 409);
  return { correct: Boolean(payload.correct), explanation: String(payload.explanation) };
}
