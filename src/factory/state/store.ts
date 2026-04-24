import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHarnessFactoryState, validateHarnessFactoryState, withFactoryStateUpdate, type CreateHarnessFactoryStateInput, type HarnessFactoryState } from './schema';

export interface HarnessFactoryStore {
  rootDir: string;
  statePath(sessionId: string): string;
  create(input: CreateHarnessFactoryStateInput): Promise<HarnessFactoryState>;
  load(sessionId: string): Promise<HarnessFactoryState>;
  save(state: HarnessFactoryState): Promise<HarnessFactoryState>;
  update(sessionId: string, updater: (state: HarnessFactoryState) => HarnessFactoryState | Partial<HarnessFactoryState>): Promise<HarnessFactoryState>;
}

function safeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) throw new Error('Harness Factory session id may contain only letters, numbers, dot, underscore, and dash.');
  return normalized;
}

export function createHarnessFactoryStore(rootDir: string): HarnessFactoryStore {
  const resolvedRoot = resolve(rootDir);
  const statePath = (sessionId: string) => join(resolvedRoot, `${safeSessionId(sessionId)}.json`);

  return {
    rootDir: resolvedRoot,
    statePath,
    async create(input) {
      const state = createHarnessFactoryState(input);
      return this.save(state);
    },
    async load(sessionId) {
      return validateHarnessFactoryState(JSON.parse(await readFile(statePath(sessionId), 'utf8')));
    },
    async save(state) {
      const valid = validateHarnessFactoryState(state);
      await mkdir(resolvedRoot, { recursive: true });
      await writeFile(statePath(valid.sessionId), JSON.stringify(valid, null, 2));
      return valid;
    },
    async update(sessionId, updater) {
      const current = await this.load(sessionId);
      const next = updater(current);
      const merged = 'schemaVersion' in next && 'sessionId' in next ? (next as HarnessFactoryState) : withFactoryStateUpdate(current, next as Partial<HarnessFactoryState>);
      return this.save(merged);
    }
  };
}

export * from './schema';
