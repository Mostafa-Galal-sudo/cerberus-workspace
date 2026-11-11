import { describe, expect, it } from 'vitest';
import { resolveWebhookSecret } from '../../worker/services/github';

describe('GitHub webhook secret resolution', () => {
  it('prefers the deployment secret over a persisted integration value', () => {
    expect(resolveWebhookSecret('env-secret', 'stored-secret')).toBe('env-secret');
  });

  it('falls back to the persisted value when no deployment secret exists', () => {
    expect(resolveWebhookSecret(undefined, 'stored-secret')).toBe('stored-secret');
    expect(resolveWebhookSecret('', 'stored-secret')).toBe('stored-secret');
  });

  it('returns undefined when neither source is configured', () => {
    expect(resolveWebhookSecret(undefined, undefined)).toBeUndefined();
  });
});
