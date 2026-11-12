const CODE_TTL = 10 * 60 * 1000;
const schoolSender = address => /^[^@\s]+@(?:[a-z0-9-]+\.)*nottingham\.edu\.cn$/i.test(address || '');

function textOf(mail) {
  return mail.text || (mail.content || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function normalize(mail, now) {
  // Cloud Mail stores UTC timestamps without a timezone suffix.
  const received = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(mail.createTime) ? mail.createTime : `${mail.createTime.replace(' ', 'T')}Z`);
  const text = textOf(mail);
  const codes = [...new Set(`${mail.subject || ''}\n${text}`.match(/(?<!\d)\d{6}(?!\d)/g) || [])];
  const code = schoolSender(mail.sendEmail) && /验证码|verification\s*code|security\s*code|one[- ]time/i.test(`${mail.subject}\n${text}`)
    && codes.length === 1 && received <= now && now - received < CODE_TTL ? codes[0] : null;
  return { id: String(mail.emailId), sender: mail.sendEmail, sender_name: mail.name || '', subject: mail.subject || '(无主题)',
    received_at: received, is_read: Number(mail.unread === 1), body_text: text, code, code_expires_at: code ? received + CODE_TTL : null };
}

export function createCloudMail({ origin, mailbox, password, request = fetch, now = Date.now }) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('MAIL_API_URL must be an HTTPS origin');
  let token;
  let loginPending;
  let accountId;

  async function call(path, method = 'GET', data, auth = true, retry = true) {
    if (auth && !token) await login();
    let response, result;
    try {
      response = await request(new URL(`/api${path}`, base), { method, redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'UNNC-Visitor/0.2.3', ...(auth ? { Authorization: token } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
      result = await response.json();
    } catch { throw new Error('network_error'); }
    if (auth && retry && (response.status === 401 || result.code === 401)) {
      token = null;
      await login();
      return call(path, method, data, auth, false);
    }
    if (!response.ok || result.code !== 200) throw new Error('network_error');
    return result.data;
  }

  async function login() {
    if (!loginPending) loginPending = call('/login', 'POST', { email: mailbox, password }, false)
      .then(result => { if (!result?.token) throw new Error('network_error'); token = result.token; })
      .finally(() => { loginPending = null; });
    await loginPending;
  }

  async function list({ before, size = 50 } = {}) {
    if (!accountId) {
      const accounts = await call('/account/list?size=30');
      accountId = accounts.find(account => account.email.toLowerCase() === mailbox.toLowerCase())?.accountId;
      if (!accountId) throw new Error('network_error');
    }
    const query = new URLSearchParams({ accountId: String(accountId), allReceive: '0', type: '0', full: '1', size: String(size) });
    if (before) query.set('emailId', String(before));
    const result = await call(`/email/list?${query}`);
    return result.list.filter(mail => mail.toEmail?.toLowerCase() === mailbox.toLowerCase()).map(mail => normalize(mail, now()));
  }

  return async (path, method = 'GET', body) => {
    if (path === '/api/settings' && method === 'GET') return Response.json({ address: mailbox, provider: 'Cloud Mail', codeTtlSeconds: CODE_TTL / 1000 });
    if (path === '/api/messages' && method === 'GET') return Response.json({ messages: await list() });
    if (path === '/api/code' && method === 'POST') {
      const after = JSON.parse(body || '{}').after;
      if (!Number.isFinite(after) || after > now() || after < now() - CODE_TTL) return Response.json({ status: 'waiting' });
      const mail = (await list()).find(mail => mail.code && mail.received_at >= Math.floor(after / 1000) * 1000);
      return Response.json(mail ? { status: 'received', code: mail.code } : { status: 'waiting' });
    }
    const match = /^\/api\/messages\/([1-9]\d{0,14})$/.exec(path);
    if (!match || !['GET', 'PATCH', 'DELETE'].includes(method)) return Response.json({ error: '接口不存在' }, { status: 404 });
    const id = Number(match[1]);
    const [mail] = await list({ before: id + 1, size: 1 });
    if (mail?.id !== match[1]) return Response.json({ error: '邮件不存在' }, { status: 404 });
    if (method === 'GET') return Response.json(mail);
    if (method === 'PATCH') await call('/email/read', 'PUT', { emailIds: [id] });
    else await call(`/email/delete?emailIds=${id}`, 'DELETE');
    return Response.json({ ok: true });
  };
}
