import { describe, expect, it } from 'vitest';
import { computeHmacSha256, verifyGithubSignature } from '../../worker/services/security';

describe('GitHub webhook signature verification', () => {
  const secret = 'cerberus-sentinel-webhook-secret-42';
  const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'abc1234', message: 'feat: add task_1_1' }] });

  it('computes a deterministic 64-character HMAC-SHA256 signature', async () => {
    const first = await computeHmacSha256(secret, payload);
    const second = await computeHmacSha256(secret, payload);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('accepts the signature produced with the configured secret', async () => {
    const signature = await computeHmacSha256(secret, payload);
    expect(await verifyGithubSignature(secret, payload, `sha256=${signature}`)).toBe(true);
  });

  it('rejects a signature produced with a different secret', async () => {
    const wrongSignature = await computeHmacSha256('attacker-controlled-secret', payload);
    expect(await verifyGithubSignature(secret, payload, `sha256=${wrongSignature}`)).toBe(false);
  });

  it('rejects a signature for a tampered payload', async () => {
    const signature = await computeHmacSha256(secret, payload);
    const tampered = payload.replace('refs/heads/main', 'refs/heads/attacker');
    expect(await verifyGithubSignature(secret, tampered, `sha256=${signature}`)).toBe(false);
  });

  it('rejects a single-character mutation of a valid signature', async () => {
    const signature = await computeHmacSha256(secret, payload);
    const mutated = `${signature.slice(0, 63)}${signature.at(-1) === '0' ? '1' : '0'}`;
    expect(await verifyGithubSignature(secret, payload, `sha256=${mutated}`)).toBe(false);
  });

  it('rejects missing and malformed signature headers', async () => {
    expect(await verifyGithubSignature(secret, payload, null)).toBe(false);
    expect(await verifyGithubSignature(secret, payload, 'md5=invalid')).toBe(false);
    expect(await verifyGithubSignature(secret, payload, 'sha256=tooshort')).toBe(false);
  });

  it('extracts task references from commit messages', () => {
    const commitMsg = 'fix(rf): correct preamble timing for task_2_3 and #task_2_4';
    const matches = commitMsg.match(/task_[a-zA-Z0-9_-]+/g);
    expect(matches).toContain('task_2_3');
    expect(matches).toContain('task_2_4');
  });
});
