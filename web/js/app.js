const ICONS = {
  guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  standards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  rubric: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  scenes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  cases: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  practice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
  feedback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V4a2 2 0 0 0-2-2z"/><path d="M8 8h8M8 12h6"/></svg>',
  terms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
};

/** 与 FastAPI 同域时用相对路径；单独开 8080 静态站时回退到 8000 */
const API_BASE = (() => {
  if (typeof location === 'undefined') return 'http://127.0.0.1:8000';
  if (location.port === '8000' || location.port === '') return '';
  return 'http://127.0.0.1:8000';
})();

const ROUTES_PRIMARY = [
  { id: 'guide', label: '入门导读', eyebrow: 'Start Here' },
  { id: 'practice', label: '模拟对话', eyebrow: 'Practice Chat' },
  { id: 'feedback', label: '练习反馈', eyebrow: 'Feedback' },
  { id: 'standards', label: '标准解释', eyebrow: 'Standards Explained' },
  { id: 'cases', label: '病例事实包', eyebrow: 'Case Package' },
  { id: 'database', label: '数据库', eyebrow: 'Live Database' },
  { id: 'rubric', label: '评分说明', eyebrow: 'Scoring Guide' },
  { id: 'terms', label: '术语表', eyebrow: 'Glossary' },
];

const ROUTES_ADVANCED = [
  { id: 'overview', label: '系统概览', eyebrow: 'Overview' },
  { id: 'timeline', label: '效力时间线', eyebrow: 'Timeline' },
  { id: 'scenes', label: '训练场景', eyebrow: 'Training Scenes' },
];

const ROUTES = [...ROUTES_PRIMARY, ...ROUTES_ADVANCED];

const TYPE_LABELS = {
  process: { label: '过程', cls: 'pill-process' },
  content: { label: '内容', cls: 'pill-content' },
  prohibition: { label: '禁止', cls: 'pill-prohibition' },
};

let state = {
  standards: null,
  rubric: null,
  terms: null,
  scenes: null,
  guide: null,
  standardsLay: null,
  rubricLay: null,
  casesIndex: null,
  casePackage: null,
  dbVerify: null,
  dbBusy: false,
  dbActionMsg: '',
  practice: {
    sessionId: null,
    caseInfo: null,
    persona: null,
    messages: [],
    busy: false,
    status: null,
    error: '',
  },
  feedbackData: null,
  route: 'guide',
  filterCategory: 'all',
  filterLayer: 'all',
  search: '',
  simpleMode: true,
};

const $ = (sel) => document.querySelector(sel);
const viewEl = $('#view');
const modal = $('#modal');
const modalBody = $('#modal-body');

function formatText(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function getLay(id) {
  return state.standardsLay?.[id] || null;
}

function getRubricLay(id) {
  return state.rubricLay?.[id] || null;
}

async function loadData() {
  const [standards, rubric, terms, scenes, guide, standardsLay, rubricLay, casesIndex] = await Promise.all([
    fetch('./data/standards-registry.json').then((r) => r.json()),
    fetch('./data/scoring-rubric.json').then((r) => r.json()),
    fetch('./data/terminology.json').then((r) => r.json()),
    fetch('./data/scenes.json').then((r) => r.json()),
    fetch('./data/project-guide.json').then((r) => r.json()),
    fetch('./data/standards-layperson.json').then((r) => r.json()),
    fetch('./data/rubric-layperson.json').then((r) => r.json()),
    fetch('./data/cases-index.json').then((r) => r.json()),
  ]);
  state.standards = standards;
  state.rubric = rubric;
  state.terms = terms;
  state.scenes = scenes;
  state.guide = guide;
  state.standardsLay = standardsLay;
  state.rubricLay = rubricLay;
  state.casesIndex = casesIndex;

  const def = casesIndex.cases.find((c) => c.is_default) || casesIndex.cases[0];
  if (def?.file) {
    state.casePackage = await fetch(`./data/${def.file}`).then((r) => r.json());
  }
  $('#data-version').textContent = `数据 ${standards.meta.version}`;
}

function getCategoryMap() {
  const map = {};
  state.standards.categories.forEach((c) => { map[c.id] = c; });
  return map;
}

function badgeClass(status) {
  if (status === 'active') return 'badge-active';
  if (status === 'upcoming') return 'badge-upcoming';
  return 'badge-reference';
}

function priorityLabel(p) {
  return { primary: '主依据', secondary: '补充', reference: '参考' }[p] || p;
}

function renderNavButtons(routes, container) {
  container.innerHTML = routes.map(
    (r) => `<button class="nav-btn ${state.route === r.id ? 'active' : ''}" data-route="${r.id}">
      ${ICONS[r.id] || ''}<span>${r.label}</span>
    </button>`,
  ).join('');
  container.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
}

function renderNav() {
  renderNavButtons(ROUTES_PRIMARY, $('#nav'));
  renderNavButtons(ROUTES_ADVANCED, $('#nav-advanced'));
}

function setPage(title, desc) {
  const route = ROUTES.find((r) => r.id === state.route);
  $('#page-eyebrow').textContent = route?.eyebrow || 'Standard Registry';
  $('#page-title').textContent = title;
  $('#page-desc').textContent = desc;
}

function navigate(route) {
  state.route = route;
  renderNav();
  renderView();
  location.hash = route;
  if (route === 'database') loadDatabasePage();
}

function openModal(html) {
  modalBody.innerHTML = html;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function showStandardDetail(id) {
  const s = state.standards.standards.find((x) => x.id === id);
  if (!s) return;
  const cats = getCategoryMap();
  const cat = cats[s.category];
  const lay = getLay(id);

  openModal(`
    <div class="modal-header">
      <h2>${s.shortTitle}</h2>
      <p class="sub">${s.docNumber} · ${s.issuer}</p>
      <div class="modal-badges">
        <span class="badge ${badgeClass(s.status)}">${s.statusLabel}</span>
        <span class="tag tag-cat" style="--cat-color:${cat?.color}">${cat?.name}</span>
        <span class="tag">${priorityLabel(s.priority)}</span>
      </div>
    </div>
    <div class="modal-body-inner">
      ${lay ? `
        <div class="detail-section is-lay">
          <h4>这是什么？</h4>
          <div class="explain-box"><p>${lay.oneLiner}</p></div>
        </div>
        <div class="detail-section is-lay">
          <h4>为什么需要这份标准？</h4>
          <p style="font-size:14px;line-height:1.75;color:var(--text-secondary)">${lay.whyNeeded}</p>
        </div>
        <div class="detail-section is-lay">
          <h4>主要讲什么？</h4>
          <ul class="point-list">${lay.mainPoints.map((p) => `<li>${p}</li>`).join('')}</ul>
        </div>
        <div class="detail-section is-lay">
          <h4>跟本训练系统的关系</h4>
          <p style="font-size:14px;line-height:1.75;color:var(--primary)">${lay.inThisProject}</p>
        </div>
      ` : ''}
      <div class="detail-section is-tech">
        <h4>技术信息 · 项目作用</h4>
        <p>${s.projectRole}</p>
      </div>
      <div class="detail-section is-tech">
        <h4>效力</h4>
        <p>${s.effectiveFrom || '—'} ${s.effectiveUntil ? `→ ${s.effectiveUntil}` : '起'}</p>
      </div>
      ${s.localFile ? `<div class="detail-section is-tech"><h4>本地文件</h4><p><a href="${s.localFile}" target="_blank" rel="noopener">${s.localFileLabel || '打开本地文件'}</a></p></div>` : ''}
      <div class="detail-section is-tech">
        <h4>官方 / 公开链接</h4>
        <ul class="link-list">
          ${s.links.map((l) => `<li><a href="${l.url}" target="_blank" rel="noopener">${l.label}${l.primary ? ' · 推荐' : ''}</a></li>`).join('')}
        </ul>
      </div>
      <div class="detail-section is-tech">
        <h4>关键条款</h4>
        <ul class="clause-list">
          ${s.keyClauses.map((c) => `<li><strong>${c.clause}</strong> — ${c.summary}</li>`).join('')}
        </ul>
      </div>
      ${s.terminology.length ? `<div class="detail-section is-tech"><h4>相关术语</h4><div class="tag-row">${s.terminology.map((t) => `<span class="tag">${t}</span>`).join('')}</div></div>` : ''}
    </div>
  `);
}

function statCard(num, label, color, iconPath) {
  return `
    <article class="stat-card" style="--stat-color:${color};--stat-bg:${color}14">
      <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconPath}</svg></div>
      <div class="num">${num}</div>
      <div class="label">${label}</div>
    </article>`;
}

function renderGuide() {
  const g = state.guide;
  setPage(g.title, '先搞懂「在练什么、为什么要有标准」，再去看具体文件');

  viewEl.innerHTML = `
    <div class="guide-hero">
      <h3>${g.title}</h3>
      <p>如果你是第一次接触临床试验或这个项目，建议按顺序读完下面几段，大约 3 分钟。</p>
    </div>
    ${g.sections.map((sec, i) => {
      let body = `<p>${formatText(sec.content)}</p>`;
      if (sec.analogy) {
        body += `<div class="guide-analogy"><strong>打个比方：</strong>${sec.analogy}</div>`;
      }
      if (sec.points) {
        body += `<ul class="guide-list">${sec.points.map((p) => `<li>${formatText(p)}</li>`).join('')}</ul>`;
      }
      if (sec.steps) {
        body += `<div class="guide-steps">${sec.steps.map((st) => `
          <div class="guide-step"><strong>${st.label}</strong><span>${st.desc}</span></div>
        `).join('')}</div>`;
      }
      if (sec.rules) {
        body += `<div class="core-rules">${sec.rules.map((r, j) => `
          <div class="core-rule">
            <span class="core-rule-num">${j + 1}</span>
            <p>${formatText(r)}</p>
          </div>
        `).join('')}</div>`;
      }
      return `
        <section class="guide-section">
          <h3><span class="guide-num">${i + 1}</span>${sec.title}</h3>
          ${body}
        </section>`;
    }).join('')}
    <div class="guide-cta">
      <button type="button" data-goto="practice">开始：模拟对话练习</button>
      <button type="button" class="secondary" data-goto="database">或先看：数据库是否接通</button>
    </div>
  `;

  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.goto));
  });
}

async function fetchDbVerify() {
  const res = await fetch(`${API_BASE}/api/db/verify`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setConnStatus(ok, text) {
  const el = $('#conn-status');
  if (!el) return;
  el.classList.toggle('is-ok', !!ok);
  el.classList.toggle('is-bad', ok === false);
  el.querySelector('.conn-text').textContent = text;
}

async function refreshConnStatus() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    setConnStatus(
      true,
      data.agnes_configured ? '后端已连 · Agnes 已配置' : '后端已连 · 请配置 Agnes',
    );
  } catch {
    setConnStatus(false, '后端未启动（请开 :8000）');
  }
}

function renderDatabase() {
  setPage('数据库（仓库实况）', '外行也能看懂：标准、病例是否入库，AI 能不能通话并写进日志');
  const data = state.dbVerify;
  const busy = state.dbBusy;

  if (!data && !state.dbActionMsg) {
    viewEl.innerHTML = `<div class="empty"><p>正在读取数据库…</p></div>`;
    return;
  }

  if (!data) {
    viewEl.innerHTML = `
      <div class="empty">
        <p>暂时读不到数据库。</p>
        <p class="card-meta" style="margin-top:12px">请先启动：<code>python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000</code></p>
        <p class="card-meta">然后打开 <code>http://127.0.0.1:8000/#database</code></p>
        <div class="guide-cta" style="justify-content:center">
          <button type="button" id="db-retry">重试连接</button>
        </div>
        ${state.dbActionMsg ? `<pre class="db-raw">${state.dbActionMsg}</pre>` : ''}
      </div>`;
    $('#db-retry')?.addEventListener('click', () => loadDatabasePage());
    return;
  }

  const agnes = data.agnes || {};
  const samples = data.samples || {};

  viewEl.innerHTML = `
    <div class="guide-hero">
      <h3>数据库是什么？</h3>
      <p>${data.plain_summary || '项目的仓库：标准、病例、练习记录、AI 日志都放在这里。'}</p>
    </div>

    <div class="status-strip">
      <div class="status-pill ${data.ok ? 'ok' : 'bad'}">${data.ok ? '仓库状态：正常' : '仓库状态：不完整'}</div>
      <div class="status-pill ${agnes.configured ? 'ok' : 'warn'}">Agnes：${agnes.configured ? '已配置' : '未配置'} · ${agnes.model || '—'}</div>
      <div class="status-pill muted">密钥 ${agnes.api_key_masked || '—'}</div>
    </div>

    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">怎么证明「真的接入了」</div>
      <p>① 下面分组数字 > 0 说明标准/病例已入库；② 点「试写一条」数字会变；③ 点「呼叫 Agnes」会出现 AI 回复，并记进日志。</p>
      <p style="margin-top:8px;font-size:13px;color:var(--muted)">文件位置：<code>${data.database_file || '—'}</code></p>
    </div>

    <div class="guide-cta" style="margin-top:0;margin-bottom:20px">
      <button type="button" id="db-refresh" ${busy ? 'disabled' : ''}>刷新仓库</button>
      <button type="button" class="secondary" id="db-probe" ${busy ? 'disabled' : ''}>试写一条记录</button>
      <button type="button" id="db-ai" ${busy ? 'disabled' : ''}>呼叫 Agnes 并写库</button>
    </div>
    ${state.dbActionMsg ? `<div class="action-toast">${state.dbActionMsg}</div>` : ''}

    <div class="section-head">
      <h3 class="section-title">仓库货架（表分组）</h3>
      <span class="section-sub">数字 = 当前条数</span>
    </div>
    <div class="db-groups">
      ${(data.groups || []).map((g) => `
        <section class="db-group">
          <h4>${g.title}</h4>
          <p>${g.plain}</p>
          <ul>
            ${g.items.map((it) => `
              <li><span>${it.label}</span><strong>${it.count}</strong><code>${it.table}</code></li>
            `).join('')}
          </ul>
        </section>
      `).join('')}
    </div>

    <div class="section-head">
      <h3 class="section-title">库里的样例（白话）</h3>
    </div>
    <div class="arch-grid">
      <div class="arch-block">
        <h4>默认病例</h4>
        <ul>
          <li>${samples.case?.short_title || '—'}</li>
          <li>编号 ${samples.case?.case_code || '—'}</li>
          <li>状态 ${samples.case?.data_status || '—'} · v${samples.case?.version || '—'}</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>核心症状（节选）</h4>
        <ul>
          ${(samples.core_symptoms || []).slice(0, 5).map((s) => `<li>${s.name}（${s.symptom_code}）</li>`).join('') || '<li>暂无</li>'}
        </ul>
      </div>
      <div class="arch-block">
        <h4>规范文件（节选）</h4>
        <ul>
          ${(samples.standards || []).slice(0, 5).map((s) => `<li>${s.short_title}</li>`).join('') || '<li>暂无</li>'}
        </ul>
      </div>
    </div>

    <div class="section-head">
      <h3 class="section-title">最近 AI 通话记录</h3>
      <span class="section-sub">呼叫 Agnes 后会出现在这里</span>
    </div>
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead><tr><th>时间</th><th>耗时</th><th>回复预览</th><th>错误</th></tr></thead>
          <tbody>
            ${(samples.recent_ai_logs || []).length
              ? samples.recent_ai_logs.map((l) => `
                <tr>
                  <td>${(l.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td>${l.latency_ms ?? '—'} ms</td>
                  <td>${l.response_preview || '—'}</td>
                  <td>${l.error_message || '—'}</td>
                </tr>`).join('')
              : '<tr><td colspan="4">还没有记录。点上面「呼叫 Agnes 并写库」试一次。</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $('#db-refresh')?.addEventListener('click', () => loadDatabasePage());
  $('#db-probe')?.addEventListener('click', () => runDbAction('probe'));
  $('#db-ai')?.addEventListener('click', () => runDbAction('ai'));
}

async function loadDatabasePage() {
  state.dbBusy = true;
  state.dbActionMsg = '';
  try {
    state.dbVerify = await fetchDbVerify();
    setConnStatus(true, '数据库可读');
  } catch (err) {
    state.dbVerify = null;
    state.dbActionMsg = String(err.message || err);
    setConnStatus(false, '后端未启动（请开 :8000）');
  } finally {
    state.dbBusy = false;
    if (state.route === 'database') renderDatabase();
  }
}

async function runDbAction(kind) {
  state.dbBusy = true;
  state.dbActionMsg = kind === 'ai' ? '正在呼叫 Agnes，请稍候…' : '正在写入…';
  renderDatabase();
  try {
    const url = kind === 'ai' ? `${API_BASE}/api/ai/ping` : `${API_BASE}/api/db/probe`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (kind === 'ai') {
      state.dbActionMsg = data.ok
        ? `Agnes 已回复：${(data.content || '').trim() || '（空）'}（已写入日志）`
        : `呼叫失败：${JSON.stringify(data.error || data.message)}`;
    } else {
      state.dbActionMsg = data.ok ? `已写入探针 ${data.probe_id}` : '写入失败';
    }
    state.dbVerify = await fetchDbVerify();
  } catch (err) {
    state.dbActionMsg = `操作失败：${err.message || err}`;
  } finally {
    state.dbBusy = false;
    if (state.route === 'database') renderDatabase();
  }
}

function renderOverview() {
  setPage('系统概览', '标准底座可视化 · 后续训练系统均基于此数据层');
  const stds = state.standards.standards;
  const mvpItems = state.rubric.items.filter((i) => i.enabledMvp);
  const l1 = mvpItems.filter((i) => i.layer === 'L1').length;
  const primary = stds.filter((s) => s.priority === 'primary').length;

  viewEl.innerHTML = `
    <div class="stats-grid">
      ${statCard(stds.length, '纳入标准', '#0f766e', '<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/>')}
      ${statCard(primary, '主依据标准', '#2563eb', '<path d="M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z"/>')}
      ${statCard(mvpItems.length, 'MVP 评分项', '#7c3aed', '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>')}
      ${statCard(l1, 'L1 硬性条目', '#dc2626', '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>')}
    </div>

    <div class="section-head">
      <h3 class="section-title">双底座架构</h3>
      <span class="section-sub">训练价值 = 评得对 + 病人演得对</span>
    </div>
    <div class="arch-grid">
      <div class="arch-block">
        <h4>底座 A · 标准与评分</h4>
        <ul>
          <li>标准资料库（9 项注册）</li>
          <li>评分对照表（S1 知情同意 · ${mvpItems.length} 条 MVP）</li>
          <li>术语表（${state.terms.terms.length} 项）</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>底座 B · 病例症状事实</h4>
        <ul>
          <li>${state.casePackage ? `已入库：${state.casePackage.meta.short_title}` : '待 B0 病例包入库'}</li>
          <li>状态：${state.casePackage?.meta.data_status || '—'} · v${state.casePackage?.meta.version || '—'}</li>
          <li>核心症状 ${state.casePackage?.symptoms?.filter((s) => s.is_core && s.present).length || 0} 条（占位可替换）</li>
        </ul>
      </div>
      <div class="flow-banner">进入案例 → 沟通 → 关键问题 → 完成 → 反馈</div>
    </div>

    <div class="section-head">
      <h3 class="section-title">主依据标准</h3>
      <span class="section-sub">点击查看详情与官方链接</span>
    </div>
    <div class="cards-grid">
      ${stds.filter((s) => s.priority === 'primary').map((s) => renderStandardCard(s)).join('')}
    </div>
  `;
  bindCardClicks();
}

function renderStandardCard(s) {
  const cats = getCategoryMap();
  const cat = cats[s.category];
  const lay = getLay(s.id);
  return `
    <article class="card" data-id="${s.id}">
      <div class="card-accent" style="--cat-color:${cat?.color || '#0f766e'}"></div>
      <div class="card-body">
        <div class="card-head">
          <h3>${s.shortTitle}</h3>
          <span class="badge ${badgeClass(s.status)}">${s.statusLabel}</span>
        </div>
        ${lay ? `<p class="card-lay">${lay.oneLiner}</p>` : `<div class="card-meta">${s.issuer}<br/>${s.docNumber}</div>`}
        ${lay ? `<div class="card-why"><strong>为什么需要：</strong>${lay.whyNeeded}</div>` : ''}
        ${lay ? `<div class="card-project"><strong>在本项目中：</strong>${lay.inThisProject}</div>` : `<div class="card-role">${s.projectRole}</div>`}
        <div class="tag-row">
          <span class="tag tag-cat" style="--cat-color:${cat?.color}">${cat?.name}</span>
          <span class="tag">${priorityLabel(s.priority)}</span>
          <span class="tag">${s.localFile ? '本地归档' : '公开来源'}</span>
        </div>
      </div>
    </article>`;
}

function bindCardClicks() {
  viewEl.querySelectorAll('.card[data-id]').forEach((el) => {
    el.addEventListener('click', () => showStandardDetail(el.dataset.id));
  });
}

function renderStandards() {
  setPage('标准解释', '每份文件用白话说明：是什么、为什么需要、跟训练有什么关系');
  let list = [...state.standards.standards];

  if (state.filterCategory !== 'all') {
    list = list.filter((s) => s.category === state.filterCategory);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((s) => {
      const lay = getLay(s.id);
      return (
        s.title.toLowerCase().includes(q) ||
        s.shortTitle.toLowerCase().includes(q) ||
        s.projectRole.toLowerCase().includes(q) ||
        s.keyClauses.some((c) => c.summary.includes(q) || c.clause.includes(q)) ||
        (lay && (
          lay.oneLiner.includes(q) ||
          lay.whyNeeded.includes(q) ||
          lay.inThisProject.includes(q) ||
          lay.mainPoints.some((p) => p.includes(q))
        ))
      );
    });
  }

  viewEl.innerHTML = `
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">怎么读这一页</div>
      <p>每张卡片先告诉你「这份文件是什么、为什么要有它」；点卡片可看更详细的要点和原文条款链接。不需要一次全看完，从标了<strong>主依据</strong>的开始即可。</p>
    </div>
    <div class="filters">
      <button class="chip ${state.filterCategory === 'all' ? 'active' : ''}" data-cat="all">全部 ${state.standards.standards.length}</button>
      ${state.standards.categories.map(
        (c) => {
          const count = state.standards.standards.filter((s) => s.category === c.id).length;
          return `<button class="chip ${state.filterCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${c.name} ${count}</button>`;
        },
      ).join('')}
    </div>
    <div class="cards-grid">
      ${list.length ? list.map((s) => renderStandardCard(s)).join('') : '<div class="empty">未找到匹配的标准</div>'}
    </div>
  `;

  viewEl.querySelectorAll('.chip[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterCategory = btn.dataset.cat;
      renderStandards();
    });
  });
  bindCardClicks();
}

function renderTimeline() {
  setPage('效力时间线', '规范生效与切换节点 · 版本回归参考');
  const events = [];

  state.standards.standards.forEach((s) => {
    if (s.effectiveFrom) {
      events.push({
        date: s.effectiveFrom,
        title: `${s.shortTitle} 生效`,
        body: s.statusLabel,
        id: s.id,
      });
    }
    if (s.effectiveUntil) {
      events.push({
        date: s.effectiveUntil,
        title: `${s.shortTitle} 过渡截止`,
        body: '注意评分对照表版本切换',
        id: s.id,
      });
    }
  });

  events.push({
    date: '2026-03-31',
    title: 'ICH E6(R3) 适用节点',
    body: '此后实施的新试验均适用 E6(R3)',
    id: 'ich-e6-r3',
  });
  events.push({
    date: '2026-09-01',
    title: 'GCP 2026 施行 · GCP 2020 废止',
    body: '评分主锚从第二十三条切换至第二十七条',
    id: 'gcp-2026',
  });

  events.sort((a, b) => a.date.localeCompare(b.date));

  viewEl.innerHTML = `
    <div class="timeline">
      ${events.map(
        (e) => `
        <div class="timeline-item" ${e.id ? `data-id="${e.id}"` : ''}>
          <div class="timeline-date">${e.date}</div>
          <strong>${e.title}</strong>
          <p>${e.body}</p>
        </div>`,
      ).join('')}
    </div>
  `;

  viewEl.querySelectorAll('.timeline-item[data-id]').forEach((el) => {
    el.addEventListener('click', () => showStandardDetail(el.dataset.id));
  });
}

function typePill(type) {
  const t = TYPE_LABELS[type] || { label: type, cls: '' };
  return `<span class="pill ${t.cls}">${t.label}</span>`;
}

function renderRubric() {
  setPage('评分说明', '练完一次知情同意对话后，系统会按下面清单检查你有没有说到、有没有踩红线');
  let items = state.rubric.items.filter((i) => i.enabledMvp);
  if (state.filterLayer !== 'all') {
    items = items.filter((i) => i.layer === state.filterLayer);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter((i) => {
      const lay = getRubricLay(i.id);
      return (
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        (lay && (lay.layTitle.includes(q) || lay.layExplain.includes(q)))
      );
    });
  }

  const simple = state.simpleMode;
  const tableHead = simple
    ? `<tr><th>检查什么</th><th>白话解释</th><th>层级</th><th>类型</th></tr>`
    : `<tr><th>ID</th><th>类型</th><th>层级</th><th>标题</th><th>通过要点</th><th>失败/违规</th><th>规范来源</th></tr>`;

  const tableBody = items.map((i) => {
    const lay = getRubricLay(i.id);
    if (simple) {
      return `
        <tr>
          <td>
            <div class="rubric-lay-title">${lay?.layTitle || i.title}${i.hardFail ? '<span class="hard-fail">红线</span>' : ''}</div>
            ${!lay ? `<div class="rubric-lay-desc">${i.title}</div>` : ''}
          </td>
          <td>${lay?.layExplain || i.pass || '—'}</td>
          <td class="layer-${i.layer}">${i.layer}</td>
          <td>${typePill(i.type)}</td>
        </tr>`;
    }
    return `
      <tr>
        <td><code>${i.id}</code>${i.hardFail ? '<span class="hard-fail">否决</span>' : ''}</td>
        <td>${typePill(i.type)}</td>
        <td class="layer-${i.layer}">${i.layer}</td>
        <td>
          ${lay ? `<div class="rubric-lay-title">${lay.layTitle}</div><div class="rubric-lay-desc">${i.title}</div>` : `<strong>${i.title}</strong>`}
        </td>
        <td>${i.pass || '—'}</td>
        <td>${i.fail || '—'}</td>
        <td>${i.sources.map((s) => `<span class="tag">${s}</span>`).join(' ')}</td>
      </tr>`;
  }).join('');

  viewEl.innerHTML = `
    <div class="view-mode-bar">
      <span>显示模式：</span>
      <button type="button" class="toggle-btn ${simple ? 'active' : ''}" data-mode="simple">简单（推荐）</button>
      <button type="button" class="toggle-btn ${!simple ? 'active' : ''}" data-mode="pro">专业</button>
      <span style="margin-left:auto">${state.rubric.meta.passRule}</span>
    </div>
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">L1 / L2 / L3 是什么意思？</div>
      <p><strong>L1</strong> = 说了就合格、不说或说错就严重问题（含红线）；<strong>L2</strong> = 应该说到，漏了要扣分；<strong>L3</strong> = 加分项，说到更好。默认先看「简单」模式即可。</p>
    </div>
    <div class="filters">
      <button class="chip ${state.filterLayer === 'all' ? 'active' : ''}" data-layer="all">全部 MVP ${state.rubric.items.filter((i) => i.enabledMvp).length}</button>
      ${state.rubric.layers.map(
        (l) => {
          const count = state.rubric.items.filter((i) => i.enabledMvp && i.layer === l.id).length;
          return `<button class="chip ${state.filterLayer === l.id ? 'active' : ''}" data-layer="${l.id}">${l.id} · ${l.name} ${count}</button>`;
        },
      ).join('')}
    </div>
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead>${tableHead}</thead>
          <tbody>${tableBody}</tbody>
        </table>
      </div>
    </div>
  `;

  viewEl.querySelectorAll('.chip[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterLayer = btn.dataset.layer;
      renderRubric();
    });
  });
  viewEl.querySelectorAll('.toggle-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.simpleMode = btn.dataset.mode === 'simple';
      renderRubric();
    });
  });
}

function renderCases() {
  const pkg = state.casePackage;
  const idx = state.casesIndex;
  if (!pkg) {
    setPage('病例事实包', '底座 B 尚未加载');
    viewEl.innerHTML = '<div class="empty">未找到病例包</div>';
    return;
  }
  const m = pkg.meta;
  const core = pkg.symptoms.filter((s) => s.is_core && s.present);
  setPage(
    '病例事实包（底座 B）',
    '约束 AI 患者「演对病」的事实库 · 当前为占位数据，结构已按正式库设计',
  );

  viewEl.innerHTML = `
    <div class="guide-hero">
      <h3>${m.short_title}</h3>
      <p>${idx.cases[0]?.one_liner || m.title}</p>
    </div>
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">请先读这句</div>
      <p>${m.disclaimer}</p>
    </div>
    <div class="stats-grid">
      ${statCard(core.length, '核心症状', '#0f766e', '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>')}
      ${statCard(pkg.risks.length, '应告知风险点', '#dc2626', '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>')}
      ${statCard(pkg.forbidden_fabrications.length, '禁止编造项', '#d97706', '<path d="M18 6 6 18M6 6l12 12"/>')}
      ${statCard(m.version, '病例版本', '#2563eb', '<path d="M12 7v5l3 3"/><circle cx="12" cy="12" r="9"/>')}
    </div>

    <div class="section-head">
      <h3 class="section-title">病情摘要</h3>
      <span class="section-sub">${pkg.disease.name_zh} · ${pkg.protocol.phase} 期 · ${m.data_status}</span>
    </div>
    <div class="guide-section">
      <p><strong>主诉：</strong>${pkg.clinical_summary.chief_complaint}</p>
      <p><strong>病程：</strong>${pkg.clinical_summary.disease_duration} · ${pkg.clinical_summary.disease_stage}</p>
      <ul class="guide-list">
        ${pkg.clinical_summary.history_present.map((h) => `<li>${h}</li>`).join('')}
      </ul>
    </div>

    <div class="section-head">
      <h3 class="section-title">核心症状（必须演对）</h3>
      <span class="section-sub">AI 只能基于这些事实说话</span>
    </div>
    <div class="cards-grid">
      ${core.map((s) => `
        <article class="card scene-card">
          <div class="card-accent" style="--cat-color:#0f766e"></div>
          <div class="card-body">
            <div class="scene-code">${s.symptom_id}</div>
            <div class="card-head"><h3>${s.name}</h3><span class="badge badge-active">${s.severity_band}</span></div>
            <p class="card-meta">${s.clinical_name || ''} · ${s.onset_text || ''}</p>
            <div class="card-why"><strong>患者可能说：</strong>${(s.patient_may_say || []).slice(0, 2).join('；')}</div>
          </div>
        </article>
      `).join('')}
    </div>

    <div class="section-head">
      <h3 class="section-title">知情同意应告知的风险（白话）</h3>
    </div>
    <div class="guide-section">
      <ul class="point-list">
        ${pkg.risks.filter((r) => r.must_disclose).map((r) => `
          <li><strong>${r.title}</strong> — ${r.lay_summary}</li>
        `).join('')}
      </ul>
    </div>

    <div class="section-head">
      <h3 class="section-title">获益不确定性</h3>
    </div>
    <div class="guide-section">
      <ul class="point-list">
        ${pkg.benefits.map((b) => `
          <li><strong>${b.title}</strong> — ${b.lay_summary}${b.is_uncertain ? '（不确定）' : ''}</li>
        `).join('')}
      </ul>
    </div>

    <div class="section-head">
      <h3 class="section-title">基本患者人设（槽位）</h3>
    </div>
    <div class="guide-section">
      <p>${pkg.persona.lay_bio}</p>
      <div class="tag-row" style="margin-top:12px">
        <span class="tag">${pkg.persona.age_band} 岁段</span>
        <span class="tag">${pkg.persona.sex}</span>
        <span class="tag">${pkg.persona.emotion_baseline}</span>
        <span class="tag">${pkg.persona.comprehension_style}</span>
      </div>
    </div>

    <div class="section-head">
      <h3 class="section-title">禁止编造（生成护栏）</h3>
    </div>
    <div class="guide-section">
      <ul class="guide-list">
        ${pkg.forbidden_fabrications.map((f) => `<li>${f.description}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderScenes() {
  setPage('训练场景', '一期仅 S1 启用 · 其余待 B0 病例包就绪');
  viewEl.innerHTML = `
    <div class="cards-grid">
      ${state.scenes.scenes.map(
        (s) => `
        <article class="card scene-card">
          <div class="card-accent" style="--cat-color:${s.status === 'mvp' ? '#059669' : '#94a3b8'}"></div>
          <div class="card-body">
            <div class="scene-code">${s.code}</div>
            <div class="card-head">
              <h3>${s.name}</h3>
              <span class="badge ${s.status === 'mvp' ? 'badge-active' : 'badge-reference'}">${s.statusLabel}</span>
            </div>
            <p class="card-meta">${s.description}</p>
            <div class="tag-row">
              ${s.primaryStandards.map((id) => {
                const st = state.standards.standards.find((x) => x.id === id);
                return st ? `<span class="tag tag-clickable" data-std="${id}">${st.shortTitle}</span>` : '';
              }).join('')}
            </div>
          </div>
        </article>`,
      ).join('')}
    </div>
  `;
  viewEl.querySelectorAll('[data-std]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showStandardDetail(el.dataset.std);
    });
  });
}

function renderTerms() {
  setPage('术语表', '遇到看不懂的词来这里查 · 后面做训练系统也会用这些统一叫法');
  let list = state.terms.terms;
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(
      (t) => t.term.includes(q) || t.definition.includes(q) || t.field.includes(q),
    );
  }
  viewEl.innerHTML = `
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead><tr><th>术语</th><th>定义</th><th>字段</th><th>来源标准</th></tr></thead>
          <tbody>
            ${list.map(
              (t) => `
              <tr>
                <td><strong>${t.term}</strong></td>
                <td>${t.definition}</td>
                <td><code>${t.field}</code></td>
                <td>${t.sources.map((id) => {
                  const st = state.standards.standards.find((x) => x.id === id);
                  return st ? `<span class="tag tag-clickable" data-std="${id}">${st.shortTitle}</span>` : id;
                }).join(' ')}</td>
              </tr>`,
            ).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  viewEl.querySelectorAll('[data-std]').forEach((el) => {
    el.addEventListener('click', () => showStandardDetail(el.dataset.std));
  });
}

function roleLabel(role) {
  return { trainee: '你（研究者）', patient: '模拟受试者', system: '系统', coach: '带教' }[role] || role;
}

function renderPractice() {
  setPage('模拟对话', '与 AI 受试者练习知情同意沟通 · 仅为教学模拟');
  const p = state.practice;
  const active = !!p.sessionId && p.status !== 'completed';

  viewEl.innerHTML = `
    <div class="explain-box">
      <div class="explain-box-label">请先读这句</div>
      <p>这是<strong>练习场</strong>：AI 病人与系统反馈都可能有误。<strong>真正变专业，靠真实场景与人打交道和带教指导。</strong>系统结果只是建议。</p>
    </div>

    ${!p.sessionId ? `
      <div class="guide-hero">
        <h3>一期场景：知情同意沟通</h3>
        <p>默认病例为 2 型糖尿病试药知情同意（占位数据）。你扮演研究者，对方是模拟老年受试者。</p>
      </div>
      <div class="guide-cta">
        <button type="button" id="practice-start" ${p.busy ? 'disabled' : ''}>开始练习</button>
      </div>
      ${p.error ? `<div class="action-toast">${p.error}</div>` : ''}
    ` : `
      <div class="practice-meta">
        <span class="status-pill ok">${p.caseInfo?.short_title || p.caseInfo?.case_id || ''}</span>
        <span class="status-pill muted">会话 ${String(p.sessionId).slice(0, 8)}…</span>
        <span class="status-pill ${p.status === 'completed' ? 'ok' : 'warn'}">${p.status === 'completed' ? '已结束' : '进行中'}</span>
      </div>
      ${p.persona?.lay_bio ? `<p class="practice-bio">${p.persona.lay_bio}</p>` : ''}
      <div class="chat-panel" id="chat-panel">
        ${(p.messages || []).map((m) => `
          <div class="chat-bubble role-${m.role}">
            <div class="chat-role">${roleLabel(m.role)}</div>
            <div class="chat-text">${escapeHtml(m.content)}</div>
          </div>
        `).join('')}
        ${p.busy ? '<div class="chat-bubble role-system"><div class="chat-text">模拟受试者正在回复…</div></div>' : ''}
      </div>
      ${active ? `
        <form class="chat-composer" id="chat-form">
          <textarea id="chat-input" rows="3" placeholder="用研究者口吻说话，例如：先说明试验目的、风险，并强调可以随时退出…" ${p.busy ? 'disabled' : ''}></textarea>
          <div class="chat-actions">
            <button type="submit" ${p.busy ? 'disabled' : ''}>发送</button>
            <button type="button" class="secondary" id="practice-complete" ${p.busy ? 'disabled' : ''}>结束并获取建议反馈</button>
          </div>
        </form>
      ` : `
        <div class="guide-cta">
          <button type="button" data-goto="feedback">查看练习反馈</button>
          <button type="button" class="secondary" id="practice-restart">再练一次</button>
        </div>
      `}
      ${p.error ? `<div class="action-toast">${p.error}</div>` : ''}
    `}
  `;

  $('#practice-start')?.addEventListener('click', startPractice);
  $('#practice-restart')?.addEventListener('click', () => {
    state.practice = { sessionId: null, caseInfo: null, persona: null, messages: [], busy: false, status: null, error: '' };
    state.feedbackData = null;
    renderPractice();
  });
  $('#practice-complete')?.addEventListener('click', completePractice);
  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.goto));
  });
  const form = $('#chat-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    sendPracticeTurn(input?.value || '');
  });
  const panel = $('#chat-panel');
  if (panel) panel.scrollTop = panel.scrollHeight;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function startPractice() {
  state.practice.busy = true;
  state.practice.error = '';
  renderPractice();
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '创建失败');
    state.practice.sessionId = data.session_id;
    state.practice.caseInfo = data.case;
    state.practice.persona = data.persona;
    state.practice.messages = data.messages || [];
    state.practice.status = 'in_progress';
    state.feedbackData = null;
  } catch (err) {
    state.practice.error = `无法开始：${err.message || err}（请确认已启动后端 :8000）`;
  } finally {
    state.practice.busy = false;
    if (state.route === 'practice') renderPractice();
  }
}

async function sendPracticeTurn(text) {
  const content = String(text || '').trim();
  if (!content || !state.practice.sessionId) return;
  state.practice.busy = true;
  state.practice.error = '';
  renderPractice();
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.practice.sessionId}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '发送失败');
    state.practice.messages = data.messages || [];
  } catch (err) {
    state.practice.error = String(err.message || err);
  } finally {
    state.practice.busy = false;
    if (state.route === 'practice') renderPractice();
  }
}

async function completePractice() {
  if (!state.practice.sessionId) return;
  state.practice.busy = true;
  state.practice.error = '正在生成建议反馈，可能需要几十秒…';
  renderPractice();
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.practice.sessionId}/complete`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '结束失败');
    state.practice.status = 'completed';
    state.feedbackData = data.feedback;
    state.practice.error = '';
    navigate('feedback');
  } catch (err) {
    state.practice.error = String(err.message || err);
    state.practice.busy = false;
    if (state.route === 'practice') renderPractice();
  } finally {
    state.practice.busy = false;
  }
}

function renderFeedback() {
  setPage('练习反馈', '系统建议仅供参考 · 不是最终能力认证');
  const fb = state.feedbackData;

  if (!fb) {
    viewEl.innerHTML = `
      <div class="empty">
        <p>还没有反馈。请先在「模拟对话」中练习并点击结束。</p>
        <div class="guide-cta" style="justify-content:center">
          <button type="button" data-goto="practice">去模拟对话</button>
        </div>
      </div>`;
    viewEl.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
    return;
  }

  const items = fb.items || [];
  const l1 = items.filter((i) => i.layer === 'L1');

  viewEl.innerHTML = `
    <div class="explain-box">
      <div class="explain-box-label">重要说明</div>
      <p>${fb.advice_banner || '以下仅为系统练习建议，可能有误。真正提升靠真实场景与人对人实践及带教指导。'}</p>
    </div>

    <div class="guide-hero">
      <h3>${fb.overall_pass ? '练习通过线：达到（建议）' : '练习通过线：未达到（建议）'}</h3>
      <p>${escapeHtml(fb.summary || '')}</p>
    </div>

    <div class="status-strip">
      <div class="status-pill ${fb.overall_pass ? 'ok' : 'bad'}">${fb.overall_pass ? 'L1 练习线：过' : 'L1 练习线：未过'}</div>
      <div class="status-pill muted">L1 项 ${l1.length} 条</div>
      <div class="status-pill muted">病例 ${fb.case_code || '—'}</div>
    </div>

    <div class="section-head">
      <h3 class="section-title">可参考的改进建议</h3>
    </div>
    <div class="core-rules">
      ${(fb.improvements || []).length
        ? fb.improvements.map((im, idx) => `
          <div class="core-rule">
            <span class="core-rule-num">${idx + 1}</span>
            <p><strong>${escapeHtml(im.title || im.item_code)}</strong><br/>${escapeHtml(im.suggestion || '')}</p>
          </div>`).join('')
        : '<p class="card-meta">暂无特别改进项，仍建议请带教老师复核对话。</p>'}
    </div>

    <div class="section-head">
      <h3 class="section-title">分项结果（建议）</h3>
      <span class="section-sub">fail / uncertain 请对照证据自行判断</span>
    </div>
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead><tr><th>结果</th><th>检查项</th><th>说明</th><th>证据</th></tr></thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td><span class="verdict verdict-${it.verdict}">${it.verdict}</span>${it.hard_fail ? '<span class="hard-fail">红线</span>' : ''}</td>
                <td>
                  <div class="rubric-lay-title">${escapeHtml(it.lay_title || it.title || it.item_code)}</div>
                  <div class="rubric-lay-desc">${it.item_code} · ${it.layer || ''}</div>
                </td>
                <td>${escapeHtml(it.comment || it.lay_explain || '—')}</td>
                <td>${(it.evidence_spans || []).map((e) => escapeHtml(e.quote || '')).join('<br/>') || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="guide-analogy" style="margin-top:20px">
      <strong>免责声明：</strong>${escapeHtml(fb.disclaimer || '')}
    </div>

    <div class="guide-cta">
      <button type="button" data-goto="practice">返回对话 / 再练</button>
      <button type="button" class="secondary" data-goto="rubric">查看评分说明</button>
    </div>
  `;

  viewEl.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
}

function renderView() {
  switch (state.route) {
    case 'guide': return renderGuide();
    case 'overview': return renderOverview();
    case 'standards': return renderStandards();
    case 'cases': return renderCases();
    case 'database': return renderDatabase();
    case 'practice': return renderPractice();
    case 'feedback': return renderFeedback();
    case 'timeline': return renderTimeline();
    case 'rubric': return renderRubric();
    case 'scenes': return renderScenes();
    case 'terms': return renderTerms();
    default: return renderGuide();
  }
}

function initModal() {
  modal.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function initSearch() {
  $('#global-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    if (['standards', 'rubric', 'terms', 'cases'].includes(state.route)) renderView();
  });
}

async function init() {
  try {
    await loadData();
    initModal();
    initSearch();
    refreshConnStatus();
    const hash = location.hash.replace('#', '');
    navigate(ROUTES.some((r) => r.id === hash) ? hash : 'guide');
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      if (ROUTES.some((r) => r.id === h)) navigate(h);
    });
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">
      <p>数据加载失败。请通过统一入口访问：</p>
      <p style="margin-top:12px"><code>python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000</code></p>
      <p style="margin-top:8px">然后打开 <a href="http://127.0.0.1:8000/">http://127.0.0.1:8000/</a></p>
      <pre style="text-align:left;margin-top:16px;font-size:12px">${err.message}</pre>
    </div>`;
  }
}

init();
