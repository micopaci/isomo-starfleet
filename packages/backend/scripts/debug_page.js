const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err.message || err));

  console.log('1. Navigating to login...');
  await page.goto('http://localhost:5173/login');
  
  await page.waitForSelector('input[type="email"]');
  console.log('2. Filling form...');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');

  console.log('3. Waiting for redirection to overview...');
  try {
    await page.waitForURL('**/overview', { timeout: 15000 });
    console.log('Redirection successful! Current URL:', page.url());
  } catch (err) {
    console.log('Redirection failed or timed out. Current URL:', page.url());
    const body = await page.textContent('body');
    console.log('Body Text:', body.substring(0, 500));
    await browser.close();
    return;
  }

  console.log('4. Waiting 3 seconds for data to load...');
  await page.waitForTimeout(3000);

  const title = await page.textContent('h1');
  console.log('Page Title (h1):', title);

  const bodyText = await page.textContent('body');
  console.log('Body Text Snippet:', bodyText.substring(0, 800));

  const kpis = await page.$$eval('.kpi-card, .stat-card', cards => cards.map(c => c.textContent));
  console.log('KPI Cards found:', kpis);

  await browser.close();
}

run().catch(console.error);
