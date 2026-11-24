import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import type { AppComponent } from './app.component';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { SelectButtonModule } from 'primeng/selectbutton';

@Component({
  selector: 'app-kanban',
  standalone: true,
  imports: [FormsModule, DragDropModule, TagModule, SkeletonModule, TooltipModule, SelectButtonModule],
  templateUrl: './kanban.component.html'
})
export class KanbanComponent {
  readonly priorityOptions = [
    { label: 'All Priorities', value: 'ALL' },
    { label: 'High', value: 'HIGH' },
    { label: 'Medium', value: 'MEDIUM' },
    { label: 'Low', value: 'LOW' }
  ];
  @Input({ required: true }) app!: AppComponent;

}
