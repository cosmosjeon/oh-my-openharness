import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchCatalog, fetchFactoryState, fetchProject, fetchTrace, postFactoryChat, rerunSandbox, saveLayout, updateNode, updateSkill } from './api';
import { catalogFromProject, serializeFlowLayout, skillForFlowNode, toReactFlowEdges, toReactFlowNodes } from './graph';
import type { CatalogPayload, FactoryStatePayload, HarnessFlowNode, ProjectPayload } from './types';
import { EMPTY_TRACE_STATE, reduceTracePayload, type TracePayload } from './trace';
import { startTracePollingFallback } from './trace-stream';
import './styles.css';

function runtimeBadges(node: HarnessFlowNode) {
  return node.data.compatibility.length > 0
    ? node.data.compatibility.map((entry) => `${entry.runtime}:${entry.level}`).join(', ')
    : 'custom';
}

export function App() {
  const [apiToken, setApiToken] = useState('');
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [factory, setFactory] = useState<FactoryStatePayload | null>(null);
  const [nodes, setNodes] = useState<HarnessFlowNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [chatResult, setChatResult] = useState<string>('');
  const [skillDraft, setSkillDraft] = useState('');
  const [tracePayload, setTracePayload] = useState<TracePayload | null>(null);
  const [status, setStatus] = useState('Loading project…');

  const traceState = useMemo(() => (project ? reduceTracePayload(project, tracePayload) : EMPTY_TRACE_STATE), [project, tracePayload]);
  const edges = useMemo(() => {
    if (!project) return [];
    const highlighted = new Set(traceState.highlightedEdgeIds);
    return toReactFlowEdges(project).map((edge) => ({
      ...edge,
      animated: highlighted.has(edge.id),
      className: highlighted.has(edge.id) ? 'trace-edge-active' : edge.className
    }));
  }, [project, traceState.highlightedEdgeIds]);
  const visibleNodes = useMemo(() => {
    const active = new Set(traceState.activeNodeIds);
    const failed = new Set(traceState.failedNodeIds);
    return nodes.map((node) => ({
      ...node,
      className: failed.has(node.id) ? 'trace-node-failed' : active.has(node.id) ? 'trace-node-active' : node.className
    }));
  }, [nodes, traceState.activeNodeIds, traceState.failedNodeIds]);
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const selectedSkill = project ? skillForFlowNode(project, selectedNode) : null;

  const reload = useCallback(async () => {
    const nextProject = await fetchProject();
    setProject(nextProject);
    setNodes(toReactFlowNodes(nextProject));
    setCatalog(await fetchCatalog().catch(() => catalogFromProject(nextProject)));
    setFactory(await fetchFactoryState().catch((error) => ({ configured: false, stateRoot: '', sessionId: 'default', error: error.message })));
    setTracePayload(await fetchTrace().catch(() => null));
    setStatus(`Loaded ${nextProject.manifest.name}`);
  }, []);

  useEffect(() => {
    reload().catch((error) => setStatus(error.message));
  }, [reload]);

  useEffect(() => {
    setSkillDraft(selectedSkill?.content ?? '');
  }, [selectedSkill?.content]);

  useEffect(() => {
    if (!project) return;
    const source = new EventSource('/api/trace/stream');
    let stopPolling: (() => void) | null = null;
    source.addEventListener('trace', (event) => {
      setTracePayload(JSON.parse((event as MessageEvent<string>).data) as TracePayload);
    });
    source.onerror = () => {
      source.close();
      stopPolling ??= startTracePollingFallback({
        onTrace: setTracePayload,
        onError: (error) => setStatus(`Trace polling fallback failed: ${error.message}`)
      });
    };
    return () => {
      source.close();
      stopPolling?.();
    };
  }, [project?.manifest.graphHash]);

  const onNodesChange = useCallback((changes: NodeChange<HarnessFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  async function onSaveLayout() {
    await saveLayout(apiToken, serializeFlowLayout(nodes));
    setStatus('Layout saved without semantic graph changes.');
  }

  async function onSaveNode() {
    if (!selectedNode) return;
    const label = window.prompt('Node label', selectedNode.data.label) ?? selectedNode.data.label;
    const nextProject = await updateNode(apiToken, selectedNode.id, label, selectedNode.data.config);
    setProject(nextProject);
    setNodes(toReactFlowNodes(nextProject));
    setStatus(`Saved node ${selectedNode.id}`);
  }

  async function onSaveSkill() {
    if (!selectedSkill) return;
    const nextProject = await updateSkill(apiToken, { skillId: selectedSkill.id, content: skillDraft });
    setProject(nextProject);
    setStatus(`Saved skill ${selectedSkill.name}`);
  }

  async function onChatSubmit() {
    const result = await postFactoryChat(apiToken, chatText || 'continue');
    setFactory(result.state ? { configured: true, stateRoot: '', sessionId: result.state.sessionId, state: result.state } : factory);
    setChatResult(JSON.stringify(result, null, 2));
  }

  async function onRerunSandbox() {
    const result = await rerunSandbox(apiToken);
    setTracePayload(result.trace);
    setStatus(result.message);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Harness Editor</h1>
          <p>{project?.manifest.name ?? 'Loading'} · {project?.manifest.targetRuntime ?? 'runtime pending'}</p>
        </div>
        <label>Mutation token<input value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="Paste server token" type="password" /></label>
      </header>

      <section className="workspace">
        <aside className="panel catalog-panel">
          <h2>Catalog</h2>
          <h3>Atomic blocks</h3>
          <ul>{catalog?.blocks.map((block) => <li key={block.kind}><strong>{block.kind}</strong><span>{block.category} · {block.compatibleRuntimes.join(', ')}</span></li>)}</ul>
          <h3>Composites</h3>
          <ul>{catalog?.composites.map((item) => <li key={item.id}><strong>{item.name}</strong><span>{item.includes.join(' → ')}</span></li>)}</ul>
        </aside>

        <section className="canvas-card" aria-label="React Flow canvas">
          <ReactFlow nodes={visibleNodes} edges={edges} onNodesChange={onNodesChange} onNodeClick={(_, node) => setSelectedId(node.id)} fitView>
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </section>

        <aside className="panel inspector-panel">
          <h2>Inspector</h2>
          {selectedNode ? <>
            <p><strong>{selectedNode.data.label}</strong></p>
            <p>Kind: {selectedNode.data.kind}</p>
            <p>Compatibility: {runtimeBadges(selectedNode)}</p>
            <p>Safety: {selectedNode.data.safety ?? 'custom'}</p>
            <button onClick={onSaveNode} disabled={!apiToken}>Save node</button>
            <button onClick={onSaveLayout} disabled={!apiToken}>Save layout</button>
            {selectedSkill ? <>
              <h3>Skill markdown</h3>
              <textarea value={skillDraft} onChange={(event) => setSkillDraft(event.target.value)} rows={12} />
              <button onClick={onSaveSkill} disabled={!apiToken}>Save skill</button>
            </> : null}
          </> : <p>Select a node to inspect runtime compatibility and editable fields.</p>}
        </aside>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <h2>Factory state</h2>
          <p>Configured: {factory?.configured ? 'yes' : 'no'}</p>
          <p>Stage: {factory?.state?.stage ?? 'not loaded'}</p>
          <p>Target runtime: {factory?.state?.targetRuntime ?? 'pending'}</p>
          <p>Open questions: {factory?.state?.openQuestions.length ?? 0}</p>
          <p>Confirmed decisions: {factory?.state?.confirmedDecisions.length ?? 0}</p>
          <p>Project: {factory?.state?.projectPath ?? 'none'}</p>
          <p>Verification: {factory?.state?.verification.status ?? 'not-run'}</p>
        </article>
        <article className="panel trace-panel">
          <h2>Live debugger</h2>
          <p>Source: {tracePayload?.source ?? 'none'} · Events: {traceState.events.length}</p>
          {traceState.staleTrace ? <p className="warning">Trace graph hash is stale. Run a bounded rerun to refresh overlays.</p> : null}
          <button onClick={onRerunSandbox} disabled={!apiToken}>Rerun sandbox</button>
          {traceState.latestFailure ? <div className="failure-card">
            <strong>Failure: {traceState.latestFailure.hook} · {traceState.latestFailure.nodeId}</strong>
            <p>{traceState.latestFailure.message}</p>
            <p>{traceState.latestFailure.likelyAction}</p>
          </div> : <p>No localized failures.</p>}
          <ul className="trace-list">
            {traceState.events.slice(-6).map((event, index) => <li key={`${event.timestamp}-${event.nodeId}-${index}`} className={event.status === 'error' ? 'trace-error' : 'trace-ok'}>
              <strong>{event.eventType} · {event.nodeId}</strong>
              <span>{event.hook}: {event.message}</span>
            </li>)}
          </ul>
        </article>
        <article className="panel chat-panel">
          <h2>Chat / interview</h2>
          <textarea value={chatText} onChange={(event) => setChatText(event.target.value)} rows={4} placeholder="Ask the Harness Factory what to do next…" />
          <button onClick={onChatSubmit} disabled={!apiToken}>Submit to Factory</button>
          <pre>{chatResult || status}</pre>
        </article>
      </section>
    </main>
  );
}
