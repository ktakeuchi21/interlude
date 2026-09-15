"use client";
import { useState } from "react";
import { ArrowRight, Check, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import type { AppState } from "@/lib/contracts";
import type { Lesson } from "@/lib/content";
import { findLessonVersion } from "@/lib/lesson-history";
import { learningWeek, type WeeklySuggestion } from "@/lib/weekly-selection";
import { api } from "@/lib/client";

export function WeeklySuggestions({ state, refresh, onOpen }: { state: AppState; refresh: () => Promise<AppState>; onOpen: (lesson: Lesson) => void }) {
  const [selectedWeek, setSelectedWeek] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const week = learningWeek(state.asOf), history = state.weekly?.batches ?? [], choices = state.weekly?.choices ?? [];
  const current = history.find(b => b.week === week), batch = history.find(b => b.week === selectedWeek) ?? current ?? history[0];
  const date = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  async function act(action: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function choose(item: WeeklySuggestion, dismissed: boolean) {
    const choice = choices.find(c => c.week === batch.week && c.item_id === item.id);
    await api("choose-weekly", { week: batch.week, itemId: item.id, dismissed, revision: choice?.revision ?? 0 }); await refresh();
  }
  return <section className="settings-card weekly-suggestions" aria-labelledby="weekly-heading">
    <p className="eyebrow">A FEW IDEAS FOR THE WEEK</p><h2 id="weekly-heading">Follow a thread of curiosity</h2>
    <p className="muted">Up to three suggestions from your courses, saved interests, and recall history. There is no need to finish them all.</p>
    <p className="small muted">Weekly sets are prepared through Codex on your laptop. You can also prepare a set here; selecting suggestions uses no paid AI.</p>
    {!current && <Button variant="outline" disabled={busy} onClick={() => void act(async () => { await api("prepare-weekly", {}); const next = await refresh(); setSelectedWeek(learningWeek(next.asOf)); setNotice("Your weekly set is saved. No generation charge was made."); })}>{busy ? "Preparing…" : "Prepare this week’s suggestions"}</Button>}
    {history.length > 1 && <div className="weekly-history small"><label htmlFor="weekly-history">Saved weekly sets</label><select id="weekly-history" value={batch?.week ?? ""} onChange={e => setSelectedWeek(e.target.value)} disabled={busy}>{history.map(b => <option value={b.week} key={b.week}>Week of {date(b.week)}</option>)}</select></div>}
    {batch && <><p className="small muted">Week of {date(batch.week)} · saved {new Date(batch.created_at).toLocaleDateString()} · Monday–Sunday UTC</p>
      {batch.items.length === 0 ? <p>Nothing to suggest from your current learning yet. Activate a course or save a topic for a future set.</p> : <ol className="weekly-list">{batch.items.map(item => {
        const choice = choices.find(c => c.week === batch.week && c.item_id === item.id), dismissed = Boolean(choice?.dismissed);
        const lesson = item.lessonKey ? findLessonVersion(state, item.lessonKey) : undefined, libraryId = item.libraryItemId ?? item.topicId, saved = libraryId ? state.libraryItems.some(i => i.id === libraryId) : false;
        return <li key={item.id} className={dismissed ? "weekly-dismissed" : ""}>
          <p className="eyebrow">{item.kind === "review" ? "REVISIT" : item.kind === "lesson" ? "KEEP LEARNING" : item.kind === "topic" ? "A QUESTION TO EXPLORE · NOT RESEARCHED" : "FROM YOUR SAVED INTERESTS"}</p>
          <h3>{item.title}</h3><p className="small muted">{item.reason}</p>
          {dismissed ? <div className="weekly-actions"><span className="small">Set aside for this week.</span><Button variant="ghost" disabled={busy} onClick={() => void act(() => choose(item, false))}><Undo2 />Restore suggestion</Button></div> : <div className="weekly-actions">
            {lesson ? <Button variant="outline" onClick={() => onOpen(lesson)}>{item.kind === "review" ? "Revisit lesson" : "Open lesson"}<ArrowRight /></Button> : saved ? <a className="text-link" href={`/?view=library#saved-interest-${libraryId}`}>Open saved interest <ArrowRight size={16} /></a> : item.kind === "topic" ? <Button variant="outline" disabled={busy} onClick={() => void act(async () => { await api("save-weekly-topic", { week: batch.week, itemId: item.id }); await refresh(); setNotice("Topic saved for research. No lesson or narration has been generated."); })}><Check />Save topic for research</Button> : <span className="small muted">This saved item is currently unavailable.</span>}
            <Button variant="ghost" disabled={busy} onClick={() => void act(() => choose(item, true))}>Not this week</Button>
          </div>}
        </li>;
      })}</ol>}
      <p className="small muted">This set stays the same across reloads and devices. New selections wait until another week; your choices help avoid repeats.</p>
    </>}
    {notice && <p className="small" role="status">{notice}</p>}{error && <p className="question-error" role="alert">{error}</p>}
  </section>;
}
