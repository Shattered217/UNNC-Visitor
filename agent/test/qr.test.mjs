import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCipheriv } from "node:crypto";
import { officialPng } from "../qr.mjs";
import { decodeResponse } from "../school.mjs";

test("the original PNG is retained only when its QR matches the authorized booking", () => {
  const png = readFileSync(new URL("fixtures/sample.png", import.meta.url)).toString("base64");
  assert.equal(officialPng(`data:image/png;base64,${png}`, "0123456789"), png);
  assert.throws(() => officialPng(`data:image/png;base64,${png}`, "another-booking"), /qr_unavailable/);
  assert.throws(() => officialPng("data:image/svg+xml;base64,AAAA", "0123456789"), /qr_unavailable/);
  assert.throws(() => officialPng("data:image/png;base64,AAAA", "0123456789"), /qr_unavailable/);
});

test("the official client's single and nested response encryption is decoded", () => {
  const key = "0123456789abcdef";
  const encrypt = value => {
    const c = createCipheriv("aes-128-ecb", Buffer.from([...key].reverse().join("")), null);
    return Buffer.concat([c.update(JSON.stringify(value)), c.final()]).toString("hex");
  };
  const response = { error: 0, reg: [{ Vdate: 20261109 }] };
  assert.deepEqual(decodeResponse(encrypt(response), key), response);
  assert.deepEqual(decodeResponse(encrypt(encrypt(response)), key), response);
  assert.throws(() => decodeResponse("<html>connection failed</html>", key), /school_error/);
});

test('submission interception includes signed URLs with query parameters', async () => {
  const { isSubmission } = await import('../school.mjs');
  for (const path of ['/transpond/submitReg/', '/transpond/submitRegEx/']) {
    for (const suffix of ['', '?timestamp=123&sign=fixture']) assert.equal(isSubmission(new URL('https://visitor.nottingham.edu.cn' + path + suffix)), true);
  }
  assert.equal(isSubmission(new URL('https://other.example/transpond/submitRegEx/?timestamp=123')), false);
  assert.equal(isSubmission(new URL('https://visitor.nottingham.edu.cn/transpond/rquery/')), false);
});
