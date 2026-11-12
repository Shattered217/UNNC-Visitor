const encoder = new TextEncoder();
const SESSION_SECONDS = 12 * 60 * 60;

export async function matchesSecret(value: string, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32 || value.length > 1024) return false;
  const [a, b] = await Promise.all(
    [value, secret].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))),
  );
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signature(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${crypto.randomUUID()}`;
  return `${payload}.${await signature(payload, secret)}`;
}

export async function validSession(token: string, secret: string, now = Date.now()): Promise<boolean> {
  if (!secret || secret.length < 32 || token.length > 256) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]);
  if (expiry <= now / 1000 || expiry > now / 1000 + SESSION_SECONDS + 1) return false;
  return matchesSecret(parts[2], await signature(`${parts[0]}.${parts[1]}`, secret));
}

export async function authorized(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get("Authorization");
  if (header) return header.startsWith("Bearer ") && matchesSecret(header.slice(7), secret);
  const cookie = request.headers.get("Cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith("mail_session="));
  return cookie ? validSession(cookie.slice("mail_session=".length), secret) : false;
}

export function sameOrigin(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `mail_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}${secure ? "; Secure" : ""}`;
}
