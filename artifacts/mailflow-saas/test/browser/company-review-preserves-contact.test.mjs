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
      lastEmail: {
        id: 'browser-filter-last-email-id',
        campaignId: 'browser-filter-last-campaign-id',
        campaignName: 'October product update',
        subject: 'A long campaign subject that should not appear in the compact cell',
        status: 'delivered',
        attempts: 1,
        lastAttemptAt: '2026-10-05T12:15:00.000Z',
        deliveredAt: '2026-10-05T12:16:00.000Z',
      },
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

async function installApiFixtures(context, {
  companies = [company],
  contacts = contactDirectoryFixtures(),
  companySearchRequests = [],
  companyDirectoryRequests = [],
} = {}) {
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
    if (pathname === '/api/companies/search' && method === 'GET') {
      const url = new URL(request.url());
      const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 40);
      companySearchRequests.push({ search: url.searchParams.get('search') ?? '', page, pageSize });
      const matching = companies.filter(item =>
        `${item.companyName} ${item.companyDomain ?? ''}`.toLowerCase().includes(search),
      );
      await route.fulfill({
        status: 200,
        json: {
          companies: matching.slice((page - 1) * pageSize, page * pageSize).map(item => ({
            id: item.id,
            companyName: item.companyName,
            companyDomain: item.companyDomain ?? null,
          })),
          total: matching.length,
          page,
          pageSize,
        },
      });
      return;
    }
    if (pathname === '/api/companies' && method === 'GET') {
      companyDirectoryRequests.push(request.url());
      await route.fulfill({ status: 200, json: { companies } });
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
    if (pathname === '/api/contacts/filter-options' && method === 'GET') {
      const uniqueValues = field => [...new Set(contacts.map(contact => contact[field]).filter(value => typeof value === 'string' && value.trim()))].sort();
      await route.fulfill({
        status: 200,
        json: {
          lifecycleStages: uniqueValues('lifecycleStage'),
          leadStatuses: uniqueValues('leadStatus'),
          leadSources: uniqueValues('leadSource'),
        },
      });
      return;
    }
    if (pathname === '/api/contacts/options' && method === 'GET') {
      const params = new URL(request.url()).searchParams;
      const search = (params.get('search') || '').trim().toLowerCase();
      const listIds = params.getAll('listIds');
      const limit = Math.min(Number(params.get('limit') || 30), 100);
      let filtered = contacts.filter(candidate => {
        if (params.get('companyId') === '__none__' && candidate.companyId) return false;
        if (params.get('companyId') && params.get('companyId') !== '__none__' && candidate.companyId !== params.get('companyId')) return false;
        if (params.get('excludeListId') && candidate.listIds.includes(params.get('excludeListId'))) return false;
        if (params.get('listId') && !candidate.listIds.includes(params.get('listId'))) return false;
        if (listIds.length && !listIds.some(listId => candidate.listIds.includes(listId))) return false;
        if (params.get('subscribed') === 'true' && !candidate.subscribed) return false;
        if (params.get('subscribed') === 'false' && candidate.subscribed) return false;
        const searchable = [candidate.name, candidate.email, candidate.firstName, candidate.lastName, candidate.companyName, candidate.jobTitle]
          .filter(Boolean).join(' ').toLowerCase();
        return search.split(/\s+/).filter(Boolean).every(term => searchable.includes(term));
      });
      filtered.sort((left, right) => left.email.localeCompare(right.email));
      await route.fulfill({
        status: 200,
        json: {
          contacts: filtered.slice(0, limit),
          total: filtered.length,
          limit,
        },
      });
      return;
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      const params = new URL(request.url()).searchParams;
      const search = (params.get('search') || '').trim().toLowerCase();
      const days = Number(params.get('addedWithin') || 0);
      const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
      const filterField = (selected, value) => selected === 'all'
        || (selected === '__unset__' ? !value?.trim() : selected === value);
      let filtered = contacts.filter(candidate => {
        if (params.get('status') === 'subscribed' && !candidate.subscribed) return false;
        if (params.get('status') === 'unsubscribed' && candidate.subscribed) return false;
        if (params.get('listId') && params.get('listId') !== 'all'
          && (params.get('listId') === '__none__' ? candidate.listIds.length > 0 : !candidate.listIds.includes(params.get('listId')))) return false;
        if (params.get('companyId') && params.get('companyId') !== 'all'
          && (params.get('companyId') === '__none__' ? candidate.companyId || candidate.companyName?.trim() : candidate.companyId !== params.get('companyId'))) return false;
        if (!filterField(params.get('lifecycleStage') || 'all', candidate.lifecycleStage)) return false;
        if (!filterField(params.get('leadStatus') || 'all', candidate.leadStatus)) return false;
        if (!filterField(params.get('leadSource') || 'all', candidate.leadSource)) return false;
        if (cutoff !== null && Date.parse(candidate.createdAt) < cutoff) return false;
        const searchable = [
          candidate.name, candidate.email, candidate.firstName, candidate.lastName,
          candidate.companyName, candidate.jobTitle, candidate.department, candidate.seniority,
          candidate.phoneNumber, candidate.mobilePhone, candidate.linkedinUrl, candidate.websiteUrl,
          candidate.twitterUrl, candidate.facebookUrl, candidate.instagramUrl, candidate.location,
          candidate.preferredLanguage, candidate.timeZone, candidate.lifecycleStage,
          candidate.leadStatus, candidate.leadSource, candidate.companyIndustry, candidate.companyDomain,
        ].filter(Boolean).join(' ').toLowerCase();
        return search.split(/\s+/).filter(Boolean).every(term => searchable.includes(term));
      });
      filtered.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      const page = Math.max(1, Number(params.get('page') || 1));
      const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') || 50)));
      const total = filtered.length;
      const pageCount = Math.ceil(total / pageSize);
      const pageOffset = (Math.min(page, Math.max(pageCount, 1)) - 1) * pageSize;
      await route.fulfill({
        status: 200,
        json: {
          contacts: filtered.slice(pageOffset, pageOffset + pageSize),
          page: Math.min(page, Math.max(pageCount, 1)),
          pageSize,
          total,
          pageCount,
          workspaceTotal: contacts.length,
          workspaceSubscribed: contacts.filter(candidate => candidate.subscribed).length,
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
      const nameRow = page.getByTestId(`row-contact-${contactId}`);
      assert.equal(await nameRow.getByTestId(`link-contact-${contactId}`).innerText(), 'Casey Rivera');
      assert.ok((await nameRow.innerText()).includes('casey.rivera@example.test'));
      assert.equal((await nameRow.innerText()).includes('Northstar Labs'), false, 'company details stay on the contact detail page');
      const lastEmailCell = page.getByTestId(`cell-contact-last-email-${contactId}`);
      assert.equal(await page.getByTestId(`contact-last-email-campaign-${contactId}`).innerText(), 'October product update');
      assert.ok(await page.getByTestId(`contact-last-email-date-${contactId}`).innerText());
      assert.equal(await lastEmailCell.locator(':scope > div > div').count(), 2, 'the last email cell should render exactly two detail rows');
      assert.equal((await lastEmailCell.innerText()).includes('A long campaign subject'), false);
      await page.screenshot({ path: '/tmp/mailflow-contacts-directory-desktop.png', fullPage: true });

      await page.getByTestId('select-contact-list-filter').selectOption(filterList.id);
      await page.waitForFunction(expected => document.querySelectorAll('tr[data-testid^="row-contact-"]').length === expected, 2);
      assert.equal(await rows.count(), 2, 'list membership narrows the directory');

      await page.getByTestId('select-contact-status-filter').selectOption('unsubscribed');
      await page.waitForFunction(expected => document.querySelectorAll('tr[data-testid^="row-contact-"]').length === expected, 1);
      assert.equal(await rows.count(), 1, 'subscription status combines with list membership');
      assert.equal(await page.getByTestId('row-contact-browser-filter-customer-id').isVisible(), true);

      await page.getByTestId('button-toggle-more-contact-filters').click();
      await page.screenshot({ path: '/tmp/mailflow-contacts-directory-advanced.png', fullPage: true });
      await page.getByTestId('select-contact-lifecycle-filter').selectOption('Customer');
      await page.getByTestId('select-contact-lead-source-filter').selectOption('Partner');
      await page.getByTestId('input-search-contacts').fill('morgan juniper product partner');
      await page.waitForFunction(expected => document.querySelectorAll('tr[data-testid^="row-contact-"]').length === expected, 1);
      assert.equal(await rows.count(), 1, 'search and CRM fields combine with the other filters');

      await page.getByTestId('select-contact-lead-source-filter').selectOption('Referral');
      await page.getByText('No matching contacts', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await rows.count(), 0, 'conflicting filter criteria produce an empty result');
      await page.getByTestId('button-clear-contact-filters').click();
      await page.waitForFunction(expected => document.querySelectorAll('tr[data-testid^="row-contact-"]').length === expected, 3);
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

  it('searches large company lists by name and domain, and filters contacts by company ID', async () => {
    const matchingCompanyCount = 52;
    const companies = Array.from({ length: 1200 }, (_, index) => {
      const matching = index < matchingCompanyCount;
      return {
        ...company,
        id: `browser-large-company-${String(index).padStart(3, '0')}`,
        companyName: matching
          ? `Harbor Directory ${String(index).padStart(3, '0')}`
          : `Unrelated Organization ${String(index).padStart(4, '0')}`,
        companyDomain: matching
          ? `tenant-${String(index).padStart(3, '0')}.customer-mail.test`
          : `unrelated-${String(index).padStart(4, '0')}.example.test`,
      };
    });
    const selectedCompany = companies[0];
    const makeContact = (id, companyId, companyName) => ({
      ...contact,
      id,
      email: `${id}@example.test`,
      name: id,
      firstName: id,
      lastName: 'Contact',
      companyId,
      company: null,
      companyName,
      companyDomain: null,
      listIds: [],
      subscribed: true,
      createdAt: '2026-10-05T10:00:00.000Z',
    });
    const contacts = [
      makeContact('company-id-match', selectedCompany.id, selectedCompany.companyName),
      makeContact('legacy-name-only', null, selectedCompany.companyName),
      makeContact('different-company-id', 'another-company-id', selectedCompany.companyName),
      makeContact('no-company-null-values', null, null),
      makeContact('no-company-blank-name', null, '   '),
      makeContact('company-id-without-name', 'another-company-id', null),
    ];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const companySearchRequests = [];
    const companyDirectoryRequests = [];
    try {
      await installApiFixtures(context, {
        companies,
        contacts,
        companySearchRequests,
        companyDirectoryRequests,
      });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('input-identifier').fill(user.username);
      await page.getByTestId('input-password').fill('browser-test-password');
      await page.getByTestId('button-sign-in').click();
      await page.waitForURL('**/dashboard');
      await page.goto(`${baseUrl}/contacts`);

      const rows = page.locator('tr[data-testid^="row-contact-"]');
      await page.getByTestId('row-contact-company-id-match').waitFor({ state: 'visible' });
      assert.equal(await rows.count(), contacts.length, 'all fixture contacts should appear before filtering');

      const companySearch = page.getByTestId('select-contact-company-filter');
      const companyOptions = page.locator('[data-testid^="option-contact-company-"]');
      const refineMessage = `Showing 40 of ${matchingCompanyCount} matches. Refine your search.`;
      await companySearch.fill('Harbor Directory');
      await page.getByText(refineMessage, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await companyOptions.count(), 40, 'name search should cap a large result set at 40 companies');
      assert.ok(companySearchRequests.some(request =>
        request.search === 'Harbor Directory' && request.page === 1 && request.pageSize === 40,
      ), 'name searches should request a bounded server page');

      await companySearch.fill('customer-mail.test');
      await page.getByText(refineMessage, { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await companyOptions.count(), 40, 'domain search should also cap a large result set at 40 companies');
      assert.ok(companySearchRequests.some(request =>
        request.search === 'customer-mail.test' && request.page === 1 && request.pageSize === 40,
      ), 'domain searches should request a bounded server page');
      assert.equal(companyDirectoryRequests.length, 0, 'the contacts filter should not download the full company directory');
      assert.equal(await page.getByTestId(`option-contact-company-${selectedCompany.id}`).count(), 1);
      await page.getByTestId(`option-contact-company-${selectedCompany.id}`).click();

      await page.getByTestId('row-contact-company-id-match').waitFor({ state: 'visible' });
      assert.equal(await rows.count(), 1, 'only the contact with the selected company ID should match');
      assert.equal(await page.getByTestId('row-contact-legacy-name-only').count(), 0, 'a matching legacy name without an ID should not match');
      assert.equal(await page.getByTestId('row-contact-different-company-id').count(), 0, 'a different company ID should not match even when its name is identical');

      await companySearch.evaluate(input => input.blur());
      await companySearch.focus();
      await page.getByRole('listbox', { name: 'Company options' }).waitFor({ state: 'visible' });
      await page.getByRole('option', { name: 'No company', exact: true }).click();
      await page.getByTestId('row-contact-no-company-null-values').waitFor({ state: 'visible' });
      await page.getByTestId('row-contact-no-company-blank-name').waitFor({ state: 'visible' });
      assert.equal(await rows.count(), 2, 'No company should match only contacts with no ID and no nonblank company name');
      assert.equal(await page.getByTestId('row-contact-legacy-name-only').count(), 0, 'legacy company names must exclude a contact from No company');
      assert.equal(await page.getByTestId('row-contact-company-id-without-name').count(), 0, 'a company ID must exclude a contact from No company');
    } finally {
      await context.close();
    }
  });

  it('combines company directory filters and clears them together', async () => {
    const companies = [
      {
        ...company,
        id: 'browser-company-filter-northstar',
        companyName: 'Northstar Labs',
        companyIndustry: 'Biotechnology',
        companySize: '51-200',
        companyRevenueRange: '5M-10M',
        companyLocation: 'Seattle, WA',
      },
      {
        ...company,
        id: 'browser-company-filter-west-labs',
        companyName: 'West Labs',
        companyIndustry: 'Biotechnology',
        companySize: '11-50',
        companyRevenueRange: '1M-5M',
        companyLocation: 'Portland, OR',
      },
      {
        ...company,
        id: 'browser-company-filter-atlas',
        companyName: 'Atlas Capital',
        companyIndustry: 'Finance',
        companySize: '51-200',
        companyRevenueRange: '5M-10M',
        companyLocation: 'New York, NY',
      },
    ];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context, { companies });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('input-identifier').fill(user.username);
      await page.getByTestId('input-password').fill('browser-test-password');
      await page.getByTestId('button-sign-in').click();
      await page.waitForURL('**/dashboard');
      await page.goto(`${baseUrl}/companies`);

      const rows = page.locator('tr[data-testid^="row-company-"]');
      await page.getByTestId('row-company-browser-company-filter-northstar').waitFor({ state: 'visible' });
      assert.equal(await rows.count(), 3, 'all companies should appear before filtering');
      assert.equal(
        await page.getByTestId('text-company-location-browser-company-filter-northstar').innerText(),
        'Seattle, WA',
      );

      await page.getByTestId('select-company-industry-filter').selectOption({ label: 'Biotechnology' });
      assert.equal(await rows.count(), 2, 'industry should narrow the directory');
      await page.getByTestId('select-company-size-filter').selectOption({ label: '51-200' });
      assert.equal(await rows.count(), 1, 'company size should combine with industry');
      assert.equal(await page.getByTestId('row-company-browser-company-filter-northstar').isVisible(), true);

      await page.getByTestId('input-company-location-filter').fill('seattle');
      assert.equal(await rows.count(), 1, 'location filtering should ignore letter case');
      await page.getByTestId('select-company-revenue-filter').selectOption({ label: '1M-5M' });
      assert.equal(await rows.count(), 0, 'conflicting criteria should show no matching companies');
      await page.getByText('No matching companies', { exact: true }).waitFor({ state: 'visible' });

      await page.getByTestId('button-clear-company-filters').click();
      assert.equal(await rows.count(), 3, 'clear filters should restore all companies');
      assert.equal(await page.getByTestId('select-company-industry-filter').inputValue(), '');
      assert.equal(await page.getByTestId('select-company-size-filter').inputValue(), '');
      assert.equal(await page.getByTestId('select-company-revenue-filter').inputValue(), '');
      assert.equal(await page.getByTestId('input-company-location-filter').inputValue(), '');

      await page.setViewportSize({ width: 390, height: 844 });
      const pageOverflowsHorizontally = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(pageOverflowsHorizontally, false, 'filters should not cause page-level horizontal overflow on mobile');
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
