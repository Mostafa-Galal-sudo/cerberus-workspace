import { describe, expect, it } from 'vitest';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../worker/services/security';

describe('authentication cryptography', () => {
  it('hashes and verifies a password without storing the plaintext', async () => {
    const password = 'Cerberus-Test-Password!47';
    const hash = await hashPassword(password, 100_000);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('generates non-repeating session tokens and stable hashes', async () => {
    const first = randomToken(); const second = randomToken();
    expect(first).not.toBe(second);
    await expect(sha256(first)).resolves.toBe(await sha256(first));
  });
});
