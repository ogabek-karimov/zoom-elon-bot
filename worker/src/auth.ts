import type { TelegramUser } from "./types";

async function hmacSha256(keyBytes: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates Telegram Web App `initData` per Telegram's documented algorithm
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Returns the authenticated user on success, or null if the signature is invalid,
 * missing, or older than 24h.
 */
export async function validateInitData(initData: string, botToken: string): Promise<TelegramUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const computedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));

  // Constant-time-ish comparison isn't critical here (hash isn't a secret itself),
  // but a plain === on hex strings of equal expected length is fine.
  if (computedHash !== hash) return null;

  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    return JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
}
