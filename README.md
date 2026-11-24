# Sunrich Personal Planner

An Angular and Kotlin Spring Boot planner for Senior Management. Managers see tasks they created or received. A Super Admin creates, edits and deletes manager accounts; tasks assigned to another manager remain with that recipient if the creator's account is deleted.

## Deploy from GitHub

Use this repository as one source with separate service roots:

1. In Railway, create a MySQL service and a backend service. Connect the backend service to this repository, set its root directory to `backend`, and use its Dockerfile. Set `DB_URL` to a JDBC URL such as `jdbc:mysql://${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/${{MySQL.MYSQLDATABASE}}`, `DB_USER` to `${{MySQL.MYSQLUSER}}`, and `DB_PASS` to `${{MySQL.MYSQLPASSWORD}}` using Railway service references. Set `APP_ADMIN_USERNAME` and a unique `APP_ADMIN_PASSWORD` (at least 12 characters) before the first startup. Generate a public domain for the backend. Railway supplies `PORT`; Spring Boot listens on it.
2. In Vercel, import the same repository with Root Directory `frontend`. Set the `API_ORIGIN` environment variable to the backend's public HTTPS origin, such as `https://your-backend.up.railway.app` (no path). The frontend's `vercel.mjs` builds Angular and forwards same-origin `/api` requests to Railway, so browser login cookies remain on the Vercel origin. Deploy after the Railway backend has a public domain.

Keep database passwords and initial admin credentials in Railway variables, not in Git. Do not use the local H2 profile for a Railway deployment: its filesystem is ephemeral. The existing Jenkins/Compose deployment is independent of these two services.

## Run locally

Use Java 21 and Node 22.18 or newer. Start the backend from `backend/` with an initial admin email and a unique password of at least 12 characters:

```powershell
$env:APP_ADMIN_USERNAME = 'admin@example.com'
$env:APP_ADMIN_PASSWORD = 'replace-with-a-strong-unique-password'
.\gradlew.bat bootRun --args='--spring.profiles.active=local'
```

The `local` profile stores data in `backend/data/sunrich_todo.mv.db`. The bootstrap credentials create the Super Admin only when the user table is empty. Change the password in Profile & Settings after the first sign-in.

If this workspace has tasks from the earlier demo sign-in, create a manager with the same email address to make those tasks available to that manager.

Start the frontend from `frontend/`:

```powershell
npm ci
npm start
```

Open <http://localhost:4200/>. The frontend proxy sends `/api` requests to port 8000. If those ports are in use, run the backend with `--server.port=8081`, then use `npm start -- --port 4201 --proxy-config proxy.local.conf.json` and open <http://localhost:4201/>.

For a browser on the same Wi-Fi, start the frontend with `npm start -- --host 0.0.0.0` and open `http://<this-computer's-LAN-IP>:4200/`. The API stays on the same link through the frontend proxy. This development link is for testing; phone PWA installation requires the HTTPS setup below.

## Docker Compose

Copy `.env.example` to `.env`, replace every example secret, then run `docker compose up --build -d`. Open <http://localhost:8088/>. Compose runs MySQL 8.4, the API and the Angular site. `.env` is excluded from Git. The MySQL database is kept in a named Docker volume.

Compose binds the site to `127.0.0.1:8088` for local use. For access from other machines or PWA installation on a phone, put an HTTPS reverse proxy on the same host in front of that port and forward `X-Forwarded-Proto`; do not publish the HTTP port directly.

### Host on the local network with HTTPS

Start the local H2 backend as described above. Set `LAN_HOST` to this computer's current Wi-Fi/LAN IP address (for example, `192.168.6.81`), then serve a production frontend through the local HTTPS proxy:

```powershell
$env:LAN_HOST = '192.168.6.81' # replace with this computer's LAN IP
docker compose -f compose.lan.yaml up --build -d
```

On a phone connected to the same network, open `https://<LAN_HOST>:8443/`. The frontend, the running local backend, and PWA files are served from that one address. The local H2 data is kept in `backend/data/sunrich_todo.mv.db`; keep the backend process running. `LAN_HTTPS_PORT` can change port 8443. Keep `LAN_HOST` stable if possible; an IP address change creates a different PWA origin.

The local HTTPS proxy creates its own certificate authority. Export its **public root certificate** after starting it:

```powershell
docker compose -f compose.lan.yaml cp lan-proxy:/data/caddy/pki/authorities/local/root.crt ./lan-root.crt
```

Install and trust `lan-root.crt` on each phone before opening the link. This trust step is required for the browser to treat the local HTTPS link as secure and install the PWA. If the phone cannot connect, allow inbound TCP port 8443 in the host firewall. The separate `compose.yaml` setup remains available for a MySQL deployment; it does not automatically copy the local H2 data.

Sign-in uses a 30-day, HttpOnly cookie backed by a revocable token in the database, without an HTTP session. Five failed sign-in attempts for one username pause further attempts for up to 10 minutes; the counter clears after a successful sign-in. Closing or reopening the installed PWA keeps the user signed in until sign-out, token expiry, or an account security change. An existing user must sign in once after this upgrade. The installed app name and icon come from the PWA manifests and the website's Sunrich logo. The site selects a white or black logo background from the phone's light or dark theme. The phone launcher controls when an already installed icon refreshes; reinstall the PWA if its Home Screen icon stays on the old background.

MySQL schema changes run through Flyway migrations in `backend/src/main/resources/db/migration/`. A new database runs `V1__initial_schema.sql` and `V2__persistent_logins.sql`. On the first startup against an existing Hibernate-created database, Flyway records version 1 without recreating tables, applies version 2, then Hibernate validates the schema. Back up and review that existing schema before this first migration-enabled deployment. The local H2 profile continues to update its own development schema automatically.

## Jenkins

The `Jenkinsfile` tests the API and frontend, runs the browser smoke test, builds both Docker images, and deploys `main` with Compose on the Jenkins host. The agent needs Java 21, Node 22.18 or newer, Docker, Compose, curl, and the Linux libraries required by Playwright Chromium. Create Jenkins secret-text credentials named `sunrich-admin-email`, `sunrich-admin-password`, `sunrich-db-password` and `sunrich-mysql-root-password`. Configure the pipeline from this repository's `Jenkinsfile`. Before deploying, provision the HTTPS reverse proxy described above and set `APP_PUBLIC_URL` in the Jenkins job to its public base URL (for example, `https://tasks.example.com`). The deploy stage fails if the URL is missing or if the site and API cannot be reached through HTTPS after startup.

## Code map

- `backend/src/main/kotlin/com/sunrich/todo/Auth.kt`: account, login, role and admin APIs.
- `backend/src/main/kotlin/com/sunrich/todo/TodoApplication.kt`: tasks and history API.
- `frontend/src/app/admin/`: Super Admin screen.
- `frontend/src/app/app.component.*`: sign-in, My Day, My Tasks and profile screens.

The task store lets each Senior Management member create personal tasks or assign one recipient from Senior Management. My Day shows open tasks assigned by others in Today's Tasks, and tasks sent to others in Assigned To. The recipient controls task status; the sender tracks it in Assigned To. Unfinished work carries into each new day automatically. The calendar shows today's actionable tasks and completed tasks on their completion day in the Asia/Kolkata time zone. Actionable task history is fetched in pages of 50. FTP, Gmail and Nagios integration await the client's details.

## Verify

Run `backend/gradlew.bat test` from `backend/`, and `npm test` plus `npm run build` from `frontend/`.

For the signed-in browser flow, run `npx playwright install --only-shell chromium` once and then `npm run test:e2e` from `frontend/`. This starts a temporary in-memory backend on port 8081 and the frontend on port 4201; both ports must be free.
