import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const user = {
  id: 'ca44d7cc-092e-4af2-b05d-2b47b5602b20',
  username: 'idle-test',
  firstName: 'Idle',
  lastName: 'Test',
  email: 'idle-test@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let serverProcess;
let browser;
let baseUrl;

async function findPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer() {
  const port = await findPort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn('pnpm', ['run', 'dev'], {
    cwd: appDirectory,
    detached: true,
    env: { ...process.env, BASE_PATH: '/', NODE_ENV: 'development', PORT: String(port) },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Wait for Vite to start.
    }
    await delay(250);
  }
  throw new Error('Vite did not start within 45 seconds.');
}

async function stopServer() {
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
    try { process.kill(-serverProcess.pid, 'SIGKILL'); } catch {}
  }
}

describe('20-minute inactivity logout', () => {
  before(async () => {
    await startServer();
    browser = await chromium.launch({ headless: true, executablePath: '/repl/tools/bin/chromium' });
  });

  after(async () => {
    await browser?.close();
    await stopServer();
  });

  it('revokes the session and returns to login after 20 minutes without user input', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.clock.install({ time: new Date('2026-10-14T10:00:00.000Z') });
    let logoutRequests = 0;
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/me') {
        await route.fulfill({ status: 200, json: user });
      } else if (pathname === '/api/notifications') {
        await route.fulfill({ status: 200, json: { unread: [] } });
      } else if (pathname === '/api/dashboard') {
        await route.fulfill({
          status: 200,
          json: {
            subscriptionStatus: 'inactive',
            contacts: 0,
            companies: 0,
            activeLists: 0,
            amountSpentByCurrency: [],
            lifecycleStages: [],
            leadStatuses: [],
            campaignCount: 0,
            campaigns: [],
            setupChecklist: { profile: true, emailSetup: true, contact: true, list: true, campaignQueued: true },
            setupStepsCompleted: 5,
            setupStepsTotal: 5,
          },
        });
      } else if (pathname === '/api/auth/logout' && route.request().method() === 'POST') {
        logoutRequests += 1;
        await route.fulfill({ status: 204, body: '' });
      } else {
        await route.fulfill({ status: 200, json: {} });
      }
    });

    await page.goto(`${baseUrl}/dashboard`);
    try {
      await page.getByTestId('button-header-logout').waitFor({ timeout: 10_000 });
    } catch {
      throw new Error(`Authenticated shell did not render at ${page.url()}. Errors: ${pageErrors.join(' | ')}. Body: ${(await page.locator('body').innerText()).slice(0, 500)}`);
    }
    await page.clock.fastForward(20 * 60 * 1000);
    await page.waitForURL('**/login');
    assert.equal(logoutRequests, 1, 'the client should revoke the server session once');
    await context.close();
  });
});
