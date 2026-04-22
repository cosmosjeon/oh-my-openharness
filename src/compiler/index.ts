import { join } from 'node:path';
import type { CompileResult, HarnessProject } from '../core/types';
import { compileClaude } from './claude';
import { compileOpenCode } from './opencode';
import { compileCodex } from './codex';

export async function compileProjectForRuntime(project: HarnessProject, outDir: string): Promise<CompileResult> {
  switch (project.manifest.targetRuntime) {
    case 'claude-code':
      return compileClaude(project, join(outDir, 'claude-code'));
    case 'opencode':
      return compileOpenCode(project, join(outDir, 'opencode'));
    case 'codex':
      return compileCodex(project, join(outDir, 'codex'));
  }
}
