import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const contactId = 'browser-review-contact-id';
const user = {
  id: 'browser-review-user-id',
  username: 'company-review-user',
  firstName: 'Company',
  lastName: 'Reviewer',
  email: 'company-review@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const legacyCompanyProfile = {
  companyName: 'Northstar Labs',
  companyWebsiteUrl: null,
  companyDomain: null,
  companyIndustry: 'Research',
  companySize: '11-50',
  companyRevenueRange: '1M-5M',
  companyPhoneNumber: '+1-555-0142',
  companyLocation: 'Portland, OR',
  companyLinkedinUrl: 'https://www.linkedin.com/company/northstar-labs',
  companyDescription: 'Keep this legacy company profile until a user chooses to link a shared record.',
};

const company = {
  id: 'browser-review-shared-company-id',
  ...legacyCompanyProfile,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  contactCount: 0,
};

const reviewProfile = {
  contactId,
  contactName: 'Casey Rivera',
  email: 'casey.rivera@example.test',
  ...legacyCompanyProfile,
  reason: 'Company domain and website are missing, so an automatic match could not be confirmed.',
};

let contact = {
  id: contactId,
  email: 'casey.rivera@example.test',
  name: 'Casey Rivera',
  firstName: 'Casey',
  lastName: 'Rivera',
  companyId: null,
  company: null,
  ...legacyCompanyProfile,
  linkedinUrl: null,
  phoneNumber: null,
  jobTitle: null,
  department: null,
  seniority: null,
  mobilePhone: null,
  websiteUrl: null,
  twitterUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  location: null,
  preferredLanguage: null,
  timeZone: null,
  lifecycleStage: null,
  leadStatus: null,
  leadSource: null,
  interests: null,
  goals: null,
  painPoints: null,
  personalizationContext: null,
  notes: null,
  subscribed: true,
  listIds: [],
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
};

let serverProcess;
let serverOutput = '';
let browser;
let baseUrl;
const contactUpdates = [];

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

async function installApiFixtures(context) {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const cookie = request.headers().cookie ?? '';

    if (pathname === '/api/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON();
      if (credentials.identifier !== user.username || credentials.password !== 'browser-test-password') {
        await route.fulfill({ status: 401, json: { error: 'Invalid credentials.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'set-cookie': 'mailflow_session=company-review-browser-test; Path=/; SameSite=Lax' },
        json: { user },
      });
      return;
    }

    if (!cookie.includes('mailflow_session=company-review-browser-test')) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/companies' && method === 'GET') {
      await route.fulfill({ status: 200, json: { companies: [company] } });
      return;
    }
    if (pathname === '/api/companies/unlinked-profiles' && method === 'GET') {
      await route.fulfill({ status: 200, json: { profiles: [reviewProfile] } });
      return;
    }
    if (pathname === '/api/companies/backfill' && method === 'POST') {
      await route.fulfill({
        status: 200,
        json: { linkedContacts: 0, createdCompanies: 0, skippedContacts: 1 },
      });
      return;
    }
    if (pathname === '/api/contact-field-options' && method === 'GET') {
      await route.fulfill({ status: 200, json: { options: [] } });
      return;
    }
    if (pathname === '/api/contact-lists' && method === 'GET') {
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    if (pathname === `/api/contacts/${contactId}` && method === 'GET') {
      await route.fulfill({ status: 200, json: contact });
      return;
    }
    if (pathname === `/api/contacts/${contactId}` && method === 'PATCH') {
      const data = request.postDataJSON();
      contactUpdates.push(data);
      if (data.companyId) {
        contact = { ...contact, companyId: data.companyId, company };
      } else {
        contact = {
          ...contact,
          ...data,
          name: `${data.firstName} ${data.lastName}`.trim(),
          updatedAt: '2026-10-01T12:00:00.000Z',
        };
      }
      await route.fulfill({ status: 200, json: contact });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected API request: ${method} ${pathname}` },
    });
  });
}

describe('company profile review and contact data preservation', { concurrency: false }, () => {
  before(async () => {
    contact = {
      ...contact,
      companyId: null,
      company: null,
      ...legacyCompanyProfile,
    };
    contactUpdates.length = 0;
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

  it('shows the unlinked profile and reason, preserves it on save, and links only after an explicit choice', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const browserErrors = [];
      page.on('pageerror', error => browserErrors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      await page.goto(baseUrl);
      await page.getByTestId('input-identifier').fill(user.username);
      await page.getByTestId('input-password').fill('browser-test-password');
      await page.getByTestId('button-sign-in').click();
      await page.waitForURL('**/dashboard');

      await page.goto(`${baseUrl}/companies`);
      const reviewRow = page.getByTestId(`row-unlinked-company-${contactId}`);
      await reviewRow.waitFor({ state: 'visible' });
      const reviewText = await reviewRow.innerText();
      assert.match(reviewText, /Northstar Labs/);
      assert.match(reviewText, /casey\.rivera@example\.test/);
      assert.match(reviewText, /Company domain and website are missing, so an automatic match could not be confirmed\./);
      assert.equal(await page.getByTestId('text-unlinked-company-count').innerText(), '1 to review');

      await reviewRow.getByTestId(`link-review-unlinked-company-${contactId}`).click();
      await page.waitForURL(`**/contacts/${contactId}`);
      await page.getByRole('heading', { name: 'Company profile' }).waitFor({ state: 'visible' });

      const profileInputs = [
        ['input-detail-company', legacyCompanyProfile.companyName],
        ['input-detail-company-domain', ''],
        ['input-detail-company-industry', legacyCompanyProfile.companyIndustry],
        ['input-detail-company-size', legacyCompanyProfile.companySize],
        ['input-detail-company-revenue', legacyCompanyProfile.companyRevenueRange],
        ['input-detail-company-phone', legacyCompanyProfile.companyPhoneNumber],
        ['input-detail-company-location', legacyCompanyProfile.companyLocation],
        ['input-detail-company-description', legacyCompanyProfile.companyDescription],
      ];
      for (const [testId, expectedValue] of profileInputs) {
        assert.equal(await page.getByTestId(testId).inputValue(), expectedValue, `${testId} should retain the legacy value`);
      }
      assert.equal(
        await page.getByTestId('input-detail-company-website-full-value').innerText(),
        'Not provided',
      );
      assert.equal(
        await page.getByTestId('input-detail-company-linkedin-full-value').innerText(),
        legacyCompanyProfile.companyLinkedinUrl,
      );
      assert.equal(await page.getByTestId('button-link-company').isDisabled(), true);
      assert.equal(contactUpdates.length, 0, 'opening a review item must not update or link the contact');

      const saveResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/contacts/${contactId}` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId('button-save-contact-detail').click();
      assert.equal((await saveResponse).status(), 200);
      await delay(250);
      assert.equal(
        await page.getByTestId('status-contact-save').count(),
        1,
        `contact save feedback should render; browser errors: ${browserErrors.join(' | ')}; page text: ${await page.locator('body').innerText()}`,
      );
      assert.equal(contactUpdates.length, 1);
      assert.equal(Object.hasOwn(contactUpdates[0], 'companyId'), false, 'a regular contact save must not change its company association');
      for (const [field, value] of Object.entries(legacyCompanyProfile)) {
        assert.equal(contactUpdates[0][field], value, `the save request should preserve ${field}`);
        assert.equal(contact[field], value, `the saved contact should preserve ${field}`);
      }
      assert.equal(contact.companyId, null);
      assert.equal(contact.company, null);

      await page.reload();
      await page.getByRole('heading', { name: 'Company profile' }).waitFor({ state: 'visible' });
      for (const [testId, expectedValue] of profileInputs) {
        assert.equal(await page.getByTestId(testId).inputValue(), expectedValue, `${testId} should persist after reload`);
      }
      assert.equal(await page.getByTestId('input-detail-company-website-full-value').innerText(), 'Not provided');
      assert.equal(
        await page.getByTestId('input-detail-company-linkedin-full-value').innerText(),
        legacyCompanyProfile.companyLinkedinUrl,
      );
      assert.equal(await page.getByTestId('panel-linked-company').count(), 0);
      assert.equal(contactUpdates.length, 1, 'loading the contact again must not trigger a link');

      await page.getByTestId('select-contact-company').selectOption(company.id);
      assert.equal(await page.getByTestId('button-link-company').isDisabled(), false);
      const linkResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/contacts/${contactId}` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId('button-link-company').click();
      assert.equal((await linkResponse).status(), 200);
      await page.getByTestId('status-contact-company').waitFor({ state: 'visible' });
      assert.equal(contactUpdates.length, 2);
      assert.deepEqual(contactUpdates[1], { companyId: company.id });
      await page.getByTestId('panel-linked-company').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('panel-linked-company').innerText().then(text => text.includes(company.companyName)), true);
    } finally {
      await context.close();
    }
  });
});
