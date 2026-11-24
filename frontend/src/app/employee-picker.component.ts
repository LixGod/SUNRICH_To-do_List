import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';

export interface PickableEmployee { id: number; name: string }

// Searchable multi-select for large employee lists (e.g. 1300).
@Component({
  selector: 'app-employee-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule],
  template: `
    <div class="emp-picker">
      <div class="emp-selected">
        @for (e of selectedEmployees(); track e.id) {
          <span class="emp-chip">{{ e.name }}
            <button type="button" class="emp-chip-x" (click)="toggle(e.id)" aria-label="Remove">×</button>
          </span>
        } @empty {
          <span class="emp-muted">No employees assigned</span>
        }
      </div>

      <button type="button" class="emp-toggle" (click)="open.set(!open())">
        <span class="material-symbols-outlined inline-ic">{{ open() ? 'check' : 'group_add' }}</span>
        {{ open() ? 'Done selecting' : ('Add / search employees (' + totalCount() + ')') }}
      </button>

      @if (open()) {
        <div class="emp-dropdown">
          <input type="text" class="emp-search" [ngModel]="search()" (ngModelChange)="search.set($event)"
            name="empSearch" placeholder="Search among {{ totalCount() }} employees by name…" autocomplete="off">
          <cdk-virtual-scroll-viewport class="emp-list" itemSize="44">
            <label class="emp-option" *cdkVirtualFor="let e of filtered(); trackBy: trackById">
                <input type="checkbox" [checked]="isSel(e.id)" (change)="toggle(e.id)"> {{ e.name }}
            </label>
          </cdk-virtual-scroll-viewport>
          @if (filtered().length === 0) {
            <p class="emp-muted">No matches.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .emp-picker { display: flex; flex-direction: column; gap: 8px; }
    .emp-selected { display: flex; flex-wrap: wrap; gap: 6px; }
    .emp-chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px 3px 10px;
      border-radius: 999px; font-size: 0.75rem; font-weight: 600;
      background: var(--primary-tint); color: var(--primary); border: 1px solid var(--primary-fixed);
    }
    .emp-chip-x { background: none; border: none; color: inherit; cursor: pointer; font-size: 0.95rem; line-height: 1; width: 32px; height: 32px; }
    @media (pointer: coarse), (max-width: 600px) {
      .emp-chip-x { min-width: 44px; min-height: 44px; }
    }
    .emp-muted { font-size: 0.78rem; color: var(--secondary); margin: 2px 0; }
    .emp-toggle {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; min-height: 44px; border-radius: 8px; cursor: pointer; font-size: 0.8125rem; font-weight: 600;
      background: var(--surface-lowest); color: var(--on-surface); border: 1px solid var(--border);
    }
    .emp-toggle:hover { background: var(--surface-container); }
    .emp-dropdown {
      border: 1px solid var(--border); border-radius: 10px; padding: 10px;
      background: var(--surface-low); display: flex; flex-direction: column; gap: 6px;
    }
    .emp-search {
      width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
      background: var(--surface-lowest); color: var(--on-surface); border: 1px solid var(--border);
      font-size: 0.85rem; outline: none;
    }
    .emp-search:focus { border-color: var(--primary-container); }
    .emp-list { height: 220px; }
    .emp-option {
      display: flex; align-items: center; gap: 8px; padding: 0 8px; border-radius: 6px;
      box-sizing: border-box; height: 44px;
      cursor: pointer; font-size: 0.85rem; color: var(--on-surface);
    }
    .emp-option:hover { background: var(--surface-container); }
    .emp-option input[type="checkbox"] { accent-color: var(--primary-container); cursor: pointer; }
    .inline-ic { font-size: 1rem; }
  `]
})
export class EmployeePickerComponent {
  private _employees = signal<PickableEmployee[]>([]);
  @Input() set employees(v: PickableEmployee[] | null) { this._employees.set(v ?? []); }
  // Bound array is mutated in place so the parent form sees selections without extra wiring.
  @Input() selected: number[] = [];

  readonly open = signal(false);
  readonly search = signal('');
  readonly totalCount = computed(() => this._employees().length);
  private byId = computed(() => new Map(this._employees().map(e => [e.id, e])));

  private matches = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = this._employees();
    return q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;
  });
  readonly filtered = this.matches;
  trackById = (_: number, employee: PickableEmployee) => employee.id;

  selectedEmployees(): PickableEmployee[] {
    const map = this.byId();
    return this.selected.map(id => map.get(id)).filter((e): e is PickableEmployee => !!e);
  }
  isSel(id: number): boolean { return this.selected.includes(id); }
  toggle(id: number): void {
    const i = this.selected.indexOf(id);
    if (i >= 0) this.selected.splice(i, 1); else this.selected.push(id);
  }
}
