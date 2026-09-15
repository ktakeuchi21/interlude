"use client";
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { lessonKey, type Lesson } from "@/lib/content";
import { completedLessonIds, hasUnreadUpdate } from "@/lib/lesson-history";
import type { AppState } from "@/lib/contracts";

export function StandaloneLessons({ state, onOpen }: { state: AppState; onOpen: (lesson: Lesson) => void }) {
  const lessons = state.lessons.filter(l => l.courseId === "standalone"), completed = completedLessonIds(state);
  if (!lessons.length) return null;
  return <section className="standalone-lessons" aria-label="Standalone lessons">
    <div className="section-heading"><h2>Ideas you asked for</h2></div>
    <p className="muted">Explore a topic whenever it interests you. Each lesson keeps its own progress and practice.</p>
    <ul className="lesson-list">{lessons.map(lesson => {
      const key = lessonKey(lesson), progress = state.progress.find(p => p.lesson_key === key), audio = state.media.find(m => m.lesson_key === key);
      return <li key={key}><div><h3>{lesson.title}</h3><p className="small muted">{audio?.duration ? `${Math.ceil(audio.duration / 60)} min` : `About ${lesson.minutes} minutes`} · {lesson.sources.length} sources · {hasUnreadUpdate(lesson, state) ? "Update unread" : completed.has(lesson.id) ? "Completed" : progress ? "In progress" : "Ready to learn"}</p></div><Button variant="outline" onClick={() => onOpen(lesson)}>Open <ArrowRight size={16} aria-hidden="true" /></Button></li>;
    })}</ul>
  </section>;
}
