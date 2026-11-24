import test from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { build } from 'esbuild';
import { createEnvironmentInjector, Injector, runInInjectionContext, ɵChangeDetectionScheduler, ɵEffectScheduler } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConfirmationService } from 'primeng/api';
import { Subject } from 'rxjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const source = fileURLToPath(new URL('./admin/admin.component.ts', import.meta.url));
const output = resolve('node_modules/.cache/admin-component-test.mjs');
await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
const { AdminComponent } = await import(pathToFileURL(output).href);

test('late Admin loads cannot restore deleted employees or managers', () => {
  const requests = [];
  const injector = createEnvironmentInjector([
    { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
    { provide: ɵEffectScheduler, useValue: { add() {}, remove() {} } },
    { provide: ConfirmationService, useValue: { confirm() {} } },
    { provide: HttpClient, useValue: { get: url => {
      const pending = new Subject();
      requests.push({ url, pending });
      return pending;
    } } }
  ], Injector.NULL);
  const admin = runInInjectionContext(injector, () => new AdminComponent());
  admin.loadEmployees();
  admin.loadEmployees();
  requests[1].pending.next([]);
  requests[0].pending.next([{ id: 9, name: 'Deleted employee' }]);
  assert.deepEqual(admin.employees(), []);
  admin.load();
  admin.load();
  requests[3].pending.next([]);
  requests[2].pending.next([{ id: 7, username: 'deleted', displayName: 'Deleted manager', roles: ['DIRECTOR'] }]);
  assert.deepEqual(admin.managers(), []);
  assert.deepEqual(admin.roleBadges(['DIRECTOR', 'SUPER_ADMIN']), [
    { label: 'Director', isSuper: false },
    { label: 'Super Admin', isSuper: true }
  ]);
  assert.equal(admin.initials('Ronak Shetty'), 'RS');
  assert.equal(admin.avatarTone('Ronak Shetty'), admin.avatarTone(' ronak shetty '));
  injector.destroy();
});
