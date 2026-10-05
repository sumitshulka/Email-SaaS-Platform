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
  companyName: legacyCompanyProfile.companyName,
  companyWebsiteUrl: 'https://northstar.example',
  companyDomain: 'northstar.example',
  companyIndustry: 'Biotechnology',
  companySize: '51-200',
  companyRevenueRange: '5M-10M',
  companyPhoneNumber: '+1-555-0199',
  companyLocation: 'Seattle, WA',
  companyLinkedinUrl: 'https://www.linkedin.com/company/northstar',
  companyDescription: 'The shared company profile selected for comparison.',
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
const filterList = {
  id: 'browser-filter-list',
  name: 'Lifecycle audience',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  contactCount: 2,
};

function contactDirectoryFixtures() {
  return [
    {
      ...contact,
      id: contactId,
      email: 'casey.rivera@example.test',
      name: 'Casey Rivera',
      firstName: 'Casey',
      lastName: 'Rivera',
      companyId: null,
      company: null,
      companyName: 'Northstar Labs',
      subscribed: true,
      listIds: [filterList.id],
      lifecycleStage: 'Lead',
      leadStatus: 'Qualified',
      leadSource: 'Referral',
      createdAt: '2026-10-05T10:00:00.000Z',
    },
    {
      ...contact,
      id: 'browser-filter-customer-id',
      email: 'morgan.lee@example.test',
      name: 'Morgan Lee',
      firstName: 'Morgan',
      lastName: 'Lee',
      companyId: null,
      company: null,
      companyName: 'Juniper Labs',
      jobTitle: 'Product manager',
      subscribed: false,
      listIds: [filterList.id],
      lifecycleStage: 'Customer',
      leadStatus: 'Active',
      leadSource: 'Partner',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    {
      ...contact,
      id: 'browser-filter-unassigned-id',
      email: 'jordan.park@example.test',
      name: 'Jordan Park',
      firstName: 'Jordan',
      lastName: 'Park',
      companyId: null,
      company: null,
      companyName: null,
      subscribed: true,
      listIds: [],
      lifecycleStage: null,
      leadStatus: null,
      leadSource: null,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
  ];
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
      await route.fulfill({ status: 200, json: [filterList] });
      return;
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          contacts: contactDirectoryFixtures(),
          quota: { used: 3, limit: 100, remaining: 97, canAdd: true, requiresSubscription: false },
          uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['csv'] },
        },
      });
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
        if (!data.replaceLegacyCompanyProfile) {
          await route.fulfill({
            status: 409,
            json: {
              error: 'This contact has company details that conflict with the selected company.',
              code: 'COMPANY_PROFILE_CONFLICT',
            },
          });
          return;
        }
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

  it('filters the contacts directory by search, list, subscription, and CRM fields', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('input-identifier').fill(user.username);
      await page.getByTestId('input-password').fill('browser-test-password');
      await page.getByTestId('button-sign-in').click();
      await page.waitForURL('**/dashboard');
      await page.goto(`${baseUrl}/contacts`);

      const rows = page.locator('tr[data-testid^="row-contact-"]');
      await page.getByTestId('row-contact-browser-filter-customer-id').waitFor({ state: 'visible' });
      assert.equal(await rows.count(), 3, 'all contacts should appear before filtering');
      await page.screenshot({ path: '/tmp/mailflow-contacts-directory-desktop.png', fullPage: true });

      await page.getByTestId('select-contact-list-filter').selectOption(filterList.id);
      assert.equal(await rows.count(), 2, 'list membership narrows the directory');

      await page.getByTestId('select-contact-status-filter').selectOption('unsubscribed');
      assert.equal(await rows.count(), 1, 'subscription status combines with list membership');
      assert.equal(await page.getByTestId('row-contact-browser-filter-customer-id').isVisible(), true);

      await page.getByTestId('button-toggle-more-contact-filters').click();
      await page.screenshot({ path: '/tmp/mailflow-contacts-directory-advanced.png', fullPage: true });
      await page.getByTestId('select-contact-lifecycle-filter').selectOption('Customer');
      await page.getByTestId('select-contact-lead-source-filter').selectOption('Partner');
      await page.getByTestId('input-search-contacts').fill('morgan juniper product partner');
      assert.equal(await rows.count(), 1, 'search and CRM fields combine with the other filters');

      await page.getByTestId('select-contact-lead-source-filter').selectOption('Referral');
      assert.equal(await rows.count(), 0, 'conflicting filter criteria produce an empty result');
      await page.getByTestId('button-clear-contact-filters').click();
      assert.equal(await rows.count(), 3, 'clear resets every filter and search term');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const sidebar = document.querySelector('aside');
        return !sidebar || sidebar.getBoundingClientRect().right <= 1;
      });
      const pageOverflowsHorizontally = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(pageOverflowsHorizontally, false, 'the mobile contacts page should not have page-level horizontal overflow');
      await page.screenshot({ path: '/tmp/mailflow-contacts-directory-mobile.png', fullPage: true });
    } finally {
      await context.close();
    }
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
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
      assert.match(reviewText, /Compare and review/);
      assert.equal(await page.getByTestId('text-unlinked-company-count').innerText(), '1 to review');
      assert.match(await page.getByTestId('status-company-backfill').innerText(), /0 contacts linked/);

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
      await page.getByTestId('panel-selected-company-comparison').waitFor({ state: 'visible' });
      assert.equal(
        await page.getByTestId('contact-company-comparison-legacy-companyDomain').locator('dd').innerText(),
        'Not provided',
      );
      assert.equal(
        await page.getByTestId('contact-company-comparison-shared-companyDomain').locator('dd').innerText(),
        'northstar.example',
      );
      assert.match(
        await page.getByTestId('contact-company-comparison-shared-companyIndustry').innerText(),
        /Biotechnology/,
      );
      assert.equal(contactUpdates.length, 1, 'selecting a shared profile only opens the comparison');

      const linkResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/contacts/${contactId}` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId('button-link-company').click();
      assert.equal((await linkResponse).status(), 409);
      await page.getByTestId('dialog-replace-legacy-company').waitFor({ state: 'visible' });
      assert.match(
        await page.getByTestId('company-link-confirmation-comparison-legacy-companyIndustry').innerText(),
        /Research/,
      );
      assert.match(
        await page.getByTestId('company-link-confirmation-comparison-shared-companyIndustry').innerText(),
        /Biotechnology/,
      );
      assert.equal(contactUpdates.length, 2);
      assert.equal(contact.companyId, null, 'a conflict must not link the contact before confirmation');
      await page.getByTestId('button-cancel-company-replacement').click();
      assert.equal(await page.getByTestId('panel-linked-company').count(), 0);
      assert.equal(contact.companyId, null, 'cancelling leaves the association unchanged');
      assert.equal(
        await page.getByTestId('input-detail-company').inputValue(),
        legacyCompanyProfile.companyName,
        'cancelling preserves the legacy profile',
      );

      const retryResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/contacts/${contactId}` &&
        response.request().method() === 'PATCH',
      );
      await page.getByTestId('button-link-company').click();
      assert.equal((await retryResponse).status(), 409);
      const confirmResponsePromise = page.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/contacts/${contactId}` &&
        response.request().method() === 'PATCH' &&
        response.status() === 200,
      );
      await page.getByTestId('button-confirm-company-replacement').click();
      const confirmResponse = await confirmResponsePromise;
      assert.equal(confirmResponse.status(), 200);
      await page.getByTestId('status-contact-company').waitFor({ state: 'visible' });
      assert.equal(contactUpdates.length, 4);
      assert.deepEqual(contactUpdates[1], { companyId: company.id });
      assert.deepEqual(contactUpdates[3], { companyId: company.id, replaceLegacyCompanyProfile: true });
      await page.getByTestId('panel-linked-company').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('panel-linked-company').innerText().then(text => text.includes(company.companyName)), true);
    } finally {
      await context.close();
    }
  });
});
