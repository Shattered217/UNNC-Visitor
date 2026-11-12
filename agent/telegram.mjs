import { matchingRecords, shiftDate } from '../src/renewal.ts';
import { schoolDate } from '../src/visitor-model.ts';

export function renewalDates(plan, limits) {
  const dates = [];
  for (let date = plan.start; date && date <= plan.end; date = shiftDate(date, 1)) {
    if (dates.length > 366) throw new Error('invalid_renewal_dates');
    if (!limits.banWeek.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !limits.banDates.includes(date)) dates.push(date);
  }
  return dates;
}

export function approvedRenewal(ledger, records, config, limits) {
  if (ledger?.status !== 'submitted' || ledger.telegramNotifiedAt || !ledger.start || !ledger.end) return false;
  const dates = ledger.dates || renewalDates(ledger, limits);
  if (!dates.length) return false;
  const approved = new Set(matchingRecords(records, ledger.booking || config)
    .filter(record => record.approved === 0).map(record => schoolDate(record.Vdate)));
  return dates.every(date => approved.has(date));
}

export function createTelegramSender({ token = '', chatId = '', request = fetch } = {}) {
  token = token.trim(); chatId = chatId.trim();
  if (!token && !chatId) return null;
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token) || !/^-?\d{1,20}$/.test(chatId || '')) throw new Error('telegram_config_invalid');
  return async text => {
    try {
      const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      });
      if (!response.ok || (await response.json()).ok !== true) throw new Error();
    } catch { throw new Error('telegram_unavailable'); }
  };
}

export async function notifyApprovedRenewal({ ledger, records, config, limits, send, save, now = Date.now() }) {
  if (!send || !approvedRenewal(ledger, records, config, limits)) return ledger;
  await send(`✅ UNNC 续约成功\n学校已批准预约：${ledger.start} 至 ${ledger.end}\n门禁二维码请通过「UNNC 门禁码」获取。`);
  const notified = { ...ledger, telegramNotifiedAt: now };
  await save(notified);
  return notified;
}
