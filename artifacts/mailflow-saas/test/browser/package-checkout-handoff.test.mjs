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
const fallbackFreePackage = {
  ...freePackage,
  id: '48169af3-fcf0-46da-9d4a-ae1b9783fab2',
  name: 'Basic plan',
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

async function installCheckoutFixtures(context, {
  accountExists,
  packages,
  unavailablePackageIdOnVerify,
  packageChangesOnVerify,
  packageLookupFailuresAfterVerification = 0,
  initialUser = null,
  scheduledSubscription = null,
}) {
  const state = {
    authenticated: Boolean(initialUser),
    user: initialUser,
    subscription: null,
    scheduledSubscription,
    packages: [...packages],
    requestBodies: [],
    verificationCompleted: false,
    packageLookupFailuresRemaining: packageLookupFailuresAfterVerification,
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
      if (state.verificationCompleted && state.packageLookupFailuresRemaining > 0) {
        state.packageLookupFailuresRemaining -= 1;
        return respond(503, { error: 'Current plans are temporarily unavailable.' });
      }
      return respond(200, {
        packages: state.packages,
        sendingLimits: { emailsPerHourPerSmtp: 100, emailsPerDayPerSmtp: 1000 },
      });
    }
    if (pathname === '/api/auth/package-checkout/request-code' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      return respond(200, { message: 'A verification code has been sent.' });
    }
    if (pathname === '/api/auth/package-checkout/verify-code' && method === 'POST') {
      state.requestBodies.push({ pathname, body: jsonBody });
      if (packageChangesOnVerify) {
        state.packages = state.packages.map(pkg => pkg.id === packageChangesOnVerify.packageId
          ? { ...pkg, ...packageChangesOnVerify.changes }
          : pkg);
      }
      if (unavailablePackageIdOnVerify) {
        state.packages = state.packages.filter(pkg => pkg.id !== unavailablePackageIdOnVerify);
      }
      state.verificationCompleted = true;
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
      return respond(200, {
        subscription: state.subscription,
        scheduledSubscription: state.scheduledSubscription,
      });
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
      const selected = state.packages.find(pkg => pkg.id === jsonBody.packageId);
      if (!selected) return respond(404, { error: 'That free package is not available for activation.' });
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
      const selected = state.packages.find(pkg => pkg.id === jsonBody.packageId);
      if (!selected) {
        return respond(404, { error: 'That package is not available for purchase.' });
      }
      return respond(201, {
        ...order,
        amountMinor: selected.amountMinor,
        currency: selected.currency,
        packageName: selected.name,
      });
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

  for (const { label, selectedPackage, changes, expectedTerms, outcome } of [
    {
      label: 'price',
      selectedPackage: paidPackage,
      changes: { amountMinor: 3499 },
      expectedTerms: /34\.99/,
      outcome: 'order',
    },
    {
      label: 'term',
      selectedPackage: freePackage,
      changes: { periodDays: 60 },
      expectedTerms: /Term:\s*2 months/,
      outcome: 'activation',
    },
    {
      label: 'limits',
      selectedPackage: paidPackage,
      changes: { contactLimit: 250, emailAccountLimit: 2 },
      expectedTerms: /Contacts:\s*up to 250[\s\S]*SMTP sender accounts:\s*2/,
      outcome: 'order',
    },
  ]) {
    it(`requires confirmation when the ${label} changes after the email code is sent`, async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const state = await installCheckoutFixtures(context, {
        accountExists: false,
        packages: [selectedPackage],
        packageChangesOnVerify: {
          packageId: selectedPackage.id,
          changes,
        },
      });
      const page = await context.newPage();
      try {
        await page.goto(`${baseUrl}/pricing`);
        await page.getByTestId(`package-cta-${selectedPackage.id}`).click();
        await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
        await page.getByTestId('input-package-checkout-email').fill(`changed-${label}@example.test`);
        await page.getByTestId('button-package-checkout-continue').click();
        await page.getByTestId('input-package-checkout-code').waitFor();
        await page.getByTestId('input-package-checkout-code').fill('123456');
        await page.getByTestId('button-package-checkout-continue').click();
        await page.waitForURL(url => url.pathname === '/register');

        await page.getByTestId('input-first-name').fill('Changed');
        await page.getByTestId('input-last-name').fill('Terms');
        await page.getByTestId('input-register-password').fill('changed-plan-terms-password');
        await page.getByTestId('button-create-account').click();
        await page.waitForURL(url => url.pathname === '/plans');
        await page.getByTestId('dialog-checkout-terms-changed').waitFor();

        const displayedTerms = await page.getByTestId('current-checkout-terms').innerText();
        assert.match(displayedTerms, expectedTerms);
        assert.deepEqual(state.orderAttempts, [], 'no paid order is created before confirmation');
        assert.deepEqual(state.freeActivationAttempts, [], 'no free plan is activated before confirmation');
        assert.equal(await page.evaluate(() => window.__checkoutOptions.length), 0);

        await page.getByTestId('button-confirm-current-plan-terms').click();
        if (outcome === 'activation') {
          await page.getByTestId('status-payment').getByText('Subscription active').waitFor();
          assert.equal(state.freeActivationAttempts.length, 1);
          assert.deepEqual(state.orderAttempts, []);
        } else {
          await page.getByTestId('status-payment').getByText(/Checkout was closed/).waitFor();
          assert.equal(state.orderAttempts.length, 1);
          assert.deepEqual(state.freeActivationAttempts, []);
        }
      } finally {
        await context.close();
      }
    });
  }

  for (const { selectedPackage, otherPackage, outcomeLabel } of [
    { selectedPackage: freePackage, otherPackage: paidPackage, outcomeLabel: 'free activation' },
    { selectedPackage: paidPackage, otherPackage: freePackage, outcomeLabel: 'paid order' },
  ]) {
    it(`lets a verified new customer switch to a current plan before ${outcomeLabel}`, async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const state = await installCheckoutFixtures(context, {
        accountExists: false,
        packages: [selectedPackage, otherPackage],
        unavailablePackageIdOnVerify: selectedPackage.id,
      });
      const page = await context.newPage();
      const browserLogs = [];
      watchBrowserLogs(page, { browserLogs });
      const email = `stale-${outcomeLabel.replaceAll(' ', '-')}-customer@example.test`;
      const proof = 'private-registration-proof-token';
      try {
        await page.goto(`${baseUrl}/pricing`);
        await page.getByTestId(`package-cta-${selectedPackage.id}`).click();
        await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
        await page.getByTestId('input-package-checkout-email').fill(email);
        await page.getByTestId('button-package-checkout-continue').click();
        await page.getByTestId('input-package-checkout-code').waitFor();
        await page.getByTestId('input-package-checkout-code').fill('123456');
        await page.getByTestId('button-package-checkout-continue').click();

        await page.getByTestId('package-checkout-replacements').waitFor();
        assert.equal(page.url().includes('/register'), false, 'account creation waits until a current plan is chosen');
        assert.match(await page.getByTestId('package-checkout-replacements').innerText(), /no longer available/i);
        assert.equal(await page.getByTestId(`card-package-${otherPackage.id}`).count(), 1);
        assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/request-code').length, 1);
        assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length, 1);
        assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, '123456', proof]);

        await page.getByTestId(`button-select-replacement-${otherPackage.id}`).click();
        await page.waitForURL(url => url.pathname === '/register');
        assert.equal(new URL(page.url()).searchParams.get('packageId'), otherPackage.id);
        assert.match(await page.locator('main').innerText(), new RegExp(otherPackage.name));
        assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, '123456', proof]);

        await page.getByTestId('input-first-name').fill('Stale');
        await page.getByTestId('input-last-name').fill('Plan');
        await page.getByTestId('input-register-password').fill('stale-plan-customer-2026');
        await page.getByTestId('button-create-account').click();
        await page.waitForURL(url => url.pathname === '/plans');
        assert.equal(state.authenticated, true, 'the account should be created and signed in');
        assert.equal(state.user.email, email);
        assert.equal(state.requestBodies.find(item => item.pathname === '/api/auth/register')?.body.emailVerificationProof, proof);
        assert.deepEqual(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length, 1);
        assertPrivateValuesStayOutOfBrowserSurface(page.url(), browserLogs, [email, '123456', proof]);

        if (otherPackage.amountMinor === 0) {
          await page.getByTestId('status-payment').getByText('Subscription active').waitFor();
          assert.deepEqual(state.freeActivationAttempts, [{
            authenticated: true,
            body: { packageId: otherPackage.id },
          }]);
          assert.deepEqual(state.orderAttempts, []);
          assert.equal(await page.getByTestId('current-subscription').innerText().then(text => text.includes(otherPackage.name)), true);
        } else {
          await page.getByTestId('status-payment').getByText(/Checkout was closed/).waitFor();
          assert.deepEqual(state.freeActivationAttempts, []);
          assert.equal(state.orderAttempts.length, 1);
          assert.equal(state.orderAttempts[0].body.packageId, otherPackage.id);
          assert.equal(await page.evaluate(() => window.__checkoutOptions[0]?.amount), otherPackage.amountMinor);
        }
        const accountAfterCheckout = await page.evaluate(async () => {
          const response = await fetch('/api/auth/me');
          return response.ok ? response.json() : null;
        });
        assert.equal(accountAfterCheckout.email, email, 'the account remains accessible after the unavailable plan is rejected');
      } finally {
        await context.close();
      }
    });
  }

  it('returns a verified signup to current plan choices when its replacement is withdrawn before registration', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const state = await installCheckoutFixtures(context, {
      accountExists: false,
      packages: [freePackage, paidPackage, fallbackFreePackage],
      unavailablePackageIdOnVerify: freePackage.id,
    });
    const page = await context.newPage();
    const email = 'replacement-withdrawn@example.test';
    const proof = 'private-registration-proof-token';
    try {
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${freePackage.id}`).click();
      await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
      await page.getByTestId('input-package-checkout-email').fill(email);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      await page.getByTestId('input-package-checkout-code').fill('123456');
      await page.getByTestId('button-package-checkout-continue').click();

      await page.getByTestId('package-checkout-replacements').waitFor();
      await page.getByTestId(`button-select-replacement-${paidPackage.id}`).click();
      await page.waitForURL(url => url.pathname === '/register');
      await page.getByTestId('input-first-name').fill('Replacement');
      await page.getByTestId('input-last-name').fill('Customer');
      await page.getByTestId('input-register-password').fill('replacement-plan-password-2026');

      state.packages = state.packages.filter(pkg => pkg.id !== paidPackage.id);
      await page.getByTestId('button-create-account').click();

      await page.waitForURL(url => url.pathname === '/package-checkout');
      assert.equal(new URL(page.url()).searchParams.get('packageId'), paidPackage.id);
      await page.getByTestId('package-checkout-replacements').waitFor();
      assert.match(await page.getByTestId('package-checkout-replacements').innerText(), /no longer available/i);
      assert.equal(await page.getByTestId(`card-package-${fallbackFreePackage.id}`).count(), 1);
      assert.deepEqual(
        state.requestBodies.filter(item => item.pathname === '/api/auth/register'),
        [],
        'registration is blocked until the customer chooses a current plan',
      );
      assert.deepEqual(state.orderAttempts, [], 'no order is created for the withdrawn replacement');
      assert.deepEqual(state.freeActivationAttempts, [], 'no plan is activated before a current plan is chosen');
      assert.equal(
        state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length,
        1,
        'the saved verification proof avoids another email code',
      );

      await page.getByTestId(`button-select-replacement-${fallbackFreePackage.id}`).click();
      await page.waitForURL(url => url.pathname === '/register');
      await page.getByTestId('input-first-name').fill('Replacement');
      await page.getByTestId('input-last-name').fill('Customer');
      await page.getByTestId('input-register-password').fill('replacement-plan-password-2026');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/plans');
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.equal(state.authenticated, true);
      assert.equal(state.user.email, email);
      assert.deepEqual(state.orderAttempts, [], 'the withdrawn paid plan never creates an order');
      assert.deepEqual(state.freeActivationAttempts, [{
        authenticated: true,
        body: { packageId: fallbackFreePackage.id },
      }], 'only the current free plan is activated');
      assert.equal(
        state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length,
        1,
      );
      assert.equal(
        state.requestBodies.find(item => item.pathname === '/api/auth/register')?.body.emailVerificationProof,
        proof,
      );
    } finally {
      await context.close();
    }
  });

  it('recovers verified signup after current-plan lookups fail, without repeating email verification', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const state = await installCheckoutFixtures(context, {
      accountExists: false,
      packages: [freePackage],
      // TanStack Query retries each failed lookup once. Fail both the post-verification
      // lookup and the first explicit retry, then allow the next retry to succeed.
      packageLookupFailuresAfterVerification: 4,
    });
    const page = await context.newPage();
    const email = 'verified-plan-retry@example.test';
    try {
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${freePackage.id}`).click();
      await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
      await page.getByTestId('input-package-checkout-email').fill(email);
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      await page.getByTestId('input-package-checkout-code').fill('123456');
      await page.getByTestId('button-package-checkout-continue').click();

      const retryButton = page.getByTestId('button-retry-plan-availability');
      await retryButton.waitFor();
      assert.equal(await page.locator('[data-testid="input-package-checkout-code"]').count(), 0);
      assert.equal(await page.locator('[data-testid="input-package-checkout-email"]').count(), 0);
      assert.equal(await page.getByTestId('input-first-name').count(), 0, 'registration stays blocked until plans are confirmed');

      await retryButton.click();
      await page.getByTestId('status-replacement-plan-error').waitFor();
      assert.equal(await page.getByTestId('input-first-name').count(), 0, 'a failed retry must not unlock registration');
      assert.equal(await retryButton.isVisible(), true, 'the customer can clearly retry the plan check');
      assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/request-code').length, 1);
      assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length, 1);

      await retryButton.click();
      await page.waitForURL(url => url.pathname === '/register');
      assert.equal(new URL(page.url()).searchParams.get('packageId'), freePackage.id);
      assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/request-code').length, 1);
      assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length, 1);

      await page.getByTestId('input-first-name').fill('Verified');
      await page.getByTestId('input-last-name').fill('Customer');
      await page.getByTestId('input-register-password').fill('verified-plan-retry-password');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/plans');
      assert.equal(state.authenticated, true);
      assert.equal(state.user.email, email);
      assert.equal(state.requestBodies.filter(item => item.pathname === '/api/auth/package-checkout/verify-code').length, 1);
      assert.equal(state.requestBodies.find(item => item.pathname === '/api/auth/register')?.body.emailVerificationProof, 'private-registration-proof-token');
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();
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

  it('shows a Razorpay-confirmed scheduled plan and its effective date after revisiting Plans', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const customer = makeUser('scheduled-plan-customer@example.test');
    const scheduledSubscription = {
      id: 'scheduled-subscription-id',
      status: 'active',
      startsAt: '2026-10-22T15:30:00.000Z',
      endsAt: '2026-11-21T15:30:00.000Z',
      paymentConfirmed: true,
      package: {
        ...paidPackage,
        id: 'lower-limit-plan-id',
        name: 'Starter plan',
        contactLimit: 25,
        emailAccountLimit: 1,
      },
    };
    await installCheckoutFixtures(context, {
      accountExists: true,
      packages: [paidPackage],
      initialUser: customer,
      scheduledSubscription,
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/plans`);
      await page.getByTestId('scheduled-plan-change').waitFor();
      const confirmation = await page.getByTestId('text-scheduled-plan-date').innerText();
      const expectedStartDate = await page.evaluate(
        startsAt => new Date(startsAt).toLocaleDateString(),
        scheduledSubscription.startsAt,
      );
      assert.match(confirmation, /Razorpay confirmed your payment/);
      assert.match(confirmation, /Starter plan/);
      assert.ok(confirmation.includes(expectedStartDate));
      assert.match(confirmation, /no automatic renewal/i);
    } finally {
      await context.close();
    }
  });
});
