import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const customer = {
  id: 'd0ac10e7-d9a3-435a-bc2f-b936bc2858d4',
  username: 'support-link-customer',
  firstName: 'Casey',
  lastName: 'Customer',
  email: 'support-link-customer@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const sessionToken = 'support-link-browser-session';
const ownedTicket = {
  id: '2763cfe2-17b5-44bb-b8a9-262f31f83b14',
  subject: 'My account invoice question',
  status: 'open',
  createdAt: '2026-09-25T12:00:00.000Z',
  lastMessageAt: '2026-09-26T12:00:00.000Z',
};
const targetTicket = {
  id: '6fddbd37-4d01-42d7-a775-3f9b9b8d6c5c',
  subject: 'Ticket link should open this reply',
  status: 'waiting_on_customer',
  createdAt: '2026-09-27T12:00:00.000Z',
  lastMessageAt: '2026-09-28T12:00:00.000Z',
};
const inaccessibleTicketId = '91c765bc-d55d-4880-95a2-82280e8db4b9';
const foreignConversationSubject = 'Another customer confidential subject';
const foreignConversationMessage = 'Private response that must never be displayed';
const ticketList = { items: [ownedTicket, targetTicket] };

const ticketDetail = ticket => ({
  ticket,
  messages: [{
    id: `message-${ticket.id}`,
    ticketId: ticket.id,
    authorRole: 'SUPERADMIN',
    authorName: 'Mailflow Support',
    message: `Reply for ${ticket.subject}`,
    createdAt: ticket.lastMessageAt,
  }],
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
    if (serverProcess.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverOutput}`);
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

async function installApiFixtures(context, { mustChangeCredentials = false } = {}) {
  let user = { ...customer, mustChangeCredentials };
  const detailRequests = [];
  const passwordChangeRequests = [];

  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const cookie = request.headers().cookie ?? '';
    const authenticated = cookie.includes(`mailflow_session=${sessionToken}`);

    if (pathname === '/api/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON();
      if (credentials.identifier !== customer.username || credentials.password !== 'browser-test-password') {
        await route.fulfill({ status: 401, json: { error: 'Invalid credentials.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'set-cookie': `mailflow_session=${sessionToken}; Path=/; SameSite=Lax` },
        json: { user },
      });
      return;
    }

    if (!authenticated) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }

    if (pathname === '/api/auth/change-password' && method === 'POST') {
      passwordChangeRequests.push(request.postDataJSON());
      user = { ...user, mustChangeCredentials: false };
      await route.fulfill({ status: 200, json: { message: 'Password changed successfully.' } });
      return;
    }

    if (pathname === '/api/support/tickets' && method === 'GET') {
      await route.fulfill({ status: 200, json: ticketList });
      return;
    }

    const ticketMatch = pathname.match(/^\/api\/support\/tickets\/([^/]+)$/);
    if (ticketMatch && method === 'GET') {
      const ticketId = ticketMatch[1];
      detailRequests.push(ticketId);
      if (ticketId === targetTicket.id) {
        await route.fulfill({ status: 200, json: ticketDetail(targetTicket) });
        return;
      }
      if (ticketId === ownedTicket.id) {
        await route.fulfill({ status: 200, json: ticketDetail(ownedTicket) });
        return;
      }
      if (ticketId === inaccessibleTicketId) {
        await route.fulfill({
          status: 404,
          json: { error: 'Support ticket not found.', code: 'SUPPORT_TICKET_NOT_FOUND' },
        });
        return;
      }
      await route.fulfill({
        status: 400,
        json: { error: 'Invalid support ticket identifier.', code: 'INVALID_INPUT' },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${method} ${pathname}` },
    });
  });

  return { detailRequests, passwordChangeRequests };
}

async function signInThroughTicketLink({ ticketId, mustChangeCredentials = false }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const fixtures = await installApiFixtures(context, { mustChangeCredentials });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/support?ticketId=${encodeURIComponent(ticketId)}`);
  await page.getByTestId('input-identifier').waitFor({ state: 'visible' });
  await page.getByTestId('input-identifier').fill(customer.username);
  await page.getByTestId('input-password').fill('browser-test-password');
  await page.getByTestId('button-sign-in').click();
  return { context, page, ...fixtures };
}

describe('customer support ticket links after sign-in', { concurrency: false }, () => {
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

  it('returns a signed-in customer to the ticket linked from their email', async () => {
    const { context, page, detailRequests } = await signInThroughTicketLink({ ticketId: targetTicket.id });
    try {
      await page.waitForURL(url => url.pathname === '/support' && url.searchParams.get('ticketId') === targetTicket.id);
      await page.getByTestId('text-selected-ticket-subject').getByText(targetTicket.subject).waitFor();
      await page.getByText(`Reply for ${targetTicket.subject}`, { exact: true }).waitFor();

      assert.ok(detailRequests.includes(targetTicket.id), 'the linked ticket detail should be requested');
      assert.equal(new URL(page.url()).searchParams.get('ticketId'), targetTicket.id);
    } finally {
      await context.close();
    }
  });

  it('returns to the linked ticket after a required password change', async () => {
    const { context, page, detailRequests, passwordChangeRequests } = await signInThroughTicketLink({
      ticketId: targetTicket.id,
      mustChangeCredentials: true,
    });
    try {
      await page.waitForURL(url => url.pathname === '/profile' && url.searchParams.get('rotate') === '1');
      await page.getByRole('heading', { name: 'Secure your account' }).waitFor();
      await page.getByTestId('input-current-password').fill('browser-test-password');
      await page.getByTestId('input-change-new-password').fill('browser-test-password-updated');
      await page.getByTestId('button-change-password').click();

      await page.waitForURL(url => url.pathname === '/support' && url.searchParams.get('ticketId') === targetTicket.id);
      await page.getByTestId('text-selected-ticket-subject').getByText(targetTicket.subject).waitFor();
      await page.getByText(`Reply for ${targetTicket.subject}`, { exact: true }).waitFor();

      assert.deepEqual(passwordChangeRequests, [{
        currentPassword: 'browser-test-password',
        newPassword: 'browser-test-password-updated',
      }]);
      assert.ok(detailRequests.includes(targetTicket.id), 'the linked ticket detail should be requested after rotation');
    } finally {
      await context.close();
    }
  });

  for (const { label, ticketId } of [
    { label: 'invalid', ticketId: 'not-a-valid-ticket-id' },
    { label: 'inaccessible', ticketId: inaccessibleTicketId },
  ]) {
    it(`does not reveal another conversation for an ${label} ticket link`, async () => {
      const { context, page, detailRequests } = await signInThroughTicketLink({ ticketId });
      try {
        await page.waitForURL(url => url.pathname === '/support' && url.searchParams.get('ticketId') === ticketId);
        await page.getByTestId('status-support-error').waitFor();
        await page.getByTestId('text-selected-ticket-subject').waitFor({ state: 'detached' });

        const pageText = await page.locator('body').innerText();
        assert.ok(detailRequests.includes(ticketId), `the ${label} linked ticket should be checked directly`);
        assert.ok(!pageText.includes(foreignConversationSubject));
        assert.ok(!pageText.includes(foreignConversationMessage));
        assert.ok(!pageText.includes(`Reply for ${ownedTicket.subject}`), 'the UI must not fall back to a different ticket');
      } finally {
        await context.close();
      }
    });
  }
});
