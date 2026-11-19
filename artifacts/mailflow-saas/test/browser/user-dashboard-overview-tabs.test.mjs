import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sessionId = 'overview-tabs-browser-test';
const user = {
  id: 'overview-tabs-user',
  username: 'overview-tabs-user',
  firstName: 'Overview',
  lastName: 'User',
  email: 'overview@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const dashboard = {
  subscriptionStatus: 'active',
  contacts: 37,
  companies: 6,
  activeLists: 3,
  amountSpentByCurrency: [],
  lifecycleStages: [],
  leadStatuses: [],
  campaignCount: 4,
  campaigns: [],
  setupChecklist: { profile: true, emailSetup: true, contact: true, list: true, campaignQueued: true },
  setupStepsCompleted: 5,
  setupStepsTotal: 5,
};
const analyticsTotals = {
  campaignsCreated: 0,
  campaignRecipients: 0,
  smtpAccepted: 0,
  bounced: 0,
  suppressed: 0,
  queuedOrSending: 0,
  unknown: 0,
  contactsAdded: 0,
};
const dashboardAnalytics = {
  period: {
    from: '2026-11-01',
    to: '2026-11-19',
    previousFrom: '2026-10-13',
    previousTo: '2026-10-31',
    timezone: 'UTC',
  },
  totals: analyticsTotals,
  previousTotals: analyticsTotals,
  trend: [],
  recipientOutcomes: [],
  campaigns: [],
  pagination: { page: 1, pageSize: 10, totalCampaigns: 0, totalPages: 0 },
  generatedAt: '2026-11-19T12:00:00.000Z',
};
const prospectDashboard = {
  totalActive: 0,
  totalWon: 0,
  totalLost: 0,
  currencyTotals: [],
  byStage: [],
  byProduct: [],
  byClosurePeriod: [],
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

async function openOverview({ prospectAccess }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{
    name: 'mailflow_session',
    value: sessionId,
    url: baseUrl,
    sameSite: 'Lax',
  }]);
  const requestedPaths = [];
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    requestedPaths.push(pathname);
    if (!request.headers().cookie?.includes(`mailflow_session=${sessionId}`)) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me') return route.fulfill({ status: 200, json: user });
    if (pathname === '/api/maintenance/status') return route.fulfill({ status: 200, json: { maintenanceMode: false } });
    if (pathname === '/api/dashboard') return route.fulfill({ status: 200, json: dashboard });
    if (pathname === '/api/dashboard/analytics') return route.fulfill({ status: 200, json: dashboardAnalytics });
    if (pathname === '/api/notifications') return route.fulfill({ status: 200, json: { unread: [], history: [] } });
    if (pathname === '/api/subscriptions/current') {
      return route.fulfill({
        status: 200,
        json: {
          subscription: {
            id: 'overview-tabs-subscription',
            status: 'active',
            startsAt: '2026-11-01T00:00:00.000Z',
            endsAt: '2026-12-01T00:00:00.000Z',
            package: {
              id: 'overview-tabs-package',
              name: prospectAccess ? 'Growth' : 'Starter',
              amountMinor: prospectAccess ? 2500 : 0,
              prospectManagementEnabled: prospectAccess,
              reportsEnabled: false,
            },
          },
          scheduledSubscription: null,
        },
      });
    }
    if (pathname === '/api/prospect-dashboard') return route.fulfill({ status: 200, json: prospectDashboard });
    if (pathname === '/api/prospect-stages') return route.fulfill({ status: 200, json: [] });
    if (pathname === '/api/prospect-currencies') {
      return route.fulfill({ status: 200, json: { currencies: [], defaultCurrencyCode: null } });
    }
    if (pathname === '/api/prospect-follow-ups/today') {
      return route.fulfill({ status: 200, json: { date: '2026-11-19', items: [], overdueCount: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected API request: ${request.method()} ${pathname}` } });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/dashboard`);
  await page.getByRole('heading', { name: 'Good to see you, again.' }).waitFor();
  return { context, page, pageErrors, requestedPaths };
}

describe('user overview analytics tabs', { concurrency: false }, () => {
  before(async () => {
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

  it('shows campaign/contact analytics, prospect analytics, and the shared action center for eligible plans', async () => {
    const { context, page, pageErrors, requestedPaths } = await openOverview({ prospectAccess: true });
    try {
      await page.getByTestId('tab-overview-campaigns').waitFor();
      await page.getByTestId('overview-campaigns-content').getByTestId('analytics-kpi-campaigns-created').waitFor();
      assert.equal(await page.getByTestId('tab-overview-campaigns').getAttribute('data-state'), 'active');
      assert.equal(await page.getByTestId('dashboard-workspace-action-center').isVisible(), true);
      assert.match(await page.getByTestId('link-dashboard-action-audience').innerText(), /37/);

      await page.getByTestId('tab-overview-prospects').click();
      await page.getByTestId('dashboard-follow-ups-today').waitFor();
      await page.getByTestId('empty-prospect-analytics').waitFor();
      assert.equal(await page.getByTestId('dashboard-workspace-action-center').isVisible(), true);
      assert.ok(requestedPaths.includes('/api/prospect-dashboard'), 'prospect analytics should load when its tab is opened');
      assert.deepEqual(pageErrors, [], 'both overview tabs should render without browser errors');
    } finally {
      await context.close();
    }
  });

  it('shows a plan prompt instead of requesting prospect data when access is unavailable', async () => {
    const { context, page, requestedPaths } = await openOverview({ prospectAccess: false });
    try {
      await page.getByTestId('tab-overview-prospects').click();
      await page.getByTestId('dashboard-prospect-access-prompt').waitFor();
      await page.getByTestId('link-dashboard-prospect-plans').waitFor();
      assert.equal(await page.getByTestId('dashboard-workspace-action-center').isVisible(), true);
      assert.equal(requestedPaths.includes('/api/prospect-dashboard'), false);
    } finally {
      await context.close();
    }
  });
});
