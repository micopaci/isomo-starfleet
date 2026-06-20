const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err.message || err));

  console.log('Navigating to http://localhost:5173/login...');
  await page.goto('http://localhost:5173/login');
  
  // Wait for login panel
  await page.waitForSelector('input[type="email"]');
  
  // Fill login form
  console.log('Logging in...');
  await page.fill('input[type="email"]', 'admin@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button[type="submit"]');

  // Wait for redirection
  console.log('Waiting for overview page...');
  await page.waitForURL('**/overview');
  
  // Sleep a little bit for transitions and data loading
  await page.waitForTimeout(2000);

  const artifactsDir = '/Users/an0n/.gemini/antigravity/brain/d0772f4c-1a2b-46c5-8cda-25b0823f4758';
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // 1. Overview Page
  console.log('Capturing Overview Page...');
  await page.screenshot({ path: path.join(artifactsDir, 'overview_real_data.png') });

  // 2. Computers Page
  console.log('Navigating to Computers Page...');
  await page.goto('http://localhost:5173/computers');
  await page.waitForTimeout(2000);
  console.log('Capturing Computers Page...');
  await page.screenshot({ path: path.join(artifactsDir, 'computers_real_data.png') });

  // 3. Alerts Page
  console.log('Navigating to Alerts Page...');
  await page.goto('http://localhost:5173/alerts');
  await page.waitForTimeout(2000);
  console.log('Capturing Alerts Page...');
  await page.screenshot({ path: path.join(artifactsDir, 'alerts_real_data.png') });

  // 4. Inventory Page
  console.log('Navigating to Inventory Page...');
  await page.goto('http://localhost:5173/inventory');
  await page.waitForTimeout(2000);
  console.log('Capturing Inventory Page...');
  await page.screenshot({ path: path.join(artifactsDir, 'inventory_real_data.png') });

  await browser.close();
  console.log('Screenshots generated successfully!');
}

run().catch(err => {
  console.error('Error taking screenshots:', err);
  process.exit(1);
});
