import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import type { AppComponent } from './app.component';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { SelectButtonModule } from 'primeng/selectbutton';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressBarModule } from 'primeng/progressbar';
import { Menu, MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';
import type { Task } from './app.component';

@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [FormsModule, ScrollingModule, DecimalPipe, DatePipe, TagModule, SkeletonModule, TooltipModule, SelectButtonModule, PaginatorModule, ProgressBarModule, MenuModule],
  templateUrl: './my-tasks.component.html'
})
export class MyTasksComponent implements AfterViewInit {
  readonly statusOptions = [
    { label: 'Active', value: 'ACTIVE' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'All', value: 'ALL' }
  ];
  @Input({ required: true }) app!: AppComponent;
  @ViewChild(CdkVirtualScrollViewport) viewport?: CdkVirtualScrollViewport;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('taskMenu') taskMenu?: Menu;
  taskMenuItems: MenuItem[] = [];

  openTaskMenu(event: Event, task: Task): void {
    this.taskMenuItems = [
      ...(this.app.canChangeStatus(task) ? [{ label: task.status === 'COMPLETED' ? 'Reopen task' : 'Complete task', icon: 'pi pi-check', command: () => this.app.toggleComplete(task) }] : []),
      ...(this.app.canEdit(task) ? [
        { label: 'Edit task', icon: 'pi pi-pencil', command: () => this.app.openEdit(task) },
        { label: 'Delete task', icon: 'pi pi-trash', command: () => this.app.confirmDelete(task) }
      ] : [])
    ];
    this.taskMenu?.toggle(event);
  }

  ngAfterViewInit(): void {
    if (this.app.focusSearchOnLoad) {
      this.searchInput?.nativeElement.focus();
      this.app.focusSearchOnLoad = false;
    }
  }

  onPageChange(page: number): void {
    this.app.loadList(page);
    this.viewport?.scrollToIndex(0);
  }
}
