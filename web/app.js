const $ = (id) => document.getElementById(id);
let settings;
let messages = [];
let selectedId = null;
let refreshing = false;
let loggedIn = false;
let toastTimer;
let qrVersion = null;
let visitorRefreshing = false;

function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(data.error || "暂时无法连接助手");
  }
  return data;
}

function showLogin() {
  loggedIn = false;
  configLoaded = false;
  messages = [];
  settings = undefined;
  selectedId = null;
  $("message-list").replaceChildren();
  $("reader-body").textContent = "";
  $("reader-code").textContent = "";
  $("mailbox-address").textContent = "";
  $("gate-qr").hidden = true;
  $("gate-qr").removeAttribute("src");
  qrVersion = null;
  $("initial-state").hidden = true;
  $("mail-view").hidden = true;
  $("logout").hidden = true;
  $("login-view").hidden = false;
}

function showInbox() {
  $("initial-state").hidden = true;
  $("login-view").hidden = true;
  $("mail-view").hidden = false;
  $("logout").hidden = false;
  $("mailbox-address").textContent = settings.address;
  $("code-ttl").textContent = Math.floor(settings.codeTtlSeconds / 60);
  loggedIn = true;
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });

function renderMessages() {
  $("message-list").replaceChildren();
  $("mail-count").textContent = messages.length;
  $("empty-inbox").hidden = messages.length > 0;
  for (const message of messages) {
    const row = document.createElement("button");
    row.className = `message${message.id === selectedId ? " selected" : ""}${message.is_read ? "" : " unread"}`;
    row.setAttribute("aria-pressed", String(message.id === selectedId));
    const top = document.createElement("div");
    top.className = "message-top";
    const sender = document.createElement("span");
    sender.className = "message-from";
    sender.textContent = message.sender_name || message.sender;
    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = new Date(message.received_at).toISOString();
    time.textContent = dateFormat.format(message.received_at);
    top.append(sender, time);
    const subject = document.createElement("p");
    subject.className = "message-title";
    subject.textContent = message.subject;
    row.append(top, subject);
    if (message.code && message.code_expires_at > Date.now()) {
      const code = document.createElement("span");
      code.className = "code-tag";
      code.textContent = message.code;
      row.append(code);
    }
    row.addEventListener("click", () => openMessage(message.id).catch((error) => toast(error.message)));
    $("message-list").append(row);
  }
  updateCode();
}

function updateCode() {
  const message = messages.find((m) => m.id === selectedId);
  const valid = message?.code && message.code_expires_at > Date.now();
  $("code-card").hidden = !valid;
  $("reader-code").textContent = valid ? message.code : "";
}

async function refresh() {
  if (!loggedIn || refreshing) return;
  refreshing = true;
  try {
    const data = await api("/api/messages");
    if (!loggedIn) return;
    messages = data.messages;
    if (selectedId && !messages.some((m) => m.id === selectedId)) closeReader();
    renderMessages();
    await refreshVisitor();
    $("live-label").textContent = "自动更新";
  } catch (error) {
    $("live-label").textContent = "连接中断";
    if (loggedIn) toast(error.message);
  } finally { refreshing = false; }
}

async function refreshVisitor() {
  if (!loggedIn || visitorRefreshing) return;
  visitorRefreshing = true;
  try {
    const data = await api("/api/visitor/status");
    if (!loggedIn) return;
    renderRenewal(data.renewal);
    await loadConfig();
    const busy = data.job && ["pending", "running"].includes(data.job.status);
    $("refresh-visitor").disabled = Boolean(busy);
    const text = { ready: "今日二维码已更新", no_reservation: "今天没有可用的已批准预约", stale: "二维码需要刷新", pending: "等待首次同步" };
    $("visitor-status").textContent = busy ? "正在读取学校预约…" : text[data.state] || "等待同步";
    const today = data.reservations.find(r => r.date === data.date && ["valid", "visited"].includes(r.status));
    $("visitor-detail").textContent = [today && `${today.date} · ${today.gate}`, data.captured_at && `${dateFormat.format(data.captured_at)} 更新`, !data.agent_online && "Unraid 暂未连接", data.job?.status === "failed" && "上次刷新未完成，请重试"].filter(Boolean).join(" · ");
    $("gate-qr").hidden = !data.qr_available;
    if (data.qr_available && qrVersion !== data.captured_at) {
      qrVersion = data.captured_at;
      $("gate-qr").src = `/api/visitor/qr?v=${qrVersion}`;
    }
    if (!data.qr_available) { $("gate-qr").removeAttribute("src"); qrVersion = null; }
  } finally { visitorRefreshing = false; }
}

$("refresh-visitor").addEventListener("click", async () => {
  $("refresh-visitor").disabled = true;
  try {
    await api("/api/visitor/refresh", { method: "POST", body: "{}" });
    await refreshVisitor();
  } catch (error) { toast(error.message); $("refresh-visitor").disabled = false; }
});
$("gate-qr").addEventListener("error", () => { $("gate-qr").hidden = true; qrVersion = null; });

function closeReader() {
  selectedId = null;
  $("reader").hidden = true;
  $("reader-empty").hidden = false;
  $("reader-body").textContent = "";
  $("reader-code").textContent = "";
}

async function openMessage(id) {
  selectedId = id;
  const mail = await api(`/api/messages/${id}`);
  if (!loggedIn || selectedId !== id) return;
  $("reader").hidden = false;
  $("reader-empty").hidden = true;
  $("reader-date").textContent = `${dateFormat.format(mail.received_at)} · 北京时间`;
  $("reader-subject").textContent = mail.subject;
  $("reader-sender").textContent = `${mail.sender_name ? `${mail.sender_name} · ` : ""}${mail.sender}${mail.sender_verified ? " · 来源已验证" : ""}`;
  $("reader-body").textContent = mail.body_text;
  const message = messages.find((m) => m.id === id);
  if (message) message.is_read = 1;
  renderMessages();
  await api(`/api/messages/${id}`, { method: "PATCH", body: "{}" });
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("已复制"); }
  catch { toast("复制失败，请手动选择并复制"); }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-button").disabled = true;
  $("login-error").textContent = "";
  try {
    await api("/api/session", { method: "POST", body: JSON.stringify({ key: $("access-key").value.trim() }) });
    $("access-key").value = "";
    settings = await api("/api/settings");
    closeReader();
    showInbox();
    await refresh();
  } catch (error) { $("login-error").textContent = error.message; }
  finally { $("login-button").disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("/api/session", { method: "DELETE" }); showLogin(); }
  catch (error) { toast(error.message); }
});
$("refresh").addEventListener("click", refresh);
$("copy-address").addEventListener("click", () => settings && copy(settings.address));
$("copy-code").addEventListener("click", () => { updateCode(); if (!$("code-card").hidden) copy($("reader-code").textContent); });
$("delete-message").addEventListener("click", async () => {
  if (!selectedId || !confirm("删除这封邮件？")) return;
  try { await api(`/api/messages/${selectedId}`, { method: "DELETE" }); closeReader(); await refresh(); toast("邮件已删除"); }
  catch (error) { toast(error.message); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
setInterval(updateCode, 1000);

(async () => {
  try { settings = await api("/api/settings"); showInbox(); await refresh(); }
  catch (error) { showLogin(); if (error.message !== "请先登录") $("login-error").textContent = error.message; }
})();

let configLoaded = false;
let configOptions = { gates: [], purposes: [] };
const renewalText = { disabled: '自动续约已关闭', unconfigured: '请补全预约配置', waiting: '等待续约日期', pending_approval: '已有预约等待接访人审批', ready: '已到续约时间', submitted: '预约已提交，等待审批', rejected: '学校未接受预约，请检查配置', review_required: '上次提交结果待核实，已暂停重复提交', calendar_missing: '缺少对应年份的法定工作日数据', school_limit: '当前日期超出学校允许范围' };
function renderRenewal(plan) {
  const text = plan ? [renewalText[plan.state] || '等待同步', plan.expiry && `已批准至 ${plan.expiry}`, plan.trigger && `续约日 ${plan.trigger}`].filter(Boolean).join(' · ') : '正在读取续约安排…';
  $('renewal-summary').textContent = text;
  $('renewal-detail').textContent = text;
}
function optionalFields() {
  $('plate-label').hidden = !$('cfg-driving').checked;
  $('cfg-plate').required = $('cfg-driving').checked;
  const purpose = configOptions.purposes.find(p => p.value === $('cfg-purpose').value);
  $('purpose-extra-label').hidden = !purpose?.required && !purpose?.extraInfo;
  $('cfg-purpose-extra').required = Boolean(purpose?.required);
}
async function loadConfig(force = false) {
  if (configLoaded && !force) return;
  const data = await api('/api/config');
  if (!loggedIn || !data.options.gates.length) return;
  configOptions = data.options;
  for (const [id, options, valueKey] of [['cfg-gate', data.options.gates, 'code'], ['cfg-purpose', data.options.purposes, 'value']]) {
    $(id).replaceChildren(...options.map(o => { const option = document.createElement('option'); option.value = o[valueKey]; option.textContent = o.label; return option; }));
  }
  if (!$('cfg-hour').options.length) for (let h = 0; h < 24; h++) { const o = document.createElement('option'); o.value = h; o.textContent = `${String(h).padStart(2, '0')}:00`; $('cfg-hour').append(o); }
  const c = data.config;
  for (const [id, key] of [['cfg-gate', 'gate'], ['cfg-purpose', 'purpose'], ['cfg-purpose-extra', 'purposeExtra'], ['cfg-host', 'hostEmail'], ['cfg-plate', 'plate'], ['cfg-calendar', 'calendar'], ['cfg-lead', 'leadWorkdays'], ['cfg-hour', 'hour'], ['cfg-mode', 'dateMode']]) $(id).value = c[key];
  $('cfg-enabled').checked = c.enabled; $('cfg-driving').checked = c.driving;
  optionalFields(); renderRenewal(data.renewal);
  $('school-limits').textContent = data.limits ? `学校当前允许提前 ${data.limits.maxAdvanceDays} 天，单次最多 ${data.limits.maxSpanDays} 天。最大跨度模式可能与旧预约重叠；接续模式的结束日期仍受学校提前天数限制。` : '';
  configLoaded = true;
}
$('cfg-driving').addEventListener('change', optionalFields);
$('cfg-purpose').addEventListener('change', optionalFields);
$('config-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save-config').disabled = true; $('config-feedback').textContent = '';
  try {
    const config = { enabled: $('cfg-enabled').checked, gate: $('cfg-gate').value, purpose: $('cfg-purpose').value, purposeExtra: $('cfg-purpose-extra').value.trim(), hostEmail: $('cfg-host').value.trim(), driving: $('cfg-driving').checked, plate: $('cfg-plate').value.trim(), calendar: $('cfg-calendar').value, leadWorkdays: Number($('cfg-lead').value), hour: Number($('cfg-hour').value), dateMode: $('cfg-mode').value };
    await api('/api/config', { method: 'PATCH', body: JSON.stringify(config) });
    await loadConfig(true); $('config-feedback').textContent = '已保存，下次同步时生效';
  } catch (error) { $('config-feedback').textContent = error.message; }
  finally { $('save-config').disabled = false; }
});
