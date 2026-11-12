import { chromium } from 'playwright';
import { createDecipheriv } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { beijingDate, schoolDate, recordStatus, usableToday } from '../src/visitor-model.ts';
import { officialPng } from './qr.mjs';

const SCHOOL = 'https://visitor.nottingham.edu.cn';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUBMIT = /^\/transpond\/submitReg(?:Ex)?\/$/;
export const isSubmission = url => url.origin === SCHOOL && SUBMIT.test(url.pathname);

// The page provides this public encryption key. Requests remain signed by its own client.
export function decodeResponse(text, publicKey) {
  let value = text;
  for (let i = 0; i < 6; i++) {
    if (typeof value !== 'string') return value;
    try { value = JSON.parse(value); continue; } catch { /* encrypted response */ }
    if (!/^[0-9a-f]+$/i.test(value) || value.length % 32) throw new Error('school_error');
    const decipher = createDecipheriv('aes-128-ecb', Buffer.from([...publicKey].reverse().join('')), null);
    value = Buffer.concat([decipher.update(Buffer.from(value, 'hex')), decipher.final()]).toString('utf8');
  }
  throw new Error('school_error');
}

export class SchoolClient {
  constructor({ dataDir, mailbox, api, proxy }) { Object.assign(this, { dataDir, mailbox, api, proxy }); }
  async start() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.SCHOOL_EXECUTABLE_PATH ? { executablePath: process.env.SCHOOL_EXECUTABLE_PATH } : {}), ...(this.proxy ? { proxy: { server: this.proxy } } : {}) });
    let storageState;
    try { storageState = JSON.parse(await readFile(`${this.dataDir}/browser-state.json`, 'utf8')); } catch { /* first login */ }
    this.context = await this.browser.newContext({ storageState, viewport: { width: 1400, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    this.context.setDefaultTimeout(25000);
    this.context.setDefaultNavigationTimeout(30000);
    await this.context.addInitScript(() => {
      if (location.hostname !== 'visitor.nottingham.edu.cn') return;
      localStorage.setItem('lastPageSize', '100');
      globalThis.__unncForm = () => {
        const seen = new Set();
        for (const el of document.querySelectorAll('*')) for (let vm = el.__vue__; vm && !seen.has(vm); vm = vm.$parent) {
          seen.add(vm); if (vm.regForm) return vm;
        }
        throw new Error('booking_validation');
      };
    });
  }
  async close() { await this.browser?.close(); }
  async readResponse(response, page, allowError = false) {
    const data = decodeResponse(await response.text(), await page.evaluate(() => globalThis.g_ac));
    if (!data || !allowError && data.error !== 0) throw new Error('school_error');
    return data;
  }
  async actionResponse(page, path, action) {
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === path), action()]);
    return this.readResponse(response, page);
  }
  async login(page) {
    await page.getByRole('button', { name: /我是访客|^Visitor$/ }).click();
    await page.locator('.aui-form-header-item').filter({ hasText: /使用邮箱|Email/ }).click();
    await page.locator('input:visible').first().fill(this.mailbox);
    const after = Date.now();
    await this.actionResponse(page, '/transpond/otp_send/', () => page.getByRole('button', { name: /获取验证码|Get.*(?:OTP|code)|Send.*code/i }).click());
    let code;
    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      const result = await this.api('/api/code', { after });
      if (result.status === 'received' && /^\d{6}$/.test(result.code)) { code = result.code; break; }
    }
    if (!code) throw new Error('mail_timeout');
    await page.locator('input:visible').last().fill(code);
    await Promise.all([
      page.waitForURL(url => !url.pathname.startsWith('/login/')),
      page.getByRole('button', { name: /注册\s*\/\s*登录|Register\s*\/\s*Login|Register\s*\/\s*Sign/i }).click(),
    ]);
  }
  async open() {
    if (!this.browser?.isConnected()) await this.start();
    const page = await this.context.newPage();
    let profilePromise;
    page.on('response', r => {
      if (new URL(r.url()).pathname === '/api/getUserbyToken/') profilePromise = this.readResponse(r, page).catch(() => null);
    });
    // Read-only pages cannot accidentally register a visit.
    await page.route(isSubmission, route => route.abort());
    try {
      await page.goto(`${SCHOOL}/client/`, { waitUntil: 'networkidle' });
      if (new URL(page.url()).pathname.startsWith('/login/')) await this.login(page);
      await page.waitForFunction(() => document.querySelector('#agreed-btn') || document.querySelector('a[href="#/record/list"]'));
      if (await page.locator('#agreed-btn').count()) {
        await page.locator('#cbCheckbox1').check(); await page.locator('#cbCheckbox2').check();
        await page.waitForFunction(() => !document.querySelector('#agreed-btn')?.classList.contains('disabled'), null, { timeout: 22000 });
        await page.locator('#agreed-btn').click();
      }
      await page.waitForSelector('a[href="#/record/list"]', { state: 'attached' });
      await page.waitForFunction(() => { try { return Boolean(globalThis.__unncForm()); } catch { return false; } });
      await page.evaluate(async () => { const vm = __unncForm(); await vm.$store.dispatch('setLanguage', 'cn'); vm.$i18n.locale = 'cn'; await vm.$nextTick(); });
      const form = await page.evaluate(() => {
        const vm = __unncForm(), c = vm.py_config;
        return { options: { gates: vm.branchList.map(g => ({ code: String(g.code), label: g.cn || g.en })),
          purposes: vm.purposeList.map(p => ({ value: p.cn, label: p.cn, en: p.en, required: Boolean(p.required), extraInfo: p.extraInfo || '' })) },
          limits: { maxSpanDays: Number(c.max_multipleDate), maxAdvanceDays: Number(c.max_Vdate), banToday: Boolean(c.banToday), banWeek: c.banWeek || [], banDates: c.banDates || [] } };
      });
      const profile = await profilePromise;
      if (!profile?.VVID || !Number.isInteger(form.limits.maxSpanDays) || !Number.isInteger(form.limits.maxAdvanceDays)) throw new Error('school_error');
      return { page, profile, ...form };
    } catch (error) { await page.close(); throw error; }
  }
  async records(page, profile) {
    const data = await this.actionResponse(page, '/transpond/rquery/', () => page.locator('a[href="#/record/list"]').evaluate(link => link.click()));
    if (!Array.isArray(data.reg) || !Number.isInteger(data.totalcount)) throw new Error('school_error');
    let records = data.reg;
    for (let p = 0; records.length < data.totalcount && p < 9; p++) {
      const more = await this.actionResponse(page, '/transpond/rquery/', () => page.locator('.el-pagination .btn-next').click());
      if (!more.reg?.length) break;
      records = records.concat(more.reg);
    }
    if (records.length < data.totalcount) throw new Error('school_error');
    return records.filter(r => String(r.VVID) === String(profile.VVID));
  }
  async snapshot() {
    const { page, profile, options, limits } = await this.open();
    try {
      const raw = await this.records(page, profile);
      const today = beijingDate();
      let template = raw.filter(r => r.approved === 0 && schoolDate(r.Vdate)).sort((a, b) => Number(b.Vdate) - Number(a.Vdate))[0];
      if (template) {
        const detail = await this.actionResponse(page, '/transpond/rquery/', () => page.evaluate(record => {
          const seen = new Set();
          for (const el of document.querySelectorAll('*')) for (let vm = el.__vue__; vm && !seen.has(vm); vm = vm.$parent) {
            seen.add(vm);
            if (vm.$options.name === 'RecordsTable' && vm.showDetails) { vm.showDetails(null, record); return; }
          }
          throw new Error('school_error');
        }, template));
        template = detail.reg?.find(r => String(r.VVID) === String(profile.VVID) && r.regcode === template.regcode) || template;
      }
      const canonical = r => options.purposes.find(p => [p.value, p.en].includes(String(r.Vpurpose)))?.value || String(r.Vpurpose || '');
      const records = raw.map(r => ({ ...r, Vpurpose: canonical(r), Eemail: r.Eemail || (String(r.EHID) === String(template?.EHID) ? template?.Eemail : '') }));
      this.metadata = { records, options, limits, suggestion: template?.Eemail ? { gate: String(template.Vbranch), purpose: canonical(template), hostEmail: template.Eemail, driving: false, plate: '' } : null };
      const reservations = records.filter(r => schoolDate(r.Vdate) >= today).map(r => ({ date: schoolDate(r.Vdate), gate: options.gates.find(g => g.code === String(r.Vbranch))?.label || String(r.Vbranch || ''), purpose: canonical(r), status: recordStatus(r, today) })).slice(0, 100);
      const record = raw.find(r => usableToday(r, profile.VVID));
      const state = { date: today, captured_at: Date.now(), state: 'no_reservation', reservations, qr: null };
      if (record) {
        await page.goto(`${SCHOOL}/innerlink/v/${record.regcode}/`, { waitUntil: 'networkidle' });
        if (new URL(page.url()).origin !== SCHOOL || !/^\/v\/[a-f0-9]+\/$/.test(new URL(page.url()).pathname)) throw new Error('qr_unavailable');
        const img = page.locator('.qrcode img[src^="data:image/png;base64,"]:visible').first(); await img.waitFor();
        state.qr = { source: 'official-page', png_base64: officialPng(await img.getAttribute('src'), record.regcode) };
        state.state = 'ready'; state.captured_at = Date.now();
      }
      if (state.date !== beijingDate()) throw new Error('school_error');
      await this.context.storageState({ path: `${this.dataDir}/browser-state.json` });
      await chmod(`${this.dataDir}/browser-state.json`, 0o600);
      return state;
    } finally { await page.close(); }
  }
  async book(plan, config, { beforeSubmit = async () => {}, dryRun = false } = {}) {
    const { page, profile } = await this.open();
    let sent = false;
    try {
      // Recheck fresh school records, including pending applications, immediately before filling.
      const records = await this.records(page, profile);
      await page.locator('a[href="#/registration/add"]').evaluate(link => link.click());
      await page.waitForFunction(() => { try { return Boolean(__unncForm()); } catch { return false; } });
      const hostId = await page.evaluate(async ({ config, plan }) => {
        const vm = __unncForm(); const host = vm.$refs.regisHostInfo;
        vm.regForm.Vbranch = config.gate; vm.onChangeSelBranch(config.gate); await vm.$nextTick();
        const purpose = vm.purposeList.find(p => [p.cn, p.en, p.label].includes(config.purpose));
        if (!purpose) throw new Error('booking_validation');
        vm.regForm.Vpurpose = purpose; vm.onVpurposeChange(purpose); vm.regForm.otherPurpose = config.purposeExtra || '';
        vm.regForm.startDate = plan.start.replaceAll('-', ''); vm.startdatesel();
        vm.regForm.endDate = plan.end.replaceAll('-', ''); vm.enddatesel();
        if (vm.regForm.startDate !== plan.start.replaceAll('-', '') || vm.regForm.endDate !== plan.end.replaceAll('-', '')) throw new Error('booking_validation');
        const start = new Date(`${plan.start}T12:00:00+08:00`), end = new Date(`${plan.end}T12:00:00+08:00`);
        if (vm.pickerOptions.disabledDate(start) || vm.pickerEndOptions.disabledDate(end)) throw new Error('booking_validation');
        host.handleCommandHost('input_email'); host.host_info.Eemail = config.hostEmail.split('@')[0]; host.onEmailChange();
        const found = await host.check_EHID(); if (!found.EHID) throw new Error('booking_validation');
        vm.VMyVisitingInfo.bDrive = config.driving; vm.VMyVisitingInfo.Vplate = config.plate;
        vm.selVisitorDrive[profileId(vm)] = config.driving;
        await vm.$nextTick();
        const valid = await new Promise(resolve => vm.$refs.regForm.validate(resolve));
        if (!valid) throw new Error('booking_validation');
        return String(found.EHID);
        function profileId(v) { return v.userInfo.VVID; }
      }, { config, plan });
      const same = records.filter(r => String(r.EHID) === hostId && String(r.Vbranch) === config.gate &&
        this.metadata.options.purposes.some(p => p.value === config.purpose && [p.value, p.en].includes(String(r.Vpurpose))));
      const covered = new Set(same.filter(r => r.approved === 0).map(r => schoolDate(r.Vdate)));
      if (!dryRun && (same.some(r => [2, 100].includes(r.approved) && schoolDate(r.Vdate) >= beijingDate()) || covered.has(plan.end))) return { accepted: true, skipped: true };
      await page.unroute(isSubmission);
      let settle;
      const outcome = new Promise(resolve => { settle = resolve; });
      const publicKey = await page.evaluate(() => globalThis.g_ac);
      // The normal school form builds, signs, and validates this request. Dry runs abort at the network boundary.
      await page.route(isSubmission, async route => {
        if (sent || !SUBMIT.test(new URL(route.request().url()).pathname) || route.request().method() !== 'POST') return route.abort();
        sent = true;
        try {
          const payload = decodeResponse(route.request().postData(), publicKey);
          if (String(payload.EHID) !== hostId || String(payload.Vbranch) !== config.gate || payload.Visitors?.length !== 1 || String(payload.Visitors[0].VVID) !== String(profile.VVID)
            || payload.StartDate !== plan.start || payload.EndDate !== plan.end || ![config.purpose, this.metadata.options.purposes.find(p => p.value === config.purpose)?.en].includes(payload.Vpurpose)) throw new Error();
        } catch { await route.abort(); settle({ error: 'booking_validation' }); return; }
        if (dryRun) { await route.abort(); settle({ accepted: false, dryRun: true, validated: true }); return; }
        try { await beforeSubmit(); await route.continue(); } catch { await route.abort(); settle({ error: 'booking_unknown' }); }
      });
      if (dryRun) {
        // Defense in depth: every other write request is blocked during a dry run.
        await page.route(url => url.origin === SCHOOL && !isSubmission(url), route =>
          ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
      }
      page.on('response', async response => {
        if (!SUBMIT.test(new URL(response.url()).pathname)) return;
        try {
          const data = await this.readResponse(response, page, true);
          const results = data.results;
          if (!Array.isArray(results) || !results.length) return settle({ error: 'booking_unknown' });
          const accepted = results.every(r => r.error === 0 && r.regcode);
          // Partial success must never be blindly retried.
          if (!accepted && results.some(r => r.error === 0)) return settle({ error: 'booking_unknown' });
          settle({ accepted });
        } catch { settle({ error: 'booking_unknown' }); }
      });
      await page.evaluate(() => { void __unncForm().submitRegis('regForm'); });
      const result = await Promise.race([outcome, sleep(30000).then(() => ({ error: sent ? 'booking_unknown' : 'booking_validation' }))]);
      if (result.error) throw new Error(result.error);
      return result;
    } finally { await page.close(); }
  }
}
