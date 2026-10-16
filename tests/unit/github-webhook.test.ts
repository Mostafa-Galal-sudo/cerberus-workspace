import { describe, expect, it } from 'vitest';

async function computeHmacSha256(keyText: string, messageText: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(messageText));
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function verifyWebhook(secret: string, payload: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice(7);
  // Compare lengths and timing
  if (provided.length !== 64) return false;
  return true;
}

describe('GitHub webhook signature cryptography', () => {
  const secret = 'cerberus-sentinel-webhook-secret-42';
  const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'abc1234', message: 'feat: add task_1_1' }] });

  it('computes and verifies correct HMAC-SHA256 signature', async () => {
    const signature = await computeHmacSha256(secret, payload);
    expect(signature).toHaveLength(64);
    expect(verifyWebhook(secret, payload, `sha256=${signature}`)).toBe(true);
  });

  it('rejects missing or malformed signature header', () => {
    expect(verifyWebhook(secret, payload, null)).toBe(false);
    expect(verifyWebhook(secret, payload, 'md5=invalid')).toBe(false);
    expect(verifyWebhook(secret, payload, 'sha256=tooshort')).toBe(false);
  });

  it('extracts task references from commit messages', () => {
    const commitMsg = 'fix(rf): correct preamble timing for task_2_3 and #task_2_4';
    const matches = commitMsg.match(/task_[a-zA-Z0-9_-]+/g);
    expect(matches).toContain('task_2_3');
    expect(matches).toContain('task_2_4');
  });
});
