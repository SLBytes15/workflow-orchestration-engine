import assert from "node:assert/strict";
import { test } from "node:test";
import { generateApiKey, hashApiKey } from "./apiKeyCrypto";

test("generates a key with the expected prefix", () => {
  const result = generateApiKey();

  assert.ok(result.plaintextKey.startsWith("zaal_"));
  assert.ok(result.keyPrefix.startsWith("zaal_"));
  assert.ok(result.plaintextKey.length > result.keyPrefix.length);
});

test("generates unique keys", () => {
  const first = generateApiKey();
  const second = generateApiKey();

  assert.notEqual(first.plaintextKey, second.plaintextKey);
  assert.notEqual(first.keyHash, second.keyHash);
});

test("hashes the same key consistently", () => {
  const key = generateApiKey().plaintextKey;

  assert.equal(hashApiKey(key), hashApiKey(key));
});

test("does not return the plaintext as the hash", () => {
  const result = generateApiKey();

  assert.notEqual(result.plaintextKey, result.keyHash);
  assert.match(result.keyHash, /^[a-f0-9]{64}$/);
});

