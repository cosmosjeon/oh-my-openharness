import { describe, expect, test } from 'bun:test';
import { generateHarnessProject } from '../src/core/generator';
import { expectedTraceEventTypes, traceSchema } from '../src/compiler/runtime-common';
import { auditTraceEvents } from '../src/sandbox/validate';
import type { TraceEvent } from '../src/core/types';

describe('runtime-backed trace validation helpers', () => {
  test('derives expected trace coverage from the canonical project graph', () => {
    const project = generateHarnessProject('trace-coverage', 'Create a harness with approval flow, mcp server, state memory, and review loop');

    expect(expectedTraceEventTypes(project)).toEqual([
      'hook-activation',
      'branch-selection',
      'state-transition',
      'loop-iteration',
      'mcp-server'
    ]);
    expect(traceSchema(project).expectedEventTypes).toEqual(expectedTraceEventTypes(project));
  });

  test('reports schema violations and missing runtime proof coverage', () => {
    const project = generateHarnessProject('trace-audit', 'Create a harness with approval flow, mcp server, state memory, and review loop');
    const schema = traceSchema(project);
    const now = new Date().toISOString();
    const events: TraceEvent[] = [
      {
        timestamp: now,
        eventType: 'hook-activation',
        hook: 'SessionStart',
        nodeId: 'sessionstart-1',
        status: 'ok',
        message: 'ready',
        metadata: { graphHash: 'graph-hash-only' }
      }
    ];

    const audit = auditTraceEvents(events, schema);

    expect(audit.missingEventTypes).toEqual([
      'branch-selection',
      'state-transition',
      'loop-iteration',
      'mcp-server'
    ]);
    expect(audit.violations.some((violation) => violation.includes('metadata.runtime'))).toBe(true);
  });

  test('trace schema preserves debugger-required failure and MCP event types', () => {
    const project = generateHarnessProject('trace-debugger-schema', 'Create a harness with mcp server and review loop');
    const schema = traceSchema(project);

    expect(schema.eventTypes).toContain('failure');
    expect(schema.eventTypes).toContain('mcp-server');
  });
});
