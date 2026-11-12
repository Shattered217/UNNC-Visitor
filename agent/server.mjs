import { readFile } from "node:fs/promises";
import { authorized, createSession, matchesSecret, sameOrigin, sessionCookie } from "../src/auth.ts";
import { snapshotFresh } from "../src/visitor-model.ts";
import { paddedPng } from "./qr.mjs";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
async function body(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); return null; } chunks.push(value); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString()); return data && typeof data === "object" && !Array.isArray(data) ? data : null; } catch { return null; }
}

export function createHandler({ key, getState, refresh, updateConfig, mailApi, webDir }) {
  return async request => {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/health") return json({ status: "ok", service: "unnc-visitor" });
    if (!path.startsWith("/api/")) {
      const assets = { "/": ["index.html", "text/html; charset=utf-8"], "/index.html": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/styles.css": ["styles.css", "text/css; charset=utf-8"], "/favicon.svg": ["favicon.svg", "image/svg+xml"] };
      const file = Object.hasOwn(assets, path) ? assets[path] : null;
      if (!file || !["GET", "HEAD"].includes(request.method)) return json({ error: "页面不存在" }, 404);
      return new Response(request.method === "HEAD" ? null : await readFile(new URL(file[0], webDir)), { headers: { ...headers, "Content-Type": file[1] } });
    }
    const bearer = request.headers.get("Authorization")?.startsWith("Bearer ");
    if (!["GET", "HEAD"].includes(request.method) && !bearer && !sameOrigin(request)) return json({ error: "请求来源不正确" }, 403);
    if (path === "/api/session" && request.method === "POST") {
      const data = await body(request);
      if (!data || typeof data.key !== "string") return json({ error: "请输入访问密钥" }, 400);
      if (!await matchesSecret(data.key, key)) return json({ error: "访问密钥不正确" }, 401);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await createSession(key), url.protocol === "https:") });
    }
    if (!await authorized(request, key)) return json({ error: "请先登录" }, 401);
    if (path === "/api/session" && request.method === "DELETE") return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", url.protocol === "https:") });
    const state = getState();
    if (path === "/api/visitor/refresh" && request.method === "POST") return json({ job: refresh() }, 202, { "Retry-After": "3" });
    if (path === "/api/visitor/status" && request.method === "GET") {
      const s = state.snapshot, fresh = s && snapshotFresh(s);
      return json({ state: fresh ? s.state : s ? "stale" : "pending", date: s?.date || null, captured_at: s?.captured_at || null, reservations: s?.reservations || [], qr_available: Boolean(fresh && s?.qr), agent_online: true, job: state.job, renewal: state.renewal, error: state.error || null });
    }
    if (path === "/api/visitor/qr" && request.method === "GET") {
      const s = state.snapshot;
      if (!s || !snapshotFresh(s)) return json({ error: "请先刷新今日预约", state: "stale" }, 409);
      if (s.state !== "ready" || !s.qr) return json({ error: "今天没有可用的已批准预约" }, 404);
      const original = Buffer.from(s.qr.png_base64, "base64");
      const png = url.searchParams.get("original") === "1" ? original : paddedPng(original);
      return new Response(png, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": 'inline; filename="unnc-gate-qr.png"', "X-Visit-Date": s.date, "X-QR-Source": "official-page" } });
    }
    if (path === "/api/config" && request.method === "GET") return json({ config: state.config, options: state.options, limits: state.limits, renewal: state.renewal });
    if (path === "/api/config" && request.method === "PATCH") {
      const data = await body(request); if (!data) return json({ error: "配置格式不正确" }, 400);
      try { return json({ config: await updateConfig(data) }); } catch { return json({ error: "请检查门岗、来访原因、学校接访人邮箱及续约选项" }, 400); }
    }
    const message = /^\/api\/messages\/[1-9]\d{0,14}$/.test(path);
    const allowed = path === "/api/settings" && request.method === "GET" || path === "/api/messages" && request.method === "GET" || message && ["GET", "PATCH", "DELETE"].includes(request.method);
    if (allowed) {
      const response = await mailApi(path, request.method, ["GET", "HEAD"].includes(request.method) ? undefined : "{}");
      return new Response(response.body, { status: response.status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
    }
    return json({ error: "接口不存在" }, 404);
  };
}
