import test from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { build } from 'esbuild';
import { createEnvironmentInjector, Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfirmationService } from 'primeng/api';
import { Subject, of, throwError } from 'rxjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const source = fileURLToPath(new URL('./app.component.ts', import.meta.url));
const output = resolve('node_modules/.cache/app-component-test.mjs');
await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
const { AppComponent } = await import(pathToFileURL(output).href);
const myDaySource = fileURLToPath(new URL('./my-day.component.ts', import.meta.url));
const myDayOutput = resolve('node_modules/.cache/my-day-component-test.mjs');
await build({ entryPoints: [myDaySource], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: myDayOutput });
const { MyDayComponent } = await import(pathToFileURL(myDayOutput).href);
globalThis.localStorage = { getItem: () => null, setItem() {} };

test('assignee label shows the management role for a Super Admin', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  assert.equal(app.primaryManagementRole(['VICE_PRESIDENT', 'SUPER_ADMIN']), 'VICE_PRESIDENT');
  assert.equal(app.primaryManagementRole(['SUPER_ADMIN', 'DIRECTOR']), 'DIRECTOR');
  injector.destroy();
});

test('portfolio completion ignores Kanban filters and sent tasks', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager', displayName: 'Manager', roles: ['DIRECTOR'] });
  app.tasks.set([
    { id: 1, userId: 'manager', status: 'COMPLETED', priority: 'LOW' },
    { id: 2, userId: 'manager', status: 'ACTIVE', priority: 'HIGH' },
    { id: 3, userId: 'manager', recipientId: 2, status: 'COMPLETED', priority: 'LOW' }
  ]);
  app.kanbanPriority.set('HIGH');
  assert.equal(app.portfolioCompletion(), 50);
  injector.destroy();
});

test('Kanban groups personal and received tasks by sender and status', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 3, username: 'me', displayName: 'Me', roles: ['DIRECTOR'] });
  app.recipients.set([
    { id: 1, username: 'kdr', displayName: 'KDR', roles: ['DIRECTOR'] },
    { id: 2, username: 'rsn', displayName: 'RSN', roles: ['DIRECTOR'] },
    { id: 3, username: 'me', displayName: 'Me', roles: ['DIRECTOR'] }
  ]);
  app.tasks.set([
    { id: 1, userId: 'kdr', recipientId: 3, assignedByName: 'KDR', title: 'Review', status: 'ACTIVE', priority: 'HIGH' },
    { id: 2, userId: 'kdr', recipientId: 3, assignedByName: 'KDR', title: 'Approve', status: 'COMPLETED', priority: 'LOW' },
    { id: 3, userId: 'rsn', recipientId: 3, assignedByName: 'RSN', title: 'Draft', status: 'IN_PROGRESS', priority: 'MEDIUM' },
    { id: 4, userId: 'me', title: 'Private', status: 'ACTIVE', priority: 'HIGH' },
    { id: 5, userId: 'me', recipientId: 1, title: 'Sent', status: 'ACTIVE', priority: 'HIGH' },
    { id: 6, userId: 'me', recipientId: 3, title: 'Self recipient', status: 'IN_PROGRESS', priority: 'MEDIUM' }
  ]);
  assert.deepEqual(app.kanbanRows().map(row => [row.name, row.tasks.ACTIVE.map(t => t.id), row.tasks.IN_PROGRESS.map(t => t.id), row.tasks.COMPLETED.map(t => t.id)]), [
    ['Myself', [4], [6], []],
    ['KDR', [1], [], [2]],
    ['RSN', [], [3], []]
  ]);
  app.kanbanPriority.set('HIGH');
  assert.deepEqual(app.kanbanRows().map(row => row.name), ['Myself', 'KDR']);
  injector.destroy();
});

test('calendar date picker keeps the selected local calendar day', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.pickCalendarDate(new Date(2026, 10, 19));
  assert.equal(app.selectedDate(), '2026-11-19');
  assert.equal(app.selectedDateForPicker().getDate(), 19);
  app.pickCalendarDate(null);
  assert.equal(app.selectedDate(), '2026-11-19');
  injector.destroy();
});

test('a task response from a signed-out session cannot populate the next account', () => {
  const pending = new Subject();
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { put: () => pending } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.updateTask(1, { title: 'Changed' });
  app.clearSession();
  app.account.set({ username: 'manager-b', displayName: 'B', roles: ['DIRECTOR'] });
  pending.next({ id: 1, userId: 'manager-a', title: 'Private task' });
  assert.equal(app.account().username, 'manager-b');
  assert.deepEqual(app.tasks(), []);
  injector.destroy();
});

test('sign-out closes private dialogs and clears account-specific form state', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.editDialogOpen.set(true);
  app.horizonDialogOpen = true;
  app.profileDialogOpen = true;
  app.editingTask = { id: 5, title: 'Private task' };
  app.taskPendingDelete.set({ id: 5, title: 'Private task' });
  app.currentPassword = 'old-secret';
  app.newPassword = 'new-secret';
  app.profileNameInput = 'Private name';
  app.listTotal.set(7);
  app.clearSession();
  assert.equal(app.editDialogOpen(), false);
  assert.equal(app.horizonDialogOpen, false);
  assert.equal(app.profileDialogOpen, false);
  assert.equal(app.editingTask.title, '');
  assert.equal(app.taskPendingDelete(), null);
  assert.equal(app.currentPassword, '');
  assert.equal(app.newPassword, '');
  assert.equal(app.profileNameInput, '');
  assert.equal(app.listTotal(), 0);
  injector.destroy();
});

test('password change confirmation survives sign-out', () => {
  const passwordChange = new Subject();
  const logout = new Subject();
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {
      post: url => url === '/api/auth/password' ? passwordChange : logout,
      get: () => of({})
    } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.currentPassword = 'old-secret';
  app.newPassword = 'new-secret';
  app.changePassword();
  passwordChange.next(null);
  logout.next(null);
  assert.equal(app.account(), null);
  assert.equal(app.authError(), 'Password changed. Sign in again.');
  injector.destroy();
});

test('an older task load cannot undo a saved task edit', () => {
  const pendingLoad = new Subject();
  const pendingEdit = new Subject();
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: () => pendingLoad, put: () => pendingEdit } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ username: 'manager', displayName: 'Manager', roles: ['DIRECTOR'] });
  app.loadTasks();
  app.updateTask(1, { title: 'New title' });
  pendingEdit.next({ id: 1, userId: 'manager', title: 'New title' });
  pendingLoad.next([{ id: 1, userId: 'manager', title: 'Old title' }]);
  assert.equal(app.tasks()[0].title, 'New title');
  injector.destroy();
});

test('greeting follows the planner clock in Kolkata', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.clockMillis.set(Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(app.greetingLabel(), 'Good morning');
  app.clockMillis.set(Date.parse('2026-11-02T08:00:00Z'));
  assert.equal(app.greetingLabel(), 'Good afternoon');
  app.clockMillis.set(Date.parse('2026-11-02T12:00:00Z'));
  assert.equal(app.greetingLabel(), 'Good evening');
  injector.destroy();
});

test('pending received tasks appear in Today’s Tasks; completed ones stay in calendar history', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.todayIso.set('2026-11-03');
  app.selectedDate.set('2026-11-03');
  const task = (id, title, userId, recipientId, assignedByName = null, status = 'ACTIVE', completedAt = null) => ({
    id, title, userId, recipientId, assignedByName, status, completedAt, priority: 'HIGH',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z'
  });
  app.tasks.set([
    task(1, 'Personal', 'manager-a', null),
    task(2, 'Sent', 'manager-a', 2, 'A'),
    task(3, 'Received', 'manager-b', 1, 'B'),
    task(4, 'Received in progress', 'manager-b', 1, 'B', 'IN_PROGRESS'),
    task(5, 'Received completed today', 'manager-b', 1, 'B', 'COMPLETED', '2026-11-03T06:00:00Z'),
    task(6, 'Received completed yesterday', 'manager-b', 1, 'B', 'COMPLETED', '2026-11-02T06:00:00Z')
  ]);
  assert.deepEqual(app.agendaTasks().map(t => t.title).sort(), ['Personal', 'Received', 'Received in progress']);
  assert.deepEqual(app.activeTasks().map(t => t.title).sort(), ['Personal', 'Received', 'Received in progress']);
  assert.deepEqual(app.sentAgendaTasks().map(t => t.title), ['Sent']);
  assert.deepEqual(app.daySections().map(s => s.title), ['Today’s Tasks', 'Assigned To']);
  assert.deepEqual(app.calendarAgendaTasks().map(t => t.title).sort(), ['Personal', 'Received', 'Received completed today', 'Received in progress']);
  app.selectedDate.set('2026-11-02');
  assert.deepEqual(app.agendaTasks().map(t => t.title), ['Received completed yesterday']);
  injector.destroy();
});

test('assignedToSummary groups delegated tasks by user with To-do + In Progress counts', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.recipients.set([
    { id: 2, username: 'manager-b', displayName: 'Manager B', roles: ['DIRECTOR'] },
    { id: 3, username: 'manager-c', displayName: 'Manager C', roles: ['DIRECTOR'] }
  ]);
  app.tasks.set([
    { id: 1, userId: 'manager-a', recipientId: 2, title: 'Open 1', status: 'ACTIVE', priority: 'HIGH' },
    { id: 2, userId: 'manager-a', recipientId: 2, title: 'Open 2', status: 'IN_PROGRESS', priority: 'MEDIUM' },
    { id: 3, userId: 'manager-a', recipientId: 2, title: 'Done 1', status: 'COMPLETED', priority: 'LOW' },
    { id: 4, userId: 'manager-a', recipientId: 3, title: 'Done 2', status: 'COMPLETED', priority: 'HIGH' },
    { id: 5, userId: 'manager-a', recipientId: null, title: 'Personal', status: 'ACTIVE', priority: 'HIGH' }
  ]);
  assert.deepEqual(
    app.assignedToSummary().map(g => [g.recipientId, g.name, g.openCount, g.tasks.map(t => t.id).sort()]),
    [
      [2, 'Manager B', 2, [1, 2, 3]],
      [3, 'Manager C', 0, [4]]
    ]
  );
  injector.destroy();
});

test('Today’s Tasks groups personal and received work by user after priority filtering', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'me', displayName: 'Me', roles: ['DIRECTOR'] });
  app.recipients.set([
    { id: 2, username: 'sender-b', displayName: 'Manager B', roles: ['DIRECTOR'] },
    { id: 3, username: 'sender-c', displayName: 'Manager C', roles: ['DIRECTOR'] }
  ]);
  app.todayIso.set('2026-11-23');
  app.selectedDate.set('2026-11-23');
  const tasks = [
    { id: 1, userId: 'me', title: 'Mine high', priority: 'HIGH', status: 'ACTIVE' },
    { id: 2, userId: 'sender-b', assignedByName: 'B', recipientId: 1, title: 'B medium', priority: 'MEDIUM', status: 'ACTIVE' },
    { id: 3, userId: 'sender-c', assignedByName: 'C', recipientId: 1, title: 'C high', priority: 'HIGH', status: 'ACTIVE' },
    { id: 4, userId: 'me', title: 'Mine low', priority: 'LOW', status: 'ACTIVE' },
    { id: 5, userId: 'sender-c', assignedByName: 'C', recipientId: 1, title: 'C medium', priority: 'MEDIUM', status: 'ACTIVE' }
  ];
  const myDay = runInInjectionContext(injector, () => new MyDayComponent());
  myDay.app = app;
  assert.equal(myDay.expandedAgendaGroupKey(), null);
  myDay.toggleAgendaGroup('self');
  assert.equal(myDay.expandedAgendaGroupKey(), 'self');
  myDay.toggleAgendaGroup('user:sender-b');
  assert.equal(myDay.expandedAgendaGroupKey(), 'user:sender-b');
  myDay.toggleAgendaGroup('user:sender-b');
  assert.equal(myDay.expandedAgendaGroupKey(), null);
  assert.deepEqual(myDay.agendaGroups(tasks).map(g => [g.name, g.tasks.map(t => t.id)]), [
    ['Myself', [1, 4]], ['Manager C', [3, 5]], ['Manager B', [2]]
  ]);
  myDay.agendaPriorityFilter.set('HIGH');
  assert.deepEqual(myDay.agendaGroups(myDay.filteredAgendaTasks(tasks)).map(g => [g.name, g.tasks.map(t => t.id)]), [
    ['Myself', [1]], ['Manager C', [3]]
  ]);
  app.selectedDate.set('2026-11-22');
  assert.deepEqual(myDay.agendaGroups(tasks).map(g => [g.name, g.tasks.map(t => t.id)]), [
    ['', [1, 2, 3, 4, 5]]
  ]);
  injector.destroy();
});

test('changing the recipient preserves an existing task status', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.editingTask = { id: 5, recipientId: 2, status: 'IN_PROGRESS', focusDate: '2026-11-04' };
  app.changeRecipient(3);
  assert.equal(app.editingTask.recipientId, 3);
  assert.equal(app.editingTask.status, 'IN_PROGRESS');
  assert.equal(app.editingTask.focusDate, null);
  injector.destroy();
});

test('returning from Admin refreshes task tags after directory changes', () => {
  const requested = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: url => { requested.push(url); return of([]); } } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['SUPER_ADMIN', 'DIRECTOR'] });
  app.activeTab.set('admin');
  app.selectTab('my-day');
  assert.ok(requested.includes('/api/tasks'));
  assert.ok(requested.includes('/api/tasks/recipients'));
  injector.destroy();
});

test('task history page navigation replaces the previous page', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: (_, { params }) => {
      const page = Number(params.get('page'));
      return of({ content: [{ id: page + 1, title: `Page ${page}`, status: 'ACTIVE', priority: 'HIGH' }], totalElements: 100, number: page });
    } } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.loadList(0);
  app.loadList(1);
  assert.deepEqual(app.listTasks().map(task => task.id), [2]);
  assert.equal(app.listPage(), 1);
  injector.destroy();
});

test('minute refresh keeps the current My Tasks history page', () => {
  let tick;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  const pages = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: (url, options) => {
      if (url === '/api/auth/csrf') return of({ token: 'csrf' });
      if (url === '/api/auth/me') return of({ id: 1, username: 'mgr-a', displayName: 'Manager', roles: ['DIRECTOR'] });
      if (url === '/api/tasks/history') {
        const page = Number(options.params.get('page'));
        pages.push(page);
        return of({ content: [{ id: page + 1, title: 'Task', status: 'ACTIVE', priority: 'HIGH' }], totalElements: 150, number: page });
      }
      return of([]);
    } } }
  ], Injector.NULL);
  try {
    const app = runInInjectionContext(injector, () => new AppComponent());
    app.ngOnInit();
    app.selectTab('my-tasks');
    app.loadList(2);
    tick();
    assert.equal(app.listPage(), 2);
    assert.equal(pages.at(-1), 2);
    app.ngOnDestroy();
  } finally {
    globalThis.setInterval = originalSetInterval;
    injector.destroy();
  }
});

test('session startup requests CSRF and account together', () => {
  const csrf = new Subject();
  const requested = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: url => {
      requested.push(url);
      if (url === '/api/auth/csrf') return csrf;
      if (url === '/api/auth/me') return of({ id: 1, username: 'mgr-a', displayName: 'Manager', roles: ['DIRECTOR'] });
      return of([]);
    } } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  try {
    app.ngOnInit();
    assert.deepEqual(requested.slice(0, 2), ['/api/auth/csrf', '/api/auth/me']);
    assert.equal(app.authReady(), false);
    csrf.next({ token: 'csrf' });
    csrf.complete();
    assert.equal(app.authReady(), true);
    assert.equal(app.account()?.username, 'mgr-a');
  } finally {
    app.ngOnDestroy();
    injector.destroy();
  }
});

test('session startup remains usable when no account is signed in', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: url => url === '/api/auth/csrf'
      ? of({ token: 'csrf' }) : throwError(() => ({ status: 401 })) } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  try {
    app.ngOnInit();
    assert.equal(app.authReady(), true);
    assert.equal(app.account(), null);
    assert.equal(app.authError(), '');
  } finally {
    app.ngOnDestroy();
    injector.destroy();
  }
});

test('sign-in explains a temporary login limit', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { post: () => throwError(() => ({ status: 429 })) } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.signInInput = 'manager';
  app.signInPassword = 'wrong';
  app.signIn();
  assert.match(app.authError(), /too many/i);
  injector.destroy();
});

test('switching workspace tabs refreshes a task completed by another manager', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: () => of([{
      id: 1, userId: 'manager-a', recipientId: 2, title: 'Delegated', status: 'COMPLETED', priority: 'HIGH'
    }]) } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.tasks.set([{ id: 1, userId: 'manager-a', recipientId: 2, title: 'Delegated', status: 'ACTIVE', priority: 'HIGH' }]);
  app.selectTab('kanban');
  assert.equal(app.tasks()[0].status, 'COMPLETED');
  injector.destroy();
});

test('an open workspace refreshes changed tasks on its minute tick', () => {
  let tick;
  let taskLoads = 0;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  const account = { id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] };
  const task = status => ({ id: 1, userId: 'manager-a', recipientId: 2,
    title: 'Delegated', status, priority: 'HIGH', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' });
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: url => {
      if (url === '/api/auth/csrf') return of({ token: 'csrf' });
      if (url === '/api/auth/me') return of(account);
      if (url === '/api/tasks') return of([task(taskLoads++ === 0 ? 'ACTIVE' : 'COMPLETED')]);
      return of([]);
    } } }
  ], Injector.NULL);
  try {
    const app = runInInjectionContext(injector, () => new AppComponent());
    app.ngOnInit();
    assert.equal(app.tasks()[0].status, 'ACTIVE');
    tick();
    assert.equal(app.tasks()[0].status, 'COMPLETED');
    app.ngOnDestroy();
  } finally {
    globalThis.setInterval = originalSetInterval;
    injector.destroy();
  }
});

test('Kanban ranks current focus but not expired focus above High priority', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.todayIso.set('2026-11-17');
  app.tasks.set([
    { id: 1, userId: 'manager-b', recipientId: 1, assignedByName: 'B', title: 'Old focus', status: 'ACTIVE', priority: 'MEDIUM', focusDate: '2026-11-16' },
    { id: 2, userId: 'manager-b', recipientId: 1, assignedByName: 'B', title: 'High', status: 'ACTIVE', priority: 'HIGH', focusDate: null },
    { id: 3, userId: 'manager-b', recipientId: 1, assignedByName: 'B', title: 'Today focus', status: 'ACTIVE', priority: 'LOW', focusDate: '2026-11-17' }
  ]);
  assert.deepEqual(app.tasksByStatus().ACTIVE.map(task => task.title), ['Today focus', 'High', 'Old focus']);
  injector.destroy();
});

test('an older employee load cannot restore a deleted directory entry', () => {
  const requests = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: () => {
      const pending = new Subject();
      requests.push(pending);
      return pending;
    } } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.loadEmployees(true);
  app.loadEmployees(true);
  requests[1].next([]);
  requests[0].next([{ id: 9, name: 'Deleted employee' }]);
  assert.deepEqual(app.employees(), []);
  injector.destroy();
});

test('an older recipient load cannot restore a deleted manager', () => {
  const requests = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: () => {
      const pending = new Subject();
      requests.push(pending);
      return pending;
    } } }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.loadRecipients();
  app.loadRecipients();
  requests[1].next([]);
  requests[0].next([{ id: 9, username: 'deleted', displayName: 'Deleted manager', roles: ['DIRECTOR'] }]);
  assert.deepEqual(app.recipients(), []);
  injector.destroy();
});

test('assigned-by label keeps the original sender after ownership transfers', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 2, username: 'manager-b', displayName: 'Manager B', roles: ['DIRECTOR'] });
  app.recipients.set([{ id: 2, username: 'manager-b', displayName: 'Manager B', roles: ['DIRECTOR'] }]);
  assert.equal(app.assignmentLabel({ userId: 'manager-b', recipientId: 2, assignedByName: 'Manager A' }), 'Assigned by Manager A');
  injector.destroy();
});

test('MyDayComponent View All Tasks combines assigned tasks across recipients', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.recipients.set([
    { id: 2, username: 'ronak', displayName: 'Ronak Shetty', roles: ['DIRECTOR'] },
    { id: 3, username: 'st', displayName: 'ST', roles: ['DIRECTOR'] }
  ]);
  app.tasks.set([
    { id: 1, userId: 'manager-a', recipientId: 2, title: 'Low open', status: 'ACTIVE', priority: 'LOW' },
    { id: 2, userId: 'manager-a', recipientId: 3, title: 'High open', status: 'IN_PROGRESS', priority: 'HIGH' },
    { id: 3, userId: 'manager-a', recipientId: 2, title: 'Done', status: 'COMPLETED', priority: 'HIGH' }
  ]);
  const myDay = runInInjectionContext(injector, () => new MyDayComponent());
  myDay.app = app;
  myDay.openAssignee('ALL');
  const all = myDay.selectedAssignee();
  assert.equal(all?.name, 'All Assigned Tasks');
  assert.equal(all?.openCount, 2);
  assert.deepEqual(all?.tasks.map(t => t.id), [2, 1, 3]);
  myDay.openAssignee(2);
  assert.equal(myDay.selectedAssignee()?.name, 'Ronak Shetty');
  assert.deepEqual(myDay.selectedAssignee()?.tasks.map(t => t.id), [1, 3]);
  assert.equal(myDay.initials('Ronak Shetty'), 'RS');
  assert.equal(myDay.initials('ST'), 'ST');
  assert.equal(myDay.countByPriority(all.tasks, 'HIGH'), 2);
  myDay.agendaPriorityFilter.set('HIGH');
  assert.deepEqual(myDay.filteredAgendaTasks(all.tasks).map(t => t.id), [2, 3]);
  assert.equal(myDay.dailyProgressPct(), 0);

  // Drawer search + status + priority filters (openAssignee defaults to OPEN when pending work exists).
  myDay.openAssignee('ALL');
  assert.equal(myDay.drawerStatus(), 'OPEN');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [2, 1]);
  assert.equal(myDay.countByStatus(all.tasks, 'ACTIVE'), 1);
  assert.equal(myDay.countByStatus(all.tasks, 'IN_PROGRESS'), 1);
  assert.equal(myDay.countByStatus(all.tasks, 'COMPLETED'), 1);
  myDay.drawerSearch.set('high');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [2]);
  myDay.drawerSearch.set('ronak');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [1]);
  myDay.openAssignee('ALL');
  myDay.drawerStatus.set('COMPLETED');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [3]);
  myDay.drawerStatus.set('ALL');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [2, 1, 3]);
  myDay.drawerPriority.set('HIGH');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [2, 3]);
  myDay.resetDrawerFilters();
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [2, 1, 3]);

  // Inline note expansion and editFromDrawer preserve filters without clearing selectedAssigneeId.
  myDay.toggleNoteExpanded(1);
  assert.equal(myDay.expandedNoteIds().has(1), true);
  myDay.toggleNoteExpanded(1);
  assert.equal(myDay.expandedNoteIds().has(1), false);
  myDay.drawerSearch.set('low');
  myDay.editFromDrawer(app.tasks()[0]);
  assert.equal(app.editDialogOpen(), true);
  assert.equal(myDay.drawerSearch(), 'low');
  myDay.onDialogClose();
  assert.equal(myDay.selectedAssigneeId(), 'ALL');

  // Assignees with only completed tasks default to ALL so the drawer does not open empty.
  app.tasks.set([
    { id: 10, userId: 'manager-a', recipientId: 2, title: 'Finished only', status: 'COMPLETED', priority: 'MEDIUM' }
  ]);
  myDay.openAssignee(2);
  assert.equal(myDay.drawerStatus(), 'ALL');
  assert.deepEqual(myDay.drawerTasks().map(t => t.id), [10]);
  injector.destroy();
});

test('horizonMonthStats and avatarTone summarize the displayed month and assign stable tones', () => {
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: {} }
  ], Injector.NULL);
  const app = runInInjectionContext(injector, () => new AppComponent());
  app.account.set({ id: 1, username: 'manager-a', displayName: 'A', roles: ['DIRECTOR'] });
  app.todayIso.set('2026-11-23');
  app.selectedDate.set('2026-11-23');
  app.tasks.set([
    { id: 1, userId: 'manager-a', title: 'Today high', status: 'ACTIVE', priority: 'HIGH', createdAt: '2026-11-23T06:00:00Z' },
    { id: 2, userId: 'manager-a', title: 'Today low', status: 'ACTIVE', priority: 'LOW', createdAt: '2026-11-23T07:00:00Z' },
    { id: 3, userId: 'manager-a', title: 'Past done', status: 'COMPLETED', priority: 'MEDIUM', createdAt: '2026-11-10T06:00:00Z', completedAt: '2026-11-17T06:00:00Z' }
  ]);

  assert.deepEqual(app.horizonMonthStats(), { totalTasks: 3, activeDays: 2, highCount: 1 });
  const toneA = app.avatarTone('Ronak Shetty');
  assert.equal(toneA, app.avatarTone('  ronak shetty '));
  assert.ok(toneA >= 0 && toneA < 6);
  assert.equal(app.initials('Shabbir Engineer'), 'SE');
  injector.destroy();
});
