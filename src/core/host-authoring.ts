import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeRuntimeTarget } from './runtime-targets';
import { resolveRuntimeAuthoringConfigRoot } from './runtime-setup';
import type {
  GraphEdge,
  GraphNode,
  HarnessProject,
  HostAuthoringGraphDelta,
  HostAuthoringPayload,
  HostAuthoringSkillUpdate,
  NodeKind,
  RuntimeIntentKind,
  RuntimeIntent,
  RuntimeTarget,
  SafetyLevel,
  SkillFile
} from './types';

export interface HostAuthoringResult extends HostAuthoringPayload {
  runtime: RuntimeTarget;
  rawOutput: string;
  command: string;
}

const NODE_KINDS = new Set<NodeKind>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Skill',
  'Agent',
  'Condition',
  'Loop',
  'StateRead',
  'StateWrite',
  'MCPServer',
  'SystemPrompt',
  'Permission',
  'Merge',
  'Sequence',
  'CustomBlock'
]);
const RUNTIME_INTENT_KINDS = new Set<RuntimeIntentKind>(['hook', 'mcp-server', 'state', 'custom-runtime']);
const RUNTIME_TARGETS = new Set<RuntimeTarget>(['claude-code', 'opencode', 'codex']);
const SAFETY_LEVELS = new Set<SafetyLevel>(['safe', 'confirm']);
const RUNTIME_TRANSPORTS = new Set<NonNullable<RuntimeIntent['transport']>>(['stdio', 'in-memory']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNonEmptyString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string.`);
  return value;
}

function assertString(value: unknown, label: string): string {
  assert(typeof value === 'string', `${label} must be a string.`);
  return value;
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, label);
}

function assertStringArray(value: unknown, label: string): string[] {
  assert(Array.isArray(value), `${label} must be an array of strings.`);
  const strings = value.map((entry, index) => assertNonEmptyString(entry, `${label}[${index}]`));
  assert(new Set(strings).size === strings.length, `${label} must not contain duplicates.`);
  return strings;
}

function assertOptionalConfig(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  assert(isRecord(value), `${label} must be an object.`);
  return value;
}

function assertNodeKind(value: unknown, label: string): NodeKind {
  const kind = assertNonEmptyString(value, label) as NodeKind;
  assert(NODE_KINDS.has(kind), `${label} must be a supported node kind.`);
  return kind;
}

function assertRuntimeIntentKind(value: unknown, label: string): RuntimeIntentKind {
  const kind = assertNonEmptyString(value, label) as RuntimeIntentKind;
  assert(RUNTIME_INTENT_KINDS.has(kind), `${label} must be a supported runtime intent kind.`);
  return kind;
}

function assertRuntimeTarget(value: unknown, label: string): RuntimeTarget {
  const runtime = assertNonEmptyString(value, label) as RuntimeTarget;
  assert(RUNTIME_TARGETS.has(runtime), `${label} must be a supported runtime target.`);
  return runtime;
}

function assertSafetyLevel(value: unknown, label: string): SafetyLevel {
  const safety = assertNonEmptyString(value, label) as SafetyLevel;
  assert(SAFETY_LEVELS.has(safety), `${label} must be a supported safety level.`);
  return safety;
}

function assertTransport(value: unknown, label: string): NonNullable<RuntimeIntent['transport']> | undefined {
  if (value === undefined) return undefined;
  const transport = assertNonEmptyString(value, label) as NonNullable<RuntimeIntent['transport']>;
  assert(RUNTIME_TRANSPORTS.has(transport), `${label} must be a supported transport.`);
  return transport;
}

function normalizeSkillPath(path: string, label: string): string {
  const trimmed = assertNonEmptyString(path, label).trim();
  assert(!trimmed.includes('\0'), `${label} must not contain null bytes.`);
  const normalized = trimmed.replaceAll('\\', '/');
  assert(!normalized.startsWith('/'), `${label} must be relative.`);
  const segments = normalized.split('/').filter(Boolean);
  assert(segments.length > 0, `${label} must point to a file inside the skills directory.`);
  assert(segments.every((segment) => segment !== '.' && segment !== '..'), `${label} must stay within the skills directory.`);
  return segments.join('/');
}

function validateFinalSkills(skills: SkillFile[]): void {
  assert(skills.length > 0, 'Host authoring must preserve at least one skill file.');
  const ids = new Set<string>();
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const skill of skills) {
    assertNonEmptyString(skill.id, `Skill ${skill.name || '(unknown)'} id`);
    assertNonEmptyString(skill.name, `Skill ${skill.id} name`);
    assert(typeof skill.description === 'string', `Skill ${skill.id} description must be a string.`);
    assert(typeof skill.content === 'string', `Skill ${skill.id} content must be a string.`);
    assert(!ids.has(skill.id), `Skill ids must be unique; found duplicate ${skill.id}.`);
    assert(!names.has(skill.name), `Skill names must be unique; found duplicate ${skill.name}.`);
    ids.add(skill.id);
    names.add(skill.name);
    const normalizedPath = normalizeSkillPath(skill.path ?? `${skill.name}.md`, `Skill ${skill.id} path`);
    assert(!paths.has(normalizedPath), `Skill paths must be unique; found duplicate ${normalizedPath}.`);
    paths.add(normalizedPath);
  }
}

function validateFinalGraph(project: HarnessProject, nodes: GraphNode[], edges: GraphEdge[], runtimeIntents: RuntimeIntent[] | undefined, skills: SkillFile[]): void {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    assertNonEmptyString(node.id, 'Node id');
    assertNodeKind(node.kind, `Node ${node.id} kind`);
    assert(typeof node.label === 'string', `Node ${node.id} label must be a string.`);
    assert(!nodeIds.has(node.id), `Node ids must be unique; found duplicate ${node.id}.`);
    nodeIds.add(node.id);
    assertOptionalConfig(node.config, `Node ${node.id} config`);
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    assertNonEmptyString(edge.id, 'Edge id');
    assertNonEmptyString(edge.from, `Edge ${edge.id} from`);
    assertNonEmptyString(edge.to, `Edge ${edge.id} to`);
    assert(typeof edge.label === 'string' || edge.label === undefined, `Edge ${edge.id} label must be a string when provided.`);
    assert(!edgeIds.has(edge.id), `Edge ids must be unique; found duplicate ${edge.id}.`);
    assert(nodeIds.has(edge.from) && nodeIds.has(edge.to), `Edge ${edge.id} must reference live nodes.`);
    edgeIds.add(edge.id);
  }

  if (runtimeIntents) {
    const intentIds = new Set<string>();
    for (const intent of runtimeIntents) {
      assertNonEmptyString(intent.id, 'Runtime intent id');
      assertRuntimeIntentKind(intent.kind, `Runtime intent ${intent.id} kind`);
      assert(typeof intent.label === 'string', `Runtime intent ${intent.id} label must be a string.`);
      assertRuntimeTarget(intent.targetRuntime, `Runtime intent ${intent.id} targetRuntime`);
      assert(intent.targetRuntime === project.manifest.targetRuntime, `Runtime intent ${intent.id} must target ${project.manifest.targetRuntime}.`);
      assert(Array.isArray(intent.sourceNodeIds) && intent.sourceNodeIds.length > 0, `Runtime intent ${intent.id} must reference at least one source node.`);
      const sourceNodeIds = assertStringArray(intent.sourceNodeIds, `Runtime intent ${intent.id} sourceNodeIds`);
      assert(sourceNodeIds.every((nodeId) => nodeIds.has(nodeId)), `Runtime intent ${intent.id} must reference live nodes only.`);
      assertTransport(intent.transport, `Runtime intent ${intent.id} transport`);
      assertSafetyLevel(intent.safety, `Runtime intent ${intent.id} safety`);
      assert(!intentIds.has(intent.id), `Runtime intent ids must be unique; found duplicate ${intent.id}.`);
      intentIds.add(intent.id);
    }
  }

  validateFinalSkills(skills);
}

function validateGraphDelta(project: HarnessProject, graphDelta: unknown): HostAuthoringGraphDelta | undefined {
  if (graphDelta === undefined) return undefined;
  assert(isRecord(graphDelta), 'Host authoring graphDelta must be an object.');

  const manifest = graphDelta.manifest;
  const manifestDelta =
    manifest === undefined
      ? undefined
      : (() => {
          assert(isRecord(manifest), 'Host authoring manifest delta must be an object.');
          return {
            ...(manifest.description !== undefined ? { description: assertOptionalString(manifest.description, 'Host authoring manifest.description') } : {})
          };
        })();

  const existingNodeIds = new Set(project.nodes.map((node) => node.id));
  const nodes = graphDelta.nodes;
  const nodeDelta =
    nodes === undefined
      ? undefined
      : (() => {
          assert(isRecord(nodes), 'Host authoring nodes delta must be an object.');
          const remove = nodes.remove === undefined ? undefined : assertStringArray(nodes.remove, 'Host authoring nodes.remove');
          const removedIds = new Set(remove ?? []);
          for (const id of removedIds) {
            assert(existingNodeIds.has(id), `Host authoring cannot remove unknown node ${id}.`);
          }

          const add =
            nodes.add === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(nodes.add), 'Host authoring nodes.add must be an array.');
                  const additions = nodes.add.map((item, index) => {
                    assert(isRecord(item), `Host authoring nodes.add[${index}] must be an object.`);
                    return {
                      id: assertNonEmptyString(item.id, `Host authoring nodes.add[${index}].id`),
                      kind: assertNodeKind(item.kind, `Host authoring nodes.add[${index}].kind`),
                      label: assertString(item.label, `Host authoring nodes.add[${index}].label`),
                      ...(item.config !== undefined ? { config: assertOptionalConfig(item.config, `Host authoring nodes.add[${index}].config`) } : {})
                    } satisfies GraphNode;
                  });
                  const addIds = new Set<string>();
                  for (const node of additions) {
                    assert(!existingNodeIds.has(node.id), `Host authoring cannot re-add existing node ${node.id}.`);
                    assert(!removedIds.has(node.id), `Host authoring cannot remove and add node ${node.id} in the same delta.`);
                    assert(!addIds.has(node.id), `Host authoring nodes.add contains duplicate node id ${node.id}.`);
                    addIds.add(node.id);
                  }
                  return additions;
                })();

          const update =
            nodes.update === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(nodes.update), 'Host authoring nodes.update must be an array.');
                  const seen = new Set<string>();
                  return nodes.update.map((item, index) => {
                    assert(isRecord(item), `Host authoring nodes.update[${index}] must be an object.`);
                    const id = assertNonEmptyString(item.id, `Host authoring nodes.update[${index}].id`);
                    assert(existingNodeIds.has(id), `Host authoring cannot update unknown node ${id}.`);
                    assert(!removedIds.has(id), `Host authoring cannot update removed node ${id}.`);
                    assert(!seen.has(id), `Host authoring nodes.update contains duplicate node id ${id}.`);
                    seen.add(id);
                    return {
                      id,
                      ...(item.kind !== undefined ? { kind: assertNodeKind(item.kind, `Host authoring nodes.update[${index}].kind`) } : {}),
                      ...(item.label !== undefined ? { label: assertOptionalString(item.label, `Host authoring nodes.update[${index}].label`) } : {}),
                      ...(item.config !== undefined ? { config: assertOptionalConfig(item.config, `Host authoring nodes.update[${index}].config`) } : {})
                    };
                  });
                })();

          return {
            ...(add ? { add } : {}),
            ...(update ? { update } : {}),
            ...(remove ? { remove } : {})
          } satisfies NonNullable<HostAuthoringGraphDelta['nodes']>;
        })();

  const liveNodeIds = new Set(project.nodes.filter((node) => !(nodeDelta?.remove ?? []).includes(node.id)).map((node) => node.id));
  for (const node of nodeDelta?.add ?? []) liveNodeIds.add(node.id);

  const existingEdgeIds = new Set(project.edges.map((edge) => edge.id));
  const edges = graphDelta.edges;
  const edgeDelta =
    edges === undefined
      ? undefined
      : (() => {
          assert(isRecord(edges), 'Host authoring edges delta must be an object.');
          const remove = edges.remove === undefined ? undefined : assertStringArray(edges.remove, 'Host authoring edges.remove');
          const removedIds = new Set(remove ?? []);
          for (const id of removedIds) {
            assert(existingEdgeIds.has(id), `Host authoring cannot remove unknown edge ${id}.`);
          }

          const add =
            edges.add === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(edges.add), 'Host authoring edges.add must be an array.');
                  const additions = edges.add.map((item, index) => {
                    assert(isRecord(item), `Host authoring edges.add[${index}] must be an object.`);
                    const id = assertNonEmptyString(item.id, `Host authoring edges.add[${index}].id`);
                    const from = assertNonEmptyString(item.from, `Host authoring edges.add[${index}].from`);
                    const to = assertNonEmptyString(item.to, `Host authoring edges.add[${index}].to`);
                    assert(liveNodeIds.has(from) && liveNodeIds.has(to), `Host authoring edge ${id} must connect live nodes.`);
                    return {
                      id,
                      from,
                      to,
                      ...(item.label !== undefined ? { label: assertOptionalString(item.label, `Host authoring edges.add[${index}].label`) } : {})
                    } satisfies GraphEdge;
                  });
                  const addIds = new Set<string>();
                  for (const edge of additions) {
                    assert(!existingEdgeIds.has(edge.id), `Host authoring cannot re-add existing edge ${edge.id}.`);
                    assert(!removedIds.has(edge.id), `Host authoring cannot remove and add edge ${edge.id} in the same delta.`);
                    assert(!addIds.has(edge.id), `Host authoring edges.add contains duplicate edge id ${edge.id}.`);
                    addIds.add(edge.id);
                  }
                  return additions;
                })();

          const update =
            edges.update === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(edges.update), 'Host authoring edges.update must be an array.');
                  const seen = new Set<string>();
                  return edges.update.map((item, index) => {
                    assert(isRecord(item), `Host authoring edges.update[${index}] must be an object.`);
                    const id = assertNonEmptyString(item.id, `Host authoring edges.update[${index}].id`);
                    assert(existingEdgeIds.has(id), `Host authoring cannot update unknown edge ${id}.`);
                    assert(!removedIds.has(id), `Host authoring cannot update removed edge ${id}.`);
                    assert(!seen.has(id), `Host authoring edges.update contains duplicate edge id ${id}.`);
                    seen.add(id);
                    const from = item.from === undefined ? undefined : assertNonEmptyString(item.from, `Host authoring edges.update[${index}].from`);
                    const to = item.to === undefined ? undefined : assertNonEmptyString(item.to, `Host authoring edges.update[${index}].to`);
                    if (from !== undefined) assert(liveNodeIds.has(from), `Host authoring edge ${id} must reference a live from node.`);
                    if (to !== undefined) assert(liveNodeIds.has(to), `Host authoring edge ${id} must reference a live to node.`);
                    return {
                      id,
                      ...(from !== undefined ? { from } : {}),
                      ...(to !== undefined ? { to } : {}),
                      ...(item.label !== undefined ? { label: assertOptionalString(item.label, `Host authoring edges.update[${index}].label`) } : {})
                    };
                  });
                })();

          return {
            ...(add ? { add } : {}),
            ...(update ? { update } : {}),
            ...(remove ? { remove } : {})
          } satisfies NonNullable<HostAuthoringGraphDelta['edges']>;
        })();

  const existingIntentIds = new Set((project.runtimeIntents ?? []).map((intent) => intent.id));
  const runtimeIntents = graphDelta.runtimeIntents;
  const runtimeIntentDelta =
    runtimeIntents === undefined
      ? undefined
      : (() => {
          assert(isRecord(runtimeIntents), 'Host authoring runtimeIntents delta must be an object.');
          const remove =
            runtimeIntents.remove === undefined ? undefined : assertStringArray(runtimeIntents.remove, 'Host authoring runtimeIntents.remove');
          const removedIds = new Set(remove ?? []);
          for (const id of removedIds) {
            assert(existingIntentIds.has(id), `Host authoring cannot remove unknown runtime intent ${id}.`);
          }

          const add =
            runtimeIntents.add === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(runtimeIntents.add), 'Host authoring runtimeIntents.add must be an array.');
                  const additions = runtimeIntents.add.map((item, index) => {
                    assert(isRecord(item), `Host authoring runtimeIntents.add[${index}] must be an object.`);
                    const id = assertNonEmptyString(item.id, `Host authoring runtimeIntents.add[${index}].id`);
                    const sourceNodeIds = assertStringArray(item.sourceNodeIds, `Host authoring runtimeIntents.add[${index}].sourceNodeIds`);
                    assert(sourceNodeIds.every((nodeId) => liveNodeIds.has(nodeId)), `Host authoring runtime intent ${id} must reference live nodes.`);
                    const targetRuntime = assertRuntimeTarget(item.targetRuntime, `Host authoring runtimeIntents.add[${index}].targetRuntime`);
                    assert(targetRuntime === project.manifest.targetRuntime, `Host authoring runtime intent ${id} must target ${project.manifest.targetRuntime}.`);
                    return {
                      id,
                      kind: assertRuntimeIntentKind(item.kind, `Host authoring runtimeIntents.add[${index}].kind`),
                      label: assertString(item.label, `Host authoring runtimeIntents.add[${index}].label`),
                      targetRuntime,
                      sourceNodeIds,
                      ...(item.transport !== undefined ? { transport: assertTransport(item.transport, `Host authoring runtimeIntents.add[${index}].transport`) } : {}),
                      safety: assertSafetyLevel(item.safety, `Host authoring runtimeIntents.add[${index}].safety`)
                    } satisfies RuntimeIntent;
                  });
                  const addIds = new Set<string>();
                  for (const intent of additions) {
                    assert(!existingIntentIds.has(intent.id), `Host authoring cannot re-add existing runtime intent ${intent.id}.`);
                    assert(!removedIds.has(intent.id), `Host authoring cannot remove and add runtime intent ${intent.id} in the same delta.`);
                    assert(!addIds.has(intent.id), `Host authoring runtimeIntents.add contains duplicate intent id ${intent.id}.`);
                    addIds.add(intent.id);
                  }
                  return additions;
                })();

          const update =
            runtimeIntents.update === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(runtimeIntents.update), 'Host authoring runtimeIntents.update must be an array.');
                  const seen = new Set<string>();
                  return runtimeIntents.update.map((item, index) => {
                    assert(isRecord(item), `Host authoring runtimeIntents.update[${index}] must be an object.`);
                    const id = assertNonEmptyString(item.id, `Host authoring runtimeIntents.update[${index}].id`);
                    assert(existingIntentIds.has(id), `Host authoring cannot update unknown runtime intent ${id}.`);
                    assert(!removedIds.has(id), `Host authoring cannot update removed runtime intent ${id}.`);
                    assert(!seen.has(id), `Host authoring runtimeIntents.update contains duplicate intent id ${id}.`);
                    seen.add(id);
                    const sourceNodeIds =
                      item.sourceNodeIds === undefined
                        ? undefined
                        : assertStringArray(item.sourceNodeIds, `Host authoring runtimeIntents.update[${index}].sourceNodeIds`);
                    if (sourceNodeIds) {
                      assert(sourceNodeIds.every((nodeId) => liveNodeIds.has(nodeId)), `Host authoring runtime intent ${id} must reference live nodes.`);
                    }
                    const targetRuntime =
                      item.targetRuntime === undefined
                        ? undefined
                        : assertRuntimeTarget(item.targetRuntime, `Host authoring runtimeIntents.update[${index}].targetRuntime`);
                    if (targetRuntime !== undefined) {
                      assert(targetRuntime === project.manifest.targetRuntime, `Host authoring runtime intent ${id} must target ${project.manifest.targetRuntime}.`);
                    }
                    return {
                      id,
                      ...(item.kind !== undefined ? { kind: assertRuntimeIntentKind(item.kind, `Host authoring runtimeIntents.update[${index}].kind`) } : {}),
                      ...(item.label !== undefined ? { label: assertOptionalString(item.label, `Host authoring runtimeIntents.update[${index}].label`) } : {}),
                      ...(targetRuntime !== undefined ? { targetRuntime } : {}),
                      ...(sourceNodeIds !== undefined ? { sourceNodeIds } : {}),
                      ...(item.transport !== undefined ? { transport: assertTransport(item.transport, `Host authoring runtimeIntents.update[${index}].transport`) } : {}),
                      ...(item.safety !== undefined ? { safety: assertSafetyLevel(item.safety, `Host authoring runtimeIntents.update[${index}].safety`) } : {})
                    };
                  });
                })();

          return {
            ...(add ? { add } : {}),
            ...(update ? { update } : {}),
            ...(remove ? { remove } : {})
          } satisfies NonNullable<HostAuthoringGraphDelta['runtimeIntents']>;
        })();

  const skills = graphDelta.skills;
  const skillDelta =
    skills === undefined
      ? undefined
      : (() => {
          assert(isRecord(skills), 'Host authoring skills delta must be an object.');
          const remove = skills.remove === undefined ? undefined : assertStringArray(skills.remove, 'Host authoring skills.remove');
          const removedSelectors = new Set(remove ?? []);
          for (const selector of removedSelectors) {
            assert(project.skills.some((skill) => skill.id === selector || skill.name === selector), `Host authoring cannot remove unknown skill ${selector}.`);
          }

          const add =
            skills.add === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(skills.add), 'Host authoring skills.add must be an array.');
                  const additions = skills.add.map((item, index) => {
                    assert(isRecord(item), `Host authoring skills.add[${index}] must be an object.`);
                    const path = item.path === undefined ? undefined : normalizeSkillPath(assertOptionalString(item.path, `Host authoring skills.add[${index}].path`) ?? '', `Host authoring skills.add[${index}].path`);
                    return {
                      id: assertNonEmptyString(item.id, `Host authoring skills.add[${index}].id`),
                      name: assertNonEmptyString(item.name, `Host authoring skills.add[${index}].name`),
                      description: assertString(item.description, `Host authoring skills.add[${index}].description`),
                      content: assertString(item.content, `Host authoring skills.add[${index}].content`),
                      ...(path ? { path } : {})
                    } satisfies SkillFile;
                  });
                  const addIds = new Set<string>();
                  const addNames = new Set<string>();
                  for (const skill of additions) {
                    assert(project.skills.every((existing) => existing.id !== skill.id), `Host authoring cannot re-add existing skill ${skill.id}.`);
                    assert(project.skills.every((existing) => existing.name !== skill.name), `Host authoring cannot re-add existing skill name ${skill.name}.`);
                    assert(!addIds.has(skill.id), `Host authoring skills.add contains duplicate skill id ${skill.id}.`);
                    assert(!addNames.has(skill.name), `Host authoring skills.add contains duplicate skill name ${skill.name}.`);
                    addIds.add(skill.id);
                    addNames.add(skill.name);
                  }
                  return additions;
                })();

          const update =
            skills.update === undefined
              ? undefined
              : (() => {
                  assert(Array.isArray(skills.update), 'Host authoring skills.update must be an array.');
                  const seen = new Set<string>();
                  return skills.update.map((item, index) => {
                    assert(isRecord(item), `Host authoring skills.update[${index}] must be an object.`);
                    const typed = item as Record<string, unknown>;
                    assert(typed.id !== undefined || typed.name !== undefined, `Host authoring skills.update[${index}] must target a skill by id or name.`);
                    const update = {
                      ...(typed.id !== undefined ? { id: assertNonEmptyString(typed.id, `Host authoring skills.update[${index}].id`) } : {}),
                      ...(typed.name !== undefined ? { name: assertNonEmptyString(typed.name, `Host authoring skills.update[${index}].name`) } : {}),
                      ...(typed.description !== undefined ? { description: assertOptionalString(typed.description, `Host authoring skills.update[${index}].description`) } : {}),
                      ...(typed.content !== undefined ? { content: assertOptionalString(typed.content, `Host authoring skills.update[${index}].content`) } : {}),
                      ...(typed.appendContent !== undefined ? { appendContent: assertOptionalString(typed.appendContent, `Host authoring skills.update[${index}].appendContent`) } : {})
                    } satisfies HostAuthoringSkillUpdate;
                    const matches = project.skills.filter((skill) => matchSkill(skill, update));
                    assert(matches.length === 1, `Host authoring skills.update[${index}] must match exactly one existing skill.`);
                    const selector = update.id ?? `name:${update.name}`;
                    assert(!removedSelectors.has(matches[0]!.id) && !removedSelectors.has(matches[0]!.name), `Host authoring cannot update removed skill ${matches[0]!.id}.`);
                    assert(!seen.has(selector), `Host authoring skills.update contains duplicate selector ${selector}.`);
                    seen.add(selector);
                    return update;
                  });
                })();

          return {
            ...(add ? { add } : {}),
            ...(update ? { update } : {}),
            ...(remove ? { remove } : {})
          } satisfies NonNullable<HostAuthoringGraphDelta['skills']>;
        })();

  return {
    ...(manifestDelta ? { manifest: manifestDelta } : {}),
    ...(nodeDelta ? { nodes: nodeDelta } : {}),
    ...(edgeDelta ? { edges: edgeDelta } : {}),
    ...(runtimeIntentDelta ? { runtimeIntents: runtimeIntentDelta } : {}),
    ...(skillDelta ? { skills: skillDelta } : {})
  };
}

function hostPrompt(prompt: string, runtime: RuntimeTarget): string {
  const runtimeName = describeRuntimeTarget(runtime).authoringNoun;
  return [
    `You are authoring inside ${runtimeName} for oh-my-openharness.`,
    'Do not inspect the workspace or use tools. Respond from the user request only.',
    'Return ONLY valid JSON with this exact shape:',
    '{"summary":"string","emphasis":["string"],"warnings":["string"],"graphDelta":{"manifest":{"description":"string"},"nodes":{"add":[{"id":"string","kind":"SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|Skill|Agent|Condition|Loop|StateRead|StateWrite|MCPServer|SystemPrompt|Permission|Merge|Sequence|CustomBlock","label":"string","config":{"key":"value"}}],"update":[{"id":"string","label":"string","config":{"key":"value"}}],"remove":["string"]},"edges":{"add":[{"id":"string","from":"string","to":"string","label":"string"}],"update":[{"id":"string","label":"string"}],"remove":["string"]},"runtimeIntents":{"add":[{"id":"string","kind":"hook|mcp-server|state|custom-runtime","label":"string","targetRuntime":"claude-code|opencode|codex","sourceNodeIds":["string"],"transport":"stdio|in-memory","safety":"safe|confirm"}],"update":[{"id":"string","label":"string","sourceNodeIds":["string"]}],"remove":["string"]},"skills":{"add":[{"id":"string","name":"string","description":"string","content":"string","path":"string"}],"update":[{"id":"string","name":"string","description":"string","content":"string","appendContent":"string"}],"remove":["string"]}}}',
    'Use graphDelta only when you need to change canonical project structure or runtime intent/skill content.',
    'Do not include markdown fences or extra commentary.',
    `User request: ${prompt}`
  ].join(' ');
}

function commandForRuntime(runtime: RuntimeTarget, prompt: string): { command: string; args: string[] } {
  const compiledPrompt = hostPrompt(prompt, runtime);
  switch (runtime) {
    case 'claude-code':
      return { command: 'claude', args: ['-p', compiledPrompt] };
    case 'opencode':
      return { command: 'opencode', args: ['--pure', 'run', compiledPrompt] };
    case 'codex':
      return { command: 'codex', args: ['exec', compiledPrompt] };
  }
}

function parseJsonLine(text: string): HostAuthoringPayload {
  const trimmed = text.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<HostAuthoringPayload>;
      if (typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary,
          emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.filter((item): item is string => typeof item === 'string') : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
          ...(parsed.graphDelta ? { graphDelta: parsed.graphDelta } : {})
        };
      }
    } catch {}
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line) as Partial<HostAuthoringPayload>;
      if (typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary,
          emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.filter((item): item is string => typeof item === 'string') : [],
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
          ...(parsed.graphDelta ? { graphDelta: parsed.graphDelta } : {})
        };
      }
    } catch {}
  }
  throw new Error('Host authoring output did not contain a valid JSON payload.');
}

function upsertById<T extends { id: string }>(items: T[], additions: T[] = []): T[] {
  const byId = new Map(items.map((item) => [item.id, item] satisfies [string, T]));
  for (const item of additions) byId.set(item.id, item);
  return [...byId.values()];
}

function applyNodeDelta(nodes: GraphNode[], delta: HostAuthoringGraphDelta['nodes']): GraphNode[] {
  if (!delta) return nodes;
  const removed = new Set(delta.remove ?? []);
  const byId = new Map(nodes.filter((node) => !removed.has(node.id)).map((node) => [node.id, node] satisfies [string, GraphNode]));
  for (const update of delta.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    byId.set(update.id, {
      ...existing,
      ...(update.kind ? { kind: update.kind } : {}),
      ...(update.label ? { label: update.label } : {}),
      ...(update.config ? { config: update.config } : {})
    });
  }
  for (const node of delta.add ?? []) byId.set(node.id, node);
  return [...byId.values()];
}

function applyEdgeDelta(edges: GraphEdge[], delta: HostAuthoringGraphDelta['edges'], liveNodeIds: Set<string>): GraphEdge[] {
  if (!delta) return edges.filter((edge) => liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to));
  const removed = new Set(delta.remove ?? []);
  const byId = new Map(
    edges
      .filter((edge) => !removed.has(edge.id))
      .filter((edge) => liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to))
      .map((edge) => [edge.id, edge] satisfies [string, GraphEdge])
  );
  for (const update of delta.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const next = {
      ...existing,
      ...(update.from ? { from: update.from } : {}),
      ...(update.to ? { to: update.to } : {}),
      ...(update.label !== undefined ? { label: update.label } : {})
    };
    if (liveNodeIds.has(next.from) && liveNodeIds.has(next.to)) byId.set(update.id, next);
  }
  for (const edge of delta.add ?? []) {
    if (liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to)) byId.set(edge.id, edge);
  }
  return [...byId.values()];
}

function applyRuntimeIntentDelta(
  intents: RuntimeIntent[] | undefined,
  delta: HostAuthoringGraphDelta['runtimeIntents'],
  liveNodeIds: Set<string>
): RuntimeIntent[] | undefined {
  if (!delta && !intents) return undefined;
  const removed = new Set(delta?.remove ?? []);
  const byId = new Map(
    (intents ?? [])
      .filter((intent) => !removed.has(intent.id))
      .map((intent) => [intent.id, intent] satisfies [string, RuntimeIntent])
  );
  for (const update of delta?.update ?? []) {
    const existing = byId.get(update.id);
    if (!existing) continue;
    const next = {
      ...existing,
      ...(update.kind ? { kind: update.kind } : {}),
      ...(update.label ? { label: update.label } : {}),
      ...(update.targetRuntime ? { targetRuntime: update.targetRuntime } : {}),
      ...(update.sourceNodeIds ? { sourceNodeIds: update.sourceNodeIds.filter((id) => liveNodeIds.has(id)) } : {}),
      ...(update.transport ? { transport: update.transport } : {}),
      ...(update.safety ? { safety: update.safety } : {})
    };
    if (next.sourceNodeIds.length > 0) byId.set(update.id, next);
    else byId.delete(update.id);
  }
  for (const intent of delta?.add ?? []) {
    const sourceNodeIds = intent.sourceNodeIds.filter((id) => liveNodeIds.has(id));
    if (sourceNodeIds.length === 0) continue;
    byId.set(intent.id, { ...intent, sourceNodeIds });
  }
  return [...byId.values()];
}

function matchSkill(skill: SkillFile, update: HostAuthoringSkillUpdate): boolean {
  if (update.id) return skill.id === update.id;
  if (update.name) return skill.name === update.name;
  return false;
}

function applySkillDelta(skills: SkillFile[], delta: HostAuthoringGraphDelta['skills'], authoring: HostAuthoringResult): SkillFile[] {
  let nextSkills = [...skills];
  if (!delta) {
    const primary = nextSkills[0];
    if (!primary) return nextSkills;
    nextSkills[0] = {
      ...primary,
      content: `${primary.content}\n## Host-native authoring guidance\n- Runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}\n- Summary: ${authoring.summary}\n- Emphasis: ${authoring.emphasis.join(', ') || 'none'}\n`
    };
    return nextSkills;
  }

  const removed = new Set(delta.remove ?? []);
  nextSkills = nextSkills.filter((skill) => !removed.has(skill.id) && !removed.has(skill.name));
  nextSkills = nextSkills.map((skill) => {
    const update = (delta.update ?? []).find((item) => matchSkill(skill, item));
    if (!update) return skill;
    return {
      ...skill,
      ...(update.name ? { name: update.name } : {}),
      ...(update.description ? { description: update.description } : {}),
      ...(update.content !== undefined ? { content: update.content } : {}),
      ...(update.appendContent ? { content: `${update.content ?? skill.content}${update.appendContent}` } : {})
    };
  });
  nextSkills = upsertById(nextSkills, delta.add ?? []);
  const primary = nextSkills[0];
  if (!primary) return nextSkills;
  nextSkills[0] = {
    ...primary,
    content: `${primary.content}\n## Host-native authoring guidance\n- Runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}\n- Summary: ${authoring.summary}\n- Emphasis: ${authoring.emphasis.join(', ') || 'none'}\n`
  };
  return nextSkills;
}

export async function invokeHostAuthoring(runtime: RuntimeTarget, prompt: string): Promise<HostAuthoringResult> {
  const compiledPrompt = hostPrompt(prompt, runtime);
  const spec = commandForRuntime(runtime, prompt);
  const env = { ...process.env };
  const configRoot = await resolveRuntimeAuthoringConfigRoot(runtime);
  if (runtime === 'claude-code' && configRoot) env.CLAUDE_CONFIG_DIR = configRoot;
  if (runtime === 'opencode' && configRoot) env.OPENCODE_CONFIG_DIR = configRoot;
  if (runtime === 'codex' && configRoot) env.CODEX_HOME = configRoot;
  let rawOutputFromFile: string | undefined;
  let codexTempDir: string | undefined;
  if (runtime === 'codex') {
    codexTempDir = await mkdtemp(join(tmpdir(), 'omoh-codex-authoring-'));
    const outputPath = join(codexTempDir, 'host-authoring-output.json');
    spec.args = ['exec', '--output-last-message', outputPath, compiledPrompt];
    rawOutputFromFile = outputPath;
  }
  const result = spawnSync(spec.command, spec.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 10 * 1024 * 1024
  });
  const transcriptOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  let rawOutput = transcriptOutput;
  if (rawOutputFromFile && existsSync(rawOutputFromFile)) {
    const fileOutput = (await readFile(rawOutputFromFile, 'utf8')).trim();
    if (fileOutput) rawOutput = fileOutput;
  }
  if (codexTempDir) await rm(codexTempDir, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`Host authoring command failed: ${spec.command} ${spec.args.join(' ')}\n${transcriptOutput}`);
  const parsed = parseJsonLine(rawOutput);
  return {
    runtime,
    ...parsed,
    rawOutput,
    command: `${spec.command} ${spec.args.join(' ')}`
  };
}

export function applyHostAuthoring(project: HarnessProject, authoring: HostAuthoringResult): HarnessProject {
  assert(typeof authoring.summary === 'string', 'Host authoring summary must be a string.');
  assert(Array.isArray(authoring.emphasis) && authoring.emphasis.every((item) => typeof item === 'string'), 'Host authoring emphasis must be an array of strings.');
  assert(Array.isArray(authoring.warnings) && authoring.warnings.every((item) => typeof item === 'string'), 'Host authoring warnings must be an array of strings.');
  const graphDelta = validateGraphDelta(project, authoring.graphDelta);
  const nodes = applyNodeDelta(project.nodes, graphDelta?.nodes);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const edges = applyEdgeDelta(project.edges, graphDelta?.edges, liveNodeIds);
  const runtimeIntents = applyRuntimeIntentDelta(project.runtimeIntents, graphDelta?.runtimeIntents, liveNodeIds);
  const skills = applySkillDelta(project.skills, graphDelta?.skills, authoring);
  validateFinalGraph(project, nodes, edges, runtimeIntents, skills);

  return {
    ...project,
    manifest: {
      ...project.manifest,
      ...(graphDelta?.manifest?.description ? { description: graphDelta.manifest.description } : {})
    },
    nodes,
    edges,
    skills,
    ...(runtimeIntents ? { runtimeIntents } : {}),
    authoring: {
      ...project.authoring,
      summary: authoring.summary,
      warnings: [...new Set([`Host authoring runtime: ${describeRuntimeTarget(authoring.runtime).authoringNoun}`, ...authoring.warnings, ...project.authoring.warnings])]
    }
  };
}
