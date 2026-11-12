import { test } from "node:test";
import assert from "node:assert/strict";
import { authorized, createSession, matchesSecret, sameOrigin, sessionCookie, validSession } from "../src/auth.ts";

const secret = "a-private-test-secret-with-at-least-32-characters";

test("accepts only the configured high-entropy key", async () => {
  assert.equal(await matchesSecret(secret, secret), true);
  assert.equal(await matchesSecret("wrong", secret), false);
  assert.equal(await matchesSecret("", ""), false);
  assert.equal(await matchesSecret("short", "short"), false);
});

test("sessions expire, reject tampering and become invalid after key rotation", async () => {
  const now = Date.now();
  const session = await createSession(secret, now);
  assert.equal(await validSession(session, secret, now), true);
  assert.equal(await validSession(`${session}x`, secret, now), false);
  assert.equal(await validSession(session, `${secret}-rotated`, now), false);
  assert.equal(await validSession(session, secret, now + 12 * 60 * 60 * 1000 + 1000), false);
});

test("supports API bearer keys and HttpOnly browser sessions", async () => {
  const session = await createSession(secret);
  assert.equal(await authorized(new Request("https://mail.example.com", { headers: { Authorization: `Bearer ${secret}` } }), secret), true);
  assert.equal(await authorized(new Request("https://mail.example.com", { headers: { Cookie: `mail_session=${session}` } }), secret), true);
  assert.equal(await authorized(new Request("https://mail.example.com?key=" + secret), secret), false);
  assert.equal(await authorized(new Request("https://mail.example.com", { headers: { Authorization: "Bearer wrong", Cookie: `mail_session=${session}` } }), secret), false);
  assert.match(sessionCookie(session, true), /HttpOnly; SameSite=Strict;.*Secure/);
});

test("browser writes require same-origin requests", () => {
  assert.equal(sameOrigin(new Request("https://mail.example.com/api/session", { headers: { Origin: "https://mail.example.com" } })), true);
  assert.equal(sameOrigin(new Request("https://mail.example.com/api/session", { headers: { Origin: "https://evil.example.com" } })), false);
  assert.equal(sameOrigin(new Request("https://mail.example.com/api/session")), false);
});
