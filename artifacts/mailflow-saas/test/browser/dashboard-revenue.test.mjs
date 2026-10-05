import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const admin = {
  id: 'browser-test-revenue-admin-id',
  username: 'revenue-browser-admin',
  firstName: 'Revenue',
  lastName: 'Admin',
  email: 'revenue-admin@example.test',
  role: 'SUPERADMIN',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const currentMonth = new Date();
const monthKeys = Array.from({ length: 6 }, (_, index) => {
  const month = new Date(Date.UTC(
    currentMonth.getUTCFullYear(),
    currentMonth.getUTCMonth() - 5 + index,
    1,
  ));
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
});

const dashboardWithRevenue = {
  totalUsers: 4,
  activeUsers: 3,
  pendingUsers: 1,
  disabledUsers: 0,
  newUsersThisMonth: 1,
  activeSubscriptions: 2,
  activeCustomers: 2,
  activePackages: 2,
  subscriptionsEndingSoon: 0,
  defaultCurrency: 'INR',
  revenueThisMonth: 100,
  totalRevenue: 75,
  revenueByCurrency: [
    {
      currency: 'INR',
      revenueThisMonth: 100,
      totalRevenue: 75,
      capturedThisMonth: 150,
      refundedThisMonth: 50,
      capturedLifetime: 200,
      refundedLifetime: 125,
      capturedPaymentsThisMonth: 2,
      refundedPaymentsThisMonth: 1,
      capturedPaymentsTotal: 3,
      refundedPaymentsTotal: 2,
    },
    {
      currency: 'USD',
      revenueThisMonth: 17.64,
      totalRevenue: 35.01,
      capturedThisMonth: 19.99,
      refundedThisMonth: 2.35,
      capturedLifetime: 39.98,
      refundedLifetime: 4.97,
      capturedPaymentsThisMonth: 1,
      refundedPaymentsThisMonth: 1,
      capturedPaymentsTotal: 2,
      refundedPaymentsTotal: 1,
    },
  ],
  registrationsByMonth: monthKeys.map((month, index) => ({
    month,
    registrations: index === monthKeys.length - 1 ? 1 : 0,
  })),
  revenueTrend: monthKeys.map((month, index) => ({
    month,
    revenue: [10, 20, 30, 50, 75, 100][index],
  })),
  activeSubscriptionsByPackage: [{ packageName: 'Monthly', activeSubscriptions: 2 }],
  billingEnvironment: 'production',
  applicationEmailConfigured: true,
  maintenanceMode: false,
  packageVisibility: 'public',
  emailsSent: 0,
  recentUsers: [],
};

const dashboardWithoutPayments = {
  ...dashboardWithRevenue,
  totalUsers: 0,
  activeUsers: 0,
  pendingUsers: 0,
  disabledUsers: 0,
  newUsersThisMonth: 0,
  activeSubscriptions: 0,
  activeCustomers: 0,
  activePackages: 0,
  revenueThisMonth: 0,
  totalRevenue: 0,
  revenueByCurrency: [],
  registrationsByMonth: monthKeys.map(month => ({ month, registrations: 0 })),
  revenueTrend: monthKeys.map(month => ({ month, revenue: 0 })),
  activeSubscriptionsByPackage: [],
  billingEnvironment: null,
  recentUsers: [],
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

async function installDashboardApiFixtures(context, dashboard) {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const cookie = request.headers().cookie ?? '';

    if (!cookie.includes('mailflow_session=revenue-browser-test')) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, json: admin });
      return;
    }
    if (pathname === '/api/admin/dashboard') {
      await route.fulfill({ status: 200, json: dashboard });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${request.method()} ${pathname}` },
    });
  });
  await context.addCookies([{
    name: 'mailflow_session',
    value: 'revenue-browser-test',
    url: baseUrl,
    sameSite: 'Lax',
  }]);
}

async function openDashboard(dashboard) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await installDashboardApiFixtures(context, dashboard);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/admin`);
  await page.getByRole('heading', { name: 'Platform overview' }).waitFor();
  await page.getByTestId('dashboard-value-revenue-month').waitFor();
  return { context, page, pageErrors };
}

async function formatCurrencyInBrowser(page, amount, currency) {
  return page.evaluate(({ value, code }) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value),
  { value: amount, code: currency });
}

describe('superadmin revenue dashboard currency display', { concurrency: false }, () => {
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

  it('renders monthly and lifetime totals, refunds, and a default-currency-only chart tooltip in major units', async () => {
    const { context, page, pageErrors } = await openDashboard(dashboardWithRevenue);
    try {
      const inrMonth = await formatCurrencyInBrowser(page, 100, 'INR');
      const inrLifetime = await formatCurrencyInBrowser(page, 75, 'INR');
      const inrRefundMonth = await formatCurrencyInBrowser(page, 50, 'INR');
      const inrRefundLifetime = await formatCurrencyInBrowser(page, 125, 'INR');
      const usdMonth = await formatCurrencyInBrowser(page, 17.64, 'USD');
      const usdLifetime = await formatCurrencyInBrowser(page, 35.01, 'USD');
      const usdRefundMonth = await formatCurrencyInBrowser(page, 2.35, 'USD');
      const usdRefundLifetime = await formatCurrencyInBrowser(page, 4.97, 'USD');

      assert.equal(await page.getByTestId('dashboard-value-revenue-month').innerText(), inrMonth);
      assert.equal(await page.getByTestId('dashboard-value-revenue-lifetime').innerText(), inrLifetime);

      const inrSummary = page.getByTestId('currency-summary-inr');
      const usdSummary = page.getByTestId('currency-summary-usd');
      const inrText = await inrSummary.innerText();
      const usdText = await usdSummary.innerText();
      for (const amount of [inrMonth, inrLifetime, inrRefundMonth, inrRefundLifetime]) {
        assert.ok(inrText.includes(amount), `INR summary is missing ${amount}:\n${inrText}`);
      }
      for (const amount of [usdMonth, usdLifetime, usdRefundMonth, usdRefundLifetime]) {
        assert.ok(usdText.includes(amount), `USD summary is missing ${amount}:\n${usdText}`);
      }
      assert.doesNotMatch(inrText, /\$/u, 'INR totals must not include USD values');
      assert.doesNotMatch(usdText, /₹/u, 'USD totals must not include INR values');

      const chart = page.getByTestId('chart-revenue-history');
      const bars = chart.locator('.recharts-bar-rectangle');
      assert.equal(await bars.count(), 6, 'the default-currency trend should include six months');
      await bars.last().hover({ force: true });

      const expectedTooltipValue = await formatCurrencyInBrowser(page, 100, 'INR');
      await page.waitForFunction(expected => {
        const tooltips = Array.from(document.querySelectorAll('.recharts-tooltip-wrapper'));
        return tooltips.some(tooltip => tooltip.textContent?.includes(expected));
      }, expectedTooltipValue);
      const tooltipText = await chart.locator('.recharts-tooltip-wrapper').innerText();
      assert.ok(tooltipText.includes(expectedTooltipValue), `chart tooltip must show ${expectedTooltipValue}: ${tooltipText}`);
      assert.match(tooltipText, /Net INR/u);
      assert.doesNotMatch(tooltipText, /\bUSD\b|\$/u, 'the chart tooltip must not mix in USD');
      assert.deepEqual(pageErrors, [], 'the dashboard should render without browser errors');
    } finally {
      await context.close();
    }
  });

  it('shows an explicit no-payment state when no billing environment or payment rows exist', async () => {
    const { context, page, pageErrors } = await openDashboard(dashboardWithoutPayments);
    try {
      assert.equal(
        await page.getByTestId('dashboard-value-revenue-month').innerText(),
        await formatCurrencyInBrowser(page, 0, 'INR'),
      );
      assert.equal(
        await page.getByTestId('dashboard-value-revenue-lifetime').innerText(),
        await formatCurrencyInBrowser(page, 0, 'INR'),
      );
      await page.getByText('No payment activity recorded', { exact: true }).waitFor();
      await page.getByText('No revenue in this period', { exact: true }).waitFor();
      await page.getByText('No active billing environment; revenue is not reported.', { exact: false }).waitFor();
      assert.equal(await page.getByTestId('chart-revenue-history').count(), 0);
      assert.deepEqual(pageErrors, [], 'the no-payment dashboard should render without browser errors');
    } finally {
      await context.close();
    }
  });
});
