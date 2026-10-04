import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const admin = {
  id: 'browser-test-superadmin-id',
  username: 'finance-browser-admin',
  firstName: 'Finance',
  lastName: 'Admin',
  email: 'finance-admin@example.test',
  role: 'SUPERADMIN',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const references = [
  'payment-record-reference-123',
  'customer-account-reference-123',
  'subscription-package-reference-123',
  'subscription-reference-123',
  'gateway-order-reference-123',
  'gateway-payment-reference-123',
];

const payment = {
  id: references[0],
  receipt: 'finance-browser-receipt',
  status: 'captured',
  amountMinor: 4999,
  currency: 'USD',
  razorpayEnvironment: 'production',
  razorpayOrderId: references[4],
  razorpayPaymentId: references[5],
  capturedAt: '2026-09-30T12:00:00.000Z',
  account: {
    id: references[1],
    username: 'ledger-customer',
    firstName: 'Taylor',
    lastName: 'Customer',
    fullName: 'Taylor Customer',
    email: 'taylor.customer@example.test',
    status: 'active',
    registeredAt: '2026-01-15T10:00:00.000Z',
  },
  subscriptionPackage: {
    id: references[2],
    name: 'Growth plan',
  },
  subscription: {
    id: references[3],
    status: 'active',
    startsAt: '2026-09-30T12:00:00.000Z',
    endsAt: '2026-12-29T12:00:00.000Z',
  },
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

function installApiFixtures(context) {
  return context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const isLogin = pathname === '/api/auth/login' && request.method() === 'POST';
    const cookie = request.headers().cookie ?? '';

    if (isLogin) {
      const credentials = request.postDataJSON();
      if (
        credentials.identifier !== admin.username ||
        credentials.password !== 'browser-test-password'
      ) {
        await route.fulfill({ status: 401, json: { error: 'Invalid credentials.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'set-cookie': 'mailflow_session=finance-browser-test; Path=/; SameSite=Lax',
        },
        json: { user: admin },
      });
      return;
    }

    if (!cookie.includes('mailflow_session=finance-browser-test')) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }

    if (pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, json: admin });
      return;
    }
    if (pathname === '/api/admin/billing/packages') {
      await route.fulfill({ status: 200, json: { packages: [] } });
      return;
    }
    if (pathname === '/api/admin/finance/payments') {
      await route.fulfill({
        status: 200,
        json: {
          rows: [payment],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
          currencies: ['USD'],
          summaryByCurrency: [{
            currency: 'USD',
            paymentCount: 1,
            capturedCount: 1,
            refundedCount: 0,
            capturedAmountMinor: '4999',
            refundedAmountMinor: '0',
          }],
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${request.method()} ${pathname}` },
    });
  });
}

async function signInAndOpenFinance(viewport) {
  const context = await browser.newContext({ viewport });
  await installApiFixtures(context);
  const page = await context.newPage();

  await page.goto(baseUrl);
  await page.getByTestId('input-identifier').fill(admin.username);
  await page.getByTestId('input-password').fill('browser-test-password');
  await page.getByTestId('button-sign-in').click();
  await page.waitForURL('**/admin');

  await page.goto(`${baseUrl}/admin/finance`);
  await page.getByRole('heading', { name: 'Payment ledger' }).waitFor();
  await page.getByTestId('row-finance-payment').waitFor();

  return { context, page };
}

describe('authenticated superadmin finance ledger at responsive widths', { concurrency: false }, () => {
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

  it('keeps table scrolling inside the records area and exposes references only in keyboard-opened details on phone', async () => {
    const { context, page } = await signInAndOpenFinance({ width: 390, height: 844 });
    try {
      const dimensions = await page.evaluate(() => {
        const scrollArea = document.querySelector('[data-testid="finance-table-scroll"]');
        if (!scrollArea) throw new Error('Finance table scroll area is missing.');
        scrollArea.scrollLeft = scrollArea.scrollWidth;
        return {
          viewportWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          tableViewportWidth: scrollArea.clientWidth,
          tableContentWidth: scrollArea.scrollWidth,
          tableScrollLeft: scrollArea.scrollLeft,
        };
      });
      assert.ok(dimensions.tableContentWidth > dimensions.tableViewportWidth, 'table should overflow horizontally on a phone');
      assert.ok(dimensions.tableScrollLeft > 0, 'table region should be horizontally scrollable');
      assert.ok(
        dimensions.pageWidth <= dimensions.viewportWidth,
        `page widened to ${dimensions.pageWidth}px for a ${dimensions.viewportWidth}px viewport`,
      );

      const row = page.getByTestId('row-finance-payment').first();
      const rowText = `${await row.innerText()} ${await row.getAttribute('aria-label')}`;
      for (const reference of references) {
        assert.ok(!rowText.includes(reference), `payment row exposed reference ${reference}`);
      }

      await row.focus();
      await row.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Payment details' });
      await dialog.waitFor({ state: 'visible' });
      for (const reference of references) {
        await dialog.getByText(reference, { exact: true }).waitFor({ state: 'visible' });
      }

      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    } finally {
      await context.close();
    }
  });

  it('opens payment details with Space and closes from the named control on desktop', async () => {
    const { context, page } = await signInAndOpenFinance({ width: 1440, height: 1000 });
    try {
      const pageFitsViewport = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      assert.ok(pageFitsViewport, 'desktop page should not overflow horizontally');

      const row = page.getByTestId('row-finance-payment').first();
      const rowText = `${await row.innerText()} ${await row.getAttribute('aria-label')}`;
      for (const reference of references) {
        assert.ok(!rowText.includes(reference), `payment row exposed reference ${reference}`);
      }

      await row.focus();
      await row.press('Space');
      const dialog = page.getByRole('dialog', { name: 'Payment details' });
      await dialog.waitFor({ state: 'visible' });
      for (const reference of references) {
        await dialog.getByText(reference, { exact: true }).waitFor({ state: 'visible' });
      }

      const closeButton = page.getByRole('button', { name: 'Close' });
      await closeButton.waitFor({ state: 'visible' });
      await closeButton.focus();
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
    } finally {
      await context.close();
    }
  });
});