import type { AppState, Progress } from "./contracts";
import { lessonKey, type Lesson } from "./content";
import { completedLessonIds, findLessonVersion } from "./lesson-history";

type Library = Pick<AppState, "lessons" | "archivedLessons" | "progress" | "coursePreferences">;
export type HomeLesson = { lesson: Lesson; progress?: Progress; mode: "resume" | "next" | "revisit" };

export function selectHomeLesson(library: Library, currentKey: string | null = null): HomeLesson | null {
  const active = library.coursePreferences.filter(c => c.active).map(c => c.id);
  const eligible = (lesson: Lesson) => active.includes(lesson.courseId) || lesson.courseId === "standalone";
  const current = findLessonVersion(library, currentKey);
  const currentProgress = library.progress.find(p => p.lesson_key === currentKey);
  if (current && !currentProgress?.completed) return { lesson: current, progress: currentProgress, mode: "resume" };

  const recent = [...library.progress].sort((a, b) => b.observed_at - a.observed_at)
    .flatMap(progress => {
      const lesson = findLessonVersion(library, progress.lesson_key);
      return lesson && eligible(lesson) ? [{ lesson, progress }] : [];
    });
  const unfinished = recent.find(item => !item.progress.completed);
  if (unfinished) return { ...unfinished, mode: "resume" };

  // Stay in the course last used before moving to another active path.
  const previousCourse = recent[0]?.lesson.courseId;
  const courseOrder = active.includes(previousCourse) ? [previousCourse, ...active.filter(id => id !== previousCourse)] : active;
  const completed = completedLessonIds(library);
  for (const courseId of courseOrder) {
    const next = library.lessons.filter(l => l.courseId === courseId && !completed.has(l.id)).sort((a, b) => a.order - b.order)[0];
    if (next) return { lesson: next, progress: library.progress.find(p => p.lesson_key === lessonKey(next)), mode: "next" };
  }

  // Keep an actual lesson one tap away when the available course content is finished.
  return recent[0] ? { ...recent[0], mode: "revisit" } : null;
}
