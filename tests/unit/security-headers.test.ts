import { describe, expect, it } from 'vitest';
import headers from '../../public/_headers?raw';

const cspLine = headers.split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:')) ?? '';
const csp = cspLine.slice(cspLine.indexOf(':') + 1);
const directive = (name: string) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

describe('static asset security headers', () => {
  it('applies a self-only script policy without eval or inline script execution', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('script-src')).not.toContain('unsafe-eval');
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it('allows styles required by the React UI but blocks framing and object embedding', () => {
    expect(directive('style-src')).toContain("'unsafe-inline'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('form-action')).toBe("form-action 'self'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
  });

  it('sets transport, content-type, framing, referrer, and permissions headers', () => {
    expect(headers).toMatch(/Strict-Transport-Security: max-age=31536000; includeSubDomains/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
    expect(headers).toMatch(/X-Frame-Options: DENY/);
    expect(headers).toMatch(/Referrer-Policy: no-referrer/);
    expect(headers).toMatch(/Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)/);
  });
});
