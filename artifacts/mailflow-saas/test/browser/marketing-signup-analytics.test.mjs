import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const ctas = [
  { path: '/', testId: 'nav-register', page: 'home', placement: 'header' },
  { path: '/', testId: 'footer-register', page: 'home', placement: 'footer' },
  { path: '/', testId: 'hero-get-started', page: 'home', placement: 'hero' },
  { path: '/', testId: 'intro-create-account', page: 'home', placement: 'intro' },
  { path: '/', testId: 'final-register', page: 'home', placement: 'final_cta' },
  { path: '/features', testId: 'nav-register', page: 'features', placement: 'header' },
  { path: '/features', testId: 'footer-register', page: 'features', placement: 'footer' },
  { path: '/features', testId: 'features-hero-register', page: 'features', placement: 'hero' },
  { path: '/features', testId: 'features-sender-register', page: 'features', placement: 'sender' },
  { path: '/features', testId: 'features-final-register', page: 'features', placement: 'final_cta' },
  { path: '/pricing', testId: 'nav-register', page: 'pricing', placement: 'header' },
  { path: '/pricing', testId: 'footer-register', page: 'pricing', placement: 'footer' },
  { path: '/pricing', testId: 'pricing-bottom-register', page: 'pricing', placement: 'bottom_cta' },
];

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

async function installFixtures(context, {
  registrationStatus = 201,
  verificationStatus = 200,
  packageCheckoutResult = { accountExists: false, registrationProofToken: 'checkout-proof-secret' },
  packages = [],
} = {}) {
  const registrationBodies = [];
  const verificationBodies = [];
  await context.addInitScript(() => {
    window.__analyticsCalls = [];
    window.umami = {
      track(name, data) {
        window.__analyticsCalls.push({ name, data });
      },
    };
  });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/api/auth/me') {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/maintenance/status') {
      await route.fulfill({ status: 200, json: { maintenanceMode: false } });
      return;
    }
    if (pathname === '/api/auth/password-policy') {
      await route.fulfill({ status: 200, json: { passwordMinimumLength: 12 } });
      return;
    }
    if (pathname === '/api/subscriptions/packages' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: { packages, sendingLimits: { emailsPerHourPerSmtp: 100, emailsPerDayPerSmtp: 1000 } },
      });
      return;
    }
    if (pathname === '/api/auth/register' && request.method() === 'POST') {
      registrationBodies.push(request.postDataJSON());
      await route.fulfill({
        status: registrationStatus,
        json: registrationStatus === 201
          ? { message: 'A verification code has been sent to your email address.' }
          : { error: 'An account with this email already exists.' },
      });
      return;
    }
    if (pathname === '/api/auth/package-checkout/request-code' && request.method() === 'POST') {
      await route.fulfill({ status: 200, json: { message: 'A verification code has been sent.' } });
      return;
    }
    if (pathname === '/api/auth/package-checkout/verify-code' && request.method() === 'POST') {
      await route.fulfill({ status: 200, json: packageCheckoutResult });
      return;
    }
    if (pathname === '/api/auth/verify-email' && request.method() === 'POST') {
      verificationBodies.push(request.postDataJSON());
      await route.fulfill({
        status: verificationStatus,
        json: verificationStatus === 200
          ? {
            user: {
              id: 'user-1',
              username: 'samplevisitor',
              firstName: 'Sample',
              lastName: 'Visitor',
              email: 'signup-test@example.test',
              role: 'USER',
              timezone: 'UTC',
              active: true,
              emailVerified: true,
              mustChangeCredentials: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }
          : { error: 'The verification code is incorrect.' },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${pathname}` } });
  });
  return { registrationBodies, verificationBodies };
}

describe('marketing signup analytics', { concurrency: false }, () => {
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

  it('tracks public signup CTAs with only fixed page and placement values', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context);
      const page = await context.newPage();
      for (const cta of ctas) {
        await page.goto(`${baseUrl}${cta.path}`);
        await page.getByTestId(cta.testId).click();
        await page.waitForURL(url => url.pathname === '/register');
        const expected = [{
          name: 'marketing_signup_cta_clicked',
          data: { page: cta.page, placement: cta.placement },
        }];
        assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), expected, `${cta.path} ${cta.testId}`);
      }
    } finally {
      await context.close();
    }
  });

  it('tracks pricing plan actions and attributes a later registration without sending package or form data', async () => {
    const pkg = {
      id: '9cf2f2ae-61bb-4523-a582-dcb843f48a30',
      packageType: 'primary',
      name: 'Growth plan',
      description: 'A paid package used to verify pricing attribution.',
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context, { packages: [pkg] });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${pkg.id}`).click();
      await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
      const clickAnalytics = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(clickAnalytics, [
        { name: 'marketing_signup_cta_clicked', data: { page: 'pricing', placement: 'plan' } },
        { name: 'package_checkout_selected', data: { package_type: 'primary' } },
      ]);
      await page.goto(`${baseUrl}/register`);
      await page.getByTestId('input-first-name').fill('Sample');
      await page.getByTestId('input-last-name').fill('Visitor');
      await page.getByTestId('input-register-email').fill('signup-test@example.test');
      await page.getByTestId('input-register-password').fill('registration-test-password');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/verify-email');

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        { name: 'registration_succeeded', data: { page: 'pricing', placement: 'plan' } },
      ]);
      const analyticsPayload = JSON.stringify([
        ...clickAnalytics,
        ...await page.evaluate(() => window.__analyticsCalls),
      ]);
      for (const privateValue of [pkg.id, pkg.name, 'Sample', 'Visitor', 'signup-test@example.test', 'registration-test-password']) {
        assert.equal(analyticsPayload.includes(privateValue), false, `Analytics must not include ${privateValue}`);
      }
    } finally {
      await context.close();
    }
  });

  it('tracks verified package checkout through the new-account branch and successful registration without private values', async () => {
    const pkg = {
      id: '9cf2f2ae-61bb-4523-a582-dcb843f48a30',
      packageType: 'primary',
      name: 'Growth plan',
      description: 'A paid package used to verify checkout funnel analytics.',
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const { registrationBodies } = await installFixtures(context, { packages: [pkg] });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/pricing`);
      await page.getByTestId(`package-cta-${pkg.id}`).click();
      await page.waitForURL(url => url.pathname.startsWith('/package-checkout/'));
      await page.getByTestId('input-package-checkout-email').fill('checkout-customer@example.test');
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      await page.getByTestId('input-package-checkout-code').fill('123456');
      await page.getByTestId('button-package-checkout-continue').click();
      await page.waitForURL(url => url.pathname === '/register');

      await page.getByTestId('input-first-name').fill('Checkout');
      await page.getByTestId('input-last-name').fill('Customer');
      await page.getByTestId('input-register-password').fill('checkout-test-password');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/plans');

      const events = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(events, [
        { name: 'marketing_signup_cta_clicked', data: { page: 'pricing', placement: 'plan' } },
        { name: 'package_checkout_selected', data: { package_type: 'primary' } },
        { name: 'package_checkout_email_verified', data: { package_type: 'primary' } },
        { name: 'package_checkout_account_branch', data: { package_type: 'primary', branch: 'new_account' } },
        { name: 'package_checkout_registration_completed', data: { package_type: 'primary', outcome: 'success' } },
        { name: 'registration_succeeded', data: { page: 'pricing', placement: 'plan' } },
      ]);
      const analyticsPayload = JSON.stringify(events);
      for (const privateValue of [
        pkg.id,
        pkg.name,
        'checkout-customer@example.test',
        '123456',
        'checkout-test-password',
        'checkout-proof-secret',
        'Checkout',
        'Customer',
      ]) {
        assert.equal(analyticsPayload.includes(privateValue), false, `Analytics must not include ${privateValue}`);
      }
      assert.equal(registrationBodies.length, 1);
    } finally {
      await context.close();
    }
  });

  it('tracks the existing-account branch only after package email verification succeeds', async () => {
    const pkg = {
      id: '9cf2f2ae-61bb-4523-a582-dcb843f48a30',
      packageType: 'primary',
      name: 'Growth plan',
      description: 'A paid package used to verify checkout funnel analytics.',
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context, {
        packages: [pkg],
        packageCheckoutResult: { accountExists: true },
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/package-checkout?packageId=${encodeURIComponent(pkg.id)}`);
      await page.getByTestId('input-package-checkout-email').fill('existing-customer@example.test');
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-code').waitFor();
      await page.getByTestId('input-package-checkout-code').fill('123456');
      await page.getByTestId('button-package-checkout-continue').click();
      await page.getByTestId('input-package-checkout-password').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        { name: 'package_checkout_email_verified', data: { package_type: 'primary' } },
        { name: 'package_checkout_account_branch', data: { package_type: 'primary', branch: 'existing_account' } },
      ]);
      const analyticsPayload = JSON.stringify(await page.evaluate(() => window.__analyticsCalls));
      for (const privateValue of [pkg.id, pkg.name, 'existing-customer@example.test', '123456']) {
        assert.equal(analyticsPayload.includes(privateValue), false, `Analytics must not include ${privateValue}`);
      }
    } finally {
      await context.close();
    }
  });

  it('attaches CTA attribution to registration and verified signup without sending form values to analytics', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const { registrationBodies, verificationBodies } = await installFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`);
      await page.getByTestId('hero-get-started').click();
      await page.getByTestId('input-first-name').fill('Sample');
      await page.getByTestId('input-last-name').fill('Visitor');
      await page.getByTestId('input-register-email').fill('signup-test@example.test');
      await page.getByTestId('input-register-password').fill('registration-test-password');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/verify-email');

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        { name: 'marketing_signup_cta_clicked', data: { page: 'home', placement: 'hero' } },
        { name: 'registration_succeeded', data: { page: 'home', placement: 'hero' } },
      ]);
      await page.getByTestId('input-verification-code').fill('123456');
      await page.getByTestId('button-verify-email').click();
      await page.waitForURL(url => url.pathname === '/dashboard');

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        { name: 'marketing_signup_cta_clicked', data: { page: 'home', placement: 'hero' } },
        { name: 'registration_succeeded', data: { page: 'home', placement: 'hero' } },
        { name: 'verified_signup_succeeded', data: { page: 'home', placement: 'hero' } },
      ]);
      const analyticsPayload = JSON.stringify(await page.evaluate(() => window.__analyticsCalls));
      for (const privateValue of ['Sample', 'Visitor', 'signup-test@example.test', 'registration-test-password', '123456']) {
        assert.equal(analyticsPayload.includes(privateValue), false, `Analytics must not include ${privateValue}`);
      }
      assert.equal(registrationBodies.length, 1);
      assert.equal(registrationBodies[0].email, 'signup-test@example.test');
      assert.deepEqual(verificationBodies, [{ email: 'signup-test@example.test', code: '123456' }]);
    } finally {
      await context.close();
    }
  });

  it('does not count a rejected registration as successful', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context, { registrationStatus: 409 });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/features`);
      await page.getByTestId('features-sender-register').click();
      await page.getByTestId('input-first-name').fill('Sample');
      await page.getByTestId('input-last-name').fill('Visitor');
      await page.getByTestId('input-register-email').fill('signup-test@example.test');
      await page.getByTestId('input-register-password').fill('registration-test-password');
      await page.getByTestId('button-create-account').click();
      await page.getByTestId('status-form-error').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [{
        name: 'marketing_signup_cta_clicked',
        data: { page: 'features', placement: 'sender' },
      }]);
    } finally {
      await context.close();
    }
  });

  it('does not count a failed email verification as a verified signup', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context, { verificationStatus: 400 });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/features`);
      await page.getByTestId('features-sender-register').click();
      await page.getByTestId('input-first-name').fill('Sample');
      await page.getByTestId('input-last-name').fill('Visitor');
      await page.getByTestId('input-register-email').fill('signup-test@example.test');
      await page.getByTestId('input-register-password').fill('registration-test-password');
      await page.getByTestId('button-create-account').click();
      await page.waitForURL(url => url.pathname === '/verify-email');
      await page.getByTestId('input-verification-code').fill('000000');
      await page.getByTestId('button-verify-email').click();
      await page.getByTestId('status-form-error').waitFor();

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), [
        { name: 'marketing_signup_cta_clicked', data: { page: 'features', placement: 'sender' } },
        { name: 'registration_succeeded', data: { page: 'features', placement: 'sender' } },
      ]);
    } finally {
      await context.close();
    }
  });

  it('does not classify a successful verification as a signup without a pending registration', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await installFixtures(context);
      await context.addInitScript(() => {
        window.sessionStorage.setItem('mailflow-verification-email', 'email-change@example.test');
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/verify-email`);
      await page.getByTestId('input-verification-code').fill('123456');
      await page.getByTestId('button-verify-email').click();
      await page.waitForURL(url => url.pathname === '/dashboard');

      assert.deepEqual(await page.evaluate(() => window.__analyticsCalls), []);
    } finally {
      await context.close();
    }
  });
});
