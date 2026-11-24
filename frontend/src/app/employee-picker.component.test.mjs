import test from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const source = fileURLToPath(new URL('./employee-picker.component.ts', import.meta.url));
const output = resolve('node_modules/.cache/employee-picker-test.mjs');
await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output });
const { EmployeePickerComponent } = await import(pathToFileURL(output).href);

test('employee picker keeps the entire directory reachable without a 100-row cap', () => {
  const picker = new EmployeePickerComponent();
  picker.employees = Array.from({ length: 1300 }, (_, i) => ({ id: i + 1, name: `Employee ${i + 1}` }));
  assert.equal(picker.filtered().length, 1300);
  picker.search.set('Employee 1300');
  assert.deepEqual(picker.filtered().map(employee => employee.id), [1300]);
});
