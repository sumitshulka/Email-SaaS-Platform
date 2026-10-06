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
const listUpdates = [];
const listDeletes = [];
const dashboardRequests = [];
const campaignAudienceRequests = [];

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
    if (!(request.headers().cookie ?? '').includes(`mailflow_session=${sessionCookie}`)) {
      await route.fulfill({ status: 401, json: { error: 'Not authenticated.' } });
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      await route.fulfill({ status: 200, json: user });
      return;
    }
    if (pathname === '/api/contact-lists' && method === 'GET') {
      await route.fulfill({ status: 200, json: lists });
      return;
    }
    if (pathname === '/api/contacts/options' && method === 'GET') {
      const limit = Number(new URL(request.url()).searchParams.get('limit') ?? 30);
      await route.fulfill({ status: 200, json: { contacts: [], total: 0, limit } });
      return;
    }
    if (pathname === '/api/campaigns/recipient-summary' && method === 'GET') {
      const listIds = new URL(request.url()).searchParams.getAll('listIds');
      campaignAudienceRequests.push(listIds);
      const uniqueRecipients = listIds.reduce(
        (total, listId) => total + (lists.find(list => list.id === listId)?.contactCount ?? 0),
        0,
      );
      await route.fulfill({ status: 200, json: { uniqueRecipients, overlappingRecipients: 0 } });
      return;
    }
    if (pathname === '/api/contacts' && method === 'GET') {
      await route.fulfill({
        status: 200,
        json: {
          contacts: [],
          quota: { used: 0, limit: 100, remaining: 100, canAdd: true, requiresSubscription: false },
          uploadSettings: { maxFileSizeMb: 10, allowedFileTypes: ['csv'] },
        },
      });
      return;
    }
    if (pathname === '/api/campaigns' && method === 'GET') {
      await route.fulfill({ status: 200, json: campaigns });
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
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${baseUrl}/campaigns`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'visible' });
      await page.getByTestId('button-edit-campaign-browser-campaign-one').click();
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
});
