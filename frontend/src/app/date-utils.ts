export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type WorkspaceTab = 'my-day' | 'my-tasks' | 'kanban';
export const WORKSPACE_TABS: readonly WorkspaceTab[] = ['my-day', 'my-tasks', 'kanban'];

export function resolveNavPrefs(
  rawDefault?: string | null,
  rawVisible?: string | null,
  rawLabels?: string | null
): { defaultTab: WorkspaceTab; visibleTabs: WorkspaceTab[]; showLabels: boolean } {
  const parsedVisible = (rawVisible ?? '')
    .split(',')
    .map(s => s.trim() as WorkspaceTab)
    .filter((t): t is WorkspaceTab => WORKSPACE_TABS.includes(t));
  const visibleTabs: WorkspaceTab[] = parsedVisible.length > 0
    ? WORKSPACE_TABS.filter(t => parsedVisible.includes(t))
    : [...WORKSPACE_TABS];
  const candidate = (rawDefault ?? '').trim() as WorkspaceTab;
  const defaultTab: WorkspaceTab = visibleTabs.includes(candidate) ? candidate : visibleTabs[0];
  return { defaultTab, visibleTabs, showLabels: rawLabels !== 'logo-only' };
}

export interface StackableTask {
  status: string;
  priority: Priority;
  focusDate?: string | null;
}

const PRIO_RANK: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function plannerTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function taskOnDate(task: { status: string; completedAt?: string | null; updatedAt: string }, date: string, today: string): boolean {
  if (task.status !== 'COMPLETED') return date === today;
  return plannerTodayIso(new Date(task.completedAt || task.updatedAt)) === date;
}

export function monthGridSize(year: number, month: number): number {
  const mondayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return Math.ceil((mondayOffset + new Date(year, month, 0).getDate()) / 7) * 7;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

export function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

// Stack order: Completed last -> Focused first -> HIGH -> MEDIUM -> LOW.
export function compareTaskStack(a: StackableTask, b: StackableTask, focusDateIso: string): number {
  const aDone = a.status === 'COMPLETED' ? 1 : 0;
  const bDone = b.status === 'COMPLETED' ? 1 : 0;
  if (aDone !== bDone) return aDone - bDone;

  const aFocused = a.status !== 'COMPLETED' && a.focusDate === focusDateIso ? 0 : 1;
  const bFocused = b.status !== 'COMPLETED' && b.focusDate === focusDateIso ? 0 : 1;
  if (aFocused !== bFocused) return aFocused - bFocused;

  const prioDiff = (PRIO_RANK[a.priority] ?? 2) - (PRIO_RANK[b.priority] ?? 2);
  if (prioDiff !== 0) return prioDiff;

  return 0;
}

export function parseSmartOmnibar(raw: string, fallbackPriority: Priority) {
  let title = raw;
  let priority: Priority = fallbackPriority;
  let category = '';
  let pinFocus = false;

  if (/(^|\s)!(high|urgent)\b/i.test(title)) {
    priority = 'HIGH';
    title = title.replace(/(^|\s)!(high|urgent)\b/gi, '$1');
  } else if (/(^|\s)!medium\b/i.test(title)) {
    priority = 'MEDIUM';
    title = title.replace(/(^|\s)!medium\b/gi, '$1');
  } else if (/(^|\s)!low\b/i.test(title)) {
    priority = 'LOW';
    title = title.replace(/(^|\s)!low\b/gi, '$1');
  }

  if (/(^|\s)\*focus\b/i.test(title)) {
    pinFocus = true;
    title = title.replace(/(^|\s)\*focus\b/gi, '$1');
  }

  const catMatch = title.match(/(?:^|\s)#([A-Za-z0-9_&-]+)/);
  if (catMatch) {
    category = catMatch[1].replace(/-/g, ' ');
    title = title.replace(catMatch[0], '');
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    priority,
    category,
    pinFocus
  };
}
