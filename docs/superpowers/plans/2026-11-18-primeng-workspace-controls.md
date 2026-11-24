# PrimeNG Workspace Controls Implementation Plan

> **For agentic workers:** Implement this plan task by task with test-first checks.

**Goal:** Use PrimeNG Select for task assignment, Tag for task priority/status, and Toast for workspace save/error feedback.

**Architecture:** Keep existing task state, API calls, and CDK Kanban behavior. Add PrimeNG modules only to the standalone components that render them; use the existing feedback signals to feed Toast.

**Tech Stack:** Angular 21 standalone components, PrimeNG 21, Playwright.

**Spec:** User approval of the three proposed placements in this conversation.

## Tasks

- [x] Add a failing browser check for searchable Assign To and preserved recipient selection; replace the native task-editor recipient select with PrimeNG Select; rerun the check.
- [x] Add a failing browser check for PrimeNG priority/status Tags on My Tasks and Kanban cards; replace only the display pills; rerun the check.
- [x] Add a failing browser check for PrimeNG Toast on save and error feedback; connect existing workspace signals to Toast; rerun the check.
- [x] Run frontend unit tests, production build, browser suite and mobile-width checks; review affected controls for regressions.

## Review Focus

- Assignment keeps `null` for Myself and numeric account IDs for managers.
- Completed tasks still prohibit reassignment.
- Tags remain readable in light and dark themes and do not block dragging.
- Toast feedback is visible on narrow screens and errors remain accessible.
- Existing task CRUD, sign-in, and Kanban browser flows still pass.
