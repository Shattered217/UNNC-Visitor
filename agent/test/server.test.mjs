import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createHandler } from '../server.mjs';
import { beijingDate } from '../../src/visitor-model.ts';
const key = 'fixture-secret-at-least-32-characters-long';
const base = 'http://localhost:8080';
function fixture() {
  const png = readFileSync(new URL('fixtures/sample.png', import.meta.url));
  const state = { snapshot: { date: beijingDate(), captured_at: Date.now(), state: 'ready', qr: { source: 'official-page', png_base64: png.toString('base64') }, reservations: [] }, config: {}, options: {}, renewal: null };
  let refreshes = 0, proxies = 0;
  const handler = createHandler({ key, getState: () => state, refresh: () => { refreshes++; return {}; }, updateConfig: async c => c,
    mailApi: async () => { proxies++; return Response.json({ messages: [] }); }, webDir: new URL('../../web/', import.meta.url) });
  const request = (path, init = {}) => handler(new Request(base + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } }));
  return { png, state, handler, request, counts: () => ({ refreshes, proxies }) };
}
test('all private data require authentication, and only fixed paths can be read', async () => {
  const { handler, request, counts } = fixture();
  for (const path of ['/api/visitor/qr', '/api/config', '/api/messages']) assert.equal((await handler(new Request(base + path))).status, 401);
  for (const path of ['/__proto__', '/constructor', '/.secrets/app-key', '/data/browser-state.json']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/api/code', { method: 'POST' })).status, 404);
  assert.equal(counts().proxies, 0);
  for (const path of ['/api/messages/0', '/api/messages/-1', '/api/messages/not-a-number']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/api/messages/42')).status, 200);
  assert.equal(counts().proxies, 1);
});
test('padded PNG stays scannable, the original remains available, and stale QRs are refused', async () => {
  const { request, state, png } = fixture();
  const qr = await request('/api/visitor/qr'); assert.equal(qr.status, 200);
  const padded = PNG.sync.read(Buffer.from(await qr.arrayBuffer()));
  assert.equal(jsQR(new Uint8ClampedArray(padded.data), padded.width, padded.height)?.data, '0123456789');
  const original = await request('/api/visitor/qr?original=1');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png); assert.equal(qr.headers.get('Cache-Control'), 'no-store');
  state.snapshot.captured_at = Date.now() - 600001;
  assert.equal((await request('/api/visitor/qr')).status, 409);
  state.snapshot.captured_at = Date.now(); state.snapshot.date = '2000-01-01';
  assert.equal((await request('/api/visitor/qr')).status, 409);
});
test('cookie mutations require same origin while Shortcuts can use bearer authentication', async () => {
  const { handler, request, counts } = fixture();
  const login = await handler(new Request(base + '/api/session', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }));
  assert.equal(login.status, 200); const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const cross = await handler(new Request(base + '/api/visitor/refresh', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://other.example' } }));
  assert.equal(cross.status, 403); assert.equal(counts().refreshes, 0);
  assert.equal((await request('/api/visitor/refresh', { method: 'POST' })).status, 202);
  assert.equal(counts().refreshes, 1);
  const status = await handler(new Request(base + '/api/visitor/status', { headers: { Cookie: cookie } }));
  const body = await status.text(); assert.equal(status.status, 200); assert.ok(!body.includes('png_base64')); assert.ok(!body.includes(key));
});
