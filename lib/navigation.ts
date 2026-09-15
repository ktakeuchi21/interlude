export type OverviewView = "today" | "library" | "activity" | "settings";
const views: OverviewView[] = ["today", "library", "activity", "settings"];
export function savedInterestAnchor(hash: string) { return /^#saved-interest-[a-f0-9-]{36}$/i.test(hash) ? hash.slice(1) : null; }
export function overviewView(search: string, hash: string, historyState?: { tab?: unknown } | null): OverviewView {
  const requested = new URLSearchParams(search).get("view");
  if (views.includes(requested as OverviewView)) return requested as OverviewView;
  if (savedInterestAnchor(hash)) return "library";
  if (views.includes(historyState?.tab as OverviewView)) return historyState!.tab as OverviewView;
  return "today";
}
