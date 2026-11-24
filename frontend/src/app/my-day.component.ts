import { Component, ElementRef, Input, ViewChild, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AppComponent, Priority, Task, TaskStatus } from './app.component';
import { compareTaskStack } from './date-utils';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

export type DrawerStatusFilter = 'OPEN' | 'ALL' | TaskStatus;

let supportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === 'undefined' || !window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return typeof window !== 'undefined' && !!window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();
}

@Component({
  selector: 'app-my-day',
  standalone: true,
  imports: [FormsModule, SkeletonModule, TooltipModule],
  templateUrl: './my-day.component.html'
})
export class MyDayComponent {
  @Input({ required: true }) app!: AppComponent;
  @ViewChild('assigneeDialog') assigneeDialog?: ElementRef<HTMLDialogElement>;

  agendaPriorityFilter = signal<'ALL' | Priority>('ALL');
  expandedAgendaGroupKey = signal<string | null>(null);
  highOpenCount = computed(() => this.app.activeTasks().filter(t => t.priority === 'HIGH').length);
  dailyProgressPct = computed(() => {
    const total = this.app.todayActiveCount() + this.app.completedTodayCount();
    return total ? Math.round((this.app.completedTodayCount() * 100) / total) : 0;
  });

  // Assignee drawer local filters (reset when opening a new assignee).
  drawerSearch = signal('');
  drawerStatus = signal<DrawerStatusFilter>('OPEN');
  drawerPriority = signal<'ALL' | Priority>('ALL');
  expandedNoteIds = signal<Set<number>>(new Set());

  private returnToAssignee: number | 'ALL' | null = null;
  private editWasOpen = false;
  private pressedOutsideBackdrop = false;

  selectedAssigneeId = signal<number | 'ALL' | null>(null);
  selectedAssignee = computed(() => {
    const id = this.selectedAssigneeId();
    if (id === null) return null;
    const groups = this.app.assignedToSummary();
    if (id !== 'ALL') return groups.find(group => group.recipientId === id) ?? null;
    const today = this.app.todayIso();
    return {
      recipientId: null,
      name: 'All Assigned Tasks',
      openCount: groups.reduce((sum, g) => sum + g.openCount, 0),
      tasks: groups.flatMap(g => g.tasks).sort((a, b) => compareTaskStack(a, b, today))
    };
  });

  drawerStatusTasks = computed(() => {
    const group = this.selectedAssignee();
    if (!group) return [];
    const status = this.drawerStatus();
    if (status === 'ALL') return group.tasks;
    if (status === 'OPEN') return group.tasks.filter(t => t.status === 'ACTIVE' || t.status === 'IN_PROGRESS');
    return group.tasks.filter(t => t.status === status);
  });

  drawerTasks = computed(() => {
    const q = this.drawerSearch().trim().toLowerCase();
    const prio = this.drawerPriority();
    const isAll = this.selectedAssigneeId() === 'ALL';
    return this.drawerStatusTasks().filter(t =>
      (prio === 'ALL' || t.priority === prio) &&
      (!q || t.title.toLowerCase().includes(q)
        || (t.category ?? '').toLowerCase().includes(q)
        || (t.notes ?? '').toLowerCase().includes(q)
        || (isAll && this.app.assignmentLabel(t).toLowerCase().includes(q))));
  });

  constructor() {
    // Reopen the assignee drawer with its filters intact after finishing a task edit.
    effect(() => {
      const open = this.app?.editDialogOpen();
      if (this.editWasOpen && !open && this.returnToAssignee !== null) {
        const target = this.returnToAssignee;
        this.returnToAssignee = null;
        this.selectedAssigneeId.set(target);
        if (this.selectedAssignee()) {
          const dialog = this.assigneeDialog?.nativeElement;
          if (dialog && !dialog.open) dialog.showModal();
        } else {
          this.selectedAssigneeId.set(null);
        }
      }
      this.editWasOpen = !!open;
    });
  }

  openAssignee(recipientId: number | 'ALL'): void {
    this.returnToAssignee = null;
    this.selectedAssigneeId.set(recipientId);
    const group = this.selectedAssignee();
    this.drawerSearch.set('');
    this.drawerStatus.set(group && group.openCount === 0 ? 'ALL' : 'OPEN');
    this.drawerPriority.set('ALL');
    this.expandedNoteIds.set(new Set());
    const dialog = this.assigneeDialog?.nativeElement;
    if (dialog) {
      dialog.removeAttribute('data-closing');
      if (!dialog.open) dialog.showModal();
    }
  }

  async closeAssignee(): Promise<void> {
    this.returnToAssignee = null;
    const dialog = this.assigneeDialog?.nativeElement;
    if (!dialog || !dialog.open) return;
    if (!supportsTopLayerExit()) {
      dialog.setAttribute('data-closing', '');
      const animations = dialog.getAnimations({ subtree: true });
      if (animations.length > 0) {
        await Promise.race([
          Promise.allSettled(animations.map(a => a.finished)),
          new Promise(r => setTimeout(r, 400))
        ]);
      }
      if (!dialog.hasAttribute('data-closing')) return;
      dialog.removeAttribute('data-closing');
    }
    if (dialog.open) dialog.close();
  }

  onDialogCancel(event: Event): void {
    if (!supportsTopLayerExit()) {
      event.preventDefault();
      void this.closeAssignee();
    }
  }

  onDialogClose(): void {
    if (this.returnToAssignee !== null) return;
    this.selectedAssigneeId.set(null);
  }

  // Fallback for Safari where native <dialog closedby="any"> is not yet supported.
  onDialogPointerDown(event: PointerEvent): void {
    if (typeof HTMLDialogElement === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) return;
    const dialog = this.assigneeDialog?.nativeElement;
    this.pressedOutsideBackdrop = !!dialog && this.isOutsideDialog(event, dialog);
  }

  onDialogPointerUp(event: PointerEvent): void {
    if (typeof HTMLDialogElement === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) return;
    const dialog = this.assigneeDialog?.nativeElement;
    const outside = !!dialog && this.isOutsideDialog(event, dialog);
    const shouldClose = this.pressedOutsideBackdrop && outside;
    this.pressedOutsideBackdrop = false;
    if (shouldClose) void this.closeAssignee();
  }

  private isOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
    const r = dialog.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }

  editFromDrawer(task: Task): void {
    if (!this.app.canEdit(task)) return;
    this.returnToAssignee = this.selectedAssigneeId();
    const dialog = this.assigneeDialog?.nativeElement;
    if (dialog?.open) dialog.close();
    this.app.openEdit(task);
  }

  resetDrawerFilters(): void {
    this.drawerSearch.set('');
    this.drawerStatus.set('ALL');
    this.drawerPriority.set('ALL');
  }

  toggleNoteExpanded(taskId: number): void {
    this.expandedNoteIds.update(set => {
      const next = new Set(set);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  filteredAgendaTasks(tasks: Task[]): Task[] {
    const prio = this.agendaPriorityFilter();
    return prio === 'ALL' ? tasks : tasks.filter(t => t.priority === prio);
  }

  toggleAgendaGroup(key: string): void {
    this.expandedAgendaGroupKey.update(current => current === key ? null : key);
  }

  agendaGroups(tasks: Task[]): { key: string; name: string; tasks: Task[] }[] {
    if (this.app.selectedDate() !== this.app.todayIso()) return [{ key: 'date', name: '', tasks }];
    const groups = new Map<string, { key: string; name: string; tasks: Task[] }>();
    for (const task of tasks) {
      const isSelf = task.userId === this.app.userId() && !task.assignedByName;
      const key = isSelf ? 'self' : task.userId === this.app.userId() ? `by:${task.assignedByName}` : `user:${task.userId}`;
      let group = groups.get(key);
      if (!group) {
        const assignment = this.app.assignmentLabel(task);
        group = { key, name: isSelf ? 'Myself' : assignment.replace(/^Assigned by /, '') || task.assignedByName || task.userId, tasks: [] };
        groups.set(key, group);
      }
      group.tasks.push(task);
    }
    return [...groups.values()].sort((a, b) =>
      a.key === 'self' ? -1 : b.key === 'self' ? 1 : (b.tasks.length - a.tasks.length) || a.name.localeCompare(b.name));
  }

  countByPriority(tasks: Task[], prio: Priority): number {
    return tasks.filter(t => t.priority === prio).length;
  }

  countByStatus(tasks: Task[], status: TaskStatus): number {
    return tasks.filter(t => t.status === status).length;
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
