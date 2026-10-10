import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const paidPackage = {
  id: '9cf2f2ae-61bb-4523-a582-dcb843f48a30',
  packageType: 'primary',
  name: 'Growth plan',
  description: 'A paid package used to verify authenticated checkout handoff.',
  amountMinor: 2499,
  currency: 'USD',
  periodDays: 30,
  contactLimit: 100,
  emailAccountLimit: 1,
  researchAllowance: 0,
  aiEmailAssistAllowance: 0,
  additionalMailboxCount: 0,
  preferred: false,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const freePackage = {
  ...paidPackage,
  id: 'ef2e5c91-4e26-42dd-9630-2875680aab2a',
  name: 'Starter plan',
  description: 'A free package used to verify activation without payment.',
  amountMinor: 0,
};
const order = {
  paymentId: '56b83116-e2ae-4bb4-9f89-86faece8f8fb',
  orderId: 'order_checkout_handoff_test',
  amountMinor: paidPackage.amountMinor,
  currency: paidPackage.currency,
  keyId: 'rzp_test_checkout_handoff',
  packageName: paidPackage.name,
  customerName: 'Existing Customer',
  customerEmail: 'existing-customer@example.test',
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
    if (!response.ok) throw new Error(`Browser test server returned HTTP ${response.status} at ${baseUrl}`);
    return;
  }

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
      if ((await fetch(baseUrl)).ok) return;
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

function makeUser(email) {
  return {
    id: email === order.customerEmail ? 'existing-user-id' : 'new-user-id',
    username: email === order.customerEmail ? 'existing-customer' : 'new-customer',
    firstName: email === order.customerEmail ? 'Existing' : 'New',
    lastName: 'Customer',
    email,
    role: 'USER',
    timezone: 'UTC',
    active: true,
    emailVerified: true,
    mustChangeCredentials: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

async function installCheckoutFixtures(context, { accountExists, packages }) {
  const state = {
    authenticated: false,
    user: null,
    subscription: null,
    requestBodies: [],
    orderAttempts: [],
    freeActivationAttempts: [],
  };
  await context.addInitScript(() => {
    window.__checkoutOptions = [];
    window.__installCheckoutMock = () => {
      window.Razorpay = function(options) {
        window.__checkoutOptions.push({
          key: options.key,
          orderId: options.order_id,
          amount: options.amount,
          currency: options.currency,
          prefillEmail: options.prefill.email,
        });
        this.open = () => window.setTimeout(() => options.modal.ondismiss(), 0);
      };
    };
  });
  await context.route('https://checkout.razorpay.com/v1/checkout.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.__installCheckoutMock();',
  }));
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const respond = (status, body) => route.fulfill({ status, json: body });
    const jsonBody = method === 'POST' ? request.postDataJSON() : undefined;

    if (pathname === '/api/maintenance/status') return respond(200, { maintenanceMode: false });
    if (pathname === '/api/auth/me') {
      if (!state.authenticated || !state.user) return respond(401, { error: 'Not authenticated.' });
      return respond(200, state.user);
    }
    if (pathname === '/api/auth/password-policy') return respond(200, { passwordMinimumLength: 12 });
    if (pathname === '/api/subscriptions/packages' && method === 'GET') {
      return respond(200, {
        packages,
        sendingLimits: { emailsPerHourPerSmtp: 100, emailsPerDayPerSmtp: 1000 },
      });
    }
    if (pathname === '/api/auth/package-checkout/request-code' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      return respond(200, { message: 'A verification code has been sent.' });
    }
    if (pathname === '/api/auth/package-checkout/verify-code' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      return respond(200, accountExists
        ? { accountExists: true }
        : { accountExists: false, registrationProofToken: 'private-registration-proof-token' });
    }
    if (pathname === '/api/auth/register' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      state.user = makeUser(jsonBody.email);
      state.authenticated = true;
      return respond(201, { message: 'Account created.', user: state.user });
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      if (jsonBody.identifier !== order.customerEmail || jsonBody.password !== 'existing-account-password') {
        return respond(401, { error: 'Invalid credentials.' });
      }
      state.user = makeUser(jsonBody.identifier);
      state.authenticated = true;
      return respond(200, { user: state.user });
    }
    if (!state.authenticated) return respond(401, { error: 'Not authenticated.' });
    if (pathname === '/api/notifications' && method === 'GET') {
      return respond(200, { unread: [], history: [] });
    }
    if (pathname === '/api/subscriptions/current' && method === 'GET') {
      return respond(200, { subscription: state.subscription, scheduledSubscription: null });
    }
    if (pathname === '/api/subscriptions/add-ons' && method === 'GET') {
      return respond(200, {
        eligible: false,
        eligibilityReason: 'paid_primary_required',
        primaryEndsAt: null,
        balances: {
          research: { total: 0, used: 0, remaining: 0 },
          emailAssist: { total: 0, used: 0, remaining: 0 },
          mailboxes: { baseLimit: 0, additionalSlots: 0, totalLimit: 0, used: 0, remaining: 0, active: false },
        },
        refundAdjustments: [],
        packages: [],
        claimedFreePackageIds: [],
      });
    }
    if (pathname === '/api/company-intelligence/allowance' && method === 'GET') {
      return respond(200, { allowance: { limit: 0, used: 0, remaining: 0 } });
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      return respond(200, {
        contacts: [],
        quota: { used: 0, limit: 0, remaining: 0, canAdd: false, requiresSubscription: true },
        uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['csv'] },
      });
    }
    if (pathname === '/api/subscriptions/payment-availability' && method === 'GET') {
      return respond(200, { enabled: true, superadminEmail: null });
    }
    if (pathname === '/api/sending/accounts' && method === 'GET') {
      return respond(200, {
        accounts: [],
        emailAccountLimit: state.subscription?.package.emailAccountLimit ?? 0,
        configuredCount: 0,
        overLimit: false,
        scheduledDowngrade: null,
      });
    }
    if (pathname === '/api/subscriptions/free' && method === 'POST') {
      state.freeActivationAttempts.push({ authenticated: state.authenticated, body: jsonBody });
      const selected = packages.find(pkg => pkg.id === jsonBody.packageId);
      state.subscription = {
        id: 'free-subscription-id',
        status: 'active',
        startsAt: '2026-10-10T00:00:00.000Z',
        endsAt: '2026-11-09T00:00:00.000Z',
        package: selected,
      };
      return respond(200, { message: 'Free plan activated.', subscription: state.subscription });
    }
    if (pathname === '/api/subscriptions/orders' && method === 'POST') {
      state.orderAttempts.push({ authenticated: state.authenticated, user: state.user, body: jsonBody });
      return respond(201, order);
    }
    return respond(404, { error: `Unexpected API request: ${pathname} ${method}` });
  });
  return state;
}

function watchBrowserLogs(page, state) {
  page.on('console', message => state.browserLogs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', error => state.browserLogs.push(`pageerror: ${error.message}`));
}

function assertPrivateValuesStayOutOfBrowserSurface(pageUrl, browserLogs, privateValues) {
  const serializedUrl = String(pageUrl);
  const serializedLogs = JSON.stringify(browserLogs);
  for (const privateValue of privateValues) {
    assert.equal(serializedUrl.includes(privateValue), false, `URL must not include ${privateValue}`);
    assert.equal(serializedLogs.includes(privateValue), false, `Browser logs must not include ${privateValue}`);
  }
}

describe('package checkout account and payment handoff', { concurrency: false }, () => {
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

  it('sends a new account from Pricing to verified free activation without payment', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const state = await installCheckoutFixtures(context, { accountExists: false, packages: [freePackage] });
    const page = await context.newPage();
    const browserLogs = [];
    watchBrowserLogs(page, { browserLogs });
    const email = 'new-checkout-customer@example.test';
    const code = '123456';
    const proof = 'private-registration-proof-token';
    try {
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${freePackage.id}`).click();
      await page.waitForURL(url => url.pathname === '/package-checkout/starter-plan');
      assert.match(await page.locator('main').innerText(), /Starter plan/);
      assert.equal(state.freeActivationAttempts.length, 0);

      await page.getByTestId('input-package-checkout-email').fill(email);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, code, proof]);
      await page.getByTestId('input-package-checkout-code').fill(code);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.waitForURL(url => url.pathname === '/register');
      assert.equal(new URL(page.url()).searchParams.get('packageId'), freePackage.id);
      assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, code, proof]);

      await page.getByTestId('input-first-name').fill('New');
      await page.getByTestId('input-last-name').fill('Customer');
      await page.getByTestId('input-register-password').fill('new-account-password-2026');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/plans');
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.equal(state.authenticated, true);
      assert.equal(state.user.email, email);
      assert.deepEqual(state.freeActivationAttempts, [{
        authenticated: true,
        body: { packageId: freePackage.id },
      }]);
      assert.deepEqual(state.orderAttempts, []);
      assert.equal(await page.evaluate(() => window.__checkoutOptions.length), 0);
      assert.equal(await page.getByTestId('current-subscription').innerText().then(text => text.includes('Starter plan')), true);
      assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, code, proof]);
      assert.equal(state.requestBodies.find(item => item.pathname === '/api/auth/register')?.body.emailVerificationProof, proof);
    } finally {
      await context.close();
    }
  });

  it('authenticates the existing account before routing the selected paid package to Razorpay and preserves it on dismissal', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const state = await installCheckoutFixtures(context, { accountExists: true, packages: [paidPackage] });
    const page = await context.newPage();
    const browserLogs = [];
    watchBrowserLogs(page, { browserLogs });
    const email = order.customerEmail;
    const code = '654321';
    try {
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${paidPackage.id}`).click();
      await page.waitForURL(url => url.pathname === '/package-checkout/growth-plan');
      assert.match(await page.locator('main').innerText(), /Growth plan/);

      await page.getByTestId('input-package-checkout-email').fill(email);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      await page.getByTestId('input-package-checkout-code').fill(code);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-password').waitFor();
      assert.deepEqual(state.orderAttempts, [], 'a verified email alone must not create a paid order');
      assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, code]);

      await page.getByTestId('input-package-checkout-password').fill('existing-account-password');
      await page.getByTestId('button-package-checkout-continue').click();
      await page.waitForURL(url => url.pathname === '/plans');
      await page.getByTestId('status-payment').getByText(/Checkout was closed/).waitFor();

      assert.equal(state.authenticated, true);
      assert.equal(state.user.email, email);
      assert.equal(state.orderAttempts.length, 1);
      assert.deepEqual(state.orderAttempts[0], {
        authenticated: true,
        user: state.user,
        body: { packageId: paidPackage.id },
      });
      assert.deepEqual(await page.evaluate(() => window.__checkoutOptions), [{
        key: order.keyId,
        orderId: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        prefillEmail: email,
      }]);
      assert.equal(state.freeActivationAttempts.length, 0);
      assert.equal(state.subscription, null);
      assert.match(await page.getByTestId('current-subscription').innerText(), /No active subscription/);
      const accountAfterDismissal = await page.evaluate(async () => {
        const response = await fetch('/api/auth/me');
        return response.ok ? response.json() : null;
      });
      assert.equal(accountAfterDismissal.email, email);
      assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, code]);
    } finally {
      await context.close();
    }
  });
});
