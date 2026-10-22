// Optional browser check. Supply PLAYWRIGHT_MODULE when Playwright is outside this project.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Your words. At your own pace.' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // This first request exercises the real SvelteKit endpoint's unavailable-model path.
  await page.getByLabel('Your message').fill('Fictional story: Mira lived in Luma.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /local model/);

  const payloads = [];
  let hold = false;
  await page.route('**/api/chat', async (route) => {
    payloads.push(route.request().postDataJSON());
    if (hold) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.fulfill({ json: { message: { role: 'assistant', content: 'What happened in the fictional town?' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Retry message' }).click();
  await page.getByText('What happened in the fictional town?', { exact: true }).waitFor();
  assert.equal(await page.getByText('Fictional story: Mira lived in Luma.', { exact: true }).count(), 1);
  await page.getByLabel('Your message').fill('Correction: the town was Neri.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.querySelectorAll('article').length === 5);
  assert.equal(payloads.at(-1).messages.length, 3);
  assert.equal(payloads.at(-1).messages[0].content, 'Fictional story: Mira lived in Luma.');

  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  assert.equal(await page.locator('article').count(), 1);
  hold = true;
  await page.getByLabel('Your message').fill('Another fictional story.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'End & clear' }).click();
  await page.getByRole('heading', { name: 'Conversation ended' }).waitFor();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('article').count(), 0);
  await page.getByRole('button', { name: 'Start a new practice' }).click();
  assert.equal(await page.locator('article').count(), 1);
  assert.deepEqual(await page.evaluate(() => ({
    local: localStorage.length, session: sessionStorage.length, cookies: document.cookie
  })), { local: 0, session: 0, cookies: '' });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.reload();
  await page.getByLabel('Your message').waitFor();
  assert.equal(await page.locator('article').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile/desktop layout, real unavailable-model error, mocked success/context/retry, restart, cancellation, refresh, empty browser storage, no browser errors.');
} finally {
  await browser.close();
}
