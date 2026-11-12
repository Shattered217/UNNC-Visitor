import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudMail } from '../mail.mjs';

const clock = Date.parse('2026-11-11T12:00:30Z');
const mailbox = 'visitor@inbox.example.com';
const password = 'fixture-mailbox-password';
const mail = overrides => ({ emailId: 42, toEmail: mailbox, sendEmail: 'visitor@nottingham.edu.cn', name: 'UNNC',
  subject: '访客系统验证码', text: '您的验证码是 123456', unread: 0, createTime: '2026-11-11 12:00:25', ...overrides });

function fixture(rows = [mail()]) {
  const calls = [];
  let rejectOnce = false;
  const client = createCloudMail({ origin: 'https://mail.example.com', mailbox, password, now: () => clock,
    request: async (url, options) => {
      calls.push({ url, ...options });
      if (url.pathname === '/api/login') {
        assert.deepEqual(JSON.parse(options.body), { email: mailbox, password });
        return Response.json({ code: 200, data: { token: 'upstream-jwt' } });
      }
      assert.equal(options.headers.Authorization, 'upstream-jwt');
      assert.equal(options.redirect, 'error');
      if (rejectOnce) { rejectOnce = false; return Response.json({ code: 401 }, { status: 401 }); }
      if (url.pathname === '/api/account/list') return Response.json({ code: 200, data: [{ email: mailbox, accountId: 7 }] });
      if (url.pathname === '/api/email/list') {
        assert.equal(url.searchParams.get('accountId'), '7');
        assert.equal(url.searchParams.get('allReceive'), '0');
        const before = Number(url.searchParams.get('emailId') || Infinity);
        const list = rows.filter(row => row.emailId < before).slice(0, Number(url.searchParams.get('size')));
        return Response.json({ code: 200, data: { list } });
      }
      return Response.json({ code: 200, data: null });
    } });
  return { client, calls, expire: () => { rejectOnce = true; } };
}

test('Cloud Mail uses mailbox login, UTC mail dates, read/delete APIs, and renews expired authentication', async () => {
  const { client, calls, expire } = fixture();
  const result = await (await client('/api/messages')).json();
  assert.equal(result.messages[0].received_at, Date.parse('2026-11-11T12:00:25Z'));
  assert.equal(result.messages[0].code, '123456');
  assert.equal(result.messages[0].is_read, 0);
  assert.ok(!JSON.stringify(result).includes(password));
  assert.equal((await (await client('/api/messages/42')).json()).body_text, '您的验证码是 123456');
  await client('/api/messages/42', 'PATCH', '{}');
  const read = calls.find(call => call.url.pathname === '/api/email/read');
  assert.equal(read.method, 'PUT');
  assert.deepEqual(JSON.parse(read.body), { emailIds: [42] });
  await client('/api/messages/42', 'DELETE', '{}');
  assert.ok(calls.some(call => call.method === 'DELETE' && call.url.searchParams.get('emailIds') === '42'));
  expire();
  assert.equal((await client('/api/messages')).status, 200);
  assert.equal(calls.filter(call => call.url.pathname === '/api/login').length, 2);
  assert.equal((await client('/api/messages/43')).status, 404);
  assert.equal((await client('/api/messages/42?other=1')).status, 404);
});

test('login codes must come from the current mailbox, school sender, current request, and have one unexpired code', async () => {
  const invalid = [
    mail({ toEmail: 'other@inbox.example.com' }),
    mail({ sendEmail: 'attacker@example.com' }),
    mail({ sendEmail: 'visitor@nottingham.edu.cn.example.com' }),
    mail({ createTime: '2026-11-11 11:49:00' }),
    mail({ createTime: '2026-11-11 12:01:00' }),
    mail({ text: '验证码 123456 或 654321' }),
    mail({ subject: 'Receipt', text: 'Order 123456' }),
  ];
  for (const row of invalid) {
    const { client } = fixture([row]);
    assert.deepEqual(await (await client('/api/code', 'POST', JSON.stringify({ after: clock - 10000 }))).json(), { status: 'waiting' });
  }
  const { client } = fixture();
  assert.deepEqual(await (await client('/api/code', 'POST', JSON.stringify({ after: clock - 10000 }))).json(), { status: 'received', code: '123456' });
  assert.deepEqual(await (await client('/api/code', 'POST', JSON.stringify({ after: clock - 1000 }))).json(), { status: 'waiting' });
  assert.deepEqual(await (await client('/api/code', 'POST', '{}')).json(), { status: 'waiting' });
});

test('Cloud Mail errors never expose credentials and authentication retries once', async () => {
  const client = createCloudMail({ origin: 'https://mail.example.com', mailbox, password,
    request: async () => { throw new Error(`connection failed: ${password}`); } });
  await assert.rejects(client('/api/messages'), { message: 'network_error' });
  let attempts = 0;
  const expired = createCloudMail({ origin: 'https://mail.example.com', mailbox, password,
    request: async url => {
      attempts++;
      return Response.json(url.pathname === '/api/login' ? { code: 200, data: { token: 'jwt' } } : { code: 401 });
    } });
  await assert.rejects(expired('/api/messages'), { message: 'network_error' });
  assert.equal(attempts, 4);
});
