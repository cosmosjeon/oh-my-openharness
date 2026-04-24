import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createHarnessFactoryState, type CreateHarnessFactoryStateInput, type HarnessFactoryState } from './schema';

export const DEFAULT_HARNESS_FACTORY_STATE_PATH = '.omx/state/harness-factory/state.json';

function resolveContainedPath(baseDir: string, relativePath: string): string {
  const resolvedBaseDir = resolve(baseDir);
  const candidate = resolve(resolvedBaseDir, relativePath);
  const candidateRelative = relative(resolvedBaseDir, candidate);
  if (candidateRelative.startsWith('..') || isAbsolute(candidateRelative)) {
    throw new Error(`Harness factory state path must stay within ${resolvedBaseDir}.`);
  }
  return candidate;
}

export function resolveHarnessFactoryStatePath(baseDir: string, relativePath = DEFAULT_HARNESS_FACTORY_STATE_PATH): string {
  return resolveContainedPath(baseDir, relativePath);
}

export async function readHarnessFactoryState(baseDir: string, relativePath = DEFAULT_HARNESS_FACTORY_STATE_PATH): Promise<HarnessFactoryState | undefined> {
  const statePath = resolveHarnessFactoryStatePath(baseDir, relativePath);
  try {
    return JSON.parse(await readFile(statePath, 'utf8')) as HarnessFactoryState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeHarnessFactoryState(baseDir: string, state: HarnessFactoryState, relativePath = DEFAULT_HARNESS_FACTORY_STATE_PATH): Promise<string> {
  const statePath = resolveHarnessFactoryStatePath(baseDir, relativePath);
  await mkdir(dirname(statePath), { recursive: true });
  const normalizedState = createHarnessFactoryState({
    ...state,
    draft: state.draft,
    draftGraphSpec: state.draftGraphSpec
  });
  await writeFile(statePath, JSON.stringify(normalizedState, null, 2));
  return statePath;
}

export async function updateHarnessFactoryState(
  baseDir: string,
  updater: (state: HarnessFactoryState | undefined) => HarnessFactoryState,
  options?: {
    relativePath?: string;
    initialState?: CreateHarnessFactoryStateInput;
  }
): Promise<HarnessFactoryState> {
  const existing = await readHarnessFactoryState(baseDir, options?.relativePath);
  const nextState = updater(existing ?? (options?.initialState ? createHarnessFactoryState(options.initialState) : undefined));
  await writeHarnessFactoryState(baseDir, nextState, options?.relativePath);
  return nextState;
}

export function createHarnessFactoryStateStore(baseDir: string, relativePath = DEFAULT_HARNESS_FACTORY_STATE_PATH) {
  return {
    path: resolveHarnessFactoryStatePath(baseDir, relativePath),
    load: () => readHarnessFactoryState(baseDir, relativePath),
    save: (state: HarnessFactoryState) => writeHarnessFactoryState(baseDir, state, relativePath),
    update: (updater: (state: HarnessFactoryState | undefined) => HarnessFactoryState, initialState?: CreateHarnessFactoryStateInput) =>
      updateHarnessFactoryState(baseDir, updater, { relativePath, ...(initialState ? { initialState } : {}) })
  };
}
