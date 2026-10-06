import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const user = {
  id: 'browser-test-free-plan-user-id',
  username: 'free-plan-browser-user',
  firstName: 'Free Plan',
  lastName: 'User',
  email: 'free-plan-user@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const freePackage = {
  id: 'ef2e5c91-4e26-42dd-9630-2875680aab2a',
  name: 'Starter plan',
  description: 'A free package used to verify activation tracking.',
  amountMinor: 0,
  currency: 'USD',
  periodDays: 30,
  contactLimit: 100,
  emailAccountLimit: 1,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const activatedSubscription = {
  id: '8f00ce32-1019-49e8-87eb-c0847635b27b',
  status: 'active',
  startsAt: '2026-10-05T00:00:00.000Z',
  endsAt: '2026-11-04T00:00:00.000Z',
  package: freePackage,
};
const paidPackage = {
  ...freePackage,
  id: '9cf2f2ae-61bb-4523-a582-dcb843f48a30',
  name: 'Growth plan',
  description: 'A paid package used to verify activation tracking.',
  amountMinor: 2499,
  emailAccountLimit: 1,
};
const paidSubscription = {
  ...activatedSubscription,
  id: '07bc8789-b710-450a-87d7-62fef5479b71',
  package: paidPackage,
};
const paidOrder = {
  paymentId: '56b83116-e2ae-4bb4-9f89-86faece8f8fb',
  orderId: 'order_browser_test',
  amountMinor: paidPackage.amountMinor,
  currency: paidPackage.currency,
  keyId: 'rzp_test_browser',
  packageName: paidPackage.name,
  customerName: 'Paid Plan',
  customerEmail: 'paid-plan@example.test',
};

let serverProcess;
let serverOutput = '';
let browser;
let baseUrl;

function makeSenderAccount(id, isPrimary = false) {
  return {
    id,
    provider: 'other',
    host: `smtp.${id}.example.test`,
    port: 587,
    encryption: 'tls',
    username: '••••••••',
    credentialsConfigured: true,
    fromName: `Sender ${id}`,
    fromEmail: `${id}@example.test`,
    replyTo: null,
    verified: true,
    verifiedAt: '2026-01-01T00:00:00.000Z',
    connectionCheckStatus: null,
    connectionCheckAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    isPrimary,
    lastUsedAt: null,
    activeCampaignCount: 0,
  };
}

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

async function installFixtures(context, {
  activationStatus = 200,
  verificationStatus = 200,
  orderStatus = 201,
  orderStatuses,
  verificationResult = {
    status: 'active',
    message: 'Payment verified.',
    subscription: paidSubscription,
  },
  checkoutAction = null,
  checkoutActions = null,
  checkoutScriptFailure = false,
  checkoutScriptFailures = 0,
  packages = [freePackage],
  senderAccounts: initialSenderAccounts = [],
  senderAccountLimit = 1,
  analyticsThrows = false,
  deleteSenderAccountStatus = 204,
  createSenderAccountStatus = 201,
  setPrimarySenderAccountStatus = 200,
} = {}) {
  let senderAccounts = structuredClone(initialSenderAccounts);
  await context.addCookies([{
    name: 'mailflow_session',
    value: 'free-plan-browser-test',
    url: baseUrl,
    sameSite: 'Lax',
  }]);
  await context.addInitScript(({ checkoutAction, checkoutActions, orderId, checkoutScriptFailure, checkoutScriptFailures, analyticsThrows }) => {
    window.__analyticsCalls = [];
    window.__freeActivationResponses = [];
    window.__paidVerificationResponses = [];
    window.__paidOrderResponses = [];
    window.__subscriptionRequestBodies = [];
    window.__razorpayOpenedOrderIds = [];
    window.__razorpayCheckoutInstances = 0;
    window.umami = {
      track(...args) {
        if (analyticsThrows) throw new Error('Analytics is unavailable.');
        window.__analyticsCalls.push({
          args,
          freeActivationResponses: [...window.__freeActivationResponses],
          paidVerificationResponses: [...window.__paidVerificationResponses],
        });
      },
    };
    window.__installRazorpayCheckout = () => {
      if (!checkoutAction && !checkoutActions?.length) return;
      window.Razorpay = function(options) {
        const instanceIndex = window.__razorpayCheckoutInstances++;
        const action = checkoutActions?.[instanceIndex] ?? checkoutAction;
        this.open = () => {
          window.__razorpayOpenedOrderIds.push(options.order_id);
          if (action === 'throw-on-open') {
            throw new Error('Checkout could not open.');
          }
          window.setTimeout(() => {
            if (action === 'dismiss') {
              options.modal.ondismiss();
            } else if (action === 'complete') {
              options.handler({
                razorpay_payment_id: 'pay_browser_test',
                razorpay_order_id: orderId,
                razorpay_signature: 's'.repeat(64),
              });
            }
          }, 0);
        };
      };
    };
    if ((checkoutAction || checkoutActions?.length) && !checkoutScriptFailure && checkoutScriptFailures === 0) {
      window.__installRazorpayCheckout();
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      const pathname = new URL(url, window.location.href).pathname;
      if (pathname === '/api/subscriptions/free' || pathname === '/api/subscriptions/orders') {
        try {
          window.__subscriptionRequestBodies.push({
            pathname,
            body: JSON.parse(args[1]?.body ?? '{}'),
          });
        } catch {
          // The browser tests only inspect valid JSON mutation requests.
        }
      }
      if (pathname === '/api/subscriptions/free') {
        window.__freeActivationResponses.push(response.status);
      }
      if (pathname === '/api/subscriptions/verify') {
        window.__paidVerificationResponses.push(response.status);
      }
      if (pathname === '/api/subscriptions/orders') {
        window.__paidOrderResponses.push(response.status);
      }
      return response;
    };
  }, { checkoutAction, checkoutActions, orderId: paidOrder.orderId, checkoutScriptFailure, checkoutScriptFailures, analyticsThrows });
  if (checkoutScriptFailure || checkoutScriptFailures > 0) {
    let checkoutScriptAttempts = 0;
    await context.route('https://checkout.razorpay.com/v1/checkout.js', async route => {
      checkoutScriptAttempts += 1;
      if (checkoutScriptFailure || checkoutScriptAttempts <= checkoutScriptFailures) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.__installRazorpayCheckout();',
      });
    });
  }
  let orderAttempt = 0;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const cookie = request.headers().cookie ?? '';

    if (!cookie.includes('mailflow_session=free-plan-browser-test')) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/subscriptions/packages') {
      await route.fulfill({ status: 200, json: { packages } });
      return;
    }
    if (pathname === '/api/subscriptions/current') {
      await route.fulfill({ status: 200, json: { subscription: null } });
      return;
    }
    if (pathname === '/api/sending/accounts' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          accounts: senderAccounts,
          emailAccountLimit: senderAccountLimit,
          configuredCount: senderAccounts.length,
          overLimit: senderAccounts.length > senderAccountLimit,
          scheduledDowngrade: null,
        },
      });
      return;
    }
    if (pathname === '/api/sending/gmail/connection') {
      await route.fulfill({
        status: 200,
        json: {
          configured: false,
          redirectUri: null,
          connected: false,
          emailAddress: null,
          syncStatus: 'idle',
          lastSyncAt: null,
          lastSuccessAt: null,
          nextSyncAt: null,
          lastError: null,
          pollIntervalSeconds: 60,
        },
      });
      return;
    }
    if (pathname === '/api/sending/accounts' && request.method() === 'POST') {
      if (createSenderAccountStatus !== 201) {
        await route.fulfill({ status: createSenderAccountStatus, json: { error: 'Sender creation failed.' } });
        return;
      }
      const input = request.postDataJSON();
      const account = {
        ...makeSenderAccount('new-sender', senderAccounts.length === 0),
        host: input.host,
        port: input.port,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
      };
      senderAccounts = [...senderAccounts, account];
      await route.fulfill({ status: 201, json: { account } });
      return;
    }
    const primaryAccountMatch = pathname.match(/^\/api\/sending\/accounts\/([^/]+)\/primary$/);
    if (primaryAccountMatch && request.method() === 'PUT') {
      if (setPrimarySenderAccountStatus !== 200) {
        await route.fulfill({ status: setPrimarySenderAccountStatus, json: { error: 'Default selection failed.' } });
        return;
      }
      senderAccounts = senderAccounts.map(account => ({
        ...account,
        isPrimary: account.id === primaryAccountMatch[1],
      }));
      await route.fulfill({ status: 200, json: { account: senderAccounts.find(account => account.id === primaryAccountMatch[1]) } });
      return;
    }
    const senderAccountMatch = pathname.match(/^\/api\/sending\/accounts\/([^/]+)$/);
    if (senderAccountMatch && request.method() === 'DELETE') {
      if (deleteSenderAccountStatus !== 204) {
        await route.fulfill({ status: deleteSenderAccountStatus, json: { error: 'Sender removal failed.' } });
        return;
      }
      senderAccounts = senderAccounts.filter(account => account.id !== senderAccountMatch[1]);
      if (!senderAccounts.some(account => account.isPrimary) && senderAccounts[0]) {
        senderAccounts[0] = { ...senderAccounts[0], isPrimary: true };
      }
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (pathname === '/api/subscriptions/orders' && request.method() === 'POST') {
      const responseStatus = orderStatuses
        ? orderStatuses[Math.min(orderAttempt, orderStatuses.length - 1)]
        : orderStatus;
      const currentOrderAttempt = orderAttempt++;
      await route.fulfill({
        status: responseStatus,
        json: responseStatus === 201
          ? { ...paidOrder, orderId: currentOrderAttempt === 0 ? paidOrder.orderId : `${paidOrder.orderId}_${currentOrderAttempt + 1}` }
          : { error: 'Order creation failed.' },
      });
      return;
    }
    if (pathname === '/api/subscriptions/verify' && request.method() === 'POST') {
      await route.fulfill({
        status: verificationStatus,
        json: verificationStatus === 200 ? verificationResult : { error: 'Payment verification failed.' },
      });
      return;
    }
    if (pathname === '/api/subscriptions/free' && request.method() === 'POST') {
      if (activationStatus !== 200) {
        await route.fulfill({
          status: activationStatus,
          json: { error: 'Free plan activation failed.' },
        });
        return;
      }
      await route.fulfill({ status: 200, json: { subscription: activatedSubscription } });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${request.method()} ${pathname}` },
    });
  });
}

async function openPlansPage(options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installFixtures(context, options);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/plans`);
  return { context, page };
}

async function openSendingPage(options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installFixtures(context, options);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sending-settings`);
  return { context, page };
}

describe('subscription activation analytics', { concurrency: false }, () => {
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

  it('tracks only after successful activation and sends no user or package details', async () => {
    const { context, page } = await openPlansPage({ activationStatus: 200 });
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      const trackingCalls = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(trackingCalls, [{
        args: ['free_subscription_activated', undefined],
        freeActivationResponses: [200],
        paidVerificationResponses: [],
      }]);
    } finally {
      await context.close();
    }
  });

  it('tracks failed free plan activation without properties or identifiers', async () => {
    const { context, page } = await openPlansPage({ activationStatus: 403 });
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Free plan activation failed.').waitFor();

      const trackingCalls = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(trackingCalls, [{
        args: ['free_subscription_activation_failed', undefined],
        freeActivationResponses: [403],
        paidVerificationResponses: [],
      }]);
      assert.deepEqual(
        await page.evaluate(() => window.__freeActivationResponses),
        [403],
      );
    } finally {
      await context.close();
    }
  });
  it('tracks only after server verification confirms an active subscription and sends no details', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'complete',
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_subscription_activated', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [200],
        },
      ]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), [200]);
    } finally {
      await context.close();
    }
  });

  it('does not count paid-plan retention while verification is still pending', async () => {
    const smtpAccounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'complete',
      senderAccounts: smtpAccounts,
      senderAccountLimit: 3,
      verificationResult: {
        status: 'pending',
        message: 'Payment has not been captured yet.',
        subscription: null,
      },
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Payment verification pending').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_payment_verification_pending', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [200],
        },
      ]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), [200]);
      assert.equal(
        (await page.evaluate(() => JSON.stringify(window.__analyticsCalls))).includes('smtp_sender_retention_completed'),
        false,
      );
    } finally {
      await context.close();
    }
  });

  it('does not track when server verification fails', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'complete',
      verificationStatus: 400,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Payment needs attention').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_payment_verification_failed', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [400],
        },
      ]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), [400]);
    } finally {
      await context.close();
    }
  });

  it('tracks paid checkout start without properties or identifiers', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'open',
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.waitForFunction(() => window.__analyticsCalls.length === 1);

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        args: ['paid_checkout_started', undefined],
        freeActivationResponses: [],
        paidVerificationResponses: [],
      }]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), []);
    } finally {
      await context.close();
    }
  });

  it('tracks paid checkout start and dismissal without properties or identifiers', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'dismiss',
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Checkout closed').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_checkout_dismissed', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
      ]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), []);
    } finally {
      await context.close();
    }
  });

  it('lets customers reopen checkout after dismissal and leaves the plan button usable', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutActions: ['dismiss', 'open'],
    });
    try {
      const purchaseButton = page.getByTestId(`button-purchase-plan-${paidPackage.id}`);
      await purchaseButton.click();
      await page.getByTestId('status-payment').getByText('Checkout closed').waitFor();
      await page.waitForFunction(testId => {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        return Boolean(button && !button.disabled && button.textContent?.includes('Choose Growth plan'));
      }, `button-purchase-plan-${paidPackage.id}`);
      assert.equal(await purchaseButton.isDisabled(), false);
      assert.match(await purchaseButton.innerText(), /Choose Growth plan/);
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls.map(call => call.args[0])), [
        'paid_checkout_started',
        'paid_checkout_dismissed',
      ]);

      await purchaseButton.click();
      await page.waitForFunction(() => window.__razorpayOpenedOrderIds.length === 2);

      assert.deepEqual(await page.evaluate(() => window.__paidOrderResponses), [201, 201]);
      assert.deepEqual(await page.evaluate(() => window.__razorpayOpenedOrderIds), [
        'order_browser_test',
        'order_browser_test_2',
      ]);
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls.map(call => call.args[0])), [
        'paid_checkout_started',
        'paid_checkout_dismissed',
        'paid_checkout_started',
      ]);
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), []);
    } finally {
      await context.close();
    }
  });

  it('tracks order creation failure without counting a checkout start or dismissal', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      orderStatus: 500,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Order creation failed.').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        args: ['paid_checkout_setup_failed', undefined],
        freeActivationResponses: [],
        paidVerificationResponses: [],
      }]);
    } finally {
      await context.close();
    }
  });

  it('returns to an interactive state after an order failure and starts checkout only after retry succeeds', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      orderStatuses: [500, 201],
      checkoutAction: 'open',
    });
    try {
      const purchaseButton = page.getByTestId(`button-purchase-plan-${paidPackage.id}`);
      await purchaseButton.click();
      await page.getByTestId('status-payment').getByText('Order creation failed.').waitFor();
      await page.waitForFunction(testId => {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        return Boolean(button && !button.disabled && button.textContent?.includes('Choose Growth plan'));
      }, `button-purchase-plan-${paidPackage.id}`);
      assert.equal(await purchaseButton.isDisabled(), false);
      assert.match(await purchaseButton.innerText(), /Choose Growth plan/);

      await purchaseButton.click();
      await page.waitForFunction(() => window.__analyticsCalls.length === 2);

      assert.deepEqual(await page.evaluate(() => window.__paidOrderResponses), [500, 201]);
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_setup_failed', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it('tracks checkout script failure without counting a checkout start or dismissal', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutScriptFailure: true,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Payment needs attention').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        args: ['paid_checkout_setup_failed', undefined],
        freeActivationResponses: [],
        paidVerificationResponses: [],
      }]);
    } finally {
      await context.close();
    }
  });

  it('reloads the checkout script and starts checkout after a script-load failure retry', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'open',
      checkoutScriptFailures: 1,
    });
    try {
      const purchaseButton = page.getByTestId(`button-purchase-plan-${paidPackage.id}`);
      await purchaseButton.click();
      await page.getByTestId('status-payment').getByText('Payment needs attention').waitFor();
      await page.waitForFunction(testId => {
        const button = document.querySelector(`[data-testid="${testId}"]`);
        return Boolean(button && !button.disabled && button.textContent?.includes('Choose Growth plan'));
      }, `button-purchase-plan-${paidPackage.id}`);
      assert.equal(await purchaseButton.isDisabled(), false);
      assert.match(await purchaseButton.innerText(), /Choose Growth plan/);

      await purchaseButton.click();
      await page.waitForFunction(() => window.__analyticsCalls.length === 2);

      assert.deepEqual(await page.evaluate(() => window.__paidOrderResponses), [201, 201]);
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_setup_failed', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it('does not count a checkout whose open call throws as started or dismissed', async () => {
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'throw-on-open',
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Payment needs attention').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        args: ['paid_checkout_setup_failed', undefined],
        freeActivationResponses: [],
        paidVerificationResponses: [],
      }]);
    } finally {
      await context.close();
    }
  });

  it('tracks accepted free-plan SMTP retention choices using aggregate values', async () => {
    const smtpAccounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openPlansPage({
      senderAccounts: smtpAccounts,
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['smtp_sender_retention_completed', {
            account_count: 2,
            retained_count: 1,
            account_limit: 1,
            outcome: 'accepted',
          }],
          freeActivationResponses: [200],
          paidVerificationResponses: [],
        },
        {
          args: ['free_subscription_activated', undefined],
          freeActivationResponses: [200],
          paidVerificationResponses: [],
        },
      ]);
      const request = await page.evaluate(() => window.__subscriptionRequestBodies[0]);
      assert.equal(request.pathname, '/api/subscriptions/free');
      assert.deepEqual(request.body.senderAccountIdsToKeep, [smtpAccounts[0].id]);
      const analyticsPayload = JSON.stringify(await page.evaluate(() => window.__analyticsCalls));
      for (const account of smtpAccounts) {
        assert.equal(analyticsPayload.includes(account.id), false);
        assert.equal(analyticsPayload.includes(account.fromEmail), false);
        assert.equal(analyticsPayload.includes(account.host), false);
      }
    } finally {
      await context.close();
    }
  });

  it('tracks paid-plan retention only after server confirmation and sends aggregate values', async () => {
    const smtpAccounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'complete',
      senderAccounts: smtpAccounts,
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        {
          args: ['paid_checkout_started', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [],
        },
        {
          args: ['paid_subscription_activated', undefined],
          freeActivationResponses: [],
          paidVerificationResponses: [200],
        },
        {
          args: ['smtp_sender_retention_completed', {
            account_count: 2,
            retained_count: 1,
            account_limit: 1,
            outcome: 'accepted',
          }],
          freeActivationResponses: [],
          paidVerificationResponses: [200],
        },
      ]);
      const request = await page.evaluate(() => window.__subscriptionRequestBodies[0]);
      assert.equal(request.pathname, '/api/subscriptions/orders');
      assert.deepEqual(request.body.senderAccountIdsToKeep, [smtpAccounts[0].id]);
      const analyticsPayload = JSON.stringify(await page.evaluate(() => window.__analyticsCalls));
      for (const account of smtpAccounts) {
        assert.equal(analyticsPayload.includes(account.id), false);
        assert.equal(analyticsPayload.includes(account.fromEmail), false);
        assert.equal(analyticsPayload.includes(account.host), false);
      }
    } finally {
      await context.close();
    }
  });

  it('does not count paid-plan retention when checkout is dismissed', async () => {
    const smtpAccounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'dismiss',
      senderAccounts: smtpAccounts,
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Checkout closed').waitFor();

      assert.deepEqual(
        await page.evaluate(() => window.__analyticsCalls.map(call => call.args[0])),
        ['paid_checkout_started', 'paid_checkout_dismissed'],
      );
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), []);
      assert.equal(
        (await page.evaluate(() => JSON.stringify(window.__analyticsCalls))).includes('smtp_sender_retention_completed'),
        false,
      );
    } finally {
      await context.close();
    }
  });

  it('does not count paid-plan retention when payment verification fails', async () => {
    const smtpAccounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openPlansPage({
      packages: [paidPackage],
      checkoutAction: 'complete',
      verificationStatus: 400,
      senderAccounts: smtpAccounts,
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${paidPackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Payment needs attention').waitFor();

      assert.deepEqual(
        await page.evaluate(() => window.__analyticsCalls.map(call => call.args[0])),
        ['paid_checkout_started', 'paid_payment_verification_failed'],
      );
      assert.deepEqual(await page.evaluate(() => window.__paidVerificationResponses), [400]);
      assert.equal(
        (await page.evaluate(() => JSON.stringify(window.__analyticsCalls))).includes('smtp_sender_retention_completed'),
        false,
      );
    } finally {
      await context.close();
    }
  });

  it('does not count a sender retention choice rejected during free-plan activation', async () => {
    const { context, page } = await openPlansPage({
      activationStatus: 409,
      senderAccounts: [
        makeSenderAccount('smtp-primary', true),
        makeSenderAccount('smtp-secondary'),
      ],
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Free plan activation failed.').waitFor();

      assert.deepEqual(
        await page.evaluate(() => window.__analyticsCalls.map(call => call.args)),
        [['free_subscription_activation_failed', undefined]],
      );
    } finally {
      await context.close();
    }
  });

  it('does not let analytics tracker failures block package activation', async () => {
    const { context, page } = await openPlansPage({
      senderAccounts: [
        makeSenderAccount('smtp-primary', true),
        makeSenderAccount('smtp-secondary'),
      ],
      senderAccountLimit: 3,
      analyticsThrows: true,
    });
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('dialog-sender-retention').waitFor();
      await page.getByTestId('button-confirm-sender-retention').click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__freeActivationResponses), [200]);
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), []);
    } finally {
      await context.close();
    }
  });

  it('tracks successful SMTP sender creation without account details', async () => {
    const { context, page } = await openSendingPage({
      senderAccounts: [makeSenderAccount('existing-sender', true)],
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId('section-sender-accounts').waitFor();
      await page.getByTestId('button-add-sender-account').click();
      await page.getByTestId('input-smtp-host').fill('smtp.created.example.test');
      await page.getByTestId('input-smtp-username').fill('sender@example.test');
      await page.getByTestId('input-smtp-password').fill('test-password');
      await page.getByTestId('input-from-name').fill('Created Sender');
      await page.getByTestId('input-from-email').fill('created@example.test');
      await page.getByTestId('button-save-sending-settings').click();

      await page.getByText('Sender identity saved. SMTP credentials remain encrypted in this workspace.').waitFor();
      await page.getByText('2 of 3 account slots used').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        args: ['smtp_sender_account_created', {
          account_count: 2,
          account_limit: 3,
          outcome: 'success',
        }],
        freeActivationResponses: [],
        paidVerificationResponses: [],
      }]);
      const payload = JSON.stringify(await page.evaluate(() => window.__analyticsCalls));
      assert.equal(payload.includes('new-sender'), false);
      assert.equal(payload.includes('created@example.test'), false);
      assert.equal(payload.includes('smtp.created.example.test'), false);
    } finally {
      await context.close();
    }
  });

  it('does not let analytics tracker failures block successful sender creation', async () => {
    const { context, page } = await openSendingPage({
      senderAccounts: [makeSenderAccount('existing-sender', true)],
      senderAccountLimit: 3,
      analyticsThrows: true,
    });
    try {
      await page.getByTestId('section-sender-accounts').waitFor();
      await page.getByTestId('button-add-sender-account').click();
      await page.getByTestId('input-smtp-host').fill('smtp.created.example.test');
      await page.getByTestId('input-smtp-username').fill('sender@example.test');
      await page.getByTestId('input-smtp-password').fill('test-password');
      await page.getByTestId('input-from-name').fill('Created Sender');
      await page.getByTestId('input-from-email').fill('created@example.test');
      await page.getByTestId('button-save-sending-settings').click();

      await page.getByText('Sender identity saved. SMTP credentials remain encrypted in this workspace.').waitFor();
      await page.getByText('2 of 3 account slots used').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), []);
    } finally {
      await context.close();
    }
  });

  it('does not track sender creation or default changes rejected by the server', async () => {
    const { context, page } = await openSendingPage({
      senderAccounts: [
        makeSenderAccount('smtp-primary', true),
        makeSenderAccount('smtp-secondary'),
      ],
      senderAccountLimit: 3,
      createSenderAccountStatus: 409,
      setPrimarySenderAccountStatus: 409,
    });
    try {
      await page.getByTestId('section-sender-accounts').waitFor();
      await page.getByTestId('button-add-sender-account').click();
      await page.getByTestId('input-smtp-host').fill('smtp.created.example.test');
      await page.getByTestId('input-smtp-username').fill('sender@example.test');
      await page.getByTestId('input-smtp-password').fill('test-password');
      await page.getByTestId('input-from-name').fill('Created Sender');
      await page.getByTestId('input-from-email').fill('created@example.test');
      await page.getByTestId('button-save-sending-settings').click();
      await page.getByText('Sender creation failed.').waitFor();

      await page.getByTestId('button-primary-sender-account-smtp-secondary').click();
      await page.getByText('Default selection failed.').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), []);
    } finally {
      await context.close();
    }
  });

  it('tracks successful default selection and removal without sender identifiers', async () => {
    const accounts = [
      makeSenderAccount('smtp-primary', true),
      makeSenderAccount('smtp-secondary'),
    ];
    const { context, page } = await openSendingPage({
      senderAccounts: accounts,
      senderAccountLimit: 3,
    });
    try {
      await page.getByTestId('section-sender-accounts').waitFor();
      await page.getByTestId('button-primary-sender-account-smtp-secondary').click();
      await page.getByText('smtp-secondary@example.test is now the default campaign sender.').waitFor();
      page.once('dialog', dialog => dialog.accept());
      await page.getByTestId('button-delete-sender-account-smtp-primary').click();
      await page.getByText('SMTP sender account and its saved credentials were removed.').waitFor();

      const calls = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(calls.map(call => call.args), [
        ['smtp_sender_account_default_selected', {
          account_count: 2,
          account_limit: 3,
          outcome: 'success',
        }],
        ['smtp_sender_account_deleted', {
          account_count: 1,
          account_limit: 3,
          outcome: 'success',
        }],
      ]);
      const payload = JSON.stringify(calls);
      for (const account of accounts) {
        assert.equal(payload.includes(account.id), false);
        assert.equal(payload.includes(account.fromEmail), false);
        assert.equal(payload.includes(account.host), false);
      }
    } finally {
      await context.close();
    }
  });

  it('does not track an SMTP removal rejected by the server', async () => {
    const account = makeSenderAccount('smtp-protected', true);
    const { context, page } = await openSendingPage({
      senderAccounts: [account],
      senderAccountLimit: 3,
      deleteSenderAccountStatus: 409,
    });
    try {
      await page.getByTestId('section-sender-accounts').waitFor();
      page.once('dialog', dialog => dialog.accept());
      await page.getByTestId('button-delete-sender-account-smtp-protected').click();
      await page.getByText('Sender removal failed.').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), []);
    } finally {
      await context.close();
    }
  });
});
