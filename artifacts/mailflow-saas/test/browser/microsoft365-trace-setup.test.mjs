import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sessionCookie = 'microsoft365-trace-browser-test';
const secretValue = 'browser-test-secret-value';
const tenantId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: 'microsoft365-trace-browser-user-id',
  username: 'trace-browser-user',
  firstName: 'Trace',
  lastName: 'Admin',
  email: 'trace-admin@example.test',
  role: 'USER',
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

async function openEmailSetupPage(gmailConnection = {
  configured: false,
  redirectUri: null,
  connected: false,
  emailAddress: null,
  syncStatus: 'disconnected',
  lastSyncAt: null,
  lastSuccessAt: null,
  lastSyncDiagnostics: null,
  nextSyncAt: null,
  lastError: null,
  pollIntervalSeconds: 120,
}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{
    name: 'mailflow_session',
    value: sessionCookie,
    url: baseUrl,
    sameSite: 'Lax',
  }]);
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!(request.headers().cookie ?? '').includes(`mailflow_session=${sessionCookie}`)) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
    } else if (pathname === '/api/auth/me' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: user });
    } else if (pathname === '/api/sending/accounts' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: { accounts: [], emailAccountLimit: 1, configuredCount: 0, overLimit: false, scheduledDowngrade: null },
      });
    } else if (pathname === '/api/sending/gmail/connection' && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: gmailConnection });
    } else if (pathname === '/api/sending/microsoft-365/connection' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          configured: false,
          connected: false,
          tenantId: null,
          syncStatus: 'disconnected',
          source: 'microsoft_365_graph',
          evidenceVerification: 'microsoft365_authorized',
          permission: 'ExchangeMessageTrace.Read.All',
          tenantAdminConsentRequired: true,
          exchangeTraceServicePrincipalAppId: '8bd644d1-64a1-4d4b-ae52-2e0cbf64e373',
          backfillStartAt: null,
          backfillEndAt: null,
          backfillCompletedAt: null,
          lastSyncAt: null,
          lastSuccessAt: null,
          nextSyncAt: null,
          lastError: null,
          pollIntervalSeconds: 300,
          maxHistoryDays: 90,
          maxQueryWindowDays: 10,
          maxPageSize: 5000,
          requestsPerFiveMinutes: 100,
        },
      });
    } else if (pathname === '/api/sending/microsoft-365/connect' && request.method() === 'POST') {
      await route.fulfill({
        status: 403,
        json: {
          error: 'Microsoft did not authorize Exchange message-trace access. Check tenant admin consent and service-principal setup.',
          code: 'MICROSOFT_365_TRACE_NOT_AUTHORIZED',
        },
      });
    } else {
      await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${request.method()} ${pathname}` } });
    }
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sending-settings`);
  await page.getByTestId('tab-microsoft365-trace').click();
  await page.getByTestId('section-microsoft365-trace').waitFor();
  return { context, page };
}

describe('Microsoft 365 trace setup', { concurrency: false }, () => {
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

  it('guides admins and blocks malformed IDs or missing consent', async () => {
    const { context, page } = await openEmailSetupPage();
    try {
      await page.getByTestId('link-microsoft365-entra-apps').waitFor();
      await page.getByTestId('link-microsoft365-graph-setup').waitFor();
      await page.getByTestId('link-microsoft365-secret-help').waitFor();
      await page.getByTestId('link-microsoft365-trace-service-principal').waitFor();
      await page.getByTestId('link-microsoft365-graph-powershell').waitFor();
      await page.getByTestId('notice-microsoft365-trace-limits').getByText('What trace evidence means:').waitFor();

      await page.getByTestId('input-microsoft365-tenant-id').fill('not-a-tenant-id');
      await page.getByTestId('input-microsoft365-client-id').fill(clientId);
      await page.getByTestId('input-microsoft365-client-secret').fill(secretValue);
      const connectButton = page.getByTestId('button-connect-microsoft365');
      assert.equal(await connectButton.isDisabled(), true);
      await page.getByTestId('error-microsoft365-tenant-id').waitFor();

      await page.getByTestId('input-microsoft365-tenant-id').fill(tenantId);
      await page.getByTestId('input-microsoft365-client-id').fill('not-an-app-id');
      assert.equal(await connectButton.isDisabled(), true);
      await page.getByTestId('error-microsoft365-client-id').waitFor();

      await page.getByTestId('input-microsoft365-client-id').fill(clientId);
      assert.equal(await connectButton.isDisabled(), true, 'admin confirmation is required before connecting');
      await page.getByTestId('checkbox-microsoft365-admin-consent').check();
      assert.equal(await connectButton.isEnabled(), true);
    } finally {
      await context.close();
    }
  });

  it('prefills common SMTP settings when a sender provider is selected', async () => {
    const { context, page } = await openEmailSetupPage();
    try {
      await page.getByTestId('tab-email-setup').click();
      const provider = page.getByTestId('select-sender-provider');
      const host = page.getByTestId('input-smtp-host');
      const port = page.getByTestId('input-smtp-port');
      const encryption = page.getByTestId('select-smtp-encryption');

      await provider.selectOption('microsoft_365');
      assert.deepEqual(
        [await host.inputValue(), await port.inputValue(), await encryption.inputValue()],
        ['smtp.office365.com', '587', 'tls'],
      );

      await provider.selectOption('google_workspace');
      assert.deepEqual(
        [await host.inputValue(), await port.inputValue(), await encryption.inputValue()],
        ['smtp.gmail.com', '587', 'tls'],
      );

      await provider.selectOption('gmail');
      assert.equal(await host.inputValue(), 'smtp.gmail.com');

      await provider.selectOption('other');
      assert.equal(await host.inputValue(), '');
    } finally {
      await context.close();
    }
  });

  it('clears the masked secret after a rejected attempt and gives safe, actionable guidance', async () => {
    const { context, page } = await openEmailSetupPage();
    try {
      await page.getByTestId('input-microsoft365-tenant-id').fill(tenantId);
      await page.getByTestId('input-microsoft365-client-id').fill(clientId);
      const secretField = page.getByTestId('input-microsoft365-client-secret');
      await secretField.fill(secretValue);
      await page.getByTestId('checkbox-microsoft365-admin-consent').check();

      const connectRequest = page.waitForRequest(request =>
        request.url().endsWith('/api/sending/microsoft-365/connect') && request.method() === 'POST',
      );
      await page.getByTestId('button-connect-microsoft365').click();
      const request = await connectRequest;
      assert.equal(request.postDataJSON().clientSecret, secretValue);
      assert.equal(await secretField.getAttribute('type'), 'password');
      await page.getByTestId('error-microsoft365-connect').waitFor();
      assert.equal(await secretField.inputValue(), '');
      const errorText = await page.getByTestId('error-microsoft365-connect').innerText();
      assert.match(errorText, /Microsoft signed in, but did not allow trace access/);
      assert.match(errorText, /Application permission and tenant admin consent/);
      assert.match(errorText, /trace service principal exists/);
      assert.equal(errorText.includes(secretValue), false);
    } finally {
      await context.close();
    }
  });

  it('shows aggregate Gmail sync counts and safe matching guidance', async () => {
    const { context, page } = await openEmailSetupPage({
      configured: true,
      redirectUri: null,
      connected: true,
      emailAddress: 'bounce-monitor@example.test',
      syncStatus: 'connected',
      lastSyncAt: '2026-10-08T12:00:00.000Z',
      lastSuccessAt: '2026-10-08T12:00:00.000Z',
      lastSyncDiagnostics: {
        messagesChecked: 4,
        dsnCandidates: 2,
        importedReports: 1,
        unmatchedReports: 1,
        warnings: 0,
        outcome: 'unmatched_reports',
      },
      nextSyncAt: '2026-10-08T12:02:00.000Z',
      lastError: null,
      pollIntervalSeconds: 120,
    });
    try {
      await page.getByTestId('tab-gmail-monitoring').click();
      const diagnostics = page.getByTestId('panel-gmail-sync-diagnostics');
      await diagnostics.waitFor();
      assert.match(
        await page.getByTestId('text-gmail-sync-diagnostic-outcome').innerText(),
        /could not be matched to a campaign/i,
      );
      assert.match(await diagnostics.innerText(), /Messages checked\s+4/i);
      assert.match(await diagnostics.innerText(), /DSN candidates\s+2/i);
      assert.match(await diagnostics.innerText(), /Imported reports\s+1/i);
      assert.match(await diagnostics.innerText(), /Unmatched reports\s+1/i);
      assert.match(await diagnostics.innerText(), /Warnings\s+0/i);
      const detail = await diagnostics.innerText();
      assert.match(detail, /connected mailbox receives the campaign/i);
      assert.equal(detail.includes('bounce-monitor@example.test'), false);
      assert.equal(detail.includes('private message body'), false);
      assert.equal(detail.includes('Bearer '), false);
    } finally {
      await context.close();
    }
  });
});
