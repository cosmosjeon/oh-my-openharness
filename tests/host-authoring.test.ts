import { describe, expect, test } from 'bun:test';
import { applyHostAuthoring } from '../src/core/host-authoring';
import { generateHarnessProject } from '../src/core/generator';

describe('host authoring bridge', () => {
  test('applies host-native guidance to the canonical project summary and primary skill', () => {
    const project = generateHarnessProject('hosted', 'Create a harness with state memory', 'codex');
    const updated = applyHostAuthoring(project, {
      runtime: 'codex',
      summary: 'Codex-guided authoring summary',
      emphasis: ['state', 'review'],
      warnings: ['Host runtime returned a compact plan'],
      rawOutput: '{"summary":"Codex-guided authoring summary","emphasis":["state","review"],"warnings":["Host runtime returned a compact plan"]}',
      command: 'codex exec <prompt>'
    });

    expect(updated.authoring.summary).toBe('Codex-guided authoring summary');
    expect(updated.authoring.warnings).toContain('Host runtime returned a compact plan');
    expect(updated.skills[0]?.content).toContain('Host-native authoring guidance');
    expect(updated.skills[0]?.content).toContain('Codex-guided authoring summary');
  });
});
