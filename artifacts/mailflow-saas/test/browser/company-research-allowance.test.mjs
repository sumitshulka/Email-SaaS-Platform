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
  id: 'browser-research-allowance-user-id',
  username: 'research-allowance-customer',
  firstName: 'Research',
  lastName: 'Customer',
  email: 'research-allowance@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const companyId = 'browser-research-workspace-company';
const globalCompanyId = 'browser-research-global-company';
const resetAt = '2030-05-17T12:00:00.000Z';
const company = {
  id: companyId,
  globalCompanyId,
  companyName: 'Northstar Research',
  companyWebsiteUrl: 'https://northstar.example',
  companyDomain: 'northstar.example',
  companyIndustry: 'Research',
  companySize: null,
  companyRevenueRange: null,
  companyDescription: null,
  companyPhoneNumber: null,
  companyLinkedinUrl: null,
  companyLocation: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const zeroAllowancePackage = {
  id: 'browser-research-no-runs-package',
  name: 'Mailflow Starter',
  description: 'A package without company research.',
  amountMinor: 0,
  currency: 'USD',
  periodDays: 30,
  contactLimit: 100,
  emailAccountLimit: 1,
  researchAllowance: 0,
  preferred: false,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let serverProcess;
let serverOutput = '';
let browser;
let baseUrl;

function intelligence({
  allowance = null,
  available = false,
  reason = 'ai_package_required',
} = {}) {
  return {
    companyId: globalCompanyId,
    companyName: 'Northstar Research',
    summary: {
      status: 'not_researched',
      freshness: 'not_researched',
      researchedAt: null,
      sourceCount: 0,
    },
    current: null,
    latestJob: null,
    history: [],
    researchCreditCost: 0,
    maxResearchDepth: 1,
    deepResearchEnabled: false,
    researchAvailable: available,
    researchAvailabilityReason: reason,
    researchAllowance: allowance,
  };
}

function allowance(limit, used, remaining, resetsAt = resetAt) {
  return { limit, used, remaining, resetsAt };
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
  intelligenceResponses = [intelligence()],
  researchStartStatus = 403,
  subscription,
  currentAllowance = null,
  packages = [zeroAllowancePackage],
  contactQuota,
  configuredSenderCount = 0,
} = {}) {
  const intelligenceReads = [];
  const researchStarts = [];
  let intelligenceResponseIndex = 0;
  await context.addCookies([{
    name: 'mailflow_session',
    value: 'research-allowance-browser-session',
    url: baseUrl,
    sameSite: 'Lax',
  }]);
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/maintenance/status' && method === 'GET') {
      await route.fulfill({ status: 200, json: { maintenanceMode: false } });
      return;
    }
    if (pathname === `/api/companies/${companyId}` && method === 'GET') {
      await route.fulfill({ status: 200, json: { company, contacts: [] } });
      return;
    }
    if (pathname === '/api/contacts/options' && method === 'GET') {
      await route.fulfill({ status: 200, json: { contacts: [], total: 0, limit: 30 } });
      return;
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      const contactLimit = contactQuota?.limit ?? subscription?.package?.contactLimit ?? 0;
      const contactUsed = contactQuota?.used ?? 0;
      await route.fulfill({
        status: 200,
        json: {
          contacts: [],
          quota: {
            used: contactUsed,
            limit: contactLimit,
            remaining: contactQuota?.remaining ?? Math.max(0, contactLimit - contactUsed),
            canAdd: contactQuota?.canAdd ?? contactUsed < contactLimit,
            requiresSubscription: contactQuota?.requiresSubscription ?? contactLimit === 0,
          },
          uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['csv'] },
        },
      });
      return;
    }
    if (pathname === `/api/company-intelligence/${globalCompanyId}` && method === 'GET') {
      intelligenceReads.push(intelligenceResponseIndex);
      const response = intelligenceResponses[Math.min(intelligenceResponseIndex, intelligenceResponses.length - 1)];
      intelligenceResponseIndex += 1;
      await route.fulfill({ status: 200, json: response });
      return;
    }
    if (pathname === '/api/company-intelligence/allowance' && method === 'GET') {
      await route.fulfill({ status: 200, json: { allowance: currentAllowance } });
      return;
    }
    if (pathname === `/api/company-intelligence/${globalCompanyId}/research` && method === 'POST') {
      researchStarts.push(request.postDataJSON());
      await route.fulfill({
        status: researchStartStatus,
        json: { error: 'The research allowance changed before this run could start.', code: 'RESEARCH_ALLOWANCE_EXHAUSTED' },
      });
      return;
    }
    if (pathname === '/api/subscriptions/packages' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: { packages, sendingLimits: { emailsPerHourPerSmtp: 100, emailsPerDayPerSmtp: 1000 } },
      });
      return;
    }
    if (pathname === '/api/subscriptions/current' && method === 'GET') {
      await route.fulfill({ status: 200, json: { subscription: subscription ?? null } });
      return;
    }
    if (pathname === '/api/subscriptions/add-ons' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          eligible: Boolean(subscription?.status === 'active' && subscription.package?.amountMinor > 0),
          eligibilityReason: subscription?.status === 'active' && subscription.package?.amountMinor > 0
            ? null
            : 'paid_primary_required',
          primaryEndsAt: subscription?.endsAt ?? null,
          balances: {
            research: { total: 0, used: 0, remaining: 0 },
            emailAssist: { total: 0, used: 0, remaining: 0 },
            mailboxes: { baseLimit: 1, additionalSlots: 0, totalLimit: 1, used: 0, remaining: 1, active: Boolean(subscription?.status === 'active' && subscription.package?.amountMinor > 0) },
          },
          packages: [],
          claimedFreePackageIds: [],
        },
      });
      return;
    }
    if (pathname === '/api/sending/accounts' && method === 'GET') {
      const primaryLimit = subscription?.package?.emailAccountLimit ?? 0;
      await route.fulfill({
        status: 200,
        json: {
          accounts: [],
          emailAccountLimit: primaryLimit,
          configuredCount: configuredSenderCount,
          overLimit: configuredSenderCount > primaryLimit,
          scheduledDowngrade: null,
        },
      });
      return;
    }
    if (pathname === '/api/subscriptions/payment-availability' && method === 'GET') {
      await route.fulfill({ status: 200, json: { enabled: true, superadminEmail: null } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${pathname}` } });
  });
  return { intelligenceReads, researchStarts };
}

async function openPage(path, options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const fixtures = await installFixtures(context, options);
  const page = await context.newPage();
  await page.goto(`${baseUrl}${path}`);
  return { context, page, ...fixtures };
}

describe('company research allowance explanations', { concurrency: false }, () => {
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

  it('explains no package, zero included runs, exhaustion, and the allowance restored in a renewed term', async () => {
    const cases = [
      {
        name: 'no active package',
        response: intelligence({ reason: 'ai_package_required' }),
        expected: 'No AI research package is active for this account, so research and re-research are disabled.',
        expectedAllowance: null,
      },
      {
        name: 'package with no runs',
        response: intelligence({
          allowance: allowance(0, 0, 0),
          reason: 'research_not_included',
        }),
        expected: 'This package does not include company research for the current term.',
        expectedAllowance: 'This package includes no company research runs for the current term.',
      },
      {
        name: 'exhausted allowance',
        response: intelligence({
          allowance: allowance(1, 1, 0),
          reason: 'research_allowance_exhausted',
        }),
        expected: 'The research allowance for this term is exhausted.',
        expectedAllowance: 'No company research runs remain for this term.',
      },
      {
        name: 'renewed term',
        response: intelligence({
          allowance: allowance(1, 0, 1, '2030-06-16T12:00:00.000Z'),
          available: true,
          reason: null,
        }),
        expectedAllowance: '1 of 1 company research runs remain this term.',
      },
    ];
    const displayedMessages = [];
    for (const scenario of cases) {
      const { context, page } = await openPage(`/companies/${companyId}`, {
        intelligenceResponses: [scenario.response],
      });
      try {
        const unavailable = page.getByTestId('status-research-unavailable');
        const allowanceStatus = page.getByTestId('status-research-allowance');
        if (scenario.expected) {
          await unavailable.getByText(scenario.expected, { exact: false }).waitFor();
          displayedMessages.push((await unavailable.innerText()).trim());
        } else {
          await unavailable.waitFor({ state: 'detached' });
        }
        if (scenario.expectedAllowance) {
          await allowanceStatus.getByText(scenario.expectedAllowance, { exact: false }).waitFor();
          displayedMessages.push((await allowanceStatus.innerText()).trim());
        } else {
          await allowanceStatus.waitFor({ state: 'detached' });
        }
        assert.equal(
          await page.getByTestId('button-research').isDisabled(),
          scenario.name !== 'renewed term',
          `${scenario.name} should have the correct research button state`,
        );
        if (scenario.name === 'exhausted allowance') {
          const expectedResetDate = await page.evaluate(value =>
            new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
          resetAt);
          assert.ok((await unavailable.innerText()).includes(expectedResetDate), 'the exhausted message should name the reset date');
        }
      } finally {
        await context.close();
      }
    }
    assert.equal(new Set(displayedMessages).size, displayedMessages.length, 'each allowance state should have its own explanation');
  });

  it('refreshes the displayed allowance after a research start is rejected', async () => {
    const initialAllowance = intelligence({
      allowance: allowance(2, 1, 1),
      available: true,
      reason: null,
    });
    const exhaustedAllowance = intelligence({
      allowance: allowance(2, 2, 0),
      reason: 'research_allowance_exhausted',
    });
    const { context, page, intelligenceReads, researchStarts } = await openPage(`/companies/${companyId}`, {
      intelligenceResponses: [initialAllowance, exhaustedAllowance],
    });
    try {
      const allowanceStatus = page.getByTestId('status-research-allowance');
      await allowanceStatus.getByText('1 of 2 company research runs remain this term.').waitFor();
      await page.getByTestId('button-research').click();
      await page.getByTestId('dialog-confirm-research').waitFor();
      await page.getByTestId('button-confirm-action').click();
      await page.getByTestId('status-research-start-error').waitFor();
      await page.getByTestId('status-research-unavailable')
        .getByText('The research allowance for this term is exhausted.', { exact: false })
        .waitFor();
      await allowanceStatus.getByText('No company research runs remain for this term.', { exact: false }).waitFor();

      assert.deepEqual(researchStarts, [{ confirmed: true, overrideFresh: false, depth: 1 }]);
      assert.ok(intelligenceReads.length >= 2, 'the company intelligence allowance should be requested again after the failure');
      assert.equal(await page.getByTestId('button-research').isDisabled(), true);
    } finally {
      await context.close();
    }
  });

  it('shows a zero-run package allowance on the plans page', async () => {
    const subscription = {
      id: 'browser-zero-research-active-term',
      status: 'active',
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-10-31T00:00:00.000Z',
      package: zeroAllowancePackage,
    };
    const { context, page } = await openPage('/plans', {
      subscription,
      currentAllowance: allowance(0, 0, 0),
    });
    try {
      await page.getByTestId('primary-balance-research').waitFor();
      assert.equal((await page.getByTestId('primary-research-total').innerText()).trim(), '0');
      assert.equal((await page.getByTestId('primary-research-used').innerText()).trim(), '0');
      assert.equal((await page.getByTestId('primary-research-remaining').innerText()).trim(), '0');
    } finally {
      await context.close();
    }
  });

  it('shows the server-reported usage and remaining runs for the active term', async () => {
    const packageWithAllowance = {
      ...zeroAllowancePackage,
      id: 'browser-current-research-package',
      name: 'Research Plus',
      contactLimit: 500,
      emailAccountLimit: 2,
      researchAllowance: 3,
    };
    const subscription = {
      id: 'browser-current-research-term',
      status: 'active',
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: resetAt,
      package: packageWithAllowance,
    };
    const { context, page } = await openPage('/plans', {
      subscription,
      packages: [packageWithAllowance],
      currentAllowance: allowance(3, 2, 1),
      contactQuota: {
        used: 44,
        limit: 500,
        remaining: 456,
        canAdd: true,
        requiresSubscription: false,
      },
      configuredSenderCount: 1,
    });
    try {
      await page.getByTestId('primary-balance-research').waitFor();
      assert.equal((await page.getByTestId('primary-research-total').innerText()).trim(), '3');
      assert.equal((await page.getByTestId('primary-research-used').innerText()).trim(), '2');
      assert.equal((await page.getByTestId('primary-research-remaining').innerText()).trim(), '1');
      assert.equal((await page.getByTestId('primary-contacts-total').innerText()).trim(), '500');
      assert.equal((await page.getByTestId('primary-contacts-used').innerText()).trim(), '44');
      assert.equal((await page.getByTestId('primary-contacts-remaining').innerText()).trim(), '456');
      assert.equal((await page.getByTestId('primary-smtp-accounts-total').innerText()).trim(), '2');
      assert.equal((await page.getByTestId('primary-smtp-accounts-used').innerText()).trim(), '1');
      assert.equal((await page.getByTestId('primary-smtp-accounts-remaining').innerText()).trim(), '1');
    } finally {
      await context.close();
    }
  });
});
