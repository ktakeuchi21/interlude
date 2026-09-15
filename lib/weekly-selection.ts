import { courses, lessonKey, type Lesson } from "./content";
import { completedLessonIds, completedVersions, hasUnreadUpdate } from "./lesson-history";
import type { CoursePreference, LearningEvent, LibraryItem, Progress } from "./contracts";

export type WeeklySuggestion = {
  id: string; identity: string; kind: "lesson" | "review" | "library" | "topic";
  title: string; reason: string; lessonKey?: string; libraryItemId?: string;
  topicId?: string; courseId?: string;
};
export type WeeklyBatch = { week: string; origin: "manual" | "scheduled"; items: WeeklySuggestion[]; created_at: number };
export type WeeklyChoice = { week: string; item_id: string; dismissed: number; revision: number; updated_at: number };
export type WeeklyContext = { lessons: Lesson[]; archivedLessons: Lesson[]; progress: Progress[]; events: LearningEvent[]; coursePreferences: CoursePreference[]; libraryItems: LibraryItem[] };
const DAY = 86400000;
/** Server calendar: Monday–Sunday UTC. Never accept a browser-provided week to generate. */
export function learningWeek(now: number) {
  const date = new Date(now); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
// Proposed questions, not researched claims or ready lessons. Research starts only after selection.
const adjacentIdeas = [
  { id: "ai-product:handoffs", courseId: "ai-product", title: "Designing a useful handoff from an AI assistant to a person" },
  { id: "ai-product:abstention", courseId: "ai-product", title: "When should an AI product say it does not know?" },
  { id: "ai-product:feedback", courseId: "ai-product", title: "Turning user feedback into examples for AI evaluation" },
  { id: "ai-development:tracing", courseId: "ai-development", title: "Following one user action through an application's frontend, API, and database" },
  { id: "ai-development:rollback", courseId: "ai-development", title: "How to undo a change safely when building with an AI coding assistant" },
  { id: "ai-development:logs", courseId: "ai-development", title: "Using an application's logs to ask a better debugging question" },
  { id: "ai-healthcare:workflow", courseId: "ai-healthcare", title: "Mapping a pharma knowledge-assistance workflow before choosing AI" },
  { id: "ai-healthcare:evidence", courseId: "ai-healthcare", title: "Separating measured outcomes from proposed healthcare AI benefits" },
  { id: "ai-healthcare:review", courseId: "ai-healthcare", title: "Designing a human review step for an AI-assisted commercial workflow" },
];

export function selectWeekly(context: WeeklyContext, history: WeeklyBatch[], choices: WeeklyChoice[], now: number): WeeklySuggestion[] {
  const week = learningWeek(now), weekIndex = Math.floor(Date.parse(week) / (7 * DAY)), active = context.coursePreferences.filter(p => p.active).map(p => p.id);
  const recent = new Set(history.filter(b => Date.parse(b.week) > Date.parse(week) - 28 * DAY).flatMap(b => b.items.filter(i => choices.some(c => c.week === b.week && c.item_id === i.id && c.dismissed) || i.kind === "topic" || i.kind === "library").map(i => i.identity)));
  const make = (data: Omit<WeeklySuggestion, "id">) => ({ id: crypto.randomUUID(), ...data });
  const suggestions: WeeklySuggestion[] = [], completed = completedLessonIds(context);
  const add = (item: WeeklySuggestion | undefined) => { if (item && !recent.has(item.identity) && !suggestions.some(s => s.identity === item.identity)) suggestions.push(item); };
  for (const courseId of active) {
    const next = context.lessons.filter(l => l.courseId === courseId && (!completed.has(l.id) || hasUnreadUpdate(l, context))).sort((a, b) => a.order - b.order)[0];
    if (!next) continue;
    const course = courses.find(c => c.id === courseId)!;
    const candidate = make({ kind: "lesson", identity: `lesson:${lessonKey(next)}`, title: next.title, lessonKey: lessonKey(next), courseId,
      reason: hasUnreadUpdate(next, context) ? `There is an unread update in your active course, ${course.title}. Your earlier completion still counts.` : `This is the next ready lesson in ${course.title}, following your active course order.` });
    add(candidate); if (suggestions.length) break;
  }
  const due = completedVersions([...context.lessons, ...context.archivedLessons], context.progress).filter(l => active.includes(l.courseId) || l.courseId === "standalone").map(lesson => {
    const last = context.events.filter(e => e.kind === "quiz" && e.payload.key === lessonKey(lesson)).sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
    const completedAt = context.progress.find(p => p.lesson_key === lessonKey(lesson) && p.completed)?.observed_at ?? now;
    return { lesson, last, dueAt: (last?.created_at ?? completedAt) + (last?.payload.correct === false ? DAY : 7 * DAY) };
  }).filter(x => x.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt || lessonKey(a.lesson).localeCompare(lessonKey(b.lesson)));
  for (const { lesson, last } of due) {
    if (suggestions.some(s => s.lessonKey?.startsWith(`${lesson.id}:v`))) continue;
    const candidate = make({ kind: "review", identity: `review:${lessonKey(lesson)}`, title: lesson.title, lessonKey: lessonKey(lesson), courseId: lesson.courseId,
      reason: last?.payload.correct === false ? "Your latest recall check for this version missed the answer. A short revisit may help." : "You completed this version, and its last completion or recall check was at least a week ago." });
    const count = suggestions.length; add(candidate); if (suggestions.length > count) break;
  }
  const saved = [...context.libraryItems].filter(i => !i.refresh_of && i.status !== "archived" && !recent.has(`library:${i.id}`)).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  const savedCandidate = saved ? make({ kind: "library", identity: `library:${saved.id}`, title: saved.title.slice(0, 200), libraryItemId: saved.id,
    reason: saved.kind === "source" ? "You saved this source. Open its retained material or retrieval controls to decide what to explore next." : "You asked to learn about this topic. Its research and preparation can continue from your saved library item." }) : undefined;
  const ideas = adjacentIdeas.filter(i => active.includes(i.courseId) && !recent.has(`topic:${i.id}`) && !context.libraryItems.some(l => l.title.toLowerCase() === i.title.toLowerCase())).sort((a, b) => active.indexOf(a.courseId) - active.indexOf(b.courseId));
  const idea = ideas.length ? ideas[weekIndex % ideas.length] : undefined;
  const proposed = idea ? make({ kind: "topic", identity: `topic:${idea.id}`, title: idea.title, topicId: crypto.randomUUID(), courseId: idea.courseId,
    reason: `A related question for your active course, ${courses.find(c => c.id === idea.courseId)!.title}. This is an unresearched topic idea; saving it does not generate a lesson.` }) : undefined;
  for (const candidate of weekIndex % 2 === 0 ? [proposed, savedCandidate] : [savedCandidate, proposed]) if (suggestions.length < 3) add(candidate);
  return suggestions.slice(0, 3);
}
