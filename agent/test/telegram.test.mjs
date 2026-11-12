import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedRenewal, createTelegramSender, notifyApprovedRenewal, renewalDates } from '../telegram.mjs';

const config = { gate: 'fixture-gate', purpose: 'fixture-purpose', hostEmail: 'fixture@nottingham.edu.cn' };
const limits = { banWeek: [], banDates: [] };
const ledger = { attemptDate: '2026-11-11', start: '2026-11-11', end: '2026-11-13', status: 'submitted', booking: config,
  dates: ['2026-11-11', '2026-11-12', '2026-11-13'] };
const records = ledger.dates.map(date => ({ Vdate: Number(date.replaceAll('-', '')), approved: 0,
  Vbranch: config.gate, Vpurpose: config.purpose, Eemail: config.hostEmail }));

test('renewal success requires every intended date approved for the original booking', () => {
  assert.equal(approvedRenewal(ledger, records, config, limits), true);
  assert.equal(approvedRenewal(ledger, records.slice(1), config, limits), false);
  for (const approved of [2, 100, -1]) {
    assert.equal(approvedRenewal(ledger, [{ ...records[0], approved }, ...records.slice(1)], config, limits), false);
  }
  assert.equal(approvedRenewal(ledger, records.map(r => ({ ...r, Eemail: 'other@nottingham.edu.cn' })), config, limits), false);
  assert.equal(approvedRenewal(ledger, records, { ...config, gate: 'changed' }, limits), true);
  assert.equal(approvedRenewal({ ...ledger, status: 'unknown' }, records, config, limits), false);
  assert.equal(approvedRenewal({ ...ledger, status: 'rejected' }, records, config, limits), false);
  assert.deepEqual(renewalDates(ledger, { banWeek: [4], banDates: ['2026-11-13'] }), ['2026-11-11']);
});

test('success is notified once after approval and stays deduplicated after restart', async () => {
  const messages = [], saved = [];
  const args = { ledger, records, config, limits, send: async text => messages.push(text), save: async value => saved.push(value), now: 12345 };
  const next = await notifyApprovedRenewal(args);
  assert.equal(messages.length, 1); assert.equal(saved.length, 1);
  assert.match(messages[0], /学校已批准预约：2026-11-11 至 2026-11-13/);
  assert.ok(!messages[0].includes(config.hostEmail));
  const restarted = JSON.parse(JSON.stringify(next));
  assert.equal(await notifyApprovedRenewal({ ...args, ledger: restarted }), restarted);
  assert.equal(messages.length, 1); assert.equal(next.telegramNotifiedAt, 12345);
  assert.equal(ledger.telegramNotifiedAt, undefined);
});

test('pending approvals and disabled Telegram do not send or change the booking ledger', async () => {
  const unexpected = async () => assert.fail('must not send or save');
  const args = { ledger, records: records.slice(1), config, limits, send: unexpected, save: unexpected };
  assert.equal(await notifyApprovedRenewal(args), ledger);
  assert.equal(await notifyApprovedRenewal({ ...args, records, send: null }), ledger);
});

test('a failed send stays pending and retries without submitting a school booking', async () => {
  let saved = 0, attempts = 0;
  const args = { ledger, records, config, limits, save: async () => { saved++; }, send: async () => {
    attempts++; if (attempts === 1) throw new Error('telegram_unavailable');
  } };
  await assert.rejects(notifyApprovedRenewal(args), /telegram_unavailable/);
  assert.equal(saved, 0); assert.equal(ledger.telegramNotifiedAt, undefined);
  const result = await notifyApprovedRenewal(args);
  assert.equal(attempts, 2); assert.equal(saved, 1); assert.ok(result.telegramNotifiedAt);
});

test('Telegram is optional and requires both token and chat ID when enabled', () => {
  const token = '123456789:' + 'a'.repeat(35), chatId = '-100123456789';
  assert.equal(createTelegramSender(), null);
  assert.equal(createTelegramSender({ token: '', chatId: '' }), null);
  assert.equal(createTelegramSender({ token: '  ', chatId: '  ' }), null);
  assert.throws(() => createTelegramSender({ token }), /telegram_config_invalid/);
  assert.throws(() => createTelegramSender({ chatId }), /telegram_config_invalid/);
  assert.equal(typeof createTelegramSender({ token, chatId }), 'function');
});

test('Telegram checks API acknowledgement and never exposes request errors or bot tokens', async () => {
  const token = '123456789:' + 'a'.repeat(35), chatId = '123456789';
  const sender = createTelegramSender({ token, chatId, request: async (url, init) => {
    assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { chat_id: chatId, text: 'fixture notification', link_preview_options: { is_disabled: true } });
    return Response.json({ ok: true });
  } });
  await sender('fixture notification');
  for (const request of [async () => Response.json({ ok: false }), async () => Response.json({}, { status: 403 }),
    async () => { throw new Error(`request failed https://api.telegram.org/bot${token}/sendMessage`); }]) {
    await assert.rejects(createTelegramSender({ token, chatId, request })('fixture'), error => error.message === 'telegram_unavailable');
  }
  assert.throws(() => createTelegramSender({ token: 'invalid', chatId }), /telegram_config_invalid/);
});
