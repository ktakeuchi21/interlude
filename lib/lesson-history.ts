import { lessonKey, type Lesson } from "./content";
import type { AppState, Progress } from "./contracts";

type Library = Pick<AppState, "lessons" | "archivedLessons" | "progress">;

/** Each logical lesson has one place in the library, regardless of its revisions. */
export function partitionLessonVersions(versions: Lesson[]) {
  const latest = new Map<string, Lesson>();
  for (const lesson of versions) {
    if (lesson.version > (latest.get(lesson.id)?.version ?? 0)) latest.set(lesson.id, lesson);
  }
  return {
    lessons: versions.filter(lesson => latest.get(lesson.id) === lesson),
    archivedLessons: versions.filter(lesson => latest.get(lesson.id) !== lesson),
  };
}

export function allLessonVersions(library: Pick<Library, "lessons" | "archivedLessons">) {
  return [...library.lessons, ...library.archivedLessons];
}

export function findLessonVersion(library: Pick<Library, "lessons" | "archivedLessons">, key: string | null) {
  return allLessonVersions(library).find(lesson => lessonKey(lesson) === key);
}

export function completedLessonIds(library: Library) {
  const completed = new Set(library.progress.filter(p => p.completed).map(p => p.lesson_key));
  return new Set(allLessonVersions(library).filter(l => completed.has(lessonKey(l))).map(l => l.id));
}

export function hasUnreadUpdate(lesson: Lesson, library: Library) {
  return completedLessonIds(library).has(lesson.id) && !library.progress.some(p => p.lesson_key === lessonKey(lesson) && p.completed);
}

/** Reviews use the most recent version actually completed, with that version's quiz. */
export function completedVersions(versions: Lesson[], progress: Progress[]) {
  const completed = new Set(progress.filter(p => p.completed).map(p => p.lesson_key));
  return partitionLessonVersions(versions.filter(l => completed.has(lessonKey(l)))).lessons;
}
