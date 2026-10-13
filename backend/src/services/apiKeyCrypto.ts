import { createHash, randomBytes } from "node:crypto";

const API_KEY_PREFIX = "zaal_";
const API_KEY_BYTES = 32;

export function generateApiKey(): {
  plaintextKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const secret = randomBytes(API_KEY_BYTES).toString("hex");
  const plaintextKey = `${API_KEY_PREFIX}${secret}`;

  return {
    plaintextKey,
    keyHash: hashApiKey(plaintextKey),
    keyPrefix: `${API_KEY_PREFIX}${secret.slice(0, 8)}`,
  };
}

export function hashApiKey(plaintextKey: string): string {
  return createHash("sha256").update(plaintextKey, "utf8").digest("hex");
}
