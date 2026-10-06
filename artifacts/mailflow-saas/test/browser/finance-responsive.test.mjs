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

const regularUser = {
  ...admin,
  id: 'browser-test-regular-user-id',
  username: 'finance-browser-user',
  role: 'USER',
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

const filterablePayments = Array.from({ length: 20 }, (_, index) => {
  const reference = String(index + 1).padStart(2, '0');
  const accountNumber = String(20 - index).padStart(2, '0');
  const capturedAt = new Date(Date.UTC(2026, 8, 20 + index, 12)).toISOString();

  return {
    ...payment,
    id: `finance-filter-payment-${reference}`,
    receipt: `finance-filter-receipt-${reference}`,
    status: index % 5 === 2 ? 'refunded' : 'captured',
    amountMinor: 1000 + (index + 1) * 100,
    currency: index % 2 === 0 ? 'USD' : 'EUR',
    razorpayOrderId: `finance-filter-order-${reference}`,
    razorpayPaymentId: `finance-filter-gateway-payment-${reference}`,
    capturedAt,
    account: {
      ...payment.account,
      id: `finance-filter-account-${reference}`,
      username: `customer-${accountNumber}`,
      firstName: 'Customer',
      lastName: accountNumber,
      fullName: `Customer ${accountNumber}`,
      email: `customer-${accountNumber}@example.test`,
      registeredAt: '2026-01-15T10:00:00.000Z',
    },
    subscriptionPackage: {
      ...payment.subscriptionPackage,
      name: `Plan ${reference}`,
    },
    subscription: {
      ...payment.subscription,
      id: `finance-filter-subscription-${reference}`,
      startsAt: capturedAt,
      endsAt: new Date(Date.parse(capturedAt) + 90 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };
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

function makeFinancePage(records, searchParams) {
  let rows = [...records];
  const status = searchParams.get('status') ?? 'captured';
  if (status !== 'all') {
    rows = rows.filter(record => record.status === status);
  }

  const currency = searchParams.get('currency');
  if (currency) rows = rows.filter(record => record.currency === currency);

  const search = searchParams.get('search')?.trim().toLocaleLowerCase();
  if (search) {
    rows = rows.filter(record => [
      record.account.fullName,
      record.account.username,
      record.account.email,
      record.subscriptionPackage.name,
      record.id,
      record.subscription.id,
      record.receipt,
      record.razorpayOrderId,
      record.razorpayPaymentId,
    ].some(value => value.toLocaleLowerCase().includes(search)));
  }

  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  if (fromDate) rows = rows.filter(record => record.capturedAt.slice(0, 10) >= fromDate);
  if (toDate) rows = rows.filter(record => record.capturedAt.slice(0, 10) <= toDate);

  const sortBy = searchParams.get('sortBy') ?? 'capturedAt';
  const sortDirection = searchParams.get('sortDirection') ?? 'desc';
  const sortValues = {
    capturedAt: record => record.capturedAt,
    account: record => record.account.fullName.toLocaleLowerCase(),
    subscription: record => record.subscriptionPackage.name.toLocaleLowerCase(),
    amount: record => record.amountMinor,
  };
  const getSortValue = sortValues[sortBy] ?? sortValues.capturedAt;
  const direction = sortDirection === 'asc' ? 1 : -1;
  rows.sort((left, right) => {
    const leftValue = getSortValue(left);
    const rightValue = getSortValue(right);
    const comparison = typeof leftValue === 'number'
      ? leftValue - rightValue
      : leftValue.localeCompare(rightValue);
    return comparison * direction;
  });

  const page = Number(searchParams.get('page') ?? 1);
  const pageSize = Number(searchParams.get('pageSize') ?? 25);
  const offset = (page - 1) * pageSize;
  const summaryByCurrency = [...new Set(records.map(record => record.currency))].sort().map(value => {
    const currencyRows = rows.filter(record => record.currency === value);
    const capturedRows = currencyRows.filter(record => record.status === 'captured');
    const refundedRows = currencyRows.filter(record => record.status === 'refunded');
    return {
      currency: value,
      paymentCount: currencyRows.length,
      capturedCount: capturedRows.length,
      refundedCount: refundedRows.length,
      capturedAmountMinor: String(capturedRows.reduce((sum, record) => sum + record.amountMinor, 0)),
      refundedAmountMinor: String(refundedRows.reduce((sum, record) => sum + record.amountMinor, 0)),
    };
  });

  return {
    rows: rows.slice(offset, offset + pageSize),
    total: rows.length,
    page,
    pageSize,
    pageCount: Math.ceil(rows.length / pageSize),
    currencies: [...new Set(records.map(record => record.currency))].sort(),
    summaryByCurrency,
  };
}

function installApiFixtures(context, { financeRecords, user = admin } = {}) {
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
        json: { user },
      });
      return;
    }

    if (!cookie.includes('mailflow_session=finance-browser-test')) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }

    if (pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/admin/billing/packages') {
      await route.fulfill({ status: 200, json: { packages: [] } });
      return;
    }
    if (pathname === '/api/admin/finance/payments') {
      if (financeRecords) {
        const searchParams = new URL(request.url()).searchParams;
        await route.fulfill({
          status: 200,
          json: makeFinancePage(financeRecords, searchParams),
        });
        return;
      }
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

function watchFinanceResponses(page) {
  const responses = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/admin/finance/payments') {
      responses.push({ status: response.status(), url: response.url() });
    }
  });
  return responses;
}

async function signInAndOpenFinance(viewport, fixtureOptions) {
  const context = await browser.newContext({ viewport });
  await installApiFixtures(context, fixtureOptions);
  const page = await context.newPage();

  await page.goto(`${baseUrl}/login`);
  await page.getByTestId('input-identifier').fill(admin.username);
  await page.getByTestId('input-password').fill('browser-test-password');
  await page.getByTestId('button-sign-in').click();
  await page.waitForURL('**/admin');

  await page.goto(`${baseUrl}/admin/finance`);
  await page.getByRole('heading', { name: 'Payment ledger' }).waitFor();
  await page.getByTestId('row-finance-payment').first().waitFor();

  return { context, page };
}

function waitForFinanceRequest(page, expectedParams) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/finance/payments' &&
      Object.entries(expectedParams).every(([key, value]) => url.searchParams.get(key) === String(value));
  });
}

async function triggerFinanceRequest(page, expectedParams, action) {
  const responsePromise = waitForFinanceRequest(page, expectedParams);
  await action();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `finance request failed: ${response.url()}`);

  const url = new URL(response.url());
  for (const [key, value] of Object.entries(expectedParams)) {
    assert.equal(url.searchParams.get(key), String(value), `unexpected finance query parameter: ${key}`);
  }
}

async function assertVisibleFinanceNames(page, expectedNames) {
  await page.waitForFunction(names => {
    const rows = Array.from(document.querySelectorAll('[data-testid="row-finance-payment"]'));
    const visibleNames = rows.map(row => row.querySelectorAll('td')[1]?.querySelector('span')?.textContent?.trim());
    return visibleNames.length === names.length &&
      visibleNames.every((name, index) => name === names[index]);
  }, expectedNames);

  const rows = await page.getByTestId('row-finance-payment').all();
  const visibleNames = await Promise.all(rows.map(row =>
    row.locator('td').nth(1).locator('span').first().innerText(),
  ));
  assert.deepEqual(visibleNames, expectedNames);
}

describe('finance ledger access and responsive behavior', { concurrency: false }, () => {
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

  it('redirects signed-out visitors to sign-in without requesting finance records', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const financeResponses = watchFinanceResponses(page);

      await page.goto(`${baseUrl}/admin/finance`);
      await page.getByTestId('input-identifier').waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');

      assert.equal(new URL(page.url()).pathname, '/', 'signed-out visitor should land on sign-in');
      assert.deepEqual(financeResponses, [], 'signed-out visitor must not receive finance records');
    } finally {
      await context.close();
    }
  });

  it('redirects regular users away without requesting finance records', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context, { user: regularUser });
      await context.addCookies([{
        name: 'mailflow_session',
        value: 'finance-browser-test',
        url: baseUrl,
        sameSite: 'Lax',
      }]);
      const page = await context.newPage();
      const financeResponses = watchFinanceResponses(page);

      await page.goto(`${baseUrl}/admin/finance`);
      await page.waitForURL(url => url.pathname === '/dashboard');
      await page.waitForLoadState('networkidle');

      assert.equal(new URL(page.url()).pathname, '/dashboard', 'regular user should be redirected to their dashboard');
      assert.deepEqual(financeResponses, [], 'regular user must not receive finance records');
    } finally {
      await context.close();
    }
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

  it('applies search, status, currency, date, sorting, and page changes to finance results', async () => {
    const defaults = {
      accountStatus: 'any',
      sortBy: 'capturedAt',
      sortDirection: 'desc',
      page: '1',
      pageSize: '25',
    };

    const withFinancePage = async action => {
      const { context, page } = await signInAndOpenFinance(
        { width: 1440, height: 1000 },
        { financeRecords: filterablePayments },
      );
      try {
        await action(page);
      } finally {
        await context.close();
      }
    };

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, { ...defaults, status: 'captured', search: 'Customer 12' }, () =>
        page.getByTestId('input-finance-search').fill('Customer 12'),
      );
      await assertVisibleFinanceNames(page, ['Customer 12']);
      assert.match(await page.getByTestId('text-finance-results-count').innerText(), /^1 records$/);
    });

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, { ...defaults, status: 'refunded' }, () =>
        page.getByTestId('select-finance-status').selectOption('refunded'),
      );
      await assertVisibleFinanceNames(page, ['Customer 03', 'Customer 08', 'Customer 13', 'Customer 18']);
      const rows = await page.getByTestId('row-finance-payment').all();
      for (const row of rows) assert.match(await row.innerText(), /refunded/i);
    });

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, { ...defaults, status: 'captured', currency: 'EUR' }, () =>
        page.getByTestId('select-finance-currency').selectOption('EUR'),
      );
      await assertVisibleFinanceNames(page, [
        'Customer 01', 'Customer 05', 'Customer 07', 'Customer 09',
        'Customer 11', 'Customer 15', 'Customer 17', 'Customer 19',
      ]);
      const rows = await page.getByTestId('row-finance-payment').all();
      for (const row of rows) assert.match(await row.innerText(), /EUR/);
    });

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, {
        ...defaults,
        status: 'captured',
        fromDate: '2026-09-28',
        toDate: '2026-09-28',
      }, async () => {
        await page.getByTestId('input-finance-from-date').fill('2026-09-28');
        await page.getByTestId('input-finance-to-date').fill('2026-09-28');
      });
      await assertVisibleFinanceNames(page, ['Customer 12']);
    });

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, {
        ...defaults,
        status: 'captured',
        sortBy: 'account',
      }, () => page.getByRole('button', { name: 'Customer account' }).click());
      await assertVisibleFinanceNames(page, [
        'Customer 20', 'Customer 19', 'Customer 17', 'Customer 16',
        'Customer 15', 'Customer 14', 'Customer 12', 'Customer 11',
        'Customer 10', 'Customer 09', 'Customer 07', 'Customer 06',
        'Customer 05', 'Customer 04', 'Customer 02', 'Customer 01',
      ]);
    });

    await withFinancePage(async page => {
      await triggerFinanceRequest(page, {
        ...defaults,
        status: 'captured',
        pageSize: '10',
      }, () => page.getByTestId('select-finance-page-size').selectOption('10'));
      await assertVisibleFinanceNames(page, [
        'Customer 01', 'Customer 02', 'Customer 04', 'Customer 05',
        'Customer 06', 'Customer 07', 'Customer 09', 'Customer 10',
        'Customer 11', 'Customer 12',
      ]);
      assert.match(await page.getByTestId('text-finance-page-range').innerText(), /Showing 1–10 of 16 · page 1 of 2/);

      await triggerFinanceRequest(page, {
        ...defaults,
        status: 'captured',
        page: '2',
        pageSize: '10',
      }, () => page.getByTestId('button-finance-next-page').click());
      await assertVisibleFinanceNames(page, [
        'Customer 14', 'Customer 15', 'Customer 16',
        'Customer 17', 'Customer 19', 'Customer 20',
      ]);
      assert.match(await page.getByTestId('text-finance-page-range').innerText(), /Showing 11–16 of 16 · page 2 of 2/);
    });
  });
});