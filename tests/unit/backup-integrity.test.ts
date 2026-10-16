import { describe, expect, it } from 'vitest';
import { sha256 } from '../../worker/services/security';

describe('database backup serialization and cryptographic checksum verification', () => {
  it('generates deterministic SHA-256 checksum for backup payload', async () => {
    const backupData = {
      version: '1.0.0',
      exportedAt: 1776288000,
      tables: {
        users: [{ id: 'user_mostafa', name: 'Mostafa Galal' }],
        tasks: [{ id: 'task_1_1', title: 'Deliver Embedded foundation' }],
      },
    };

    const jsonStr = JSON.stringify(backupData);
    const checksum1 = await sha256(jsonStr);
    const checksum2 = await sha256(jsonStr);

    expect(checksum1).toBe(checksum2);
    expect(checksum1.length).toBeGreaterThan(20);
  });

  it('detects tampering in restored backup payload', async () => {
    const originalBackup = {
      version: '1.0.0',
      tables: {
        users: [{ id: 'user_mostafa', role: 'super_admin' }],
      },
    };

    const originalJson = JSON.stringify(originalBackup);
    const originalChecksum = await sha256(originalJson);

    // Tampered payload
    const tamperedBackup = {
      version: '1.0.0',
      tables: {
        users: [{ id: 'user_mostafa', role: 'member' }],
      },
    };

    const tamperedJson = JSON.stringify(tamperedBackup);
    const tamperedChecksum = await sha256(tamperedJson);

    expect(tamperedChecksum).not.toBe(originalChecksum);
  });
});
