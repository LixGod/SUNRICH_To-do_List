import { ApplicationRef, Component, HostListener, OnDestroy, OnInit, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, forkJoin, of } from 'rxjs';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Priority, WORKSPACE_TABS, WorkspaceTab, addDaysIso, addMonthsIso, compareTaskStack, localIsoDate, monthGridSize, parseSmartOmnibar, plannerTodayIso, resolveNavPrefs, taskOnDate } from './date-utils';
import { AdminComponent } from './admin/admin.component';
import { EmployeePickerComponent } from './employee-picker.component';
import { MyDayComponent } from './my-day.component';
import { MyTasksComponent } from './my-tasks.component';
import { KanbanComponent } from './kanban.component';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { PasswordModule } from 'primeng/password';
import { DrawerModule } from 'primeng/drawer';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TabsModule } from 'primeng/tabs';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { RadioButtonModule } from 'primeng/radiobutton';
import { DatePickerModule } from 'primeng/datepicker';
import { MessageModule } from 'primeng/message';

export type { Priority, WorkspaceTab };
export type NavTab = WorkspaceTab | 'admin';

export type Role = 'SUPER_ADMIN' | 'CHAIRMAN' | 'VICE_PRESIDENT' | 'MANAGING_DIRECTOR' | 'DIRECTOR' | 'ASSISTANT_VICE_PRESIDENT';
const SENIOR_MANAGEMENT_ROLES: Role[] = ['CHAIRMAN', 'VICE_PRESIDENT', 'MANAGING_DIRECTOR', 'DIRECTOR', 'ASSISTANT_VICE_PRESIDENT'];
interface Account { id: number; username: string; displayName: string; roles: Role[] }
interface TaskPage { content: Task[]; totalElements: number; number: number }
export interface Employee { id: number; name: string }

export type TaskStatus = 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED';

export interface Task {
  id: number;
  userId: string;
  recipientId?: number | null;
  assignedByName?: string | null;
  title: string;
  notes?: string | null;
  dueTime?: string | null;
  priority: Priority;
  category?: string | null;
  status: TaskStatus;
  focusDate?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  assigneeIds?: number[];
}

export interface TaskDraft {
  id?: number;
  recipientId: number | null;
  title: string;
  notes: string;
  dueTime: string;
  priority: Priority;
  category: string;
  status: TaskStatus;
  focusDate: string | null;
  assigneeIds: number[];
}

export interface CalendarCell {
  iso: string;
  dayNum: number;
  weekdayShort: string;
  inCurrentMonth: boolean;
  activeCount: number;
  focusCount: number;
  highCount: number;
  topTaskTitle?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule, ToastModule, SkeletonModule, AutoCompleteModule, ProgressSpinnerModule, PasswordModule, DrawerModule, DialogModule, ConfirmDialogModule, TabsModule, BadgeModule, InputTextModule, TextareaModule, ButtonModule, ToggleSwitchModule, RadioButtonModule, DatePickerModule, MessageModule, MyDayComponent, MyTasksComponent, KanbanComponent, AdminComponent, EmployeePickerComponent],
  providers: [MessageService, ConfirmationService],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private appRef = inject(ApplicationRef, { optional: true });
  private messages = inject(MessageService, { optional: true });
  private confirmation = inject(ConfirmationService);
  private dateTimer?: ReturnType<typeof setInterval>;

  focusSearchOnLoad = false;
  editDialogOpen = signal(false);
  horizonDialogOpen = false;
  profileDialogOpen = false;

  account = signal<Account | null>(null);
  authReady = signal(false);
  authBusy = signal(false);
  authError = signal('');
  profileError = signal('');
  userId = computed(() => this.account()?.username ?? '');
  displayName = computed(() => this.account()?.displayName ?? '');
  isSuperAdmin = computed(() => this.account()?.roles?.includes('SUPER_ADMIN') ?? false);
  isStaff = computed(() => this.account()?.roles?.some(r => SENIOR_MANAGEMENT_ROLES.includes(r)) ?? false);
  primaryManagementRole(roles: Role[]): Role | undefined {
    return roles.find(role => SENIOR_MANAGEMENT_ROLES.includes(role));
  }
  private initialNavPrefs = resolveNavPrefs(
    localStorage.getItem('sr_default_tab'),
    localStorage.getItem('sr_visible_tabs'),
    localStorage.getItem('sr_nav_labels')
  );
  defaultLoginTab = signal<WorkspaceTab>(this.initialNavPrefs.defaultTab);
  visibleTabs = signal<WorkspaceTab[]>(this.initialNavPrefs.visibleTabs);
  showTabLabels = signal<boolean>(this.initialNavPrefs.showLabels);
  activeTab = signal<NavTab>(this.initialNavPrefs.defaultTab);
  showingAdmin = computed(() => this.isSuperAdmin() && this.activeTab() === 'admin');
  signInInput = '';
  signInPassword = '';
  showSignInPassword = false;
  profileNameInput = '';
  currentPassword = '';
  newPassword = '';
  defaultPriority = signal<Priority>((localStorage.getItem('sr_default_priority') as Priority) || 'HIGH');
  themeMode = signal<'system' | 'light' | 'dark'>(
    (localStorage.getItem('color-scheme') as 'light' | 'dark') || 'system'
  );

  // Navigation & Dates
  todayIso = signal<string>(plannerTodayIso());
  selectedDate = signal<string>(plannerTodayIso());
  clockMillis = signal(Date.now());
  calendarMode = signal<'week' | 'month'>('week');
  horizonPriorityOnly = signal<boolean>(false);

  // Data & Status states (T-08, T-09)
  tasks = signal<Task[]>([]);
  listTasks = signal<Task[]>([]);
  listTotal = signal(0);
  listPage = signal(0);
  listLoading = signal(false);
  private listRequestId = 0;
  private taskRequestId = 0;
  private employeeRequestId = 0;
  private recipientRequestId = 0;
  private sessionVersion = 0;
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  errorMsg = signal<string>('');
  statusMsg = signal<string>('');

  // Employee directory (reminder-only; employees have no portal access), preloaded at startup & login.
  employees = signal<Employee[]>([]);
  employeesLoading = signal<boolean>(false);
  private employeeMap = computed(() => new Map(this.employees().map(e => [e.id, e.name])));
  recipients = signal<Account[]>([]);
  categorySuggestions = signal<string[]>([]);
  recipientOptions = computed(() => [
    { id: 0, label: 'Myself' },
    ...this.recipients()
      .filter(person => person.id !== this.account()?.id)
      .map(person => ({ id: person.id, label: `${person.displayName} (${this.primaryManagementRole(person.roles)})` }))
  ]);
  private recipientMap = computed(() => new Map(this.recipients().map(r => [r.id, r.displayName])));

  completeCategory(query: string): void {
    const search = query.trim().toLocaleLowerCase();
    const categories = this.tasks().map(task => task.category?.trim()).filter((name): name is string => !!name);
    this.categorySuggestions.set([...new Set(categories)]
      .filter(name => name.toLocaleLowerCase().includes(search))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 10));
  }

  canChangeStatus(task: Task): boolean {
    return task.recipientId ? task.recipientId === this.account()?.id : task.userId === this.userId();
  }

  canEdit(task: Task): boolean { return task.userId === this.userId(); }

  assignmentLabel(task: Task): string {
    if (task.recipientId && task.recipientId !== this.account()?.id && task.userId === this.userId()) return `Assigned to ${this.recipientMap().get(task.recipientId) || 'Senior Management'}`;
    if (task.recipientId && task.assignedByName) {
      const sender = task.userId === this.userId() ? null : this.recipients().find(r => r.username === task.userId);
      return `Assigned by ${sender?.displayName || task.assignedByName}`;
    }
    return '';
  }

  editingTask: TaskDraft = this.emptyDraft();
  taskPendingDelete = signal<Task | null>(null);

  // My Tasks filters & sorting (T-05, T-06, T-07)
  statusFilter = signal<'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'ALL'>('ACTIVE');
  searchQuery = signal<string>('');
  priorityFilter = signal<string>('ALL');
  categoryFilter = signal<string>('');
  sortBy = signal<'NEWEST' | 'PRIORITY'>('PRIORITY');

  // Computed properties for My Day (Section 04)
  private isSentTask(task: Task): boolean {
    return task.userId === this.userId() && !!task.recipientId && task.recipientId !== this.account()?.id;
  }
  private isReceivedTask(task: Task): boolean {
    return task.recipientId === this.account()?.id && !!task.assignedByName;
  }
  sentTasks = computed(() => this.tasks().filter(t => this.isSentTask(t)));
  workTasks = computed(() => this.tasks().filter(t => !this.isSentTask(t)));
  portfolioCompletion = computed(() => this.workTasks().length
    ? this.workTasks().filter(t => t.status === 'COMPLETED').length * 100 / this.workTasks().length : 0);
  // Open work rolls into each new day; completed work appears on its completion day.
  activeTasks = computed(() => this.workTasks().filter(t => t.status !== 'COMPLETED'));
  taskOnDate(task: Task, date: string): boolean {
    return taskOnDate(task, date, this.todayIso());
  }
  todayActiveCount = computed(() => this.activeTasks().length);
  completedTodayCount = computed(() => this.workTasks().filter(t => this.taskOnDate(t, this.todayIso()) && t.status === 'COMPLETED').length);
  carriedCount = computed(() => this.activeTasks().filter(t => plannerTodayIso(new Date(t.createdAt)) < this.todayIso()).length);
  focusTasks = computed(() => {
    const sel = this.selectedDate();
    return this.activeTasks()
      .filter(t => t.focusDate === sel && sel === this.todayIso())
      .sort((a, b) => compareTaskStack(a, b, sel));
  });
  agendaTasks = computed(() => {
    const sel = this.selectedDate();
    return this.workTasks()
      .filter(t => this.taskOnDate(t, sel) && (sel !== this.todayIso() || !this.isReceivedTask(t) || t.status !== 'COMPLETED'))
      .sort((a, b) => compareTaskStack(a, b, sel));
  });
  sentAgendaTasks = computed(() => this.sentTasks().filter(t => this.taskOnDate(t, this.selectedDate()))
    .sort((a, b) => compareTaskStack(a, b, this.selectedDate())));
  assignedToSummary = computed(() => {
    const groups = new Map<number, { recipientId: number; name: string; openCount: number; tasks: Task[] }>();
    for (const task of this.sentTasks()) {
      const recipientId = task.recipientId!;
      let group = groups.get(recipientId);
      if (!group) {
        group = {
          recipientId,
          name: this.recipientMap().get(recipientId) || 'Senior Management',
          openCount: 0,
          tasks: []
        };
        groups.set(recipientId, group);
      }
      if (task.status === 'ACTIVE' || task.status === 'IN_PROGRESS') group.openCount++;
      group.tasks.push(task);
    }
    const today = this.todayIso();
    return [...groups.values()]
      .map(g => ({ ...g, tasks: g.tasks.sort((a, b) => compareTaskStack(a, b, today)) }))
      .sort((a, b) => (b.openCount - a.openCount) || a.name.localeCompare(b.name));
  });
  calendarAgendaTasks = computed(() => this.workTasks().filter(t => this.taskOnDate(t, this.selectedDate()))
    .sort((a, b) => compareTaskStack(a, b, this.selectedDate())));
  daySections = computed(() => [
    { title: this.selectedDate() === this.todayIso() ? 'Today’s Tasks' : `Completed on ${this.selectedDate()}`, tasks: this.agendaTasks() },
    { title: 'Assigned To', tasks: this.sentAgendaTasks() }
  ]);

  calendarDays = computed(() => {
    const [y, m, d] = this.selectedDate().split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const days: { iso: string; dayNum: number; weekday: string; dueCount: number; hasHigh: boolean }[] = [];
    const buildDay = (dt: Date) => {
      const iso = localIsoDate(dt);
      const dayTasks = this.workTasks().filter(t => this.taskOnDate(t, iso));
      return {
        iso,
        dayNum: dt.getDate(),
        weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
        dueCount: dayTasks.length,
        hasHigh: dayTasks.some(t => t.priority === 'HIGH')
      };
    };

    if (this.calendarMode() === 'week') {
      const startOffset = base.getDay();
      for (let i = 0; i < 7; i++) {
        days.push(buildDay(new Date(y, m - 1, d - startOffset + i)));
      }
    } else {
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(buildDay(new Date(y, m - 1, i)));
      }
    }
    return days;
  });

  monthMatrixCells = computed<CalendarCell[]>(() => {
    const [y, m] = this.selectedDate().split('-').map(Number);
    const firstOfMonth = new Date(y, m - 1, 1);
    const startDow = firstOfMonth.getDay();
    const mondayShift = startDow === 0 ? -6 : 1 - startDow;
    const cells: CalendarCell[] = [];
    const highOnly = this.horizonPriorityOnly();

    for (let i = 0; i < monthGridSize(y, m); i++) {
      const dt = new Date(y, m - 1, 1 + mondayShift + i);
      const iso = localIsoDate(dt);
      const dayTasks = this.workTasks()
        .filter(t => this.taskOnDate(t, iso))
        .filter(t => !highOnly || t.priority === 'HIGH');
      cells.push({
        iso,
        dayNum: dt.getDate(),
        weekdayShort: dt.toLocaleDateString('en-US', { weekday: 'short' }),
        inCurrentMonth: dt.getMonth() === m - 1,
        activeCount: dayTasks.length,
        focusCount: dayTasks.filter(t => t.focusDate === iso).length,
        highCount: dayTasks.filter(t => t.priority === 'HIGH').length,
        topTaskTitle: dayTasks[0]?.title
      });
    }
    return cells;
  });

  horizonMonthStats = computed(() => {
    let totalTasks = 0;
    let activeDays = 0;
    let highCount = 0;
    for (const c of this.monthMatrixCells()) {
      if (!c.inCurrentMonth) continue;
      totalTasks += c.activeCount;
      if (c.activeCount > 0) activeDays++;
      highCount += c.highCount;
    }
    return { totalTasks, activeDays, highCount };
  });

  avatarTone(name: string): number {
    let hash = 0;
    const key = name.trim().toLowerCase();
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 6;
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  kanbanSearch = signal<string>('');
  kanbanPriority = signal<'ALL' | Priority>('ALL');

  kanbanColumns: { status: TaskStatus; label: string; sub: string; icon: string }[] = [
    { status: 'ACTIVE', label: 'To Do', sub: 'Queued commitments', icon: 'radio_button_unchecked' },
    { status: 'IN_PROGRESS', label: 'In Progress', sub: 'Active execution', icon: 'pending' },
    { status: 'COMPLETED', label: 'Completed', sub: 'Signed off & resolved', icon: 'task_alt' }
  ];

  tasksByStatus = computed(() => {
    const q = this.kanbanSearch().trim().toLowerCase();
    const prio = this.kanbanPriority();
    const all = this.workTasks().filter(t => {
      if (prio !== 'ALL' && t.priority !== prio) return false;
      if (q && !t.title.toLowerCase().includes(q) && !(t.category ?? '').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => compareTaskStack(a, b, this.todayIso()));
    return {
      ACTIVE: all.filter(t => t.status === 'ACTIVE'),
      IN_PROGRESS: all.filter(t => t.status === 'IN_PROGRESS'),
      COMPLETED: all.filter(t => t.status === 'COMPLETED')
    };
  });

  kanbanRows = computed(() => {
    const names = new Map(this.recipients().map(person => [person.username, person.displayName]));
    const rows = new Map<string, { username: string; name: string; tasks: Record<TaskStatus, Task[]> }>();
    for (const col of this.kanbanColumns) {
      for (const task of this.tasksByStatus()[col.status]) {
        const isSelfTask = task.userId === this.userId() && !task.assignedByName;
        const rowKey = isSelfTask ? '__self__' : (task.userId === this.userId() ? `by:${task.assignedByName}` : task.userId);
        let row = rows.get(rowKey);
        if (!row) {
          row = {
            username: rowKey,
            name: isSelfTask ? 'Myself' : (task.userId === this.userId() ? task.assignedByName! : (names.get(task.userId) || task.assignedByName || task.userId)),
            tasks: { ACTIVE: [], IN_PROGRESS: [], COMPLETED: [] }
          };
          rows.set(rowKey, row);
        }
        row.tasks[col.status].push(task);
      }
    }
    return [...rows.values()].sort((a, b) =>
      a.username === '__self__' ? -1 : b.username === '__self__' ? 1 : a.name.localeCompare(b.name)
    );
  });

  userInitials = computed(() => {
    const name = this.displayName() || this.userId() || 'SR';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  });

  firstName = computed(() => (this.displayName().trim().split(/\s+/)[0]) || 'Executive');

  greetingLabel = computed(() => {
    const hr = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23'
    }).format(this.clockMillis()));
    if (hr < 12) return 'Good morning';
    if (hr < 17) return 'Good afternoon';
    return 'Good evening';
  });

  formattedSelectedDate = computed(() => {
    const [y, m, d] = this.selectedDate().split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  });

  formattedMonthYear = computed(() => {
    const [y, m, d] = this.selectedDate().split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });
  selectedDateForPicker = computed(() => {
    const [year, month, day] = this.selectedDate().split('-').map(Number);
    return new Date(year, month - 1, day);
  });

  pickCalendarDate(date: Date | null): void {
    if (date) this.selectedDate.set(localIsoDate(date));
  }

  constructor() {
    effect(onCleanup => {
      if (!this.statusMsg()) return;
      this.messages?.add({ key: 'workspace', severity: 'success', summary: 'Saved', detail: this.statusMsg(), life: 5000 });
      const t = setTimeout(() => this.statusMsg.set(''), 5000);
      onCleanup(() => clearTimeout(t));
    });
    effect(onCleanup => {
      if (!this.errorMsg()) return;
      this.messages?.add({ key: this.editDialogOpen() ? 'edit' : 'workspace', severity: 'error', summary: 'Error', detail: this.errorMsg(), life: 5000 });
      const t = setTimeout(() => this.errorMsg.set(''), 5000);
      onCleanup(() => clearTimeout(t));
    });
  }

  ngOnInit(): void {
    this.refreshSession();
    this.dateTimer = setInterval(() => {
      this.clockMillis.set(Date.now());
      const today = plannerTodayIso();
      if (today !== this.todayIso()) {
        const selectedWasToday = this.selectedDate() === this.todayIso();
        this.todayIso.set(today);
        if (selectedWasToday) this.selectedDate.set(today);
      }
      if (this.isStaff()) {
        this.loadTasks();
        if (this.activeTab() === 'my-tasks') this.loadList(this.listPage());
      }
    }, 60_000);
  }

  ngOnDestroy(): void { clearInterval(this.dateTimer); }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcuts(e: KeyboardEvent): void {
    if (!this.account() || this.showingAdmin()) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.activeTab.set('my-tasks');
      this.loadList();
      this.focusSearchOnLoad = true;
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('#taskSearchInput');
        if (input) {
          input.focus();
          this.focusSearchOnLoad = false;
        }
      }, 50);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      this.openNewTask();
    }
  }

  openNewTask(prefillStatus: TaskStatus = 'ACTIVE'): void {
    this.editingTask = {
      title: '',
      notes: '',
      recipientId: null,
      dueTime: '',
      priority: this.defaultPriority(),
      category: '',
      status: prefillStatus,
      focusDate: null,
      assigneeIds: []
    };
    this.editDialogOpen.set(true);
  }

  appendEditToken(token: string): void {
    this.editingTask.title = `${this.editingTask.title.trim()} ${token}`.trim() + ' ';
  }

  changeRecipient(recipientId: number | null): void {
    this.editingTask.recipientId = recipientId;
    if (!this.editingTask.id) this.editingTask.status = 'ACTIVE';
    this.editingTask.focusDate = null;
  }

  private refreshSession(): void {
    const session = this.sessionVersion;
    forkJoin([
      this.http.get('/api/auth/csrf'),
      this.http.get<Account>('/api/auth/me').pipe(catchError(() => of(null)))
    ]).subscribe({
      next: ([, account]) => {
        if (session !== this.sessionVersion) return;
        this.authReady.set(true);
        if (!account) return;
        this.account.set(account);
        this.applyUserNavPrefs(account.username);
        this.loadEmployees();
        if (this.isStaff()) {
          this.loadRecipients();
          this.loadTasks();
          if (this.activeTab() === 'my-tasks') this.loadList();
        }
      },
      error: () => {
        if (session !== this.sessionVersion) return;
        this.authReady.set(true);
        this.authError.set('Unable to connect. Please try again.');
      }
    });
  }

  selectTab(tab: NavTab): void {
    if (tab === 'admin' && !this.isSuperAdmin()) return;
    const prevTab = this.activeTab();
    const wasAdmin = prevTab === 'admin';
    const applyTab = () => {
      this.activeTab.set(tab);
      this.appRef?.tick();
    };
    if (prevTab !== tab && typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      document.startViewTransition(applyTab);
    } else {
      this.activeTab.set(tab);
    }
    if (wasAdmin && tab !== 'admin') {
      this.loadEmployees(true);
      if (this.isStaff()) {
        this.loadRecipients();
      }
    }
    if (tab !== 'admin' && this.isStaff()) this.loadTasks();
    if (tab === 'my-tasks') this.loadList();
  }

  isTabVisible(tab: WorkspaceTab): boolean {
    return this.visibleTabs().includes(tab);
  }

  setDefaultLoginTab(tab: WorkspaceTab): void {
    if (!this.visibleTabs().includes(tab)) {
      const nextVis = WORKSPACE_TABS.filter(t => this.visibleTabs().includes(t) || t === tab);
      this.visibleTabs.set(nextVis);
      this.saveNavPref('sr_visible_tabs', nextVis.join(','));
    }
    this.defaultLoginTab.set(tab);
    this.saveNavPref('sr_default_tab', tab);
    this.selectTab(tab);
  }

  toggleVisibleTab(tab: WorkspaceTab): void {
    const current = this.visibleTabs();
    if (current.includes(tab)) {
      if (current.length <= 1) return;
      const next = WORKSPACE_TABS.filter(t => current.includes(t) && t !== tab);
      this.visibleTabs.set(next);
      this.saveNavPref('sr_visible_tabs', next.join(','));
      if (this.defaultLoginTab() === tab) {
        this.defaultLoginTab.set(next[0]);
        this.saveNavPref('sr_default_tab', next[0]);
      }
      if (this.activeTab() === tab) {
        this.selectTab(next[0]);
      }
    } else {
      const next = WORKSPACE_TABS.filter(t => current.includes(t) || t === tab);
      this.visibleTabs.set(next);
      this.saveNavPref('sr_visible_tabs', next.join(','));
    }
  }

  setShowTabLabels(show: boolean): void {
    this.showTabLabels.set(show);
    this.saveNavPref('sr_nav_labels', show ? 'full' : 'logo-only');
  }

  private saveNavPref(key: string, value: string): void {
    localStorage.setItem(key, value);
    if (this.userId()) localStorage.setItem(`${key}_${this.userId()}`, value);
  }

  private applyUserNavPrefs(username: string): void {
    const get = (k: string) => localStorage.getItem(`${k}_${username}`) ?? localStorage.getItem(k);
    const prefs = resolveNavPrefs(get('sr_default_tab'), get('sr_visible_tabs'), get('sr_nav_labels'));
    this.visibleTabs.set(prefs.visibleTabs);
    this.defaultLoginTab.set(prefs.defaultTab);
    this.showTabLabels.set(prefs.showLabels);
    this.activeTab.set(prefs.defaultTab);
  }

  private sessionExpired(err: { status?: number }): boolean {
    if (err.status !== 401) return false;
    this.clearSession('Your sign-in expired. Please sign in again.');
    this.http.get('/api/auth/csrf').subscribe();
    return true;
  }

  loadTasks(): void {
    if (!this.userId() || !this.isStaff()) return;
    this.loading.set(this.tasks().length === 0);
    if (this.tasks().length === 0) this.errorMsg.set('');
    const owner = this.userId();
    const session = this.sessionVersion;
    const requestId = ++this.taskRequestId;
    // Load every task so My Day can show completed/past items in the daily agenda.
    // shortcut: loads all of a user's tasks; if volume grows large, scope this to a date window.
    this.http.get<Task[]>('/api/tasks').subscribe({
      next: list => {
        if (session !== this.sessionVersion || this.userId() !== owner || requestId !== this.taskRequestId) return;
        this.tasks.set(list);
        this.loading.set(false);
      },
      error: err => {
        if (session !== this.sessionVersion || this.userId() !== owner || requestId !== this.taskRequestId) return;
        this.loading.set(false);
        if (this.sessionExpired(err)) return;
        this.errorMsg.set('Unable to load your tasks right now. Please check your connection and try again.');
      }
    });
  }

  loadList(page = 0): void {
    const owner = this.userId();
    if (!owner || !this.isStaff()) return;
    const requestId = ++this.listRequestId;
    let params = new HttpParams().set('page', page).set('size', 50).set('sort', this.sortBy());
    if (this.statusFilter() !== 'ALL') params = params.set('status', this.statusFilter());
    if (this.searchQuery().trim()) params = params.set('search', this.searchQuery().trim());
    if (this.priorityFilter() !== 'ALL') params = params.set('priority', this.priorityFilter());
    if (this.categoryFilter().trim()) params = params.set('category', this.categoryFilter().trim());
    this.listLoading.set(true);
    this.http.get<TaskPage>('/api/tasks/history', { params }).subscribe({
      next: result => {
        if (requestId !== this.listRequestId || this.userId() !== owner) return;
        this.listTasks.set(result.content);
        this.listTotal.set(result.totalElements);
        this.listPage.set(result.number);
        this.listLoading.set(false);
      },
      error: err => {
        if (requestId !== this.listRequestId || this.userId() !== owner) return;
        this.listLoading.set(false);
        if (this.sessionExpired(err)) return;
        this.errorMsg.set('Could not load your task list. Please retry.');
      }
    });
  }

  trackById = (_: number, t: Task) => t.id;

  loadEmployees(force = false): void {
    if (!force && (this.employeesLoading() || this.employees().length > 0)) return;
    const session = this.sessionVersion;
    const requestId = ++this.employeeRequestId;
    this.employeesLoading.set(true);
    this.http.get<Employee[]>('/api/employees').subscribe({
      next: list => {
        if (session !== this.sessionVersion || requestId !== this.employeeRequestId) return;
        this.employees.set(list);
        this.employeesLoading.set(false);
      },
      error: () => { if (session === this.sessionVersion && requestId === this.employeeRequestId) this.employeesLoading.set(false); }
    });
  }

  loadRecipients(): void {
    const session = this.sessionVersion;
    const requestId = ++this.recipientRequestId;
    this.http.get<Account[]>('/api/tasks/recipients').subscribe({
      next: list => { if (session === this.sessionVersion && requestId === this.recipientRequestId) this.recipients.set(list); },
      error: () => { if (session === this.sessionVersion && requestId === this.recipientRequestId) this.errorMsg.set('Could not load Senior Management recipients.'); }
    });
  }

  assigneeNames(ids?: number[] | null): string[] {
    if (!ids?.length) return [];
    const map = this.employeeMap();
    return ids.map(id => map.get(id)).filter((n): n is string => !!n);
  }

  setTaskStatus(task: Task, nextStatus: TaskStatus): void {
    if (task.status === nextStatus || !this.canChangeStatus(task)) return;
    const session = this.sessionVersion;
    this.saving.set(true);
    this.http.put<Task>(`/api/tasks/${task.id}/status`, { status: nextStatus }).subscribe({
      next: updated => {
        if (session !== this.sessionVersion) return;
        this.tasks.update(list => list.map(t => t.id === updated.id ? updated : t));
        if (this.activeTab() === 'my-tasks') this.loadList();
        if (nextStatus === 'COMPLETED') this.celebrate();
        this.saving.set(false);
      },
      error: err => {
        if (session !== this.sessionVersion) return;
        this.saving.set(false);
        if (this.sessionExpired(err)) return;
        this.errorMsg.set('Could not update task status.');
      }
    });
  }

  onKanbanDrop(event: CdkDragDrop<Task[]>, targetStatus: TaskStatus): void {
    const task = event.item.data as Task | undefined;
    if (task) this.setTaskStatus(task, targetStatus);
  }

  // One-shot confetti reward when a task is completed.
  celebrateKey = signal(0);
  readonly confettiPieces = Array.from({ length: 16 }, (_, i) => i);
  private celebrate(): void {
    this.celebrateKey.update(k => k + 1);
    setTimeout(() => this.celebrateKey.set(0), 1200);
  }

  toggleComplete(task: Task): void {
    this.setTaskStatus(task, task.status === 'COMPLETED' ? 'ACTIVE' : 'COMPLETED');
  }

  toggleFocus(task: Task): void {
    if (!this.canEdit(task)) return;
    const sel = this.selectedDate();
    const nextFocus = task.focusDate === sel ? null : sel;
    if (nextFocus && this.focusTasks().length >= 3) {
      this.errorMsg.set("You already have 3 tasks in Today's Focus. Remove one before adding another.");
      return;
    }
    this.updateTask(task.id, {
      title: task.title,
      notes: task.notes ?? null,
      dueTime: task.dueTime ?? null,
      priority: task.priority,
      category: task.category ?? null,
      status: task.status,
      focusDate: nextFocus,
      assigneeIds: task.assigneeIds ?? []
      ,recipientId: task.recipientId ?? null
    });
  }

  openEdit(task: Task): void {
    if (!this.canEdit(task)) return;
    this.editingTask = {
      id: task.id,
      recipientId: task.recipientId ?? null,
      title: task.title,
      notes: task.notes ?? '',
      dueTime: task.dueTime ?? '',
      priority: task.priority,
      category: task.category ?? '',
      status: task.status,
      focusDate: task.focusDate ?? null,
      assigneeIds: [...(task.assigneeIds ?? [])]
    };
    this.editDialogOpen.set(true);
  }

  toggleEditFocus(): void {
    const targetDate = this.todayIso();
    this.editingTask.focusDate = this.editingTask.focusDate ? null : targetDate;
  }

  deleteFromDrawer(): void {
    const target = this.tasks().find(t => t.id === this.editingTask.id)
      ?? this.listTasks().find(t => t.id === this.editingTask.id);
    if (!target) return;
    this.editDialogOpen.set(false);
    this.confirmDelete(target);
  }

  saveEdit(): void {
    const raw = this.editingTask.title.trim();
    if (!raw) return;

    if (!this.editingTask.id) {
      const parsed = parseSmartOmnibar(raw, this.editingTask.priority);
      if (!parsed.title) return;
      const canPin = (parsed.pinFocus || !!this.editingTask.focusDate) && this.focusTasks().length < 3;
      const focusTarget = this.editingTask.focusDate || (canPin ? this.todayIso() : null);
      this.saving.set(true);
      this.errorMsg.set('');
      const payload = {
        title: parsed.title,
        notes: this.editingTask.notes || null,
        recipientId: this.editingTask.recipientId,
        dueTime: this.editingTask.dueTime || null,
        priority: parsed.priority,
        category: this.editingTask.category || parsed.category || null,
        status: this.editingTask.status,
        focusDate: this.editingTask.status === 'COMPLETED' ? null : focusTarget,
        assigneeIds: this.editingTask.assigneeIds
      };
      const session = this.sessionVersion;
      this.http.post<Task>('/api/tasks', payload).subscribe({
        next: created => {
          if (session !== this.sessionVersion) return;
          this.taskRequestId++;
          this.loading.set(false);
          this.tasks.update(list => [created, ...list]);
          if (this.activeTab() === 'my-tasks') this.loadList();
          this.saving.set(false);
          this.editDialogOpen.set(false);
          this.statusMsg.set('Task created.');
        },
        error: err => {
          if (session !== this.sessionVersion) return;
          this.saving.set(false);
          if (this.sessionExpired(err)) return;
          this.errorMsg.set(err?.error?.message || 'Could not save task. Please try again.');
        }
      });
      return;
    }

    this.updateTask(this.editingTask.id, {
      title: raw,
      notes: this.editingTask.notes || null,
      recipientId: this.editingTask.recipientId,
      dueTime: this.editingTask.dueTime || null,
      priority: this.editingTask.priority,
      category: this.editingTask.category || null,
      status: this.editingTask.status,
      focusDate: this.editingTask.focusDate,
      assigneeIds: this.editingTask.assigneeIds
    }, () => this.editDialogOpen.set(false));
  }

  private updateTask(id: number, body: Record<string, unknown>, onDone?: () => void): void {
    const session = this.sessionVersion;
    this.saving.set(true);
    this.errorMsg.set('');
    this.http.put<Task>(`/api/tasks/${id}`, body).subscribe({
      next: updated => {
        if (session !== this.sessionVersion) return;
        this.taskRequestId++;
        this.loading.set(false);
        this.tasks.update(list => [updated, ...list.filter(t => t.id !== id)]);
        if (this.activeTab() === 'my-tasks') this.loadList();
        this.saving.set(false);
        onDone?.();
        this.statusMsg.set('Task saved.');
      },
      error: err => {
        if (session !== this.sessionVersion) return;
        this.saving.set(false);
        if (this.sessionExpired(err)) return;
        this.errorMsg.set(err?.error?.message || 'Changes could not be saved. Please try again.');
      }
    });
  }

  confirmDelete(task: Task): void {
    this.taskPendingDelete.set(task);
    this.confirmation.confirm({
      key: 'task-delete', header: 'Delete this task?',
      message: `"${task.title}" will be permanently removed from your workspace.`,
      acceptLabel: 'Delete Permanently', rejectLabel: 'Cancel',
      accept: () => this.onDeleteDialogClose(true),
      reject: () => this.onDeleteDialogClose(false)
    });
  }

  onDeleteDialogClose(confirmed = false): void {
    const target = this.taskPendingDelete();
    this.taskPendingDelete.set(null);
    if (confirmed && target) {
      const session = this.sessionVersion;
      this.saving.set(true);
      this.http.delete(`/api/tasks/${target.id}`).subscribe({
        next: () => {
          if (session !== this.sessionVersion) return;
          this.taskRequestId++;
          this.loading.set(false);
          this.tasks.update(list => list.filter(t => t.id !== target.id));
          if (this.activeTab() === 'my-tasks') this.loadList();
          this.saving.set(false);
        },
        error: err => {
          if (session !== this.sessionVersion) return;
          this.saving.set(false);
          if (this.sessionExpired(err)) return;
          this.errorMsg.set('Unable to delete the task. Please try again.');
        }
      });
    }
  }

  openHorizonModal(): void {
    this.horizonDialogOpen = true;
  }

  addTaskForSelectedHorizonDate(): void {
    this.horizonDialogOpen = false;
    this.openNewTask();
  }

  openProfile(): void {
    this.profileNameInput = this.displayName();
    this.profileError.set('');
    this.profileDialogOpen = true;
  }

  setTheme(mode: 'system' | 'light' | 'dark'): void {
    this.themeMode.set(mode);
    document.documentElement.classList.toggle('app-dark', mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (mode === 'system') {
      localStorage.removeItem('color-scheme');
      meta?.setAttribute('content', 'light dark');
    } else {
      localStorage.setItem('color-scheme', mode);
      meta?.setAttribute('content', mode);
    }
  }

  setDefaultPriorityPref(p: Priority): void {
    this.defaultPriority.set(p);
    localStorage.setItem('sr_default_priority', p);
  }

  saveProfile(): void {
    const session = this.sessionVersion;
    this.http.put<Account>('/api/auth/profile', { displayName: this.profileNameInput }).subscribe({
      next: account => {
        if (session !== this.sessionVersion) return;
        this.account.set(account);
        this.statusMsg.set('Profile saved.');
        this.profileDialogOpen = false;
      },
      error: () => { if (session === this.sessionVersion) this.profileError.set('Could not save your profile. Please try again.'); }
    });
  }

  changePassword(): void {
    const session = this.sessionVersion;
    this.http.post('/api/auth/password', {
      currentPassword: this.currentPassword, newPassword: this.newPassword
    }).subscribe({
      next: () => {
        if (session !== this.sessionVersion) return;
        this.currentPassword = '';
        this.newPassword = '';
        this.signOut('Password changed. Sign in again.');
      },
      error: () => { if (session === this.sessionVersion) this.profileError.set('Could not change password. Check your current password and try again.'); }
    });
  }

  signOut(message = ''): void {
    this.http.post('/api/auth/logout', {}).subscribe({
      next: () => {
        this.clearSession(message);
        this.http.get('/api/auth/csrf').subscribe();
      },
      error: () => this.profileError.set('Could not sign out. Please try again.')
    });
  }

  private clearSession(message = ''): void {
    this.sessionVersion++;
    this.taskPendingDelete.set(null);
    this.editDialogOpen.set(false);
    this.horizonDialogOpen = false;
    this.profileDialogOpen = false;
    this.account.set(null);
    this.tasks.set([]);
    this.listTasks.set([]);
    this.listTotal.set(0);
    this.listPage.set(0);
    this.employees.set([]);
    this.recipients.set([]);
    this.editingTask = this.emptyDraft();
    this.editDialogOpen.set(false);
    this.profileNameInput = '';
    this.currentPassword = '';
    this.newPassword = '';
    this.signInPassword = '';
    this.focusSearchOnLoad = false;
    this.listRequestId++;
    this.loading.set(false);
    this.listLoading.set(false);
    this.employeesLoading.set(false);
    this.saving.set(false);
    this.activeTab.set(this.defaultLoginTab());
    this.authError.set(message);
    this.profileError.set('');
    this.statusMsg.set('');
  }

  signIn(): void {
    if (!this.signInInput.trim() || !this.signInPassword) return;
    this.authBusy.set(true);
    this.authError.set('');
    const body = new HttpParams().set('username', this.signInInput.trim().toLowerCase())
      .set('password', this.signInPassword);
    this.http.post('/api/auth/login', body).subscribe({
      next: () => {
        this.signInPassword = '';
        this.authBusy.set(false);
        this.loadEmployees(true);
        this.refreshSession();
      },
      error: err => {
        this.authBusy.set(false);
        this.authError.set(err.status === 429
          ? 'Too many sign-in attempts. Try again in 10 minutes.'
          : 'Username or password is incorrect.');
      }
    });
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.priorityFilter.set('ALL');
    this.categoryFilter.set('');
    this.statusFilter.set('ACTIVE');
    this.loadList();
  }

  shiftCalendarPeriod(direction: number): void {
    const selected = this.selectedDate();
    this.selectedDate.set(this.calendarMode() === 'week'
      ? addDaysIso(selected, direction * 7)
      : addMonthsIso(selected, direction));
  }

  prioritySeverity(p: Priority): 'danger' | 'warn' | 'success' {
    if (p === 'HIGH') return 'danger';
    if (p === 'MEDIUM') return 'warn';
    return 'success';
  }

  formatTime12h(timeStr?: string | null): string {
    if (!timeStr) return '';
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10);
    if (isNaN(h)) return timeStr;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${mStr} ${suffix}`;
  }

  private emptyDraft(): TaskDraft {
    return {
      title: '',
      notes: '',
      recipientId: null,
      dueTime: '',
      priority: 'MEDIUM',
      category: '',
      status: 'ACTIVE',
      focusDate: null,
      assigneeIds: []
    };
  }
}
