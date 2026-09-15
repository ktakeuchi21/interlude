"use client";
import { ArrowRight } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { lessonKey, type Lesson } from "@/lib/content";
import { allLessonVersions, hasUnreadUpdate } from "@/lib/lesson-history";
import type { AppState } from "@/lib/contracts";
import { LessonRefresh } from "./lesson-refresh";

export function LessonHistory({ lesson, state, onOpen, refresh }: { lesson: Lesson; state: AppState; onOpen: (lesson: Lesson) => void; refresh: () => Promise<unknown> }) {
  const versions = allLessonVersions(state).filter(l => l.id === lesson.id).sort((a, b) => b.version - a.version);
  const current = versions[0], isOlder = current.version !== lesson.version;
  return <section className="lesson-history" aria-label="Lesson versions">
    {isOlder ? <div className="version-notice"><p>You’re reading version {lesson.version}. Your notes and listening position belong to this version.</p><Button variant="outline" onClick={() => onOpen(current)}>Read current version {current.version}<ArrowRight size={16} aria-hidden="true" /></Button></div> : hasUnreadUpdate(lesson, state) && <p className="version-notice">This lesson has an update. Your earlier completion still counts; this version has its own reading and listening position.</p>}
    <Accordion type="single" collapsible>
      <AccordionItem value="history"><AccordionTrigger>Version history{versions.length > 1 ? ` · ${versions.length} versions` : ""}</AccordionTrigger><AccordionContent>
        <p className="muted">Each version keeps its sources, notes, practice, and saved audio. Reading an update does not erase earlier learning.</p>
        <ol className="version-list">{versions.map(version => {
          const key = lessonKey(version), release = state.releases.find(r => r.lesson_key === key);
          const completed = state.progress.some(p => p.lesson_key === key && p.completed);
          const notes = state.notes.filter(n => n.lesson_key === key).length;
          return <li key={key}>
            <div className="version-heading"><strong>Version {version.version}{version.version === current.version ? " · Current" : ""}</strong>{release && <time className="muted small" dateTime={new Date(release.createdAt).toISOString()}>{new Date(release.createdAt).toLocaleDateString()}</time>}</div>
            <p>{release?.summary ?? "Change details are unavailable for this version."}</p>
            <p className="small muted">{completed ? "Completed" : "Not completed"} · {notes} saved {notes === 1 ? "note" : "notes"} · {state.media.some(m => m.lesson_key === key) ? "Audio saved" : "Audio not prepared"}</p>
            {release?.review?.method === "automated" && <><p className="small muted">Automatic source and teaching checks; no expert review.</p><p className="small">{release.review.summary}</p></>}
            {key === lessonKey(lesson) ? <span className="small">Reading this version</span> : <Button variant="outline" onClick={() => onOpen(version)}>Read version {version.version}<ArrowRight size={16} aria-hidden="true" /></Button>}
          </li>;
        })}</ol>
        <LessonRefresh key={lessonKey(lesson)} lesson={lesson} state={state} refresh={refresh} />
      </AccordionContent></AccordionItem>
    </Accordion>
  </section>;
}
