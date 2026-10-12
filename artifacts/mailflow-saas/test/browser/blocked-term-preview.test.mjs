import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sessionCookie = 'blocked-term-preview-browser-session';
const admin = {
  id: 'blocked-term-preview-admin',
  username: 'blocked-term-preview-admin',
  firstName: 'Policy',
  lastName: 'Admin',
  email: 'policy-admin@example.test',
  role: 'SUPERADMIN',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let serverProcess;
let serverOutput = '';
let browser;
let baseUrl;
let previewRequests;
let settingsSaveRequests;

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
      // Vite is still starting.
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

describe('blocked-term field preview', { concurrency: false }, () => {
  before(async () => {
    previewRequests = [];
    settingsSaveRequests = [];
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

  it('shows independent field results without saving platform settings', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{
      name: 'mailflow_session',
      value: sessionCookie,
      url: baseUrl,
      sameSite: 'Lax',
    }]);
    await context.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const method = request.method();
      if (!(request.headers().cookie ?? '').includes(`mailflow_session=${sessionCookie}`)) {
        await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      } else if (pathname === '/api/auth/me' && method === 'GET') {
        await route.fulfill({ status: 200, json: admin });
      } else if (pathname === '/api/maintenance/status' && method === 'GET') {
        await route.fulfill({ status: 200, json: { maintenanceMode: false } });
      } else if (pathname === '/api/admin/settings' && method === 'GET') {
        await route.fulfill({
          status: 200,
          json: { prohibitedEmailKeywords: ['badword'], settingsVersion: 'preview-test-version', updatedAt: null },
        });
      } else if (pathname === '/api/admin/settings/email' && method === 'GET') {
        await route.fulfill({
          status: 200,
          json: {
            provider: 'other',
            host: null,
            port: null,
            encryption: null,
            username: null,
            passwordConfigured: false,
            fromName: null,
            fromEmail: null,
            replyTo: null,
            updatedAt: null,
          },
        });
      } else if (pathname === '/api/notifications' && method === 'GET') {
        await route.fulfill({ status: 200, json: { items: [], unread: [] } });
      } else if (pathname === '/api/admin/settings/blocked-terms/preview' && method === 'POST') {
        const input = request.postDataJSON();
        previewRequests.push(input);
        const results = Object.fromEntries(Object.entries(input.sampleFields).map(([field, sampleText]) => {
          const matchedKeywords = input.prohibitedEmailKeywords.filter(term =>
            sampleText.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
          );
          return [field, {
            matchedKeywords,
            matchRanges: matchedKeywords.map(keyword => {
              const start = sampleText.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());
              return { start, end: start + keyword.length, keywords: [keyword] };
            }),
          }];
        }));
        await route.fulfill({ status: 200, json: results });
      } else if (pathname === '/api/admin/settings' && method === 'PUT') {
        settingsSaveRequests.push(request.postDataJSON());
        await route.fulfill({ status: 200, json: { message: 'Saved.' } });
      } else {
        await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${pathname}` } });
      }
    });

    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/admin/settings`);
      const samples = {
        subject: 'A safe subject',
        greeting: 'badword greeting',
        body: 'Safe campaign copy',
        htmlBody: '<p>badword</p>',
        signature: 'A safe signature',
      };
      for (const [field, sample] of Object.entries(samples)) {
        await page.getByTestId(`input-blocked-term-preview-${field}`).fill(sample);
      }
      await page.getByTestId('button-preview-blocked-terms').click();
      await page.getByTestId('result-blocked-term-preview').waitFor();

      assert.deepEqual(previewRequests, [{
        sampleFields: samples,
        prohibitedEmailKeywords: ['badword'],
      }]);
      assert.match(await page.getByTestId('result-blocked-term-preview-subject').innerText(), /No blocked terms matched/);
      assert.match(await page.getByTestId('result-blocked-term-preview-greeting').innerText(), /Blocked by: badword/);
      assert.match(await page.getByTestId('result-blocked-term-preview-htmlBody').innerText(), /Blocked by: badword/);
      assert.match(await page.getByTestId('result-blocked-term-preview-body').innerText(), /No blocked terms matched/);
      assert.match(await page.getByTestId('result-blocked-term-preview-signature').innerText(), /No blocked terms matched/);
      assert.equal(await page.getByTestId('preview-blocked-term-sample-htmlBody').locator('mark').count(), 1);
      assert.equal(settingsSaveRequests.length, 0);
    } finally {
      await context.close();
    }
  });
});
