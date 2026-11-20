import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sessionId = 'contact-bulk-tags-browser-test';
const user = {
  id: 'contact-bulk-tags-user',
  username: 'contact-bulk-tags-user',
  firstName: 'Contact',
  lastName: 'User',
  email: 'contact@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const contactId = 'df7b93f2-0e32-4b47-9c04-2cbca5886229';
const tagId = '4a03f3f0-7a3c-46de-9887-715e2ba53148';
const tags = [{ id: tagId, name: 'Priority' }];
let contact = {
  id: contactId,
  email: 'alex@example.test',
  name: 'Alex Example',
  firstName: 'Alex',
  lastName: 'Example',
  companyId: null,
  company: null,
  companyName: null,
  companyBusinessArea: null,
  listIds: [],
  subscribed: true,
  emailStatus: 'subscribed',
  tags: [],
  lastEmail: null,
  createdAt: '2026-01-10T00:00:00.000Z',
};
const listContacts = () => ({
  contacts: [contact],
  quota: { used: 1, limit: 1000, remaining: 999, canAdd: true, requiresSubscription: false },
  uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  page: 1,
  pageSize: 50,
  total: 1,
  pageCount: 1,
  workspaceTotal: 1,
  workspaceSubscribed: 1,
});

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
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn('pnpm', ['run', 'dev'], {
    cwd: appDirectory,
    detached: true,
    env: { ...process.env, BASE_PATH: '/', NODE_ENV: 'development', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
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
    try { process.kill(-serverProcess.pid, 'SIGKILL'); } catch { /* already stopped */ }
  }
}

async function openContactsPage() {
  contact = { ...contact, tags: [] };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'mailflow_session', value: sessionId, url: baseUrl, sameSite: 'Lax' }]);
  let bulkRequestBody;
  const pageErrors = [];
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!request.headers().cookie?.includes(`mailflow_session=${sessionId}`)) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me') return route.fulfill({ status: 200, json: user });
    if (pathname === '/api/maintenance/status') return route.fulfill({ status: 200, json: { maintenanceMode: false } });
    if (pathname === '/api/notifications') return route.fulfill({ status: 200, json: { unread: [], history: [] } });
    if (pathname === '/api/subscriptions/current') {
      return route.fulfill({
        status: 200,
        json: {
          subscription: {
            id: 'contact-bulk-tags-subscription',
            status: 'active',
            startsAt: '2026-01-01T00:00:00.000Z',
            endsAt: '2027-01-01T00:00:00.000Z',
            package: { id: 'contact-bulk-tags-package', name: 'Growth', amountMinor: 2500, prospectManagementEnabled: true, reportsEnabled: true },
          },
          scheduledSubscription: null,
        },
      });
    }
    if (pathname === '/api/contacts' && request.method() === 'GET') {
      return route.fulfill({ status: 200, json: listContacts() });
    }
    if (pathname === '/api/contact-lists') return route.fulfill({ status: 200, json: [] });
    if (pathname === '/api/contact-tags') return route.fulfill({ status: 200, json: tags });
    if (pathname === '/api/contact-segments') return route.fulfill({ status: 200, json: [] });
    if (pathname === '/api/companies') return route.fulfill({ status: 200, json: { companies: [] } });
    if (pathname === '/api/contacts/filter-options') {
      return route.fulfill({ status: 200, json: { lifecycleStages: [], leadStatuses: [], leadSources: [] } });
    }
    if (pathname === '/api/contacts/bulk' && request.method() === 'POST') {
      bulkRequestBody = request.postDataJSON();
      if (bulkRequestBody.action === 'add_tag') contact = { ...contact, tags: [{ ...tags[0] }] };
      if (bulkRequestBody.action === 'remove_tag') contact = { ...contact, tags: [] };
      return route.fulfill({ status: 200, json: { updatedCount: 1, skippedCount: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected API request: ${request.method()} ${pathname}` } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/contacts`);
  await page.getByRole('heading', { name: 'Contacts' }).waitFor();
  await page.getByTestId(`row-contact-${contactId}`).waitFor();
  return { context, page, pageErrors, getBulkRequestBody: () => bulkRequestBody };
}

describe('bulk contact tag updates', { concurrency: false }, () => {
  before(async () => {
    await startWebServer();
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  });

  after(async () => {
    await browser?.close();
    await stopWebServer();
  });

  it('adds and removes a selected library tag for selected contacts', async () => {
    const { context, page, pageErrors, getBulkRequestBody } = await openContactsPage();
    try {
      await page.getByRole('checkbox', { name: 'Select alex@example.test' }).check();
      await page.getByTestId('select-bulk-contact-tag').selectOption(tagId);
      await page.getByTestId('button-bulk-add-tag').click();
      await page.getByText('1 contacts tagged with “Priority”.').waitFor();
      assert.deepEqual(getBulkRequestBody(), { contactIds: [contactId], action: 'add_tag', tagId });
      await page.getByTestId(`row-contact-${contactId}`).getByTestId('list-contact-tags').waitFor();

      await page.getByRole('checkbox', { name: 'Select alex@example.test' }).check();
      await page.getByTestId('select-bulk-contact-tag').selectOption(tagId);
      await page.getByTestId('button-bulk-remove-tag').click();
      await page.getByText('1 contacts had “Priority” removed.').waitFor();
      assert.deepEqual(getBulkRequestBody(), { contactIds: [contactId], action: 'remove_tag', tagId });
      assert.deepEqual(pageErrors, [], 'bulk tag updates should render without browser errors');
    } finally {
      await context.close();
    }
  });
});
