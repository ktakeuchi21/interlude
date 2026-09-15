"use client";
import { ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { Button } from "./ui/button";
import type { Course, Lesson } from "@/lib/content";
import type { HomeLesson } from "@/lib/next-lesson";

export function HomeLessonCard({ choice, courses, onOpen, onExplore }: {
  choice: HomeLesson | null; courses: Course[]; onOpen: (lesson: Lesson) => void; onExplore: () => void;
}) {
  if (!choice) return <section className="next-lesson">
    <p className="eyebrow">YOUR NEXT LESSON</p><h2>Choose a learning path</h2>
    <p className="next-objective">Open your library to find an available lesson.</p>
    <Button className="light-button" onClick={onExplore}>View library <ArrowRight size={16} /></Button>
  </section>;

  const { lesson, mode, progress } = choice, course = courses.find(c => c.id === lesson.courseId);
  const savedPlace = progress?.position ? `Audio saved at ${Math.floor(progress.position / 60)}:${String(Math.floor(progress.position % 60)).padStart(2, "0")}`
    : progress && progress.section > 0 ? `Reading section ${progress.section + 1} of ${lesson.sections.length}` : "Your place is saved as you learn";
  return <section className="next-lesson" aria-labelledby="home-lesson-title">
    <div className="card-topline"><span className="eyebrow">{mode === "resume" ? "CONTINUE LEARNING" : mode === "next" ? "UP NEXT" : "REVISIT YOUR LAST LESSON"}</span><span className="time-pill"><Clock3 size={14} aria-hidden="true" /> ~{lesson.minutes} min</span></div>
    <p className="course-caption">{course?.title ?? "Standalone lesson"}</p>
    <h2 id="home-lesson-title">{lesson.title}</h2>
    <p className="next-objective">{lesson.objective}</p>
    <p className="home-lesson-status">{mode === "resume" ? savedPlace : mode === "revisit" ? "You’re caught up with your available lessons. Come back to this idea anytime." : "Ready when you are. Read or listen at your own pace."}</p>
    <Button className="light-button" onClick={() => onOpen(lesson)}><BookOpen size={18} aria-hidden="true" />{mode === "resume" ? "Continue lesson" : mode === "next" ? "Start lesson" : "Revisit lesson"}<ArrowRight size={17} aria-hidden="true" /></Button>
    <div className="card-footer"><span>{course ? `LESSON ${lesson.order} OF ${course.lessons.length}` : "STANDALONE LESSON"}</span><span>Read & listen</span></div>
  </section>;
}
