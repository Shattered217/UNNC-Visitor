import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { isSubmission } from '../school.mjs';

test('a real browser intercepts signed school submissions before any network access', { skip: !process.env.RUN_BROWSER_TESTS }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let escaped = 0, blocked = 0;
    await context.route('**/*', async route => { escaped++; await route.abort(); });
    await page.route(isSubmission, async route => { blocked++; await route.abort(); });
    for (const path of ['/transpond/submitReg/', '/transpond/submitRegEx/']) {
      await page.evaluate(async path => {
        try { await fetch('https://visitor.nottingham.edu.cn' + path + '?timestamp=123&sign=fixture', { method: 'POST', mode: 'no-cors', body: 'fixture' }); } catch { /* expected abort */ }
      }, path);
    }
    assert.equal(blocked, 2); assert.equal(escaped, 0);
  } finally { await browser.close(); }
});

test('fresh login handles whitespace in the official English email tab and Get code button', { skip: !process.env.RUN_BROWSER_TESTS }, async () => {
  const { SchoolClient } = await import('../school.mjs');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : {}) });
  let requested = false;
  try {
    const page = await browser.newPage();
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/transpond/otp_send/') { requested = true; return route.fulfill({ contentType: 'application/json', body: '{"error":0}' }); }
      await route.fulfill({ contentType: 'text/html', body: path === '/login/' ? `<button onclick="document.querySelector('.aui-form-header-item').hidden=false">Visitor</button><div class="aui-form-header-item" hidden onclick="document.querySelector('form').hidden=false">\n    Email\n  </div><form hidden onsubmit="event.preventDefault();location.href='/notice/v/'"><input name="email"><input name="otp"><button type="button" onclick="fetch('/transpond/otp_send/?timestamp=123&sign=fixture',{method:'POST'})">Get code Get code</button><button>Register / Login</button></form><script>window.g_ac='0123456789abcdef'</script>` : 'done' });
    });
    await page.goto('https://visitor.nottingham.edu.cn/login/');
    let claimed = 0;
    const client = new SchoolClient({ mailbox: 'fixture@example.com', api: async (_path, { after }) => { assert.ok(requested); assert.ok(after <= Date.now()); claimed++; return { status: 'received', code: '012345' }; } });
    await client.login(page);
    assert.equal(new URL(page.url()).pathname, '/notice/v/'); assert.equal(claimed, 1);
  } finally { await browser.close(); }
});
