import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const admin = {
  id: '1cb36bf0-1a6a-4e8c-93b3-b52438e6942f',
  username: 'notifications-browser-admin',
  firstName: 'Notice',
  lastName: 'Admin',
  email: 'notice-admin@example.test',
  role: 'SUPERADMIN',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const firstCustomer = {
  id: '14719c21-2eef-4ccd-9847-3ea7e7555c2a',
  username: 'notifications-customer-one',
  firstName: 'Taylor',
  lastName: 'One',
  email: 'taylor.one@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-02-01T00:00:00.000Z',
};
const secondCustomer = {
  id: '58b3d35b-2a33-402d-9ab1-8a7ab136aa7f',
  username: 'notifications-customer-two',
  firstName: 'Morgan',
  lastName: 'Two',
  email: 'morgan.two@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-02-02T00:00:00.000Z',
};

const customers = [firstCustomer, secondCustomer];
const sessions = new Map([
  ['notifications-admin-session', admin],
  ['notifications-first-session', firstCustomer],
  ['notifications-second-session', secondCustomer],
]);
const state = {
  notifications: [],
  reads: new Map(),
  createRequests: [],
  statusRequests: [],
  readRequests: [],
  notificationLoadFailureBudget: new Map(),
  notificationFailureResponses: [],
  unexpectedRequests: [],
};

let serverProcess;
let serverOutput = '';
let browser;
let baseUrl;

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startWebServer() {
  if (process.env.MAILFLOW_BROWSER_TEST_BASE_URL) {
    baseUrl = process.env.MAILFLOW_BROWSER_TEST_BASE_URL;
    const response = await fetch(baseUrl);
    if (!response.ok) {
      throw new Error(`Browser test server returned HTTP ${response.status} at ${baseUrl}`);
    }
    return;
  }

  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn('pnpm', ['run', 'dev'], {
    cwd: appDirectory,
    detached: true,
    env: {
      ...process.env,
      BASE_PATH: '/',
      NODE_ENV: 'development',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become ready within 45 seconds.\n${serverOutput}`);
}

async function stopWebServer() {
  if (!serverProcess?.pid) return;
  try {
    process.kill(-serverProcess.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([
    new Promise(resolve => serverProcess.once('close', resolve)),
    delay(3_000),
  ]);
  if (serverProcess.exitCode === null) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch {
      // The process group may already have exited.
    }
  }
}

function isAvailable(notification) {
  const now = Date.now();
  return notification.enabled &&
    Date.parse(notification.startsAt) <= now &&
    Date.parse(notification.expiresAt) > now;
}

function userCanReceive(notification, user) {
  return notification.audience === 'broadcast' ||
    notification.recipientUserIds.includes(user.id);
}

function readFor(notification, user) {
  return state.reads.get(`${notification.id}:${user.id}`) ?? null;
}

function userNotification(notification, readAt = null) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    startsAt: notification.startsAt,
    expiresAt: notification.expiresAt,
    createdAt: notification.createdAt,
    readAt,
  };
}

function adminNotification(notification) {
  const now = Date.now();
  const enabled = notification.enabled;
  const status = !enabled
    ? 'disabled'
    : Date.parse(notification.startsAt) > now
      ? 'scheduled'
      : Date.parse(notification.expiresAt) <= now
        ? 'expired'
        : 'active';
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    audience: notification.audience,
    enabled,
    status,
    startsAt: notification.startsAt,
    expiresAt: notification.expiresAt,
    recipientCount: notification.audience === 'broadcast'
      ? customers.length
      : notification.recipientUserIds.length,
    readCount: [...state.reads.keys()].filter(key => key.startsWith(`${notification.id}:`)).length,
    createdAt: notification.createdAt,
  };
}

async function installApiFixtures(context) {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const method = request.method();
    const cookie = request.headers().cookie ?? '';
    const sessionToken = cookie.match(/(?:^|;\s*)mailflow_session=([^;]+)/)?.[1];
    const user = sessions.get(sessionToken);

    if (pathname === '/api/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON();
      const account = [admin, ...customers].find(candidate =>
        candidate.username === credentials.identifier ||
        candidate.email === credentials.identifier,
      );
      if (!account || credentials.password !== 'browser-test-password') {
        await route.fulfill({ status: 401, json: { error: 'Invalid credentials.' } });
        return;
      }
      const token = account.id === admin.id
        ? 'notifications-admin-session'
        : account.id === firstCustomer.id
          ? 'notifications-first-session'
          : 'notifications-second-session';
      await route.fulfill({
        status: 200,
        headers: { 'set-cookie': `mailflow_session=${token}; Path=/; SameSite=Lax` },
        json: { user: account },
      });
      return;
    }

    if (!user) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }

    if (pathname === '/api/admin/dashboard' && method === 'GET' && user.role === 'SUPERADMIN') {
      await route.fulfill({
        status: 200,
        json: {
          totalUsers: customers.length,
          activeUsers: customers.length,
          pendingUsers: 0,
          disabledUsers: 0,
          newUsersThisMonth: 0,
          activeSubscriptions: 0,
          activeCustomers: 0,
          activePackages: 0,
          subscriptionsEndingSoon: 0,
          defaultCurrency: 'USD',
          revenueThisMonth: 0,
          totalRevenue: 0,
          revenueByCurrency: [],
          registrationsByMonth: [],
          revenueTrend: [],
          activeSubscriptionsByPackage: [],
          billingEnvironment: null,
          applicationEmailConfigured: false,
          maintenanceMode: false,
          packageVisibility: 'public',
          emailsSent: 0,
          recentUsers: [],
        },
      });
      return;
    }

    if (pathname === '/api/admin/notifications' && method === 'GET' && user.role === 'SUPERADMIN') {
      await route.fulfill({
        status: 200,
        json: { items: [...state.notifications].reverse().map(adminNotification) },
      });
      return;
    }

    if (pathname === '/api/admin/notifications' && method === 'POST' && user.role === 'SUPERADMIN') {
      const data = request.postDataJSON();
      state.createRequests.push(data);
      const id = data.audience === 'broadcast'
        ? 'd32fbdc0-402c-408e-8af8-0a65f0ab8ba0'
        : 'ea4e44f6-83d6-46f2-a95d-4572c2ae3eb4';
      const notification = {
        id,
        ...data,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      state.notifications = state.notifications.filter(item => item.id !== id);
      state.notifications.push(notification);
      await route.fulfill({ status: 201, json: adminNotification(notification) });
      return;
    }

    const statusMatch = pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/status$/);
    if (statusMatch && method === 'PATCH' && user.role === 'SUPERADMIN') {
      const data = request.postDataJSON();
      state.statusRequests.push({ notificationId: statusMatch[1], ...data });
      const notification = state.notifications.find(item => item.id === statusMatch[1]);
      if (!notification) {
        await route.fulfill({ status: 404, json: { error: 'Notification not found.' } });
        return;
      }
      notification.enabled = data.enabled;
      await route.fulfill({ status: 200, json: adminNotification(notification) });
      return;
    }

    if (pathname === '/api/admin/users' && method === 'GET' && user.role === 'SUPERADMIN') {
      const term = (searchParams.get('search') ?? '').toLocaleLowerCase();
      const items = customers.filter(customer =>
        `${customer.firstName} ${customer.lastName} ${customer.email} ${customer.username}`
          .toLocaleLowerCase()
          .includes(term),
      ).map(customer => ({
        id: customer.id,
        username: customer.username,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        emailVerified: customer.emailVerified,
        active: customer.active,
        createdAt: customer.createdAt,
        lastLoginAt: null,
        subscriptionStatus: null,
      }));
      await route.fulfill({
        status: 200,
        json: {
          items,
          total: items.length,
          page: Number(searchParams.get('page') ?? 1),
          pageSize: Number(searchParams.get('pageSize') ?? 8),
        },
      });
      return;
    }

    if (pathname === '/api/notifications' && method === 'GET') {
      const failuresRemaining = state.notificationLoadFailureBudget.get(user.id) ?? 0;
      if (failuresRemaining > 0) {
        state.notificationLoadFailureBudget.set(user.id, failuresRemaining - 1);
        state.notificationFailureResponses.push(user.id);
        await route.fulfill({
          status: 503,
          json: { error: 'Notification history is temporarily unavailable.' },
        });
        return;
      }
      const unread = state.notifications
        .filter(notification =>
          isAvailable(notification) &&
          userCanReceive(notification, user) &&
          !readFor(notification, user),
        )
        .map(notification => userNotification(notification));
      const history = state.notifications
        .filter(notification => readFor(notification, user))
        .sort((left, right) =>
          Date.parse(readFor(right, user)) - Date.parse(readFor(left, user)),
        )
        .map(notification => userNotification(notification, readFor(notification, user)));
      await route.fulfill({ status: 200, json: { unread, history } });
      return;
    }

    const readMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (readMatch && method === 'POST') {
      const notification = state.notifications.find(item => item.id === readMatch[1]);
      if (!notification || !isAvailable(notification) || !userCanReceive(notification, user)) {
        await route.fulfill({
          status: 404,
          json: { error: 'Notification is not available to this account.' },
        });
        return;
      }
      const readAt = readFor(notification, user) ?? new Date().toISOString();
      state.reads.set(`${notification.id}:${user.id}`, readAt);
      state.readRequests.push({ notificationId: notification.id, userId: user.id });
      await route.fulfill({
        status: 200,
        json: { notificationId: notification.id, readAt },
      });
      return;
    }

    if (pathname === '/api/dashboard' && method === 'GET' && user.role === 'USER') {
      await route.fulfill({
        status: 200,
        json: {
          subscriptionStatus: 'inactive',
          contacts: 0,
          companies: 0,
          activeLists: 0,
          amountSpentByCurrency: [],
          lifecycleStages: [],
          leadStatuses: [],
          campaigns: [],
          setupStepsCompleted: 1,
          setupStepsTotal: 4,
        },
      });
      return;
    }

    state.unexpectedRequests.push(`${method} ${pathname}`);
    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${method} ${pathname}` },
    });
  });
}

async function signIn(page, account, destination) {
  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 90_000 });
  await page.getByTestId('input-identifier').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('input-identifier').fill(account.username);
  await page.getByTestId('input-password').fill('browser-test-password');
  await page.getByTestId('button-sign-in').click();
  await page.waitForURL(`**${destination}`);
}

function localDateTime(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

async function fillSchedule(page) {
  const now = Date.now();
  await page.getByTestId('input-notification-starts-at')
    .fill(localDateTime(new Date(now - 60 * 60_000)));
  await page.getByTestId('input-notification-expires-at')
    .fill(localDateTime(new Date(now + 24 * 60 * 60_000)));
}

describe('notification creation, display, and per-account read history', { concurrency: false }, () => {
  before(async () => {
    state.notifications = [];
    state.reads.clear();
    state.createRequests.length = 0;
    state.statusRequests.length = 0;
    state.readRequests.length = 0;
    state.unexpectedRequests.length = 0;

    await startWebServer();
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
  });

  after(async () => {
    await browser?.close();
    await stopWebServer();
  });

  it('lets a superadmin publish broadcast and focused notices and change their enabled state', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await signIn(page, admin, '/admin');
      await page.goto(`${baseUrl}/admin/notifications`);
      await page.getByRole('heading', { name: 'Platform notifications' }).waitFor();

      await page.getByTestId('input-notification-title').fill('Scheduled service update');
      await page.getByTestId('input-notification-message').fill('The platform will be briefly unavailable tonight.');
      await fillSchedule(page);
      const broadcastResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/admin/notifications' &&
        response.request().method() === 'POST',
      );
      await page.getByTestId('button-create-notification').click();
      assert.equal((await broadcastResponse).status(), 201);

      const broadcastId = 'd32fbdc0-402c-408e-8af8-0a65f0ab8ba0';
      await page.getByTestId(`admin-notification-${broadcastId}`).waitFor({ state: 'visible' });
      assert.deepEqual(state.createRequests[0], {
        title: 'Scheduled service update',
        message: 'The platform will be briefly unavailable tonight.',
        audience: 'broadcast',
        recipientUserIds: [],
        startsAt: state.createRequests[0].startsAt,
        expiresAt: state.createRequests[0].expiresAt,
      });
      assert.ok(Date.parse(state.createRequests[0].startsAt) < Date.now());
      assert.ok(Date.parse(state.createRequests[0].expiresAt) > Date.now());
      assert.match(await page.getByTestId(`text-notification-recipients-${broadcastId}`).innerText(), /^2$/);
      assert.equal(
        (await page.getByTestId(`status-notification-${broadcastId}`).innerText()).toLocaleLowerCase(),
        'active',
      );

      await page.getByTestId('select-notification-audience').selectOption('focused');
      await page.getByTestId('input-notification-account-search').fill('Taylor');
      const targetButton = page.getByTestId(`button-add-notification-user-${firstCustomer.id}`);
      await targetButton.waitFor({ state: 'visible' });
      await targetButton.click();
      await page.getByTestId(`selected-notification-user-${firstCustomer.id}`).waitFor({ state: 'visible' });

      await page.getByTestId('input-notification-title').fill('Account security reminder');
      await page.getByTestId('input-notification-message').fill('Please review your account settings.');
      await fillSchedule(page);
      assert.equal(await page.getByTestId('button-create-notification').isDisabled(), false);
      const focusedResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/admin/notifications' &&
        response.request().method() === 'POST',
      );
      await page.getByTestId('button-create-notification').click();
      assert.equal((await focusedResponse).status(), 201);

      const focusedId = 'ea4e44f6-83d6-46f2-a95d-4572c2ae3eb4';
      await page.getByTestId(`admin-notification-${focusedId}`).waitFor({ state: 'visible' });
      assert.equal(state.createRequests[1].audience, 'focused');
      assert.deepEqual(state.createRequests[1].recipientUserIds, [firstCustomer.id]);
      assert.match(await page.getByTestId(`text-notification-recipients-${focusedId}`).innerText(), /^1$/);

      const disableResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/admin/notifications/${broadcastId}/status` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId(`button-disable-notification-${broadcastId}`).click();
      assert.equal((await disableResponse).status(), 200);
      assert.deepEqual(state.statusRequests[0], { notificationId: broadcastId, enabled: false });
      await page.waitForFunction(id =>
        document.querySelector(`[data-testid="status-notification-${id}"]`)?.textContent?.trim().toLocaleLowerCase() === 'disabled',
      broadcastId);
      await page.getByTestId(`button-enable-notification-${broadcastId}`).waitFor({ state: 'visible' });

      const enableResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/admin/notifications/${broadcastId}/status` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId(`button-enable-notification-${broadcastId}`).click();
      assert.equal((await enableResponse).status(), 200);
      assert.deepEqual(state.statusRequests[1], { notificationId: broadcastId, enabled: true });
      await page.waitForFunction(id =>
        document.querySelector(`[data-testid="status-notification-${id}"]`)?.textContent?.trim().toLocaleLowerCase() === 'active',
      broadcastId);
      assert.deepEqual(state.unexpectedRequests, []);
    } finally {
      await context.close();
    }
  });

  it('shows dashboard notices, moves reads into persistent history, and keeps accounts isolated', async () => {
    const broadcastId = 'd32fbdc0-402c-408e-8af8-0a65f0ab8ba0';
    const focusedId = 'ea4e44f6-83d6-46f2-a95d-4572c2ae3eb4';
    assert.equal(state.notifications.length, 2, 'the admin browser flow should have created both notices');

    const firstContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await Promise.all([
        installApiFixtures(firstContext),
        installApiFixtures(secondContext),
      ]);
      const firstPage = await firstContext.newPage();
      await signIn(firstPage, firstCustomer, '/dashboard');
      await firstPage.getByRole('heading', { name: 'Good to see you, again.' }).waitFor();
      await firstPage.getByTestId(`dashboard-notification-${broadcastId}`).waitFor({ state: 'visible' });
      await firstPage.getByTestId(`dashboard-notification-${focusedId}`).waitFor({ state: 'visible' });

      const firstReadResponse = firstPage.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/notifications/${broadcastId}/read` &&
        response.request().method() === 'POST',
      );
      await firstPage.getByTestId(`button-dashboard-mark-read-${broadcastId}`).click();
      assert.equal((await firstReadResponse).status(), 200);
      await firstPage.getByTestId(`dashboard-notification-${broadcastId}`).waitFor({ state: 'detached' });
      await firstPage.getByTestId(`dashboard-notification-${focusedId}`).waitFor({ state: 'visible' });

      await firstPage.goto(`${baseUrl}/notifications`);
      await firstPage.getByRole('heading', { name: 'Notifications' }).waitFor();
      await firstPage.getByTestId(`notification-card-${broadcastId}`).waitFor({ state: 'visible' });
      await firstPage.getByTestId(`notification-card-${focusedId}`).waitFor({ state: 'visible' });
      assert.equal(
        await firstPage.getByTestId(`notification-card-${broadcastId}`).getByText('Read', { exact: true }).count(),
        1,
        'the marked notice should appear as read in history',
      );
      assert.equal(
        await firstPage.getByTestId(`button-mark-notification-read-${focusedId}`).count(),
        1,
        'the account-specific notice should remain unread',
      );
      await firstPage.reload();
      await firstPage.getByTestId(`notification-card-${broadcastId}`).waitFor({ state: 'visible' });
      assert.equal(
        await firstPage.getByTestId(`notification-card-${broadcastId}`).getByText('Read', { exact: true }).count(),
        1,
        'the read state should still be visible after reloading history',
      );
      assert.equal(await firstPage.getByTestId(`button-mark-notification-read-${broadcastId}`).count(), 0);
      assert.ok(state.reads.get(`${broadcastId}:${firstCustomer.id}`));

      const secondPage = await secondContext.newPage();
      await signIn(secondPage, secondCustomer, '/dashboard');
      await secondPage.getByRole('heading', { name: 'Good to see you, again.' }).waitFor();
      await secondPage.getByTestId(`dashboard-notification-${broadcastId}`).waitFor({ state: 'visible' });
      assert.equal(
        await secondPage.getByTestId(`dashboard-notification-${focusedId}`).count(),
        0,
        'the focused notice must not appear for an unselected account',
      );
      await secondPage.goto(`${baseUrl}/notifications`);
      await secondPage.getByRole('heading', { name: 'Notifications' }).waitFor();
      await secondPage.getByTestId(`notification-card-${broadcastId}`).waitFor({ state: 'visible' });
      assert.equal(
        await secondPage.getByTestId(`notification-card-${broadcastId}`).getByText('Unread', { exact: true }).count(),
        1,
        'reading a broadcast for one account must not mark it read for another',
      );
      assert.equal(await secondPage.getByTestId('empty-notification-history').count(), 1);

      assert.deepEqual(
        state.readRequests,
        [{ notificationId: broadcastId, userId: firstCustomer.id }],
        'only the first account should have marked a notice as read',
      );
      assert.deepEqual(state.unexpectedRequests, []);
    } finally {
      await firstContext.close();
      await secondContext.close();
    }
  });

  it('removes disabled notices from an open dashboard on its scheduled refresh and preserves read history', async () => {
    const broadcastId = 'd32fbdc0-402c-408e-8af8-0a65f0ab8ba0';
    const now = Date.now();
    state.notifications = [{
      id: broadcastId,
      title: 'Scheduled service update',
      message: 'The platform will be briefly unavailable tonight.',
      audience: 'broadcast',
      recipientUserIds: [],
      startsAt: new Date(now - 60 * 60_000).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
      createdAt: new Date(now - 60 * 60_000).toISOString(),
      enabled: true,
    }];
    state.reads.clear();
    state.reads.set(`${broadcastId}:${firstCustomer.id}`, new Date(now - 30 * 60_000).toISOString());
    state.statusRequests.length = 0;
    state.unexpectedRequests.length = 0;

    const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const historyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await Promise.all([
        installApiFixtures(customerContext),
        installApiFixtures(adminContext),
        installApiFixtures(historyContext),
      ]);

      const customerPage = await customerContext.newPage();
      await signIn(customerPage, secondCustomer, '/dashboard');
      await customerPage.getByRole('heading', { name: 'Good to see you, again.' }).waitFor();
      await customerPage.getByTestId(`dashboard-notification-${broadcastId}`).waitFor({ state: 'visible' });
      const dashboardUrl = customerPage.url();
      let dashboardNavigations = 0;
      customerPage.on('framenavigated', frame => {
        if (frame === customerPage.mainFrame()) dashboardNavigations += 1;
      });

      const adminPage = await adminContext.newPage();
      await signIn(adminPage, admin, '/admin');
      await adminPage.goto(`${baseUrl}/admin/notifications`);
      await adminPage.getByTestId(`admin-notification-${broadcastId}`).waitFor({ state: 'visible' });
      const disableResponse = adminPage.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/admin/notifications/${broadcastId}/status` &&
        response.request().method() === 'PATCH',
      );
      await adminPage.getByTestId(`button-disable-notification-${broadcastId}`).click();
      assert.equal((await disableResponse).status(), 200);
      assert.deepEqual(state.statusRequests.at(-1), { notificationId: broadcastId, enabled: false });

      const refreshedResponse = await customerPage.waitForResponse(async response => {
        if (
          new URL(response.url()).pathname !== '/api/notifications' ||
          response.request().method() !== 'GET' ||
          response.status() !== 200
        ) {
          return false;
        }
        const refreshed = await response.json();
        return !refreshed.unread.some(notification => notification.id === broadcastId);
      }, { timeout: 40_000 });
      assert.equal(refreshedResponse.status(), 200);
      await customerPage.getByTestId(`dashboard-notification-${broadcastId}`).waitFor({ state: 'detached' });
      assert.equal(customerPage.url(), dashboardUrl, 'the customer should remain on the open dashboard');
      assert.equal(dashboardNavigations, 0, 'the scheduled refresh should not reload or navigate the page');

      const historyPage = await historyContext.newPage();
      await signIn(historyPage, firstCustomer, '/dashboard');
      await historyPage.goto(`${baseUrl}/notifications`);
      await historyPage.getByRole('heading', { name: 'Notifications' }).waitFor();
      const historyCard = historyPage.getByTestId(`notification-card-${broadcastId}`);
      await historyCard.waitFor({ state: 'visible' });
      assert.equal(
        await historyCard.getByText('Read', { exact: true }).count(),
        1,
        'disabling the notice should not remove the first customer’s read history',
      );
      assert.equal(await historyCard.getByTestId(`button-mark-notification-read-${broadcastId}`).count(), 0);
      assert.deepEqual(state.unexpectedRequests, []);
    } finally {
      await customerContext.close();
      await adminContext.close();
      await historyContext.close();
    }
  });

  it('recovers from temporary notification load failures on the dashboard and history page', async () => {
    const broadcastId = 'd32fbdc0-402c-408e-8af8-0a65f0ab8ba0';
    const focusedId = 'ea4e44f6-83d6-46f2-a95d-4572c2ae3eb4';
    const readAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const now = Date.now();
    state.notifications = [
      {
        id: broadcastId,
        title: 'Scheduled service update',
        message: 'The platform will be briefly unavailable tonight.',
        audience: 'broadcast',
        recipientUserIds: [],
        startsAt: new Date(now - 60 * 60_000).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
        createdAt: new Date(now - 60 * 60_000).toISOString(),
        enabled: true,
      },
      {
        id: focusedId,
        title: 'Account security reminder',
        message: 'Please review your account settings.',
        audience: 'focused',
        recipientUserIds: [firstCustomer.id],
        startsAt: new Date(now - 60 * 60_000).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
        createdAt: new Date(now - 30 * 60_000).toISOString(),
        enabled: true,
      },
    ];
    state.reads.clear();
    state.reads.set(`${broadcastId}:${firstCustomer.id}`, readAt);
    state.notificationLoadFailureBudget.clear();
    state.notificationFailureResponses.length = 0;
    state.unexpectedRequests.length = 0;

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      state.notificationLoadFailureBudget.set(firstCustomer.id, 2);
      await signIn(page, firstCustomer, '/dashboard');
      await page.getByRole('heading', { name: 'Good to see you, again.' }).waitFor();
      await page.getByTestId('dashboard-notification-error').waitFor({ state: 'visible' });
      assert.match(
        await page.getByTestId('dashboard-notification-error').innerText(),
        /Platform notices couldn’t be loaded[\s\S]*Retry to check for account updates/,
      );

      const dashboardRetryResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/notifications' &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      );
      await page.getByTestId('button-retry-dashboard-notifications').click();
      assert.equal((await dashboardRetryResponse).status(), 200);
      await page.getByTestId(`dashboard-notification-${focusedId}`).waitFor({ state: 'visible' });
      assert.equal(
        await page.getByTestId(`dashboard-notification-${broadcastId}`).count(),
        0,
        'the already-read broadcast should not return to the unread dashboard notices',
      );
      await page.getByTestId('dashboard-notification-error').waitFor({ state: 'detached' });

      await page.goto(`${baseUrl}/notifications`);
      await page.getByRole('heading', { name: 'Notifications' }).waitFor();
      const readCardBeforeFailure = page.getByTestId(`notification-card-${broadcastId}`);
      await readCardBeforeFailure.waitFor({ state: 'visible' });
      assert.equal(await readCardBeforeFailure.getByText('Read', { exact: true }).count(), 1);
      assert.equal(
        await page.getByTestId(`button-mark-notification-read-${focusedId}`).count(),
        1,
        'the focused notice should remain unread before the temporary history failure',
      );

      state.notificationLoadFailureBudget.set(firstCustomer.id, 2);
      await page.reload();
      await page.getByTestId('error-notifications').waitFor({ state: 'visible' });
      assert.match(
        await page.getByTestId('error-notifications').innerText(),
        /Notifications are unavailable[\s\S]*Your read history is unchanged[\s\S]*Try loading it again/,
      );

      const historyRetryResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/notifications' &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      );
      await page.getByTestId('button-retry-notifications').click();
      assert.equal((await historyRetryResponse).status(), 200);
      const readCard = page.getByTestId(`notification-card-${broadcastId}`);
      const unreadCard = page.getByTestId(`notification-card-${focusedId}`);
      await readCard.waitFor({ state: 'visible' });
      await unreadCard.waitFor({ state: 'visible' });
      assert.equal(await readCard.getByText('Read', { exact: true }).count(), 1);
      assert.equal(await unreadCard.getByText('Unread', { exact: true }).count(), 1);
      assert.equal(await page.getByTestId(`button-mark-notification-read-${broadcastId}`).count(), 0);
      assert.equal(await page.getByTestId(`button-mark-notification-read-${focusedId}`).count(), 1);
      assert.equal(state.reads.get(`${broadcastId}:${firstCustomer.id}`), readAt);
      assert.deepEqual(state.notificationFailureResponses, [
        firstCustomer.id,
        firstCustomer.id,
        firstCustomer.id,
        firstCustomer.id,
      ]);
      assert.deepEqual(state.unexpectedRequests, []);
    } finally {
      await context.close();
    }
  });
});
