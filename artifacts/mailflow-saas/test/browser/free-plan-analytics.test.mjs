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

async function installFixtures(context, activationStatus) {
  await context.addCookies([{
    name: 'mailflow_session',
    value: 'free-plan-browser-test',
    url: baseUrl,
    sameSite: 'Lax',
  }]);
  await context.addInitScript(() => {
    window.__analyticsCalls = [];
    window.__freeActivationResponses = [];
    window.umami = {
      track(...args) {
        window.__analyticsCalls.push({
          args,
          freeActivationResponses: [...window.__freeActivationResponses],
        });
      },
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, window.location.href).pathname === '/api/subscriptions/free') {
        window.__freeActivationResponses.push(response.status);
      }
      return response;
    };
  });
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
      await route.fulfill({ status: 200, json: { packages: [freePackage] } });
      return;
    }
    if (pathname === '/api/subscriptions/current') {
      await route.fulfill({ status: 200, json: { subscription: null } });
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

async function openPlansPage(activationStatus) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installFixtures(context, activationStatus);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/plans`);
  await page.getByTestId(`button-purchase-plan-${freePackage.id}`).waitFor({ state: 'visible' });
  return { context, page };
}

describe('free plan activation analytics', { concurrency: false }, () => {
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
    const { context, page } = await openPlansPage(200);
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Subscription active').waitFor();

      const trackingCalls = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(trackingCalls, [{
        args: ['free_subscription_activated', undefined],
        freeActivationResponses: [200],
      }]);
    } finally {
      await context.close();
    }
  });

  it('does not track when free plan activation fails', async () => {
    const { context, page } = await openPlansPage(403);
    try {
      await page.getByTestId(`button-purchase-plan-${freePackage.id}`).click();
      await page.getByTestId('status-payment').getByText('Free plan activation failed.').waitFor();

      const trackingCalls = await page.evaluate(() => window.__analyticsCalls);
      assert.deepEqual(trackingCalls, []);
      assert.deepEqual(
        await page.evaluate(() => window.__freeActivationResponses),
        [403],
      );
    } finally {
      await context.close();
    }
  });
});
