# Sunrich To-Do Workspace test report

Tested 18 November 2026 against the local checkout. This report records executed checks, not a guarantee that every possible input, device, or production environment is defect free.

## Results

| Area | Executed checks | Result |
| --- | --- | --- |
| Backend unit and controller integration | `backend/gradlew.bat test --rerun-tasks --no-daemon` | 45 passed, 0 failed/skipped |
| Frontend unit | `npm test` in `frontend` | 25 passed |
| Browser functional, Chromium | `npm run test:e2e` in `frontend` | 4 passed |
| Frontend production build | `npm run build` in `frontend` | Passed |
| Docker builds | `docker build -t sunrich-todo-frontend:qa frontend`; equivalent backend build | Both passed |
| Deployment configuration | `docker compose --env-file .env.example config --quiet` | Passed |
| Real database/API integration | Fresh isolated MySQL 8.4, production Spring profile on port 8082 | Flyway V1/V2 and HTTP checks passed |
| Production static serving | Frontend QA image on localhost:18080 | HTML, both PWA manifests, both tested icons, service worker, and `ngsw.json` served; correct MIME types |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` | 0 reported vulnerabilities |
| Full dependency audit | `npm audit --audit-level=high` | 29 advisories in development/build dependencies: 13 high, 16 moderate |

## Positive and negative cases exercised

| Area | Positive case | Negative or boundary case |
| --- | --- | --- |
| Sign in and permissions | Admin and manager sign in, profile and role access | Wrong password, anonymous request, typed user header, manager accessing admin API |
| Persistent login | Login survives browser/backend restart with MySQL | Expired token, logout, password change, role change, account rename/deletion revoke access |
| Request protection | Authenticated task and account writes | Missing CSRF token, invalid account input, duplicate username races |
| Tasks | Create, edit, complete, assign, reassign, list, page, filter, and delete | Empty title, oversized title/notes, nonexistent employee tags, cross-manager access, unauthorized completion |
| Concurrent writes | Task/account update and deletion races | Stale responses and lock ordering must not restore deleted data or undo newer writes |
| Browser workflow | Admin creates manager; manager signs in and creates/edits/deletes task | Invalid login, disabled blank-task save, Escape closes dialog, delete cancellation |
| Kanban | Desktop and narrow-screen lane changes persist after reload; Chromium touch input changes lane | No status change assumed until API returns success |
| Responsive UI | My Day, My Tasks, Kanban, Admin, and profile at 320, 390, 768, 1024, and 1440 CSS-pixel widths | Horizontal overflow and clipped profile dialog checked at each width |
| PWA | Light/dark manifest names, colors and icons; service worker/static files served | Theme switch updates manifest and Apple touch icon |

The production Nginx image initially served `.webmanifest` as `application/octet-stream`. `frontend/nginx.conf` now serves `application/manifest+json`; the rebuilt image returned that type for both manifests.

## Environment limits and follow-up

- Firefox could not launch on this Windows host (`spawn UNKNOWN`). WebKit could not launch because `libpng16.dll` is missing. These runs did not reach the application; Chromium completed all browser cases.
- No physical Android/iPhone, tablet, or foldable was available. Browser viewport and synthetic touch checks do not prove installed PWA behavior on those devices.
- The MySQL test used a fresh database. An upgrade of an existing production database and deployment behind public HTTPS were not exercised.
- The full npm audit reports 29 development/build-chain advisories, including a `picomatch` advisory affecting the installed and current published 4.x releases. The production-only audit reports zero. No dependency downgrade was made without a supported fix.
- The HTTP test denies manager admin access and requests without CSRF with 401; MockMvc reports 403 for those two denials. Access was blocked in both environments, but clients should not rely on a specific status until this is reconciled.
- No branch/line coverage percentage was collected. Passing suites do not establish that every control, input combination, accessibility path, or hardware integration has been tested.
