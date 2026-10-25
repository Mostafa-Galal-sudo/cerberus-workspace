import { sha256, timingSafeCompare } from './security';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Uint8Array | null {
  const clean = value.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  return bytes.length > 0 ? Uint8Array.from(bytes) : null;
}

/** 20 random bytes satisfies RFC 4226's recommended shared-secret length. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpCode(secret: string, counter: number, digits = DEFAULT_DIGITS): Promise<string> {
  const keyBytes = base32Decode(secret);
  if (!keyBytes) throw new Error('Invalid TOTP secret');
  const keyData = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyData).set(keyBytes);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000), false);
  view.setUint32(4, counter >>> 0, false);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpVerification {
  valid: boolean;
  step: number | null;
}

/**
 * Verifies a 6-digit code against the current step and one step of clock skew.
 * Callers are responsible for rejecting a previously consumed step (replay).
 */
export async function verifyTotp(
  secret: string,
  code: string,
  atSeconds = Math.floor(Date.now() / 1000),
  window = 1,
): Promise<TotpVerification> {
  if (!/^\d{6}$/.test(code)) return { valid: false, step: null };
  const currentStep = Math.floor(atSeconds / DEFAULT_PERIOD);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = currentStep + offset;
    if (candidate < 0) continue;
    if (timingSafeCompare(await totpCode(secret, candidate), code)) {
      return { valid: true, step: candidate };
    }
  }
  return { valid: false, step: null };
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const characters = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return `${characters.slice(0, 4)}-${characters.slice(4)}`;
  });
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function hashRecoveryCode(value: string): Promise<string> {
  return sha256(normalizeRecoveryCode(value));
}

export async function matchRecoveryCode(value: string, hashes: string[]): Promise<number> {
  const normalized = normalizeRecoveryCode(value);
  if (normalized.length !== 8) return -1;
  const candidate = await sha256(normalized);
  for (let index = 0; index < hashes.length; index += 1) {
    if (timingSafeCompare(candidate, hashes[index])) return index;
  }
  return -1;
}

export function otpauthUri(secret: string, account: string, issuer = 'CERBERUS Workspace'): string {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** Parses the JSON array stored in user_mfa.recovery_codes_json defensively. */
export function parseRecoveryHashes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
