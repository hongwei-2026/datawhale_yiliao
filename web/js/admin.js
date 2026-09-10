/** 管理端 UI：病例/场景/账号/数字人（人话展示） */

export function isAdminUser(user) {
  return (user?.role || '') === 'admin';
}

const ROLE_TABS = [
  { id: 'admin', label: '管理员' },
  { id: 'instructor', label: '老师 / 带教' },
  { id: 'trainee', label: '学员' },
];

const ROLE_LABEL = {
  admin: '管理员',
  instructor: '老师 / 带教',
  trainee: '学员',
};

const VISUAL_LABEL = {
  live2d: '动画形象（Live2D）',
  portrait: '静态肖像',
  avatar3d: '三维形象',
};

export function createAdminController({ fetchApi, API_BASE, escapeHtml, navigate, state, confirmDialog }) {
  let tab = 'overview';
  let userRoleTab = 'trainee';
  let cache = {
    stats: null,
    cases: [],
    scenes: [],
    users: [],
    avatars: null,
    error: '',
    busy: false,
    message: '',
  };

  /** 病例接入向导（PRD 11） */
  let ingest = {
    step: 'hub', // hub | form | material_review | expand | review
    mode: '', // rough | material | human
    scene_key: 'follow_up',
    disease_code: 'HTN',
    display_name: '',
    source_text: '',
    source_filename: '',
    file_reports: [], // 交材料扫描结果：keep/reject/skip + reason + preview
    file_preview_idx: 0,
    pending_files: [], // File[] 待上传（拖入/多选）
    upload_busy: false,
    upload_progress: null, // { phase, percent, total, label }
    draft: null,
    drafts: [],
    whitelist: [],
    diseases: [
      { disease_code: 'T2DM', name_zh: '2型糖尿病' },
      { disease_code: 'HTN', name_zh: '高血压' },
    ],
    busy: false,
    highlight: '',
    selected: [], // [{kind, idx, text}]
    reviseNote: '',
  };

  /** 本期可挂场景（管理端文案用「场景 / 病例」，不用「关卡 / 对手」） */
  const TRAIN_LEVELS = {
    informed_consent: {
      scene_key: 'informed_consent',
      code: 'S1',
      label: '知情同意',
      skill: '讲试验 + 回应担心',
      goal: '学员练完能：讲清要点、回应退出/副作用等关切，不踩红线',
      rubric: '知情同意检查表',
      examples: '如张大爷、王阿姨、周明华',
    },
    follow_up: {
      scene_key: 'follow_up',
      code: 'S5',
      label: '随访（询问）',
      skill: '逐项追问核查，非责备',
      goal: '学员练完能：问清用药/漏服/不适，把隐瞒问出来，不踩红线',
      rubric: '随访检查表',
      examples: '如李建国、陈美玲、刘大山',
    },
  };

  function trainLevel(sceneKey) {
    return TRAIN_LEVELS[sceneKey] || TRAIN_LEVELS.follow_up;
  }

  /** 可发布白名单 + 资料库/新加场景，供选择器与标签统一用 */
  function sceneTierOf(s) {
    const id = String(s?.id || s?.scene_key || '').trim();
    if (TRAIN_LEVELS[id]) return 'formal';
    const t = String(s?.tier || '').toLowerCase();
    if (t === 'formal' || t === 'test') return t;
    if (s?.status === 'planned' || s?.statusLabel === '预留') return 'reserved';
    return 'test';
  }

  function allSceneChoices() {
    const byKey = new Map();
    for (const lv of Object.values(TRAIN_LEVELS)) {
      byKey.set(lv.scene_key, {
        scene_key: lv.scene_key,
        label: lv.label,
        code: lv.code || '',
        skill: lv.skill || '',
        goal: lv.goal || '',
        publishable: true,
        tier: 'formal',
        examples: lv.examples || '',
      });
    }
    for (const s of cache.scenes || []) {
      const id = String(s.id || s.scene_key || '').trim();
      if (!id || byKey.has(id)) continue;
      const tier = sceneTierOf(s);
      byKey.set(id, {
        scene_key: id,
        label: sceneTitle(s),
        code: s.code || '',
        skill: sceneDesc(s) || '',
        goal: '',
        tier,
        publishable: tier === 'formal',
        statusLabel: sceneStatusLabel(s),
      });
    }
    return [...byKey.values()];
  }

  function sceneMetaOf(sceneKey) {
    const key = String(sceneKey || '').trim();
    const hit = allSceneChoices().find((s) => s.scene_key === key);
    if (hit) return hit;
    if (TRAIN_LEVELS[key]) {
      const lv = TRAIN_LEVELS[key];
      return {
        scene_key: key,
        label: lv.label,
        code: lv.code || '',
        skill: lv.skill || '',
        publishable: true,
        tier: 'formal',
      };
    }
    return {
      scene_key: key || 'follow_up',
      label: key || trainLevel('follow_up').label,
      code: '',
      skill: '',
      publishable: false,
      tier: 'test',
    };
  }

  function sceneLabelOf(sceneKey) {
    return sceneMetaOf(sceneKey).label;
  }

  function levelFromMvpScenes(mvp) {
    const codes = mvp || [];
    if (codes.includes('S1')) return TRAIN_LEVELS.informed_consent;
    if (codes.includes('S5')) return TRAIN_LEVELS.follow_up;
    return null;
  }

  function countPublishedOnLevel(code) {
    return (cache.cases || []).filter((c) => (c.mvp_scenes || []).includes(code)).length;
  }

  /** 病例与场景页内分页：新建（三选一）/ 草稿 / 已发布 / 形象 */
  let casesSubtab = 'create'; // create | drafts | published | avatars
  /** 新建分流：hub 三选一，或进入某一独立页 */
  let createPath = 'hub'; // hub | scene | disease | case

  let selectedGalleryPath = '';
  /** 仅某一受试者卡片在生成立绘，不整页「加载中」 */
  let avatarGenPid = '';
  let currentPage = 'cases';

  async function loadAll(opts = {}) {
    const silent = !!opts.silent;
    if (!silent) cache.busy = true;
    cache.error = '';
    try {
      const [stats, cases, scenes, users, avatars, drafts, whitelist, diseases] = await Promise.all([
        fetchApi(`${API_BASE}/api/admin/stats`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/cases`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/scenes`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/users`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/avatars`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts`).then((r) => r.data).catch(() => ({ drafts: [] })),
        fetchApi(`${API_BASE}/api/admin/cases/ingest/scenes`).then((r) => r.data).catch(() => ({ scenes: [] })),
        fetchApi(`${API_BASE}/api/admin/cases/ingest/diseases`).then((r) => r.data).catch(() => ({ diseases: [] })),
      ]);
      if (!stats?.ok) throw new Error(stats?.detail || '无法加载统计');
      cache.stats = stats;
      cache.cases = cases?.cases || [];
      cache.scenes = scenes?.scenes || [];
      cache.users = users?.users || [];
      cache.avatars = avatars;
      ingest.drafts = drafts?.drafts || [];
      ingest.whitelist = whitelist?.scenes || [
        { scene_key: 'informed_consent', label: '知情同意' },
        { scene_key: 'follow_up', label: '随访（询问）' },
      ];
      ingest.diseases = diseases?.diseases || [
        { disease_code: 'T2DM', name_zh: '2型糖尿病' },
        { disease_code: 'HTN', name_zh: '高血压' },
      ];
    } catch (err) {
      cache.error = String(err.message || err);
    } finally {
      if (!silent) cache.busy = false;
    }
  }

  function apiError(data, fallback) {
    const d = data?.detail ?? data?.error ?? fallback;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('；') || fallback;
    if (d && typeof d === 'object') return d.msg || d.message || JSON.stringify(d);
    return fallback || '操作失败';
  }

  async function askConfirm(message, opts) {
    if (typeof confirmDialog === 'function') return confirmDialog(message, opts);
    return window.confirm(message);
  }

  function sceneTitle(s) {
    return s.name || s.title || s.id || s.scene_key || '未命名场景';
  }

  function sceneDesc(s) {
    return s.description || s.summary || '';
  }

  function sceneStatusLabel(s) {
    if (s.statusLabel) return s.statusLabel;
    if (s.enabled === false || s.status === 'planned') return '预留 / 停用';
    if (s.status === 'mvp') return '一期必做';
    if (s.status === 'beta') return '可用';
    return '启用';
  }

  function modelLabel(id, modelsMeta) {
    if (!id) return '系统默认';
    const m = modelsMeta?.[id];
    return m?.label || id;
  }

  function portraitUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    const base = path.startsWith('/') ? path : `/live2d/portraits/${path}`;
    if (base.includes('?v=')) return base;
    // 防浏览器磁盘缓存读坏：无版本号时加会话戳
    return `${base}${base.includes('?') ? '&' : '?'}v=${Date.now()}`;
  }

  function portraitImgHtml(src, alt) {
    const url = portraitUrl(src);
    if (!url) return '<div class="admin-avatar-empty">暂无肖像</div>';
    const svgFallback = url.replace(/\.webp(\?|$)/i, '.svg$1').replace(/\.png(\?|$)/i, '.svg$1');
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}" decoding="async" data-fallback="${escapeHtml(svgFallback)}" onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback;}else{this.replaceWith(Object.assign(document.createElement('div'),{className:'admin-avatar-empty',textContent:'图裂了，可点 AI 生成'}));}" />`;
  }

  function tabsHtml() {
    return '';
  }

  function casesSubtabsHtml() {
    const items = [
      { id: 'create', label: '新建' },
      { id: 'drafts', label: `草稿箱（${(ingest.drafts || []).filter((d) => d.status !== 'published').length}）` },
      { id: 'published', label: `已发布（${cache.cases.length}）` },
      { id: 'avatars', label: '数字人形象' },
    ];
    return `
      <div class="admin-subtabs">
        ${items.map((t) => `
          <button type="button" class="admin-subtab ${casesSubtab === t.id ? 'is-active' : ''}" data-cases-subtab="${t.id}">
            ${t.label}
          </button>`).join('')}
      </div>`;
  }

  function overviewHtml() {
    return '';
  }

  function createPanelHtml() {
    if (createPath === 'scene') return createScenePageHtml();
    if (createPath === 'disease') return createDiseasePageHtml();
    if (createPath === 'case') return createCasePageHtml();
    return createHubHtml();
  }

  function libraryHtml() {
    if (ingest.step === 'form') return ingestFormHtml();
    if (ingest.step === 'material_review') return ingestMaterialReviewHtml();
    if (ingest.step === 'expand') return ingestExpandHtml();
    if (ingest.step === 'review') return ingestReviewHtml();
    return `
      ${casesSubtabsHtml()}
      ${casesSubtab === 'create' ? createPanelHtml() : ''}
      ${casesSubtab === 'drafts' ? ingestHubDraftsHtml() : ''}
      ${casesSubtab === 'published' ? ingestHubPublishedHtml() : ''}
      ${casesSubtab === 'avatars' ? avatarsHtml() : ''}
    `;
  }

  function casesHtml() {
    return libraryHtml();
  }

  function sceneOptionsHtml(selected) {
    const groups = [
      { title: '正式可练', items: allSceneChoices().filter((s) => s.tier === 'formal' || s.publishable) },
      { title: '测试', items: allSceneChoices().filter((s) => s.tier === 'test') },
      { title: '系统预留', items: allSceneChoices().filter((s) => s.tier === 'reserved') },
    ];
    return groups.map((g) => {
      if (!g.items.length) return '';
      const opts = g.items.map((s) => `
      <option value="${escapeHtml(s.scene_key)}" ${selected === s.scene_key ? 'selected' : ''}>
        ${escapeHtml(s.label)}${s.code ? `（${escapeHtml(s.code)}）` : ''}${s.tier === 'formal' ? ' · 正式' : s.tier === 'test' ? ' · 测试' : ' · 预留'}
      </option>`).join('');
      return `<optgroup label="${escapeHtml(g.title)}">${opts}</optgroup>`;
    }).join('');
  }

  function diseaseOptionsHtml(selected) {
    return (ingest.diseases || [
      { disease_code: 'T2DM', name_zh: '2型糖尿病' },
      { disease_code: 'HTN', name_zh: '高血压' },
    ]).map((d) => `
      <option value="${escapeHtml(d.disease_code)}" ${selected === d.disease_code ? 'selected' : ''}>
        ${escapeHtml(d.name_zh || d.disease_code)}
      </option>`).join('');
  }

  function fixedSceneCardsHtml(opts = {}) {
    const selectable = opts.selectable !== false;
    return Object.values(TRAIN_LEVELS).map((lv) => {
      const on = ingest.scene_key === lv.scene_key;
      const n = countPublishedOnLevel(lv.code);
      const inner = `
          <div class="admin-level-card-top">
            <strong>${escapeHtml(lv.label)}</strong>
            <span class="admin-level-code">${escapeHtml(lv.code)}</span>
          </div>
          <span class="admin-level-skill">${escapeHtml(lv.skill)}</span>
          <span class="admin-level-goal">${escapeHtml(lv.goal)}</span>
          <span class="admin-level-meta">评分表：${escapeHtml(lv.rubric)} · 已发布 ${n} 例 · ${escapeHtml(lv.examples)}</span>`;
      if (!selectable) {
        return `<div class="admin-level-card">${inner}</div>`;
      }
      return `
        <button type="button" class="admin-level-card ${on ? 'is-active' : ''}" data-ingest-level="${lv.scene_key}">
          ${inner}
        </button>`;
    }).join('');
  }

  /** 紧凑可搜索场景列表：场景变多时不拉长整页 */
  function caseScenePickerHtml() {
    const cur = sceneMetaOf(ingest.scene_key);
    const formal = allSceneChoices().filter((s) => s.tier === 'formal' || s.publishable);
    const testing = allSceneChoices().filter((s) => s.tier === 'test');
    const reserved = allSceneChoices().filter((s) => s.tier === 'reserved');
    const badgeOf = (s) => {
      if (s.tier === 'formal' || s.publishable) return { cls: 'is-ok', text: '正式' };
      if (s.tier === 'reserved') return { cls: 'is-test', text: '预留' };
      return { cls: 'is-test', text: '测试' };
    };
    const row = (s) => {
      const on = ingest.scene_key === s.scene_key;
      const badge = badgeOf(s);
      const sub = s.publishable
        ? (s.skill || s.goal || '正式 · 可发布到学员端')
        : (s.skill || s.statusLabel || (s.tier === 'test' ? '测试 · 仅管理端试跑，不进学员端' : '系统预留'));
      const search = `${s.label} ${s.code} ${s.scene_key} ${sub} ${badge.text}`.trim();
      return `
        <button type="button"
          class="admin-scene-row ${on ? 'is-active' : ''}"
          data-ingest-level="${escapeHtml(s.scene_key)}"
          data-scene-search="${escapeHtml(search)}"
          title="${escapeHtml(s.scene_key)}">
          <span class="admin-scene-row-main">
            <strong>${escapeHtml(s.label)}</strong>
            ${s.code ? `<span class="admin-level-code">${escapeHtml(s.code)}</span>` : ''}
            <span class="admin-scene-row-sub">${escapeHtml(sub)}</span>
          </span>
          <span class="admin-scene-badge ${badge.cls}">${badge.text}</span>
        </button>`;
    };
    const group = (title, items) => {
      if (!items.length) return '';
      return `
        <div class="admin-scene-group" data-scene-group>
          <div class="admin-scene-group-title">${escapeHtml(title)}（${items.length}）</div>
          ${items.map(row).join('')}
        </div>`;
    };
    const curBadge = badgeOf(cur);
    return `
      <div class="admin-scene-picker">
        <div class="admin-scene-picker-current" id="ingest-scene-current">
          当前：<strong>${escapeHtml(cur.label)}</strong>
          <span class="admin-scene-badge ${curBadge.cls}">${curBadge.text}</span>
          <span class="admin-muted-id">${escapeHtml(cur.scene_key)}</span>
        </div>
        <label class="admin-scene-filter-label">
          <input type="search" id="ingest-scene-filter" placeholder="搜索场景名称 / 简码 / 内部编码…" autocomplete="off" aria-label="搜索场景" />
        </label>
        <div class="admin-scene-picker-list" id="ingest-scene-list">
          ${group('正式', formal)}
          ${group('测试', testing)}
          ${group('系统预留', reserved)}
        </div>
        <p class="admin-hint" style="margin-top:8px;">
          正式 / 测试由管理员自选。<strong>只有正式</strong>可发布到学员端；测试仅管理端写材料/草稿试跑。
        </p>
      </div>`;
  }

  function materialModesHtml() {
    return `
        <div class="admin-ingest-modes">
          <button type="button" class="admin-ingest-mode" data-ingest-mode="rough">
            <strong>只有几句故事</strong>
            <span>写个大概 → 先扩案例文稿 → 再整理成练习卡片</span>
          </button>
          <button type="button" class="admin-ingest-mode" data-ingest-mode="material">
            <strong>手头有 Word / PDF</strong>
            <span>交材料 → 扫垃圾文件 → 抽取整理 → 人审</span>
          </button>
          <button type="button" class="admin-ingest-mode" data-ingest-mode="human">
            <strong>内容你已写全</strong>
            <span>纯人写 → 系统只整理格式，不替你编事实</span>
          </button>
        </div>`;
  }

  function createHubHtml() {
    const nIc = countPublishedOnLevel('S1');
    const nFu = countPublishedOnLevel('S5');
    const diseaseNames = (ingest.diseases || []).map((d) => d.name_zh || d.disease_code).filter(Boolean);
    return `
      <div class="admin-card admin-purpose-banner">
        <h4>新建 · 三选一</h4>
        <p class="admin-hint">
          按手头任务点<strong>其中一个</strong>即可，不必三项都走。
          顺序建议：先场景（若需要）→ 再病种 → 再病例。
          默认可挂场景仍是<strong>知情同意</strong>（已发布 ${nIc}）与<strong>随访（询问）</strong>（已发布 ${nFu}）。
        </p>
      </div>
      <div class="admin-card">
        <div class="admin-ingest-modes admin-create-paths">
          <button type="button" class="admin-ingest-mode" data-create-path="scene">
            <strong>新增场景</strong>
            <span>新开一种沟通局（进阶）。单独一页填名称与说明；不写病例材料。</span>
          </button>
          <button type="button" class="admin-ingest-mode" data-create-path="disease">
            <strong>新增病种</strong>
            <span>登记试验病种（如 COPD）。加病例前先有病种可选；评分侧重点可后配 overlay。</span>
          </button>
          <button type="button" class="admin-ingest-mode" data-create-path="case">
            <strong>新增病例</strong>
            <span>新开试验/访视病例包：选场景 → 病种 → 材料 → 人审发布。</span>
          </button>
        </div>
      </div>
      <div class="admin-card">
        <h4>本期固定场景（说明）</h4>
        <p class="admin-hint">加病例时按场景性质分「正式 / 测试」。新建场景时可自选；系统固定正式为知情同意与随访。</p>
        <div class="admin-level-grid">${fixedSceneCardsHtml({ selectable: false })}</div>
      </div>
      <div class="admin-card">
        <h4>已有病种</h4>
        <p class="admin-hint">${diseaseNames.length ? escapeHtml(diseaseNames.join('、')) : '暂无'}。要扩目录请点「新增病种」。</p>
      </div>`;
  }

  function createScenePageHtml() {
    const publishableIds = new Set(Object.keys(TRAIN_LEVELS));
    const fromFile = (cache.scenes || []).filter((s) => {
      const id = s.id || s.scene_key || '';
      return id && !publishableIds.has(id);
    });
    const reservedRows = fromFile.map((s) => {
      const id = s.id || s.scene_key || '';
      const code = s.code ? `（${s.code}）` : '';
      const tier = sceneTierOf(s);
      const tierBadge = tier === 'formal'
        ? '<span class="admin-scene-badge is-ok">正式</span>'
        : tier === 'reserved'
          ? '<span class="admin-scene-badge is-test">预留</span>'
          : '<span class="admin-scene-badge is-test">测试</span>';
      const toggleBtn = tier === 'reserved'
        ? '<span class="admin-muted-id">系统预留</span>'
        : (tier === 'formal'
          ? `<button type="button" class="admin-btn" data-scene-tier="${escapeHtml(id)}" data-tier="test">改回测试</button>`
          : `<button type="button" class="admin-btn primary" data-scene-tier="${escapeHtml(id)}" data-tier="formal">设为正式</button>`);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(sceneTitle(s))}</strong>${escapeHtml(code)} ${tierBadge}
            <div class="admin-muted-id">内部编码：${escapeHtml(id)}</div>
          </td>
          <td>${escapeHtml(sceneDesc(s)) || '—'}</td>
          <td>${escapeHtml(sceneStatusLabel(s))}</td>
          <td>
            ${toggleBtn}
            <button type="button" class="admin-btn danger" data-del-scene="${escapeHtml(id)}">删除</button>
          </td>
        </tr>`;
    }).join('');

    const publishRows = Object.values(TRAIN_LEVELS).map((lv) => {
      const n = countPublishedOnLevel(lv.code);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(lv.label)}</strong>（${escapeHtml(lv.code)}）
            <span class="admin-scene-badge is-ok">正式</span>
            <div class="admin-muted-id">内部编码：${escapeHtml(lv.scene_key)} · 系统固定</div>
          </td>
          <td>${escapeHtml(lv.goal)}</td>
          <td><span class="admin-tag-ok">正式可练</span> · 已发布 ${n} 例</td>
          <td><span class="admin-muted-id">不可改性质</span></td>
        </tr>`;
    }).join('');

    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" data-create-path="hub">← 返回新建</button>
        <h4>新增场景</h4>
        <p class="admin-hint">
          新建时必须选<strong>测试</strong>或<strong>正式</strong>（管理员自定）。
          正式可发布到学员端；测试只做管理端试跑，不进学员端（可随时改成正式）。
          知情同意 / 随访为系统固定正式场景。
        </p>
      </div>
      <div class="admin-card">
        <h4>① 系统固定正式场景（只读）</h4>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>场景</th><th>练完多会什么</th><th>状态</th><th></th></tr></thead>
            <tbody>${publishRows}</tbody>
          </table>
        </div>
      </div>
      <div class="admin-card">
        <h4>② 填写新场景</h4>
        <div class="admin-form-grid">
          <label>场景名称（给人看）
            <input id="admin-scene-title" placeholder="如：家属协同沟通" />
          </label>
          <label>简码（可选）
            <input id="admin-scene-code" placeholder="如：S6" />
          </label>
          <label class="span-2">说明
            <input id="admin-scene-summary" placeholder="这个场景练什么" />
          </label>
          <label class="span-2">内部编码（英文；勿与已有 risk_explanation 等重复）
            <input id="admin-scene-id" placeholder="如 family_proxy_talk" />
          </label>
          <fieldset class="span-2 admin-tier-fieldset">
            <legend>场景性质（必选）</legend>
            <label class="admin-tier-option">
              <input type="radio" name="admin-scene-tier" value="test" checked />
              <span><strong>测试</strong> — 仅管理端登记/试跑；不能发布到学员端</span>
            </label>
            <label class="admin-tier-option">
              <input type="radio" name="admin-scene-tier" value="formal" />
              <span><strong>正式</strong> — 可发布到学员端练习（无专用评分包时用知情/随访表兜底）</span>
            </label>
          </fieldset>
        </div>
        <button type="button" class="admin-btn primary" id="admin-scene-save">保存场景</button>
      </div>
      <div class="admin-card">
        <h4>③ 已登记场景（${fromFile.length}）</h4>
        <p class="admin-hint">可随时「设为正式 / 改回测试」。系统预留项不可改性质。</p>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>条目</th><th>说明</th><th>状态</th><th></th></tr></thead>
            <tbody>${reservedRows || '<tr><td colspan="4">暂无额外条目</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function createDiseasePageHtml() {
    const rows = (ingest.diseases || []).map((d) => {
      const code = d.disease_code || '';
      const builtin = !!d.builtin;
      const intro = (d.introduction || '').trim();
      const introPreview = intro
        ? (intro.length > 80 ? `${intro.slice(0, 80)}…` : intro)
        : '（暂无病种介绍）';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(d.name_zh || code)}</strong>
            <div class="admin-muted-id">${escapeHtml(code)}${d.icd10 ? ` · ICD ${escapeHtml(d.icd10)}` : ''}${builtin ? ' · 内置' : ''}</div>
          </td>
          <td>
            <div>${escapeHtml(d.description || '—')}</div>
            <div class="admin-muted-id" style="margin-top:4px;">介绍：${escapeHtml(introPreview)}</div>
          </td>
          <td>${builtin
            ? '<span class="admin-muted-id">不可删</span>'
            : `<button type="button" class="admin-btn danger" data-del-disease="${escapeHtml(code)}">删除</button>`}
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" data-create-path="hub">← 返回新建</button>
        <h4>新增病种</h4>
        <p class="admin-hint">
          登记病种目录供加病例选用。<strong>病种介绍必填</strong>——写清这个病是什么、受试者常担心什么，
          方便带教看懂，也会注入模拟对话的病种锚定。评分侧重点可另补 overlay（PRD3.0/04）。
        </p>
      </div>
      <div class="admin-card">
        <h4>填写新病种</h4>
        <p class="admin-hint">
          <strong>编码可留空</strong>：保存时由 AI 根据名称+介绍自动生成（如 COPD）；AI 不可用则规则兜底。
        </p>
        <div class="admin-form-grid">
          <label>病种名称（给人看）*
            <input id="admin-disease-name" placeholder="如：慢性阻塞性肺疾病" />
          </label>
          <label>编码（可选 · 不填则 AI 自动生成）
            <input id="admin-disease-code" placeholder="留空即可，或手填如 COPD" autocomplete="off" />
          </label>
          <label>ICD 编码（可选）
            <input id="admin-disease-icd" placeholder="如：J44" />
          </label>
          <label>短说明（可选 · 挂什么试验）
            <input id="admin-disease-desc" placeholder="如：吸入剂试验随访用" />
          </label>
          <label class="span-2">病种介绍（必填 · 这个病是什么、受试者常担心什么）
            <textarea id="admin-disease-intro" rows="5" placeholder="例：慢阻肺以长期通气气流受限为特征，常见气短、咳嗽咳痰；受试者可能漏吸吸入剂、自行买止咳药，怕被说不配合。沟通时贴合呼吸/吸入体验，勿串成高血压或糖尿病话术。"></textarea>
          </label>
        </div>
        <div class="admin-review-btns" style="margin-top:10px;gap:8px;display:flex;flex-wrap:wrap;">
          <button type="button" class="admin-btn" id="admin-disease-suggest">仅预览 AI 编码</button>
          <button type="button" class="admin-btn primary" id="admin-disease-save">保存病种</button>
        </div>
        <p class="admin-muted-id" id="admin-disease-code-hint" style="margin-top:8px;"></p>
      </div>
      <div class="admin-card">
        <h4>病种列表（${(ingest.diseases || []).length}）</h4>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>病种</th><th>说明 / 介绍</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">暂无病种</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function createCasePageHtml() {
    const cur = sceneMetaOf(ingest.scene_key);
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" data-create-path="hub">← 返回新建</button>
        <h4>新增病例</h4>
        <p class="admin-hint">新开一份试验/访视病例：先选场景与病种，再按手头材料写入；人审后发布。</p>
      </div>
      <div class="admin-card">
        <h4>① 选择场景</h4>
        <p class="admin-hint">上方固定展示「当前选中」。要新开沟通局请回新建 →「新增场景」。</p>
        ${caseScenePickerHtml()}
      </div>
      <div class="admin-card">
        <h4>② 选择病种</h4>
        <label class="admin-inline-label">病种
          <select id="ingest-hub-disease">${diseaseOptionsHtml(ingest.disease_code)}</select>
        </label>
      </div>
      <div class="admin-card">
        <h4>③ 材料从哪来（当前：${escapeHtml(cur.label)}）</h4>
        <p class="admin-hint">${cur.publishable
          ? '三条路径最后都进人审；发布后进学员端。'
          : '当前是测试场景：可写材料与草稿，但不能发布到学员端。要进学员端请先「设为正式」。'}</p>
        ${materialModesHtml()}
      </div>
      <details class="admin-card admin-eng-fallback">
        <summary>工程兜底：粘贴病例 JSON（不对老师主推）</summary>
        <p class="admin-hint">仅迁移/开发用。主路径请用上面三步。</p>
        <div class="admin-import-row">
          <input type="file" id="admin-case-file" accept="application/json,.json" />
          <button type="button" class="admin-btn primary" id="admin-case-import">导入并生效</button>
        </div>
        <textarea id="admin-case-json" rows="4" placeholder="粘贴病例 JSON…"></textarea>
      </details>`;
  }

  function ingestHubDraftsHtml() {
    const openDrafts = (ingest.drafts || []).filter((d) => d.status !== 'published');
    const publishedDrafts = (ingest.drafts || []).filter((d) => d.status === 'published');
    const statusLabel = (d) => ({
      source_ready: '材料已确认 · 待整理',
      expand_review: '待审案例文稿',
      review: '待审练习卡片',
      published: '已发布',
    }[d.status] || d.status || '草稿');
    const draftRows = openDrafts.map((d) => `
      <tr>
        <td><strong>${escapeHtml(d.display_name || '未命名')}</strong>
          <div class="admin-muted-id">${escapeHtml(statusLabel(d))} · ${escapeHtml(d.mode || '')}${d.source_filename ? ` · ${escapeHtml(d.source_filename)}` : ''}</div>
        </td>
        <td>${escapeHtml(sceneLabelOf(d.scene_key))}</td>
        <td>${escapeHtml((d.updated_at || '').slice(0, 19).replace('T', ' '))}</td>
        <td>
          <button type="button" class="admin-btn primary" data-open-draft="${escapeHtml(d.draft_id)}">继续</button>
          <button type="button" class="admin-btn danger" data-del-draft="${escapeHtml(d.draft_id)}">废弃</button>
        </td>
      </tr>`).join('');
    const publishedRows = publishedDrafts.slice(0, 8).map((d) => `
      <tr>
        <td><strong>${escapeHtml(d.display_name || '未命名')}</strong>
          <div class="admin-muted-id">学员端可练${d.published_case_id ? ` · ${escapeHtml(d.published_case_id)}` : ''}${d.source_filename ? ` · ${escapeHtml(d.source_filename)}` : ''}</div>
        </td>
        <td>${escapeHtml(sceneLabelOf(d.scene_key))}</td>
        <td>${escapeHtml((d.updated_at || '').slice(0, 19).replace('T', ' '))}</td>
        <td><button type="button" class="admin-btn" data-cases-subtab-jump="published">去已发布</button></td>
      </tr>`).join('');
    return `
      <div class="admin-card">
        <h4>草稿箱</h4>
        <p class="admin-hint">
          上传 ZIP / 材料确认后会先出现在这里；整理成卡片后仍在草稿箱待审；
          <strong>发布后学员端可选到该病例</strong>，草稿会挪到「已发布」。仅上传未确认时还不会建草稿。
        </p>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>草稿</th><th>场景</th><th>更新</th><th></th></tr></thead>
            <tbody>${draftRows || '<tr><td colspan="4">暂无待审草稿。交材料：确认纳入 → 自动进草稿箱 → 再整理/发布。</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      ${publishedDrafts.length ? `
      <div class="admin-card">
        <h4>最近发布（${publishedDrafts.length}）</h4>
        <p class="admin-hint">这些已不在待审列表；学员应能在对应<strong>场景</strong>下选到此人（若看不到请刷新「模拟对话」）。</p>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>病例</th><th>场景</th><th>更新</th><th></th></tr></thead>
            <tbody>${publishedRows}</tbody>
          </table>
        </div>
      </div>` : ''}`;
  }

  function ingestHubPublishedHtml() {
    const cards = (cache.cases || []).map((c) => {
      const personas = (c.personas || []);
      const title = personas.length === 1
        ? (personas[0].display_label || c.short_title || c.title || '未命名')
        : (c.short_title || c.title || '未命名病例');
      const disease = c.disease_name || c.disease_code || '未分类';
      const lv = levelFromMvpScenes(c.mvp_scenes);
      const personaChips = personas.map((p) => `
        <span class="admin-persona-chip">${escapeHtml(p.display_label || p.persona_id || '受试者')}</span>
      `).join('');
      return `
        <article class="admin-case-card">
          <div class="admin-case-card-main">
            <h5>${escapeHtml(title)}</h5>
            <p class="admin-case-disease">
              ${lv ? `<span class="admin-level-badge">${escapeHtml(lv.label)}</span> · ` : ''}
              ${escapeHtml(disease)}${c.phase ? ` · ${escapeHtml(String(c.phase))} 期` : ''}
            </p>
            <div class="admin-persona-chips">${personaChips || '<span class="admin-hint">暂无受试者</span>'}</div>
            <p class="admin-case-status">${c.exists ? '学员可练' : '文件缺失'} · ${escapeHtml(c.case_id || '')}</p>
          </div>
          <button type="button" class="admin-btn danger" data-del-case="${escapeHtml(c.case_id)}">删除</button>
        </article>`;
    }).join('');
    return `
      <div class="admin-card">
        <h4>已发布病例</h4>
        <p class="admin-hint">按试验病例汇总；发布后学员可在「模拟对话」中选到对应受试者。</p>
        <div class="admin-case-grid">${cards || '<p class="admin-hint">暂无已发布病例</p>'}</div>
      </div>`;
  }

  function ingestHubHtml() {
    return createPanelHtml();
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  }

  function uploadProgressHtml() {
    const p = ingest.upload_progress || {};
    const total = Number(p.total) || 0;
    const pct = Math.max(0, Math.min(100, Math.round(Number(p.percent) || 0)));
    const scanning = p.phase === 'scan';
    const title = scanning ? '本地规则扫描中…' : '正在上传材料…';
    const sub = p.label
      || (scanning
        ? `非 AI：按格式/系统垃圾规则检查（约 ${total} 个上传项）`
        : `共 ${total} 个文件`);
    return `
      <div class="admin-upload-progress" role="status" aria-live="polite">
        <div class="admin-upload-progress-head">
          <span class="admin-spinner" aria-hidden="true"></span>
          <div class="admin-upload-progress-copy">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(sub)}</span>
          </div>
          <span class="admin-upload-pct">${scanning ? `${pct}%` : `${pct}%`}</span>
        </div>
        <div class="admin-upload-bar" aria-hidden="true">
          <i class="${scanning && pct < 100 ? 'is-indeterminate' : ''}" style="width:${scanning ? Math.max(pct, 18) : pct}%"></i>
        </div>
      </div>`;
  }

  function pendingFilesHtml() {
    const list = ingest.pending_files || [];
    if (!list.length) return '';
    return `
      <ul class="admin-drop-filelist">
        ${list.map((f, i) => `
          <li>
            <div class="admin-drop-filemeta">
              <strong>${escapeHtml(f.name)}</strong>
              <span>${escapeHtml(formatBytes(f.size))}</span>
            </div>
            <button type="button" class="admin-drop-remove" data-pending-remove="${i}" title="移除" aria-label="移除">×</button>
          </li>`).join('')}
      </ul>
      <div class="admin-drop-actions">
        <button type="button" class="admin-btn primary" id="ingest-upload-scan" ${ingest.upload_busy ? 'disabled' : ''}>
          ${ingest.upload_busy ? '扫描中…' : `开始扫描（${list.length} 个文件）`}
        </button>
        <button type="button" class="admin-btn" id="ingest-upload-clear" ${ingest.upload_busy ? 'disabled' : ''}>清空</button>
      </div>`;
  }

  function materialDropzoneHtml() {
    const busy = !!ingest.upload_busy;
    return `
      <div class="span-2 admin-drop-block">
        ${busy ? uploadProgressHtml() : `
        <div class="admin-dropzone" id="ingest-dropzone" tabindex="0" role="button" aria-label="上传材料">
          <input type="file" id="ingest-file" class="admin-drop-input" multiple
            accept=".txt,.docx,.pdf,.zip,text/plain,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          <div class="admin-drop-visual" aria-hidden="true">
            <svg class="admin-drop-icon" viewBox="0 0 48 48" width="40" height="40" fill="none">
              <path d="M24 32V14M24 14l-6 6M24 14l6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12 34c-2.8 0-5-2.3-5-5.2 0-2.4 1.6-4.4 3.8-5.1C11.4 18.2 16.2 14 24 14c6.6 0 10.8 3.2 12.2 7.8 3 .2 5.8 2.7 5.8 6 0 3.3-2.7 6-6 6H12z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="admin-drop-copy">
            <strong>拖入文件到此处，或点击选择</strong>
            <span>支持多选 · Word / TXT / PDF / ZIP · 可一次拖多个，也可再追加</span>
          </div>
          <button type="button" class="admin-btn admin-drop-browse" id="ingest-browse">选择文件</button>
        </div>
        ${pendingFilesHtml()}`}
        <p class="admin-hint">ZIP 内混入图片、JSON、旧版 .doc、系统垃圾等会单独列出原因与预览，不会整包静默吞掉。</p>
      </div>`;
  }

  function lockedSceneDiseaseSummaryHtml() {
    const scene = sceneMetaOf(ingest.scene_key);
    const disease = (ingest.diseases || []).find((d) => d.disease_code === ingest.disease_code);
    const diseaseLabel = disease?.name_zh || ingest.disease_code || '未选';
    return `
      <div class="admin-locked-context" id="ingest-locked-context">
        <span>场景：<strong>${escapeHtml(scene.label)}</strong>
          <span class="admin-scene-badge ${scene.publishable ? 'is-ok' : 'is-test'}">${scene.publishable ? '正式' : '测试'}</span>
        </span>
        <span class="admin-muted-id">${escapeHtml(scene.scene_key)}</span>
        <span>病种：<strong>${escapeHtml(diseaseLabel)}</strong>
          <span class="admin-muted-id">${escapeHtml(ingest.disease_code || '')}</span>
        </span>
        <span class="admin-hint" style="margin:0;">已在上一步选定；要改请返回新建病例页。</span>
      </div>`;
  }

  function ingestFormHtml() {
    const modeLabel = { rough: '只有几句故事', material: '手头有材料', human: '内容已写全' }[ingest.mode] || '';
    const scene = sceneMetaOf(ingest.scene_key);
    const level = TRAIN_LEVELS[ingest.scene_key];
    const goalBit = level?.goal || scene.skill || '';
    const rubricBit = level?.rubric || (scene.publishable ? '对应评分表' : '测试场景暂无生产评分包');
    const skillBit = level?.skill || scene.skill || '';
    const hint = {
      rough: `用几句话写清：是谁、今天来干嘛、嘴上怎么说、其实怎样、怕什么。下一步会扩写成案例文稿。样例：web/data/samples/sample-rough-zhouayi-family-copd.txt。当前：${scene.label}${goalBit ? `——${goalBit}` : ''}`,
      material: `上传 Word（.docx）/ TXT / PDF，或 ZIP。系统会扫垃圾文件并给你人工确认。闭环 ZIP：web/data/samples/sample-material-zhouayi-family-copd-with-junk.zip（与纯人写不是同一篇）。当前：${scene.label}——${rubricBit}`,
      human: `内容你自己写全。系统只整理成练习卡片，不替你编事实。样例：web/data/samples/sample-human-zhouayi-family-copd.txt（结构化全文，勿与 ZIP 混用）。当前：${scene.label}${skillBit ? `——${skillBit}` : ''}`,
    }[ingest.mode] || '';
    const runLabel = {
      rough: '扩写成案例文稿',
      material: '抽取并整理成卡片',
      human: '整理成练习卡片',
    }[ingest.mode] || '继续';
    const hasReviewed = (ingest.file_reports || []).length > 0;
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" id="ingest-back-hub">← 返回新建</button>
        <h4>写材料 · ${escapeHtml(modeLabel)}</h4>
        ${lockedSceneDiseaseSummaryHtml()}
        <p class="admin-hint">${escapeHtml(hint)}</p>
        <div class="admin-form-grid">
          <label>怎么称呼（学员看到的名字）
            <input id="ingest-name" value="${escapeHtml(ingest.display_name)}" placeholder="如：周阿姨" />
          </label>
          ${ingest.mode === 'material' ? materialDropzoneHtml() : ''}
          <label class="span-2">${ingest.mode === 'human' ? '你写好的全文' : ingest.mode === 'material' ? '材料正文（审核纳入后可改）' : '大概（建议多写几句）'}
            <textarea id="ingest-text" rows="10" placeholder="${ingest.mode === 'human' ? '人物、今天来干嘛、必须记住的事实、担心什么、可能怎么开场…' : ingest.mode === 'material' ? '请先上传材料；扫描后会先进入文件审核…' : '在此输入大概…'}">${escapeHtml(ingest.source_text)}</textarea>
          </label>
        </div>
        ${ingest.mode === 'material' && hasReviewed ? `
        <button type="button" class="admin-btn" id="ingest-back-material-review">← 回到文件审核</button>` : ''}
        <button type="button" class="admin-btn primary" id="ingest-run" ${ingest.busy || ingest.upload_busy ? 'disabled' : ''}>
          ${ingest.busy ? '处理中…' : escapeHtml(runLabel)}
        </button>
      </div>`;
  }

  function materialActionLabel(action) {
    return { keep: '建议保留', reject: '建议刷掉', skip: '建议忽略' }[action] || action || '';
  }

  function materialHasBody(f) {
    const body = String(f?.text || f?.preview || '').trim();
    return !!body && !body.startsWith('[二进制');
  }

  function rebuildMaterialTextFromReports() {
    const parts = [];
    (ingest.file_reports || []).forEach((f) => {
      if (!f?.include) return;
      const body = String(f.text || f.preview || '').trim();
      if (!body) return;
      // 二进制预览也可强制纳入备注，方便人工对照
      parts.push(`===== ${f.path || '材料'} =====\n${body}`);
    });
    ingest.source_text = parts.join('\n\n');
    return ingest.source_text;
  }

  function ingestMaterialReviewHtml() {
    const files = ingest.file_reports || [];
    const summary = {
      kept: files.filter((f) => f.action === 'keep').length,
      rejected: files.filter((f) => f.action === 'reject').length,
      skipped: files.filter((f) => f.action === 'skip').length,
      included: files.filter((f) => f.include).length,
    };
    const allOn = files.length > 0 && files.every((f) => f.include);
    const idx = Math.min(Math.max(0, ingest.file_preview_idx || 0), Math.max(0, files.length - 1));
    const cur = files[idx] || null;
    const rows = files.map((f, i) => `
        <tr class="admin-mat-row ${i === idx ? 'is-active' : ''} action-${escapeHtml(f.action || '')}" data-mat-idx="${i}">
          <td>
            <input type="checkbox" class="admin-mat-include" data-mat-idx="${i}" ${f.include ? 'checked' : ''} title="可覆盖系统建议" />
          </td>
          <td>
            <button type="button" class="admin-mat-pick" data-mat-idx="${i}">
              <strong>${escapeHtml(f.path || '')}</strong>
            </button>
            <div class="admin-muted-id">${Number(f.bytes || 0)} 字节${f.chars ? ` · ${f.chars} 字` : ''}${materialHasBody(f) ? '' : ' · 无可读正文'}</div>
          </td>
          <td><span class="admin-mat-badge admin-mat-badge-${escapeHtml(f.action || '')}">${escapeHtml(materialActionLabel(f.action))}</span></td>
          <td class="admin-mat-reason">${escapeHtml(f.reason || '')}</td>
        </tr>`).join('');
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" id="ingest-back-form">← 返回上传</button>
        <h4>材料文件审核</h4>
        <p class="admin-hint">
          来源：<strong>${escapeHtml(ingest.source_filename || '未命名')}</strong>。
          本步是<strong>系统规则扫描</strong>（扩展名白名单 + 系统垃圾名），<strong>不是 AI</strong>，也不是假数据；小文件本地解压/抽字会很快。
          系统建议：保留 ${summary.kept} · 刷掉 ${summary.rejected} · 忽略 ${summary.skipped}——仅供参考，你可全选或逐条覆盖。
        </p>
        ${lockedSceneDiseaseSummaryHtml()}
        <div class="admin-form-grid" style="margin-bottom:10px">
          <label>怎么称呼
            <input id="ingest-name" value="${escapeHtml(ingest.display_name)}" placeholder="如：周阿姨" />
          </label>
        </div>
        <div class="admin-mat-toolbar">
          <label class="admin-mat-selectall">
            <input type="checkbox" id="ingest-mat-select-all" ${allOn ? 'checked' : ''} />
            全选（${summary.included}/${files.length}）
          </label>
          <button type="button" class="admin-btn" id="ingest-mat-select-kept">只勾建议保留</button>
          <button type="button" class="admin-btn" id="ingest-mat-select-none">清空勾选</button>
        </div>
        <div class="admin-mat-review">
          <div class="admin-mat-list-wrap">
            <table class="admin-table admin-mat-table">
              <thead>
                <tr>
                  <th>纳入</th>
                  <th>文件</th>
                  <th>系统建议</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="4">没有扫到文件</td></tr>'}</tbody>
            </table>
          </div>
          <div class="admin-mat-preview-wrap">
            <h5>内容预览${cur ? ` · ${escapeHtml(cur.path || '')}` : ''}</h5>
            <p class="admin-mat-preview-meta">${cur ? escapeHtml(`${materialActionLabel(cur.action)}：${cur.reason || ''}`) : '点左侧文件查看'}</p>
            <pre class="admin-mat-preview">${cur ? escapeHtml(cur.preview || cur.text || '（无预览）') : '（无）'}</pre>
          </div>
        </div>
        <div class="admin-mat-actions">
          <button type="button" class="admin-btn primary" id="ingest-material-confirm" ${summary.included ? '' : 'disabled'}>
            确认纳入（${summary.included}）并继续改正文
          </button>
          <span class="admin-hint">最终以你勾选为准。下一步「抽取成卡片」才会调用 AI。</span>
        </div>
      </div>`;
  }

  /** 案例文稿：后台仍用 Markdown 存，界面只按分节展示，不露出 # / - 符号 */
  function mdBodyToPlain(body) {
    return String(body || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => {
        let s = line;
        s = s.replace(/^#{1,6}\s+/, '');
        s = s.replace(/^[-*+]\s+/, '• ');
        s = s.replace(/\*\*(.+?)\*\*/g, '$1');
        s = s.replace(/^---+$/, '');
        return s;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function plainBodyToMd(body) {
    return String(body || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => (/^•\s+/.test(line) ? `- ${line.replace(/^•\s+/, '')}` : line))
      .join('\n')
      .trim();
  }

  function parseCaseDoc(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    let title = '';
    const sections = [];
    let cur = null;
    const preamble = [];
    for (const line of lines) {
      const h1 = /^#\s+(.+)$/.exec(line);
      const h2 = /^##\s+(.+)$/.exec(line);
      if (h1 && !cur && !sections.length && !title) {
        title = h1[1].trim();
        continue;
      }
      if (h2) {
        if (cur) sections.push(cur);
        else if (preamble.some((x) => x.trim())) {
          sections.push({ heading: '说明', bodyLines: [...preamble] });
          preamble.length = 0;
        }
        cur = { heading: h2[1].trim(), bodyLines: [] };
        continue;
      }
      if (!cur) {
        if (!title && line.trim() && !/^#/.test(line) && line.trim().length < 80 && !preamble.length) {
          title = line.trim();
          continue;
        }
        preamble.push(line);
        continue;
      }
      cur.bodyLines.push(line);
    }
    if (cur) sections.push(cur);
    else if (preamble.some((x) => x.trim())) {
      sections.push({ heading: '全文', bodyLines: preamble });
    }
    return {
      title,
      sections: sections.map((s) => ({
        heading: s.heading,
        body: mdBodyToPlain((s.bodyLines || []).join('\n')),
      })),
    };
  }

  function caseDocToPlainEditable(md) {
    const doc = parseCaseDoc(md);
    if (!doc.title && !doc.sections.length) return mdBodyToPlain(md);
    const parts = [];
    if (doc.title) parts.push(doc.title);
    doc.sections.forEach((sec) => {
      parts.push('');
      parts.push(`【${sec.heading}】`);
      if (sec.body) parts.push(sec.body);
    });
    return parts.join('\n').replace(/^\n+/, '').trim();
  }

  function plainEditableToCaseMd(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return '';
    if (!/【[^】]+】/.test(raw)) {
      const first = raw.split('\n').find((ln) => ln.trim()) || '案例文稿';
      const rest = raw.slice(raw.indexOf(first) + first.length).trim();
      return [`# ${first.replace(/^#\s*/, '')}`, '', '## 全文', '', plainBodyToMd(rest || first)].join('\n');
    }
    const parts = [];
    const re = /【([^】]+)】/g;
    const marks = [];
    let m;
    while ((m = re.exec(raw))) marks.push({ heading: m[1].trim(), index: m.index, end: m.index + m[0].length });
    const before = raw.slice(0, marks[0].index).trim();
    if (before) {
      const titleLine = before.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
      if (titleLine) parts.push(`# ${titleLine.replace(/^#\s*/, '')}`, '');
    }
    marks.forEach((mark, i) => {
      const bodyStart = mark.end;
      const bodyEnd = i + 1 < marks.length ? marks[i + 1].index : raw.length;
      const body = plainBodyToMd(raw.slice(bodyStart, bodyEnd).trim());
      parts.push(`## ${mark.heading}`, '', body, '');
    });
    return parts.join('\n').trim();
  }

  function readExpandCaseDoc() {
    const ta = document.getElementById('expand-text');
    if (ta) return plainEditableToCaseMd(ta.value || '');
    const root = document.getElementById('expand-case-doc');
    if (!root) return '';
    const title = root.querySelector('#expand-doc-title')?.value?.trim() || '';
    const parts = [];
    if (title) parts.push(`# ${title}`, '');
    root.querySelectorAll('[data-case-section]').forEach((el) => {
      const heading = (el.querySelector('[data-section-heading]')?.value || el.dataset.heading || '小节').trim();
      const body = plainBodyToMd(el.querySelector('[data-section-body]')?.value || '');
      parts.push(`## ${heading}`, '', body, '');
    });
    return parts.join('\n').trim();
  }

  function caseDocViewHtml(md, needle) {
    const plain = caseDocToPlainEditable(md);
    if (!plain) {
      return `<pre class="admin-source-pre" id="ingest-source-pre">${escapeHtml(md || '')}</pre>`;
    }
    let html = escapeHtml(plain);
    if (needle && plain.includes(needle)) {
      html = plain.split(needle).map((p, i, arr) => (
        escapeHtml(p) + (i < arr.length - 1 ? `<mark class="admin-source-mark">${escapeHtml(needle)}</mark>` : '')
      )).join('');
    }
    return `<pre class="admin-source-pre" id="ingest-source-pre">${html}</pre>`;
  }

  function caseDocEditorHtml(md, { readonly = false } = {}) {
    const plain = caseDocToPlainEditable(md);
    return `
      <textarea id="expand-text" class="admin-expand-plain" ${readonly ? 'readonly' : ''}>${escapeHtml(plain)}</textarea>`;
  }

  function asPlainText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      return String(v.text || v.summary || v.content || v.visit_context || v.label || '');
    }
    return String(v);
  }

  function ingestExpandHtml() {
    const d = ingest.draft || {};
    const name = d.fields?.display_name || ingest.display_name || '未命名';
    const level = trainLevel(d.scene_key || ingest.scene_key);
    const busy = !!ingest.busy;
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" id="ingest-back-hub" ${busy ? 'disabled' : ''}>← 返回</button>
        <h4>第一步：审案例文稿 · ${escapeHtml(name)}</h4>
        ${busy ? '<div class="admin-busy-banner" role="status">正在整理练习卡片，通常需要十几秒，请稍候…</div>' : ''}
        <p class="admin-hint">左右对照：左边是你写的大概，右边是案例文稿（纯文字，可直接改）。小节用【】标出；改完再整理成练习卡片。</p>
        <p class="admin-hint">场景：${escapeHtml(level.label)} · ${escapeHtml(level.skill)} · 练完对照「${escapeHtml(level.rubric)}」</p>
        <div class="admin-review-split">
          <div class="admin-review-source">
            <h5>你写的大概</h5>
            <pre class="admin-source-pre">${escapeHtml((d.source || {}).text || '')}</pre>
          </div>
          <div class="admin-review-cards">
            <h5>案例文稿（可直接改）</h5>
            ${caseDocEditorHtml(d.expanded_text || '', { readonly: busy })}
          </div>
        </div>
        <div class="admin-review-actions">
          <button type="button" class="admin-btn danger" id="rev-discard" ${busy ? 'disabled' : ''}>废弃</button>
          <div class="admin-review-btns">
            <button type="button" class="admin-btn" id="expand-save" ${busy ? 'disabled' : ''}>先保存</button>
            <button type="button" class="admin-btn primary" id="expand-to-structure" ${busy ? 'disabled' : ''}>
              ${busy ? '正在整理…' : '我改好了，整理成练习卡片'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function annotatedListHtml(items, kind) {
    const list = items || [];
    if (!list.length) return `<p class="admin-hint">（暂无，可勾选后在下方说明「少了什么」让 AI 补）</p>`;
    return `<ul class="admin-annot-list">${list.map((it, idx) => {
      const text = typeof it === 'string' ? it : (it.text || it.topic || '');
      const source = typeof it === 'object' ? (it.source || 'none') : 'none';
      const reason = typeof it === 'object' ? (it.reason || '') : '';
      const conf = typeof it === 'object' ? (it.confidence || '') : '';
      const span = typeof it === 'object' ? (it.source_span || text) : text;
      const guess = conf === 'guess' || source === 'none';
      const sourceLabel = source === 'none' ? '系统猜测' : source;
      const selected = ingest.selected.some((s) => s.kind === kind && s.idx === idx);
      return `
        <li class="admin-annot-item ${guess ? 'is-guess' : ''} ${selected ? 'is-selected' : ''}" data-annot-kind="${kind}" data-annot-idx="${idx}" data-span="${escapeHtml(String(span || '').slice(0, 120))}" data-annot-text="${escapeHtml(String(text || '').slice(0, 200))}">
          <label class="admin-annot-pick" onclick="event.stopPropagation()">
            <input type="checkbox" data-annot-check="${kind}:${idx}" ${selected ? 'checked' : ''} />
            <span>选这条</span>
          </label>
          <div class="admin-annot-text">${escapeHtml(text)}</div>
          <div class="admin-annot-meta">
            ${guess ? '<span class="admin-tag-warn">请再确认</span>' : '<span class="admin-tag-ok">有依据</span>'}
            <span>依据：${escapeHtml(sourceLabel)}</span>
            ${reason ? `<span>为什么写这条：${escapeHtml(reason)}</span>` : ''}
            ${it.rubric_group_name ? `<span>对应练习检查：${escapeHtml(it.rubric_group_name)}</span>` : ''}
          </div>
        </li>`;
    }).join('')}</ul>`;
  }

  function formatVersionAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return iso;
    }
  }

  function revisePanelHtml(d) {
    const versions = [...(d.field_versions || [])].reverse();
    const selected = ingest.selected || [];
    const busy = !!ingest.busy;
    return `
      <div class="admin-revise-dock">
        <div class="admin-revise-dock-head">
          <strong>现场改</strong>
          <span class="admin-hint">可以说大概，例如「少了」「这条不对」——系统会对照左边文稿自己补细；写得越具体改得越准。</span>
        </div>
        <div class="admin-revise-selected">
          ${selected.length
            ? selected.map((s) => {
                const lab = ({ facts: '事实', concerns: '担心', openings: '开场', scoring: '检查' }[s.kind] || s.kind);
                return `<span class="admin-revise-chip">${escapeHtml(lab)}#${s.idx + 1}：${escapeHtml((s.text || '').slice(0, 28))}</span>`;
              }).join('')
            : '<span class="admin-hint">尚未勾选（也可直接写整体意见）</span>'}
          ${selected.length ? '<button type="button" class="admin-btn" id="rev-clear-sel">清空勾选</button>' : ''}
        </div>
        <div class="admin-revise-dock-row">
          <textarea id="rev-ai-note" rows="2" ${busy ? 'readonly' : ''} placeholder="懒人写法也行：少了 / 开场不对 / 多了钙片那条。也可细写：应改成近7天漏2次。">${escapeHtml(ingest.reviseNote || '')}</textarea>
          <button type="button" class="admin-btn primary" id="rev-ai-fix" ${busy ? 'disabled' : ''}>
            ${busy ? '正在改…' : '按我说的让 AI 改'}
          </button>
        </div>
        ${busy ? '<div class="admin-busy-banner" role="status">正在根据你的意见改卡片，请稍候…</div>' : ''}
        <details class="admin-version-details">
          <summary>版本回溯${versions.length ? `（${versions.length}）` : ''}</summary>
          <p class="admin-hint">每次 AI 改 / 整理前都会存一版，改错了可回到旧版。</p>
          ${versions.length ? `
            <ul class="admin-version-list">
              ${versions.map((v) => `
                <li>
                  <div>
                    <strong>${escapeHtml(v.note || '快照')}</strong>
                    <span class="admin-muted-id">${escapeHtml(formatVersionAt(v.at))} · ${escapeHtml(v.actor || '')} · ${escapeHtml(v.version_id || '')}</span>
                  </div>
                  <button type="button" class="admin-btn" data-restore-version="${escapeHtml(v.version_id || '')}" ${busy ? 'disabled' : ''}>回到此版</button>
                </li>`).join('')}
            </ul>` : '<p class="admin-hint">暂无历史版本（整理或修改后会出现）</p>'}
        </details>
      </div>`;
  }

  function hooksHtml(hooks) {
    const items = hooks?.items || [];
    const pack = hooks?.scoring_pack;
    const packBanner = pack ? `
      <div class="admin-scoring-pack">
        <strong>将用评分包</strong>
        <span>
          ${escapeHtml(pack.rubric_file || '')}
          ${pack.disease_code ? ` · 病种 ${escapeHtml(pack.disease_code)}` : ''}
          ${pack.overlay_applied ? ' · 已叠加 overlay' : ' · 场景通用表'}
          · v${escapeHtml(String(pack.version || ''))}
          · 启用 ${escapeHtml(String(pack.enabled_item_count ?? '—'))} 项
        </span>
        ${pack.trainee_brief ? `<p class="admin-hint">${escapeHtml(pack.trainee_brief)}</p>` : ''}
        ${pack.changelog ? `<p class="admin-muted-id">${escapeHtml(pack.changelog)}</p>` : ''}
      </div>` : '';
    return `
      <div class="admin-hooks">
        <h5>和现有练习能不能接上</h5>
        <p class="admin-hint">发布前自检：场景对不对？评分包（场景×病种）对不对？病例信息是否完整？</p>
        ${packBanner}
        <ul class="admin-hooks-list">
          ${items.map((it) => `
            <li class="admin-hook-item status-${escapeHtml(it.status || '')}">
              <strong>${escapeHtml(it.label)}</strong>
              <span>${escapeHtml(it.detail || '')}</span>
            </li>`).join('') || '<li>无</li>'}
        </ul>
      </div>`;
  }

  function highlightSourceHtml(text, needle) {
    const raw = text || '';
    if (!needle || !raw.includes(needle)) {
      return `<pre class="admin-source-pre" id="ingest-source-pre">${escapeHtml(raw)}</pre>`;
    }
    const parts = raw.split(needle);
    let html = '';
    parts.forEach((p, i) => {
      html += escapeHtml(p);
      if (i < parts.length - 1) html += `<mark class="admin-source-mark">${escapeHtml(needle)}</mark>`;
    });
    return `<pre class="admin-source-pre" id="ingest-source-pre">${html}</pre>`;
  }

  function publishableSceneOptionsHtml(selected) {
    return Object.values(TRAIN_LEVELS).map((lv) => `
      <option value="${escapeHtml(lv.scene_key)}" ${selected === lv.scene_key ? 'selected' : ''}>
        ${escapeHtml(lv.label)}${lv.code ? `（${escapeHtml(lv.code)}）` : ''} · 可发布
      </option>`).join('');
  }

  function ingestReviewHtml() {
    const d = ingest.draft || {};
    const f = d.fields || {};
    const src = d.source || {};
    const leftTitle = d.mode === 'rough' ? '案例文稿' : '原材料（对照）';
    const leftText = d.expanded_text || src.text || '';
    const leftLooksLikeCaseDoc = d.mode === 'rough' || /^#\s+/m.test(leftText) || /^##\s+/m.test(leftText);
    const sceneKey = d.scene_key || ingest.scene_key;
    const scene = sceneMetaOf(sceneKey);
    const level = TRAIN_LEVELS[sceneKey] || null;
    const diseaseCode = f.disease_code || ingest.disease_code || 'HTN';
    const busy = !!ingest.busy;
    // 挂钩以服务端重算为准；warn 不挡发布，仅 fail 挡
    const hooksOk = !!(d.design_hooks?.ok);
    const canPublish = !!scene.publishable && hooksOk;
    return `
      <div class="admin-card">
        <button type="button" class="admin-btn" id="ingest-back-hub" ${busy ? 'disabled' : ''}>← 返回列表</button>
        <h4>第二步：审练习卡片 · ${escapeHtml(f.display_name || '未命名')}</h4>
        <p class="admin-hint">
          入口：${escapeHtml({ rough: '写大概', material: '交材料', human: '纯人写' }[d.mode] || d.mode || '')} ·
          当前场景：${escapeHtml(scene.label)}${level ? `（${escapeHtml(level.skill)}）` : ''} ·
          性质：${scene.publishable ? '正式' : '测试'} ·
          病种将决定评分侧重点
        </p>
        ${!scene.publishable ? `
        <div class="admin-publish-block">
          <strong>不能进学员端：</strong>「${escapeHtml(scene.label)}」是测试场景。
          请回「新增场景」点<strong>设为正式</strong>，再重新打开本草稿（会自动刷新挂钩）。
        </div>` : ''}
        ${scene.publishable && !hooksOk ? `
        <div class="admin-publish-block">
          <strong>还不能发布：</strong>下方「和现有练习能不能接上」仍有未通过项（红色失败项）。
          若刚把场景改成正式，请点一次「保存草稿」或返回草稿箱再点「继续」以刷新挂钩。
        </div>` : ''}
        ${scene.publishable && hooksOk ? `
        <div class="admin-publish-block is-info">
          场景已是<strong>正式</strong>，挂钩通过。勾选核对后即可发布到学员端。
        </div>` : ''}
        <p class="admin-hint"><strong>发布前问一句：</strong>${escapeHtml(level?.goal || '学员练完能否完成该场景的沟通目标？')}</p>
        <div class="admin-review-split">
          <div class="admin-review-source">
            <h5>${escapeHtml(leftTitle)}</h5>
            <p class="admin-muted-id">${escapeHtml(src.filename || '')}</p>
            ${leftLooksLikeCaseDoc ? caseDocViewHtml(leftText, ingest.highlight) : highlightSourceHtml(leftText, ingest.highlight)}
          </div>
          <div class="admin-review-cards">
            <label>怎么称呼 <input id="rev-name" value="${escapeHtml(f.display_name || '')}" /></label>
            <label>发布场景
              <select id="rev-scene">
                ${allSceneChoices().map((s) => `
                  <option value="${escapeHtml(s.scene_key)}" ${sceneKey === s.scene_key ? 'selected' : ''}>
                    ${escapeHtml(s.label)}${s.tier === 'formal' || s.publishable ? ' · 正式' : s.tier === 'reserved' ? ' · 预留' : ' · 测试'}
                  </option>`).join('')}
              </select>
            </label>
            <label>挂到哪个病种
              <select id="rev-disease">${diseaseOptionsHtml(diseaseCode)}</select>
            </label>
            <label>今天来干嘛 <textarea id="rev-visit" rows="2">${escapeHtml(asPlainText(f.visit_context))}</textarea></label>
            <div>
              <h5>必须记住的事实</h5>
              <p class="admin-hint">勾选有问题的条款；点文字可对照左边。改法写在对照区下方的「现场改」固定栏，不用滚到底。</p>
              ${annotatedListHtml(f.locked_facts, 'facts')}
            </div>
            <div>
              <h5>TA 担心什么</h5>
              ${annotatedListHtml(f.key_concerns, 'concerns')}
            </div>
            <div>
              <h5>一开口可能说什么</h5>
              ${annotatedListHtml(f.openings, 'openings')}
            </div>
            <div>
              <h5>和练习检查的关系（说明，不是新造分数）</h5>
              ${annotatedListHtml(f.scoring_hints, 'scoring')}
            </div>
            ${hooksHtml(d.design_hooks)}
          </div>
        </div>
        ${revisePanelHtml(d)}
        <div class="admin-review-actions">
          <label class="admin-ack">
            <input type="checkbox" id="rev-ack" ${d.reviewed_ack ? 'checked' : ''} ${busy ? 'disabled' : ''} />
            事实与关键说法我已核对；学员练这个人能对上上面的训练目标
          </label>
          <div class="admin-review-btns">
            <button type="button" class="admin-btn" id="rev-save" ${busy ? 'disabled' : ''}>保存草稿</button>
            <button type="button" class="admin-btn danger" id="rev-discard" ${busy ? 'disabled' : ''}>废弃</button>
            <button type="button" class="admin-btn primary" id="rev-publish" ${busy || !canPublish ? 'disabled' : ''} title="${canPublish ? '' : '请先改为可发布场景，并确保挂钩通过'}">核对并发布</button>
          </div>
        </div>
        <p class="admin-hint">${canPublish
          ? '发布后学员可在「模拟对话」中选到该受试者。'
          : '发布已锁定：测试场景须先设为正式，或处理挂钩未通过项。'}</p>
      </div>`;
  }

  /** @deprecated 训练场景已并入「新建」三选一；保留别名防旧调用 */
  function scenesHtml() {
    createPath = 'scene';
    return createScenePageHtml();
  }

  function usersHtml() {
    const filtered = (cache.users || []).filter((u) => (u.role || 'trainee') === userRoleTab);
    const createRole = userRoleTab;
    const rows = filtered.map((u) => `
      <tr>
        <td>
          <strong>${escapeHtml(u.display_name || u.username || '未命名')}</strong>
          <div class="admin-muted-id">登录名：${escapeHtml(u.username)}</div>
        </td>
        <td>${escapeHtml(ROLE_LABEL[u.role] || u.role)}</td>
        <td>${u.session_count ?? 0}</td>
        <td>${escapeHtml((u.created_at || '').slice(0, 19).replace('T', ' '))}</td>
        <td>
          <select data-role-user="${escapeHtml(u.id)}" title="调整角色">
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
            <option value="instructor" ${u.role === 'instructor' ? 'selected' : ''}>老师 / 带教</option>
            <option value="trainee" ${u.role === 'trainee' ? 'selected' : ''}>学员</option>
          </select>
          <button type="button" class="admin-btn" data-save-user="${escapeHtml(u.id)}">保存</button>
          <button type="button" class="admin-btn danger" data-del-user="${escapeHtml(u.id)}">删除</button>
        </td>
      </tr>`).join('');

    return `
      <div class="admin-subtabs">
        ${ROLE_TABS.map((t) => `
          <button type="button" class="admin-subtab ${userRoleTab === t.id ? 'is-active' : ''}" data-user-role-tab="${t.id}">
            ${t.label}
            <span class="admin-subtab-count">${(cache.users || []).filter((u) => (u.role || 'trainee') === t.id).length}</span>
          </button>`).join('')}
      </div>
      <div class="admin-card">
        <h4>创建${ROLE_LABEL[createRole] || ''}账号</h4>
        <div class="admin-form-grid">
          <label>登录用户名<input id="admin-new-username" placeholder="字母数字下划线" /></label>
          <label>显示名称<input id="admin-new-displayname" placeholder="如：张老师" /></label>
          <label>初始密码<input id="admin-new-password" type="password" placeholder="至少 6 位" /></label>
          <input type="hidden" id="admin-new-role" value="${escapeHtml(createRole)}" />
        </div>
        <button type="button" class="admin-btn primary" id="admin-user-create">创建${ROLE_LABEL[createRole] || ''}账号</button>
      </div>
      <div class="admin-card">
        <h4>${ROLE_LABEL[userRoleTab]}列表（${filtered.length}）</h4>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>姓名</th><th>角色</th><th>练习次数</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5">暂无${ROLE_LABEL[userRoleTab]}账号</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  function avatarsHtml() {
    const a = cache.avatars || {};
    const modelsMeta = a.models_meta || {};
    const modelIds = a.models || Object.keys(modelsMeta);
    const gallery = a.portrait_gallery || [];
    const personas = a.personas || [];

    const galleryHtml = gallery.length ? `
      <div class="admin-avatar-gallery">
        <h4>可选默认形象库</h4>
        <p class="admin-hint">形象是呈现层，与病例/场景配置分开。点选下方形象可在受试者卡片里「套用」。图裂了多半是缓存，可硬刷新或重新生成。</p>
        <div class="admin-gallery-grid" id="admin-gallery-grid">
          ${gallery.map((g) => `
            <button type="button" class="admin-gallery-item" data-gallery-path="${escapeHtml(g.path)}" data-gallery-label="${escapeHtml(g.label || g.file)}" title="${escapeHtml(g.label || g.file)}">
              ${portraitImgHtml(g.path, g.label || g.file)}
              <span>${escapeHtml(g.label || g.file)}</span>
            </button>`).join('')}
        </div>
      </div>` : '<p class="admin-hint">暂无可用肖像。可上传，或对受试者点「AI 生成立绘」。</p>';

    const cards = personas.map((p) => {
      const img = p.portrait_url || portraitUrl(p.portrait) || (gallery[0] && gallery[0].path) || '';
      const visual = p.visual || 'live2d';
      const genThis = avatarGenPid === p.persona_id;
      const metaBits = [
        p.age_years ? `${p.age_years}岁` : '',
        p.occupation || '',
      ].filter(Boolean).join(' · ');
      return `
        <article class="admin-avatar-card ${genThis ? 'is-generating' : ''}" data-persona-card="${escapeHtml(p.persona_id)}">
          <div class="admin-avatar-preview">
            ${genThis
              ? '<div class="admin-avatar-empty is-generating">立绘生成中…</div>'
              : portraitImgHtml(img, p.display_label || '')}
          </div>
          <div class="admin-avatar-body">
            <h5>${escapeHtml(p.display_label || '未命名受试者')}</h5>
            <p class="admin-case-disease">${escapeHtml(p.case_title || p.case_id || '')}${metaBits ? ` · ${escapeHtml(metaBits)}` : ''}</p>
            <label>呈现方式
              <select data-av-visual="${escapeHtml(p.persona_id)}" ${genThis ? 'disabled' : ''}>
                ${Object.entries(VISUAL_LABEL).map(([k, lab]) => `
                  <option value="${k}" ${visual === k ? 'selected' : ''}>${lab}</option>`).join('')}
              </select>
            </label>
            <label>动画模型
              <select data-av-model="${escapeHtml(p.persona_id)}" ${genThis ? 'disabled' : ''}>
                <option value="">系统默认</option>
                ${modelIds.map((m) => `
                  <option value="${escapeHtml(m)}" ${p.model === m ? 'selected' : ''}>${escapeHtml(modelLabel(m, modelsMeta))}</option>`).join('')}
              </select>
            </label>
            <label>肖像（预览选择）
              <select data-av-portrait="${escapeHtml(p.persona_id)}" ${genThis ? 'disabled' : ''}>
                <option value="">保持当前</option>
                ${gallery.map((g) => `
                  <option value="${escapeHtml(g.path)}" ${(p.portrait || '').split('?')[0] === (g.path || '').split('?')[0] ? 'selected' : ''}>${escapeHtml(g.label || g.file)}</option>`).join('')}
              </select>
            </label>
            <label>AI 立绘补充说明（可选）
              <input type="text" data-av-hint="${escapeHtml(p.persona_id)}" placeholder="例：短发、朴素外套、略显疲惫" ${genThis ? 'disabled' : ''} />
            </label>
            <div class="admin-avatar-actions">
              <label class="admin-upload-btn">
                上传替换肖像
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" data-upload-persona="${escapeHtml(p.persona_id)}" hidden ${genThis ? 'disabled' : ''} />
              </label>
              <button type="button" class="admin-btn" data-apply-gallery="${escapeHtml(p.persona_id)}" ${genThis ? 'disabled' : ''}>套用选中形象</button>
              <button type="button" class="admin-btn" data-ai-portrait="${escapeHtml(p.persona_id)}" ${genThis || avatarGenPid ? 'disabled' : ''}>
                ${genThis ? '生成中…' : 'AI 生成立绘'}
              </button>
              <button type="button" class="admin-btn primary" data-save-avatar="${escapeHtml(p.persona_id)}" ${genThis ? 'disabled' : ''}>保存</button>
            </div>
          </div>
        </article>`;
    }).join('');

    return `
      <div class="admin-card">
        ${galleryHtml}
      </div>
      <div class="admin-card">
        <div class="admin-card-head-row">
          <h4>受试者形象绑定（${personas.length}）</h4>
          <button type="button" class="admin-btn" id="admin-upload-new-portrait">上传新默认形象到形象库</button>
          <input type="file" id="admin-new-portrait-file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" hidden />
        </div>
        <p class="admin-hint">AI 会按病例人设（年龄/性别/职业/气质）只刷新该卡片立绘，整页不会变成「加载中」。可另写一句外貌补充。</p>
        <div class="admin-avatar-grid">${cards || '<p class="admin-hint">暂无受试者人设，请先导入病例</p>'}</div>
      </div>`;
  }

  function panelHtml(page) {
    if (page === 'users') return usersHtml();
    return libraryHtml();
  }

  async function render(viewEl, setPage, page = currentPage) {
    currentPage = page === 'users' ? 'users' : 'cases';
    if (currentPage === 'users') {
      setPage('账号管理', '管理员 / 老师 / 学员');
    } else {
      setPage('病例与场景', '新建（场景 / 病种 / 病例）· 草稿 · 已发布 · 形象');
    }
    if (!cache.stats && !cache.busy) await loadAll();

    viewEl.innerHTML = `
      <div class="admin-page">
        ${cache.error ? `<div class="action-toast">${escapeHtml(apiError({ detail: cache.error }, String(cache.error)))}</div>` : ''}
        ${ingest.upload_busy ? '' : (cache.message ? `<div class="admin-toast-ok">${escapeHtml(cache.message)}</div>` : '')}
        ${cache.busy ? '<div class="feedback-loading"><p>加载中…</p></div>' : panelHtml(currentPage)}
      </div>`;

    viewEl.querySelectorAll('[data-cases-subtab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        casesSubtab = btn.dataset.casesSubtab;
        if (casesSubtab === 'create') createPath = 'hub';
        ingest.step = 'hub';
        cache.message = '';
        cache.error = '';
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-cases-subtab-jump]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const jump = btn.dataset.casesSubtabJump || 'published';
        casesSubtab = jump === 'add' ? 'create' : jump;
        if (casesSubtab === 'create') {
          createPath = btn.dataset.presetLevel ? 'case' : 'hub';
        }
        ingest.step = 'hub';
        if (btn.dataset.presetLevel) ingest.scene_key = btn.dataset.presetLevel;
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-create-path]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        createPath = btn.dataset.createPath || 'hub';
        casesSubtab = 'create';
        ingest.step = 'hub';
        cache.message = '';
        cache.error = '';
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-user-role-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        userRoleTab = btn.dataset.userRoleTab;
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('admin-case-import')?.addEventListener('click', async () => {
      try {
        let text = document.getElementById('admin-case-json')?.value?.trim() || '';
        const file = document.getElementById('admin-case-file')?.files?.[0];
        if (file) text = await file.text();
        if (!text) throw new Error('请选择文件或粘贴 JSON');
        const body = JSON.parse(text);
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '导入失败');
        cache.message = data.message || '病例已导入';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-ingest-level]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        ingest.scene_key = btn.dataset.ingestLevel || ingest.scene_key;
        const hubDisease = document.getElementById('ingest-hub-disease')?.value;
        if (hubDisease) ingest.disease_code = hubDisease;
        cache.message = '';
        cache.error = '';
        await render(viewEl, setPage, currentPage);
      });
    });

    const sceneFilterEl = document.getElementById('ingest-scene-filter');
    sceneFilterEl?.addEventListener('input', () => {
      const q = (sceneFilterEl.value || '').trim().toLowerCase();
      const list = document.getElementById('ingest-scene-list');
      if (!list) return;
      list.querySelectorAll('[data-ingest-level]').forEach((btn) => {
        const hay = (btn.dataset.sceneSearch || '').toLowerCase();
        btn.hidden = !!(q && !hay.includes(q));
      });
      list.querySelectorAll('[data-scene-group]').forEach((g) => {
        const any = [...g.querySelectorAll('[data-ingest-level]')].some((b) => !b.hidden);
        g.hidden = !any;
      });
    });

    document.getElementById('ingest-hub-disease')?.addEventListener('change', (ev) => {
      ingest.disease_code = ev.target.value || ingest.disease_code;
    });

    viewEl.querySelectorAll('[data-ingest-mode]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const hubDisease = document.getElementById('ingest-hub-disease')?.value;
        if (hubDisease) ingest.disease_code = hubDisease;
        ingest.mode = btn.dataset.ingestMode;
        ingest.step = 'form';
        ingest.draft = null;
        ingest.source_text = '';
        ingest.source_filename = '';
        ingest.file_reports = [];
        ingest.file_preview_idx = 0;
        ingest.pending_files = [];
        ingest.upload_busy = false;
        ingest.upload_progress = null;
        ingest.display_name = '';
        ingest.highlight = '';
        casesSubtab = 'create';
        cache.message = '';
        cache.error = '';
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('ingest-back-hub')?.addEventListener('click', async () => {
      ingest.step = 'hub';
      ingest.draft = null;
      casesSubtab = 'create';
      if (createPath !== 'case' && createPath !== 'disease' && createPath !== 'scene') createPath = 'case';
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-back-form')?.addEventListener('click', async () => {
      ingest.step = 'form';
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-back-material-review')?.addEventListener('click', async () => {
      ingest.step = 'material_review';
      await render(viewEl, setPage, currentPage);
    });

    const MATERIAL_EXT_RE = /\.(txt|docx|pdf|zip)$/i;

    function addPendingFiles(fileList) {
      const incoming = Array.from(fileList || []).filter(Boolean);
      if (!incoming.length) return;
      const next = [...(ingest.pending_files || [])];
      const seen = new Set(next.map((f) => `${f.name}::${f.size}::${f.lastModified}`));
      let skipped = 0;
      incoming.forEach((f) => {
        const key = `${f.name}::${f.size}::${f.lastModified}`;
        if (seen.has(key)) return;
        if (!MATERIAL_EXT_RE.test(f.name)) {
          skipped += 1;
          return;
        }
        seen.add(key);
        next.push(f);
      });
      ingest.pending_files = next;
      if (skipped) {
        cache.error = `已忽略 ${skipped} 个不支持的文件（仅 .txt / .docx / .pdf / .zip）`;
      } else {
        cache.error = '';
      }
      cache.message = next.length ? `已选 ${next.length} 个文件，可继续追加或开始扫描` : '';
    }

    async function scanPendingFiles() {
      const batch = [...(ingest.pending_files || [])];
      if (!batch.length) {
        cache.error = '请先拖入或选择文件';
        await render(viewEl, setPage, currentPage);
        return;
      }
      try {
        // 场景/病种沿用新建病例页已选值，本页只补称呼
        ingest.display_name = document.getElementById('ingest-name')?.value?.trim() || ingest.display_name;
        ingest.upload_busy = true;
        ingest.upload_progress = {
          phase: 'upload',
          percent: 0,
          total: batch.length,
          label: `准备上传 ${batch.length} 个文件`,
        };
        cache.error = '';
        cache.message = '';
        await render(viewEl, setPage, currentPage);

        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const fd = new FormData();
          batch.forEach((f) => fd.append('files', f, f.name));
          xhr.open('POST', `${API_BASE}/api/admin/cases/ingest/upload`);
          const token = state?.auth?.token || '';
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return;
            const percent = Math.max(1, Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
            ingest.upload_progress = {
              phase: 'upload',
              percent,
              total: batch.length,
              label: `正在上传（${percent}%）· ${batch.length} 个文件`,
            };
            const bar = viewEl.querySelector('.admin-upload-bar > i');
            const pctEl = viewEl.querySelector('.admin-upload-pct');
            const subEl = viewEl.querySelector('.admin-upload-progress-copy span');
            const titleEl = viewEl.querySelector('.admin-upload-progress-copy strong');
            if (bar) {
              bar.classList.remove('is-indeterminate');
              bar.style.width = `${percent}%`;
            }
            if (pctEl) pctEl.textContent = `${percent}%`;
            if (subEl) subEl.textContent = ingest.upload_progress.label;
            if (titleEl) titleEl.textContent = '正在上传材料…';
          };
          xhr.upload.onload = () => {
            ingest.upload_progress = {
              phase: 'scan',
              percent: 12,
              total: batch.length,
              label: `已上传 ${batch.length} 个文件 · 本地规则扫描（非 AI）`,
            };
            const bar = viewEl.querySelector('.admin-upload-bar > i');
            const pctEl = viewEl.querySelector('.admin-upload-pct');
            const subEl = viewEl.querySelector('.admin-upload-progress-copy span');
            const titleEl = viewEl.querySelector('.admin-upload-progress-copy strong');
            if (bar) {
              bar.classList.add('is-indeterminate');
              bar.style.width = '28%';
            }
            if (pctEl) pctEl.textContent = '12%';
            if (subEl) subEl.textContent = ingest.upload_progress.label;
            if (titleEl) titleEl.textContent = '本地规则扫描中…';
          };
          xhr.onerror = () => reject(new Error('网络错误，上传失败'));
          xhr.onload = () => {
            let payload = null;
            try {
              payload = JSON.parse(xhr.responseText || '{}');
            } catch {
              payload = null;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(payload || {});
              return;
            }
            reject(new Error(apiError(payload, `上传失败（${xhr.status}）`)));
          };
          xhr.send(fd);
        });

        // 结果已返回：用可见进度条走完扫描态（本地规则很快，稍放慢避免像假闪）
        const entryCount = Array.isArray(data?.files) ? data.files.length : batch.length;
        const scanMs = Math.min(2200, 1100 + entryCount * 55);
        const scanStarted = Date.now();
        while (true) {
          const ratio = Math.min(1, (Date.now() - scanStarted) / scanMs);
          const percent = Math.round(18 + ratio * 82);
          ingest.upload_progress = {
            phase: 'scan',
            percent,
            total: batch.length,
            label: `本地规则扫描 ${percent}% · 共 ${entryCount} 项（非 AI，故意放慢展示）`,
          };
          const bar = viewEl.querySelector('.admin-upload-bar > i');
          const pctEl = viewEl.querySelector('.admin-upload-pct');
          const subEl = viewEl.querySelector('.admin-upload-progress-copy span');
          const titleEl = viewEl.querySelector('.admin-upload-progress-copy strong');
          if (bar) {
            bar.classList.remove('is-indeterminate');
            bar.style.width = `${percent}%`;
          }
          if (pctEl) pctEl.textContent = `${percent}%`;
          if (subEl) subEl.textContent = ingest.upload_progress.label;
          if (titleEl) titleEl.textContent = '本地规则扫描中…';
          if (ratio >= 1) break;
          await new Promise((r) => setTimeout(r, 70));
        }

        if (!data?.ok && !(data?.files || []).length) {
          throw new Error(apiError(data, '上传失败'));
        }
        const files = (data.files || []).map((f) => ({
          ...f,
          include: f.action === 'keep',
        }));
        ingest.source_filename = data.filename || batch.map((f) => f.name).join('、');
        ingest.file_reports = files;
        ingest.file_preview_idx = Math.max(0, files.findIndex((f) => f.action === 'keep'));
        if (ingest.file_preview_idx < 0) ingest.file_preview_idx = 0;
        ingest.pending_files = [];
        rebuildMaterialTextFromReports();
        ingest.upload_busy = false;
        ingest.upload_progress = null;
        if (files.length) {
          ingest.step = 'material_review';
          const s = data.summary || {};
          cache.error = data.ok ? '' : apiError(data, data.error || '没有可用材料');
          cache.message = `规则扫描完成（非 AI）：建议保留 ${s.kept || 0} · 刷掉 ${s.rejected || 0} · 忽略 ${s.skipped || 0}。请人工覆盖确认。`;
        } else {
          ingest.source_text = data.text || '';
          cache.message = `已读取 ${ingest.source_filename}，可编辑后继续`;
        }
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.upload_busy = false;
        ingest.upload_progress = null;
        cache.error = apiError({ detail: err?.message || err }, String(err?.message || err));
        await render(viewEl, setPage, currentPage);
      }
    }

    const dropzone = document.getElementById('ingest-dropzone');
    const fileInput = document.getElementById('ingest-file');

    document.getElementById('ingest-browse')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ingest.upload_busy) return;
      fileInput?.click();
    });

    dropzone?.addEventListener('click', (ev) => {
      if (ingest.upload_busy) return;
      if (ev.target?.closest?.('#ingest-browse, .admin-drop-remove, .admin-drop-actions, #ingest-upload-scan, #ingest-upload-clear')) return;
      fileInput?.click();
    });

    dropzone?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (!ingest.upload_busy) fileInput?.click();
      }
    });

    ;['dragenter', 'dragover'].forEach((evt) => {
      dropzone?.addEventListener(evt, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });
    ;['dragleave', 'dragend', 'drop'].forEach((evt) => {
      dropzone?.addEventListener(evt, (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (evt !== 'drop') dropzone.classList.remove('is-dragover');
      });
    });
    dropzone?.addEventListener('drop', async (ev) => {
      dropzone.classList.remove('is-dragover');
      if (ingest.upload_busy) return;
      addPendingFiles(ev.dataTransfer?.files);
      await render(viewEl, setPage, currentPage);
    });

    fileInput?.addEventListener('change', async (ev) => {
      addPendingFiles(ev.target.files);
      ev.target.value = '';
      await render(viewEl, setPage, currentPage);
    });

    viewEl.querySelectorAll('[data-pending-remove]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const idx = Number(btn.dataset.pendingRemove);
        if (Number.isNaN(idx)) return;
        ingest.pending_files = (ingest.pending_files || []).filter((_, i) => i !== idx);
        cache.message = ingest.pending_files.length
          ? `已选 ${ingest.pending_files.length} 个文件，可继续追加或开始扫描`
          : '';
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('ingest-upload-clear')?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ingest.pending_files = [];
      cache.message = '';
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-upload-scan')?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await scanPendingFiles();
    });

    viewEl.querySelectorAll('.admin-mat-pick, .admin-mat-row').forEach((el) => {
      el.addEventListener('click', async (ev) => {
        if (ev.target?.classList?.contains('admin-mat-include')) return;
        if (ev.target?.closest?.('#ingest-mat-select-all, .admin-mat-toolbar')) return;
        const idx = Number(el.dataset.matIdx);
        if (Number.isNaN(idx)) return;
        ingest.file_preview_idx = idx;
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('.admin-mat-include').forEach((cb) => {
      cb.addEventListener('change', async (ev) => {
        ev.stopPropagation();
        const idx = Number(cb.dataset.matIdx);
        if (Number.isNaN(idx) || !ingest.file_reports[idx]) return;
        ingest.file_reports[idx].include = !!cb.checked;
        rebuildMaterialTextFromReports();
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('ingest-mat-select-all')?.addEventListener('change', async (ev) => {
      const on = !!ev.target.checked;
      (ingest.file_reports || []).forEach((f) => { f.include = on; });
      rebuildMaterialTextFromReports();
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-mat-select-kept')?.addEventListener('click', async () => {
      (ingest.file_reports || []).forEach((f) => { f.include = f.action === 'keep'; });
      rebuildMaterialTextFromReports();
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-mat-select-none')?.addEventListener('click', async () => {
      (ingest.file_reports || []).forEach((f) => { f.include = false; });
      rebuildMaterialTextFromReports();
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('ingest-material-confirm')?.addEventListener('click', async () => {
      rebuildMaterialTextFromReports();
      const included = (ingest.file_reports || []).filter((f) => f.include);
      const readable = included.filter((f) => materialHasBody(f));
      if (!included.length) {
        cache.error = '请至少勾选一份材料';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if ((ingest.source_text || '').trim().length < 20 && !readable.length) {
        cache.error = '勾选的文件几乎没有可读正文（多为二进制垃圾）。请改勾有正文的材料，或返回重传。';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if ((ingest.source_text || '').trim().length < 20) {
        cache.error = '请至少勾选一份有正文的材料（合计约 20 字以上）';
        await render(viewEl, setPage, currentPage);
        return;
      }
      const scene_key = ingest.scene_key || 'follow_up';
      const disease_code = ingest.disease_code || 'HTN';
      const display_name = document.getElementById('ingest-name')?.value?.trim() || ingest.display_name || '';
      ingest.scene_key = scene_key;
      ingest.disease_code = disease_code;
      ingest.display_name = display_name;
      try {
        ingest.busy = true;
        cache.error = '';
        cache.message = '正在把材料写入草稿箱…';
        await render(viewEl, setPage, currentPage);
        const summary = {
          kept: (ingest.file_reports || []).filter((f) => f.action === 'keep').length,
          rejected: (ingest.file_reports || []).filter((f) => f.action === 'reject').length,
          skipped: (ingest.file_reports || []).filter((f) => f.action === 'skip').length,
          included: included.length,
        };
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'material',
            scene_key,
            disease_code,
            display_name,
            source_text: ingest.source_text,
            source_filename: ingest.source_filename || undefined,
            phase: 'intake',
            file_summary: summary,
          }),
        });
        if (!res.ok || !data.ok) throw new Error(apiError(data, '写入草稿失败'));
        ingest.draft = data.draft;
        ingest.display_name = data.draft?.fields?.display_name || display_name;
        ingest.step = 'form';
        ingest.busy = false;
        cache.message = `已写入草稿箱「${ingest.display_name || '未命名'}」。可改正文后点「抽取并整理成卡片」。`;
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.busy = false;
        cache.error = apiError({ detail: err?.message || err }, String(err?.message || err));
        await render(viewEl, setPage, currentPage);
      }
    });

    document.getElementById('ingest-run')?.addEventListener('click', async () => {
      const scene_key = ingest.scene_key || 'follow_up';
      const disease_code = ingest.disease_code || 'HTN';
      const display_name = document.getElementById('ingest-name')?.value?.trim() || '';
      const source_text = document.getElementById('ingest-text')?.value?.trim() || '';
      ingest.scene_key = scene_key;
      ingest.disease_code = disease_code;
      ingest.display_name = display_name;
      ingest.source_text = source_text;
      if (ingest.mode === 'material' && (ingest.file_reports || []).length && !(ingest.file_reports || []).some((f) => f.include)) {
        cache.error = '请先完成材料文件审核并确认纳入';
        ingest.step = 'material_review';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if (source_text.length < 20) {
        cache.error = '请先多写几句（至少约 20 字）再继续';
        await render(viewEl, setPage, currentPage);
        return;
      }
      try {
        ingest.busy = true;
        cache.error = '';
        await render(viewEl, setPage, currentPage);
        let data;
        const intakeId = ingest.draft?.status === 'source_ready' ? ingest.draft.draft_id : null;
        if (intakeId) {
          await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(intakeId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scene_key,
              disease_code,
              display_name,
              source_text,
              source_filename: ingest.source_filename || undefined,
            }),
          });
          const structured = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(intakeId)}/structure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expanded_text: source_text }),
          });
          if (!structured.res.ok || !structured.data.ok) throw new Error(apiError(structured.data, '整理失败'));
          data = structured.data;
        } else {
          const created = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: ingest.mode,
              scene_key,
              disease_code,
              display_name,
              source_text,
              source_filename: ingest.source_filename || undefined,
              phase: ingest.mode === 'rough' ? 'expand' : 'structure',
            }),
          });
          if (!created.res.ok || !created.data.ok) throw new Error(apiError(created.data, '生成失败'));
          data = created.data;
        }
        ingest.draft = data.draft;
        ingest.step = data.draft?.status === 'expand_review' || data.phase === 'expand' ? 'expand' : 'review';
        ingest.busy = false;
        cache.message = ingest.step === 'expand'
          ? '已扩写成案例文稿（分节体例），请先改到满意，再整理成练习卡片'
          : '已整理成练习卡片，请对照原文核对；发布后会出现在「已发布」与模拟对话选人';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.busy = false;
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-open-draft]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(btn.dataset.openDraft)}`);
        if (!data?.ok) {
          cache.error = apiError(data, '无法打开草稿');
          await render(viewEl, setPage, currentPage);
          return;
        }
        ingest.draft = data.draft;
        ingest.mode = data.draft?.mode || '';
        ingest.scene_key = data.draft?.scene_key || ingest.scene_key;
        ingest.disease_code = data.draft?.fields?.disease_code || ingest.disease_code;
        ingest.display_name = data.draft?.fields?.display_name || '';
        ingest.source_text = data.draft?.source?.text || data.draft?.expanded_text || '';
        ingest.source_filename = data.draft?.source?.filename || '';
        if (data.draft?.status === 'source_ready') ingest.step = 'form';
        else if (data.draft?.status === 'expand_review') ingest.step = 'expand';
        else ingest.step = 'review';
        ingest.selected = [];
        ingest.reviseNote = '';
        casesSubtab = 'create';
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('expand-save')?.addEventListener('click', async () => {
      try {
        const draftId = ingest.draft?.draft_id;
        const expanded_text = readExpandCaseDoc();
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expanded_text }),
        });
        if (!data?.ok) throw new Error(apiError(data, '保存失败'));
        ingest.draft = data.draft;
        cache.message = '案例文稿已保存';
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    document.getElementById('expand-to-structure')?.addEventListener('click', async () => {
      if (ingest.busy) return;
      try {
        const draftId = ingest.draft?.draft_id;
        const expanded_text = readExpandCaseDoc();
        if (ingest.draft) ingest.draft.expanded_text = expanded_text;
        ingest.busy = true;
        cache.error = '';
        cache.message = '正在整理练习卡片，请稍候…';
        await render(viewEl, setPage, currentPage);
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}/structure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expanded_text }),
        });
        if (!res.ok || !data.ok) throw new Error(apiError(data, '整理失败'));
        ingest.draft = data.draft;
        ingest.step = 'review';
        ingest.busy = false;
        cache.message = '已整理成练习卡片，请用白话核对后再发布';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.busy = false;
        cache.message = '';
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-del-draft]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await askConfirm('废弃该草稿？将无法恢复。', { title: '废弃草稿', okText: '废弃' }))) return;
        await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(btn.dataset.delDraft)}`, { method: 'DELETE' });
        cache.message = '草稿已废弃';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-annot-kind]').forEach((el) => {
      el.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-annot-check], .admin-annot-pick')) return;
        ingest.highlight = el.dataset.span || '';
        await render(viewEl, setPage, currentPage);
        document.getElementById('ingest-source-pre')?.querySelector('mark')?.scrollIntoView({ block: 'center' });
      });
    });

    viewEl.querySelectorAll('[data-annot-check]').forEach((box) => {
      box.addEventListener('change', async () => {
        const [kind, idxRaw] = String(box.dataset.annotCheck || '').split(':');
        const idx = Number(idxRaw);
        const li = box.closest('[data-annot-kind]');
        const text = li?.dataset.annotText || '';
        ingest.reviseNote = document.getElementById('rev-ai-note')?.value || ingest.reviseNote;
        if (box.checked) {
          if (!ingest.selected.some((s) => s.kind === kind && s.idx === idx)) {
            ingest.selected = [...ingest.selected, { kind, idx, text }];
          }
        } else {
          ingest.selected = ingest.selected.filter((s) => !(s.kind === kind && s.idx === idx));
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('rev-clear-sel')?.addEventListener('click', async () => {
      ingest.reviseNote = document.getElementById('rev-ai-note')?.value || '';
      ingest.selected = [];
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('rev-ai-fix')?.addEventListener('click', async () => {
      if (ingest.busy) return;
      try {
        const draftId = ingest.draft?.draft_id;
        const instruction = (document.getElementById('rev-ai-note')?.value || '').trim();
        ingest.reviseNote = instruction;
        if (instruction.length < 2) {
          cache.error = '写一句大概也行，例如「少了」「这条不对」';
          await render(viewEl, setPage, currentPage);
          return;
        }
        ingest.busy = true;
        cache.error = '';
        cache.message = '正在按你的意见改卡片…';
        await render(viewEl, setPage, currentPage);
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}/revise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction,
            targets: ingest.selected,
          }),
        });
        if (!res.ok || !data.ok) throw new Error(apiError(data, '修订失败'));
        ingest.draft = data.draft;
        ingest.selected = [];
        ingest.reviseNote = '';
        ingest.busy = false;
        cache.message = '已按意见改完；改前版本已保存，可在「版本回溯」里回退';
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.busy = false;
        cache.message = '';
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-restore-version]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (ingest.busy) return;
        const versionId = btn.dataset.restoreVersion;
        if (!(await askConfirm(`回到版本 ${versionId}？当前卡片会先再存一版，避免丢。`, { title: '版本回溯', okText: '回到此版' }))) return;
        try {
          ingest.busy = true;
          cache.error = '';
          cache.message = '正在回溯版本…';
          await render(viewEl, setPage, currentPage);
          const { res, data } = await fetchApi(
            `${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(ingest.draft?.draft_id)}/versions/${encodeURIComponent(versionId)}/restore`,
            { method: 'POST' },
          );
          if (!res.ok || !data.ok) throw new Error(apiError(data, '回溯失败'));
          ingest.draft = data.draft;
          ingest.selected = [];
          ingest.busy = false;
          cache.message = `已回到 ${versionId}；回溯前也存了一版`;
          await render(viewEl, setPage, currentPage);
        } catch (err) {
          ingest.busy = false;
          cache.message = '';
          cache.error = String(err.message || err);
          await render(viewEl, setPage, currentPage);
        }
      });
    });

    document.getElementById('rev-save')?.addEventListener('click', async () => {
      try {
        const draftId = ingest.draft?.draft_id;
        const sceneSel = document.getElementById('rev-scene')?.value;
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: document.getElementById('rev-name')?.value?.trim(),
            scene_key: sceneSel || undefined,
            disease_code: document.getElementById('rev-disease')?.value || undefined,
            visit_context: document.getElementById('rev-visit')?.value?.trim(),
            reviewed_ack: !!document.getElementById('rev-ack')?.checked,
          }),
        });
        if (!data?.ok) throw new Error(apiError(data, '保存失败'));
        ingest.draft = data.draft;
        ingest.scene_key = data.draft?.scene_key || ingest.scene_key;
        ingest.disease_code = data.draft?.fields?.disease_code || ingest.disease_code;
        cache.message = '草稿已保存';
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    document.getElementById('rev-scene')?.addEventListener('change', async () => {
      const sceneSel = document.getElementById('rev-scene')?.value;
      if (!sceneSel) return;
      try {
        const draftId = ingest.draft?.draft_id;
        ingest.busy = true;
        cache.message = '正在切换发布场景…';
        await render(viewEl, setPage, currentPage);
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scene_key: sceneSel,
            display_name: document.getElementById('rev-name')?.value?.trim(),
            disease_code: document.getElementById('rev-disease')?.value || undefined,
            visit_context: document.getElementById('rev-visit')?.value?.trim(),
          }),
        });
        ingest.busy = false;
        if (!data?.ok) throw new Error(apiError(data, '切换场景失败'));
        ingest.draft = data.draft;
        ingest.scene_key = data.draft?.scene_key || sceneSel;
        cache.message = `已改为「${sceneMetaOf(ingest.scene_key).label}」`;
        cache.error = '';
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        ingest.busy = false;
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    document.getElementById('rev-discard')?.addEventListener('click', async () => {
      if (!(await askConfirm('废弃该草稿？将无法恢复。', { title: '废弃草稿', okText: '废弃' }))) return;
      await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(ingest.draft.draft_id)}`, { method: 'DELETE' });
      ingest.step = 'hub';
      ingest.draft = null;
      cache.message = '草稿已废弃';
      await loadAll();
      await render(viewEl, setPage, currentPage);
    });

    document.getElementById('rev-publish')?.addEventListener('click', async () => {
      try {
        const draftId = ingest.draft?.draft_id;
        const sceneSel = document.getElementById('rev-scene')?.value;
        const patchRes = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: document.getElementById('rev-name')?.value?.trim(),
            scene_key: sceneSel || undefined,
            disease_code: document.getElementById('rev-disease')?.value || undefined,
            visit_context: document.getElementById('rev-visit')?.value?.trim(),
            reviewed_ack: !!document.getElementById('rev-ack')?.checked,
          }),
        });
        if (!patchRes.res.ok || !patchRes.data?.ok) {
          throw new Error(apiError(patchRes.data, '保存失败'));
        }
        ingest.draft = patchRes.data.draft;
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/drafts/${encodeURIComponent(draftId)}/publish`, {
          method: 'POST',
        });
        if (!res.ok || !data.ok) throw new Error(apiError(data, '发布失败'));
        {
          const sk = ingest.draft?.scene_key || ingest.scene_key;
          const lv = TRAIN_LEVELS[sk] || { label: sceneLabelOf(sk), rubric: '评分表' };
          const who = document.getElementById('rev-name')?.value?.trim()
            || ingest.draft?.fields?.display_name
            || '未命名';
          cache.message = `已发布：${who}（${lv.label} · ${lv.rubric || '评分表'}）${data.case_id ? ' · ' + data.case_id : ''}`;
        }
        ingest.step = 'hub';
        ingest.draft = null;
        casesSubtab = 'create';
        createPath = 'hub';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-del-case]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await askConfirm('确定删除该病例？学员将无法再选到它。', { title: '删除病例', okText: '删除' }))) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/${encodeURIComponent(btn.dataset.delCase)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = apiError(data, '删除失败');
        else {
          cache.message = '病例已删除';
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('admin-scene-save')?.addEventListener('click', async () => {
      const title = document.getElementById('admin-scene-title')?.value?.trim();
      const summary = document.getElementById('admin-scene-summary')?.value?.trim() || '';
      const code = document.getElementById('admin-scene-code')?.value?.trim() || '';
      const tier = viewEl.querySelector('input[name="admin-scene-tier"]:checked')?.value || 'test';
      let id = document.getElementById('admin-scene-id')?.value?.trim();
      if (!title) {
        cache.error = '请填写场景名称';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if (!['test', 'formal'].includes(tier)) {
        cache.error = '请选择场景性质：测试或正式';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if (!id) {
        id = title.replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fff-]/g, '') || `scene_${Date.now()}`;
      }
      const { data } = await fetchApi(`${API_BASE}/api/admin/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          scene_key: id,
          title,
          name: title,
          summary,
          description: summary,
          code: code || undefined,
          enabled: true,
          tier,
          statusLabel: tier === 'formal' ? '正式' : '测试',
        }),
      });
      if (!data?.ok) cache.error = data?.detail || data?.error || '保存失败';
      else {
        cache.message = tier === 'formal'
          ? `「${title}」已保存为正式场景（可发布到学员端）`
          : `「${title}」已保存为测试场景（不进学员端；可随时改成正式）`;
        await loadAll();
      }
      await render(viewEl, setPage, currentPage);
    });

    viewEl.querySelectorAll('[data-scene-tier]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.sceneTier;
        const tier = btn.dataset.tier;
        if (!id || !['test', 'formal'].includes(tier || '')) return;
        const hit = (cache.scenes || []).find((s) => (s.id || s.scene_key) === id);
        if (!hit) {
          cache.error = '未找到该场景';
          await render(viewEl, setPage, currentPage);
          return;
        }
        const { data } = await fetchApi(`${API_BASE}/api/admin/scenes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            scene_key: id,
            title: sceneTitle(hit),
            name: sceneTitle(hit),
            summary: sceneDesc(hit),
            description: sceneDesc(hit),
            code: hit.code || undefined,
            enabled: hit.enabled !== false,
            tier,
            statusLabel: tier === 'formal' ? '正式' : '测试',
          }),
        });
        if (!data?.ok) cache.error = apiError(data, '更新失败');
        else {
          const n = data.refreshed_drafts;
          cache.message = `「${sceneTitle(hit)}」已改为${tier === 'formal' ? '正式' : '测试'}`
            + (typeof n === 'number' && n > 0 ? `；已刷新 ${n} 份相关草稿挂钩` : '。请重新打开草稿再发布');
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('admin-disease-suggest')?.addEventListener('click', async () => {
      const name_zh = document.getElementById('admin-disease-name')?.value?.trim();
      const description = document.getElementById('admin-disease-desc')?.value?.trim() || '';
      const introduction = document.getElementById('admin-disease-intro')?.value?.trim() || '';
      const hint = document.getElementById('admin-disease-code-hint');
      if (!name_zh) {
        cache.error = '请先填写病种名称，再预览编码';
        await render(viewEl, setPage, currentPage);
        return;
      }
      try {
        if (hint) hint.textContent = '正在生成编码…';
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/diseases/suggest-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name_zh,
            description: [description, introduction].filter(Boolean).join('\n'),
          }),
        });
        if (!res.ok || !data?.ok) throw new Error(apiError(data, data?.detail || data?.error || '生成失败'));
        const codeInput = document.getElementById('admin-disease-code');
        if (codeInput) codeInput.value = data.disease_code || '';
        const via = data.source === 'ai' ? 'AI' : '系统规则';
        if (hint) hint.textContent = `预览编码：${data.disease_code}（${via}生成，可改后再保存）`;
        cache.message = data.message || `已生成 ${data.disease_code}`;
        cache.error = '';
      } catch (err) {
        cache.error = String(err.message || err);
        if (hint) hint.textContent = '';
        await render(viewEl, setPage, currentPage);
      }
    });

    document.getElementById('admin-disease-save')?.addEventListener('click', async () => {
      const name_zh = document.getElementById('admin-disease-name')?.value?.trim();
      const disease_code = document.getElementById('admin-disease-code')?.value?.trim() || '';
      const icd10 = document.getElementById('admin-disease-icd')?.value?.trim() || '';
      const description = document.getElementById('admin-disease-desc')?.value?.trim() || '';
      const introduction = document.getElementById('admin-disease-intro')?.value?.trim() || '';
      if (!name_zh) {
        cache.error = '请填写病种名称';
        await render(viewEl, setPage, currentPage);
        return;
      }
      if (!introduction) {
        cache.error = '请填写病种介绍（这个病是什么、受试者常担心什么）';
        await render(viewEl, setPage, currentPage);
        return;
      }
      try {
        const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/diseases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            disease_code: disease_code || undefined,
            name_zh,
            icd10,
            description,
            introduction,
          }),
        });
        if (!res.ok || !data?.ok) throw new Error(apiError(data, data?.detail || data?.error || '保存病种失败'));
        ingest.diseases = data.diseases || ingest.diseases;
        cache.message = data.message || `病种「${name_zh}」已保存`;
        cache.error = '';
        createPath = 'disease';
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-del-disease]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const code = btn.dataset.delDisease;
        if (!(await askConfirm(`确定删除病种 ${code}？`, { title: '删除病种', okText: '删除' }))) return;
        try {
          const { res, data } = await fetchApi(`${API_BASE}/api/admin/cases/ingest/diseases/${encodeURIComponent(code)}`, {
            method: 'DELETE',
          });
          if (!res.ok || !data?.ok) throw new Error(apiError(data, data?.detail || data?.error || '删除失败'));
          ingest.diseases = data.diseases || ingest.diseases;
          cache.message = data.message || '病种已删除';
          await loadAll();
          await render(viewEl, setPage, currentPage);
        } catch (err) {
          cache.error = String(err.message || err);
          await render(viewEl, setPage, currentPage);
        }
      });
    });

    viewEl.querySelectorAll('[data-del-scene]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await askConfirm('确定删除该场景？', { title: '删除场景', okText: '删除' }))) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/scenes/${encodeURIComponent(btn.dataset.delScene)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = apiError(data, '删除失败');
        else {
          cache.message = '场景已删除';
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    document.getElementById('admin-user-create')?.addEventListener('click', async () => {
      const body = {
        username: document.getElementById('admin-new-username')?.value,
        display_name: document.getElementById('admin-new-displayname')?.value,
        password: document.getElementById('admin-new-password')?.value,
        role: document.getElementById('admin-new-role')?.value || userRoleTab,
      };
      const { data } = await fetchApi(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!data?.ok) cache.error = data?.detail || data?.error || '创建失败';
      else {
        cache.message = `已创建 ${data.user?.display_name || data.user?.username}`;
        await loadAll();
      }
      await render(viewEl, setPage, currentPage);
    });

    viewEl.querySelectorAll('[data-save-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveUser;
        const role = viewEl.querySelector(`[data-role-user="${id}"]`)?.value;
        const { data } = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        if (!data?.ok) cache.error = data?.detail || data?.error || '保存失败';
        else {
          cache.message = '角色已更新';
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await askConfirm('确定删除该账号？', { title: '删除账号', okText: '删除' }))) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(btn.dataset.delUser)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = apiError(data, '删除失败');
        else {
          cache.message = '账号已删除';
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    // 形象库选中
    viewEl.querySelectorAll('[data-gallery-path]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedGalleryPath = btn.dataset.galleryPath || '';
        viewEl.querySelectorAll('.admin-gallery-item').forEach((el) => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
      });
    });

    viewEl.querySelectorAll('[data-apply-gallery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!selectedGalleryPath) {
          cache.error = '请先在上方形象库点选一张默认形象';
          render(viewEl, setPage);
          return;
        }
        const sel = viewEl.querySelector(`[data-av-portrait="${btn.dataset.applyGallery}"]`);
        if (sel) sel.value = selectedGalleryPath;
        const preview = btn.closest('.admin-avatar-card')?.querySelector('.admin-avatar-preview img');
        if (preview) preview.src = selectedGalleryPath;
        cache.message = '已套用选中形象，请再点「保存」写入';
      });
    });

    async function uploadPortrait(file, personaId) {
      const fd = new FormData();
      fd.append('file', file);
      if (personaId) fd.append('persona_id', personaId);
      const headers = {};
      if (state.auth.token) headers.Authorization = `Bearer ${state.auth.token}`;
      const res = await fetch(`${API_BASE}/api/admin/avatars/upload`, { method: 'POST', headers, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '上传失败');
      return data;
    }

    viewEl.querySelectorAll('[data-upload-persona]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const data = await uploadPortrait(file, input.dataset.uploadPersona);
          cache.message = `已上传并绑定肖像：${data.label || data.path}`;
          await loadAll();
          await render(viewEl, setPage, currentPage);
        } catch (err) {
          cache.error = String(err.message || err);
          await render(viewEl, setPage, currentPage);
        }
      });
    });

    document.getElementById('admin-upload-new-portrait')?.addEventListener('click', () => {
      document.getElementById('admin-new-portrait-file')?.click();
    });
    document.getElementById('admin-new-portrait-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const data = await uploadPortrait(file, null);
        cache.message = `已加入形象库：${data.label || data.path}`;
        await loadAll();
        await render(viewEl, setPage, currentPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage, currentPage);
      }
    });

    viewEl.querySelectorAll('[data-save-avatar]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.saveAvatar;
        const visual = viewEl.querySelector(`[data-av-visual="${pid}"]`)?.value;
        const model_id = viewEl.querySelector(`[data-av-model="${pid}"]`)?.value || null;
        const portrait_path = viewEl.querySelector(`[data-av-portrait="${pid}"]`)?.value || null;
        const { data } = await fetchApi(`${API_BASE}/api/admin/avatars`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            persona_id: pid,
            visual,
            model_id: model_id || undefined,
            portrait_path: portrait_path ? portrait_path.split('?')[0] : undefined,
          }),
        });
        if (!data?.ok) cache.error = data?.detail || data?.error || '保存失败';
        else {
          cache.message = '形象绑定已保存';
          await loadAll();
        }
        await render(viewEl, setPage, currentPage);
      });
    });

    viewEl.querySelectorAll('[data-ai-portrait]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (avatarGenPid) return;
        const pid = btn.dataset.aiPortrait;
        const hint = viewEl.querySelector(`[data-av-hint="${pid}"]`)?.value?.trim() || '';
        const persona = (cache.avatars?.personas || []).find((p) => p.persona_id === pid);
        try {
          avatarGenPid = pid;
          cache.error = '';
          cache.message = '';
          await render(viewEl, setPage, currentPage);
          const { res, data } = await fetchApi(`${API_BASE}/api/admin/avatars/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              persona_id: pid,
              display_hint: hint || '',
              bind: true,
            }),
          });
          if (!res.ok || !data?.ok) throw new Error(apiError(data, '生成失败'));
          avatarGenPid = '';
          cache.message = `「${persona?.display_label || pid}」立绘已按人设生成`;
          await loadAll({ silent: true });
          await render(viewEl, setPage, currentPage);
        } catch (err) {
          avatarGenPid = '';
          cache.message = '';
          cache.error = String(err.message || err);
          await render(viewEl, setPage, currentPage);
        }
      });
    });

    // 肖像下拉即时预览
    viewEl.querySelectorAll('[data-av-portrait]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const card = sel.closest('.admin-avatar-card');
        const img = card?.querySelector('.admin-avatar-preview img');
        if (img && sel.value) img.src = portraitUrl(sel.value);
      });
    });
  }

  return { render, loadAll, isAdminUser };
}
