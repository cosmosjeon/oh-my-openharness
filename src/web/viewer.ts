const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function renderViewerHtml(projectName: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(projectName)} — Harness Editor</title>
    <style>
      :root { color-scheme: dark; --panel: #0f172a; --panel-2: #111827; --border: #1f2937; --text: #e2e8f0; --muted: #94a3b8; --accent: #60a5fa; --ok: #22c55e; --err: #ef4444; --warn: #f59e0b; }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #020617; color: var(--text); display: grid; grid-template-columns: 260px 1fr 360px; grid-template-rows: 56px 1fr; grid-template-areas: "header header header" "side canvas trace"; }
      header { grid-area: header; display: flex; align-items: center; padding: 0 16px; gap: 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
      header h1 { font-size: 1rem; margin: 0; color: var(--text); }
      header .muted { color: var(--muted); font-size: 0.8rem; }
      header .actions { margin-left: auto; display: flex; gap: 8px; }
      button { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; }
      button:hover { border-color: var(--accent); }
      button[disabled] { opacity: 0.5; cursor: not-allowed; }
      aside { background: var(--panel); border-right: 1px solid var(--border); overflow-y: auto; }
      aside.side { grid-area: side; padding: 12px; }
      aside.trace { grid-area: trace; border-right: none; border-left: 1px solid var(--border); padding: 12px; }
      aside h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 8px 0; }
      aside section + section { margin-top: 16px; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); font-size: 0.75rem; color: var(--muted); }
      .node-list li { list-style: none; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); margin-bottom: 6px; background: var(--panel-2); font-size: 0.8rem; }
      .node-list li strong { color: var(--text); display: block; }
      .node-list li span { color: var(--muted); font-size: 0.72rem; }
      main { grid-area: canvas; position: relative; overflow: hidden; }
      svg { width: 100%; height: 100%; background: radial-gradient(circle at 20% 10%, rgba(96, 165, 250, 0.08), transparent 60%), #020617; }
      .node rect { fill: var(--panel-2); stroke: var(--border); stroke-width: 1.2; rx: 8; ry: 8; }
      .node.is-error rect { stroke: var(--err); stroke-width: 2; }
      .node.is-active rect { stroke: var(--ok); stroke-width: 2; }
      .node.is-custom rect { stroke: var(--warn); stroke-dasharray: 4 4; }
      .node text { font-size: 11px; fill: var(--text); }
      .node text.kind { fill: var(--muted); font-size: 10px; }
      .edge { stroke: #475569; stroke-width: 1.4; fill: none; marker-end: url(#edge-arrow); }
      .edge.is-hit { stroke: var(--accent); }
      .edge-label { fill: var(--muted); font-size: 10px; }
      .trace-list { display: flex; flex-direction: column; gap: 6px; }
      .trace-item { padding: 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); font-size: 0.78rem; cursor: pointer; }
      .trace-item:hover { border-color: var(--accent); }
      .trace-item.is-error { border-color: var(--err); background: rgba(239, 68, 68, 0.1); }
      .trace-item header { display: flex; justify-content: space-between; gap: 6px; border-bottom: none; padding: 0; background: transparent; }
      .trace-item header strong { font-size: 0.78rem; }
      .trace-item .meta { color: var(--muted); font-size: 0.7rem; }
      .status { font-size: 0.8rem; color: var(--muted); padding: 8px 0; }
      .warning { color: var(--warn); }
      .confirm { color: var(--err); font-weight: 600; }
      .empty { color: var(--muted); font-style: italic; padding: 8px 0; font-size: 0.8rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>Harness Editor</h1>
      <span class="muted" id="project-name">${escapeHtml(projectName)}</span>
      <span class="pill" id="runtime-pill">—</span>
      <div class="actions">
        <button id="refresh-btn" type="button">Refresh</button>
        <button id="save-btn" type="button" disabled>Save layout</button>
      </div>
    </header>
    <aside class="side">
      <section>
        <h2>Summary</h2>
        <div id="summary" class="status">Loading…</div>
      </section>
      <section>
        <h2>Confirmations</h2>
        <div id="confirmations" class="empty">None.</div>
      </section>
      <section>
        <h2>Nodes</h2>
        <ul class="node-list" id="node-list"></ul>
      </section>
    </aside>
    <main>
      <svg id="canvas" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="edge-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>
        <g id="edges-layer"></g>
        <g id="nodes-layer"></g>
      </svg>
    </main>
    <aside class="trace">
      <section>
        <h2>Runtime Trace</h2>
        <div id="trace-status" class="status">No trace loaded.</div>
        <div id="trace-list" class="trace-list"></div>
      </section>
    </aside>
    <script>
      (function () {
        const state = { project: null, trace: { events: [] }, dirty: false, dragNodeId: null, activeNodes: new Set(), errorNodes: new Set() };
        const canvas = document.getElementById('canvas');
        const nodesLayer = document.getElementById('nodes-layer');
        const edgesLayer = document.getElementById('edges-layer');
        const summaryEl = document.getElementById('summary');
        const confirmationsEl = document.getElementById('confirmations');
        const nodeListEl = document.getElementById('node-list');
        const traceListEl = document.getElementById('trace-list');
        const traceStatusEl = document.getElementById('trace-status');
        const runtimePill = document.getElementById('runtime-pill');
        const saveBtn = document.getElementById('save-btn');
        const refreshBtn = document.getElementById('refresh-btn');

        function escapeHtml(value) {
          return String(value == null ? '' : value)
            .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
        }

        function findLayout(id) {
          return state.project.layout.find(function (item) { return item.id === id; });
        }

        function computeViewBox(layout) {
          if (!layout.length) return [0, 0, 1000, 700];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          layout.forEach(function (node) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x);
            maxY = Math.max(maxY, node.y);
          });
          const padding = 120;
          const width = Math.max(600, maxX - minX + padding * 2 + 180);
          const height = Math.max(400, maxY - minY + padding * 2 + 80);
          return [minX - padding, minY - padding, width, height];
        }

        function renderNodes() {
          nodesLayer.textContent = '';
          state.project.nodes.forEach(function (node) {
            const pos = findLayout(node.id) || { x: 40, y: 40 };
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('class', 'node' + (state.activeNodes.has(node.id) ? ' is-active' : '') + (state.errorNodes.has(node.id) ? ' is-error' : '') + (node.kind === 'CustomBlock' ? ' is-custom' : ''));
            group.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
            group.dataset.nodeId = node.id;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('width', '170');
            rect.setAttribute('height', '56');
            rect.setAttribute('rx', '10');
            rect.setAttribute('ry', '10');
            group.appendChild(rect);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', '12');
            label.setAttribute('y', '24');
            label.textContent = node.label;
            group.appendChild(label);

            const kind = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            kind.setAttribute('class', 'kind');
            kind.setAttribute('x', '12');
            kind.setAttribute('y', '42');
            kind.textContent = node.kind + ' · ' + node.id;
            group.appendChild(kind);

            group.addEventListener('pointerdown', beginDrag);
            nodesLayer.appendChild(group);
          });
        }

        function renderEdges() {
          edgesLayer.textContent = '';
          state.project.edges.forEach(function (edge) {
            const from = findLayout(edge.from);
            const to = findLayout(edge.to);
            if (!from || !to) return;
            const x1 = from.x + 170; const y1 = from.y + 28;
            const x2 = to.x; const y2 = to.y + 28;
            const mx = (x1 + x2) / 2;
            const d = 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'edge' + (state.activeNodes.has(edge.from) && state.activeNodes.has(edge.to) ? ' is-hit' : ''));
            path.setAttribute('d', d);
            edgesLayer.appendChild(path);

            if (edge.label) {
              const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              text.setAttribute('class', 'edge-label');
              text.setAttribute('x', String(mx));
              text.setAttribute('y', String((y1 + y2) / 2 - 4));
              text.setAttribute('text-anchor', 'middle');
              text.textContent = edge.label;
              edgesLayer.appendChild(text);
            }
          });
        }

        function renderProject() {
          const box = computeViewBox(state.project.layout);
          canvas.setAttribute('viewBox', box.join(' '));
          runtimePill.textContent = state.project.manifest.targetRuntime;
          const authoring = state.project.authoring || { warnings: [], confirmationRequests: [] };
          summaryEl.innerHTML = '<div>' + escapeHtml(authoring.summary || '') + '</div>' + (authoring.warnings && authoring.warnings.length ? '<ul style="margin:8px 0 0 14px;padding:0;font-size:0.78rem;color:var(--muted)">' + authoring.warnings.map(function (w) { return '<li class="warning">' + escapeHtml(w) + '</li>'; }).join('') + '</ul>' : '');
          const pending = (authoring.confirmationRequests || []).filter(function (r) { return !r.confirmed; });
          if (pending.length === 0) {
            confirmationsEl.className = 'empty';
            confirmationsEl.textContent = 'No outstanding confirmations.';
          } else {
            confirmationsEl.className = '';
            confirmationsEl.innerHTML = pending.map(function (r) { return '<div class="confirm">' + escapeHtml(r.kind) + ': ' + escapeHtml(r.message) + '</div>'; }).join('');
          }

          nodeListEl.innerHTML = state.project.nodes.map(function (node) {
            return '<li><strong>' + escapeHtml(node.label) + '</strong><span>' + escapeHtml(node.kind) + ' · ' + escapeHtml(node.id) + '</span></li>';
          }).join('');

          renderEdges();
          renderNodes();
        }

        function renderTrace() {
          const events = state.trace.events || [];
          state.activeNodes = new Set(events.filter(function (e) { return e.status === 'ok'; }).map(function (e) { return e.nodeId; }));
          state.errorNodes = new Set(events.filter(function (e) { return e.status === 'error'; }).map(function (e) { return e.nodeId; }));
          if (state.trace.source === 'none' || events.length === 0) {
            traceStatusEl.textContent = 'No trace data. Run harness-editor sandbox to produce events.';
          } else {
            traceStatusEl.textContent = (state.trace.path || '') + ' · ' + events.length + ' events';
          }
          traceListEl.innerHTML = events.map(function (event) {
            return '<div class="trace-item ' + (event.status === 'error' ? 'is-error' : '') + '" data-node-id="' + escapeHtml(event.nodeId) + '">' +
              '<header><strong>' + escapeHtml(event.eventType) + '</strong><span class="meta">' + escapeHtml(event.status) + '</span></header>' +
              '<div>' + escapeHtml(event.message) + '</div>' +
              '<div class="meta">' + escapeHtml(event.hook) + ' · ' + escapeHtml(event.nodeId) + ' · ' + escapeHtml(event.timestamp) + '</div>' +
              '</div>';
          }).join('');
          if (state.project) renderNodes(), renderEdges();
        }

        function beginDrag(evt) {
          const group = evt.currentTarget;
          const id = group.dataset.nodeId;
          if (!id) return;
          const pos = findLayout(id);
          if (!pos) return;
          state.dragNodeId = id;
          const pt = canvas.createSVGPoint();
          pt.x = evt.clientX; pt.y = evt.clientY;
          const ctm = canvas.getScreenCTM();
          if (!ctm) return;
          const startPoint = pt.matrixTransform(ctm.inverse());
          const startX = pos.x; const startY = pos.y;

          function onMove(moveEvt) {
            const mp = canvas.createSVGPoint();
            mp.x = moveEvt.clientX; mp.y = moveEvt.clientY;
            const current = mp.matrixTransform(ctm.inverse());
            pos.x = Math.round(startX + (current.x - startPoint.x));
            pos.y = Math.round(startY + (current.y - startPoint.y));
            group.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
            renderEdges();
            state.dirty = true;
            saveBtn.disabled = false;
          }

          function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            state.dragNodeId = null;
          }

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }

        async function loadProject() {
          const res = await fetch('/api/project');
          if (!res.ok) throw new Error('Failed to load project: ' + res.status);
          state.project = await res.json();
          renderProject();
        }

        async function loadTrace() {
          const res = await fetch('/api/trace');
          if (!res.ok) throw new Error('Failed to load trace: ' + res.status);
          state.trace = await res.json();
          renderTrace();
        }

        async function saveLayout() {
          if (!state.project) return;
          saveBtn.disabled = true;
          try {
            const res = await fetch('/api/layout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ layout: state.project.layout })
            });
            if (!res.ok) throw new Error('Failed to save layout: ' + res.status);
            state.dirty = false;
          } catch (err) {
            alert(err.message);
            saveBtn.disabled = false;
          }
        }

        refreshBtn.addEventListener('click', function () { loadProject().then(loadTrace).catch(function (e) { alert(e.message); }); });
        saveBtn.addEventListener('click', saveLayout);

        loadProject().then(loadTrace).catch(function (err) {
          summaryEl.innerHTML = '<span class="confirm">' + escapeHtml(err.message) + '</span>';
        });

        setInterval(function () { if (!state.dragNodeId) loadTrace().catch(function () {}); }, 4000);
      })();
    </script>
  </body>
</html>`;
}
