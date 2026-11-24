import { test, expect } from '@playwright/test';

test('PWA icon background follows the phone theme', async ({ page, browserName }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest-dark\.webmanifest$/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /icon-180x180-dark\.png$/);
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp) await expect.poll(async () => (await cdp.send('Page.getAppManifest')).url).toMatch(/manifest-dark\.webmanifest$/);
  const darkManifest = await (await page.request.get('/manifest-dark.webmanifest')).json();
  expect(darkManifest.background_color).toBe('#000000');
  expect(darkManifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest$/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /icon-180x180\.png$/);
  if (cdp) await expect.poll(async () => (await cdp.send('Page.getAppManifest')).url).toMatch(/manifest\.webmanifest$/);
  const lightManifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(lightManifest.background_color).toBe('#ffffff');
  expect(lightManifest.id).toBe(darkManifest.id);
});

test('admin creates a manager who can create, edit, and delete a task', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('textbox', { name: 'Username' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-admin@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await expect(page.getByRole('alert')).toContainText('Username or password is incorrect');
  await expect(page.getByRole('tab', { name: 'Admin Module' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Password' }).fill('E2eAdminPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await page.getByRole('tab', { name: 'Admin Module' }).click();
  await expect(page.getByRole('heading', { name: 'Manager accounts' })).toBeVisible();
  await expect(page.locator('app-admin p-table')).toHaveCount(2);
  await expect(page.locator('app-admin p-message')).toHaveCount(2);
  await expect(page.locator('app-admin p-password[name="password"]')).toBeVisible();

  await page.getByRole('textbox', { name: 'Display name' }).fill('Browser Test Manager');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-manager@example.com');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Director', exact: true }).click();
  await page.getByRole('textbox', { name: 'Initial password' }).fill('E2eManagerPassword123!');
  const passwordInput = page.locator('app-admin p-password[name="password"] input');
  await page.locator('app-admin p-password[name="password"] svg[data-p-icon="eye"]').click();
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await page.locator('app-admin p-password[name="password"] svg[data-p-icon="eyeslash"]').click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Add manager' }).click();
  await expect(page.getByText('e2e-manager@example.com')).toBeVisible();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Recipient Test Manager');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-recipient@example.com');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Director', exact: true }).click();
  await page.getByRole('textbox', { name: 'Initial password' }).fill('E2eRecipientPassword123!');
  await page.getByRole('button', { name: 'Add manager' }).click();
  await expect(page.getByText('e2e-recipient@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Profile and Preferences' }).click();
  await expect(page.locator('.profile-modal-panel')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /.+/ })).toBeVisible();
  await expect(page.locator('p-toggleswitch')).toHaveCount(3);
  await expect(page.getByRole('dialog').locator('p-password[name="newPassword"]')).toBeVisible();
  await page.getByRole('button', { name: /Sign Out/ }).click();
  await expect(page.getByRole('heading', { name: 'Executive Workspace Sign In' })).toBeVisible();
  await expect(page.locator('.profile-modal-panel')).not.toBeVisible();
  await page.evaluate(() => localStorage.setItem('sr_default_tab_e2e-manager@example.com', 'my-tasks'));
  const username = page.getByRole('textbox', { name: 'Username' });
  await username.fill('e2e-manager@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('E2eManagerPassword123!');
  await expect(username).toHaveValue('e2e-manager@example.com');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await expect(page.getByRole('heading', { name: 'My Tasks' })).toBeVisible();
  await expect(page.getByText('All your commitments in one place.')).toBeVisible();
  await expect(page.locator('.liquid-glass-dock p-tabs')).toBeVisible();
  await expect(page.locator('app-my-tasks p-progressbar')).toBeVisible();
  await expect(page.locator('app-my-tasks p-selectbutton')).toBeVisible();
  await page.getByRole('tab', { name: 'My Day' }).click();
  let releaseHistory;
  await page.route(/\/api\/tasks\/history(?:\?|$)/, async route => {
    await new Promise(resolve => { releaseHistory = resolve; });
    await route.continue();
  });
  await page.getByRole('tab', { name: 'My Tasks' }).click();
  await expect(page.locator('app-my-tasks p-paginator')).toHaveCount(1);
  try {
    await expect.poll(() => typeof releaseHistory).toBe('function');
    await expect(page.getByRole('status', { name: 'Loading tasks' }).locator('p-skeleton')).toHaveCount(3);
  } finally {
    releaseHistory?.();
  }
  await expect(page.getByRole('status', { name: 'Loading tasks' })).toHaveCount(0);
  await page.unroute(/\/api\/tasks\/history(?:\?|$)/);
  await page.getByRole('tab', { name: 'My Day' }).click();

  await page.locator('app-my-day').getByRole('button', { name: 'New Task' }).click();
  await expect(page.locator('.drawer-dialog-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer-dialog-panel')).not.toBeVisible();
  await page.locator('app-my-day').getByRole('button', { name: 'New Task' }).click();
  await expect(page.locator('.drawer-dialog-panel').getByRole('button', { name: 'Add to Stack' })).toBeDisabled();
  await expect(page.locator('.drawer-dialog-panel')).toBeVisible();
  const assigneeSelect = page.locator('.drawer-dialog-panel').locator('p-select[name="recipientId"]');
  await expect(assigneeSelect).toBeVisible();
  await assigneeSelect.click();
  await expect(page.locator('.p-select-filter')).toBeVisible();
  await page.locator('.p-select-filter').fill('Recipient Test');
  await page.getByRole('option', { name: /Recipient Test Manager/ }).click();
  await expect(assigneeSelect).toContainText('Recipient Test Manager');
  await assigneeSelect.click();
  await expect(page.locator('.p-select-filter')).toHaveValue('');
  await page.getByRole('option', { name: 'Myself' }).click();
  await expect(assigneeSelect).toContainText('Myself');
  await page.locator('.drawer-dialog-panel').getByRole('textbox', { name: 'TITLE *' }).fill('Browser smoke task');
  await page.locator('.drawer-dialog-panel').locator('p-autocomplete[name="editCategory"] input').fill('Finance');
  let releaseSave;
  await page.route('**/api/tasks', async route => {
    await new Promise(resolve => { releaseSave = resolve; });
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Temporary save failure"}' });
    await page.unroute('**/api/tasks');
  });
  await page.getByRole('button', { name: 'Add to Stack' }).click();
  try {
    await expect.poll(() => typeof releaseSave).toBe('function');
    await expect(page.locator('.drawer-dialog-panel').locator('p-progress-spinner')).toBeVisible();
  } finally {
    releaseSave?.();
  }
  await expect(page.locator('p-toast .p-toast-message-error')).toContainText('Temporary save failure');
  await expect(page.locator('p-toast .p-toast-message-error')).toBeVisible();
  await expect(page.locator('.drawer-dialog-panel').locator('p-progress-spinner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to Stack' }).click();
  await expect(page.locator('p-toast .p-toast-message-success')).toContainText('Task created');
  const myDayGroup = page.locator('app-my-day .agenda-group-toggle').filter({ hasText: 'Myself' });
  await expect(myDayGroup).toContainText('1');
  await expect(page.getByRole('checkbox', { name: 'Toggle completion for Browser smoke task' })).toHaveCount(0);
  await myDayGroup.click();
  await expect(page.getByRole('checkbox', { name: 'Toggle completion for Browser smoke task' })).toBeVisible();
  await page.locator('.liquid-glass-dock').evaluate(el => el.classList.add('logo-only'));
  const badge = await page.locator('.liquid-glass-dock .dock-badge').first().evaluate(el => {
    const style = getComputedStyle(el);
    return { fontSize: parseFloat(style.fontSize), height: el.getBoundingClientRect().height, background: style.backgroundColor };
  });
  expect(badge.fontSize).toBeGreaterThanOrEqual(12);
  expect(badge.height).toBeGreaterThanOrEqual(22);
  expect(badge.background).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.liquid-glass-dock p-badge').first()).toBeVisible();
  await page.locator('.liquid-glass-dock').evaluate(el => el.classList.remove('logo-only'));
  await page.getByRole('tab', { name: 'My Tasks' }).click();
  await expect(page.locator('.ledger-row').filter({ hasText: 'Browser smoke task' }).locator('p-tag')).toHaveCount(2);
  await page.locator('.ledger-row').filter({ hasText: 'Browser smoke task' }).getByRole('button', { name: 'Edit task' }).hover();
  await expect(page.locator('.p-tooltip')).toContainText('Edit task');
  const deleteAction = page.locator('.ledger-row').filter({ hasText: 'Browser smoke task' }).getByRole('button', { name: 'Delete task' });
  await deleteAction.hover();
  await expect(page.locator('.p-tooltip')).toContainText('Delete task');
  await deleteAction.focus();
  await expect(deleteAction).toBeFocused();
  await page.route(/\/api\/tasks\/history(?:\?|$)/, async route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page') ?? 0);
    await route.fulfill({ json: {
      content: [{ id: 9000 + pageNumber, userId: 'e2e-manager@example.com', title: `History page ${pageNumber + 1}`,
        priority: 'HIGH', status: 'ACTIVE', createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }],
      totalElements: 51, number: pageNumber
    } });
  });
  await page.getByRole('tab', { name: 'My Tasks' }).click();
  await expect(page.locator('.ledger-row')).toContainText('History page 1');
  await page.locator('.p-paginator-next').click();
  await expect(page.locator('.ledger-row')).toContainText('History page 2');
  await expect(page.locator('.ledger-row')).not.toContainText('History page 1');
  await page.locator('app-my-tasks p-selectbutton').getByText('All', { exact: true }).click();
  await expect(page.locator('.ledger-row')).toContainText('History page 1');
  await page.unroute(/\/api\/tasks\/history(?:\?|$)/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'My Tasks' }).click();
  await page.locator('.ledger-row').filter({ hasText: 'Browser smoke task' }).getByRole('button', { name: 'More task actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit task' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'Kanban Board' }).click();
  await expect(page.locator('app-kanban p-selectbutton')).toBeVisible();
  await expect(page.locator('.kanban-card').filter({ hasText: 'Browser smoke task' })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('tab', { name: 'My Day' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('app-my-day .agenda-group-toggle').filter({ hasText: 'Myself' }).click();
  await page.getByRole('button', { name: 'Edit Browser smoke task' }).click();
  const categorySearch = page.locator('.drawer-dialog-panel').locator('p-autocomplete[name="editCategory"] input');
  expect(await categorySearch.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await categorySearch.fill('Fin');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('option', { name: 'Finance' }).click();
  await expect(categorySearch).toHaveValue('Finance');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.drawer-dialog-panel').getByRole('textbox', { name: 'TITLE *' }).fill('Updated smoke task');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('checkbox', { name: 'Toggle completion for Updated smoke task' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Updated smoke task' }).click();
  await page.locator('.drawer-dialog-panel').getByRole('button', { name: /Delete/ }).click();
  await expect(page.locator('.p-confirmdialog')).toBeVisible();
  await page.getByRole('alertdialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('checkbox', { name: 'Toggle completion for Updated smoke task' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Updated smoke task' }).click();
  await page.locator('.drawer-dialog-panel').getByRole('button', { name: /Delete/ }).click();
  await page.getByRole('alertdialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete Permanently' }).click();
  await expect(page.getByRole('checkbox', { name: 'Toggle completion for Updated smoke task' })).toHaveCount(0);
});

test('workspace fits phone, tablet, foldable, and laptop widths', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-admin@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('E2eAdminPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['My Day', 'My Tasks', 'Kanban Board', 'Admin Module']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.getByRole('button', { name: 'Profile and Preferences' }).click();
    const profile = page.getByRole('dialog');
    await expect(profile).toBeVisible();
    expect(await profile.locator('p-password[name="newPassword"] input').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await profile.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(width);
    await profile.locator('button[aria-label="Close"]').click();
  }
  await page.getByRole('button', { name: 'Profile and Preferences' }).click();
  await page.getByRole('switch', { name: 'Show Kanban Board tab' }).click();
  await expect(page.getByRole('tab', { name: 'Kanban Board' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Show Kanban Board tab' }).click();
  await expect(page.getByRole('tab', { name: 'Kanban Board' })).toHaveCount(1);
  await page.getByRole('radio', { name: 'Dark theme' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('app-dark'))).toBe(true);
  const darkDialogColor = await page.locator('.profile-modal-panel').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.getByRole('radio', { name: 'Light theme' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('app-dark'))).toBe(false);
  const lightDialogColor = await page.locator('.profile-modal-panel').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(darkDialogColor).not.toBe(lightDialogColor);
  await page.getByRole('radio', { name: 'System theme' }).click();
  await page.locator('.profile-modal-panel').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('tab', { name: 'My Day' }).click();
  await page.getByRole('button', { name: 'Full Month' }).click();
  await expect(page.getByRole('dialog', { name: 'Task Calendar' })).toBeVisible();
  await expect(page.locator('.horizon-modal-panel p-datepicker')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('app-my-day').getByRole('button', { name: 'New Task' }).click();
  await page.locator('.drawer-dialog-panel').locator('p-select[name="recipientId"]').click();
  await expect(page.locator('.p-select-overlay')).toBeVisible();
  const menu = await page.locator('.p-select-overlay').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(320);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('admin deletion requires confirmation and preserves cancelled items', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-admin@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('E2eAdminPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await page.getByRole('tab', { name: 'Admin Module' }).click();
  const username = `confirm-${Date.now()}@example.com`;
  await page.getByRole('textbox', { name: 'Display name' }).fill('Confirmation Test');
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Director', exact: true }).click();
  await page.getByRole('textbox', { name: 'Initial password' }).fill('Confirmation123!');
  await page.getByRole('button', { name: 'Add manager' }).click();
  await page.getByRole('searchbox', { name: 'Search managers' }).fill(username);
  const manager = page.locator('app-admin p-table').first().getByRole('row').filter({ hasText: username });
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete manager?' })).toBeVisible();
  await page.getByRole('alertdialog', { name: 'Delete manager?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete manager?' }).getByRole('button', { name: 'Delete manager' }).click();
  await expect(manager).toHaveCount(0);

  const employeeName = `Confirmation Employee ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Employee name' }).fill(employeeName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const employee = page.locator('app-admin p-table').last().getByRole('row').filter({ hasText: employeeName });
  await expect(employee).toBeVisible();
  await employee.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog', { name: 'Remove employee?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(employee).toBeVisible();
  await employee.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog', { name: 'Remove employee?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(employee).toHaveCount(0);
});

test('tab changes animate unless reduced motion is requested', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-admin@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('E2eAdminPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await page.getByRole('tab', { name: 'My Tasks' }).click();
  await expect(page.locator('app-my-tasks .canvas-wrap')).toBeVisible();
  const animation = await page.locator('app-my-tasks .canvas-wrap').evaluate(el => {
    const style = getComputedStyle(el);
    return { name: style.animationName, duration: parseFloat(style.animationDuration) };
  });
  expect(animation.name).toBe('tabSwitchIn');
  expect(animation.duration).toBeGreaterThanOrEqual(0.3);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab', { name: 'Kanban Board' }).click();
  await expect(page.locator('app-kanban .canvas-wrap')).toBeVisible();
  expect(await page.locator('app-kanban .canvas-wrap').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('dragging a Kanban card changes its lane and persists after reload', async ({ page, browserName }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username' }).fill('e2e-admin@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('E2eAdminPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await page.getByRole('tab', { name: 'Admin Module' }).click();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Drag Test Manager');
  await page.getByRole('textbox', { name: 'Username' }).fill('drag-manager@example.com');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Director', exact: true }).click();
  await page.getByRole('textbox', { name: 'Initial password' }).fill('DragManagerPassword123!');
  await page.getByRole('button', { name: 'Add manager' }).click();
  await expect(page.getByText('drag-manager@example.com')).toBeVisible();
  await page.getByRole('textbox', { name: 'Display name' }).fill('Board Sender');
  await page.getByRole('textbox', { name: 'Username' }).fill('board-sender@example.com');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Director', exact: true }).click();
  await page.getByRole('textbox', { name: 'Initial password' }).fill('BoardSenderPassword123!');
  await page.getByRole('button', { name: 'Add manager' }).click();
  await expect(page.getByText('board-sender@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Profile and Preferences' }).click();
  await page.getByRole('button', { name: /Sign Out/ }).click();
  await expect(page.getByRole('heading', { name: 'Executive Workspace Sign In' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Username' }).fill('board-sender@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('BoardSenderPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await page.locator('app-my-day').getByRole('button', { name: 'New Task' }).click();
  await page.locator('.drawer-dialog-panel').getByRole('textbox', { name: 'TITLE *' }).fill('Drag me');
  await page.locator('.drawer-dialog-panel').locator('p-select[name="recipientId"]').click();
  await page.locator('.p-select-filter').fill('Drag Test Manager');
  await page.getByRole('option', { name: /Drag Test Manager/ }).click();
  await page.getByRole('button', { name: 'Add to Stack' }).click();
  await page.getByRole('button', { name: 'Profile and Preferences' }).click();
  await page.getByRole('button', { name: /Sign Out/ }).click();
  await expect(page.getByRole('heading', { name: 'Executive Workspace Sign In' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sr_default_tab_drag-manager@example.com', 'kanban'));
  await page.getByRole('textbox', { name: 'Username' }).fill('drag-manager@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('DragManagerPassword123!');
  await page.getByRole('button', { name: /Authenticate & Enter Workspace/ }).click();
  await expect(page.getByRole('heading', { name: 'Kanban Board' })).toBeVisible();
  await expect(page.getByText('Tasks grouped by sender and status.')).toBeVisible();
  await page.getByRole('tab', { name: 'Kanban Board' }).click();
  await expect(page.locator('.kanban-user-row')).toContainText('Board Sender');

  const source = await page.locator('.kanban-col[data-status="ACTIVE"] .kanban-card').boundingBox();
  const target = await page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-col-body').boundingBox();
  const desktopStatusSaved = page.waitForResponse(response => response.url().includes('/status') && response.status() === 200);
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-card')).toContainText('Drag me');
  await desktopStatusSaved;
  await page.reload();
  await page.getByRole('tab', { name: 'Kanban Board' }).click();
  await expect(page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-card')).toContainText('Drag me');

  await page.setViewportSize({ width: 390, height: 1600 });
  expect(await page.locator('.kanban-status-select').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  const mobileSource = await page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-card').boundingBox();
  const mobileTarget = await page.locator('.kanban-col[data-status="COMPLETED"] .kanban-col-body').boundingBox();
  expect(Math.abs(mobileSource.x - mobileTarget.x)).toBeLessThan(30);
  const mobileStatusSaved = page.waitForResponse(response => response.url().includes('/status') && response.status() === 200);
  await page.mouse.move(mobileSource.x + mobileSource.width / 2, mobileSource.y + mobileSource.height / 2);
  await page.mouse.down();
  await page.mouse.move(mobileTarget.x + mobileTarget.width / 2, mobileTarget.y + mobileTarget.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.kanban-col[data-status="COMPLETED"] .kanban-card')).toContainText('Drag me');
  await mobileStatusSaved;
  await page.reload();
  await page.getByRole('tab', { name: 'Kanban Board' }).click();
  await expect(page.locator('.kanban-col[data-status="COMPLETED"] .kanban-card')).toContainText('Drag me');

  if (browserName !== 'chromium') return;

  const touchSource = await page.locator('.kanban-col[data-status="COMPLETED"] .kanban-card').boundingBox();
  const touchTarget = await page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-col-body').boundingBox();
  const x = touchSource.x + touchSource.width / 2;
  const startY = touchSource.y + touchSource.height / 2;
  const endY = touchTarget.y + touchTarget.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touchSaved = page.waitForResponse(response => response.url().includes('/status') && response.status() === 200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  for (let step = 1; step <= 20; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * step / 20 }]
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchSaved;
  await expect(page.locator('.kanban-col[data-status="IN_PROGRESS"] .kanban-card')).toContainText('Drag me');
});
