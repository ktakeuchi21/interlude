"use client";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowRight, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client";
import { lessonKey, type Lesson } from "@/lib/content";
import type { AppState, CoursePreference, LibraryItem } from "@/lib/contracts";
import { SourceReader } from "./source-reader";
import { TopicResearch } from "./topic-research";

type Props = { state: AppState; refresh: () => Promise<unknown>; onOpen: (lesson: Lesson) => void; onError: (message: string) => void };
export function LibraryTools({ state, refresh, onOpen, onError }: Props) {
  const requestId = useRef(crypto.randomUUID());
  const [query, setQuery] = useState(""), [kind, setKind] = useState("topic"), [title, setTitle] = useState(""), [url, setUrl] = useState(""), [detail, setDetail] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function saveCourses(courses: CoursePreference[]) {
    setBusy(true);
    try { await api("courses", { courses }); await refresh(); }
    catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  function move(index: number, direction: number) {
    const list = [...state.coursePreferences];
    [list[index], list[index + direction]] = [list[index + direction], list[index]];
    void saveCourses(list);
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      await api("library", { id: requestId.current, kind, title, ...(kind === "source" ? { url } : {}), detail });
      await refresh(); requestId.current = crypto.randomUUID(); setTitle(""); setUrl(""); setDetail("");
      setMessage(kind === "source" ? "Source saved. It has not been reviewed or turned into a lesson yet." : "Topic saved for research. No generation charge was made.");
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  const matches = query.trim() ? state.lessons.filter(l => `${l.title} ${l.objective} ${l.takeaway}`.toLowerCase().includes(query.toLowerCase())) : [];
  function itemStatus(item: LibraryItem) {
    if (!item.refresh_of) return `${item.kind} · ${item.status}`;
    const preparation = state.lessonPreparations.find(p => p.topic_id === item.id);
    let status = "requested";
    if (preparation && state.releases.some(r => r.review?.preparationId === preparation.id)) status = "version saved";
    else if (preparation?.review) status = preparation.review.value.decision === "ready" ? "ready to save" : preparation.review.value.decision === "needs_sources" ? "needs evidence" : "needs revision";
    else if (preparation?.draft) status = "draft saved";
    else if (preparation?.inspection?.value.update) status = { unchanged: "no material change", update: "change identified", needs_sources: "needs evidence" }[preparation.inspection.value.update.decision];
    return `update check · ${status}`;
  }
  return <div className="library-tools">
    <section className="settings-card"><h2>Find an idea</h2><label htmlFor="library-search" className="small muted">Search your ready lessons</label><Input id="library-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Try inference, evidence, or product…" type="search" />{query.trim() && <div className="search-results" aria-live="polite">{matches.length ? matches.map(l => <Button variant="ghost" key={lessonKey(l)} onClick={() => onOpen(l)}>{l.title}<ArrowRight size={16} /></Button>) : <p className="muted">No ready lesson matches yet. Save it as a topic below.</p>}</div>}</section>
    <section className="settings-card"><h2>Choose your focus</h2><p className="muted">Active courses guide your next lesson. Paused courses keep all their progress.</p><ol className="manage-courses">{state.coursePreferences.map((p, i) => <li key={p.id}><div><strong>{state.courses.find(c => c.id === p.id)?.title}</strong><span className="small muted">{p.active ? "Active" : "Paused"}</span></div><div className="course-actions"><Button variant="outline" disabled={busy} onClick={() => saveCourses(state.coursePreferences.map(c => c.id === p.id ? { ...c, active: !c.active } : c))}>{p.active ? "Pause" : "Activate"}</Button><Button variant="ghost" size="icon" disabled={busy || i === 0} aria-label={`Move ${state.courses.find(c => c.id === p.id)?.title} earlier`} onClick={() => move(i, -1)}><ArrowUp /></Button><Button variant="ghost" size="icon" disabled={busy || i === state.coursePreferences.length - 1} aria-label={`Move ${state.courses.find(c => c.id === p.id)?.title} later`} onClick={() => move(i, 1)}><ArrowDown /></Button></div></li>)}</ol></section>
    <section className="settings-card"><h2>Keep a thread of curiosity</h2><Tabs value={kind} onValueChange={value => { setKind(value); requestId.current = crypto.randomUUID(); }}><TabsList><TabsTrigger value="topic" disabled={busy}>Request a topic</TabsTrigger><TabsTrigger value="source" disabled={busy}>Save a source</TabsTrigger></TabsList><TabsContent value={kind}><form className="library-form" onSubmit={e => { e.preventDefault(); void save(); }}><label htmlFor="item-title">{kind === "topic" ? "What would you like to understand?" : "Source title"}</label><Input id="item-title" value={title} onChange={e => { setTitle(e.target.value); requestId.current = crypto.randomUUID(); }} required minLength={3} maxLength={200} disabled={busy} placeholder={kind === "topic" ? "How AI inference works" : "A useful article or episode"} />{kind === "source" && <><label htmlFor="item-url">Public source link</label><Input id="item-url" type="url" value={url} onChange={e => { setUrl(e.target.value); requestId.current = crypto.randomUUID(); }} placeholder="https://…" required disabled={busy} /></>}<label htmlFor="item-detail">Why it interests you <span className="muted">(optional)</span></label><Textarea id="item-detail" value={detail} onChange={e => { setDetail(e.target.value); requestId.current = crypto.randomUUID(); }} maxLength={2000} disabled={busy} /><Button type="submit" disabled={busy || title.trim().length < 3}>{kind === "topic" ? <Plus /> : <Link2 />}{busy ? "Saving…" : kind === "topic" ? "Save topic" : "Save source"}</Button></form></TabsContent></Tabs><p className="muted small">Research a saved topic, then prepare a lesson from two retrieved sources. Add a checked draft to your library when it is ready. Weekly refresh runs through Codex; see Settings for the latest delivery.</p>{message && <p role="status">{message}</p>}</section>
    {state.libraryItems.length > 0 && <section className="settings-card"><h2>Your saved interests</h2><p className="small muted">{state.researchAllowance.thisMonth} / {state.researchAllowance.monthlyLimit} topic searches · {state.sourceAllowance.thisMonth} / {state.sourceAllowance.monthlyLimit} source retrievals this month · {state.sourceAllowance.retained} / {state.sourceAllowance.limit} retained records</p><ul className="saved-interests">{state.libraryItems.map(item => <li key={item.id} id={`saved-interest-${item.id}`} tabIndex={-1}><span className="eyebrow">{itemStatus(item)}</span><h3>{item.title}</h3>{item.detail && <p>{item.detail}</p>}{item.url && <a className="text-link" href={item.url} target="_blank" rel="noreferrer">Open original source ↗</a>}{item.kind === "source" ? <SourceReader item={item} state={state} refresh={refresh} /> : <TopicResearch item={item} state={state} refresh={refresh} onOpen={onOpen} />}</li>)}</ul></section>}
  </div>;
}
