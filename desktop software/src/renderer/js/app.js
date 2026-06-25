'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let sessions = [];
let config = {};

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  config = await window.chronis.configGet();
  sessions = await window.chronis.sessionsList();

  const info = await window.chronis.appInfo();
  const dirEl = document.getElementById('data-dir-path');
  if (dirEl) dirEl.textContent = info.dataDir;

  applyConfig();
  updateApiPill();
  updateSessionCount();

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => nav(btn.dataset.page));
  });

  setupTabs('capture-tabs');
})();

// ── Config ────────────────────────────────────────────────────────────────────
function applyConfig() {
  if (config.model) {
    const sel = document.getElementById('model-select');
    if (sel) sel.value = config.model;
  }
  if (config.retention) {
    const sel = document.getElementById('retention-select');
    if (sel) sel.value = config.retention;
  }
}

async function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) { setMsg('api-key-msg', 'Enter a key first.'); return; }
  config.apiKey = key;
  await window.chronis.configSet(config);
  document.getElementById('api-key-input').value = '';
  setMsg('api-key-msg', 'Saved.');
  updateApiPill();
}

async function clearApiKey() {
  delete config.apiKey;
  await window.chronis.configSet(config);
  setMsg('api-key-msg', 'Key removed.');
  updateApiPill();
}

async function saveModelConfig() {
  config.model = document.getElementById('model-select').value;
  config.retention = document.getElementById('retention-select').value;
  await window.chronis.configSet(config);
}

document.getElementById('model-select')?.addEventListener('change', saveModelConfig);
document.getElementById('retention-select')?.addEventListener('change', saveModelConfig);

function updateApiPill() {
  const pill = document.getElementById('api-pill');
  if (!pill) return;
  if (config.apiKey) {
    pill.textContent = 'Gemini connected';
    pill.classList.add('connected');
  } else {
    pill.textContent = 'No API key';
    pill.classList.remove('connected');
  }
}

function setMsg(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function nav(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + pageId)?.classList.add('active');
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');

  if (pageId === 'shadows') renderShadowsList();
  if (pageId === 'graph') renderGraph();
  if (pageId === 'audit') renderAudit();
  if (pageId === 'recall') populateRecallScope();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setupTabs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const parent = container.closest('.card') || container.parentElement;
      parent.querySelectorAll('.tab-content').forEach(tc => {
        tc.classList.toggle('active', tc.id === 'tab-' + target);
      });
    });
  });
}

// ── Mic toggle ────────────────────────────────────────────────────────────────
async function toggleRecording() {
  if (AudioCapture.isRecording()) {
    const blob = await AudioCapture.stop();
    if (!blob) return;

    document.getElementById('rec-status').textContent = 'Transcribing...';
    document.getElementById('btn-record').disabled = true;

    try {
      const b64 = await AudioCapture.blobToBase64(blob);
      const transcript = await GeminiAPI.transcribeAudio(b64, blob.type, {
        apiKey: config.apiKey,
        model: config.model || 'gemini-2.5-flash',
      });

      document.getElementById('raw-input').value = transcript;
      document.getElementById('rec-status').textContent = 'Transcription complete. Review and extract.';
    } catch (e) {
      document.getElementById('rec-status').textContent = 'Transcription failed: ' + e.message;
    } finally {
      document.getElementById('btn-record').disabled = false;
    }
  } else {
    await AudioCapture.start();
  }
}

// ── Session capture ───────────────────────────────────────────────────────────
async function processSession() {
  const raw = document.getElementById('raw-input').value.trim();
  const title = document.getElementById('session-title').value.trim() || 'Untitled session';

  if (!raw) { alert('Paste or record some interaction text first.'); return; }
  if (!config.apiKey) { alert('Add your Gemini API key in Settings first.'); nav('settings'); return; }

  const processingBar = document.getElementById('processing-bar');
  const proofBar = document.getElementById('destruction-proof');
  const previewCard = document.getElementById('shadow-preview-card');
  const extractBtn = document.getElementById('btn-extract');

  processingBar.style.display = 'flex';
  proofBar.style.display = 'none';
  previewCard.style.display = 'none';
  extractBtn.disabled = true;

  const msgs = [
    'Extracting cognitive state from ephemeral stream...',
    'Building context graph nodes...',
    'Scoring commitment confidence...',
    'Finalising semantic state representation...',
  ];
  let mi = 0;
  const ticker = setInterval(() => {
    document.getElementById('processing-msg').textContent = msgs[Math.min(++mi, msgs.length - 1)];
  }, 2000);

  try {
    const shadow = await GeminiAPI.extractContextShadow(raw, title, {
      apiKey: config.apiKey,
      model: config.model || 'gemini-2.5-flash',
    });

    shadow._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    shadow._created = new Date().toISOString();

    await window.chronis.sessionsSave(shadow);
    sessions = await window.chronis.sessionsList();

    // Hash and log the destruction
    const hash = await window.chronis.sha256(raw);
    const logEntry = `[${new Date().toISOString()}] SESSION ${shadow._id} "${title}" — raw input destroyed — SHA-256: ${hash}`;
    await window.chronis.auditAppend(logEntry);

    // Destroy raw input
    document.getElementById('raw-input').value = '';
    document.getElementById('session-title').value = '';

    document.getElementById('proof-hash').textContent = 'SHA-256 of destroyed input: ' + hash;
    proofBar.style.display = 'flex';

    updateSessionCount();
    renderShadowPreview(shadow);
    previewCard.style.display = 'block';

  } catch (e) {
    alert('Extraction failed: ' + e.message);
  } finally {
    clearInterval(ticker);
    processingBar.style.display = 'none';
    extractBtn.disabled = false;
  }
}

function clearCapture() {
  document.getElementById('raw-input').value = '';
  document.getElementById('session-title').value = '';
  document.getElementById('shadow-preview-card').style.display = 'none';
  document.getElementById('destruction-proof').style.display = 'none';
}

// ── Shadow preview ────────────────────────────────────────────────────────────
function renderShadowPreview(shadow) {
  renderFieldsTab(shadow);
  renderNodesTab(shadow);
  renderSummaryTab(shadow);
  renderRawTab(shadow);

  // Reset to first tab
  const tabs = document.getElementById('capture-tabs');
  if (tabs) {
    tabs.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    document.getElementById('shadow-preview-card')?.querySelectorAll('.tab-content')
      .forEach((tc, i) => tc.classList.toggle('active', i === 0));
  }
}

function renderFieldsTab(shadow) {
  const el = document.getElementById('tab-fields');
  const topFields = [
    ['conversational_intent', 'Intent'],
    ['emotional_dynamics', 'Emotional dynamics'],
    ['negotiation_state', 'Negotiation state'],
    ['social_context', 'Social context'],
    ['temporal_context', 'Temporal context'],
    ['environmental_context', 'Environment'],
  ];

  let html = '<div class="shadow-grid">';
  topFields.forEach(([key, label]) => {
    if (shadow[key]) {
      html += `<div class="shadow-tile"><div class="shadow-tile-label">${label}</div><div class="shadow-tile-value">${esc(shadow[key])}</div></div>`;
    }
  });

  if (shadow.commitments?.length) {
    html += `<div class="shadow-tile wide"><div class="shadow-tile-label">Commitments</div><div class="mono-block">${esc(JSON.stringify(shadow.commitments, null, 2))}</div></div>`;
  }
  if (shadow.decisions_made?.length) {
    html += `<div class="shadow-tile"><div class="shadow-tile-label">Decisions made</div><div class="shadow-tile-value">${shadow.decisions_made.map(esc).join('<br>')}</div></div>`;
  }
  if (shadow.decisions_deferred?.length) {
    html += `<div class="shadow-tile"><div class="shadow-tile-label">Decisions deferred</div><div class="shadow-tile-value">${shadow.decisions_deferred.map(esc).join('<br>')}</div></div>`;
  }
  if (shadow.goals?.length) {
    html += `<div class="shadow-tile"><div class="shadow-tile-label">Goals</div><div class="shadow-tile-value">${shadow.goals.map(esc).join('<br>')}</div></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function renderNodesTab(shadow) {
  const el = document.getElementById('tab-nodes');
  const nodes = shadow.graph_nodes || [];
  if (!nodes.length) { el.innerHTML = '<div class="empty-state">No nodes extracted.</div>'; return; }
  el.innerHTML = '<div class="node-grid">' + nodes.map(n => `
    <div class="graph-node">
      <div class="graph-node-type">${esc(n.type)}</div>
      <div class="graph-node-label">${esc(n.label)}</div>
      <div class="graph-node-attr">${esc(n.attributes || '')}</div>
    </div>`).join('') + '</div>';
}

function renderSummaryTab(shadow) {
  const el = document.getElementById('tab-summary');
  el.innerHTML = `<p style="font-size:13px; line-height:1.8; color:var(--gray-800);">${esc(shadow.reconstruction_summary || 'No summary generated.')}</p>`;
}

function renderRawTab(shadow) {
  const el = document.getElementById('tab-raw');
  const displayShadow = { ...shadow };
  delete displayShadow._id;
  delete displayShadow._created;
  el.innerHTML = `<div class="raw-json-block">${esc(JSON.stringify(displayShadow, null, 2))}</div>`;
}

// ── Shadows list ──────────────────────────────────────────────────────────────
function renderShadowsList() {
  const el = document.getElementById('shadows-list');
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state">No sessions captured yet. Go to Capture to process your first interaction.</div>';
    return;
  }
  el.innerHTML = '<div class="session-list">' + [...sessions].reverse().map(s => `
    <div class="session-item">
      <div class="session-item-info">
        <div class="session-item-title">${esc(s.session_title || 'Untitled')}</div>
        <div class="session-item-meta">
          ${new Date(s._created).toLocaleString()}
          &nbsp;&middot;&nbsp;
          <span class="badge badge-pink">${(s.graph_nodes || []).length} nodes</span>
          &nbsp;<span class="badge badge-gray">${(s.commitments || []).length} commitments</span>
        </div>
      </div>
      <div class="session-item-actions">
        <button onclick="viewSession('${s._id}')" title="View shadow" style="padding:5px 9px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button onclick="deleteSession('${s._id}')" title="Delete" class="btn-danger" style="padding:5px 9px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`).join('') + '</div>';
}

function viewSession(id) {
  const s = sessions.find(x => x._id === id);
  if (!s) return;
  nav('capture');
  document.getElementById('shadow-preview-card').style.display = 'block';
  document.getElementById('destruction-proof').style.display = 'none';
  renderShadowPreview(s);
  setupTabs('capture-tabs');
}

async function deleteSession(id) {
  if (!confirm('Delete this context shadow? This cannot be undone.')) return;
  await window.chronis.sessionsDelete(id);
  sessions = await window.chronis.sessionsList();
  updateSessionCount();
  renderShadowsList();
}

// ── Recall ────────────────────────────────────────────────────────────────────
function populateRecallScope() {
  const sel = document.getElementById('recall-scope');
  if (!sel) return;
  sel.innerHTML = '<option value="all">All sessions</option>' +
    sessions.map(s => `<option value="${s._id}">${esc(s.session_title || 'Untitled')} — ${new Date(s._created).toLocaleDateString()}</option>`).join('');
}

async function runRecall() {
  const query = document.getElementById('recall-query').value.trim();
  const scope = document.getElementById('recall-scope').value;
  const resultEl = document.getElementById('recall-result');
  const bar = document.getElementById('recall-bar');

  if (!query) { alert('Enter a question to recall.'); return; }
  if (!sessions.length) { alert('No sessions captured yet.'); return; }
  if (!config.apiKey) { alert('Add your Gemini API key in Settings.'); nav('settings'); return; }

  bar.style.display = 'flex';
  resultEl.style.display = 'none';

  const relevant = scope === 'all' ? sessions : sessions.filter(s => s._id === scope);

  try {
    const answer = await GeminiAPI.recallFromGraph(query, relevant, {
      apiKey: config.apiKey,
      model: config.model || 'gemini-2.5-flash',
    });
    resultEl.textContent = answer;
    resultEl.style.display = 'block';
  } catch (e) {
    alert('Recall failed: ' + e.message);
  } finally {
    bar.style.display = 'none';
  }
}

// ── Graph ─────────────────────────────────────────────────────────────────────
function renderGraph() {
  let people=0, commits=0, ideas=0, events=0, projects=0;
  const allNodes = [];

  sessions.forEach(s => (s.graph_nodes || []).forEach(n => {
    allNodes.push({ ...n, _session: s.session_title });
    if (n.type === 'person') people++;
    else if (n.type === 'commitment') commits++;
    else if (n.type === 'idea') ideas++;
    else if (n.type === 'event') events++;
    else if (n.type === 'project') projects++;
  }));

  document.getElementById('stat-people').textContent = people;
  document.getElementById('stat-commit').textContent = commits;
  document.getElementById('stat-ideas').textContent = ideas;
  document.getElementById('stat-events').textContent = events;
  document.getElementById('stat-projects').textContent = projects;

  const el = document.getElementById('full-graph');
  if (!allNodes.length) {
    el.innerHTML = '<div class="empty-state">No nodes extracted yet.</div>';
    return;
  }
  el.innerHTML = allNodes.map(n => `
    <div class="graph-node">
      <div class="graph-node-type">${esc(n.type)}</div>
      <div class="graph-node-label">${esc(n.label)}</div>
      <div class="graph-node-attr">${esc(n.attributes || '')}</div>
      <div class="graph-node-session">${esc(n._session || '')}</div>
    </div>`).join('');
}

// ── Audit ─────────────────────────────────────────────────────────────────────
async function renderAudit() {
  const log = await window.chronis.auditList();
  const el = document.getElementById('audit-log');
  el.textContent = log.length ? [...log].reverse().join('\n') : 'Awaiting first session capture...';
}

// ── Settings actions ──────────────────────────────────────────────────────────
async function clearAllData() {
  if (!confirm('Permanently delete all context shadows and graph nodes? This cannot be undone.')) return;
  await window.chronis.sessionsClear();
  sessions = [];
  updateSessionCount();
  renderShadowsList();
}

// ── Utility ───────────────────────────────────────────────────────────────────
function updateSessionCount() {
  const el = document.getElementById('session-count');
  if (el) el.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expose to inline event handlers in HTML
window.nav = nav;
window.toggleRecording = toggleRecording;
window.processSession = processSession;
window.clearCapture = clearCapture;
window.viewSession = viewSession;
window.deleteSession = deleteSession;
window.runRecall = runRecall;
window.saveApiKey = saveApiKey;
window.clearApiKey = clearApiKey;
window.clearAllData = clearAllData;
