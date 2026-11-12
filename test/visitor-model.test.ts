import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { beijingDate, schoolDate, recordStatus, usableToday, validateSnapshot, snapshotFresh, type VisitorSnapshot } from "../src/visitor-model.ts";

const now = Date.parse("2026-11-08T16:05:00Z");
const record = { VVID: "fixture-user", Vdate: 20261109, approved: 0, regcode: "0123456789" };

test("visit selection uses Beijing date and the logged-in visitor, including checked-in visits", () => {
  assert.equal(beijingDate(now), "2026-11-09");
  assert.equal(beijingDate(now - 10 * 60000), "2026-11-08");
  assert.equal(usableToday(record, "fixture-user", now), true);
  assert.equal(usableToday({ ...record, RtimeinUTC: "2026-11-09 00:01:00" }, "fixture-user", now), true);
  assert.equal(usableToday(record, "another-user", now), false);
  for (const approved of [-1, -100, 2, 100, undefined]) assert.equal(usableToday({ ...record, approved }, "fixture-user", now), false);
  for (const Vdate of [20261108, 20261110]) assert.equal(usableToday({ ...record, Vdate }, "fixture-user", now), false);
  assert.equal(schoolDate(20260230), null);
  assert.equal(schoolDate("bad"), null);
});

test("school approval and check-in statuses retain their meaning", () => {
  assert.equal(recordStatus(record, "2026-11-09"), "valid");
  assert.equal(recordStatus({ ...record, RtimeinUTC: "present" }, "2026-11-09"), "visited");
  assert.equal(recordStatus({ ...record, approved: -1 }, "2026-11-09"), "cancelled");
  assert.equal(recordStatus({ ...record, approved: 100 }, "2026-11-09"), "pending");
  assert.equal(recordStatus(record, "2026-11-10"), "expired");
});

test("QR snapshots cannot cross midnight, outlive freshness, or claim an unapproved visit", () => {
  const snapshot: VisitorSnapshot = { date: "2026-11-09", captured_at: now, state: "ready",
    reservations: [{ date: "2026-11-09", gate: "Fixture gate", purpose: "Fixture purpose", status: "valid" }],
    qr: { source: "official-page", png_base64: readFileSync(new URL("../agent/test/fixtures/sample.png", import.meta.url)).toString("base64") } };
  assert.ok(validateSnapshot(snapshot, now));
  assert.equal(snapshotFresh(snapshot, now + 600001), false);
  assert.equal(snapshotFresh(snapshot, Date.parse("2026-11-09T16:00:00Z")), false);
  assert.equal(validateSnapshot({ ...snapshot, captured_at: now + 31000 }, now), null);
  assert.equal(validateSnapshot({ ...snapshot, reservations: [] }, now), null);
  assert.equal(validateSnapshot({ ...snapshot, qr: { ...snapshot.qr, png_base64: "not png" } }, now), null);
  assert.equal(validateSnapshot({ ...snapshot, state: "no_reservation" }, now), null);
  assert.ok(validateSnapshot({ ...snapshot, state: "no_reservation", qr: null }, now));
});
