import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:4201' },
  webServer: [
    {
      command: process.platform === 'win32' ? 'gradlew.bat bootRun --no-daemon' : './gradlew bootRun --no-daemon',
      cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
      url: 'http://localhost:8081/api/auth/csrf',
      timeout: 120_000,
      env: {
        SPRING_PROFILES_ACTIVE: 'local',
        SPRING_DATASOURCE_URL: 'jdbc:h2:mem:planner_e2e;MODE=MySQL;DB_CLOSE_DELAY=-1',
        SERVER_PORT: '8081',
        APP_ADMIN_USERNAME: 'e2e-admin@example.com',
        APP_ADMIN_PASSWORD: 'E2eAdminPassword123!'
      }
    },
    {
      command: 'npx ng serve --port 4201 --proxy-config proxy.local.conf.json',
      url: 'http://localhost:4201',
      timeout: 120_000
    }
  ]
});
