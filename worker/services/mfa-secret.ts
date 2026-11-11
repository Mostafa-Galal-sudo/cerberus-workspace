import type { Env } from '../types';

/**
 * Authenticator secrets are sealed with AES-256-GCM before they reach D1 so a
 * database-only exposure does not allow an attacker to mint valid TOTP codes.
 * The key lives in the Worker secret store (`MFA_ENCRYPTION_KEY`, 32 bytes
 * base64), never in the database.
 *
 * Stored values are versioned:
 *   v1:<iv>:<ciphertext>  AES-256-GCM, additional data binds the row to its user
 *   dev:<secret>          plaintext fallback for local development only
 *   <base32>              legacy plaintext rows written before this version
 */
export const SEALED_PREFIX = 'v1:';
const DEV_PREFIX = 'dev:';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type MfaSecretMode = 'aes-256-gcm' | 'plaintext-dev' | 'unavailable';

export class MfaKeyUnavailableError extends Error {
  constructor() {
    super('MFA_ENCRYPTION_KEY is not configured');
    this.name = 'MfaKeyUnavailableError';
  }
}

export class MfaSecretUnreadableError extends Error {
  constructor() {
    super('The stored authenticator secret cannot be decrypted');
    this.name = 'MfaSecretUnreadableError';
  }
}

export function mfaSecretMode(env: Pick<Env, 'MFA_ENCRYPTION_KEY' | 'APP_ENV'>): MfaSecretMode {
  if (env.MFA_ENCRYPTION_KEY) return 'aes-256-gcm';
  return env.APP_ENV === 'production' ? 'unavailable' : 'plaintext-dev';
}

export function isSealedMfaSecret(value: string): boolean {
  return value.startsWith(SEALED_PREFIX);
}

/** True when a readable secret should be re-written in the current format. */
export function needsMfaSecretReseal(env: Pick<Env, 'MFA_ENCRYPTION_KEY' | 'APP_ENV'>, value: string): boolean {
  return mfaSecretMode(env) === 'aes-256-gcm' && !isSealedMfaSecret(value);
}

export async function sealMfaSecret(
  env: Pick<Env, 'MFA_ENCRYPTION_KEY' | 'APP_ENV'>,
  secret: string,
  userId: string,
): Promise<string> {
  const mode = mfaSecretMode(env);
  if (mode === 'unavailable') throw new MfaKeyUnavailableError();
  if (mode === 'plaintext-dev') return `${DEV_PREFIX}${secret}`;

  const key = await importKey(env.MFA_ENCRYPTION_KEY as string);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(associatedData(userId)) },
    key,
    toBuffer(new TextEncoder().encode(secret)),
  ));
  return `${SEALED_PREFIX}${toBase64Url(iv)}:${toBase64Url(ciphertext)}`;
}

export async function openMfaSecret(
  env: Pick<Env, 'MFA_ENCRYPTION_KEY' | 'APP_ENV'>,
  stored: string,
  userId: string,
): Promise<string> {
  if (stored.startsWith(SEALED_PREFIX)) {
    if (!env.MFA_ENCRYPTION_KEY) throw new MfaKeyUnavailableError();
    const [ivText, ciphertextText] = stored.slice(SEALED_PREFIX.length).split(':');
    if (!ivText || !ciphertextText) throw new MfaSecretUnreadableError();
    try {
      const key = await importKey(env.MFA_ENCRYPTION_KEY);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(fromBase64Url(ivText)), additionalData: toBuffer(associatedData(userId)) },
        key,
        toBuffer(fromBase64Url(ciphertextText)),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new MfaSecretUnreadableError();
    }
  }
  if (stored.startsWith(DEV_PREFIX)) return stored.slice(DEV_PREFIX.length);
  return stored;
}

function associatedData(userId: string): Uint8Array {
  return new TextEncoder().encode(`user_mfa:${userId}`);
}

/**
 * `crypto.subtle` accepts only `ArrayBuffer`-backed views. A copy keeps the
 * call sites type-safe under `Uint8Array<ArrayBufferLike>`.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(raw: string): Promise<CryptoKey> {
  const cached = keyCache.get(raw);
  if (cached) return cached;
  const material = decodeKey(raw);
  if (!material) return Promise.reject(new MfaKeyUnavailableError());
  const imported = crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  keyCache.set(raw, imported);
  return imported;
}

function decodeKey(raw: string): ArrayBuffer | null {
  try {
    const bytes = fromBase64Url(raw.trim());
    if (bytes.byteLength !== KEY_BYTES) return null;
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Generates a new base64 key for `wrangler secret put MFA_ENCRYPTION_KEY`.
 * Kept here so the format and the validation stay in one place.
 */
export function generateMfaEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
