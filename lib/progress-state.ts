import type { Progress } from "./contracts";
export function mergeProgress(current: Progress[], incoming: Progress[]) {
  const merged = new Map(current.map(p => [p.lesson_key, p]));
  for (const progress of incoming) {
    if (progress.revision >= (merged.get(progress.lesson_key)?.revision ?? 0)) merged.set(progress.lesson_key, progress);
  }
  return [...merged.values()];
}
