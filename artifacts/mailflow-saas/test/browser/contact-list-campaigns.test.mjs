import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';

const appDirectory = fileURLToPath(new URL('../..', import.meta.url));
const sessionCookie = 'contact-list-browser-test';
const user = {
  id: 'browser-contact-list-user-id',
  username: 'contact-list-browser-user',
  firstName: 'List',
  lastName: 'Reviewer',
  email: 'contact-list@example.test',
  role: 'USER',
  timezone: 'UTC',
  active: true,
  emailVerified: true,
  mustChangeCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const date = '2026-01-01T00:00:00.000Z';
const listOneId = 'browser-list-one';
const listTwoId = 'browser-list-two';
const emptyListId = 'browser-list-empty';
const lists = [
  { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
  { id: listTwoId, name: 'Customer updates', active: false, contactCount: 1, createdAt: date, updatedAt: date },
  { id: emptyListId, name: 'Unused audience', active: true, contactCount: 0, createdAt: date, updatedAt: date },
];

function campaign(id, name, listIds, listId = listIds[0] ?? null) {
  return {
    id,
    name,
    objective: '',
    subject: `${name} subject`,
    parentCampaignId: null,
    campaignType: 'primary',
    textBody: `${name} body`,
    htmlBody: null,
    listId,
    listIds,
    status: 'draft',
    recipients: 0,
    estimatedDurationSeconds: 0,
    queued: 0,
    delivered: 0,
    bounced: 0,
    suppressed: 0,
    unknown: 0,
    queuedAt: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: date,
    updatedAt: date,
  };
}

const campaigns = [
  campaign('browser-campaign-one', 'Launch follow-up', [listOneId]),
  campaign('browser-campaign-two', 'Customer digest', [listTwoId]),
  campaign('browser-campaign-shared', 'Shared announcement', [listOneId, listTwoId]),
];
const campaignById = new Map(campaigns.map(item => [item.id, item]));
let listMemberContactFixtures = [];
let listContactPickerFixtures = [];
const listUpdates = [];
const listDeletes = [];
const dashboardRequests = [];
const campaignAudienceRequests = [];
const campaignAudienceResponses = [];
const campaignUpdates = [];
const campaignQueues = [];
const campaignDeletions = [];
let campaignAudienceSummaryOverride = null;
let aiAssistBalanceReads = 0;
let aiAssistCreditsRemaining = 1;
let aiAssistDraftRequests = 0;

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
    if (pathname === '/api/maintenance/status' && method === 'GET') {
      await route.fulfill({ status: 200, json: { maintenanceMode: false } });
      return;
    }
    if (!(request.headers().cookie ?? '').includes(`mailflow_session=${sessionCookie}`)) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/notifications' && method === 'GET') {
      await route.fulfill({ status: 200, json: { unread: [], history: [] } });
      return;
    }
    if (pathname === '/api/contact-lists' && method === 'GET') {
      await route.fulfill({ status: 200, json: lists });
      return;
    }
    if (pathname === '/api/contacts/filter-options' && method === 'GET') {
      await route.fulfill({ status: 200, json: { lifecycleStages: [], leadStatuses: [], leadSources: ['Referral', 'Website'] } });
      return;
    }
    if (pathname === '/api/campaigns/variant-limits' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          subject: { minimum: 3, maximum: 7 },
          greeting: { minimum: 3, maximum: 7 },
          signature: { minimum: 3, maximum: 7 },
        },
      });
      return;
    }
    if (pathname === '/api/contacts/options' && method === 'GET') {
      const url = new URL(request.url());
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const excludeListId = url.searchParams.get('excludeListId');
      const unattachedOnly = url.searchParams.get('unattachedOnly') === 'true';
      const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
      const letter = url.searchParams.get('firstLetter');
      const jobTitle = url.searchParams.get('jobTitle');
      const company = url.searchParams.get('company');
      const location = url.searchParams.get('location');
      const leadSource = url.searchParams.get('leadSource');
      const subscribed = url.searchParams.get('subscribed');
      const blank = value => !String(value ?? '').trim();
      const textFilter = (value, filter) => !filter || (filter === '__unset__' ? blank(value) : String(value ?? '').toLowerCase().includes(filter.toLowerCase()));
      const matches = listContactPickerFixtures.filter(contact =>
        (!excludeListId || !contact.listIds.includes(excludeListId)) &&
        (!unattachedOnly || contact.listIds.length === 0) &&
        (!letter || (letter === 'other' ? !/^[a-z]/i.test((contact.firstName || contact.name || contact.email).trim()) : (contact.firstName || contact.name || contact.email).trim().toLowerCase().startsWith(letter.toLowerCase()))) &&
        (subscribed === null || contact.subscribed === (subscribed === 'true')) &&
        textFilter(contact.jobTitle, jobTitle) &&
        textFilter(contact.companyName, company) &&
        textFilter(`${contact.location ?? ''} ${contact.companyLocation ?? ''}`, location) &&
        (!leadSource || (leadSource === '__unset__' ? blank(contact.leadSource) : contact.leadSource === leadSource)) &&
        (!search || `${contact.name} ${contact.email} ${contact.companyName ?? ''}`.toLowerCase().includes(search)),
      );
      await route.fulfill({ status: 200, json: { contacts: matches.slice(0, limit), total: matches.length, limit } });
      return;
    }
    if (pathname === '/api/campaigns/recipient-summary' && method === 'GET') {
      const listIds = new URL(request.url()).searchParams.getAll('listIds');
      campaignAudienceRequests.push(listIds);
      const summary = campaignAudienceSummaryOverride ?? {
        uniqueRecipients: listIds.reduce(
          (total, listId) => total + (lists.find(list => list.id === listId)?.contactCount ?? 0),
          0,
        ),
        overlappingRecipients: 0,
      };
      campaignAudienceResponses.push({ ...summary });
      await route.fulfill({ status: 200, json: summary });
      return;
    }
    if (pathname === '/api/campaigns/history' && method === 'GET') {
      const url = new URL(request.url());
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
      const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
      const status = url.searchParams.get('status') ?? 'all';
      const campaignType = url.searchParams.get('campaignType') ?? 'all';
      const listId = url.searchParams.get('listId') ?? 'all';
      const createdWithinDays = Number(url.searchParams.get('createdWithinDays') ?? 0);
      const filtered = campaigns.filter(item =>
        (!search || `${item.name} ${item.subject} ${item.objective ?? ''} ${item.senderEmail ?? ''}`.toLowerCase().includes(search)) &&
        (status === 'all' || item.status === status) &&
        (campaignType === 'all' || item.campaignType === campaignType) &&
        (listId === 'all' || (item.listIds ?? []).includes(listId) || item.listId === listId) &&
        (!createdWithinDays || Date.now() - Date.parse(item.createdAt) <= createdWithinDays * 24 * 60 * 60 * 1000),
      );
      const campaignsToShow = filtered.slice((page - 1) * pageSize, page * pageSize);
      const contextCampaignIds = new Set();
      for (const item of [...campaignsToShow]) {
        const parent = campaigns.find(candidate => candidate.id === item.parentCampaignId);
        if (parent && !campaignsToShow.some(candidate => candidate.id === parent.id)) {
          campaignsToShow.push(parent);
          contextCampaignIds.add(parent.id);
        }
      }
      await route.fulfill({
        status: 200,
        json: {
          campaigns: campaignsToShow,
          contextCampaignIds: [...contextCampaignIds],
          total: filtered.length,
          page,
          pageSize,
          summary: {
            campaignCount: campaigns.length,
            draftCount: campaigns.filter(item => item.status === 'draft').length,
            nonDraftCount: campaigns.filter(item => item.status !== 'draft').length,
            delivered: campaigns.reduce((total, item) => total + (item.delivered ?? 0), 0),
            bounced: campaigns.reduce((total, item) => total + (item.bounced ?? 0), 0),
            suppressed: campaigns.reduce((total, item) => total + (item.suppressed ?? 0), 0),
            activeCampaignCount: campaigns.filter(item => item.status === 'queued' || item.status === 'sending').length,
            activeCampaignFinishAt: null,
          },
        },
      });
      return;
    }
    if (pathname === '/api/subscriptions/add-ons' && method === 'GET') {
      aiAssistBalanceReads += 1;
      await route.fulfill({
        status: 200,
        json: {
          eligible: true,
          eligibilityReason: null,
          primaryEndsAt: null,
          balances: {
            research: { total: 0, used: 0, remaining: 0 },
            emailAssist: {
              total: 1,
              used: 1 - aiAssistCreditsRemaining,
              remaining: aiAssistCreditsRemaining,
            },
            mailboxes: {
              baseLimit: 1,
              additionalSlots: 0,
              totalLimit: 1,
              used: 0,
              remaining: 1,
              active: true,
            },
          },
          refundAdjustments: [],
          packages: [],
          claimedFreePackageIds: [],
        },
      });
      return;
    }
    if (pathname === '/api/campaigns/ai-assist' && method === 'POST') {
      aiAssistDraftRequests += 1;
      aiAssistCreditsRemaining = 0;
      await route.fulfill({
        status: 403,
        json: {
          error: 'No AI email assist credits remain. Add an AI Email Assist package to continue.',
          code: 'AI_EMAIL_ASSIST_ALLOWANCE_EXHAUSTED',
        },
      });
      return;
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      const url = new URL(request.url());
      const params = url.searchParams;
      const isBlank = value => !String(value ?? '').trim();
      const includes = (value, search) => String(value ?? '').toLowerCase().includes(search.toLowerCase());
      const matching = listMemberContactFixtures.filter(contact => {
        const filterText = (key, value) => {
          const term = params.get(key);
          if (!term) return true;
          return term === '__unset__' ? isBlank(value) : includes(value, term);
        };
        const letter = params.get('firstLetter');
        const displayedName = contact.firstName || contact.name || contact.email || '';
        return (!params.get('listId') || params.get('listId') === 'all' || contact.listIds.includes(params.get('listId'))) &&
          (!letter || (letter === 'other' ? !/^[a-z]/i.test(displayedName.trim()) : displayedName.trim().toLowerCase().startsWith(letter.toLowerCase()))) &&
          (params.get('status') === 'all' || !params.get('status') || contact.subscribed === (params.get('status') === 'subscribed')) &&
          filterText('jobTitle', contact.jobTitle) &&
          filterText('company', contact.companyName) &&
          filterText('location', `${contact.location ?? ''} ${contact.companyLocation ?? ''}`) &&
          (!params.get('leadSource') || params.get('leadSource') === 'all' || (params.get('leadSource') === '__unset__' ? isBlank(contact.leadSource) : contact.leadSource === params.get('leadSource')));
      });
      const page = Number(params.get('page') ?? 1);
      const pageSize = Number(params.get('pageSize') ?? 50);
      await route.fulfill({
        status: 200,
        json: {
          contacts: matching.slice((page - 1) * pageSize, page * pageSize),
          quota: { used: 0, limit: 100, remaining: 100, canAdd: true, requiresSubscription: false },
          uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['csv'] },
          page,
          pageSize,
          total: matching.length,
          pageCount: Math.ceil(matching.length / pageSize),
          workspaceTotal: listMemberContactFixtures.length,
          workspaceSubscribed: listMemberContactFixtures.filter(contact => contact.subscribed).length,
        },
      });
      return;
    }
    const contactNavigationMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/navigation$/);
    if (contactNavigationMatch && method === 'GET') {
      const index = listMemberContactFixtures.findIndex(contact => contact.id === contactNavigationMatch[1]);
      if (index < 0) {
        await route.fulfill({ status: 404, json: { error: 'Contact not found.' } });
        return;
      }
      await route.fulfill({
        status: 200,
        json: {
          previousContactId: listMemberContactFixtures[index - 1]?.id ?? null,
          nextContactId: listMemberContactFixtures[index + 1]?.id ?? null,
          position: index + 1,
          total: listMemberContactFixtures.length,
        },
      });
      return;
    }
    const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (contactMatch && method === 'GET') {
      const contact = listMemberContactFixtures.find(item => item.id === contactMatch[1]);
      await route.fulfill(
        contact
          ? { status: 200, json: contact }
          : { status: 404, json: { error: 'Contact not found.' } },
      );
      return;
    }
    if (contactMatch && method === 'PATCH') {
      const contact = listMemberContactFixtures.find(item => item.id === contactMatch[1]);
      if (!contact) {
        await route.fulfill({ status: 404, json: { error: 'Contact not found.' } });
        return;
      }
      const { listIds } = request.postDataJSON();
      for (const listId of contact.listIds) {
        const list = lists.find(item => item.id === listId);
        if (list) list.contactCount = Math.max(0, list.contactCount - 1);
      }
      contact.listIds = [...listIds];
      for (const listId of contact.listIds) {
        const list = lists.find(item => item.id === listId);
        if (list) list.contactCount += 1;
      }
      await route.fulfill({ status: 200, json: contact });
      return;
    }
    if (pathname === '/api/campaigns' && method === 'GET') {
      await route.fulfill({ status: 200, json: campaigns });
      return;
    }
    const campaignMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
    if (campaignMatch && method === 'PATCH') {
      const campaignData = campaignById.get(campaignMatch[1]);
      if (!campaignData) {
        await route.fulfill({ status: 404, json: { error: 'Campaign not found.' } });
        return;
      }
      const data = request.postDataJSON();
      campaignUpdates.push({ id: campaignData.id, data });
      Object.assign(campaignData, data, { listId: data.listIds?.[0] ?? campaignData.listId, updatedAt: '2026-01-02T00:00:00.000Z' });
      await delay(150);
      await route.fulfill({ status: 200, json: campaignData });
      return;
    }
    if (campaignMatch && method === 'DELETE') {
      const campaignData = campaignById.get(campaignMatch[1]);
      if (!campaignData) {
        await route.fulfill({ status: 404, json: { error: 'Campaign not found.' } });
        return;
      }
      campaignDeletions.push(campaignMatch[1]);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const campaignSendMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/send$/);
    if (campaignSendMatch && method === 'POST') {
      const campaignData = campaignById.get(campaignSendMatch[1]);
      if (!campaignData) {
        await route.fulfill({ status: 404, json: { error: 'Campaign not found.' } });
        return;
      }
      const data = request.postDataJSON();
      campaignQueues.push({ id: campaignData.id, data });
      Object.assign(campaignData, { status: 'queued', scheduledAt: data.scheduledAt, updatedAt: '2026-01-02T00:00:00.000Z' });
      await delay(200);
      await route.fulfill({ status: 201, json: campaignData });
      return;
    }
    const listMatch = pathname.match(/^\/api\/contact-lists\/([^/]+)$/);
    if (listMatch && method === 'PATCH') {
      const list = lists.find(item => item.id === listMatch[1]);
      if (!list) {
        await route.fulfill({ status: 404, json: { error: 'Contact list not found.' } });
        return;
      }
      const data = request.postDataJSON();
      listUpdates.push({ id: list.id, data });
      Object.assign(list, data, { updatedAt: '2026-01-02T00:00:00.000Z' });
      await route.fulfill({ status: 200, json: list });
      return;
    }
    if (listMatch && method === 'DELETE') {
      listDeletes.push(listMatch[1]);
      const listIndex = lists.findIndex(item => item.id === listMatch[1]);
      if (listIndex < 0) {
        await route.fulfill({ status: 404, json: { error: 'Contact list not found.' } });
        return;
      }
      lists.splice(listIndex, 1);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const dashboardMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
    if (dashboardMatch && method === 'GET') {
      const campaignData = campaignById.get(dashboardMatch[1]);
      dashboardRequests.push(dashboardMatch[1]);
      if (!campaignData) {
        await route.fulfill({ status: 404, json: { error: 'Campaign not found.' } });
        return;
      }
      const targetLists = campaignData.listIds.map(id => lists.find(list => list.id === id)).filter(Boolean)
        .map(list => ({
          id: list.id,
          name: list.name,
          active: list.active,
          totalContacts: list.contactCount,
          eligibleContacts: list.contactCount,
          unsubscribedContacts: 0,
        }));
      await route.fulfill({
        status: 200,
        json: {
          campaign: campaignData,
          targetList: targetLists[0] ?? null,
          targetLists,
          pacing: {
            emailsPerHour: 100,
            emailsPerDay: 1000,
            maxCampaignSize: 1000,
            minimumSpacingSeconds: 1,
            remainingEmails: 0,
            estimatedDurationSeconds: 0,
            estimatedCompletionAt: null,
          },
          variantResults: {
            subject: { testEnabled: false, variants: [] },
            greeting: { testEnabled: false, variants: [] },
            signature: { testEnabled: false, variants: [] },
          },
        },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { error: `Unexpected API request: ${method} ${pathname}` } });
  });
}

describe('contact-list campaigns and list action menu', { concurrency: false }, () => {
  before(async () => {
    lists.splice(0, lists.length,
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
      { id: listTwoId, name: 'Customer updates', active: false, contactCount: 1, createdAt: date, updatedAt: date },
      { id: emptyListId, name: 'Unused audience', active: true, contactCount: 0, createdAt: date, updatedAt: date },
    );
    listUpdates.length = 0;
    listDeletes.length = 0;
    dashboardRequests.length = 0;
    campaignAudienceRequests.length = 0;
    campaignAudienceResponses.length = 0;
    campaignUpdates.length = 0;
    campaignQueues.length = 0;
    campaignDeletions.length = 0;
    campaignAudienceSummaryOverride = null;
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

  it('opens and navigates between contact records without returning to the directory', async () => {
    const contacts = [
      {
        id: 'navigation-contact-newest',
        name: 'Alex Newest',
        firstName: 'Alex',
        lastName: 'Newest',
        email: 'alex.newest@example.test',
        companyId: null,
        companyName: null,
        subscribed: true,
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: date,
        listIds: [],
      },
      {
        id: 'navigation-contact-older',
        name: 'Bailey Older',
        firstName: 'Bailey',
        lastName: 'Older',
        email: 'bailey.older@example.test',
        companyId: null,
        companyName: null,
        subscribed: true,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: date,
        listIds: [],
      },
    ];
    listMemberContactFixtures = contacts;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/contacts`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('row-contact-navigation-contact-newest').waitFor({ state: 'visible' });
      await page.getByTestId('link-contact-navigation-contact-newest').click();
      await page.waitForURL('**/contacts/navigation-contact-newest');
      await page.getByTestId('button-next-contact').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('[data-testid="text-contact-navigation-position"]')?.textContent === '1 of 2');
      assert.equal(await page.locator('h1').innerText(), 'Alex Newest');
      assert.equal(await page.getByTestId('text-contact-navigation-position').innerText(), '1 of 2');
      assert.equal(await page.getByTestId('button-previous-contact').isDisabled(), true);
      await page.getByTestId('button-next-contact').click();
      await page.waitForURL('**/contacts/navigation-contact-older');
      assert.equal(await page.locator('h1').innerText(), 'Bailey Older');
      await page.waitForFunction(() => document.querySelector('[data-testid="text-contact-navigation-position"]')?.textContent === '2 of 2');
      assert.equal(await page.getByTestId('text-contact-navigation-position').innerText(), '2 of 2');
      assert.equal(await page.getByTestId('button-next-contact').isDisabled(), true);
      assert.equal(await page.getByTestId('button-previous-contact').isDisabled(), false);
    } finally {
      await context.close();
      listMemberContactFixtures = [];
    }
  });

  it('shows only each list’s campaigns, opens matching dashboards, and keeps menu actions working', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/lists`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Contact lists' }).waitFor({ state: 'visible' });

      assert.equal(await page.getByTestId(`status-list-campaign-count-${listOneId}`).innerText(), '2 campaigns');
      assert.equal(await page.getByTestId(`status-list-campaign-count-${listTwoId}`).innerText(), '2 campaigns');
      assert.equal(await page.getByTestId(`status-list-campaign-count-${emptyListId}`).innerText(), '0 campaigns');

      await page.getByTestId(`button-toggle-list-campaigns-${listOneId}`).click();
      const firstListCampaigns = page.locator(`#list-campaigns-${listOneId}`);
      await firstListCampaigns.getByTestId('link-list-campaign-browser-campaign-one').waitFor({ state: 'visible' });
      await firstListCampaigns.getByTestId('link-list-campaign-browser-campaign-shared').waitFor({ state: 'visible' });
      assert.equal(await firstListCampaigns.getByTestId('link-list-campaign-browser-campaign-two').count(), 0);

      await page.getByTestId(`button-toggle-list-campaigns-${listTwoId}`).click();
      const secondListCampaigns = page.locator(`#list-campaigns-${listTwoId}`);
      await secondListCampaigns.getByTestId('link-list-campaign-browser-campaign-two').waitFor({ state: 'visible' });
      await secondListCampaigns.getByTestId('link-list-campaign-browser-campaign-shared').waitFor({ state: 'visible' });
      assert.equal(await secondListCampaigns.getByTestId('link-list-campaign-browser-campaign-one').count(), 0);

      await page.getByTestId(`button-toggle-list-campaigns-${emptyListId}`).click();
      await page.getByText('No campaigns have used this list yet.', { exact: true }).waitFor({ state: 'visible' });

      await firstListCampaigns.getByTestId('link-list-campaign-browser-campaign-one').click();
      await page.waitForURL(`**/campaigns/browser-campaign-one`);
      await page.getByRole('heading', { name: 'Launch follow-up', exact: true }).waitFor({ state: 'visible' });
      assert.equal(dashboardRequests.at(-1), 'browser-campaign-one', 'the first list link should request its own campaign dashboard');

      await page.goto(`${baseUrl}/lists`);
      await page.getByRole('heading', { name: 'Contact lists' }).waitFor({ state: 'visible' });
      await page.getByTestId(`button-toggle-list-campaigns-${listTwoId}`).click();
      await page.locator(`#list-campaigns-${listTwoId}`).getByTestId('link-list-campaign-browser-campaign-shared').click();
      await page.waitForURL(`**/campaigns/browser-campaign-shared`);
      await page.getByRole('heading', { name: 'Shared announcement', exact: true }).waitFor({ state: 'visible' });
      assert.equal(dashboardRequests.at(-1), 'browser-campaign-shared', 'the shared campaign link should open that campaign dashboard');

      await page.goto(`${baseUrl}/lists`);
      await page.getByRole('heading', { name: 'Contact lists' }).waitFor({ state: 'visible' });

      await page.getByTestId(`button-list-actions-${listOneId}`).click();
      await page.getByTestId(`button-toggle-list-${listOneId}`).click();
      await page.getByText('List deactivated.', { exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId(`card-list-${listOneId}`).getByText('Inactive', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(listUpdates.at(-1), { id: listOneId, data: { active: false } });
      await page.keyboard.press('Escape');
      const firstListActions = page.getByTestId(`button-list-actions-${listOneId}`);
      await firstListActions.click();
      if (await firstListActions.getAttribute('aria-expanded') === 'false') {
        await firstListActions.press('Enter');
      }
      const firstListMenu = page.locator('[role="menu"]');
      await firstListMenu.waitFor({ state: 'visible', timeout: 2_000 }).catch(async () => {
        throw new Error(
          `List action menu did not open again: expanded=${await firstListActions.getAttribute('aria-expanded')}; ` +
          `menus=${await page.locator('[role="menu"]').count()}; body=${(await page.locator('body').innerText()).slice(-500)}`,
        );
      });
      await page.getByTestId(`button-toggle-list-${listOneId}`).waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId(`button-toggle-list-${listOneId}`).innerText(), 'Activate');
      await page.getByTestId(`button-toggle-list-${listOneId}`).click();
      await page.getByText('List activated and available for campaigns.', { exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId(`card-list-${listOneId}`).getByText('Active', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(listUpdates.at(-1), { id: listOneId, data: { active: true } });

      await page.getByTestId(`button-list-actions-${listTwoId}`).click();
      await page.getByTestId(`button-edit-list-${listTwoId}`).click();
      const nameInput = page.getByTestId('input-list-name');
      assert.equal(await nameInput.inputValue(), 'Customer updates');
      await nameInput.fill('Renewed customer updates');
      await page.getByTestId('button-submit-list').click();
      await page.getByRole('heading', { name: 'Renewed customer updates', exact: true }).waitFor({ state: 'visible' });
      await page.getByText('List changes saved.', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(listUpdates.at(-1), { id: listTwoId, data: { name: 'Renewed customer updates' } });

      await page.getByTestId(`button-list-actions-${emptyListId}`).click();
      await page.getByTestId(`button-delete-list-${emptyListId}`).click();
      await page.getByTestId('dialog-delete-contact-list').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('dialog-delete-contact-list').getByText('Delete “Unused audience”? Contacts will remain in your workspace but will no longer belong to this list.').count(), 1);
      assert.equal(listDeletes.length, 0, 'opening the delete dialog must not delete the list');
      await page.getByTestId('button-cancel-confirmation').click();
      await page.getByTestId('dialog-delete-contact-list').waitFor({ state: 'hidden' });
      assert.equal(await page.getByTestId(`card-list-${emptyListId}`).count(), 1, 'cancelling leaves the list in place');

      await page.getByTestId(`button-list-actions-${emptyListId}`).click();
      await page.getByTestId(`button-delete-list-${emptyListId}`).click();
      await page.getByTestId('button-confirm-action').click();
      await page.getByText('List deleted. Contacts remain in the workspace.', { exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId(`card-list-${emptyListId}`).waitFor({ state: 'detached' });
      assert.deepEqual(listDeletes, [emptyListId]);
      assert.equal(await page.getByTestId(`card-list-${listOneId}`).count(), 1);
      assert.equal(await page.getByTestId(`card-list-${listTwoId}`).count(), 1);
      assert.deepEqual(pageErrors, [], 'list and campaign pages should render without browser errors');
    } finally {
      await context.close();
    }
  });

  it('filters contacts to add and finds contacts unattached to every list', async () => {
    listMemberContactFixtures = [
      {
        id: 'member-alpha',
        name: 'Alice Adams',
        firstName: 'Alice',
        lastName: 'Adams',
        email: 'alice@example.test',
        companyName: 'Acme Labs',
        jobTitle: 'Product Engineer',
        location: 'London',
        companyLocation: 'London',
        leadSource: 'Referral',
        subscribed: true,
        listIds: [listOneId],
      },
      {
        id: 'member-beta',
        name: 'Bob Brown',
        firstName: 'Bob',
        lastName: 'Brown',
        email: 'bob@example.test',
        companyName: '   ',
        jobTitle: ' ',
        location: null,
        companyLocation: '',
        leadSource: '',
        subscribed: false,
        listIds: [listOneId],
      },
    ];
    listContactPickerFixtures = [
      { id: 'picker-alpha', name: 'Avery Alpha', firstName: 'Avery', lastName: 'Alpha', email: 'avery@example.test', companyName: 'Acme Labs', jobTitle: 'Product Engineer', location: 'London', leadSource: 'Referral', subscribed: true, createdAt: date, listIds: [listTwoId] },
      { id: 'picker-blank', name: 'Blank Beta', firstName: 'Blank', lastName: 'Beta', email: 'blank@example.test', companyName: '  ', jobTitle: ' ', location: null, companyLocation: '', leadSource: '', subscribed: false, createdAt: date, listIds: [] },
      { id: 'picker-other-list', name: 'Casey Other', firstName: 'Casey', lastName: 'Other', email: 'casey@example.test', companyName: 'Acme Labs', subscribed: true, createdAt: date, listIds: [listTwoId] },
      { id: 'picker-unattached', name: 'Taylor Free', firstName: 'Taylor', lastName: 'Free', email: 'taylor@example.test', companyName: null, subscribed: true, createdAt: date, listIds: [] },
    ];

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/lists`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Contact lists' }).waitFor({ state: 'visible' });
      await page.getByTestId(`button-view-list-contacts-${listOneId}`).click();
      await page.getByTestId('row-list-contact-member-alpha').waitFor({ state: 'visible' });

      await page.getByTestId('select-list-candidate-first-letter').selectOption('A');
      await page.getByTestId('select-list-candidate-status').selectOption('subscribed');
      await page.getByTestId('input-list-candidate-job-title').fill('Engineer');
      await page.getByTestId('input-list-candidate-company').fill('Acme');
      await page.getByTestId('input-list-candidate-location').fill('London');
      await page.getByTestId('select-list-candidate-lead-source').selectOption('Referral');
      await page.getByTestId('row-add-contact-to-list-picker-alpha').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('[data-testid="row-add-contact-to-list-picker-blank"]'));
      assert.equal(await page.getByTestId('row-add-contact-to-list-picker-blank').count(), 0);
      assert.equal(await page.getByTestId('row-list-contact-member-beta').count(), 1);

      await page.getByTestId('button-clear-list-candidate-filters').click();
      await page.getByTestId('checkbox-list-candidate-jobTitle-blank').check();
      await page.getByTestId('checkbox-list-candidate-company-blank').check();
      await page.getByTestId('checkbox-list-candidate-location-blank').check();
      await page.getByTestId('select-list-candidate-lead-source').selectOption('__unset__');
      await page.getByTestId('row-add-contact-to-list-picker-blank').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('[data-testid="row-add-contact-to-list-picker-alpha"]'));
      assert.equal(await page.getByTestId('row-add-contact-to-list-picker-alpha').count(), 0);

      await page.getByTestId('checkbox-only-unattached-contacts').check();
      await page.getByTestId('button-add-contact-to-list-picker-unattached').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('button-add-contact-to-list-picker-other-list').count(), 0);

      await page.getByTestId('select-move-contact-member-alpha').selectOption(listTwoId);
      await page.getByTestId('row-list-contact-member-alpha').waitFor({ state: 'detached' });
      assert.deepEqual(listMemberContactFixtures.find(contact => contact.id === 'member-alpha').listIds, [listTwoId]);
      assert.equal(lists.find(list => list.id === listOneId).contactCount, 1);
      assert.equal(lists.find(list => list.id === listTwoId).contactCount, 2);
    } finally {
      await context.close();
      listMemberContactFixtures = [];
      listContactPickerFixtures = [];
    }
  });

  it('moves a contact from the Contacts page Membership column', async () => {
    lists.splice(0, lists.length,
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 1, createdAt: date, updatedAt: date },
      { id: listTwoId, name: 'Customer updates', active: true, contactCount: 0, createdAt: date, updatedAt: date },
    );
    listMemberContactFixtures = [{
      id: 'membership-contact',
      name: 'Morgan Membership',
      firstName: 'Morgan',
      lastName: 'Membership',
      email: 'morgan@example.test',
      companyName: null,
      subscribed: true,
      createdAt: date,
      listIds: [listOneId],
    }];

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/contacts`, { waitUntil: 'domcontentloaded' });
      const membership = page.getByTestId('select-contact-membership-membership-contact');
      await membership.waitFor({ state: 'visible' });
      assert.equal(await membership.inputValue(), listOneId);

      await membership.selectOption(listTwoId);
      await page.waitForFunction((targetId) => (
        document.querySelector('[data-testid="select-contact-membership-membership-contact"]')?.value === targetId
      ), listTwoId);
      assert.deepEqual(listMemberContactFixtures[0].listIds, [listTwoId]);
      assert.equal(lists.find(list => list.id === listOneId).contactCount, 0);
      assert.equal(lists.find(list => list.id === listTwoId).contactCount, 1);
    } finally {
      await context.close();
      listMemberContactFixtures = [];
    }
  });

  it('keeps search selection isolated and updates audience totals and order for bulk add and clear', async () => {
    lists.splice(0, lists.length,
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
      { id: listTwoId, name: 'Customer updates', active: false, contactCount: 1, createdAt: date, updatedAt: date },
      { id: emptyListId, name: 'Unused audience', active: true, contactCount: 0, createdAt: date, updatedAt: date },
      { id: 'spring-wave-a', name: 'Spring wave A', active: true, contactCount: 4, createdAt: date, updatedAt: date },
      { id: 'spring-wave-b', name: 'Spring wave B', active: true, contactCount: 5, createdAt: date, updatedAt: date },
      { id: 'spring-archive', name: 'Spring archive', active: false, contactCount: 7, createdAt: date, updatedAt: date },
    );
    const editableCampaign = campaignById.get('browser-campaign-one');
    editableCampaign.listId = listOneId;
    editableCampaign.listIds = [listOneId];
    campaignAudienceRequests.length = 0;

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      const apiRequests = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('request', request => {
        if (request.url().includes('/api/campaigns/')) apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-edit-campaign-browser-campaign-one').click();
      await page.getByTestId('button-campaign-step-next').click();
      const picker = page.getByTestId('campaign-list-picker');
      const order = page.getByTestId('campaign-list-order');
      const audienceSummary = page.getByTestId('campaign-audience-summary');
      await audienceSummary.getByText('2 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });

      const search = page.getByTestId('input-campaign-list-search');
      await search.fill('Spring');
      await picker.getByTestId('checkbox-campaign-list-spring-wave-a').waitFor({ state: 'visible' });
      assert.equal(await picker.locator('input[type="checkbox"]').count(), 3, 'search should show only matching lists');
      assert.equal(await page.getByTestId('checkbox-campaign-list-spring-archive').isDisabled(), true, 'inactive matches must not be newly selectable');
      assert.deepEqual(
        await order.locator('[data-testid^="button-campaign-list-up-"]').evaluateAll(buttons =>
          buttons.map(button => button.getAttribute('data-testid').replace('button-campaign-list-up-', '')),
        ),
        [listOneId],
        'searching must not change the selected list outside the search result',
      );

      await page.getByTestId('checkbox-campaign-list-spring-wave-b').check();
      await audienceSummary.getByText('7 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      assert.deepEqual(
        await order.locator('[data-testid^="button-campaign-list-up-"]').evaluateAll(buttons =>
          buttons.map(button => button.getAttribute('data-testid').replace('button-campaign-list-up-', '')),
        ),
        [listOneId, 'spring-wave-b'],
        'a manually selected match should follow the existing outside-search priority',
      );

      await search.fill('');
      await page.getByTestId('button-campaign-lists-selected').click();
      assert.equal(await picker.locator('input[type="checkbox"]').count(), 2, 'selected-only view should retain both selected lists');
      assert.equal(await page.getByTestId(`checkbox-campaign-list-${listOneId}`).isChecked(), true);
      assert.equal(await page.getByTestId('checkbox-campaign-list-spring-wave-b').isChecked(), true);
      assert.equal(await page.getByTestId('checkbox-campaign-list-spring-wave-a').count(), 0);

      await page.getByTestId('button-campaign-lists-all').click();
      await search.fill('Spring');
      await page.getByTestId('button-add-matching-campaign-lists').click();
      await audienceSummary.getByText('11 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      assert.deepEqual(
        await order.locator('[data-testid^="button-campaign-list-up-"]').evaluateAll(buttons =>
          buttons.map(button => button.getAttribute('data-testid').replace('button-campaign-list-up-', '')),
        ),
        [listOneId, 'spring-wave-b', 'spring-wave-a'],
        'bulk add should append new active matches without changing established processing priority',
      );
      assert.equal(await page.getByTestId('checkbox-campaign-list-spring-archive').count(), 1);
      assert.equal(await page.getByTestId('checkbox-campaign-list-spring-archive').isChecked(), false);

      await page.getByTestId('button-clear-campaign-lists').click();
      await page.locator('[data-testid="campaign-list-order"]').waitFor({ state: 'detached' });
      await page.getByTestId('campaign-audience-summary').waitFor({ state: 'detached' });
      assert.equal(await page.locator('fieldset').getByText('0 selected', { exact: true }).count(), 1);
      assert.deepEqual(
        campaignAudienceRequests.at(-1),
        [listOneId, 'spring-wave-b', 'spring-wave-a'],
        'bulk add should refresh the audience count using the intended processing order before clear',
      );
      assert.deepEqual(pageErrors, [], 'campaign audience selection should render without browser errors');
    } finally {
      await context.close();
    }
  });

  it('keeps the campaign editor open on Review without saving the draft', async () => {
    campaignUpdates.length = 0;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-edit-campaign-browser-campaign-one').click();

      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('campaign-audience-summary').getByText('2 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('button-campaign-step-next').click();

      await page.getByRole('heading', { name: 'Confirm campaign setup' }).waitFor({ state: 'visible' });
      await page.getByTestId('button-submit-campaign').waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('dialog', { name: 'Edit campaign draft' }).isVisible(), true);
      assert.equal(page.url().endsWith('/campaigns'), true);
      assert.equal(campaignUpdates.length, 0, 'moving to Review must not save the draft');
    } finally {
      await context.close();
    }
  });

  it('refreshes audience totals and overlap before saving and queueing without discarding draft edits', async () => {
    lists.splice(0, lists.length,
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
      { id: listTwoId, name: 'Customer updates', active: true, contactCount: 1, createdAt: date, updatedAt: date },
    );
    const editableCampaign = campaignById.get('browser-campaign-one');
    editableCampaign.listId = listOneId;
    editableCampaign.listIds = [listOneId, listTwoId];
    campaignAudienceRequests.length = 0;
    campaignAudienceResponses.length = 0;
    campaignUpdates.length = 0;
    campaignQueues.length = 0;
    campaignAudienceSummaryOverride = { uniqueRecipients: 2, overlappingRecipients: 0 };

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-edit-campaign-browser-campaign-one').click();
      await page.getByTestId('button-campaign-step-next').click();

      const audienceSummary = page.getByTestId('campaign-audience-summary');
      const subject = page.getByTestId('input-campaign-subject');
      await audienceSummary.getByText('2 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      await page.getByTestId('button-campaign-step-next').click();
      await subject.fill('Unsaved subject survives audience refresh');

      await page.getByTestId('button-campaign-step-back').click();
      campaignAudienceSummaryOverride = { uniqueRecipients: 4, overlappingRecipients: 1 };
      await page.getByTestId('button-refresh-campaign-audience').click();
      await audienceSummary.getByText('4 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      await audienceSummary.getByText('1 addresses appear in multiple selected lists.', { exact: false }).waitFor({ state: 'visible' });
      assert.equal(await subject.inputValue(), 'Unsaved subject survives audience refresh', 'refreshing the count must not reset unsaved campaign fields');

      campaignAudienceSummaryOverride = { uniqueRecipients: 5, overlappingRecipients: 2 };
      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('button-submit-campaign').click();
      await page.getByText('Draft changes saved.', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(campaignAudienceResponses.at(-1), { uniqueRecipients: 5, overlappingRecipients: 2 }, 'saving must recheck the latest audience summary');
      assert.equal(campaignUpdates.at(-1).data.subject, 'Unsaved subject survives audience refresh');
      assert.deepEqual(campaignUpdates.at(-1).data.listIds, [listOneId, listTwoId]);

      await page.getByTestId('button-queue-campaign-browser-campaign-one').click();
      await page.getByTestId('dialog-campaign-action').waitFor({ state: 'visible' });
      const startAt = new Date(Date.now() + 60 * 60 * 1000);
      const startAtValue = [
        startAt.getFullYear(),
        String(startAt.getMonth() + 1).padStart(2, '0'),
        String(startAt.getDate()).padStart(2, '0'),
      ].join('-') + `T${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`;
      await page.getByTestId('input-campaign-start-at').fill(startAtValue);

      campaignAudienceSummaryOverride = { uniqueRecipients: 6, overlappingRecipients: 2 };
      const queueResponse = page.waitForResponse(response =>
        response.url().includes('/api/campaigns/browser-campaign-one/send') && response.request().method() === 'POST',
      );
      await page.getByTestId('button-confirm-action').click();
      await page.getByTestId('queue-audience-summary').getByText('6 unique subscribed email addresses', { exact: false }).waitFor({ state: 'visible' });
      await page.getByTestId('queue-audience-summary').getByText('2 addresses are on more than one selected list.', { exact: false }).waitFor({ state: 'visible' });
      assert.deepEqual(campaignAudienceResponses.at(-1), { uniqueRecipients: 6, overlappingRecipients: 2 }, 'queueing must recheck the latest audience summary');
      assert.equal((await queueResponse).status(), 201);
      assert.equal(campaignQueues.at(-1).id, 'browser-campaign-one');
      assert.equal(campaignQueues.at(-1).data.scheduledAt, new Date(startAtValue).toISOString());
      assert.deepEqual(pageErrors, [], 'audience refresh, save, and queue should not produce browser errors');
    } finally {
      await context.close();
      campaignAudienceSummaryOverride = null;
      editableCampaign.status = 'draft';
      editableCampaign.scheduledAt = null;
      editableCampaign.subject = 'Launch follow-up subject';
      editableCampaign.listId = listOneId;
      editableCampaign.listIds = [listOneId];
    }
  });

  it('refreshes the AI credit balance after another tab exhausts it without retrying the draft', async () => {
    aiAssistBalanceReads = 0;
    aiAssistCreditsRemaining = 1;
    aiAssistDraftRequests = 0;

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-create-campaign').click();
      await page.getByTestId('input-campaign-name').fill('AI assist credit test');
      await page.getByTestId('input-campaign-objective').fill('Introduce our new spring collection');
      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('campaign-audience-summary').waitFor({ state: 'visible' });
      await page.getByTestId('button-campaign-step-next').click();
      await page.getByTestId('panel-campaign-ai-assist').getByText('1 credits left', { exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-generate-campaign-ai-draft').click();
      const brief = {
        persona: 'Small business owners looking for seasonal products',
        promotion: 'A new spring collection with practical everyday items',
        goal: 'Introduce the collection to existing customers',
        desiredAction: 'Browse the collection page',
        guidance: 'Do not invent prices, discounts, or performance claims',
      };
      for (const [field, value] of Object.entries(brief)) {
        await page.getByTestId(`input-campaign-ai-${field}`).fill(value);
      }

      const draftResponse = page.waitForResponse(response =>
        response.url().includes('/api/campaigns/ai-assist') && response.request().method() === 'POST',
      );
      const balanceRefresh = page.waitForResponse(response =>
        response.url().includes('/api/subscriptions/add-ons') && response.request().method() === 'GET',
      );
      await page.getByTestId('button-submit-campaign-ai-brief').click();
      const response = await draftResponse;
      assert.equal(response.status(), 403);
      assert.equal(response.request().postDataJSON().maxWords, 100);
      assert.equal((await balanceRefresh).status(), 200);

      await page.getByTestId('panel-campaign-ai-assist').getByText('0 credits left', { exact: true }).waitFor({ state: 'visible' });
      const error = page.getByTestId('status-campaign-ai-assist-error');
      await error.getByText('No AI email assist credits remain. Add an AI Email Assist package to continue.', { exact: false }).waitFor({ state: 'visible' });
      assert.equal(aiAssistBalanceReads, 2, 'the add-on balance should be fetched once on open and once after exhaustion');
      assert.equal(aiAssistDraftRequests, 1, 'an exhausted-credit rejection must not trigger another provider request');
    } finally {
      await context.close();
      aiAssistCreditsRemaining = 1;
    }
  });

  it('keeps the list picker and processing order scrollable and bounded with 80 matching lists', async () => {
    const largeLists = [
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
      ...Array.from({ length: 80 }, (_, index) => {
        const number = String(index + 1).padStart(3, '0');
        return {
          id: `volume-list-${number}`,
          name: `Volume List ${number}`,
          active: true,
          contactCount: 1,
          createdAt: date,
          updatedAt: date,
        };
      }),
    ];
    lists.splice(0, lists.length, ...largeLists);
    const editableCampaign = campaignById.get('browser-campaign-one');
    editableCampaign.listId = listOneId;
    editableCampaign.listIds = [listOneId];
    campaignAudienceRequests.length = 0;

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-edit-campaign-browser-campaign-one').click();
      await page.getByTestId('button-campaign-step-next').click();
      const picker = page.getByTestId('campaign-list-picker');
      const order = page.getByTestId('campaign-list-order');

      await page.getByTestId('input-campaign-list-search').fill('Volume List');
      await page.getByTestId('button-add-matching-campaign-lists').click();
      await page.getByTestId('campaign-audience-summary')
        .getByText('82 unique subscribed email addresses', { exact: false })
        .waitFor({ state: 'visible' });
      assert.equal(await order.locator('li').count(), 81, 'the existing priority and all 80 newly matched lists should be represented');

      const pickerMetrics = await picker.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
        overflowY: getComputedStyle(element).overflowY,
      }));
      assert.equal(pickerMetrics.overflowY, 'auto');
      assert.ok(pickerMetrics.clientHeight <= pickerMetrics.maxHeight, 'the picker must not grow beyond its max height');
      assert.ok(pickerMetrics.scrollHeight > pickerMetrics.clientHeight, 'the picker should scroll when the list exceeds its visible area');

      const lastCheckbox = page.getByTestId('checkbox-campaign-list-volume-list-080');
      await lastCheckbox.scrollIntoViewIfNeeded();
      assert.equal(await lastCheckbox.isChecked(), true, 'the last picker option should remain reachable and selected');
      assert.ok(await picker.evaluate(element => element.scrollTop > 0), 'scrolling to the last option should move the picker');

      const orderMetrics = await order.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
        overflowY: getComputedStyle(element).overflowY,
      }));
      assert.equal(orderMetrics.overflowY, 'auto');
      assert.ok(orderMetrics.clientHeight <= orderMetrics.maxHeight, 'the order panel must not grow beyond its max height');
      assert.ok(orderMetrics.scrollHeight > orderMetrics.clientHeight, 'the order panel should scroll when many lists are selected');

      const orderIds = () => order.locator('[data-testid^="button-campaign-list-up-"]').evaluateAll(buttons =>
        buttons.map(button => button.getAttribute('data-testid').replace('button-campaign-list-up-', '')),
      );
      const beforeMove = await orderIds();
      const lastOrderButton = page.getByTestId('button-campaign-list-up-volume-list-080');
      await lastOrderButton.scrollIntoViewIfNeeded();
      assert.ok(await order.evaluate(element => element.scrollTop > 0), 'the last selected list should be reachable by scrolling the order panel');
      await lastOrderButton.click();
      const afterMove = await orderIds();
      assert.deepEqual(afterMove.slice(0, -2), beforeMove.slice(0, -2));
      assert.deepEqual(afterMove.slice(-2), ['volume-list-080', 'volume-list-079'], 'a list at the end of a long order can still be moved earlier');
      assert.deepEqual(pageErrors, [], 'large campaign audiences should render without browser errors');
    } finally {
      await context.close();
    }
  });

  it('filters campaign trees without hiding follow-ups or losing parent context', async () => {
    const now = Date.now();
    const originalCampaigns = campaigns.slice();
    const originalLists = lists.slice();
    const daysAgo = days => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    const parent = {
      ...campaign('filter-parent', 'Spring launch', [listOneId]),
      objective: 'Spring product launch',
      status: 'completed',
      campaignType: 'primary',
      parentCampaignId: null,
      createdAt: daysAgo(45),
      completedAt: daysAgo(40),
    };
    const matchingFollowUp = {
      ...campaign('filter-follow-up', 'Re-engagement sequence', [listTwoId]),
      objective: 'Winback inactive customers',
      status: 'completed',
      campaignType: 'follow_up',
      parentCampaignId: parent.id,
      createdAt: daysAgo(2),
      completedAt: daysAgo(1),
    };
    const olderFollowUp = {
      ...campaign('filter-older-follow-up', 'Dormant audience reminder', [listOneId]),
      objective: 'Reminder for dormant audience',
      status: 'draft',
      campaignType: 'follow_up',
      parentCampaignId: parent.id,
      createdAt: daysAgo(80),
    };
    const recentPrimary = {
      ...campaign('filter-recent-primary', 'Weekly customer digest', [listTwoId]),
      objective: 'Weekly product updates',
      status: 'draft',
      campaignType: 'primary',
      parentCampaignId: null,
      createdAt: daysAgo(1),
    };
    campaigns.splice(0, campaigns.length, parent, matchingFollowUp, olderFollowUp, recentPrimary);
    lists.splice(0, lists.length,
      { id: listOneId, name: 'Launch audience', active: true, contactCount: 2, createdAt: date, updatedAt: date },
      { id: listTwoId, name: 'Customer updates', active: true, contactCount: 1, createdAt: date, updatedAt: date },
    );

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });

      const row = id => page.getByTestId(`row-campaign-${id}`);
      const rowIds = async () => page.locator('[data-testid^="row-campaign-"]').evaluateAll(rows =>
        rows.map(element => element.getAttribute('data-testid').replace('row-campaign-', '')),
      );
      const waitForRows = expectedIds => page.waitForFunction(expected => {
        const rows = [...document.querySelectorAll('[data-testid^="row-campaign-"]')]
          .map(element => element.getAttribute('data-testid').replace('row-campaign-', ''));
        return JSON.stringify(rows) === JSON.stringify(expected);
      }, expectedIds);
      const allRows = [recentPrimary.id, parent.id, matchingFollowUp.id, olderFollowUp.id];

      await waitForRows(allRows);
      await page.getByTestId('input-campaign-search').fill('winback');
      await waitForRows([parent.id, matchingFollowUp.id]);
      assert.equal(await row(parent.id).getByText('parent context', { exact: true }).count(), 1);
      await page.getByTestId('input-campaign-search').fill('');
      await waitForRows(allRows);

      await page.getByTestId('select-campaign-status-filter').selectOption('completed');
      await waitForRows([parent.id, matchingFollowUp.id]);
      await page.getByTestId('select-campaign-status-filter').selectOption('draft');
      await waitForRows([recentPrimary.id, parent.id, olderFollowUp.id]);
      await page.getByTestId('select-campaign-status-filter').selectOption('all');
      await waitForRows(allRows);

      await page.getByTestId('select-campaign-type-filter').selectOption('primary');
      await waitForRows([recentPrimary.id, parent.id]);
      await page.getByTestId('select-campaign-type-filter').selectOption('follow_up');
      await waitForRows([parent.id, matchingFollowUp.id, olderFollowUp.id]);
      assert.equal(await row(parent.id).getByText('parent context', { exact: true }).count(), 1);
      await page.getByTestId('select-campaign-type-filter').selectOption('all');
      await waitForRows(allRows);

      await page.getByTestId('select-campaign-list-filter').selectOption(listTwoId);
      await waitForRows([recentPrimary.id, parent.id, matchingFollowUp.id]);
      assert.equal(await row(parent.id).getByText('parent context', { exact: true }).count(), 1);
      await page.getByTestId('select-campaign-list-filter').selectOption('all');
      await waitForRows(allRows);

      await page.getByTestId('select-campaign-date-filter').selectOption('7');
      await waitForRows([recentPrimary.id, parent.id, matchingFollowUp.id]);
      await page.getByTestId('select-campaign-date-filter').selectOption('all');
      await waitForRows(allRows);

      await page.getByTestId('input-campaign-search').fill('winback');
      await page.getByTestId('select-campaign-status-filter').selectOption('completed');
      await page.getByTestId('select-campaign-type-filter').selectOption('follow_up');
      await page.getByTestId('select-campaign-list-filter').selectOption(listTwoId);
      await page.getByTestId('select-campaign-date-filter').selectOption('30');
      await waitForRows([parent.id, matchingFollowUp.id]);
      assert.equal(await row(parent.id).getByText('parent context', { exact: true }).count(), 1);
      assert.equal(await page.getByText('1 matching campaigns', { exact: false }).count(), 2, 'the result count appears in both the history heading and pagination');

      await page.getByTestId('button-reset-campaign-filters').click();
      await waitForRows(allRows);
      assert.equal(await page.getByTestId('input-campaign-search').inputValue(), '');
      for (const testId of [
        'select-campaign-status-filter',
        'select-campaign-type-filter',
        'select-campaign-list-filter',
        'select-campaign-date-filter',
      ]) {
        assert.equal(await page.getByTestId(testId).inputValue(), 'all');
      }

      await page.getByTestId('button-toggle-campaign-tree').click();
      await waitForRows([recentPrimary.id, parent.id]);
      await page.getByTestId('button-toggle-campaign-tree').click();
      await waitForRows(allRows);
      await page.getByTestId(`button-toggle-campaign-${parent.id}`).click();
      await waitForRows([recentPrimary.id, parent.id]);
      await page.getByTestId(`button-toggle-campaign-${parent.id}`).click();
      await waitForRows(allRows);

      await page.getByTestId('input-campaign-search').fill('no such campaign');
      await page.getByTestId('button-clear-campaign-filters').click();
      await waitForRows(allRows);
      assert.equal(await page.getByTestId('input-campaign-search').inputValue(), '');
      assert.deepEqual(await rowIds(), allRows);
      assert.deepEqual(pageErrors, [], 'filtering and expanding the campaign tree should not cause browser errors');
    } finally {
      await context.close();
      campaigns.splice(0, campaigns.length, ...originalCampaigns);
      lists.splice(0, lists.length, ...originalLists);
    }
  });

  it('lets users delete a draft follow-up from its campaign dashboard', async () => {
    const target = campaignById.get('browser-campaign-one');
    const previousParentId = target.parentCampaignId;
    const previousCampaignType = target.campaignType;
    target.parentCampaignId = 'browser-parent-campaign';
    target.campaignType = 'follow_up';
    campaignDeletions.length = 0;

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      await installApiFixtures(context);
      const page = await context.newPage();
      const pageErrors = [];
      const apiRequests = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('request', request => {
        if (request.url().includes('/api/campaigns/')) apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      await page.goto(`${baseUrl}/campaigns/${target.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: target.name, exact: true }).waitFor({ state: 'visible' });

      await page.getByTestId('button-delete-draft-campaign').click();
      await page.getByTestId('dialog-delete-draft-campaign').waitFor({ state: 'visible' });
      assert.equal(campaignDeletions.length, 0, 'opening the confirmation must not delete the campaign');
      const deletionResponse = page.waitForResponse(response =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/campaigns/${target.id}`,
        { timeout: 5_000 },
      );
      await page.getByTestId('button-confirm-action').click();
      let response;
      try {
        response = await deletionResponse;
      } catch {
        throw new Error(`Delete request was not sent. URL: ${page.url()}; requests: ${apiRequests.join(', ')}; dialog: ${(await page.locator('[data-testid="dialog-delete-draft-campaign"]').innerText().catch(() => 'closed'))}; errors: ${pageErrors.join(' | ')}`);
      }
      assert.equal(response.status(), 204);
      await page.waitForURL(url => url.pathname === '/campaigns', { timeout: 5_000 }).catch(async () => {
        throw new Error(`Delete did not return to campaigns. URL: ${page.url()}; dialog: ${(await page.locator('[data-testid="dialog-delete-draft-campaign"]').innerText().catch(() => 'closed'))}; console/page errors: ${pageErrors.join(' | ')}`);
      });
      assert.deepEqual(campaignDeletions, [target.id]);
      assert.deepEqual(pageErrors, [], 'deleting from the campaign dashboard should not cause browser errors');
    } finally {
      target.parentCampaignId = previousParentId;
      target.campaignType = previousCampaignType;
      await context.close();
    }
  });
});
