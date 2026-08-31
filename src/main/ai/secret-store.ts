import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AiSecretStatus } from '../../shared/ai';
import { ChronicleEngineError } from '../engine/service';

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class AiSecretStore {
  private readonly secretPath: string;
  private sessionKey: string | null = null;

  constructor(
    userDataDirectory: string,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.secretPath = path.join(userDataDirectory, 'secrets', 'openai-api-key.bin');
  }

  async getStatus(): Promise<AiSecretStatus> {
    const resolved = await this.resolve();
    return {
      configured: resolved.key !== null,
      source: resolved.source,
      persistence: resolved.source === 'safe-storage'
        ? 'encrypted'
        : resolved.source === 'environment'
          ? 'environment'
          : resolved.source === 'session'
            ? 'session'
            : 'none',
      maskedSuffix: resolved.key ? resolved.key.slice(-4) : null,
    };
  }

  async getKey(): Promise<string | null> {
    return (await this.resolve()).key;
  }

  async setKey(value: string): Promise<AiSecretStatus> {
    const key = normalizeKey(value);
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.sessionKey = key;
      return this.getStatus();
    }
    const encrypted = this.safeStorage.encryptString(key);
    const directory = path.dirname(this.secretPath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.openai-api-key-${randomUUID()}.tmp`);
    await writeFile(temporaryPath, encrypted, { mode: 0o600 });
    await rename(temporaryPath, this.secretPath);
    this.sessionKey = null;
    return this.getStatus();
  }

  async removeKey(): Promise<AiSecretStatus> {
    this.sessionKey = null;
    await rm(this.secretPath, { force: true });
    return this.getStatus();
  }

  private async resolve(): Promise<{
    key: string | null;
    source: AiSecretStatus['source'];
  }> {
    if (this.sessionKey) return { key: this.sessionKey, source: 'session' };
    if (this.safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = await readFile(this.secretPath);
        const key = normalizeKey(this.safeStorage.decryptString(encrypted));
        return { key, source: 'safe-storage' };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[AI] Encrypted API key could not be read.', safeError(error));
        }
      }
    }
    const environmentKey = this.environment.OPENAI_API_KEY?.trim();
    if (environmentKey) return { key: environmentKey, source: 'environment' };
    return { key: null, source: 'none' };
  }
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (!key) throw new ChronicleEngineError('INVALID_INPUT', 'API klíč nesmí být prázdný.');
  if (key.length < 20 || key.length > 512) {
    throw new ChronicleEngineError('INVALID_INPUT', 'API klíč nemá očekávanou délku.');
  }
  return key;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
