// Verify the Admin -> Background jobs panel end-to-end against a running
// instance: logs in as an admin, opens /admin, reads back each job row
// (name / enabled / status line) and screenshots the section.
//
// Requires Playwright (not a project dependency). Run it from a checkout that
// has playwright available, e.g. the shared browser tool dir:
//   EV2_ADMIN_EMAIL=admin@example.com \
//   EV2_ADMIN_PASSWORD=secret \
//   node /path/to/elite-v2/scripts/verify-jobs-panel.mjs
//
// Config via environment:
//   EV2_BASE_URL       base URL (default https://elitev2.mecloud.win)
//   EV2_ADMIN_EMAIL    admin login email (required)
//   EV2_ADMIN_PASSWORD admin login password (required)
//   SHOT_PATH          screenshot output path (default ./ev2-jobs-panel.png)
import { chromium } from 'playwright';

const BASE = process.env.EV2_BASE_URL ?? 'https://elitev2.mecloud.win';
const EMAIL = process.env.EV2_ADMIN_EMAIL;
const PASSWORD = process.env.EV2_ADMIN_PASSWORD;
const SHOT = process.env.SHOT_PATH ?? './ev2-jobs-panel.png';

if (!EMAIL || !PASSWORD) {
  console.error('Set EV2_ADMIN_EMAIL and EV2_ADMIN_PASSWORD.');
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 }, ignoreHTTPSErrors: true });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForTimeout(1800);

await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
// Wait for the JobsManager to fetch + render its rows.
await page.waitForFunction(() =>
  [...document.querySelectorAll('h2')].some((e) => e.textContent.trim().startsWith('Background jobs')) &&
  document.querySelectorAll('button[role=switch]').length > 0,
  { timeout: 15000 }
).catch(() => {});
await page.waitForTimeout(1200);

const data = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((e) =>
    e.textContent.trim().startsWith('Background jobs'));
  if (!h) return { error: 'Background jobs heading not found' };
  const section = h.closest('section');
  const switches = [...section.querySelectorAll('button[role=switch]')];
  const cards = switches.map((sw) => {
    const card = sw.closest('.rounded-2xl');
    const name = card.querySelector('p.font-medium')?.textContent?.trim();
    const enabled = sw.getAttribute('aria-checked') === 'true';
    const statusLine = card.querySelector('p.text-xs')?.textContent?.replace(/\s+/g, ' ').trim();
    return { name, enabled, statusLine };
  });
  return { total: cards.length, enabled: cards.filter((c) => c.enabled).length, cards };
});

console.log(JSON.stringify(data, null, 2));

const section = await page.locator('section', { has: page.locator('h2', { hasText: 'Background jobs' }) }).first();
await section.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(300);
await section.screenshot({ path: SHOT }).catch(async () => {
  await page.screenshot({ path: SHOT, fullPage: true });
});
console.log('SHOT:', SHOT);

await browser.close();
