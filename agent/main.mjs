import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { SchoolClient } from './school.mjs';
import { createHandler } from './server.mjs';
import { defaultConfig, renewalPlan, matchingRecords } from '../src/renewal.ts';
import { beijingDate, schoolDate, validateSnapshot } from '../src/visitor-model.ts';
import { createTelegramSender, notifyApprovedRenewal, renewalDates } from './telegram.mjs';
import { createCloudMail } from './mail.mjs';

const dataDir = process.env.DATA_DIR || '/data';
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const readKey = async path => { const key = (await readFile(path, 'utf8')).trim(); if (key.length < 32) throw new Error('Access key is not configured'); return key; };
const mailPassword = (await readFile(process.env.MAILBOX_PASSWORD_FILE || '/run/secrets/mailbox_password', 'utf8')).trim();
if (mailPassword.length < 6) throw new Error('Cloud Mail password is not configured');
const appKey = await readKey(process.env.ACCESS_KEY_FILE || '/run/secrets/app_key');
const telegram = createTelegramSender({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
const mailbox = process.env.MAILBOX_ADDRESS;
if (!mailbox || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) throw new Error('MAILBOX_ADDRESS is not configured');
const syncSeconds = Number(process.env.SYNC_SECONDS || 300);
if (!Number.isFinite(syncSeconds) || syncSeconds < 60 || syncSeconds > 3600) throw new Error('SYNC_SECONDS must be between 60 and 3600');
const calendars = {};
for (const year of [2025, 2026, 2027]) calendars[year] = JSON.parse(await readFile(new URL(`../calendar/${year}.json`, import.meta.url), 'utf8'));
const load = async name => { try { return JSON.parse(await readFile(`${dataDir}/${name}.json`, 'utf8')); } catch { return null; } };
const save = async (name, value) => { const path = `${dataDir}/${name}.json`; await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(`${path}.tmp`, path); };
const state = { snapshot: validateSnapshot(await load('snapshot')), config: { ...defaultConfig, ...await load('config') }, options: { gates: [], purposes: [] }, limits: null, renewal: null, job: null, error: null };
let ledger = await load('renewal-ledger');
let stopping = false;

const mailApi = createCloudMail({ origin: process.env.MAIL_API_URL, mailbox, password: mailPassword });
const school = new SchoolClient({ dataDir, mailbox, proxy: process.env.SCHOOL_PROXY,
  api: async (path, body) => { const r = await mailApi(path, 'POST', JSON.stringify(body)); if (!r.ok) throw new Error('network_error'); return r.json(); } });

async function updateConfig(input) {
  if (Object.keys(input).some(key => !Object.hasOwn(defaultConfig, key))) throw new Error('invalid_config');
  const config = { ...state.config, ...input };
  if (typeof config.enabled !== 'boolean' || !['china', 'weekdays'].includes(config.calendar) || !['max_span', 'after_expiry'].includes(config.dateMode)
    || !Number.isInteger(config.leadWorkdays) || config.leadWorkdays < 1 || config.leadWorkdays > 10 || !Number.isInteger(config.hour) || config.hour < 0 || config.hour > 23
    || typeof config.hostEmail !== 'string' || !/^[^\s@]+@nottingham\.edu\.cn$/i.test(config.hostEmail)
    || !state.options.gates.some(g => g.code === config.gate) || !state.options.purposes.some(p => p.value === config.purpose)
    || typeof config.purposeExtra !== 'string' || config.purposeExtra.length > 300 || state.options.purposes.find(p => p.value === config.purpose)?.required && !config.purposeExtra.trim()
    || typeof config.driving !== 'boolean' || typeof config.plate !== 'string' || config.plate.length > 20 || config.driving && !config.plate.trim()) throw new Error('invalid_config');
  state.config = config;
  await save('config', config);
  if (school.metadata) state.renewal = renewalPlan(school.metadata.records, config, state.limits, calendars);
  return config;
}

function refresh() {
  if (state.job?.status === 'running') return state.job;
  state.job = { id: crypto.randomUUID(), status: 'running', created_at: Date.now() };
  const job = state.job;
  (async () => {
    try {
      state.snapshot = await school.snapshot();
      await save('snapshot', state.snapshot);
      state.options = school.metadata.options;
      state.limits = school.metadata.limits;
      if (!state.config.hostEmail && school.metadata.suggestion) { state.config = { ...state.config, ...school.metadata.suggestion }; await save('config', state.config); }
      state.renewal = renewalPlan(school.metadata.records, state.config, state.limits, calendars);
      if (ledger?.status === 'unknown' && matchingRecords(school.metadata.records, ledger.booking || state.config).some(r => [0, 2, 100].includes(r.approved) && schoolDate(r.Vdate) === ledger.end)) {
        ledger.status = 'submitted'; await save('renewal-ledger', ledger);
      }
      try {
        ledger = await notifyApprovedRenewal({ ledger, records: school.metadata.records, config: state.config, limits: state.limits,
          send: telegram, save: value => save('renewal-ledger', value) });
      } catch {
        // A notification failure must never retry the school booking or invalidate its QR.
        console.log(JSON.stringify({ event: 'telegram_failed', at: new Date().toISOString() }));
      }
      if (state.renewal.state === 'ready') {
        if (ledger?.status === 'unknown' || ledger?.attemptDate === beijingDate()) state.renewal.state = 'review_required';
        else {
          const plan = { ...state.renewal };
          const intent = async () => {
            ledger = { attemptDate: beijingDate(), start: plan.start, end: plan.end, status: 'unknown',
              dates: renewalDates(plan, state.limits), booking: { gate: state.config.gate, purpose: state.config.purpose, hostEmail: state.config.hostEmail } };
            await save('renewal-ledger', ledger);
          };
          const result = await school.book(plan, state.config, { beforeSubmit: intent });
          if (result.skipped) state.renewal.state = 'pending_approval';
          else {
            ledger = { ...ledger, status: result.accepted ? 'submitted' : 'rejected' };
            await save('renewal-ledger', ledger);
            state.renewal.state = result.accepted ? 'submitted' : 'rejected';
          }
        }
      }
      state.error = null; job.status = 'succeeded';
      console.log(JSON.stringify({ event: 'sync_finished', state: state.snapshot.state, renewal: state.renewal.state, at: new Date().toISOString() }));
    } catch (error) {
      const known = ['school_error', 'qr_unavailable', 'mail_timeout', 'network_error', 'login_error', 'booking_validation', 'booking_unknown'];
      state.error = known.includes(error.message) ? error.message : 'unexpected_error';
      job.status = 'failed'; job.error = state.error;
      console.log(JSON.stringify({ event: 'sync_failed', error: state.error, at: new Date().toISOString() }));
    } finally { job.finished_at = Date.now(); }
  })();
  return job;
}

const handler = createHandler({ key: appKey, getState: () => state, refresh, updateConfig, mailApi, webDir: new URL('../web/', import.meta.url) });
const server = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(new URL(incoming.url, `http://${incoming.headers.host || 'localhost'}`), { method: incoming.method, headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
  } catch { if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end('{"error":"暂时无法处理请求"}'); }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
await school.start();
server.listen(8080, '0.0.0.0', () => { console.log(JSON.stringify({ event: 'server_started', port: 8080 })); refresh(); });
const timer = setInterval(() => { if (!stopping) refresh(); }, syncSeconds * 1000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { stopping = true; clearInterval(timer); server.close(); await school.close(); });
