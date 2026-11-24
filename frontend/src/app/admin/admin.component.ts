import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { PasswordModule } from 'primeng/password';
import { TableModule } from 'primeng/table';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';

type Role = 'SUPER_ADMIN' | 'CHAIRMAN' | 'VICE_PRESIDENT' | 'MANAGING_DIRECTOR' | 'DIRECTOR' | 'ASSISTANT_VICE_PRESIDENT';

interface Manager { id: number; username: string; displayName: string; roles: Role[] }

// Exactly one of these may be held at a time; SUPER_ADMIN is an independent add-on (see save()).
const SENIOR_ROLES: { value: Role; label: string }[] = [
  { value: 'CHAIRMAN', label: 'Chairman' },
  { value: 'VICE_PRESIDENT', label: 'Vice President' },
  { value: 'MANAGING_DIRECTOR', label: 'Managing Director' },
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'ASSISTANT_VICE_PRESIDENT', label: 'Assistant Vice President' }
];
const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin', CHAIRMAN: 'Chairman', VICE_PRESIDENT: 'Vice President',
  MANAGING_DIRECTOR: 'Managing Director', DIRECTOR: 'Director', ASSISTANT_VICE_PRESIDENT: 'Assistant Vice President'
};

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, PasswordModule, TableModule, MessageModule, InputTextModule, SelectModule, ButtonModule, ConfirmDialogModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit {
  private http = inject(HttpClient);
  private confirmation = inject(ConfirmationService);
  readonly seniorRoles = SENIOR_ROLES;
  managers = signal<Manager[]>([]);
  managerSearch = '';
  private managerRequestId = 0;
  busy = signal(false);
  error = signal('');
  message = signal('');
  editingId: number | null = null;
  username = '';
  displayName = '';
  password = '';
  seniorRole: Role | '' = '';
  superAdmin = false;

  // Employee directory — reminder-only people with no portal access, tagged on tasks.
  employees = signal<{ id: number; name: string }[]>([]);
  private employeeRequestId = 0;
  employeeName = '';
  employeeSearch = '';

  private matchedEmployees(): { id: number; name: string }[] {
    const q = this.employeeSearch.trim().toLowerCase();
    const list = this.employees();
    return q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;
  }
  filteredEmployees(): { id: number; name: string }[] { return this.matchedEmployees(); }
  employeeTotal(): number { return this.matchedEmployees().length; }
  filteredManagers(): Manager[] {
    const query = this.managerSearch.trim().toLowerCase();
    return query ? this.managers().filter(user => `${user.displayName} ${user.username} ${this.roleLabels(user.roles)}`.toLowerCase().includes(query)) : this.managers();
  }

  roleLabels(roles: Role[]): string { return roles.map(r => ROLE_LABELS[r]).join(', '); }

  roleBadges(roles: Role[]): { label: string; isSuper: boolean }[] {
    return roles.map(r => ({ label: ROLE_LABELS[r], isSuper: r === 'SUPER_ADMIN' }));
  }

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  avatarTone(name: string): number {
    let hash = 0;
    const key = name.trim().toLowerCase();
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(hash) % 6;
  }

  get valid(): boolean {
    return !!this.username.trim() && !!this.displayName.trim() && !!this.seniorRole
      && (!!this.editingId || this.password.length >= 8);
  }

  constructor() {
    effect(onCleanup => {
      if (!this.message()) return;
      const t = setTimeout(() => this.message.set(''), 5000);
      onCleanup(() => clearTimeout(t));
    });
  }

  ngOnInit(): void { this.load(); this.loadEmployees(); }

  loadEmployees(): void {
    const requestId = ++this.employeeRequestId;
    this.http.get<{ id: number; name: string }[]>('/api/employees').subscribe({
      next: list => { if (requestId === this.employeeRequestId) this.employees.set(list); },
      error: () => { if (requestId === this.employeeRequestId) this.error.set('Could not load employees. Please retry.'); }
    });
  }

  addEmployee(): void {
    const name = this.employeeName.trim();
    if (!name) return;
    this.http.post('/api/admin/employees', { name }).subscribe({
      next: () => { this.employeeName = ''; this.message.set('Employee added.'); this.loadEmployees(); },
      error: () => this.error.set('Could not add employee. Please retry.')
    });
  }

  removeEmployee(id: number, name: string): void {
    this.confirmation.confirm({
      key: 'admin-delete', header: 'Remove employee?', message: `Remove ${name} from the employee list?`,
      acceptLabel: 'Remove', rejectLabel: 'Cancel', accept: () => this.deleteEmployee(id)
    });
  }

  private deleteEmployee(id: number): void {
    this.http.delete(`/api/admin/employees/${id}`).subscribe({
      next: () => { this.message.set('Employee removed.'); this.loadEmployees(); },
      error: () => this.error.set('Could not remove employee. Please retry.')
    });
  }

  load(): void {
    const requestId = ++this.managerRequestId;
    this.http.get<Manager[]>('/api/admin/users').subscribe({
      next: users => { if (requestId === this.managerRequestId) this.managers.set(users); },
      error: () => { if (requestId === this.managerRequestId) this.error.set('Could not load managers. Please retry.'); }
    });
  }

  edit(user: Manager): void {
    this.editingId = user.id;
    this.username = user.username;
    this.displayName = user.displayName;
    this.password = '';
    this.seniorRole = user.roles.find(r => r !== 'SUPER_ADMIN') ?? '';
    this.superAdmin = user.roles.includes('SUPER_ADMIN');
    this.error.set('');
  }

  reset(): void {
    this.editingId = null;
    this.username = '';
    this.displayName = '';
    this.password = '';
    this.seniorRole = '';
    this.superAdmin = false;
  }

  save(): void {
    if (!this.valid) return;
    this.busy.set(true);
    this.error.set('');
    const roles: Role[] = [this.seniorRole as Role, ...(this.superAdmin ? ['SUPER_ADMIN' as Role] : [])];
    const body = {
      username: this.username.trim(), displayName: this.displayName.trim(), roles,
      ...(this.password ? { password: this.password } : {})
    };
    const request = this.editingId
      ? this.http.put<Manager>(`/api/admin/users/${this.editingId}`, body)
      : this.http.post<Manager>('/api/admin/users', body);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.message.set(this.editingId ? 'Manager updated.' : 'Manager created.');
        this.reset();
        this.load();
      },
      error: err => {
        this.busy.set(false);
        this.error.set(err.status === 409 ? 'This username is already in use.' : 'Could not save manager. Check the details and try again.');
      }
    });
  }

  remove(user: Manager): void {
    this.confirmation.confirm({
      key: 'admin-delete', header: 'Delete manager?',
      message: `Delete ${user.displayName}? Their personal tasks will be deleted. Tasks assigned to other managers will stay with those managers.`,
      acceptLabel: 'Delete manager', rejectLabel: 'Cancel', accept: () => this.deleteManager(user)
    });
  }

  private deleteManager(user: Manager): void {
    this.busy.set(true);
    this.http.delete(`/api/admin/users/${user.id}`).subscribe({
      next: () => {
        this.busy.set(false);
        this.message.set('Manager deleted.');
        if (this.editingId === user.id) this.reset();
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not delete manager. Please retry.');
      }
    });
  }
}
