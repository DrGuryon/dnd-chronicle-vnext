import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiSecretStore, type SafeStorageAdapter } from '../src/main/ai/secret-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('AI secret storage', () => {
  it('persists only encrypted bytes and exposes only masked status', async () => {
    const directory = await createDirectory();
    const adapter: SafeStorageAdapter = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
      decryptString: (value) => Buffer.from(value.toString().replace('encrypted:', ''), 'base64').toString(),
    };
    const key = 'sk-proj-example-not-a-real-key-1234567890';
    const store = new AiSecretStore(directory, adapter, {});
    expect(await store.setKey(key)).toMatchObject({ configured: true, persistence: 'encrypted', maskedSuffix: '7890' });
    const bytes = await readFile(path.join(directory, 'secrets', 'openai-api-key.bin'), 'utf8');
    expect(bytes).not.toContain(key);
    expect(await new AiSecretStore(directory, adapter, {}).getKey()).toBe(key);
    expect(await store.removeKey()).toMatchObject({ configured: false, source: 'none' });
  });

  it('uses session memory instead of a plaintext fallback when encryption is unavailable', async () => {
    const directory = await createDirectory();
    const adapter: SafeStorageAdapter = {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('unavailable'); },
      decryptString: () => { throw new Error('unavailable'); },
    };
    const store = new AiSecretStore(directory, adapter, {});
    expect(await store.setKey('sk-proj-session-only-example-1234567890')).toMatchObject({
      source: 'session', persistence: 'session',
    });
    expect(await new AiSecretStore(directory, adapter, {}).getKey()).toBeNull();
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-m6-secret-'));
  temporaryDirectories.push(directory);
  return directory;
}
