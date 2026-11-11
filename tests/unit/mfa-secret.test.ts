import { describe, expect, it } from 'vitest';
import {
  MfaKeyUnavailableError,
  MfaSecretUnreadableError,
  generateMfaEncryptionKey,
  mfaSecretMode,
  needsMfaSecretReseal,
  openMfaSecret,
  sealMfaSecret,
} from '../../worker/services/mfa-secret';

const TEST_KEY = 'KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=';
const sealedEnv = { MFA_ENCRYPTION_KEY: TEST_KEY, APP_ENV: 'production' } as const;
const devEnv = { APP_ENV: 'development' } as const;

describe('authenticator secret sealing', () => {
  it('reports the storage mode for production and development', () => {
    expect(mfaSecretMode(sealedEnv)).toBe('aes-256-gcm');
    expect(mfaSecretMode({ APP_ENV: 'production' })).toBe('unavailable');
    expect(mfaSecretMode(devEnv)).toBe('plaintext-dev');
  });

  it('round-trips a secret without writing it to the stored value', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const sealed = await sealMfaSecret(sealedEnv, secret, 'user_one');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain(secret);
    expect(await openMfaSecret(sealedEnv, sealed, 'user_one')).toBe(secret);
  });

  it('uses a fresh IV for every seal', async () => {
    const first = await sealMfaSecret(sealedEnv, 'JBSWY3DPEHPK3PXP', 'user_one');
    const second = await sealMfaSecret(sealedEnv, 'JBSWY3DPEHPK3PXP', 'user_one');
    expect(first).not.toBe(second);
    expect(await openMfaSecret(sealedEnv, first, 'user_one')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('binds ciphertext to the owning user', async () => {
    const sealed = await sealMfaSecret(sealedEnv, 'JBSWY3DPEHPK3PXP', 'user_one');
    await expect(openMfaSecret(sealedEnv, sealed, 'user_two')).rejects.toBeInstanceOf(MfaSecretUnreadableError);
  });

  it('rejects tampered ciphertext', async () => {
    const sealed = await sealMfaSecret(sealedEnv, 'JBSWY3DPEHPK3PXP', 'user_one');
    const [prefix, iv, ciphertext] = sealed.split(':');
    const tampered = `${prefix}:${iv}:${ciphertext.slice(0, -2)}${ciphertext.endsWith('A') ? 'B' : 'A'}A`;
    await expect(openMfaSecret(sealedEnv, tampered, 'user_one')).rejects.toBeInstanceOf(MfaSecretUnreadableError);
  });

  it('fails closed when production has no key configured', async () => {
    await expect(sealMfaSecret({ APP_ENV: 'production' }, 'JBSWY3DPEHPK3PXP', 'user_one'))
      .rejects.toBeInstanceOf(MfaKeyUnavailableError);
    await expect(openMfaSecret({ APP_ENV: 'production' }, 'v1:aaaa:bbbb', 'user_one'))
      .rejects.toBeInstanceOf(MfaKeyUnavailableError);
  });

  it('keeps development readable while flagging the plaintext format', async () => {
    const stored = await sealMfaSecret(devEnv, 'JBSWY3DPEHPK3PXP', 'user_one');
    expect(stored.startsWith('dev:')).toBe(true);
    expect(await openMfaSecret(devEnv, stored, 'user_one')).toBe('JBSWY3DPEHPK3PXP');
    expect(needsMfaSecretReseal(sealedEnv, stored)).toBe(true);
  });

  it('reads legacy plaintext rows and marks them for resealing', async () => {
    expect(await openMfaSecret(sealedEnv, 'JBSWY3DPEHPK3PXP', 'user_one')).toBe('JBSWY3DPEHPK3PXP');
    expect(needsMfaSecretReseal(sealedEnv, 'JBSWY3DPEHPK3PXP')).toBe(true);
    expect(needsMfaSecretReseal(sealedEnv, 'v1:aaaa:bbbb')).toBe(false);
  });

  it('generates a 32-byte base64 key', () => {
    const key = generateMfaEncryptionKey();
    expect(atob(key)).toHaveLength(32);
  });
});
