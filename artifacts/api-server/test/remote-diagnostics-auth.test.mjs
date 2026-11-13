import assert from "node:assert/strict";
import test from "node:test";
import {
  createRemoteDiagnosticsSignature,
  verifyRemoteDiagnosticsSignature,
} from "../src/lib/remote-diagnostics-auth.ts";

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = "1794597658059";
const nonce = "2b9c3b50-08d9-4b6b-9cab-e4d7a56e8901";

test("remote diagnostics accepts a fresh request with a valid signature", () => {
  const signature = createRemoteDiagnosticsSignature(secret, timestamp, nonce);
  assert.equal(
    verifyRemoteDiagnosticsSignature({
      secret,
      timestamp,
      nonce,
      signature,
      nowMs: Number(timestamp),
    }),
    true,
  );
});

test("remote diagnostics rejects expired, modified, and malformed signatures", () => {
  const signature = createRemoteDiagnosticsSignature(secret, timestamp, nonce);
  assert.equal(
    verifyRemoteDiagnosticsSignature({
      secret,
      timestamp,
      nonce,
      signature,
      nowMs: Number(timestamp) + 60_001,
    }),
    false,
  );
  assert.equal(
    verifyRemoteDiagnosticsSignature({
      secret,
      timestamp,
      nonce,
      signature: `${signature.slice(0, -1)}0`,
      nowMs: Number(timestamp),
    }),
    false,
  );
  assert.equal(
    verifyRemoteDiagnosticsSignature({
      secret,
      timestamp,
      nonce: "not-a-uuid",
      signature,
      nowMs: Number(timestamp),
    }),
    false,
  );
});
