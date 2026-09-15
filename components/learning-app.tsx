"use client";
import { ChirpSettings } from "./chirp-settings";
import { narrationAvailable } from "@/lib/chirp-voices";
import { WeeklyRefreshPanel } from "./weekly-refresh";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, Clock3, Download, LoaderCircle, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { api } from "@/lib/client";
import { StandaloneLessons } from "./standalone-lessons";
import { ListeningQueue } from "./listening-queue";
import { LibraryTools } from "./library-tools";
import { AudioPlayer } from "./audio-player";
import { WeeklySuggestions } from "./weekly-suggestions";
import { HomeLessonCard } from "./home-lesson";
import { LessonSupplements } from "./lesson-supplements";
import { LessonQuestions } from "./lesson-questions";
import { GenerationUsage } from "./generation-usage";
import { SpokenInput } from "./spoken-input";
import { LessonHistory } from "./lesson-history";
import { lessonKey, type Lesson, type Course } from "@/lib/content";
import type { AppState, Progress } from "@/lib/contracts";
import { mergeProgress } from "@/lib/progress-state";
import { selectHomeLesson } from "@/lib/next-lesson";
import { allLessonVersions, completedLessonIds, completedVersions, findLessonVersion, hasUnreadUpdate } from "@/lib/lesson-history";
import { overviewView, savedInterestAnchor } from "@/lib/navigation";

function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function LearningApp({ displayName }: { displayName: string }) {
  const [state, setState] = useState<AppState | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [tab, setTab] = useState("today");
  const drafts = useRef(new Map<string, { text: string; kind: string; id: string }>());
  const selectionRef = useRef<string | null>(null), supplementOpen = useRef(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [audioKey, setAudioKey] = useState<string | null>(null);
  useEffect(() => { selectionRef.current = selected; }, [selected]);
  const [course, setCourse] = useState<string | null>(null), [note, setNote] = useState(""), [noteKind, setNoteKind] = useState("reflection"), [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState(""), [quiz, setQuiz] = useState<{ correct: boolean; explanation: string } | null>(null);
  const section = useRef(0), lastInteraction = useRef(0), readingStart = useRef(0), noteId = useRef(crypto.randomUUID()), quizId = useRef(crypto.randomUUID());
  const refresh = useCallback(async () => { const result = await api<AppState>("state"); setState(previous => previous ? { ...result, progress: mergeProgress(previous.progress, result.progress) } : result); return result; }, []);
  const restoreInitialLocation = useCallback((loaded: AppState) => {
    const key = new URLSearchParams(location.search).get("lesson");
    if (findLessonVersion(loaded, key)) { setSelected(key); setAudioKey(key); }
    else setTab(overviewView(location.search, location.hash, history.state));
    setAnchor(savedInterestAnchor(location.hash));
  }, []);
  const supplementPresence = useCallback((open: boolean) => { supplementOpen.current = open; lastInteraction.current = 0; readingStart.current = Date.now(); }, []);
  const reportActivity = useCallback((key: string, start: number, end: number, mode: "reading" | "audio") => { void api("activity", { key, start, end, mode }).catch(() => { /* An unobserved interval is not counted as learning. */ }); }, []);
  const saveProgress = useCallback((key: string, position: number | undefined, completed: boolean, sectionValue?: number) => {
    return api<{ progress: Progress }>("progress", { key, position, completed, section: sectionValue, observedAt: Date.now() }).then(({ progress }) => {
      setState(s => s && (s.progress.find(p => p.lesson_key === key)?.revision ?? 0) <= progress.revision ? { ...s, progress: [...s.progress.filter(p => p.lesson_key !== key), progress] } : s);
      return progress;
    }).catch(e => setError(`Progress could not sync: ${e.message}`));
  }, []);
  useEffect(() => {
    if (!selected) return;
    void saveProgress(selected, undefined, false);
    lastInteraction.current = 0; readingStart.current = Date.now();
    const active = () => { lastInteraction.current = Date.now(); };
    for (const event of ["pointerdown", "keydown", "scroll"]) window.addEventListener(event, active, { passive: true });
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!supplementOpen.current && document.visibilityState === "visible" && now - lastInteraction.current < 25_000) reportActivity(selected, readingStart.current, now, "reading");
      readingStart.current = now;
    }, 10_000);
    const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting && lastInteraction.current > 0) { section.current = Number((entry.target as HTMLElement).dataset.section); saveProgress(selected, undefined, false, section.current); } }, { rootMargin: "-15% 0px -55% 0px" });
    document.querySelectorAll("[data-section]").forEach(node => observer.observe(node));
    return () => { clearInterval(timer); observer.disconnect(); for (const event of ["pointerdown", "keydown", "scroll"]) window.removeEventListener(event, active); };
  }, [selected, reportActivity, saveProgress]);
  function keepDraft() { if (selected) { if (note.trim()) drafts.current.set(selected, { text: note, kind: noteKind, id: noteId.current }); else drafts.current.delete(selected); } }
  function openLesson(lesson: Lesson, keepQueue = false, pushHistory = true) {
    keepDraft(); if (!keepQueue) setQueue([]);
    const key = lessonKey(lesson), draft = drafts.current.get(key);
    selectionRef.current = key; setSelected(key); setAudioKey(key); setAnswer(""); setQuiz(null); quizId.current = crypto.randomUUID();
    setNote(draft?.text ?? ""); setNoteKind(draft?.kind ?? "reflection"); noteId.current = draft?.id ?? crypto.randomUUID();
    section.current = 0; if (pushHistory) window.history.pushState({}, "", `/?lesson=${encodeURIComponent(key)}`); window.scrollTo(0, 0);
  }
  const restoreHistory = useEffectEvent(() => {
    const key = new URLSearchParams(location.search).get("lesson"), target = state && findLessonVersion(state, key);
    if (target) { if (selectionRef.current !== key) openLesson(target, false, false); }
    else { keepDraft(); selectionRef.current = null; setSelected(null); setCourse(null); setTab(overviewView(location.search, location.hash, history.state)); }
    setAnchor(savedInterestAnchor(location.hash));
  });
  useEffect(() => {
    void api<AppState>("state").then(s => { setState(s); restoreInitialLocation(s); }).catch(e => setError(e.message));
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const pop = () => restoreHistory();
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, [restoreInitialLocation]);
  useEffect(() => {
    if (!anchor || selected || tab !== "library") return;
    const target = document.getElementById(anchor);
    target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true });
  }, [anchor, selected, tab, state?.libraryItems.length]);
  function navigate(value: string) { keepDraft(); selectionRef.current = null; setSelected(null); setAnchor(null); setTab(value); setCourse(null); window.history.pushState({ tab: value }, "", value === "today" ? "/" : `/?view=${value}`); window.scrollTo(0, 0); void refresh().catch(e => setError(e.message)); }
  async function saveNote() {
    if (!selected || !note.trim()) return;
    const key = selected; setSaving(true);
    try {
      await api("notes", { id: noteId.current, key, kind: noteKind, text: note }); drafts.current.delete(key);
      if (selectionRef.current === key) { setNote(""); noteId.current = crypto.randomUUID(); }
      await refresh(); setNotice("Saved to your learning notes.");
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const lesson = state && findLessonVersion(state, selected), audioLesson = state && findLessonVersion(state, audioKey);
  const orderedCourses = state?.coursePreferences.map(p => state.courses.find(c => c.id === p.id)!).filter(Boolean) ?? [];
  const activeCourses = state?.coursePreferences.filter(c => c.active).map(c => c.id) ?? [];
  const completedIds = state ? completedLessonIds(state) : new Set<string>();
  const homeLesson = state ? selectHomeLesson(state, audioKey) : null;
  const updatedLessons = state?.lessons.filter(l => (activeCourses.includes(l.courseId) || l.courseId === "standalone") && hasUnreadUpdate(l, state)).slice(0, 3) ?? [];
  const reviewLessons = state ? completedVersions(allLessonVersions(state), state.progress).filter(l => {
    const latest = state.events.find(e => e.kind === "quiz" && e.payload.key === lessonKey(l));
    return !latest || !latest.payload.correct || state.asOf - latest.created_at > 7 * 86400_000;
  }).slice(0, 3) : [];
  const totalMinutes = Math.round((state?.activity.reduce((sum, a) => sum + a.seconds, 0) ?? 0) / 60);

  return <main className="app-shell">
    <a className="skip-link" href="#main-content">Skip to learning</a>
    <header className="site-header"><button className="wordmark" onClick={() => navigate("today")} aria-label="Interlude home"><span className="brand-mark" aria-hidden="true">i</span>Interlude<span className="private-label">PERSONAL LEARNING</span></button><div className="header-right"><span className="user-label">{displayName}</span><Button variant="ghost" size="icon" aria-label="Settings" onClick={() => navigate("settings")}><Settings2 /></Button></div></header>
    <Tabs value={tab} onValueChange={navigate} className="app-tabs">
      <TabsList className="main-nav" aria-label="Main navigation" variant="line"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="library">Your library</TabsTrigger><TabsTrigger value="activity">Your progress</TabsTrigger><TabsTrigger value="settings" className="sr-only">Settings</TabsTrigger></TabsList>
      {error && <div className="message error" role="alert"><span>{error}</span><Button variant="ghost" size="icon" aria-label="Dismiss error" onClick={() => setError("")}><X /></Button></div>}
      {notice && <div className="message" role="status"><span>{notice}</span><Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => setNotice("")}><X /></Button></div>}
      {!state ? <section className="loading" id="main-content"><LoaderCircle className="spin" aria-hidden="true" /><p>{error ? "Your library could not be loaded." : "Opening your learning space…"}</p>{error && <Button onClick={() => { setError(""); void refresh().then(restoreInitialLocation).catch(e => setError(e.message)); }}>Try again</Button>}</section> : <div className={lesson ? "reader-grid" : "overview-grid"}>
        <div id="main-content">
        {lesson ? <article className="lesson-reader">
          <Button variant="ghost" className="back-button" onClick={() => navigate("today")}><ArrowLeft aria-hidden="true" /> Back to your learning</Button>
          <p className="eyebrow">{lesson.courseId === "standalone" ? "STANDALONE LESSON" : `${state.courses.find(c => c.id === lesson.courseId)?.label} · LESSON ${lesson.order}`}</p>
          <h1>{lesson.title}</h1><p className="lesson-objective">{lesson.objective}</p><div className="lesson-meta"><span><Clock3 size={16} /> {lesson.minutes} min</span><span><BookOpen size={16} /> {lesson.sources.length} sources</span><span>Version {lesson.version}</span></div>
          <LessonHistory lesson={lesson} state={state} onOpen={openLesson} refresh={refresh} />
          {(state.progress.find(p => p.lesson_key === selected)?.section ?? 0) > 0 && <Button variant="outline" className="resume-reading" onClick={() => document.getElementById(`section-${state.progress.find(p => p.lesson_key === selected)?.section}`)?.scrollIntoView({ behavior: "instant" })}>Resume at your saved section <ArrowRight size={16} /></Button>}
          <div className="lesson-body">{lesson.sections.map((s, i) => <section key={s.title} data-section={i} id={`section-${i}`}><h2>{s.title}</h2>{s.paragraphs.map(p => <p key={p.slice(0, 40)}>{p}</p>)}{s.sources.length > 0 && <div className="section-sources">{s.sources.map(id => <a key={id} href={`#source-${id}`}>{lesson.sources.find(source => source.id === id)?.publisher}</a>)}</div>}</section>)}</div>
          <section className="takeaway"><p className="eyebrow">TAKE THIS WITH YOU</p><p>{lesson.takeaway}</p><Button variant="outline" onClick={async () => { try { await api("notes", { id: crypto.randomUUID(), key: selected, kind: "takeaway", text: lesson.takeaway }); await refresh(); setNotice("Takeaway saved."); } catch (e) { setError((e as Error).message); } }}><Bookmark aria-hidden="true" /> Save takeaway</Button></section>
          <section className="practice"><p className="eyebrow">A MOMENT TO REMEMBER · OPTIONAL</p><h2>{lesson.quiz.question}</h2><RadioGroup aria-label="Recall question" value={answer} onValueChange={value => { setAnswer(value); quizId.current = crypto.randomUUID(); }}>{lesson.quiz.options.map((option, i) => <label className="answer-option" key={option}><RadioGroupItem value={String(i)} />{option}</label>)}</RadioGroup><Button disabled={answer === "" || saving} onClick={async () => { setSaving(true); try { const key = selected, result = await api<{ correct: boolean; explanation: string }>("quiz", { id: quizId.current, key, answer: Number(answer) }); if (selectionRef.current === key) setQuiz(result); await refresh(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }}>Check understanding</Button>{quiz && <p className="quiz-feedback" role="status"><strong>{quiz.correct ? "That's right. " : "Something to revisit. "}</strong>{quiz.explanation}</p>}</section>
          <section className="practice"><Tabs value={noteKind} onValueChange={setNoteKind}><TabsList><TabsTrigger value="reflection">Reflect</TabsTrigger><TabsTrigger value="challenge">Apply it</TabsTrigger></TabsList><TabsContent value="reflection"><p className="reflection-prompt">{lesson.reflection}</p></TabsContent><TabsContent value="challenge"><p className="reflection-prompt">{lesson.challenge}</p></TabsContent><label htmlFor="reflection" className="small muted">Your note</label><Textarea id="reflection" value={note} onChange={e => { setNote(e.target.value); noteId.current = crypto.randomUUID(); }} disabled={saving} placeholder="A thought worth keeping…" maxLength={5000} /><Button disabled={!note.trim() || saving} onClick={saveNote}>{saving ? "Saving…" : "Save note"}</Button><SpokenInput key={`${selected}:${noteKind}`} lessonKey={selected!} purpose={noteKind === "challenge" ? "challenge" : "reflection"} state={state} disabled={saving} maxLength={5000} refresh={refresh} onText={spoken => { const combined = [note.trim(), spoken].filter(Boolean).join("\n"); if (combined.length > 5000) throw new Error("Shorten your note or transcript so the combined draft fits 5,000 characters."); setNote(combined); noteId.current = crypto.randomUUID(); }} /></Tabs></section>
          <LessonQuestions key={selected} lesson={lesson} state={state} refresh={refresh} />
          <LessonSupplements key={`supplements:${selected}`} lessonKey={selected!} state={state} refresh={refresh} onOpenChange={supplementPresence} />
          <section className="sources"><h2>Sources & further reading</h2><p className="muted small">The lesson is self-contained. Original sources are optional.</p>{lesson.sources.map(s => <div className="source" id={`source-${s.id}`} key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title} <span aria-hidden="true">↗</span></a><p>{s.publisher} · Checked {s.inspected}</p><p className="small">{s.supports}</p></div>)}<p className="small muted">{lesson.review}</p></section>
          <div className="lesson-end"><h2>A good place to pause.</h2><p>Your notes and place are saved as you go.</p><Button onClick={async () => { const saved = await saveProgress(selected!, undefined, true, lesson.sections.length - 1); if (saved) setNotice("Lesson completed. Come back when you have another moment."); }}><Check aria-hidden="true" /> {state.progress.some(p => p.lesson_key === selected && p.completed) ? "Lesson completed" : "Mark lesson complete"}</Button></div>
        </article> : <>
          <TabsContent value="today"><div className="page-title"><p className="eyebrow">MAKE ROOM FOR CURIOSITY</p><h1>Your next five minutes</h1><p className="muted">Pick up a thought. Take it a little further.</p></div><div className="today-panels"><div className="today-grid"><HomeLessonCard choice={homeLesson} courses={state.courses} onOpen={target => openLesson(target, lessonKey(target) === audioKey)} onExplore={() => navigate("library")} /><section className="quiet-card"><span className="icon-badge"><Sparkles size={22} aria-hidden="true" /></span><p className="eyebrow">SMALL MOMENTS, OVER TIME</p><h2>{totalMinutes ? `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"} of curiosity` : "Your first chapter awaits"}</h2><p>{totalMinutes ? "Every thoughtful pause adds to your learning history." : "One clear idea is enough for today. Your progress will grow here as you learn."}</p><Button variant="ghost" onClick={() => navigate("activity")}>View your progress <ArrowRight size={16} /></Button></section></div>{updatedLessons.length > 0 && <section className="settings-card"><p className="eyebrow">LESSON UPDATES</p><h2>A new version to explore</h2><p className="muted">Your earlier completions still count. Open an update when you want to see what changed.</p>{updatedLessons.map(l => <Button variant="ghost" className="update-link" key={lessonKey(l)} onClick={() => openLesson(l)}>{l.title} · v{l.version}<ArrowRight size={16} /></Button>)}</section>}{reviewLessons.length > 0 && <section className="settings-card"><p className="eyebrow">A SMALL REVIEW</p><h2>What stayed with you?</h2><p className="muted">Revisit a completed idea. Recall is separate from finishing a lesson.</p>{reviewLessons.map(l => <Button variant="ghost" key={lessonKey(l)} onClick={() => openLesson(l)}>{l.title}<ArrowRight size={16} /></Button>)}</section>}<WeeklySuggestions state={state} refresh={refresh} onOpen={openLesson} /></div><div className="section-heading"><h2>Your learning paths</h2><Button variant="ghost" onClick={() => navigate("library")}>View library <ArrowRight size={16} /></Button></div><div className="course-grid">{orderedCourses.map(c => <CourseCard key={c.id} course={c} state={state} onOpen={() => { navigate("library"); setCourse(c.id); }} />)}</div></TabsContent>
          <TabsContent value="library"><div className="page-title"><p className="eyebrow">FOLLOW YOUR CURIOSITY</p><h1>Your library</h1><p className="muted">A few paths to follow, at your own pace.</p></div>{course ? <><Button variant="ghost" onClick={() => setCourse(null)}><ArrowLeft /> All courses</Button><h2 className="course-title">{state.courses.find(c => c.id === course)?.title}</h2><ol className="lesson-list">{state.courses.find(c => c.id === course)?.lessons.map((title, i) => { const available = state.lessons.find(l => l.courseId === course && l.order === i + 1); return <li key={title}><span className="lesson-number">{String(i + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p className="small muted">{available ? `About 5 minutes · sources included${hasUnreadUpdate(available, state) ? " · Update unread" : completedIds.has(available.id) ? " · Completed" : ""}` : "In preparation"}</p></div>{available ? <Button variant="outline" onClick={() => openLesson(available)}>Open <ArrowRight size={16} /></Button> : <span className="small muted">Coming next</span>}</li>; })}</ol></> : <div className="course-grid">{orderedCourses.map(c => <CourseCard key={c.id} course={c} state={state} onOpen={() => setCourse(c.id)} />)}</div>}<StandaloneLessons state={state} onOpen={openLesson} /><ListeningQueue state={state} refresh={refresh} onError={setError} onOpen={keys => { const first = state.lessons.find(l => lessonKey(l) === keys[0]); if (first) { openLesson(first); setQueue(keys.slice(1)); } }} /><LibraryTools state={state} refresh={refresh} onOpen={openLesson} onError={setError} /></TabsContent>
          <TabsContent value="activity"><div className="page-title"><p className="eyebrow">YOUR LEARNING, OVER TIME</p><h1>Small moments add up</h1></div><div className="stats"><div><strong>{totalMinutes}</strong><span>learning minutes</span></div><div><strong>{completedIds.size}</strong><span>lessons completed</span></div><div><strong>{state.notes.length}</strong><span>thoughts saved</span></div></div><div className="learning-evidence"><p><strong>{state.events.filter(e => e.kind === "quiz" && e.payload.correct).length}</strong> successful recall checks</p><p><strong>{state.notes.filter(n => n.kind === "challenge").length}</strong> application notes</p><p><strong>{state.events.filter(e => e.kind === "supplement").length}</strong> optional media marked complete · manual</p><p className="small muted">Finishing, remembering, and applying are separate parts of learning.</p></div><ActivityCalendar activity={state.activity} /><div className="section-heading"><h2>Your saved thoughts</h2></div>{state.notes.length ? <div className="notes-list">{state.notes.map(n => { const origin = findLessonVersion(state, n.lesson_key); return <div className="saved-note" key={n.id}><span className="eyebrow">{n.kind}</span><p>{n.text}</p><span className="muted small">{new Date(n.created_at).toLocaleDateString()}</span>{origin && <Button variant="ghost" className="note-context" onClick={() => openLesson(origin)}>{origin.title} · v{origin.version}<ArrowRight size={16} aria-hidden="true" /></Button>}</div>; })}</div> : <div className="empty-note"><Bookmark aria-hidden="true" /><h3>A place for what stays with you</h3><p>Save a takeaway or reflection from a lesson. It will be waiting here.</p></div>}</TabsContent>
          <TabsContent value="settings"><div className="page-title"><p className="eyebrow">YOUR SPACE</p><h1>Settings & usage</h1></div><section className="settings-card"><h2>OpenAI API allowance</h2><p className="budget-number">${(state.budget.committed / 1_000_000).toFixed(2)} <span>of ${(state.budget.limit / 1_000_000).toFixed(2)}</span></p><p className="muted">{state.budget.month} · Includes held, accounted, and confirmed request costs. Saved lessons remain available when new generation pauses.</p><p className="small muted">Audio storage: {(state.storage.committed / 1_000_000).toFixed(1)} MB reserved or stored, within a {state.storage.limit / 1_000_000_000} GB limit.</p><p className="small">{state.aiConfigured ? "AI services are configured." : "AI services are awaiting secure credential setup."}</p></section><ChirpSettings state={state} refresh={refresh} /><WeeklyRefreshPanel state={state} refresh={refresh} /><GenerationUsage state={state} refresh={refresh} /><section className="settings-card"><h2>Your learning belongs to you</h2><p className="muted">Download your lessons, progress, activity, and saved notes.</p><Button asChild variant="outline"><a href="/api/export" download="interlude-learning.json"><Download aria-hidden="true" /> Export learning history</a></Button></section><section className="settings-card"><h2>Install on your iPhone</h2><p className="muted">Open this app in Safari, use Share, then Add to Home Screen.</p><a className="text-link" href="/signout-with-chatgpt?return_to=/">Sign out</a></section></TabsContent>
        </>}
        </div>
        {audioLesson && <AudioPlayer lesson={audioLesson} remaining={queue.length} onNext={() => { if (queue.length) { const nextTrack = findLessonVersion(state, queue[0]); if (selected && nextTrack) openLesson(nextTrack, true); else setAudioKey(queue[0]); setQueue(q => q.slice(1)); } }} onClose={() => { setAudioKey(null); setQueue([]); }} onOpen={() => openLesson(audioLesson, true)} compact={!lesson} ready={state.media.some(m => m.lesson_key === lessonKey(audioLesson))} configured={narrationAvailable(state)} initialPosition={state.progress.find(p => p.lesson_key === lessonKey(audioLesson))?.position ?? 0} onGenerate={async () => { await api("narrate", { key: lessonKey(audioLesson) }); await refresh(); setNotice("Narration is ready. Tap Play to start listening."); }} onPosition={(key, position, complete) => saveProgress(key, position, complete)} onActivity={(key, start, end) => reportActivity(key, start, end, "audio")} onError={setError} />}
      </div>}
    </Tabs>
    <footer className="site-footer"><span>Interlude · A space to learn</span><span>Private to you</span></footer>
  </main>;
}

function CourseCard({ course, state, onOpen }: { course: Course; state: AppState; onOpen: () => void }) {
  const completedIds = completedLessonIds(state);
  const completed = state.lessons.filter(l => l.courseId === course.id && completedIds.has(l.id)).length;
  const ready = state.lessons.filter(l => l.courseId === course.id).length;
  return <button className={`course-card ${course.color}`} onClick={onOpen}><span className="eyebrow">{course.label}</span><h3>{course.title}</h3><p>{course.description}</p><div className="course-progress"><span>{completed} / {course.lessons.length} complete</span><ArrowRight size={18} aria-hidden="true" /></div><ProgressBar className="progress-track" value={completed / course.lessons.length * 100} aria-label={`${course.title} completion`} /><span className="small muted">{!state.coursePreferences.find(p => p.id === course.id)?.active && "Paused · "}{ready ? `${ready} lesson${ready === 1 ? "" : "s"} ready` : "Course in preparation"}</span></button>;
}
function ActivityCalendar({ activity }: { activity: AppState["activity"] }) {
  const totals = new Map<string, number>(); for (const entry of activity) { const key = dayKey(new Date(entry.minute * 1000)); totals.set(key, (totals.get(key) ?? 0) + entry.seconds); }
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Array.from({ length: 84 }, (_, i) => { const date = new Date(today); date.setDate(date.getDate() - 83 + i); return { date, seconds: totals.get(dayKey(date)) ?? 0 }; });
  return <section className="calendar-card"><div className="section-heading"><h2>Your learning rhythm</h2><span className="small muted">Last 12 weeks</span></div><div className="heatmap" aria-label="Learning activity by day">{days.map(({ date, seconds }) => <div key={dayKey(date)} className={`heat-cell level-${seconds ? Math.min(4, Math.ceil(seconds / 300)) : 0}`} title={`${date.toLocaleDateString()}: ${Math.round(seconds / 60)} learning minutes`} role="img" aria-label={`${date.toLocaleDateString()}: ${Math.round(seconds / 60)} learning minutes`} />)}</div><div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map(n => <span key={n} className={`heat-cell level-${n}`} />)}<span>More</span></div><p className="muted small">Estimated active reading and listening. Pauses and browsing do not count.</p><details><summary>View activity as text</summary><ul>{days.filter(d => d.seconds).length ? days.filter(d => d.seconds).map(d => <li key={dayKey(d.date)}>{d.date.toLocaleDateString()}: {Math.round(d.seconds / 60)} minutes</li>) : <li>No learning activity recorded yet.</li>}</ul></details></section>;
}
