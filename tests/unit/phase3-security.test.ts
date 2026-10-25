import { describe, expect, it } from 'vitest';
import { assistantMessageSchema, assistantThreadCreateSchema, assistantThreadRenameSchema } from '../../shared/schemas/assistant';
import { loginMfaSchema, mfaConfirmSchema, mfaDisableSchema } from '../../shared/schemas/account';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  parseRecoveryHashes,
  totpCode,
  verifyTotp,
} from '../../worker/services/mfa';
import {
  DEFAULT_IDLE_MINUTES,
  idleTimeoutMinutes,
  isIdleExpired,
  shouldTouchSession,
} from '../../worker/services/session-security';
import { buildLikePatterns, escapeLikePattern } from '../../worker/services/search';

const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('TOTP primitives (RFC 6238)', () => {
  it('matches the published SHA-1 test vectors', async () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(await totpCode(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
    }
  });

  it('round-trips base32 and rejects malformed input', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0xff, 0x80, 0x42]);
    const encoded = base32Encode(bytes);
    expect([...base32Decode(encoded) ?? []]).toEqual([...bytes]);
    expect(base32Decode('not-base32!')).toBeNull();
  });

  it('verifies the current step and one step of tolerated clock skew', async () => {
    const at = 1_700_000_000;
    const code = await totpCode(RFC_SECRET, Math.floor(at / 30));
    const current = await verifyTotp(RFC_SECRET, code, at);
    expect(current.valid).toBe(true);
    expect(current.step).toBe(Math.floor(at / 30));

    const previousCode = await totpCode(RFC_SECRET, Math.floor(at / 30) - 1);
    expect((await verifyTotp(RFC_SECRET, previousCode, at)).valid).toBe(true);

    const staleCode = await totpCode(RFC_SECRET, Math.floor(at / 30) - 5);
    expect((await verifyTotp(RFC_SECRET, staleCode, at)).valid).toBe(false);
    expect((await verifyTotp(RFC_SECRET, '12345', at)).valid).toBe(false);
    expect((await verifyTotp(RFC_SECRET, 'abcdef', at)).valid).toBe(false);
  });

  it('generates 160-bit secrets and a valid otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(secret)?.byteLength).toBe(20);

    const uri = new URL(otpauthUri(secret, 'member@cerberus.test'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('period')).toBe('30');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('issuer')).toBe('CERBERUS Workspace');
  });
});

describe('recovery codes', () => {
  it('creates unambiguous single-use code material and matches hashes', async () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(normalizeRecoveryCode(code)).toHaveLength(8);
    }

    const hashes = await Promise.all(codes.map(hashRecoveryCode));
    expect(await matchRecoveryCode(codes[3], hashes)).toBe(3);
    expect(await matchRecoveryCode(codes[3].toLowerCase().replace('-', ' '), hashes)).toBe(3);
    expect(await matchRecoveryCode('ZZZZ-ZZZZ', hashes)).toBe(-1);
    expect(await matchRecoveryCode('short', hashes)).toBe(-1);

    expect(parseRecoveryHashes(JSON.stringify(hashes))).toEqual(hashes);
    expect(parseRecoveryHashes('{not json')).toEqual([]);
    expect(parseRecoveryHashes(null)).toEqual([]);
  });
});

describe('session idle policy', () => {
  it('defaults to eight hours and clamps configured values', () => {
    expect(DEFAULT_IDLE_MINUTES).toBe(480);
    expect(idleTimeoutMinutes({})).toBe(480);
    expect(idleTimeoutMinutes({ SESSION_IDLE_MINUTES: '45' })).toBe(45);
    expect(idleTimeoutMinutes({ SESSION_IDLE_MINUTES: '1' })).toBe(5);
    expect(idleTimeoutMinutes({ SESSION_IDLE_MINUTES: '999999' })).toBe(10_080);
    expect(idleTimeoutMinutes({ SESSION_IDLE_MINUTES: 'not-a-number' })).toBe(480);
  });

  it('expires only after the idle window and throttles last_seen writes', () => {
    expect(isIdleExpired(1_000, 1_000 + 480 * 60, 480 * 60)).toBe(false);
    expect(isIdleExpired(1_000, 1_000 + 480 * 60 + 1, 480 * 60)).toBe(true);
    expect(shouldTouchSession(1_000, 1_040)).toBe(false);
    expect(shouldTouchSession(1_000, 1_060)).toBe(true);
  });
});

describe('workspace search LIKE patterns', () => {
  const byteLength = (value: string) => new TextEncoder().encode(value).length;

  it('keeps short queries as escaped phrase patterns', () => {
    expect(buildLikePatterns('PhaseOne')).toEqual(['%PhaseOne%']);
    expect(buildLikePatterns('  ')).toEqual([]);
    expect(buildLikePatterns('p')).toEqual([]);
    expect(escapeLikePattern('%zz%')).toBe('\\%zz\\%');
    expect(buildLikePatterns('%zz%')).toEqual(['%\\%zz\\%%']);
  });

  it('bounds every pattern to the 50-byte D1 limit for long prompts', () => {
    // Local D1 rejects LIKE patterns longer than 50 bytes with
    // "LIKE or GLOB pattern too complex".
    const prompt = 'What is the current task status across the workspace?';
    const patterns = buildLikePatterns(prompt);
    expect(patterns.length).toBeGreaterThan(1);
    expect(patterns.length).toBeLessThanOrEqual(4);
    for (const pattern of patterns) {
      expect(byteLength(pattern)).toBeLessThanOrEqual(50);
      expect(pattern.startsWith('%')).toBe(true);
      expect(pattern.endsWith('%')).toBe(true);
      expect(pattern.toLowerCase()).not.toContain('the');
    }
    expect(patterns.some((pattern) => pattern.includes('workspace'))).toBe(true);

    const singleLongWord = buildLikePatterns('a'.repeat(120));
    expect(singleLongWord).toHaveLength(1);
    expect(byteLength(singleLongWord[0])).toBeLessThanOrEqual(50);

    const arabic = buildLikePatterns('ما هي حالة المهام الحالية في مساحة العمل الآن');
    for (const pattern of arabic) {
      expect(byteLength(pattern)).toBeLessThanOrEqual(50);
    }
  });
});

describe('phase 3 schemas', () => {
  it('validates MFA login, confirmation and disable payloads', () => {
    expect(loginMfaSchema.safeParse({ challengeToken: 'a'.repeat(32), code: '123456' }).success).toBe(true);
    expect(loginMfaSchema.safeParse({ challengeToken: 'short', code: '123456' }).success).toBe(false);
    expect(loginMfaSchema.safeParse({ challengeToken: 'a'.repeat(32), code: '12345' }).success).toBe(false);
    expect(mfaConfirmSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaConfirmSchema.safeParse({ code: '12345a' }).success).toBe(false);
    expect(mfaDisableSchema.safeParse({ password: 'short', code: '123456' }).success).toBe(false);
    expect(mfaDisableSchema.safeParse({ password: 'Cerberus!Test2026', code: 'ABCD-EFGH' }).success).toBe(true);
  });

  it('bounds assistant thread titles and message length', () => {
    expect(assistantThreadRenameSchema.safeParse({ title: 'Firmware blockers' }).success).toBe(true);
    expect(assistantThreadRenameSchema.safeParse({ title: '' }).success).toBe(false);
    expect(assistantThreadRenameSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
    expect(assistantThreadCreateSchema.safeParse({}).success).toBe(true);
    expect(assistantMessageSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(assistantMessageSchema.safeParse({ message: 'x'.repeat(8_001) }).success).toBe(false);
    expect(assistantMessageSchema.safeParse({ message: 'What is blocked?' }).success).toBe(true);
  });
});
