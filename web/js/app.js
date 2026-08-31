import { createVoiceController } from './voice.js?v=20260831p42';
import { createDigitalHumanController } from './digital-human.js?v=20260831p35';
import { createAdminController, isAdminUser } from './admin.js?v=20260831p41';

const AUTH_TOKEN_KEY = 'aisp_auth_token';
const AUTH_USER_KEY = 'aisp_auth_user';
const PRACTICE_SESSION_KEY = 'aisp_practice_session_id';
const AUTH_ROUTES = new Set(['practice', 'feedback', 'records', 'admin']);

/** 学员端主导航（不含系统功能） */
const STUDENT_ROUTES = [
  { id: 'guide', label: '使用手册', eyebrow: 'User Manual' },
  { id: 'practice', label: '模拟对话', eyebrow: 'Practice Chat' },
  { id: 'records', label: '对话记录', eyebrow: 'Session Records' },
  { id: 'feedback', label: '练习反馈', eyebrow: 'Feedback' },
  { id: 'cases', label: '病例详情资料', eyebrow: 'Case Briefing' },
];

/** 管理端入口（仅 admin 可见） */
const ADMIN_NAV = [
  { id: 'admin', label: '管理端', eyebrow: 'Admin' },
  { id: 'explain', label: '系统功能', eyebrow: 'System Guide' },
];

const ROUTES = STUDENT_ROUTES;
const COMM_STAGES_IC = [
  { id: 1, key: 'greet_frame', title: '破冰与材料', hint: '说明谈话目的、伦理批准的知情同意材料', patterns: [/伦理/, /知情同意/, /批准/, /同意书/, /最新版/] },
  { id: 2, key: 'purpose', title: '试验目的', hint: '说明为何开展、想解决什么问题', patterns: [/目的/, /为了/, /研究/, /看看.*效果/, /为什么做/] },
  { id: 3, key: 'procedure', title: '流程安排', hint: '来几次、抽血、服药、访视安排', patterns: [/抽血/, /访视/, /来.*次/, /流程/, /安排/, /服药/] },
  { id: 4, key: 'risk', title: '风险与不便', hint: '主要风险/不适，不淡化', patterns: [/风险/, /副作用/, /不适/, /不良反应/, /不舒服/] },
  { id: 5, key: 'benefit', title: '获益不确定', hint: '可能获益，也可能无效', patterns: [/不一定/, /可能无效/, /安慰剂/, /不保证/, /获益/, /有效/] },
  { id: 6, key: 'voluntariness', title: '自愿与退出', hint: '可拒绝、可随时退出且不受歧视', patterns: [/自愿/, /退出/, /不参加/, /随时/, /不愿意/, /强迫/] },
  { id: 7, key: 'compensation', title: '补偿与损害', hint: '补偿、花费或损害处理原则', patterns: [/补偿/, /补贴/, /损害/, /医药费/, /交通/, /花费/, /自费/] },
  { id: 8, key: 'qa_close', title: '答疑与收尾', hint: '留提问时间、联系方式、文件副本', patterns: [/还有.*问题/, /慢慢/, /不着急/, /可以问/, /电话/, /联系/, /副本/, /复印件/] },
];

const COMM_STAGES_FU = [
  { id: 1, key: 'rapport', title: '平和开场', hint: '非责备地了解服药情况', patterns: [/最近/, /怎么样/, /服药/, /吃.*药/, /不是.*责怪/, /一起/] },
  { id: 2, key: 'missed_dose', title: '漏服核查', hint: '具体日期/场景追问漏服', patterns: [/漏服/, /忘记/, /没吃/, /第\d+天/] },
  { id: 3, key: 'ae', title: '不适/AE', hint: '询问头晕等不适', patterns: [/头晕/, /不适/, /不舒服/, /副作用/, /发飘/] },
  { id: 4, key: 'concomitant', title: '合并用药', hint: '其他药/感冒药/保健品', patterns: [/其他药/, /感冒药/, /保健品/, /合并/] },
  { id: 5, key: 'pill_count', title: '药盒清点', hint: '剩余片数核对', patterns: [/药盒/, /剩.*片/, /片数/] },
  { id: 6, key: 'safety', title: '安全联系', hint: '何时联系中心、勿自行停药', patterns: [/联系/, /打电话/, /不要自己/, /停药/, /下次/] },
];

/** 知情同意开练导览检查点（13 项，对标 rubric MVP） */
const IC_CHECKPOINT_IDS = [
  'IC-P01', 'IC-P02', 'IC-P03', 'IC-P04', 'IC-P05',
  'IC-C01', 'IC-C02', 'IC-C04', 'IC-C05', 'IC-C09',
  'IC-C08', 'CC-01', 'CC-02',
];

/** 随访开练导览检查点（11 项必达 + 2 项红线另计） */
const FU_CHECKPOINT_IDS = [
  'FU-A01', 'FU-A02', 'FU-A03', 'FU-A04', 'FU-A05', 'FU-A06',
  'FU-P01', 'FU-P02', 'FU-P03', 'FU-C01', 'FU-C02',
];

const SCORE_DIM_EXPLAIN = {
  redline: '有没有出现强迫、夸大疗效、隐瞒风险等「一票否决」表述。',
  L1: '必达内容/核查：规范要求必须讲到或问到的关键点。',
  L2: '过程与安排：流程、随访、联系方式等是否交代清楚。',
  communication: '沟通方式：是否平和、具体追问、鼓励如实说明。',
  concern: '关切回应：受试者问退出、疗效、副作用时有没有正面回答。',
};

const SCORE_DIM_ICONS = {
  redline: '🛡️',
  L1: '📋',
  L2: '🗓️',
  communication: '💬',
  concern: '❤️',
};

function feedbackScoreTone(score, passScore = 60) {
  const n = Number(score);
  if (Number.isNaN(n)) return 'muted';
  if (n >= 85) return 'excellent';
  if (n >= passScore) return 'ok';
  if (n >= 40) return 'warn';
  return 'bad';
}

function buildScoreRingSvg(score, { size = 108, passScore = 60, sub = '分' } = {}) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (n / 100);
  const tone = feedbackScoreTone(n, passScore);
  const cx = size / 2;
  return `
    <svg class="fb-ring fb-ring--${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${n} 分">
      <circle class="fb-ring-track" cx="${cx}" cy="${cx}" r="${r}" fill="none" />
      <circle class="fb-ring-fill" cx="${cx}" cy="${cx}" r="${r}" fill="none"
        stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"
        transform="rotate(-90 ${cx} ${cx})" />
      <text x="${cx}" y="${cx - 2}" text-anchor="middle" class="fb-ring-num">${Math.round(n)}</text>
      <text x="${cx}" y="${cx + 14}" text-anchor="middle" class="fb-ring-sub">${sub}</text>
    </svg>`;
}

function buildFeedbackRadarSvg(scores) {
  const dims = Object.entries(scores?.dimensions || {})
    .filter(([, d]) => d.fail_count == null && d.score != null);
  if (dims.length < 3) return '';
  const passScore = scores.pass_score || 60;
  const pad = 28;
  const size = 200;
  const full = size + pad * 2;
  const cx = full / 2;
  const cy = full / 2;
  const maxR = 72;
  const n = dims.length;
  const gridLevels = [0.25, 0.5, 0.75, 1];

  const axisPoints = dims.map(([id, d], i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const score = Math.max(0, Math.min(100, d.score || 0));
    const r = maxR * (score / 100);
    const explain = SCORE_DIM_EXPLAIN[id] || '';
    return {
      id,
      name: d.name || id,
      explain,
      score,
      tone: feedbackScoreTone(score, passScore),
      ox: cx + maxR * Math.cos(angle),
      oy: cy + maxR * Math.sin(angle),
      px: cx + r * Math.cos(angle),
      py: cy + r * Math.sin(angle),
    };
  });

  const poly = axisPoints.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
  const passR = maxR * (passScore / 100);

  return `
    <div class="fb-radar-wrap">
      <div class="fb-radar-chart-col">
        <svg class="fb-radar" viewBox="0 0 ${full} ${full}" role="img" aria-label="各维度得分雷达图">
          ${gridLevels.map((lv) => {
            const gr = maxR * lv;
            const gp = dims.map((_, i) => {
              const a = (Math.PI * 2 * i / n) - Math.PI / 2;
              return `${(cx + gr * Math.cos(a)).toFixed(1)},${(cy + gr * Math.sin(a)).toFixed(1)}`;
            }).join(' ');
            return `<polygon class="fb-radar-grid" points="${gp}" />`;
          }).join('')}
          <circle class="fb-radar-pass-line" cx="${cx}" cy="${cy}" r="${passR.toFixed(1)}" />
          ${axisPoints.map((p) => `<line class="fb-radar-axis" x1="${cx}" y1="${cy}" x2="${p.ox.toFixed(1)}" y2="${p.oy.toFixed(1)}" />`).join('')}
          <polygon class="fb-radar-area" points="${poly}" />
          ${axisPoints.map((p) => `<circle class="fb-radar-dot fb-radar-dot--${p.tone}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4.5" />`).join('')}
        </svg>
      </div>
      <ul class="fb-radar-legend">
        ${axisPoints.map((p) => `
          <li class="fb-radar-legend-item fb-radar-legend-item--${p.tone}">
            <span class="fb-radar-legend-score">${p.score}</span>
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              <span>${escapeHtml(p.explain)}</span>
            </div>
          </li>`).join('')}
      </ul>
      <p class="fb-radar-note">虚线圆 = 达标线 ${passScore} 分 · 右侧为完整维度名称与说明</p>
    </div>`;
}

function buildVerdictDonutHtml(items) {
  if (!items?.length) return '';
  const counts = { pass: 0, uncertain: 0, fail: 0, skipped: 0 };
  items.forEach((it) => {
    const v = it.verdict || 'uncertain';
    counts[v] = (counts[v] || 0) + 1;
  });
  const total = items.length;
  const segs = [
    { key: 'pass', label: '通过', color: '#10b981', n: counts.pass || 0 },
    { key: 'uncertain', label: '不确定', color: '#f59e0b', n: counts.uncertain || 0 },
    { key: 'fail', label: '未通过', color: '#ef4444', n: counts.fail || 0 },
  ].filter((s) => s.n > 0);

  let offset = 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  const arcs = segs.map((s) => {
    const pct = s.n / total;
    const dash = c * pct;
    const arc = `<circle class="fb-donut-seg" cx="44" cy="44" r="${r}" fill="none" stroke="${s.color}"
      stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset * c).toFixed(2)}"
      transform="rotate(-90 44 44)" />`;
    offset += pct;
    return arc;
  }).join('');

  return `
    <div class="fb-verdict-donut-wrap">
      <svg class="fb-verdict-donut" width="88" height="88" viewBox="0 0 88 88" role="img">
        <circle class="fb-donut-track" cx="44" cy="44" r="${r}" fill="none" />
        ${arcs}
        <text x="44" y="42" text-anchor="middle" class="fb-donut-num">${total}</text>
        <text x="44" y="54" text-anchor="middle" class="fb-donut-sub">检查项</text>
      </svg>
      <ul class="fb-verdict-legend">
        ${segs.map((s) => `
          <li><span class="fb-legend-dot" style="background:${s.color}"></span>${s.label} <strong>${s.n}</strong></li>
        `).join('')}
      </ul>
    </div>`;
}

function buildFeedbackDimensionsVizHtml(scores) {
  if (!scores || scores.insufficient_sample || scores.total_score == null) return '';
  const passScore = scores.pass_score || 60;
  const dims = Object.entries(scores.dimensions || {});

  const cards = dims.map(([id, d]) => {
    const explain = SCORE_DIM_EXPLAIN[id] || '该维度的分项汇总。';
    const icon = SCORE_DIM_ICONS[id] || '◆';
    if (d.fail_count != null) {
      return `
        <article class="fb-dim-card fb-dim-card--gate ${d.passed ? 'is-pass' : 'is-fail'}">
          <div class="fb-dim-card-icon">${icon}</div>
          <div class="fb-dim-card-body">
            <h4>${escapeHtml(d.name || id)}</h4>
            <p>${escapeHtml(explain)}</p>
          </div>
          <div class="fb-gate-badge ${d.passed ? 'ok' : 'bad'}">${d.passed ? '通过' : `${d.fail_count} 项违规`}</div>
        </article>`;
    }
    const tone = feedbackScoreTone(d.score, passScore);
    const earnedPct = d.max ? Math.round((100 * (d.earned || 0)) / (d.max || 1)) : d.score;
    return `
      <article class="fb-dim-card fb-dim-card--${tone}">
        ${buildScoreRingSvg(d.score, { size: 96, passScore, sub: '分' })}
        <div class="fb-dim-card-body">
          <h4><span class="fb-dim-card-icon-inline">${icon}</span>${escapeHtml(d.name || id)}</h4>
          <p>${escapeHtml(explain)}</p>
          ${d.item_count ? `<span class="fb-dim-meta">共 ${d.item_count} 项 · 折合 ${earnedPct}%</span>` : ''}
        </div>
      </article>`;
  }).join('');

  return `
    ${buildFeedbackRadarSvg(scores)}
    <div class="fb-dim-card-grid">${cards}</div>`;
}

function buildFeedbackOverviewVizHtml(scores, items) {
  if (!scores || scores.insufficient_sample || scores.total_score == null) return '';
  const passScore = scores.pass_score || 60;
  const dims = Object.entries(scores.dimensions || {}).filter(([, d]) => d.fail_count == null);
  const miniBars = dims.map(([id, d]) => {
    const tone = feedbackScoreTone(d.score, passScore);
    return `
      <div class="fb-mini-bar fb-mini-bar--${tone}">
        <span class="fb-mini-bar-label">${escapeHtml(d.name || id)}</span>
        <div class="fb-mini-bar-track"><span style="width:${Math.max(0, Math.min(100, d.score || 0))}%"></span></div>
        <span class="fb-mini-bar-val">${d.score ?? '—'}</span>
      </div>`;
  }).join('');

  return `
    <div class="fb-overview-viz">
      <div class="fb-overview-ring-col">
        ${buildScoreRingSvg(scores.total_score, { size: 140, passScore, sub: '/100' })}
        <p class="fb-overview-ring-caption">${escapeHtml(scores.grade_label || '')}</p>
      </div>
      <div class="fb-overview-side">
        ${buildVerdictDonutHtml(items)}
        <div class="fb-mini-bars">${miniBars}</div>
      </div>
    </div>`;
}

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
  records: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  feedback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V4a2 2 0 0 0-2-2z"/><path d="M8 8h8M8 12h6"/></svg>',
  terms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

/** 与页面同域请求 API（云端 8443、本地 8000 均适用）；勿写死 127.0.0.1 */
const API_BASE = (typeof location !== 'undefined') ? '' : 'http://127.0.0.1:8000';

const EXPLAIN_SECTIONS = [
  { id: 'overview', label: '系统概览', hint: '双底座架构' },
  { id: 'standards', label: '标准解释', hint: '法规白话' },
  { id: 'rubric', label: '评分说明', hint: '怎么算分' },
  { id: 'database', label: '数据库', hint: '入库实况' },
  { id: 'scenes', label: '训练场景', hint: 'S1 知情同意' },
  { id: 'timeline', label: '效力时间线', hint: '版本节点' },
  { id: 'terms', label: '术语表', hint: '统一叫法' },
];

/** 旧 hash 路由 → 系统功能页内锚点 */
const LEGACY_TO_EXPLAIN = {
  standards: 'standards',
  database: 'database',
  rubric: 'rubric',
  terms: 'terms',
  overview: 'overview',
  timeline: 'timeline',
  scenes: 'scenes',
};

const CASE_DETAIL_SECTIONS = [
  { id: 'overview', label: '病例概览', hint: '训练前先看' },
  { id: 'patient', label: '患者档案', hint: '人设与背景' },
  { id: 'clinical', label: '病情症状', hint: '主诉与体征' },
  { id: 'protocol', label: '试验方案', hint: '在做什么' },
  { id: 'medication', label: '用药情况', hint: '现用药与试验药' },
  { id: 'risks', label: '风险获益', hint: '沟通必讲' },
];

function caseStatusLabel(status) {
  return { placeholder: '占位数据', reviewed: '已审核', active: '正式启用', draft: '草稿' }[status] || status;
}

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
  casePackages: {},
  selectedDiseaseCode: null,
  selectedCaseId: null,
  selectedPersonaId: null,
  casesTreeExpanded: {},
  caseSection: 'overview',
  casePackage: null,
  dbVerify: null,
  dbBusy: false,
  dbActionMsg: '',
  practice: {
    sessionId: null,
    caseInfo: null,
    casePackage: null,
    persona: null,
    messages: [],
    busy: false,
    status: null,
    error: '',
    composerDraft: '',
    studyMode: localStorage.getItem('practiceStudyMode') || 'reference',
    sessionMode: 'practice',
    referenceOpen: false,
    pickerOpen: false,
    showAllResumes: false,
    feedExpanded: false,
    checkpointOpen: false,
    liveChecklistOpen: false,
    patientAffect: null,
    lastCheckpointDone: null,
    checkpointFlash: '',
    restoring: false,
  },
  practicePickerSearch: '',
  feedbackData: null,
  feedbackTranscript: [],
  feedbackHistory: [],
  feedbackLoading: false,
  feedbackError: '',
  selectedFeedbackSessionId: null,
  feedbackTab: 'overview',
  navStack: [],
  practiceHistory: [],
  engagementMode: localStorage.getItem('engagementMode') || 'practice',
  recordsFilter: {
    sessionMode: 'all',
    status: 'all',
    personaId: 'all',
  },
  voice: {
    enabled: false,
    listening: false,
    speaking: false,
    processing: false,
    configured: false,
    speechRecognition: false,
    interim: '',
    draft: '',
    inputBase: '',
    error: '',
    autoSend: false,
  },
  route: 'guide',
  explainSection: 'overview',
  auth: {
    token: sessionStorage.getItem(AUTH_TOKEN_KEY) || '',
    user: (() => {
      try {
        return JSON.parse(sessionStorage.getItem(AUTH_USER_KEY) || 'null');
      } catch {
        return null;
      }
    })(),
    loading: false,
    error: '',
    mode: 'login',
  },
  digitalHuman: {
    enabled: true,
  },
  filterCategory: 'all',
  filterLayer: 'all',
  search: '',
  caseLibrarySearch: '',
  caseNavLevel: 'library',
  caseModalSection: 'overview',
  defaultCaseId: null,
  simpleMode: true,
};

const $ = (sel) => document.querySelector(sel);
const viewEl = $('#view');
const modal = $('#modal');
const modalBody = $('#modal-body');

let voiceLastSentAt = 0;
let voiceLastText = '';

const digitalHumanCtrl = createDigitalHumanController({});

const adminCtrl = createAdminController({
  fetchApi,
  API_BASE,
  escapeHtml,
  navigate: (...args) => navigate(...args),
  state,
});

const voiceCtrl = createVoiceController({
  onTranscriptUpdate: ({ text, listening, finalize, processing }) => {
    if (state.route !== 'practice') return;
    state.voice.processing = !!processing;
    const input = $('#chat-input');
    if (!input) return;
    const base = state.voice.inputBase || '';
    if (listening && !finalize) {
      input.value = base ? (text ? `${base} ${text}`.trim() : base) : text;
    } else if (finalize) {
      input.value = text ? (base ? `${base} ${text}`.trim() : text) : base;
      input.focus();
      state.voice.inputBase = '';
    }
    const live = $('#voice-status-live');
    if (live && state.voice.processing) {
      live.textContent = '正在整理识别结果…';
    } else if (live && finalize && text) {
      live.textContent = '已填入输入框，请检查后点「发送」';
    }
  },
  onFinalTranscript: (text) => {
    if (state.route !== 'practice') return;
    if (!state.practice.sessionId || state.practice.status === 'completed') return;
    const cleaned = String(text || '').trim();
    if (!cleaned) return;
    if (state.voice.autoSend && !state.practice.busy) {
      const now = Date.now();
      if (cleaned === voiceLastText && now - voiceLastSentAt < 2500) return;
      voiceLastText = cleaned;
      voiceLastSentAt = now;
      sendPracticeTurn(cleaned, { fromVoice: true });
    }
  },
  onStatus: (payload) => {
    Object.assign(state.voice, {
      enabled: !!payload.enabled,
      listening: !!payload.listening,
      speaking: !!payload.speaking,
      processing: !!payload.processing,
      configured: !!payload.configured,
      speechRecognition: !!payload.speechRecognition,
      interim: payload.interim || '',
      draft: payload.draft || '',
      error: payload.error || '',
      talkingHeadError: payload.talkingHeadError || '',
    });
    if (state.route === 'practice') {
      if (!payload.speaking) digitalHumanCtrl.setSpeaking(false);
      const el = $('#voice-status-live');
      if (el && !state.voice.processing) el.textContent = voiceStatusText();
      const toggle = $('#voice-toggle');
      if (toggle) toggle.checked = state.voice.enabled;
      const micBtn = $('#voice-mic-btn');
      if (micBtn) {
        const busyMic = state.voice.speaking || state.voice.processing;
        micBtn.textContent = state.voice.listening ? '停止说话' : '开始说话';
        micBtn.classList.toggle('is-hot', state.voice.listening);
        micBtn.disabled = !state.voice.enabled || busyMic;
      }
      const pauseBtn = $('#voice-pause-btn');
      if (pauseBtn) {
        pauseBtn.disabled = !state.voice.speaking;
        pauseBtn.hidden = !state.voice.enabled;
      }
      const draftHint = $('#voice-draft-hint');
      if (draftHint) {
        const bits = [state.voice.draft, state.voice.interim].filter(Boolean).join(' ');
        draftHint.textContent = bits ? `实时识别：${bits}` : '';
        draftHint.hidden = !bits && !state.voice.listening;
      }
    }
  },
});

function voiceStatusText() {
  const v = state.voice;
  if (v.error) return v.error;
  if (v.talkingHeadError) return `${v.talkingHeadError}（已播放语音）`;
  if (!v.enabled) return '语音已关闭 · 下方可打字发送';
  if (v.processing) return '正在整理识别结果…';
  if (v.speaking) return '受试者正在说话…';
  if (v.listening) {
    return v.interim
      ? `正在听… ${v.interim}（实时显示在输入框）`
      : '正在听你说…说完点「停止说话」，文字会自动填入';
  }
  if (!v.speechRecognition) return '浏览器不支持语音识别，请用 Chrome/Edge，或直接打字';
  if (!v.configured) return '旁白未配置，仍可用「开始说话」输入';
  return '语音已开 · 点「开始说话」→ 说完点「停止说话」→ 检查输入框后发送';
}

function patientSpeakHooks() {
  const personaId = state.practice.persona?.persona_id
    || state.selectedPersonaId
    || '';
  const affect = state.practice.patientAffect || {};
  return {
    personaId,
    emotion: affect.tts_emotion || '',
    onGenerating: ({ message }) => {
      digitalHumanCtrl.setThinking(true);
      digitalHumanCtrl.setStatusHint(message || '正在准备受试者语音…');
    },
    onVideo: (url) => {
      digitalHumanCtrl.setThinking(false);
      digitalHumanCtrl.setStatusHint('');
      return digitalHumanCtrl.playTalkingVideo(url);
    },
    onAudio: (audio) => {
      digitalHumanCtrl.setThinking(false);
      digitalHumanCtrl.setStatusHint('');
      digitalHumanCtrl.attachAudio(audio);
    },
    onEnd: () => {
      digitalHumanCtrl.stopTalkingVideo();
      digitalHumanCtrl.detachAudio();
      digitalHumanCtrl.setThinking(false);
      digitalHumanCtrl.setStatusHint('');
    },
  };
}

async function speakLatestPatient() {
  if (!state.digitalHuman.enabled && !state.voice.enabled) return;
  if (typeof voiceCtrl.speakPatientNarration !== 'function') {
    console.warn('voice.js 版本过旧，请强制刷新页面（Ctrl+Shift+R）');
    return;
  }
  const msgs = state.practice.messages || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'patient' && msgs[i].content) {
      const text = stripPatientMarkdown(msgs[i].content);
      if (!text) continue;
      digitalHumanCtrl.setSubtitle(text);
      digitalHumanCtrl.setThinking(false);
      await voiceCtrl.speakPatientNarration(text, patientSpeakHooks());
      break;
    }
  }
}

function galSpeakerLabel(role, personaLabelText) {
  if (role === 'trainee') return '你（研究者）';
  if (role === 'system') return '场景说明';
  return personaLabelText || '受试者';
}

function stripPatientMarkdown(text) {
  if (!text) return '';
  let t = String(text);
  for (let i = 0; i < 3; i += 1) {
    t = t
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }
  return t
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}

function buildGalDialogFeed(messages, personaLabelText, busy) {
  const visible = (messages || []).filter((m) => m.role !== 'system');
  const lines = visible.map((m) => `
    <div class="gal-line role-${m.role}${m._optimistic ? ' is-pending' : ''}">
      <span class="gal-line-name">${escapeHtml(galSpeakerLabel(m.role, personaLabelText))}${m._optimistic ? ' · 已发送' : ''}</span>
      <p class="gal-line-text">${escapeHtml(stripPatientMarkdown(m.content || (m.role === 'patient' ? '（受试者未回应，请重试）' : '')))}</p>
    </div>
  `).join('');
  const typing = busy ? `
    <div class="gal-line role-system is-typing">
      <span class="gal-line-name">${escapeHtml(personaLabelText || '受试者')}</span>
      <p class="gal-line-text gal-line-typing">正在回复…</p>
    </div>
  ` : '';
  return lines + typing;
}

function formatText(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function getLay(id) {
  return state.standardsLay?.[id] || null;
}

function getRubricLay(id) {
  return state.rubricLay?.[id] || null;
}

async function fetchJson(path) {
  const url = `${path}?v=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} JSON 解析失败: ${err.message}`);
  }
}

async function fetchApi(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.startsWith('Internal') ? '服务器内部错误，请稍后重试' : (text.slice(0, 120) || `HTTP ${res.status}`));
  }
  if (res.status === 401) {
    if (state.auth.token) {
      clearAuth();
      state.auth.error = '登录已过期，请重新登录';
    }
    if (AUTH_ROUTES.has(state.route)) {
      navigate('auth');
    }
  }
  return { res, data };
}

function saveAuth(token, user) {
  state.auth.token = token;
  state.auth.user = user;
  state.auth.error = '';
  sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  renderUserBar();
  renderNav();
}

function clearAuth() {
  state.auth.token = '';
  state.auth.user = null;
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
  resetPracticeClientState();
  renderUserBar();
}

function isAuthenticated() {
  return !!(state.auth.token && state.auth.user);
}

async function restoreAuth() {
  if (!state.auth.token) return;
  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/auth/me`);
    if (res.ok && data.authenticated && data.user) {
      state.auth.user = data.user;
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    } else {
      clearAuth();
    }
  } catch {
    /* keep cached user if offline */
  }
  renderUserBar();
}

async function submitAuthForm(mode) {
  const username = $('#auth-username')?.value?.trim();
  const password = $('#auth-password')?.value || '';
  const displayName = $('#auth-display-name')?.value?.trim();
  if (!username || !password) {
    state.auth.error = '请填写用户名和密码';
    renderAuth();
    return;
  }
  state.auth.loading = true;
  state.auth.error = '';
  renderAuth();
  try {
    const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const body = mode === 'register'
      ? { username, password, display_name: displayName || undefined }
      : { username, password };
    const { res, data } = await fetchApi(`${API_BASE}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
    resetPracticeClientState();
    saveAuth(data.token, data.user);
    navigate(isAdminUser(data.user) ? 'admin' : 'practice');
  } catch (err) {
    let msg = String(err.message || err);
    if (/用户名或密码错误|401/.test(msg)) {
      msg = '用户名或密码错误。管理端请用 admin / Admin2026（可点下方「管理端 · admin」一键填入）';
    }
    state.auth.error = msg;
  } finally {
    state.auth.loading = false;
    if (state.route === 'auth') renderAuth();
  }
}

function renderUserBar() {
  const el = $('#user-bar');
  if (!el) return;
  if (!isAuthenticated()) {
    el.innerHTML = `
      <button type="button" class="user-bar-btn" id="user-login-btn">登录 / 注册</button>
    `;
    $('#user-login-btn')?.addEventListener('click', () => navigate('auth'));
    return;
  }
  const u = state.auth.user;
  const roleTag = isAdminUser(u) ? '<span class="user-bar-role">管理员</span>' : '';
  el.innerHTML = `
    <div class="user-bar-profile">
      <span class="user-bar-avatar">${escapeHtml((u.display_name || u.username || '?').slice(0, 1))}</span>
      <div class="user-bar-text">
        <strong>${escapeHtml(u.display_name || u.username)} ${roleTag}</strong>
        <small>@${escapeHtml(u.username)}</small>
      </div>
    </div>
    <button type="button" class="user-bar-logout" id="user-logout-btn">退出</button>
  `;
  $('#user-logout-btn')?.addEventListener('click', () => {
    clearAuth();
    renderNav();
    if (AUTH_ROUTES.has(state.route) || state.route === 'explain') navigate('auth');
    else renderUserBar();
  });
}

function renderAuth() {
  setPage('登录 / 注册', '登录后可保存个人练习记录与反馈');
  const mode = state.auth.mode || 'login';
  viewEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <h3>研究者账号</h3>
        <p class="auth-sub">注册或登录后，你的模拟对话与练习反馈将<strong>仅自己可见</strong>。</p>
        <div class="auth-tabs">
          <button type="button" class="auth-tab ${mode === 'login' ? 'active' : ''}" data-auth-mode="login">登录</button>
          <button type="button" class="auth-tab ${mode === 'register' ? 'active' : ''}" data-auth-mode="register">注册</button>
        </div>
        <form class="auth-form" id="auth-form">
          <label>用户名
            <input id="auth-username" type="text" autocomplete="username" placeholder="例如 admin 或 history" required />
          </label>
          ${mode === 'register' ? `
            <label>显示名称（可选）
              <input id="auth-display-name" type="text" autocomplete="name" placeholder="如：张医生" />
            </label>
          ` : ''}
          <label>密码
            <input id="auth-password" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder="至少 6 位" required />
          </label>
          ${state.auth.error ? `<div class="action-toast">${escapeHtml(state.auth.error)}</div>` : ''}
          <button type="submit" class="auth-submit" ${state.auth.loading ? 'disabled' : ''}>
            ${state.auth.loading ? '处理中…' : (mode === 'register' ? '注册并进入练习' : '登录')}
          </button>
        </form>
        ${mode === 'login' ? `
          <div class="auth-quick">
            <span class="auth-quick-label">演示账号（点一下填入）</span>
            <div class="auth-quick-row">
              <button type="button" class="auth-quick-btn" data-fill-user="admin" data-fill-pass="Admin2026">管理端 · admin</button>
              <button type="button" class="auth-quick-btn" data-fill-user="history" data-fill-pass="History2026">学员 · history</button>
            </div>
          </div>
        ` : ''}
        <p class="auth-foot">无需登录也可浏览使用手册与病例资料。系统功能在管理端。</p>
        <button type="button" class="auth-back-link" id="auth-back-link">← 返回使用手册</button>
      </div>
    </div>
  `;
  viewEl.querySelectorAll('[data-auth-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.auth.mode = btn.dataset.authMode;
      state.auth.error = '';
      renderAuth();
    });
  });
  viewEl.querySelectorAll('[data-fill-user]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = $('#auth-username');
      const p = $('#auth-password');
      if (u) u.value = btn.dataset.fillUser || '';
      if (p) p.value = btn.dataset.fillPass || '';
      state.auth.error = '';
    });
  });
  $('#auth-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuthForm(mode);
  });
  $('#auth-back-link')?.addEventListener('click', () => {
    if (state.navStack.length) goBack();
    else navigate('guide', null, { skipHistory: true, replace: true });
  });
}

async function loadData() {
  const [standards, rubric, rubricFollowup, terms, scenes, guide, standardsLay, rubricLay, casesIndex, coverageHints] = await Promise.all([
    fetchJson('./data/standards-registry.json'),
    fetchJson('./data/scoring-rubric.json'),
    fetchJson('./data/scoring-rubric-followup.json'),
    fetchJson('./data/terminology.json'),
    fetchJson('./data/scenes.json'),
    fetchJson('./data/project-guide.json'),
    fetchJson('./data/standards-layperson.json'),
    fetchJson('./data/rubric-layperson.json'),
    fetchJson('./data/cases-index.json'),
    fetchJson('./data/coverage-hints.json'),
  ]);
  state.standards = standards;
  state.rubric = rubric;
  state.rubricFollowup = rubricFollowup;
  state.terms = terms;
  state.scenes = scenes;
  state.guide = guide;
  state.standardsLay = standardsLay;
  state.rubricLay = rubricLay;
  state.coverageHints = coverageHints;
  state.casesIndex = casesIndex;

  state.casePackages = {};
  const packageFiles = new Map();
  const hierarchy = normalizeCasesHierarchy(casesIndex);
  hierarchy.forEach((disease) => {
    (disease.cases || []).forEach((c) => {
      (c.personas || []).forEach((p) => {
        if (p.file) packageFiles.set(p.file, c.case_id);
      });
      if (c.file) packageFiles.set(c.file, c.case_id);
    });
  });
  (casesIndex.cases || []).forEach((c) => {
    if (c.file) packageFiles.set(c.file, c.case_id);
  });
  await Promise.all(
    [...new Set([...packageFiles.keys()])].map(async (file) => {
      const pkg = await fetchJson(`./data/${file}`);
      const id = pkg.meta?.case_id;
      if (id) state.casePackages[id] = pkg;
    }),
  );

  state.defaultCaseId = casesIndex.meta.default_case_id
    || casesIndex.cases.find((c) => c.is_default)?.case_id
    || casesIndex.cases[0]?.case_id;
  state.selectedCaseId = null;
  state.selectedPersonaId = null;
  state.selectedDiseaseCode = null;
  state.casePackage = null;
  state.caseNavLevel = 'library';
  state.casesTreeExpanded = {};

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
  const routes = isAdminUser(state.auth.user)
    ? [...STUDENT_ROUTES, ...ADMIN_NAV]
    : STUDENT_ROUTES;
  renderNavButtons(routes, $('#nav'));
}

function setPage(title, desc) {
  const allRoutes = [...STUDENT_ROUTES, ...ADMIN_NAV];
  const route = allRoutes.find((r) => r.id === state.route);
  $('#page-eyebrow').textContent = route?.eyebrow || 'Standard Registry';
  $('#page-title').textContent = title;
  $('#page-desc').textContent = desc;
}

function parseHash() {
  const raw = location.hash.replace('#', '').trim();
  if (!raw) return { route: 'guide', section: null };
  if (raw === 'admin') return { route: 'admin', section: null };
  if (raw === 'explain') return { route: 'explain', section: 'overview' };
  if (LEGACY_TO_EXPLAIN[raw]) return { route: 'explain', section: LEGACY_TO_EXPLAIN[raw] };
  if (raw.startsWith('explain-')) {
    const section = raw.slice(8);
    if (EXPLAIN_SECTIONS.some((s) => s.id === section)) {
      return { route: 'explain', section };
    }
    return { route: 'explain', section: 'overview' };
  }
  if (STUDENT_ROUTES.some((r) => r.id === raw) || ADMIN_NAV.some((r) => r.id === raw)) {
    return { route: raw, section: null };
  }
  if (raw === 'auth') return { route: 'auth', section: null };
  return { route: 'guide', section: null };
}

let navFromHash = false;

function navEntryLabel(entry) {
  if (!entry) return '使用手册';
  if (entry.route === 'explain') {
    const sec = EXPLAIN_SECTIONS.find((s) => s.id === entry.section);
    return sec ? `系统功能 · ${sec.label}` : '系统功能';
  }
  return ROUTES.find((r) => r.id === entry.route)?.label || '上一页';
}

function renderPageBackBar() {
  const prev = state.navStack[state.navStack.length - 1];
  const label = navEntryLabel(prev);
  return `
    <div class="page-back-bar">
      <button type="button" class="page-back-btn" id="page-back-btn">← 返回${label !== '上一页' ? `：${label}` : ''}</button>
    </div>`;
}

function bindPageBackBar(fallbackRoute = 'guide') {
  $('#page-back-btn')?.addEventListener('click', () => {
    if (state.navStack.length) goBack();
    else navigate(fallbackRoute, null, { skipHistory: true, replace: true });
  });
}

function goBack() {
  const prev = state.navStack.pop();
  if (prev) {
    navigate(prev.route, prev.section, { fromBack: true, skipHistory: true, replace: true });
  } else {
    navigate('guide', null, { skipHistory: true, replace: true });
  }
}

function navigate(route, section = null, opts = {}) {
  const { replace = false, fromBack = false, skipHistory = false } = opts;
  if (LEGACY_TO_EXPLAIN[route]) {
    section = LEGACY_TO_EXPLAIN[route];
    route = 'explain';
  }
  if (AUTH_ROUTES.has(route) && !isAuthenticated()) {
    state.auth.error = '';
    route = 'auth';
    section = null;
  }
  // 管理端 / 系统功能仅管理员
  if ((route === 'admin' || route === 'explain') && !isAdminUser(state.auth.user)) {
    if (!isAuthenticated()) {
      state.auth.error = '请先登录管理员账号';
      route = 'auth';
    } else {
      state.auth.error = '';
      route = 'guide';
    }
    section = null;
  }
  if (route === 'explain' && !section) {
    section = state.explainSection || 'overview';
  }
  const prevRoute = state.route;
  const prevSection = state.explainSection;
  // 离开练习页前先把数字人壳挪走，避免被 viewEl.innerHTML 一并拆掉导致回来换脸
  if (prevRoute === 'practice' && route !== 'practice' && state.practice.sessionId) {
    digitalHumanCtrl.parkShell();
  }
  const routeChanging = route !== prevRoute
    || (route === 'explain' && (section || prevSection) !== prevSection);
  if (!fromBack && !skipHistory && !navFromHash && routeChanging) {
    const explainInternal = prevRoute === 'explain' && route === 'explain';
    if (!explainInternal) {
      state.navStack.push({ route: prevRoute, section: prevSection });
      if (state.navStack.length > 24) state.navStack.shift();
    }
  }
  state.route = route;
  state.explainSection = section || state.explainSection || 'overview';
  renderNav();
  renderView();
  const nextHash = route === 'explain' ? `explain-${state.explainSection}` : route;
  if (location.hash.replace('#', '') !== nextHash) {
    location.hash = nextHash;
  }
  if (route === 'explain' && state.explainSection === 'database') loadDatabasePage();
  if (route === 'feedback') loadFeedbackPage();
  if (route === 'practice') loadPracticePage();
  if (route === 'records') loadRecordsPage();
  if (route === 'admin') adminCtrl.loadAll().then(() => {
    if (state.route === 'admin') renderView();
  }).catch(() => {});
}

function switchExplainSection(id) {
  if (!EXPLAIN_SECTIONS.some((s) => s.id === id)) return;
  navigate('explain', id);
  $('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(html, opts = {}) {
  modalBody.innerHTML = html;
  modal.querySelector('.modal-panel')?.classList.toggle('case-modal-wide', !!opts.wide);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.querySelector('.modal-panel')?.classList.remove('case-modal-wide');
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

function trustHumanLabel(trust) {
  const n = Number(trust);
  if (Number.isNaN(n)) return '尚未感知';
  if (n >= 75) return '比较放心，愿意多听';
  if (n >= 58) return '还在观望，需要您多解释';
  if (n >= 40) return '有点担心，回答宜更具体';
  if (n >= 25) return '不太信任，先别急着推进';
  return '几乎不想继续聊，先安抚再讲';
}

const STANCE_LABEL_MAP = {
  cooperative: '愿意配合',
  guarded: '有点担心',
  defensive: '有点抵触',
  withdrawn: '不太想多说',
  relieved: '放松了一些',
};

const DEPTH_LABEL_MAP = {
  0: '基本不说实话',
  1: '说得比较笼统',
  2: '开始暗示一些情况',
  3: '愿意讲具体细节',
};

const STANCE_MOOD_ICON = {
  cooperative: '🙂',
  guarded: '😟',
  defensive: '😠',
  withdrawn: '😶',
  relieved: '😌',
};

function inferStanceFromPatientText(text) {
  const t = text || '';
  if (/不算|骗人|忽悠|不行|别讲|不愿意|不想签|胡说/.test(t)) return { stance: 'defensive', label: '有点抵触' };
  if (/算了|不想说|随便|没什么好|懒得/.test(t)) return { stance: 'withdrawn', label: '不太想多说' };
  if (/谢谢|明白|好的|可以|放心|清楚了|那就/.test(t)) return { stance: 'cooperative', label: '愿意配合' };
  if (/轻松|踏实|好多了|这样啊|原来如此/.test(t)) return { stance: 'relieved', label: '放松了一些' };
  if (/担心|害怕|副作用|不懂|不明白|怎么办|严不严重|有点怕|恶心|吐|腹泻/.test(t)) return { stance: 'guarded', label: '有点担心' };
  return { stance: 'guarded', label: '还在观望' };
}

function inferDepthFromPatientText(text) {
  const t = text || '';
  if (t.length >= 80 || /具体|比如|上次|之前|医生|药/.test(t)) return DEPTH_LABEL_MAP[3];
  if (t.length >= 40 || /好像|可能|有点|大概/.test(t)) return DEPTH_LABEL_MAP[2];
  if (t.length >= 12) return DEPTH_LABEL_MAP[1];
  return DEPTH_LABEL_MAP[0];
}

function inferTrustFromPatientText(text, stance) {
  let trust = 52;
  if (/谢谢|明白|好的|可以|放心/.test(text)) trust += 12;
  if (/担心|害怕|不懂|怎么办/.test(text)) trust -= 10;
  if (/骗人|不行|不算|不想/.test(text)) trust -= 18;
  if (stance === 'cooperative') trust += 8;
  if (stance === 'defensive') trust -= 15;
  if (stance === 'withdrawn') trust -= 12;
  if (stance === 'relieved') trust += 10;
  return Math.max(0, Math.min(100, trust));
}

function affectReactionHint(affect, lastText) {
  const stance = affect.stance || '';
  const t = lastText || '';
  if (stance === 'defensive' || /什么意思|骗人|忽悠/.test(t)) return '可能对您的说法有抵触，宜先正面回应顾虑';
  if (stance === 'guarded' || /担心|副作用|怎么办|严不严重/.test(t)) return '正在顾虑风险或疗效，需要更具体、诚实的说明';
  if (stance === 'withdrawn') return '不太想继续深入，建议放慢节奏、先倾听';
  if (stance === 'cooperative') return '愿意继续听您讲，可按检查点逐项说明';
  if (stance === 'relieved') return '紧张感有所缓解，可顺势补充关键信息';
  if (!t) return '发送话术后，会根据受试者回复更新';
  return '继续观察受试者下一句话的反应';
}

function inferAffectFromDialogue(patientAffect, messages) {
  const affect = { ...(patientAffect || {}) };
  const patientMsgs = (messages || []).filter((m) => m.role === 'patient');
  const lastPatient = patientMsgs[patientMsgs.length - 1];
  const lastText = stripPatientMarkdown(lastPatient?.content || '');

  if (!affect.stance_label && affect.stance) {
    affect.stance_label = STANCE_LABEL_MAP[affect.stance] || affect.stance;
  }
  if (!affect.stance && lastText) {
    const inferred = inferStanceFromPatientText(lastText);
    affect.stance = inferred.stance;
    affect.stance_label = inferred.label;
    affect._inferred = true;
  } else if (!affect.stance_label && lastText) {
    affect.stance_label = inferStanceFromPatientText(lastText).label;
  }
  if (!affect.stance_label) {
    affect.stance_label = patientMsgs.length ? '还在观望' : '等待您先开口';
  }

  if (!affect.depth_label && affect.disclosure_depth != null) {
    affect.depth_label = DEPTH_LABEL_MAP[affect.disclosure_depth] || '—';
  }
  if (!affect.depth_label && lastText) {
    affect.depth_label = inferDepthFromPatientText(lastText);
  }
  if (!affect.depth_label) {
    affect.depth_label = patientMsgs.length ? '说得比较笼统' : '—';
  }

  if (affect.trust == null && lastText) {
    affect.trust = inferTrustFromPatientText(lastText, affect.stance);
  } else if (affect.trust == null && patientMsgs.length) {
    affect.trust = 52;
  }

  affect._lastPatientSnippet = lastText
    ? (lastText.length > 56 ? `${lastText.slice(0, 56)}…` : lastText)
    : '';
  affect._hint = affectReactionHint(affect, lastText);
  affect._moodIcon = STANCE_MOOD_ICON[affect.stance] || '💬';
  return affect;
}

function resolvePracticeAffect(patientAffect, messages, { busy = false } = {}) {
  const affect = inferAffectFromDialogue(patientAffect, messages);
  if (busy) {
    affect._status = '受试者正在想怎么回答…';
  } else if (affect._lastPatientSnippet) {
    affect._status = `刚说：「${affect._lastPatientSnippet}」`;
  } else {
    affect._status = '您开口后，这里会显示受试者的心情与信任变化';
  }
  return affect;
}

function buildCoverageProgressHtml(messages, { compact = false } = {}) {
  const checkpoints = inferCheckpointsFromMessages(messages);
  const done = checkpoints.filter((s) => s.status === 'done').length;
  const total = checkpoints.length || 1;
  const pct = Math.round((100 * done) / total);
  if (compact) {
    return `
      <div class="coverage-chip" id="coverage-chip" title="沟通达标率（练习参考，最终以结束反馈为准）">
        <span class="coverage-chip-label">沟通达标</span>
        <span class="coverage-chip-pct">${pct}%</span>
        <span class="coverage-chip-track" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="coverage-chip-count">${done}/${checkpoints.length}</span>
      </div>`;
  }
  return `
    <div class="live-rail-coverage" id="live-rail-coverage">
      <div class="live-rail-trust-head">
        <span class="live-rail-label">沟通达标率</span>
        <span class="live-rail-pct">${pct}% · ${done}/${checkpoints.length}</span>
      </div>
      <div class="checkpoint-progress-track" aria-hidden="true">
        <div class="checkpoint-progress-fill" style="width:${pct}%"></div>
      </div>
      <p class="live-rail-progress-note">随对话更新 · 点「沟通检查点」看明细</p>
    </div>`;
}

function buildLiveFeedbackRailHtml(messages, patientAffect, opts = {}) {
  const busy = !!opts.busy;
  const affect = resolvePracticeAffect(patientAffect, messages, { busy });
  const trust = affect.trust;
  const trustPct = trust != null ? Math.max(0, Math.min(100, Number(trust))) : 0;

  return `
    <aside class="practice-live-rail" id="practice-live-rail" aria-label="受试者状态">
      <div class="live-rail-panel">
        <div class="live-rail-head">
          <strong>受试者状态</strong>
          <span class="live-rail-tag">随对话更新</span>
        </div>

        <div class="live-rail-mood-card ${busy ? 'is-busy' : ''}">
          <span class="live-rail-mood-icon" aria-hidden="true">${affect._moodIcon}</span>
          <div class="live-rail-mood-body">
            <span class="live-rail-label">当前心情</span>
            <strong class="live-rail-mood-value">${escapeHtml(busy ? '正在想怎么回答…' : affect.stance_label)}</strong>
            <p class="live-rail-mood-hint">${escapeHtml(busy ? '请稍候，受试者回复后会更新' : affect._hint)}</p>
          </div>
        </div>

        <div class="live-rail-row live-rail-row--depth">
          <span class="live-rail-label">说到哪一步</span>
          <span class="live-rail-value">${escapeHtml(busy ? '—' : affect.depth_label)}</span>
        </div>

        ${trust != null ? `
        <div class="live-rail-trust">
          <div class="live-rail-trust-head">
            <span class="live-rail-label">信任感</span>
            <span class="live-rail-trust-val">${trustHumanLabel(trust)} · ${trustPct}/100</span>
          </div>
          <div class="live-rail-trust-track" aria-hidden="true">
            <div class="live-rail-trust-fill" style="width:${trustPct}%"></div>
          </div>
        </div>` : ''}

        ${buildCoverageProgressHtml(messages)}

        ${affect._lastPatientSnippet && !busy ? `
          <blockquote class="live-rail-quote">${escapeHtml(affect._status)}</blockquote>` : ''}
      </div>
    </aside>`;
}

function buildGalVoiceActionsInnerHtml() {
  const v = state.voice;
  return `
    <label class="gal-voice-switch" title="开/关语音模拟">
      <input type="checkbox" id="voice-toggle" ${v.enabled ? 'checked' : ''} />
      <span class="gal-voice-switch-ui" aria-hidden="true"></span>
      <span class="gal-voice-switch-text">语音</span>
    </label>
    ${v.enabled ? `
      <button type="button" class="gal-action-btn gal-action-btn--ghost ${v.listening ? 'is-hot' : ''}" id="voice-mic-btn" ${(v.speaking || v.processing) ? 'disabled' : ''}>
        ${v.listening ? '停止说话' : '开始说话'}
      </button>
      <button type="button" class="gal-action-btn gal-action-btn--ghost" id="voice-pause-btn" ${v.speaking ? '' : 'disabled'}>暂停</button>
    ` : ''}`;
}

function bindGalVoiceMicPause() {
  $('#voice-mic-btn')?.addEventListener('click', () => {
    if (state.voice.listening) {
      voiceCtrl.stopListening({ commit: true });
    } else {
      const input = $('#chat-input');
      state.voice.inputBase = (input?.value || '').trim();
      voiceCtrl.startListening();
    }
  });
  $('#voice-pause-btn')?.addEventListener('click', () => {
    voiceCtrl.stopPlayback();
  });
}

function bindGalVoiceControls() {
  const toggle = $('#voice-toggle');
  if (toggle) {
    toggle.onchange = async (e) => {
      await voiceCtrl.setEnabled(e.target.checked);
      if (state.route === 'practice' && state.practice.sessionId) {
        patchGalVoiceActions();
        const statusEl = $('#voice-status-live');
        if (statusEl) statusEl.textContent = voiceStatusText();
      } else if (state.route === 'practice') {
        renderPractice();
      }
    };
  }
  bindGalVoiceMicPause();
}

function patchGalVoiceActions() {
  const slot = document.querySelector('.gal-voice-actions');
  if (!slot) return;
  slot.innerHTML = buildGalVoiceActionsInnerHtml();
  bindGalVoiceMicPause();
  const toggle = $('#voice-toggle');
  if (toggle) {
    toggle.onchange = async (e) => {
      await voiceCtrl.setEnabled(e.target.checked);
      patchGalVoiceActions();
      const statusEl = $('#voice-status-live');
      if (statusEl) statusEl.textContent = voiceStatusText();
    };
  }
}

function updateCheckpointFlash(messages) {
  const checkpoints = inferCheckpointsFromMessages(messages);
  const done = checkpoints.filter((s) => s.status === 'done').length;
  const prev = state.practice.lastCheckpointDone;
  if (prev != null && done > prev) {
    state.practice.checkpointFlash = `本轮可能新覆盖 ${done - prev} 项检查点`;
  } else if (prev == null && done > 0) {
    state.practice.checkpointFlash = '';
  }
  state.practice.lastCheckpointDone = done;
}

function bindLiveRailEvents() {
  /* 受试者状态面板当前无交互控件；保留钩子供后续扩展 */
}

function patchCheckpointRail() {
  const open = !!state.practice.checkpointOpen;
  const engagement = state.engagementMode || 'practice';
  document.querySelector('.practice-gal-wrap')?.classList.toggle('is-checkpoint-open', open);
  const btn = $('#practice-checkpoint-toggle');
  if (btn) {
    btn.textContent = open ? '收起检查点' : '沟通检查点';
    btn.classList.toggle('is-active', open);
  }
  let rail = $('#practice-checkpoint-drawer');
  if (!open) {
    rail?.remove();
    return;
  }
  if (engagement !== 'practice') return;
  const html = `
    <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
      ${buildCheckpointPanelHtml(state.practice.messages, { engagement })}
    </aside>`;
  if (rail) {
    rail.outerHTML = html;
  } else {
    const mount = $('#digital-human-mount');
    mount?.insertAdjacentHTML('afterend', html);
  }
}

function patchFeedExpanded() {
  const expanded = !!state.practice.feedExpanded;
  const feed = $('#chat-panel');
  feed?.classList.toggle('is-expanded', expanded);
  const btn = $('#practice-feed-expand');
  if (btn) btn.textContent = expanded ? '收起对话框' : '展开全部对话';
  const glass = document.querySelector('.gal-dialog-glass');
  if (glass) glass.classList.toggle('is-feed-expanded', expanded);
}

function buildGuideUiMockPractice() {
  return `
    <div class="guide-ui-mock guide-ui-mock--practice" aria-hidden="true">
      <div class="guide-ui-mock-bar">
        <span class="guide-ui-pill">← 返回</span>
        <span class="guide-ui-pill ok">张大爷</span>
        <span class="guide-ui-pill ok">练习</span>
      </div>
      <div class="guide-ui-mock-body">
        <div class="guide-ui-live-box">
          <strong>实时沟通反馈</strong>
          <p>心情：愿意配合</p>
          <p>信任：还在观望</p>
          <div class="guide-ui-bar"><span style="width:62%"></span></div>
        </div>
        <div class="guide-ui-avatar">受试者形象</div>
        <div class="guide-ui-check-box">
          <strong>沟通检查点</strong>
          <p>点按钮展开完整 13 项</p>
        </div>
      </div>
      <div class="guide-ui-chat">对话输入区 · 发送 / 结束练习</div>
    </div>`;
}

function buildGuideUiMockFeedback() {
  return `
    <div class="guide-ui-mock guide-ui-mock--feedback" aria-hidden="true">
      <div class="guide-ui-tabs">
        <span class="active">总览</span><span>维度</span><span>建议</span><span>明细</span><span>对话</span>
      </div>
      <div class="guide-ui-viz-row">
        <div class="guide-ui-ring">57<small>/100</small></div>
        <div class="guide-ui-radar">雷达图</div>
      </div>
      <p class="guide-ui-note">环形总分 + 雷达维度 + 圆环占比</p>
    </div>`;
}

function renderGuide() {
  const g = state.guide;
  const theme = g.theme || {};
  const icCheckpoints = buildCheckpointDefsForScene('informed_consent');
  const fuCheckpoints = buildCheckpointDefsForScene('follow_up');

  setPage('使用手册', '先看清练完要达成什么，再进入模拟练习');

  viewEl.innerHTML = `
    <div class="guide-hero manual-hero guide-theme-hero">
      <p class="hero-eyebrow">Clinical Trial Communication Simulator</p>
      <h3>${escapeHtml(theme.headline || g.title)}</h3>
      <p>${escapeHtml(theme.subline || '')}</p>
    </div>

    <section class="guide-section guide-goal-section">
      <h3><span class="guide-num">★</span>${escapeHtml(theme.goalTitle || '练完要达成什么')}</h3>
      <ul class="guide-list guide-goal-list">
        ${(theme.goals || []).map((p) => `<li>${formatText(p)}</li>`).join('')}
      </ul>
      <div class="guide-mode-cards">
        ${(theme.modes || []).map((m) => `
          <div class="guide-mode-card">
            <strong>${escapeHtml(m.label)}</strong>
            <p>${escapeHtml(m.desc)}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="guide-section guide-checkpoint-section">
      <h3><span class="guide-num">①</span>${escapeHtml(g.checkpointIntro?.title || '沟通检查点')}</h3>
      <p>${formatText(g.checkpointIntro?.content || '')}</p>
      <div class="guide-checkpoint-tabs">
        <div class="guide-checkpoint-col">
          <h4>知情同意 · ${icCheckpoints.length} 项</h4>
          <ol class="guide-checkpoint-list">
            ${icCheckpoints.map((c, i) => `
              <li><span class="guide-cp-num">${i + 1}</span>
                <div><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.hint)}</span></div>
              </li>`).join('')}
          </ol>
        </div>
        <div class="guide-checkpoint-col">
          <h4>随访沟通 · ${fuCheckpoints.length} 项（+2 红线）</h4>
          <ol class="guide-checkpoint-list">
            ${fuCheckpoints.map((c, i) => `
              <li><span class="guide-cp-num">${i + 1}</span>
                <div><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.hint)}</span></div>
              </li>`).join('')}
          </ol>
        </div>
      </div>
    </section>

    <section class="guide-section guide-figures-section">
      <h3><span class="guide-num">②</span>界面长什么样？（示意 · 非截图）</h3>
      <p>为避免旧截图与当前界面不一致，下面用<strong>示意图</strong>标注各区域作用。强刷页面后应以实际界面为准。</p>
      <div class="guide-figure-grid">
        <figure class="guide-figure">
          ${buildGuideUiMockPractice()}
          <figcaption><strong>模拟对话（练习模式）</strong> · 左上<strong>实时沟通反馈</strong>（心情、信任、进度）；中间受试者形象；右上可展开完整检查点；下方输入对话。</figcaption>
        </figure>
        <figure class="guide-figure">
          ${buildGuideUiMockFeedback()}
          <figcaption><strong>练习反馈</strong> · 总览用<strong>环形图</strong>看总分、<strong>圆环</strong>看检查项占比；维度页有<strong>雷达图</strong>和各维度<strong>环形卡片</strong>。</figcaption>
        </figure>
      </div>
      <ol class="guide-walk-list">
        <li><strong>使用手册</strong> → 看清目标和检查点</li>
        <li><strong>模拟对话</strong> → 选张大爷 → 开始练习 → 看左侧实时反馈调整话术</li>
        <li><strong>结束练习</strong> → <strong>练习反馈</strong> 查看分项建议</li>
      </ol>
    </section>

    <section class="guide-section guide-script-section">
      <h3><span class="guide-num">③</span>示范话术：怎么练出场景设计</h3>
      <p>完整版见 <code>PRD2.0/07-示范话术.md</code>。下面两段可直接复制改着说。</p>
      <div class="guide-script-cards">
        <div class="guide-script-card">
          <strong>张大爷 · 被问「能不能中途不参加」</strong>
          <blockquote>完全可以。这是自愿的，您随时说不参加或中途退出都可以，<em>不影响</em>您平时在这家医院看病。</blockquote>
          <p class="card-meta">→ 检查点「自愿退出」可能变绿；左侧实时反馈会显示「信任感：还在观望 → 比较放心」。</p>
        </div>
        <div class="guide-script-card">
          <strong>李建国 · 被问「耽误跑车吗」</strong>
          <blockquote>理解您时间紧。筛选大约 2 小时，入组后前 4 周每 2 周来一次，每次 1 小时内，可约您收车后的时段。</blockquote>
          <p class="card-meta">→ 命中「流程与随访」；信任升高后他才会细问风险和疗效。</p>
        </div>
      </div>
    </section>

    ${g.sections.map((sec, i) => {
      let body = sec.content ? `<p>${formatText(sec.content)}</p>` : '';
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
          <h3><span class="guide-num">${i + 4}</span>${sec.title}</h3>
          ${body}
        </section>`;
    }).join('')}
    <div class="guide-cta">
      <button type="button" data-goto="practice">开始：模拟对话练习</button>
      <button type="button" class="secondary" data-goto="explain-rubric">查看评分说明</button>
    </div>
  `;

  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      if (target.startsWith('explain-')) {
        navigate('explain', target.slice(8));
        return;
      }
      navigate(target);
    });
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
    const voiceOk = data.minimax_configured ? ' · 语音旁白已配' : '';
    setConnStatus(
      true,
      (data.agnes_configured ? '后端已连 · Agnes 已配置' : '后端已连 · 请配置 Agnes') + voiceOk,
    );
    state.voice.configured = !!data.minimax_configured;
  } catch {
    setConnStatus(false, '后端未启动（请开 :8000）');
  }
}

function buildDatabaseHtml() {
  const data = state.dbVerify;
  const busy = state.dbBusy;

  if (!data && !state.dbActionMsg) {
    return `<div class="empty"><p>正在读取数据库…</p></div>`;
  }

  if (!data) {
    return `
      <div class="empty">
        <p>暂时读不到数据库。</p>
        <p class="card-meta" style="margin-top:12px">请先启动：<code>python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000</code></p>
        <p class="card-meta">然后打开 <code>http://127.0.0.1:8000/#explain-database</code></p>
        <div class="guide-cta" style="justify-content:center">
          <button type="button" id="db-retry">重试连接</button>
        </div>
        ${state.dbActionMsg ? `<pre class="db-raw">${state.dbActionMsg}</pre>` : ''}
      </div>`;
  }

  const agnes = data.agnes || {};
  const samples = data.samples || {};

  return `
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
}

function bindDatabaseEvents() {
  $('#db-refresh')?.addEventListener('click', () => loadDatabasePage());
  $('#db-probe')?.addEventListener('click', () => runDbAction('probe'));
  $('#db-ai')?.addEventListener('click', () => runDbAction('ai'));
  $('#db-retry')?.addEventListener('click', () => loadDatabasePage());
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
    if (state.route === 'explain') renderExplain();
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
    if (state.route === 'explain') renderExplain();
  }
}

function buildOverviewHtml() {
  const stds = state.standards.standards;
  const mvpItems = state.rubric.items.filter((i) => i.enabledMvp);
  const l1 = mvpItems.filter((i) => i.layer === 'L1').length;
  const primary = stds.filter((s) => s.priority === 'primary').length;

  return `
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
          <li>标准资料库（${stds.length} 项注册）</li>
          <li>评分对照表（S1 知情同意 · ${mvpItems.length} 条 MVP）</li>
          <li>术语表（${state.terms.terms.length} 项）</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>底座 B · 病例症状事实</h4>
        <ul>
          <li>${state.casePackage ? `已入库：${state.casePackage.meta.short_title}` : '待病例资料入库'}</li>
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

function buildStandardsHtml() {
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

  return `
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">怎么读这一节</div>
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
}

function buildTimelineHtml() {
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

  return `
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
}

function typePill(type) {
  const t = TYPE_LABELS[type] || { label: type, cls: '' };
  return `<span class="pill ${t.cls}">${t.label}</span>`;
}

function buildScoringModelTable(rubric) {
  const sm = rubric?.meta?.scoringModel;
  if (!sm) return '';
  const vp = sm.verdictPoints || { pass: 1, uncertain: 0.5, fail: 0 };
  const dims = (sm.dimensions || []).filter((d) => !d.isGate);
  return `
    <div class="scoring-scene-card">
      <h4>${escapeHtml(rubric.meta.sceneLabel || rubric.meta.scene || '场景')}</h4>
      <p class="card-meta">${escapeHtml(rubric.meta.passRule || '')}</p>
      <table class="scoring-dim-table">
        <thead><tr><th>维度</th><th>权重</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td>红线</td><td>一票否决</td><td>任一红线项 fail → 综合不达标</td></tr>
          ${dims.map((d) => `<tr><td>${escapeHtml(d.name || d.id)}</td><td>${Math.round((d.weight || 0) * 100)}%</td><td>该维度内各检查项加权平均</td></tr>`).join('')}
        </tbody>
      </table>
      <p class="scoring-formula">单项得分：pass=${vp.pass} · uncertain=${vp.uncertain} · fail=${vp.fail} · 维度分=100× earned/max · 总分=各维度分×权重加权 · 达标线 ${sm.passScore || 60} 分</p>
    </div>`;
}

function buildScoringGuideHtml() {
  const sm = state.rubric?.meta?.scoringModel;
  const passScore = sm?.passScore || 60;
  return `
    <div class="scoring-guide">
      <div class="explain-box scoring-guide-hero">
        <div class="explain-box-label">练习参考分 · 0–100</div>
        <p>每次练习结束，系统会给出 <strong>练习参考分 X/100</strong>（非正式能力认证）。同时显示维度拆分、清单线是否通过，以及每条检查项的 pass / uncertain / fail。</p>
      </div>

      <div class="scoring-guide-grid">
        <div class="arch-block">
          <h4>① 清单线（硬性核对）</h4>
          <ul class="guide-list compact">
            <li><strong>L1 必达项</strong>须全部为 pass（不含 skipped）</li>
            <li><strong>红线项</strong>（IC-X / FU-X）任一 fail → 红线不通过</li>
            <li>满足以上 → 清单线达到</li>
          </ul>
        </div>
        <div class="arch-block">
          <h4>② 练习参考分（0–100）</h4>
          <ul class="guide-list compact">
            <li>每条检查项：pass=1.0 · uncertain=0.5 · fail=0.0</li>
            <li>维度分 = 100 ×（ earned / max ）</li>
            <li>总分 = 各维度得分 × 权重 的加权平均</li>
          </ul>
        </div>
        <div class="arch-block">
          <h4>③ 综合建议（页面结论）</h4>
          <ul class="guide-list compact">
            <li>红线通过</li>
            <li>练习参考分 ≥ ${passScore}</li>
            <li>清单线达到</li>
          </ul>
          <p class="card-meta">三项同时满足 →「综合建议：达标」；否则「需改进」。</p>
        </div>
      </div>

      <div class="section-head"><h3 class="section-title">等级标签</h3></div>
      <div class="tag-row">
        <span class="tag">≥85 · 优秀（练习参考）</span>
        <span class="tag">≥${passScore} · 达标（练习参考）</span>
        <span class="tag">≥40 · 需改进（练习参考）</span>
        <span class="tag">&lt;40 · 未达标（练习参考）</span>
      </div>

      <div class="section-head"><h3 class="section-title">场景与维度权重</h3></div>
      <div class="scoring-scenes">
        ${buildScoringModelTable(state.rubric)}
        ${buildScoringModelTable(state.rubricFollowup)}
      </div>

      <div class="guide-analogy">
        <strong>算分示例：</strong>某维度 3 条项权重均为 1.0，结果 2 pass + 1 uncertain → earned=2.5，max=3 → 维度分 = round(100×2.5/3) = <strong>83</strong>。总分再按上表权重加权。红线任一项 fail 时，综合建议通常为未达标。
      </div>

      <div class="guide-analogy">
        <strong>评分引擎：</strong>规则层（关键词/禁止语）+ LLM 语义层（可用时）合并判定；数值汇总由 <code>compute_numeric_scores</code> 生成。旧版反馈打开时会自动补算参考分。
      </div>
    </div>`;
}

function buildRubricHtml() {
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

  return `
    ${buildScoringGuideHtml()}
    <div class="section-head" style="margin-top:28px"><h3 class="section-title">检查清单（MVP）</h3><span class="section-sub">以下为系统逐条核对的条目</span></div>
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
}

function normalizeCasesHierarchy(index) {
  if (index?.diseases?.length) return index.diseases;
  const map = {};
  (index?.cases || []).forEach((c) => {
    const code = c.disease_code || 'OTHER';
    if (!map[code]) {
      map[code] = {
        disease_code: code,
        name_zh: c.disease_name || code,
        summary: '',
        cases: [],
      };
    }
    map[code].cases.push({
      ...c,
      personas: c.personas || [{
        persona_id: c.default_persona_id || `${c.case_id}-default`,
        display_label: c.short_title || c.case_id,
        one_liner: c.one_liner || '',
        file: c.file,
        is_default: true,
        is_trainable: Boolean(c.file),
        data_status: c.data_status,
      }],
    });
  });
  return Object.values(map);
}

function countCasesHierarchy(hierarchy) {
  let cases = 0;
  let personas = 0;
  hierarchy.forEach((d) => {
    cases += (d.cases || []).length;
    (d.cases || []).forEach((c) => {
      personas += (c.personas || []).length;
    });
  });
  return { diseases: hierarchy.length, cases, personas };
}

function getSelectedDisease() {
  if (!state.selectedDiseaseCode) return null;
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  return hierarchy.find((d) => d.disease_code === state.selectedDiseaseCode) || null;
}

function getSelectedCaseFromHierarchy() {
  if (!state.selectedCaseId) return null;
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  for (const d of hierarchy) {
    const found = (d.cases || []).find((c) => c.case_id === state.selectedCaseId);
    if (found) return found;
  }
  return null;
}

function getSelectedPersona() {
  const caseEntry = getSelectedCaseFromHierarchy();
  if (!caseEntry || !state.selectedPersonaId) return null;
  return (caseEntry.personas || []).find((p) => p.persona_id === state.selectedPersonaId) || null;
}

function resolvePracticeCaseId() {
  const persona = getSelectedPersona();
  if (persona?.file) {
    const base = persona.file.split('/').pop()?.replace('.json', '');
    if (base && state.casePackages[base]) return base;
    const match = Object.entries(state.casePackages || {}).find(
      ([, pkg]) => pkg.persona?.persona_id === persona.persona_id,
    );
    if (match) return match[0];
    return base || state.selectedCaseId;
  }
  return state.selectedCaseId
    || state.defaultCaseId
    || state.casesIndex?.meta?.default_case_id;
}

function getSelectedCaseEntry() {
  const fromHierarchy = getSelectedCaseFromHierarchy();
  if (fromHierarchy) {
    return {
      ...fromHierarchy,
      short_title: fromHierarchy.short_title || `${getSelectedDisease()?.name_zh || ''} · ${fromHierarchy.title || fromHierarchy.case_id}`,
    };
  }
  if (!state.selectedCaseId) return null;
  return state.casesIndex?.cases?.find((c) => c.case_id === state.selectedCaseId) || null;
}

function getSelectedCasePackage() {
  const persona = getSelectedPersona();
  if (state.selectedPersonaId && persona && !persona.file) return null;
  const id = resolvePracticeCaseId();
  return id ? state.casePackages[id] || null : null;
}

function getCasePackage(caseId) {
  return caseId ? state.casePackages[caseId] || null : null;
}

function isTreeExpanded(type, id) {
  return Boolean(state.casesTreeExpanded[`${type}:${id}`]);
}

function toggleTreeNode(type, id) {
  const key = `${type}:${id}`;
  state.casesTreeExpanded[key] = !state.casesTreeExpanded[key];
  if (state.route === 'cases') renderCases();
}

function switchCaseSelection({ diseaseCode, caseId, personaId, resetSection = false }) {
  state.selectedDiseaseCode = diseaseCode;
  state.selectedCaseId = caseId;
  state.selectedPersonaId = personaId;
  state.casesTreeExpanded[`disease:${diseaseCode}`] = true;
  if (caseId) state.casesTreeExpanded[`case:${caseId}`] = true;

  const persona = getSelectedPersona();
  state.casePackage = persona?.file ? state.casePackages[caseId] || null : null;
  if (resetSection) state.caseSection = 'overview';
  if (state.route === 'cases') renderCases();
  $('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchCase(caseId) {
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  hierarchy.forEach((disease) => {
    (disease.cases || []).forEach((c) => {
      if (c.case_id === caseId) {
        const persona = c.personas?.find((p) => p.is_default && p.file)
          || c.personas?.find((p) => p.file)
          || c.personas?.[0];
        switchCaseSelection({
          diseaseCode: disease.disease_code,
          caseId,
          personaId: persona?.persona_id || null,
          resetSection: true,
        });
      }
    });
  });
}

function switchCaseSection(sectionId) {
  if (!CASE_DETAIL_SECTIONS.some((s) => s.id === sectionId)) return;
  state.caseSection = sectionId;
  if (state.route === 'cases') renderCases();
}

function buildCaseOverviewHtml(pkg, entry) {
  const m = pkg.meta;
  const core = pkg.symptoms.filter((s) => s.is_core && s.present);
  return `
    <div class="explain-box">
      <div class="explain-box-label">开练前建议</div>
      <p>先在这里了解<strong>这个病例在练什么、患者是谁、有哪些症状和风险要点</strong>，再进入「模拟对话」。AI 病人只会基于下面登记的事实说话。</p>
    </div>
    <div class="stats-grid">
      ${statCard(core.length, '核心症状', '#0f766e', '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>')}
      ${statCard((pkg.risks || []).filter((r) => r.must_disclose).length, '必讲风险', '#dc2626', '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>')}
      ${statCard((pkg.visits || []).length, '访视节点', '#2563eb', '<path d="M12 7v5l3 3"/><circle cx="12" cy="12" r="9"/>')}
      ${statCard(m.version, '资料版本', '#7c3aed', '<path d="M4 6h16v12H4z"/>')}
    </div>
    <div class="case-info-grid">
      <div class="arch-block">
        <h4>病例标识</h4>
        <ul>
          <li>编号 ${m.case_id}</li>
          <li>状态 ${caseStatusLabel(m.data_status)} · v${m.version}</li>
          <li>适用场景 ${(entry?.mvp_scenes || []).join('、') || '—'}</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>疾病与分期</h4>
        <ul>
          <li>${pkg.disease.name_zh}（${pkg.disease.disease_code}）</li>
          <li>${pkg.protocol.phase} 期 · ${pkg.protocol.title}</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>当前受试者</h4>
        <p style="margin:0;font-size:14px;line-height:1.65;color:var(--text-secondary)">${getSelectedPersona()?.display_label || pkg.persona.display_name || '—'}</p>
      </div>
      <div class="arch-block">
        <h4>一句话</h4>
        <p style="margin:0;font-size:14px;line-height:1.65;color:var(--text-secondary)">${getSelectedPersona()?.one_liner || entry?.one_liner || m.title}</p>
      </div>
    </div>
    <div class="explain-box" style="margin-top:16px">
      <div class="explain-box-label">数据说明</div>
      <p>${m.disclaimer}</p>
      ${m.replacement_note ? `<p style="margin-top:8px;font-size:13px;color:var(--muted)">${m.replacement_note}</p>` : ''}
    </div>
    <div class="guide-cta" style="margin-top:20px">
      <button type="button" data-goto="practice">已了解，开始模拟对话</button>
      <button type="button" class="secondary" data-case-section="patient">下一步：看患者档案</button>
    </div>`;
}

const PERSONA_LABELS = {
  'PER-ELDER-BASIC-01': '张大爷',
  'PER-ELDER-FEMALE-02': '王阿姨',
  'PER-HTN-TAXI-01': '李建国',
  male: '男',
  female: '女',
  with_spouse: '与配偶同住',
  lives_alone: '独居',
  with_family: '与家人同住',
  secondary: '中学文化程度',
  primary: '小学文化程度',
  college: '大专及以上',
  anxious_mild: '轻度焦虑，听到副作用会紧张',
  anxious: '焦虑',
  calm: '情绪较平稳',
  repeats_key_questions: '关键问题会再问一遍，需要说慢一点',
  mostly_adherent: '大体能按时服药，偶有漏服',
  adherent: '服药依从较好',
  average: '理解力一般',
  low: '较少隐瞒病情',
  high: '可能有所隐瞒',
  normal: '听力正常',
  spouse_may_attend: '配偶可能会一起听',
  self: '本人可以签字',
};

function isPersonaTrainable(persona) {
  return Boolean(persona?.file && persona?.is_trainable !== false);
}

function flattenAllPersonas() {
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  const items = [];
  hierarchy.forEach((d) => {
    (d.cases || []).forEach((c) => {
      (c.personas || []).forEach((p) => {
        items.push({
          diseaseCode: d.disease_code,
          diseaseName: d.name_zh,
          caseId: c.case_id,
          caseTitle: c.short_title || c.title || c.case_id,
          sceneLabel: (c.mvp_scenes || []).join('、') || '—',
          persona: p,
          trainable: isPersonaTrainable(p),
          hay: `${d.name_zh} ${c.short_title} ${c.title} ${c.case_id} ${p.display_label} ${p.one_liner}`.toLowerCase(),
        });
      });
    });
  });
  return items;
}

function syncSelectionFromCase(caseId, personaId) {
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  for (const d of hierarchy) {
    const c = (d.cases || []).find((x) => x.case_id === caseId);
    if (!c) continue;
    const p = personaId
      ? (c.personas || []).find((x) => x.persona_id === personaId)
      : (c.personas || []).find((x) => isPersonaTrainable(x));
    state.selectedDiseaseCode = d.disease_code;
    state.selectedCaseId = caseId;
    state.selectedPersonaId = p?.persona_id || null;
    state.casePackage = p?.file ? getCasePackage(caseId) : null;
    return;
  }
}

function buildPracticePersonaPickerHtml() {
  const q = (state.practicePickerSearch || '').trim().toLowerCase();
  const items = flattenAllPersonas().filter((it) => !q || it.hay.includes(q));
  const trainable = items.filter((it) => it.trainable);
  const pending = items.filter((it) => !it.trainable);

  const renderCard = (it) => {
    const p = it.persona;
    const active = state.selectedCaseId === it.caseId && state.selectedPersonaId === p.persona_id;
    const disabled = !it.trainable;
    return `
      <button type="button" class="practice-persona-card ${active ? 'active' : ''} ${disabled ? 'is-pending' : ''}"
        data-pick-persona="${disabled ? '' : p.persona_id}"
        data-pick-case="${it.caseId}"
        data-pick-disease="${it.diseaseCode}"
        ${disabled ? 'disabled' : ''}>
        <div class="practice-persona-card-top">
          <strong>${escapeHtml(p.display_label || p.persona_id)}</strong>
          ${disabled ? '<span class="status-pill warn">待录入</span>' : '<span class="status-pill ok">可练习</span>'}
        </div>
        <p class="practice-persona-card-meta">${escapeHtml(it.diseaseName)} · ${escapeHtml(it.caseTitle)}</p>
        <p class="practice-persona-card-oneline">${escapeHtml(p.one_liner || '—')}</p>
        ${disabled ? '<p class="practice-persona-card-note">资料尚未录入，暂不可对话</p>' : ''}
      </button>`;
  };

  return `
    <div class="practice-picker">
      <div class="practice-picker-head">
        <button type="button" class="practice-action-btn" id="practice-picker-back">← 返回</button>
        <div>
          <h3>选择受试者</h3>
          <p>在模拟对话内直接选人开练，无需跳转资料库。占位受试者暂不可对话。</p>
        </div>
      </div>
      <div class="practice-picker-search">
        <input type="search" id="practice-picker-search" placeholder="搜索病种 / 试验 / 受试者…" value="${escapeHtml(state.practicePickerSearch || '')}" />
      </div>
      ${trainable.length ? `
        <div class="section-head"><h4 class="section-title">可练习（${trainable.length}）</h4></div>
        <div class="practice-persona-grid">${trainable.map(renderCard).join('')}</div>
      ` : '<p class="card-meta">暂无可用受试者，请稍后再试。</p>'}
      ${pending.length ? `
        <div class="section-head"><h4 class="section-title">待录入（${pending.length}）</h4></div>
        <div class="practice-persona-grid">${pending.map(renderCard).join('')}</div>
      ` : ''}
    </div>`;
}

function getSessionDisplayInfo(session) {
  const caseId = session.case_code;
  const personaId = session.persona_code;
  const pkg = state.casePackages[caseId];
  if (pkg?.persona?.persona_id === personaId) {
    const p = pkg.persona;
    const sex = p.sex === 'female' ? '女' : p.sex === 'male' ? '男' : '';
    const age = p.age_years ? `${p.age_years}岁` : '';
    const suffix = [age, sex].filter(Boolean).join('');
    return {
      personaLabel: suffix ? `${p.display_name} · ${suffix}` : (p.display_name || personaId),
      trialTitle: pkg.meta?.short_title || caseId,
    };
  }
  for (const p of Object.values(state.casePackages || {})) {
    if (p.persona?.persona_id === personaId) {
      const per = p.persona;
      const sex = per.sex === 'female' ? '女' : per.sex === 'male' ? '男' : '';
      const age = per.age_years ? `${per.age_years}岁` : '';
      const suffix = [age, sex].filter(Boolean).join('');
      return {
        personaLabel: suffix ? `${per.display_name} · ${suffix}` : per.display_name,
        trialTitle: p.meta?.short_title || caseId,
      };
    }
  }
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  for (const d of hierarchy) {
    for (const c of (d.cases || [])) {
      const per = (c.personas || []).find((x) => x.persona_id === personaId);
      if (per) {
        return {
          personaLabel: per.display_label || per.persona_id,
          trialTitle: c.short_title || caseId,
        };
      }
    }
  }
  return { personaLabel: personaId || '未知受试者', trialTitle: caseId };
}

function sessionMatchesSelection(session) {
  const caseId = resolvePracticeCaseId();
  const persona = getSelectedPersona();
  if (!persona?.persona_id || !caseId) return false;
  return session.case_code === caseId && session.persona_code === persona.persona_id;
}

function sessionModeLabel(mode) {
  return mode === 'assessment' ? '考核' : '练习';
}

function studyModeLabel(mode) {
  return mode === 'strict' ? '严格模式' : '参考模式';
}

function setEngagementMode(mode) {
  if (state.practice.sessionId && state.practice.status !== 'completed') return;
  state.engagementMode = mode === 'assessment' ? 'assessment' : 'practice';
  if (state.engagementMode === 'assessment') {
    state.practice.studyMode = 'strict';
    state.practice.referenceOpen = false;
    localStorage.setItem('practiceStudyMode', 'strict');
  }
  localStorage.setItem('engagementMode', state.engagementMode);
  state.practice.showAllResumes = false;
  if (state.route === 'practice') renderPractice();
}

function sessionsForEngagement(sessions, engagement = state.engagementMode) {
  const mode = engagement || 'practice';
  return (sessions || []).filter((s) => (s.session_mode || 'practice') === mode);
}

function setPracticeStudyMode(mode) {
  if (state.engagementMode === 'assessment') return;
  state.practice.studyMode = mode === 'strict' ? 'strict' : 'reference';
  if (mode === 'strict') state.practice.referenceOpen = false;
  localStorage.setItem('practiceStudyMode', state.practice.studyMode);
  if (state.route === 'practice') renderPractice();
}

function getPersonaSessions(personaId, sessionMode = null) {
  return (state.practiceHistory || []).filter((s) => {
    if (personaId && s.persona_code !== personaId) return false;
    if (sessionMode && (s.session_mode || 'practice') !== sessionMode) return false;
    return true;
  });
}

function getAssessmentStateForPersona(personaId) {
  const list = getPersonaSessions(personaId, 'assessment');
  const inProgress = list.find((s) => s.status === 'in_progress');
  const completed = list.filter((s) => s.status === 'completed');
  return { inProgress, completed, total: list.length };
}

async function loadAllSessions() {
  if (!isAuthenticated()) return [];
  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/sessions/history?limit=100`);
    if (res.ok) {
      state.practiceHistory = data.sessions || [];
      return state.practiceHistory;
    }
  } catch {
    state.practiceHistory = [];
  }
  return state.practiceHistory;
}

async function loadPracticePage() {
  if (!isAuthenticated()) return;
  await loadAllSessions();
  const savedId = readPersistedPracticeSessionId();
  const stillOpen = (state.practiceHistory || []).find(
    (s) => s.id === savedId && s.status === 'in_progress',
  );
  if (savedId && stillOpen && !state.practice.sessionId && !state.practice.pickerOpen && !state.practice.restoring) {
    state.practice.restoring = true;
    try {
      await resumePractice(savedId);
    } finally {
      state.practice.restoring = false;
    }
    return;
  }
  if (savedId && !stillOpen) persistPracticeSessionId(null);
  if (state.route === 'practice') renderPractice();
}

async function loadRecordsPage() {
  if (!isAuthenticated()) return;
  state.recordsLoading = true;
  renderRecords();
  await loadAllSessions();
  state.recordsLoading = false;
  if (state.route === 'records') renderRecords();
}

function splitInProgressSessions(sessions) {
  const selected = getSelectedPersona();
  if (!selected || !isPersonaTrainable(selected)) {
    return { current: sessions, other: [] };
  }
  const current = sessions.filter((s) => sessionMatchesSelection(s));
  const other = sessions.filter((s) => !sessionMatchesSelection(s));
  return { current, other };
}

function lastMessagePreview(sessionLike) {
  if (sessionLike?.dialogue_summary) return sessionLike.dialogue_summary;
  const n = sessionLike?.message_count || 0;
  if (!n) return '尚无消息';
  const bits = [];
  if (sessionLike?.trainee_turns != null) bits.push(`你说了 ${sessionLike.trainee_turns} 轮`);
  const progress = sessionProgressLabel(sessionLike);
  if (progress) bits.push(progress);
  const tq = sessionLike?.last_trainee_quote;
  const pq = sessionLike?.last_patient_quote;
  if (tq) bits.push(`你最近：「${tq.length > 72 ? `${tq.slice(0, 72)}…` : tq}」`);
  if (pq) bits.push(`受试者最近：「${pq.length > 80 ? `${pq.slice(0, 80)}…` : pq}」`);
  if (bits.length) return bits.join(' · ');
  return `共 ${n} 条消息 · 点此恢复完整对话`;
}

function buildPracticeResumeCard(s, { highlight = false } = {}) {
  const info = getSessionDisplayInfo(s);
  const progress = sessionProgressLabel(s);
  const traineeQ = (s.last_trainee_quote || '').trim();
  const patientQ = (s.last_patient_quote || '').trim();
  const turns = s.trainee_turns != null ? s.trainee_turns : null;
  const msgN = s.message_count || 0;
  return `
    <button type="button" class="practice-resume-card ${highlight ? 'is-current' : ''}" data-resume="${s.id}">
      <span class="practice-resume-time">${formatDateTime(s.started_at)}</span>
      <span class="practice-resume-persona">${escapeHtml(info.personaLabel)}</span>
      <span class="practice-resume-meta">${escapeHtml(info.trialTitle)}${turns != null ? ` · 你说 ${turns} 轮` : ''}${msgN ? ` · 共 ${msgN} 条` : ''}</span>
      ${progress ? `<span class="practice-resume-progress">${escapeHtml(progress)}</span>` : ''}
      <div class="practice-resume-quotes">
        ${traineeQ ? `<p class="practice-resume-quote"><em>你</em>${escapeHtml(traineeQ.length > 96 ? `${traineeQ.slice(0, 96)}…` : traineeQ)}</p>` : ''}
        ${patientQ ? `<p class="practice-resume-quote is-patient"><em>受试者</em>${escapeHtml(patientQ.length > 110 ? `${patientQ.slice(0, 110)}…` : patientQ)}</p>` : ''}
        ${!traineeQ && !patientQ ? `<p class="practice-resume-quote muted">${escapeHtml(lastMessagePreview(s))}</p>` : ''}
      </div>
      <span class="practice-resume-action">继续对话 →</span>
    </button>`;
}

function openPracticePicker() {
  voiceCtrl.stopListening({ commit: false });
  voiceCtrl.stopPlayback();
  state.practice.pickerOpen = true;
  state.practice.sessionId = null;
  state.practice.caseInfo = null;
  state.practice.casePackage = null;
  state.practice.persona = null;
  state.practice.messages = [];
  state.practice.busy = false;
  state.practice.error = '';
  state.practice.referenceOpen = false;
  state.practice.composerDraft = '';
  if (state.route === 'practice') renderPractice();
  else navigate('practice');
}

function selectPracticePersona(diseaseCode, caseId, personaId) {
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  const disease = hierarchy.find((d) => d.disease_code === diseaseCode);
  const entry = (disease?.cases || []).find((c) => c.case_id === caseId);
  const persona = (entry?.personas || []).find((p) => p.persona_id === personaId);
  if (!persona || !isPersonaTrainable(persona)) return;
  switchCaseSelection({ diseaseCode, caseId, personaId, resetSection: false });
  state.practice.pickerOpen = false;
  state.practice.showAllResumes = false;
  if (state.route === 'practice') renderPractice();
}

function personaLabel(code) {
  if (!code) return '—';
  if (PERSONA_LABELS[code]) return PERSONA_LABELS[code];
  return String(code).replace(/_/g, ' ');
}

function buildPracticeReferenceHtml(pkg, caseInfo) {
  if (!pkg) {
    const bio = caseInfo?.persona?.lay_bio || state.practice.persona?.lay_bio;
    return `
      <div class="practice-ref-card">
        <h4>受试者简介</h4>
        <p>${escapeHtml(caseInfo?.short_title || '—')}</p>
        ${bio ? `<p class="practice-ref-muted">${escapeHtml(bio)}</p>` : ''}
      </div>`;
  }
  const script = pkg.session_script || {};
  const cs = pkg.clinical_summary || {};
  const p = pkg.persona || {};
  const med = pkg.medication || {};
  const visitItems = (pkg.visits?.[0]?.items || []).map((i) => i.label);
  const topics = (pkg.key_concerns || []).map((k) => k.topic).filter(Boolean);
  const checklist = visitItems.length ? visitItems : topics;

  return `
    <div class="practice-ref-card">
      <h4>${escapeHtml(p.display_name || '受试者')}</h4>
      <p>${escapeHtml(p.lay_bio || '')}</p>
      <div class="tag-row">
        ${p.age_years ? `<span class="tag">${p.age_years} 岁</span>` : ''}
        ${p.sex ? `<span class="tag">${personaLabel(p.sex)}</span>` : ''}
        ${p.occupation ? `<span class="tag">${personaLabel(p.occupation)}</span>` : ''}
      </div>
    </div>
    <div class="practice-ref-card">
      <h4>本次访视</h4>
      <p>${escapeHtml(script.scene_label || caseInfo?.scene_label || '')}</p>
      ${script.visit_context ? `<p class="practice-ref-muted">${escapeHtml(script.visit_context)}</p>` : ''}
      ${script.trainee_role_hint ? `<p class="practice-ref-tip">${escapeHtml(script.trainee_role_hint)}</p>` : ''}
    </div>
    <div class="practice-ref-card">
      <h4>病历可见信息</h4>
      <p><strong>主诉：</strong>${escapeHtml(cs.chief_complaint || '—')}</p>
      <p><strong>病程：</strong>${escapeHtml([cs.disease_duration, cs.disease_stage].filter(Boolean).join(' · ') || '—')}</p>
      ${(cs.history_present || []).length ? `
        <ul class="practice-ref-list">${cs.history_present.slice(0, 4).map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
      ` : ''}
      ${med.investigational_summary ? `<p class="practice-ref-muted"><strong>方案用药：</strong>${escapeHtml(med.investigational_summary)}</p>` : ''}
    </div>
    ${checklist.length ? `
    <div class="practice-ref-card">
      <h4>建议核查主题</h4>
      <ul class="practice-ref-list">${checklist.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      <p class="practice-ref-note">仅列核查方向，不含 SP 隐藏答案；细节需通过对话追问。</p>
    </div>` : ''}
  `;
}

function togglePracticeReference() {
  state.practice.referenceOpen = !state.practice.referenceOpen;
  const open = state.practice.referenceOpen;
  document.querySelector('.practice-gal-wrap')?.classList.toggle('is-ref-open', open);
  document.getElementById('practice-ref-sidebar')?.classList.toggle('open', open);
  document.getElementById('practice-ref-backdrop')?.classList.toggle('is-visible', open);
  const btn = document.getElementById('practice-ref-toggle');
  if (btn) {
    btn.textContent = open ? '收起参考' : '查阅参考';
    btn.classList.toggle('is-active', open);
  }
  requestAnimationFrame(() => {
    digitalHumanCtrl.relayout();
    setTimeout(() => digitalHumanCtrl.relayout(), 280);
  });
}

function exitPractice({ openPicker = false, force = false } = {}) {
  const inProgress = state.practice.sessionId && state.practice.status === 'in_progress';
  const isAssessment = (state.practice.sessionMode || state.engagementMode) === 'assessment';
  if (inProgress && isAssessment && !force) {
    state.practice.error = '考核进行中不可退出。请完成对话后点击「结束考核」交卷。';
    if (state.route === 'practice') renderPractice();
    return;
  }
  voiceCtrl.stopListening({ commit: false });
  voiceCtrl.stopPlayback();
  digitalHumanCtrl.destroy();
  document.body.classList.remove('gal-immersive');
  const sid = state.practice.sessionId;
  const status = state.practice.status;
  if (sid && status === 'in_progress') persistPracticeSessionId(sid);
  const studyMode = state.engagementMode === 'assessment' ? 'strict' : state.practice.studyMode;
  state.practice = {
    sessionId: null,
    caseInfo: null,
    casePackage: null,
    persona: null,
    messages: [],
    busy: false,
    status: null,
    error: '',
    composerDraft: '',
    studyMode,
    sessionMode: state.engagementMode || 'practice',
    referenceOpen: false,
    pickerOpen: false,
    showAllResumes: false,
    feedExpanded: false,
    checkpointOpen: false,
    patientAffect: null,
    restoring: false,
  };
  digitalHumanCtrl.setPatientMood(null);
  if (openPicker) {
    openPracticePicker();
    return;
  }
  if (state.route === 'practice') renderPractice();
  else loadPracticePage();
}

function resolvePracticeCasePackage(caseId) {
  return state.casePackages?.[caseId] || state.casePackage || null;
}

function buildCasePatientHtml(pkg) {
  const p = pkg.persona;
  const cs = pkg.clinical_summary;
  const extra = p.extra_slots || {};
  return `
    <div class="case-profile-card">
      <div class="case-profile-main">
        <h4>${p.display_name || '模拟受试者'}</h4>
        <p>${p.lay_bio}</p>
      </div>
      <div class="tag-row">
        <span class="tag">${p.age_years ? `${p.age_years} 岁` : p.age_band}</span>
        <span class="tag">${personaLabel(p.sex)}</span>
        <span class="tag">${personaLabel(p.living_situation)}</span>
        <span class="tag">${personaLabel(p.literacy_level)}</span>
      </div>
    </div>
    <div class="section-head"><h3 class="section-title">性格与沟通特点</h3></div>
    <div class="case-info-grid">
      <div class="arch-block"><h4>情绪基线</h4><p>${personaLabel(p.emotion_baseline)}</p></div>
      <div class="arch-block"><h4>理解方式</h4><p>${personaLabel(p.comprehension_style)}</p></div>
      <div class="arch-block"><h4>服药依从</h4><p>${personaLabel(p.adherence_tendency)}</p></div>
    </div>
    <div class="section-head"><h3 class="section-title">社会与背景</h3></div>
    <div class="guide-section">
      <p>${cs.social_notes || '—'}</p>
      <div class="tag-row" style="margin-top:12px">
        <span class="tag">听力：${personaLabel(p.hearing_note)}</span>
        <span class="tag">理解力：${personaLabel(p.cognition_level)}</span>
        <span class="tag">隐瞒倾向：${personaLabel(p.concealment_tendency)}</span>
        ${extra.family_companion ? `<span class="tag">${personaLabel(extra.family_companion)}</span>` : ''}
        ${extra.signature_ability ? `<span class="tag">${personaLabel(extra.signature_ability)}</span>` : ''}
      </div>
    </div>
    <div class="section-head"><h3 class="section-title">沟通时你会遇到什么</h3></div>
    <div class="guide-section">
      <ul class="guide-list">
        <li>说话偏慢、会把关键问题重复确认</li>
        <li>不知道的检查数字会说「记不清」，不要指望对方主动报精确化验值</li>
        <li>症状只按已登记病情说，不会编造库外的大病</li>
      </ul>
    </div>`;
}

function buildCaseClinicalHtml(pkg) {
  const cs = pkg.clinical_summary;
  const core = pkg.symptoms.filter((s) => s.is_core && s.present);
  return `
    <div class="guide-section">
      <p><strong>主诉：</strong>${cs.chief_complaint}</p>
      <p><strong>病程：</strong>${cs.disease_duration} · ${cs.disease_stage}</p>
    </div>
    <div class="section-head"><h3 class="section-title">现病史要点</h3></div>
    <ul class="guide-list">${(cs.history_present || []).map((h) => `<li>${h}</li>`).join('')}</ul>
    <div class="section-head"><h3 class="section-title">既往史 / 家族史</h3></div>
    <div class="case-info-grid">
      <div class="arch-block">
        <h4>既往史</h4>
        <ul>${(cs.history_past || []).map((h) => `<li>${h}</li>`).join('') || '<li>—</li>'}</ul>
      </div>
      <div class="arch-block">
        <h4>家族史</h4>
        <ul>${(cs.family_history || []).map((h) => `<li>${h}</li>`).join('') || '<li>—</li>'}</ul>
      </div>
    </div>
    ${(pkg.lab_hints || []).length ? `
      <div class="section-head"><h3 class="section-title">检查提示（患者所知）</h3></div>
      <div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>项目</th><th>结果（占位）</th><th>含义</th></tr></thead>
        <tbody>${pkg.lab_hints.map((l) => `
          <tr><td>${l.name}</td><td>${l.value_text}</td><td>${l.interpreted_as}</td></tr>
        `).join('')}</tbody>
      </table></div></div>
    ` : ''}
    <div class="section-head"><h3 class="section-title">核心症状（AI 必须演对）</h3></div>
    <div class="cards-grid">
      ${core.map((s) => `
        <article class="card scene-card">
          <div class="card-accent" style="--cat-color:#0f766e"></div>
          <div class="card-body">
            <div class="scene-code">${s.symptom_id}</div>
            <div class="card-head"><h3>${s.name}</h3><span class="badge badge-active">${s.severity_band}</span></div>
            <p class="card-meta">${s.clinical_name || ''} · ${s.onset_text || ''}</p>
            <div class="card-why"><strong>患者可能说：</strong>${(s.patient_may_say || []).slice(0, 2).join('；')}</div>
            ${(s.researcher_should_ask || []).length ? `<div class="card-project"><strong>研究者可追问：</strong>${s.researcher_should_ask.slice(0, 2).join('；')}</div>` : ''}
          </div>
        </article>
      `).join('')}
    </div>`;
}

function buildCaseProtocolHtml(pkg) {
  const pr = pkg.protocol;
  return `
    <div class="guide-section">
      <p><strong>${pr.title}</strong></p>
      <p>${pr.intervention_summary}</p>
      <p style="margin-top:12px"><strong>对照/盲法：</strong>${pr.control_summary}</p>
    </div>
    <div class="section-head"><h3 class="section-title">访视安排（占位）</h3></div>
    <div class="cards-grid">
      ${(pkg.visits || []).map((v) => `
        <article class="card scene-card">
          <div class="card-accent" style="--cat-color:#2563eb"></div>
          <div class="card-body">
            <div class="scene-code">${v.visit_id}</div>
            <div class="card-head"><h3>${v.name}</h3><span class="badge badge-reference">${v.timing_text}</span></div>
            <p class="card-meta">${v.purpose}</p>
            <ul class="guide-list" style="margin-top:10px">
              ${(v.items || []).slice(0, 4).map((it) => `<li>${it.label}</li>`).join('')}
            </ul>
          </div>
        </article>
      `).join('')}
    </div>
    <div class="section-head"><h3 class="section-title">入排提示（教学占位）</h3></div>
    <div class="case-info-grid">
      <div class="arch-block"><h4>纳入提示</h4><ul>${(pkg.inclusion_hints || []).map((h) => `<li>${h}</li>`).join('')}</ul></div>
      <div class="arch-block"><h4>排除提示</h4><ul>${(pkg.exclusion_hints || []).map((h) => `<li>${h}</li>`).join('')}</ul></div>
    </div>`;
}

function buildCaseMedicationHtml(pkg) {
  const med = pkg.medication || {};
  return `
    <div class="guide-section">
      <p><strong>试验用药：</strong>${med.investigational_summary || '—'}</p>
      <p style="margin-top:10px"><strong>当前日常用药：</strong>${med.current_regimen_summary || '—'}</p>
    </div>
    ${(med.concomitant_drugs || []).length ? `
      <div class="section-head"><h3 class="section-title">合并用药清单</h3></div>
      <div class="table-wrap"><div class="table-scroll"><table>
        <thead><tr><th>药物</th><th>用法</th><th>用途</th><th>进行中</th></tr></thead>
        <tbody>${med.concomitant_drugs.map((d) => `
          <tr><td>${d.drug_name}</td><td>${d.dose_text}</td><td>${d.purpose}</td><td>${d.is_ongoing ? '是' : '否'}</td></tr>
        `).join('')}</tbody>
      </table></div></div>
    ` : ''}
    <div class="section-head"><h3 class="section-title">依从与注意点</h3></div>
    <ul class="guide-list">
      ${(med.common_nonadherence || []).map((h) => `<li>${h}</li>`).join('')}
      ${(med.caution_points || []).map((h) => `<li>${h}</li>`).join('')}
    </ul>`;
}

function buildCaseRisksHtml(pkg) {
  return `
    <div class="section-head"><h3 class="section-title">知情同意应告知的风险</h3></div>
    <ul class="point-list">
      ${pkg.risks.filter((r) => r.must_disclose).map((r) => `
        <li><strong>${r.title}</strong> — ${r.lay_summary}</li>
      `).join('')}
    </ul>
    <div class="section-head"><h3 class="section-title">获益与不确定性</h3></div>
    <ul class="point-list">
      ${pkg.benefits.map((b) => `
        <li><strong>${b.title}</strong> — ${b.lay_summary}${b.is_uncertain ? '（不确定）' : ''}</li>
      `).join('')}
    </ul>
    <div class="section-head"><h3 class="section-title">禁止编造（AI 护栏）</h3></div>
    <ul class="guide-list">
      ${pkg.forbidden_fabrications.map((f) => `<li><strong>${f.category}</strong>：${f.description}</li>`).join('')}
    </ul>`;
}

const CASE_SECTION_BUILDERS = {
  overview: (pkg, entry) => buildCaseOverviewHtml(pkg, entry),
  patient: (pkg) => buildCasePatientHtml(pkg),
  clinical: (pkg) => buildCaseClinicalHtml(pkg),
  protocol: (pkg) => buildCaseProtocolHtml(pkg),
  medication: (pkg) => buildCaseMedicationHtml(pkg),
  risks: (pkg) => buildCaseRisksHtml(pkg),
};

const CASE_SECTION_DESC = {
  overview: '训练前先了解：这个病例练什么、有哪些关键数字',
  patient: '模拟受试者是谁、怎么说话、有什么沟通特点',
  clinical: '病情摘要、核心症状与研究者可追问点',
  protocol: '试验在做什么、访视怎么安排',
  medication: '现用药、试验药与依从注意点',
  risks: '知情同意必须讲清的风险、获益与 AI 不可编造项',
};

function buildCasePersonaPlaceholderHtml(persona, entry) {
  return `
    <div class="cases-placeholder-panel">
      <p class="hero-eyebrow">资料待录入</p>
      <h4>${persona?.display_label || '受试者资料'}</h4>
      <p>${persona?.one_liner || '该受试者资料尚未录入，但资料库结构已预留。'}</p>
      <p class="cases-placeholder-hint">录入后将在此展示：患者档案、病情症状、试验方案、用药、风险获益等六个板块。同一试验下可挂多位受试者，互不挤占侧边栏空间。</p>
      ${entry?.case_id ? `<p class="cases-placeholder-meta">试验编号 <code>${entry.case_id}</code>${persona?.persona_id ? ` · 受试者 <code>${persona.persona_id}</code>` : ''}</p>` : ''}
    </div>`;
}

function flattenCaseNavItems(hierarchy) {
  const items = [];
  (hierarchy || []).forEach((d) => {
    items.push({
      type: 'disease',
      diseaseCode: d.disease_code,
      label: d.name_zh,
      path: d.name_zh,
      hay: `${d.name_zh} ${d.disease_code}`.toLowerCase(),
    });
    (d.cases || []).forEach((c) => {
      items.push({
        type: 'case',
        diseaseCode: d.disease_code,
        caseId: c.case_id,
        label: c.short_title || c.title || c.case_id,
        path: `${d.name_zh} / ${c.short_title || c.title || c.case_id}`,
        hay: `${d.name_zh} ${c.short_title} ${c.title} ${c.case_id}`.toLowerCase(),
      });
      (c.personas || []).forEach((p) => {
        items.push({
          type: 'persona',
          diseaseCode: d.disease_code,
          caseId: c.case_id,
          personaId: p.persona_id,
          label: p.display_label || p.persona_id,
          path: `${d.name_zh} / ${c.short_title || c.case_id} / ${p.display_label || p.persona_id}`,
          hay: `${d.name_zh} ${c.short_title} ${c.case_id} ${p.display_label} ${p.one_liner} ${p.persona_id}`.toLowerCase(),
          pending: p.is_trainable === false || !p.file,
          oneLiner: p.one_liner,
        });
      });
    });
  });
  return items;
}

function caseNavBack() {
  const level = state.caseNavLevel || 'library';
  if (level === 'trial') {
    state.caseNavLevel = 'disease';
    state.selectedCaseId = null;
    state.selectedPersonaId = null;
    state.casePackage = null;
  } else if (level === 'disease') {
    state.caseNavLevel = 'library';
    state.selectedDiseaseCode = null;
    state.selectedCaseId = null;
    state.selectedPersonaId = null;
    state.casePackage = null;
  }
  state.caseLibrarySearch = '';
  closeModal();
  if (state.route === 'cases') renderCases();
}

function buildCasesBreadcrumb(level, disease, entry) {
  const parts = [
    `<button type="button" class="cases-crumb-link" data-nav-crumb="library">资料库</button>`,
  ];
  if (level !== 'library' && disease) {
    parts.push(`<button type="button" class="cases-crumb-link" data-nav-crumb="disease" data-nav-disease="${disease.disease_code}">${escapeHtml(disease.name_zh)}</button>`);
  }
  if (level === 'trial' && entry) {
    parts.push(`<span class="cases-crumb-current">${escapeHtml(entry.short_title || entry.title || entry.case_id)}</span>`);
  }
  return parts.join(' <span class="cases-crumb-sep">/</span> ');
}

function openCasePersonaModal(sectionId = 'overview') {
  const persona = getSelectedPersona();
  const entry = getSelectedCaseEntry();
  const pkg = getSelectedCasePackage();
  const disease = getSelectedDisease();
  state.caseModalSection = sectionId;
  const section = CASE_DETAIL_SECTIONS.find((s) => s.id === sectionId) || CASE_DETAIL_SECTIONS[0];
  const secIdx = CASE_DETAIL_SECTIONS.findIndex((s) => s.id === section.id);
  const prevSec = CASE_DETAIL_SECTIONS[secIdx - 1] || null;
  const nextSec = CASE_DETAIL_SECTIONS[secIdx + 1] || null;

  if (!persona || !entry) return;

  if (!persona.file || !pkg) {
    openModal(`
      <div class="modal-header case-modal-header">
        <h2>${escapeHtml(persona.display_label || persona.persona_id)}</h2>
        <p class="sub">${escapeHtml(entry.case_id || '')}</p>
      </div>
      <div class="modal-body-inner">${buildCasePersonaPlaceholderHtml(persona, entry)}</div>
    `, { wide: true });
    bindCaseModalEvents();
    return;
  }

  openModal(`
    <div class="modal-header case-modal-header">
      <h2>${escapeHtml(persona.display_label || persona.persona_id)}</h2>
      <p class="sub">${escapeHtml(disease?.name_zh || '')} · ${escapeHtml(entry.short_title || entry.case_id)} · <code>${escapeHtml(entry.case_id)}</code></p>
      ${persona.one_liner ? `<p class="case-modal-oneline">${escapeHtml(persona.one_liner)}</p>` : ''}
    </div>
    <nav class="cases-section-tabs case-modal-tabs" aria-label="受试者资料">
      ${CASE_DETAIL_SECTIONS.map((s) => `
        <button type="button" class="cases-section-tab ${s.id === section.id ? 'active' : ''}" data-case-modal-section="${s.id}">${s.label}</button>
      `).join('')}
    </nav>
    <div class="modal-body-inner case-modal-body">
      <p class="case-modal-section-desc">${escapeHtml(CASE_SECTION_DESC[section.id] || '')}</p>
      ${CASE_SECTION_BUILDERS[section.id](pkg, entry)}
    </div>
    <footer class="case-modal-footer">
      ${prevSec
    ? `<button type="button" class="explain-pager-btn" data-case-modal-section="${prevSec.id}">← ${prevSec.label}</button>`
    : '<span class="explain-pager-spacer"></span>'}
      <span class="explain-pager-indicator">${secIdx + 1} / ${CASE_DETAIL_SECTIONS.length}</span>
      ${nextSec
    ? `<button type="button" class="explain-pager-btn is-next" data-case-modal-section="${nextSec.id}">${nextSec.label} →</button>`
    : `<button type="button" class="explain-pager-btn is-next" data-case-modal-goto="practice">开始模拟对话 →</button>`}
    </footer>
  `, { wide: true });
  bindCaseModalEvents();
}

function bindCaseModalEvents() {
  modalBody.querySelectorAll('[data-case-modal-section]').forEach((btn) => {
    btn.addEventListener('click', () => openCasePersonaModal(btn.dataset.caseModalSection));
  });
  modalBody.querySelectorAll('[data-case-modal-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal();
      navigate('practice');
    });
  });
  modalBody.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      closeModal();
      if (target === 'practice') navigate('practice');
      else navigate(target);
    });
  });
  modalBody.querySelectorAll('[data-case-section]').forEach((btn) => {
    btn.addEventListener('click', () => openCasePersonaModal(btn.dataset.caseSection));
  });
}

function selectPersonaOpenModal(diseaseCode, caseId, personaId) {
  state.selectedDiseaseCode = diseaseCode;
  state.selectedCaseId = caseId;
  state.selectedPersonaId = personaId;
  state.caseNavLevel = 'trial';
  state.casePackage = getCasePackage(caseId);
  state.casesTreeExpanded[`disease:${diseaseCode}`] = true;
  state.casesTreeExpanded[`case:${caseId}`] = true;
  if (state.route === 'cases') renderCases();
  openCasePersonaModal(state.caseModalSection || 'overview');
}

function buildLibraryHomeHtml(hierarchy, stats) {
  const groups = (hierarchy || []).map((d) => {
    const cases = d.cases || [];
    if (!cases.length) return '';
    return `
      <section class="cases-library-group">
        <div class="cases-library-group-head">
          <h4>${escapeHtml(d.name_zh)}</h4>
          <span>${cases.length} 个试验</span>
        </div>
        <div class="cases-library-cards">
          ${cases.map((c) => {
            const personaCount = (c.personas || []).length;
            const trainable = (c.personas || []).filter((p) => p.file && p.is_trainable !== false).length;
            return `
            <button type="button" class="cases-library-card" data-nav-case="${c.case_id}" data-nav-disease="${d.disease_code}">
              <span class="cases-library-card-tag">${escapeHtml(d.disease_code)}</span>
              <strong>${escapeHtml(c.short_title || c.title || c.case_id)}</strong>
              <small>${escapeHtml(c.case_id)}</small>
              <span class="cases-library-card-meta">${personaCount} 位受试者${trainable ? ` · ${trainable} 可练` : ''}</span>
            </button>`;
          }).join('')}
        </div>
      </section>`;
  }).join('');

  return `
    <div class="cases-library-home">
      <div class="explain-box">
        <div class="explain-box-label">训练病例资料库</div>
        <p>这里是全部 SP 训练病例的入口。建议路径：<strong>资料库 → 病种 → 试验 → 受试者 → 详细资料</strong>。也可使用左侧搜索或下方卡片快速进入。</p>
      </div>
      <div class="stats-grid">
        ${statCard(stats.diseases, '病种', '#0f766e', '<path d="M12 2L2 7l10 5 10-5-10-5z"/>')}
        ${statCard(stats.cases, '试验病例', '#2563eb', '<path d="M4 6h16v12H4z"/>')}
        ${statCard(stats.personas, '受试者', '#7c3aed', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')}
      </div>
      ${groups || '<div class="cases-left-empty">暂无病例，请先在 cases-index 中配置</div>'}
    </div>`;
}

function buildDiseaseHomeHtml(disease) {
  if (!disease) return buildLibraryHomeHtml([], { diseases: 0, cases: 0, personas: 0 });
  const cases = disease.cases || [];
  return `
    <div class="cases-level-home">
      <div class="explain-box">
        <div class="explain-box-label">病种 · ${escapeHtml(disease.name_zh)}</div>
        <p>${escapeHtml(disease.description || '请选择下方试验病例，进入受试者列表与详细资料。')}</p>
      </div>
      <div class="cases-library-cards">
        ${cases.map((c) => {
          const personaCount = (c.personas || []).length;
          return `
          <button type="button" class="cases-library-card" data-nav-case="${c.case_id}" data-nav-disease="${disease.disease_code}">
            <strong>${escapeHtml(c.short_title || c.title || c.case_id)}</strong>
            <small>${escapeHtml(c.case_id)}</small>
            <span class="cases-library-card-meta">${personaCount} 位受试者 · 点击进入</span>
          </button>`;
        }).join('') || '<div class="cases-left-empty">该病种下暂无试验</div>'}
      </div>
    </div>`;
}

function buildTrialHomeHtml(entry, disease) {
  if (!entry) return '';
  const personas = entry.personas || [];
  const pkg = getCasePackage(entry.case_id);
  const coreSymptoms = pkg ? (pkg.symptoms || []).filter((s) => s.is_core && s.present) : [];
  const risks = pkg ? (pkg.risks || []).filter((r) => r.must_disclose) : [];
  const cs = pkg?.clinical_summary || {};

  return `
    <div class="cases-level-home">
      <div class="explain-box">
        <div class="explain-box-label">试验病例 · ${escapeHtml(entry.short_title || entry.title || entry.case_id)}</div>
        <p>编号 <code>${escapeHtml(entry.case_id)}</code> · ${escapeHtml(disease?.name_zh || '')}。${pkg ? '下方为病例摘要；点受试者卡片在弹窗中查看完整档案、症状、方案与风险。' : '请选择受试者；完整资料录入后可查看详情。'}</p>
      </div>
      ${pkg ? `
      <div class="stats-grid">
        ${statCard(coreSymptoms.length, '核心症状', '#0f766e', '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>')}
        ${statCard(risks.length, '必讲风险', '#dc2626', '<path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>')}
        ${statCard((pkg.visits || []).length, '访视节点', '#2563eb', '<path d="M12 7v5l3 3"/><circle cx="12" cy="12" r="9"/>')}
        ${statCard((personas || []).length, '受试者', '#7c3aed', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')}
      </div>
      <div class="case-info-grid" style="margin-bottom:18px">
        <div class="arch-block">
          <h4>主诉 / 病程</h4>
          <p style="margin:0;font-size:14px;line-height:1.65">${escapeHtml(cs.chief_complaint || '—')}${cs.disease_duration ? ` · ${escapeHtml(cs.disease_duration)}` : ''}</p>
        </div>
        <div class="arch-block">
          <h4>试验概要</h4>
          <p style="margin:0;font-size:14px;line-height:1.65">${escapeHtml(pkg.protocol?.title || entry.title || '—')}</p>
        </div>
      </div>
      ${coreSymptoms.length ? `
      <div class="section-head"><h3 class="section-title">核心症状（登记）</h3></div>
      <ul class="guide-list">${coreSymptoms.slice(0, 6).map((s) => `<li><strong>${escapeHtml(s.name)}</strong>${s.patient_may_say?.[0] ? ` — ${escapeHtml(s.patient_may_say[0])}` : ''}</li>`).join('')}</ul>
      ` : ''}
      ` : ''}
      <div class="section-head"><h3 class="section-title">选择受试者（点击查看完整资料）</h3></div>
      <div class="cases-library-cards cases-persona-pick-grid">
        ${personas.map((p) => {
          const pending = p.is_trainable === false || !p.file;
          return `
          <button type="button" class="cases-library-card ${pending ? 'is-pending' : ''}" data-nav-persona="${p.persona_id}" data-nav-case="${entry.case_id}" data-nav-disease="${disease?.disease_code}">
            <strong>${escapeHtml(p.display_label || p.persona_id)}${pending ? ' · 待录入' : ''}</strong>
            <span class="cases-library-card-meta">${escapeHtml(p.one_liner || '—')}</span>
            ${!pending ? '<span class="cases-library-card-action">查看档案 →</span>' : ''}
          </button>`;
        }).join('') || '<div class="cases-left-empty">该试验暂无受试者</div>'}
      </div>
    </div>`;
}

function buildCasesSearchMainHtml(q, hierarchy) {
  const items = flattenCaseNavItems(hierarchy).filter((it) => it.hay.includes(q)).slice(0, 12);
  return `
    <div class="cases-level-home">
      <div class="explain-box">
        <div class="explain-box-label">搜索结果</div>
        <p>关键词「${escapeHtml(q)}」共 ${items.length} 条（左侧可浏览全部）。点击条目进入对应层级。</p>
      </div>
      <div class="cases-library-cards">
        ${items.map((it) => `
          <button type="button" class="cases-library-card" data-nav-result="${it.type}" data-disease-code="${it.diseaseCode}" data-case-id="${it.caseId || ''}" data-persona-id="${it.personaId || ''}">
            <strong>${escapeHtml(it.label)}</strong>
            <span class="cases-library-card-meta">${escapeHtml(it.path)}</span>
          </button>`).join('') || '<div class="cases-left-empty">无匹配</div>'}
      </div>
    </div>`;
}

function buildCasesGlobalSearchHtml(hierarchy, q) {
  const items = flattenCaseNavItems(hierarchy).filter((it) => it.hay.includes(q));
  const typeLabel = { disease: '病种', case: '试验', persona: '受试者' };
  return `
    <div class="cases-drill-nav">
      <div class="cases-drill-toolbar">
        <button type="button" class="cases-drill-back" data-nav-clear-search>← 返回浏览</button>
        <span class="cases-drill-crumb">搜索「${escapeHtml(q)}」· ${items.length} 条</span>
      </div>
      <div class="cases-drill-list">
        ${items.length
    ? items.slice(0, 80).map((it) => `
          <button type="button" class="cases-left-item cases-drill-item" data-nav-result="${it.type}" data-disease-code="${it.diseaseCode}" data-case-id="${it.caseId || ''}" data-persona-id="${it.personaId || ''}">
            <strong>${escapeHtml(it.label)}${it.pending ? ' · 待录入' : ''}</strong>
            <small>${escapeHtml(it.path)} · ${typeLabel[it.type]}</small>
            ${it.oneLiner ? `<span class="cases-drill-oneline">${escapeHtml(it.oneLiner.slice(0, 56))}${it.oneLiner.length > 56 ? '…' : ''}</span>` : ''}
          </button>`).join('')
    : '<div class="cases-left-empty">无匹配项，试试姓名、病种或试验编号</div>'}
        ${items.length > 80 ? `<p class="cases-drill-more">还有 ${items.length - 80} 条，请缩小关键词</p>` : ''}
      </div>
    </div>`;
}

function buildCasesDrillNavHtml(hierarchy) {
  const disease = getSelectedDisease();
  const entry = getSelectedCaseEntry();
  const level = state.caseNavLevel || 'library';
  state.caseNavLevel = level;

  let crumb = '资料库';
  let listHtml = '';
  const levelLabel = {
    library: '资料库',
    disease: '病种',
    trial: '试验',
    persona: '受试者',
  }[level] || '资料库';

  if (level === 'library') {
    crumb = '选择病种';
    listHtml = (hierarchy || []).map((d) => {
      const cCount = (d.cases || []).length;
      const active = d.disease_code === state.selectedDiseaseCode;
      return `
        <button type="button" class="cases-left-item cases-drill-item ${active ? 'active' : ''}" data-nav-disease="${d.disease_code}">
          <strong>${escapeHtml(d.name_zh)}</strong>
          <small>${cCount} 个试验</small>
        </button>`;
    }).join('') || '<div class="cases-left-empty">暂无病种</div>';
  } else if (level === 'disease') {
    crumb = disease?.name_zh || '—';
    const caseList = disease?.cases || [];
    listHtml = caseList.length
      ? caseList.map((c) => {
        const active = c.case_id === state.selectedCaseId;
        const personaCount = (c.personas || []).length;
        return `
          <button type="button" class="cases-left-item cases-drill-item ${active ? 'active' : ''}" data-nav-case="${c.case_id}" data-nav-disease="${disease?.disease_code}">
            <strong>${escapeHtml(c.short_title || c.title || c.case_id)}</strong>
            <small>${escapeHtml(c.case_id)} · ${personaCount} 位受试者</small>
          </button>`;
      }).join('')
      : '<div class="cases-left-empty">该病种暂无试验</div>';
  } else {
    const personas = entry?.personas || [];
    crumb = `${disease?.name_zh || '—'} / ${entry?.short_title || entry?.case_id || '—'}`;
    listHtml = personas.length
      ? personas.map((p) => {
        const active = p.persona_id === state.selectedPersonaId;
        const pending = p.is_trainable === false || !p.file;
        return `
          <button type="button" class="cases-left-item cases-drill-item ${active ? 'active' : ''} ${pending ? 'is-pending' : ''}" data-nav-persona="${p.persona_id}" data-nav-case="${entry.case_id}" data-nav-disease="${disease?.disease_code}">
            <strong>${escapeHtml(p.display_label || p.persona_id)}${pending ? ' · 待录入' : ''}</strong>
            <small>${escapeHtml((p.one_liner || p.persona_id || '').slice(0, 64))}${(p.one_liner || '').length > 64 ? '…' : ''}</small>
          </button>`;
      }).join('')
      : '<div class="cases-left-empty">该试验暂无受试者</div>';
  }

  return `
    <div class="cases-drill-nav">
      <div class="cases-drill-toolbar">
        ${level !== 'library' ? '<button type="button" class="cases-drill-back" data-nav-back>← 上一级</button>' : ''}
        <span class="cases-drill-crumb">${escapeHtml(crumb)}</span>
        <span class="cases-drill-level">${levelLabel}</span>
      </div>
      <div class="cases-drill-list">
        ${listHtml}
      </div>
    </div>`;
}

function buildCasesLeftNavHtml(hierarchy) {
  const q = (state.caseLibrarySearch || '').trim().toLowerCase();
  if (q) return buildCasesGlobalSearchHtml(hierarchy, q);
  return buildCasesDrillNavHtml(hierarchy);
}

function bindCasesNavEvents(hierarchy) {
  viewEl.querySelector('[data-nav-back]')?.addEventListener('click', caseNavBack);

  viewEl.querySelectorAll('[data-nav-crumb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.navCrumb;
      state.caseLibrarySearch = '';
      closeModal();
      if (target === 'library') {
        state.caseNavLevel = 'library';
        state.selectedDiseaseCode = null;
        state.selectedCaseId = null;
        state.selectedPersonaId = null;
        state.casePackage = null;
      } else if (target === 'disease') {
        state.caseNavLevel = 'disease';
        state.selectedDiseaseCode = btn.dataset.navDisease;
        state.selectedCaseId = null;
        state.selectedPersonaId = null;
        state.casePackage = null;
      }
      renderCases();
    });
  });

  viewEl.querySelectorAll('[data-nav-disease]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDiseaseCode = btn.dataset.navDisease;
      state.selectedCaseId = null;
      state.selectedPersonaId = null;
      state.casePackage = null;
      state.caseNavLevel = 'disease';
      state.caseLibrarySearch = '';
      state.caseSection = 'overview';
      closeModal();
      renderCases();
    });
  });

  viewEl.querySelectorAll('[data-nav-case]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDiseaseCode = btn.dataset.navDisease;
      state.selectedCaseId = btn.dataset.navCase;
      state.selectedPersonaId = null;
      state.casePackage = null;
      state.caseNavLevel = 'trial';
      state.caseLibrarySearch = '';
      state.caseSection = 'overview';
      closeModal();
      renderCases();
    });
  });

  viewEl.querySelectorAll('[data-nav-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectPersonaOpenModal(btn.dataset.navDisease, btn.dataset.navCase, btn.dataset.navPersona);
    });
  });

  viewEl.querySelectorAll('[data-nav-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { navResult, diseaseCode, caseId, personaId } = btn.dataset;
      state.caseLibrarySearch = '';
      if (navResult === 'disease') {
        state.selectedDiseaseCode = diseaseCode;
        state.selectedCaseId = null;
        state.selectedPersonaId = null;
        state.casePackage = null;
        state.caseNavLevel = 'disease';
        state.caseSection = 'overview';
        closeModal();
        renderCases();
        return;
      }
      if (navResult === 'case') {
        state.selectedDiseaseCode = diseaseCode;
        state.selectedCaseId = caseId;
        state.selectedPersonaId = null;
        state.casePackage = null;
        state.caseNavLevel = 'trial';
        state.caseSection = 'overview';
        closeModal();
        renderCases();
        return;
      }
      selectPersonaOpenModal(diseaseCode, caseId, personaId);
    });
  });

  $('#cases-library-search')?.addEventListener('input', (e) => {
    state.caseLibrarySearch = e.target.value;
    closeModal();
    renderCases();
    const search = $('#cases-library-search');
    if (search) {
      search.focus();
      const len = search.value.length;
      search.setSelectionRange(len, len);
    }
  });
}

function buildCasePersonaCurrentBar(persona, entry) {
  if (!persona) return '';
  const total = (entry?.personas || []).length;
  return `
    <div class="cases-persona-current">
      <div class="cases-persona-current-main">
        <span class="cases-persona-current-label">当前受试者</span>
        <strong>${escapeHtml(persona.display_label || persona.persona_id || '—')}</strong>
        ${persona.one_liner ? `<span class="cases-persona-current-oneline">${escapeHtml(persona.one_liner)}</span>` : ''}
      </div>
      ${total > 1 ? `<span class="cases-persona-current-meta">共 ${total} 位 · 左侧列表或搜索切换</span>` : ''}
    </div>`;
}

function renderCases() {
  const idx = state.casesIndex;
  const hierarchy = normalizeCasesHierarchy(idx);
  const stats = countCasesHierarchy(hierarchy);
  const disease = getSelectedDisease();
  const entry = getSelectedCaseEntry();
  const level = state.caseNavLevel || 'library';
  const searchQ = (state.caseLibrarySearch || '').trim().toLowerCase();

  if (!idx) {
    setPage('病例详情资料', '按病种、试验、受试者浏览训练资料');
    viewEl.innerHTML = '<div class="empty">未找到病例资料</div>';
    return;
  }

  const diseaseName = disease?.name_zh || '—';
  const caseTitle = entry?.short_title || entry?.title || '—';

  let mainTitle = '资料库';
  let mainDesc = `${stats.diseases} 个病种 · ${stats.cases} 个试验 · ${stats.personas} 位受试者`;
  let mainBody = '';
  const breadcrumb = buildCasesBreadcrumb(level, disease, entry);

  if (searchQ) {
    mainBody = buildCasesSearchMainHtml(searchQ, hierarchy);
    mainTitle = '搜索';
    mainDesc = `关键词「${state.caseLibrarySearch}」`;
  } else if (level === 'library') {
    mainBody = buildLibraryHomeHtml(hierarchy, stats);
  } else if (level === 'disease') {
    mainBody = buildDiseaseHomeHtml(disease);
    mainTitle = diseaseName;
    mainDesc = '选择试验病例';
  } else if (level === 'trial') {
    mainBody = buildTrialHomeHtml(entry, disease);
    mainTitle = caseTitle;
    mainDesc = '病例摘要与受试者列表 · 点击受试者查看完整资料';
  }

  setPage(`资料库 · ${mainTitle}`, '资料库 → 病种 → 试验 → 受试者（弹窗详情）');

  viewEl.innerHTML = `
    <div class="cases-fullpage">
      ${level === 'library' ? renderPageBackBar() : ''}
      <header class="cases-topbar">
        <div class="cases-topbar-row">
          ${level !== 'library' ? '<button type="button" class="cases-drill-back" data-nav-back>← 返回上一级</button>' : ''}
          <p class="explain-breadcrumb cases-top-crumb">${breadcrumb}</p>
        </div>
        <input type="search" class="cases-library-search" id="cases-library-search" placeholder="搜索病种 / 试验 / 受试者…" value="${escapeHtml(state.caseLibrarySearch || '')}" />
      </header>

      <main class="cases-main cases-main-full">
        <header class="cases-subheader">
          <h3>${escapeHtml(mainTitle)}</h3>
          <p>${escapeHtml(mainDesc)}</p>
        </header>
        <div class="cases-subpage">
          ${mainBody}
        </div>
        <footer class="explain-pager">
          <span class="explain-pager-spacer"></span>
          <span class="explain-pager-indicator">${{ library: '第 1 层 · 资料库', disease: '第 2 层 · 病种', trial: '第 3 层 · 试验 + 受试者' }[level] || ''}</span>
          <span class="explain-pager-spacer"></span>
        </footer>
      </main>
    </div>
  `;

  bindCasesNavEvents(hierarchy);
  if (level === 'library') bindPageBackBar('guide');

  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      if (target.startsWith('explain-')) {
        navigate('explain', target.slice(8));
        return;
      }
      navigate(target);
    });
  });
}

function buildScenesHtml() {
  return `
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
}

function buildTermsHtml() {
  let list = state.terms.terms;
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(
      (t) => t.term.includes(q) || t.definition.includes(q) || t.field.includes(q),
    );
  }
  return `
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
}

const EXPLAIN_SECTION_BUILDERS = {
  overview: buildOverviewHtml,
  standards: buildStandardsHtml,
  rubric: buildRubricHtml,
  database: buildDatabaseHtml,
  scenes: buildScenesHtml,
  timeline: buildTimelineHtml,
  terms: buildTermsHtml,
};

const EXPLAIN_SECTION_DESC = {
  overview: '双底座架构、纳入标准数量与主依据文件一览',
  standards: '每份法规用白话说明：是什么、为什么需要、跟训练有什么关系',
  rubric: '练完对话后如何打分：0–100 参考分、清单线、维度权重与检查清单',
  database: '标准、病例是否入库，AI 能不能通话并写进日志',
  scenes: '一期仅 S1 启用 · 其余待 B0 病例包就绪',
  timeline: '规范生效与切换节点 · 版本回归参考',
  terms: '遇到看不懂的词来这里查 · 后面做训练系统也会用这些统一叫法',
};

function renderExplain() {
  const currentIdx = EXPLAIN_SECTIONS.findIndex((s) => s.id === state.explainSection);
  const idx = currentIdx >= 0 ? currentIdx : 0;
  const current = EXPLAIN_SECTIONS[idx];
  state.explainSection = current.id;
  const prev = EXPLAIN_SECTIONS[idx - 1] || null;
  const next = EXPLAIN_SECTIONS[idx + 1] || null;

  setPage(`系统功能 · ${current.label}`, EXPLAIN_SECTION_DESC[current.id] || '');

  viewEl.innerHTML = `
    <div class="explain-shell">
      <aside class="explain-sidebar" aria-label="系统功能目录">
        <div class="explain-sidebar-head">
          <p class="hero-eyebrow">System Guide</p>
          <h4>系统功能</h4>
          <p>7 个模块，点选切换内部页面</p>
        </div>
        <nav class="explain-side-nav">
          ${EXPLAIN_SECTIONS.map((s, i) => `
            <button type="button" class="explain-side-link ${s.id === current.id ? 'active' : ''}" data-section="${s.id}">
              <span class="explain-side-num">${String(i + 1).padStart(2, '0')}</span>
              <span class="explain-side-text">
                <strong>${s.label}</strong>
                <small>${s.hint || ''}</small>
              </span>
            </button>
          `).join('')}
        </nav>
      </aside>

      <main class="explain-main">
        ${renderPageBackBar()}
        <header class="explain-subheader">
          <p class="explain-breadcrumb">系统功能 <span>/</span> ${current.label}</p>
          <h3>${current.label}</h3>
          <p>${EXPLAIN_SECTION_DESC[current.id] || ''}</p>
        </header>

        <div class="explain-subpage">
          ${EXPLAIN_SECTION_BUILDERS[current.id]()}
        </div>

        <footer class="explain-pager">
          ${prev
            ? `<button type="button" class="explain-pager-btn" data-section="${prev.id}">← ${prev.label}</button>`
            : '<span class="explain-pager-spacer"></span>'}
          <span class="explain-pager-indicator">${idx + 1} / ${EXPLAIN_SECTIONS.length}</span>
          ${next
            ? `<button type="button" class="explain-pager-btn is-next" data-section="${next.id}">${next.label} →</button>`
            : '<span class="explain-pager-spacer"></span>'}
        </footer>
      </main>
    </div>
  `;

  bindExplainEvents();
  bindPageBackBar('guide');
}

function bindExplainEvents() {
  viewEl.querySelectorAll('[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => switchExplainSection(btn.dataset.section));
  });

  viewEl.querySelectorAll('.chip[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterCategory = btn.dataset.cat;
      renderExplain();
    });
  });

  viewEl.querySelectorAll('.chip[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filterLayer = btn.dataset.layer;
      renderExplain();
    });
  });

  viewEl.querySelectorAll('.toggle-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.simpleMode = btn.dataset.mode === 'simple';
      renderExplain();
    });
  });

  bindCardClicks();
  bindDatabaseEvents();

  viewEl.querySelectorAll('.timeline-item[data-id]').forEach((el) => {
    el.addEventListener('click', () => showStandardDetail(el.dataset.id));
  });

  viewEl.querySelectorAll('[data-std]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showStandardDetail(el.dataset.std);
    });
  });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return String(iso).replace('T', ' ').slice(0, 16);
}

function practiceSessionStorageKey(userId) {
  return userId ? `${PRACTICE_SESSION_KEY}:${userId}` : PRACTICE_SESSION_KEY;
}

function persistPracticeSessionId(sessionId) {
  const uid = state.auth.user?.id;
  const key = practiceSessionStorageKey(uid);
  // 清掉无用户前缀的旧 key，避免换号串会话
  localStorage.removeItem(PRACTICE_SESSION_KEY);
  if (sessionId) localStorage.setItem(key, sessionId);
  else if (uid) localStorage.removeItem(key);
}

function readPersistedPracticeSessionId() {
  const uid = state.auth.user?.id;
  if (!uid) return null;
  return localStorage.getItem(practiceSessionStorageKey(uid))
    || localStorage.getItem(PRACTICE_SESSION_KEY);
}

function resetPracticeClientState() {
  voiceCtrl.stopListening({ commit: false });
  voiceCtrl.stopPlayback();
  digitalHumanCtrl.setThinking(false);
  state.practice = {
    ...state.practice,
    sessionId: null,
    caseInfo: null,
    casePackage: null,
    persona: null,
    messages: [],
    status: null,
    error: '',
    busy: false,
    pickerOpen: false,
    restoring: false,
    composerDraft: '',
    patientAffect: null,
  };
  state.feedbackData = null;
  state.feedbackTranscript = [];
  state.selectedFeedbackSessionId = null;
  state.practiceHistory = [];
  state.feedbackHistory = [];
  state.feedbackError = '';
}


function getSceneKeyForPractice() {
  return state.practice.casePackage?.session_script?.scene_key
    || state.practice.caseInfo?.scene_key
    || '';
}

function isFollowUpScene(sceneKey, caseId) {
  if (sceneKey === 'follow_up' || sceneKey === 'adherence') return true;
  const cid = caseId || state.practice.caseInfo?.case_id || state.selectedCaseId || '';
  return String(cid).includes('HTN') || String(cid).includes('W4');
}

function getCheckpointIdsForScene(sceneKey, caseId) {
  return isFollowUpScene(sceneKey, caseId) ? FU_CHECKPOINT_IDS : IC_CHECKPOINT_IDS;
}

function buildCheckpointDefsForScene(sceneKey, caseId) {
  const isFu = isFollowUpScene(sceneKey, caseId);
  const rubric = isFu ? state.rubricFollowup : state.rubric;
  const lay = state.rubricLay || {};
  const hints = state.coverageHints || {};
  const ids = getCheckpointIdsForScene(sceneKey, caseId);
  return ids.map((id) => {
    const item = (rubric?.items || []).find((i) => i.id === id) || {};
    const layItem = lay[id] || {};
    const patterns = (hints[id] || []).map((p) => new RegExp(p, 'i'));
    return {
      id,
      title: layItem.layTitle || item.title || id,
      hint: layItem.layExplain || item.pass || '',
      patterns,
    };
  });
}

function getCheckpointDefsForPractice() {
  const sceneKey = getSceneKeyForPractice();
  const caseId = state.practice.caseInfo?.case_id || state.selectedCaseId || '';
  return buildCheckpointDefsForScene(sceneKey, caseId);
}

function getCommStagesForPractice() {
  const scene = getSceneKeyForPractice();
  if (isFollowUpScene(scene)) return COMM_STAGES_FU;
  return COMM_STAGES_IC;
}

function inferCheckpointsFromMessages(messages) {
  const defs = getCheckpointDefsForPractice();
  const traineeText = (messages || [])
    .filter((m) => m.role === 'trainee')
    .map((m) => m.content || '')
    .join('\n');
  let firstActive = true;
  return defs.map((d) => {
    const done = d.patterns.length > 0 && d.patterns.some((re) => re.test(traineeText));
    let status = 'todo';
    if (done) status = 'done';
    else if (firstActive) {
      status = 'active';
      firstActive = false;
    }
    return { ...d, status };
  });
}

function inferStagesFromMessages(messages) {
  return inferCheckpointsFromMessages(messages);
}

function buildCheckpointPanelHtml(messages, { compact = false, engagement = 'practice' } = {}) {
  if (engagement === 'assessment') {
    return `
      <div class="checkpoint-panel checkpoint-panel--assessment">
        <p><strong>考核模式</strong> · 不提供沟通进度提示。请独立完成对话后交卷。</p>
      </div>`;
  }
  const checkpoints = inferCheckpointsFromMessages(messages);
  const done = checkpoints.filter((s) => s.status === 'done').length;
  const total = checkpoints.length;
  const pct = total ? Math.round((100 * done) / total) : 0;
  return `
    <div class="checkpoint-panel${compact ? ' is-compact' : ''}">
      <div class="checkpoint-panel-head">
        <div>
          <strong>沟通检查点</strong>
          <span class="checkpoint-panel-sub">启发式参考 · 最终以结束反馈为准</span>
        </div>
        <div class="checkpoint-panel-stats">
          <span class="checkpoint-pct">${pct}%</span>
          <span>${done}/${total} 项可能已覆盖</span>
        </div>
      </div>
      <div class="checkpoint-progress-track" aria-hidden="true">
        <div class="checkpoint-progress-fill" style="width:${pct}%"></div>
      </div>
      <ol class="checkpoint-list">
        ${checkpoints.map((s, idx) => `
          <li class="checkpoint-item is-${s.status}" title="${escapeHtml(s.hint)}">
            <div class="checkpoint-item-head">
              <span class="checkpoint-num">${idx + 1}</span>
              <span class="checkpoint-title">${escapeHtml(s.title)}</span>
              <span class="checkpoint-badge">${s.status === 'done' ? '可能达标' : (s.status === 'active' ? '建议关注' : '待覆盖')}</span>
            </div>
            <p class="checkpoint-hint">${escapeHtml(s.hint)}</p>
          </li>`).join('')}
      </ol>
    </div>`;
}

function buildStageProgressHtml(messages) {
  return buildCheckpointPanelHtml(messages, { engagement: state.engagementMode || 'practice' });
}

function buildPracticeGuideHtml() {
  const sceneKey = getSceneKeyForPractice();
  const caseId = state.practice.caseInfo?.case_id || state.selectedCaseId || '';
  const checkpoints = buildCheckpointDefsForScene(sceneKey, caseId);
  const isFu = isFollowUpScene(sceneKey, caseId);
  return `
    <div class="practice-guide-card">
      <div class="practice-guide-head">
        <strong>开练导览 · ${isFu ? '随访' : '知情同意'} · ${checkpoints.length} 个沟通检查点</strong>
        <span>练完要达成：对照下面清单把该讲的讲全、该问的问清；结束后的反馈会逐项核对。</span>
      </div>
      <ol class="practice-guide-list practice-guide-list--grid">
        ${checkpoints.map((s, i) => `
          <li>
            <span class="practice-guide-num">${i + 1}</span>
            <div><strong>${escapeHtml(s.title)}</strong> — ${escapeHtml(s.hint)}</div>
          </li>`).join('')}
      </ol>
      ${isFu ? '<p class="practice-guide-footnote">另含 2 项红线（责备恐吓、自行决定医学处理），触犯会直接判严重问题。</p>' : ''}
    </div>`;
}

function sessionProgressLabel(s) {
  if (s.progress_total != null && s.progress_done != null) {
    const pct = s.progress_pct != null ? s.progress_pct : Math.round((100 * s.progress_done) / (s.progress_total || 1));
    return `距离完成约 ${pct}%（检查点 ${s.progress_done}/${s.progress_total}）`;
  }
  return null;
}

function buildTranscriptHtml(messages, personaLabelText) {
  const visible = (messages || []).filter((m) => m.role !== 'system');
  if (!visible.length) return '<p class="card-meta">暂无对话正文。</p>';
  return `
    <div class="transcript-feed">
      ${visible.map((m) => `
        <div class="transcript-line role-${m.role}">
          <span class="transcript-name">${escapeHtml(galSpeakerLabel(m.role, personaLabelText))}</span>
          <p>${escapeHtml(stripPatientMarkdown(m.content || ''))}</p>
        </div>`).join('')}
    </div>`;
}

function scrollChatFeedToEnd() {
  const panel = $('#chat-panel');
  if (!panel) return;
  const go = () => { panel.scrollTop = panel.scrollHeight; };
  go();
  requestAnimationFrame(() => {
    go();
    requestAnimationFrame(go);
  });
}

function clearChatInputImmediate() {
  const input = $('#chat-input');
  if (input) input.value = '';
  state.practice.composerDraft = '';
}

function patchLiveFeedbackRailSoft() {
  const rail = $('#practice-live-rail');
  if (!rail) return;
  const p = state.practice;
  if ((state.engagementMode || 'practice') !== 'practice' || p.status === 'completed') return;
  const next = buildLiveFeedbackRailHtml(p.messages, p.patientAffect, { busy: p.busy });
  const tmp = document.createElement('div');
  tmp.innerHTML = next.trim();
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  // 只替换面板内容，避免整块外层闪烁
  const oldPanel = rail.querySelector('.live-rail-panel');
  const newPanel = fresh.querySelector('.live-rail-panel');
  if (oldPanel && newPanel) {
    oldPanel.replaceWith(newPanel);
  } else {
    rail.replaceWith(fresh);
  }
  // 顶栏达标率芯片同步
  const chip = $('#coverage-chip');
  const chipHtml = buildCoverageProgressHtml(p.messages, { compact: true });
  if (chip) {
    const wrap = document.createElement('div');
    wrap.innerHTML = chipHtml.trim();
    chip.replaceWith(wrap.firstElementChild);
  }
}

function patchPracticeInChatUi() {
  if (state.route !== 'practice' || !state.practice.sessionId) return;
  const p = state.practice;
  const personaLabelText = p.persona?.display_name || p.persona?.display_label || '';
  const feed = $('#chat-panel');
  if (feed) {
    feed.innerHTML = buildGalDialogFeed(p.messages, personaLabelText, p.busy);
    scrollChatFeedToEnd();
  }
  const meta = document.querySelector('.gal-dialog-feed-meta span');
  if (meta) {
    meta.textContent = `对话 ${(p.messages || []).filter((m) => m.role !== 'system').length} 条 · 上滑可看全部历史`;
  }
  const busyHint = document.querySelector('.chat-busy-hint');
  if (p.busy) {
    if (!busyHint) {
      const form = $('#chat-form');
      form?.insertAdjacentHTML('beforeend', '<p class="chat-busy-hint">受试者回复中…</p>');
    }
  } else if (busyHint) {
    busyHint.remove();
  }
  const sendBtn = $('#chat-send');
  const completeBtn = $('#practice-complete');
  if (sendBtn) sendBtn.disabled = !!p.busy;
  if (completeBtn) completeBtn.disabled = !!p.busy;
  if (p.busy) clearChatInputImmediate();
  updateCheckpointFlash(p.messages);
  patchLiveFeedbackRailSoft();
  if (p.checkpointOpen) patchCheckpointRail();
  const moodPill = document.querySelector('.practice-gal-hud .status-pill.mood');
  const affectSummary = inferAffectFromDialogue(p.patientAffect, p.messages);
  if (moodPill && affectSummary.stance_label) {
    moodPill.textContent = `心情：${p.busy ? '思考中…' : affectSummary.stance_label}`;
  }
}

function buildSessionRecordRow(s) {
  const info = getSessionDisplayInfo(s);
  const mode = s.session_mode || 'practice';
  const statusLabel = s.status === 'in_progress'
    ? '进行中'
    : (s.has_feedback ? (s.overall_pass ? '建议通过' : '建议改进') : '已结束');
  const statusCls = s.status === 'in_progress' ? 'warn' : (s.has_feedback ? (s.overall_pass ? 'ok' : 'bad') : 'muted');
  const score = s.total_score != null ? `<span class="records-score">${s.total_score}分</span>` : '';
  const actions = [];
  if (s.status === 'in_progress') {
    actions.push(`<button type="button" class="records-action" data-resume="${s.id}">继续对话</button>`);
  } else {
    actions.push(`<button type="button" class="records-action secondary" data-transcript="${s.id}">查看对话</button>`);
  }
  if (s.has_feedback) {
    actions.push(`<button type="button" class="records-action secondary" data-feedback="${s.id}">查看反馈</button>`);
  }
  return `
    <div class="records-row">
      <div class="records-row-main">
        <div class="records-row-top">
          <strong>${escapeHtml(info.personaLabel)}</strong>
          <span class="status-pill ${mode === 'assessment' ? 'bad' : 'ok'}">${sessionModeLabel(mode)}</span>
          <span class="status-pill muted">${studyModeLabel(s.study_mode)}</span>
          <span class="status-pill ${statusCls}">${statusLabel}</span>
          ${score}
        </div>
        <div class="records-row-meta">
          <span>${formatDateTime(s.started_at)}</span>
          <span>${escapeHtml(info.trialTitle)}</span>
          <span>${s.message_count || 0} 条消息</span>
        </div>
        <p class="records-row-preview">${escapeHtml(s.summary_preview || (s.status === 'in_progress' ? `未完成摘要：${lastMessagePreview(s)}` : '暂无反馈摘要'))}</p>
      </div>
      <div class="records-row-actions">${actions.join('')}</div>
    </div>`;
}

function renderRecords() {
  setPage('对话记录', '按受试者、类型与时间查找历次练习与考核');
  const f = state.recordsFilter || {};
  const history = state.practiceHistory || [];
  const personaOptions = [...new Set(history.map((s) => s.persona_code).filter(Boolean))];
  const filtered = history.filter((s) => {
    if (f.sessionMode && f.sessionMode !== 'all' && (s.session_mode || 'practice') !== f.sessionMode) return false;
    if (f.status === 'in_progress' && s.status !== 'in_progress') return false;
    if (f.status === 'completed' && s.status === 'in_progress') return false;
    if (f.personaId && f.personaId !== 'all' && s.persona_code !== f.personaId) return false;
    return true;
  });

  viewEl.innerHTML = `
    <div class="records-page">
      ${renderPageBackBar()}
      <div class="feedback-hero">
        <p class="hero-eyebrow">Session Records</p>
        <h3>对话记录管理</h3>
        <p>这里汇总你所有的<strong>练习</strong>与<strong>考核</strong>记录。练习可多次新建对话；考核选定受试者后只能进行一场，结束后可「重新考核」。</p>
      </div>
      <div class="records-filters">
        <label>类型
          <select id="records-filter-mode">
            <option value="all" ${f.sessionMode === 'all' ? 'selected' : ''}>全部</option>
            <option value="practice" ${f.sessionMode === 'practice' ? 'selected' : ''}>练习</option>
            <option value="assessment" ${f.sessionMode === 'assessment' ? 'selected' : ''}>考核</option>
          </select>
        </label>
        <label>状态
          <select id="records-filter-status">
            <option value="all" ${f.status === 'all' ? 'selected' : ''}>全部</option>
            <option value="in_progress" ${f.status === 'in_progress' ? 'selected' : ''}>进行中</option>
            <option value="completed" ${f.status === 'completed' ? 'selected' : ''}>已结束</option>
          </select>
        </label>
        <label>受试者
          <select id="records-filter-persona">
            <option value="all">全部受试者</option>
            ${personaOptions.map((pid) => `<option value="${pid}" ${f.personaId === pid ? 'selected' : ''}>${escapeHtml(personaLabel(pid))}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="records-summary">共 ${filtered.length} 条记录（全部 ${history.length} 条）</div>
      ${state.recordsLoading ? '<div class="feedback-loading"><p>加载中…</p></div>' : ''}
      <div class="records-list">
        ${filtered.length
          ? filtered.map((s) => buildSessionRecordRow(s)).join('')
          : '<div class="feedback-history-empty">没有符合条件的记录。去「模拟对话」开始练习，或切换筛选条件。<br/><small>若刚换了云服务器或换了账号，历史在对应库/账号下，不会自动合并。</small></div>'}
      </div>
    </div>`;

  $('#records-filter-mode')?.addEventListener('change', (e) => {
    state.recordsFilter.sessionMode = e.target.value;
    renderRecords();
  });
  $('#records-filter-status')?.addEventListener('change', (e) => {
    state.recordsFilter.status = e.target.value;
    renderRecords();
  });
  $('#records-filter-persona')?.addEventListener('change', (e) => {
    state.recordsFilter.personaId = e.target.value;
    renderRecords();
  });
  viewEl.querySelectorAll('[data-resume]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await resumePractice(btn.dataset.resume);
      navigate('practice');
    });
  });
  viewEl.querySelectorAll('[data-transcript]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.selectedFeedbackSessionId = btn.dataset.transcript;
      await loadFeedbackDetail(btn.dataset.transcript, false);
      navigate('feedback');
    });
  });
  viewEl.querySelectorAll('[data-feedback]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFeedbackSessionId = btn.dataset.feedback;
      navigate('feedback');
    });
  });
  bindPageBackBar('guide');
}

async function loadFeedbackPage() {
  if (!isAuthenticated()) return;
  state.feedbackLoading = true;
  state.feedbackError = '';
  renderFeedback();
  try {
    await loadAllSessions();
    state.feedbackHistory = state.practiceHistory || [];

    let targetId = state.selectedFeedbackSessionId;
    if (state.feedbackData?.session_id) {
      targetId = state.feedbackData.session_id;
    } else if (!targetId) {
      const withFb = state.feedbackHistory.find((s) => s.has_feedback);
      targetId = withFb?.id || null;
    }

    if (targetId) {
      await loadFeedbackDetail(targetId, false);
    } else {
      state.feedbackData = null;
    }
  } catch (err) {
    state.feedbackError = String(err.message || err);
    state.feedbackHistory = [];
  } finally {
    state.feedbackLoading = false;
    if (state.route === 'feedback') renderFeedback();
  }
}

async function loadFeedbackDetail(sessionId, rerender = true) {
  state.selectedFeedbackSessionId = sessionId;
  state.feedbackTab = 'overview';
  state.feedbackTranscript = [];
  try {
    const [{ res, data }, sessRes] = await Promise.all([
      fetchApi(`${API_BASE}/api/sessions/${sessionId}/feedback`),
      fetchApi(`${API_BASE}/api/sessions/${sessionId}`),
    ]);
    if (res.ok) {
      state.feedbackData = data.feedback;
    } else if (res.status === 404) {
      state.feedbackData = null;
    } else {
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    if (sessRes.res.ok && sessRes.data?.messages) {
      state.feedbackTranscript = sessRes.data.messages;
    }
  } catch (err) {
    state.feedbackData = null;
    state.feedbackError = String(err.message || err);
  }
  if (rerender && state.route === 'feedback') renderFeedback();
}

function roleLabel(role) {
  return { trainee: '你（研究者）', patient: '模拟受试者', system: '系统', coach: '带教' }[role] || role;
}

function renderPractice() {
  const engagement = state.engagementMode || 'practice';
  setPage(
    engagement === 'assessment' ? '模拟考核' : '模拟对话',
    engagement === 'assessment'
      ? '考核模式：选定受试者后仅一场对话，结束后可重新考核'
      : '与 AI 受试者练习沟通 · 可多次新建对话',
  );
  const p = state.practice;
  const active = !!p.sessionId && p.status !== 'completed';
  const inChat = !!p.sessionId;
  const inProgress = sessionsForEngagement(state.practiceHistory || []).filter((s) => s.status === 'in_progress');
  const { current: currentResumes, other: otherResumes } = splitInProgressSessions(inProgress);
  const showAllResumes = !!p.showAllResumes;
  const resumeList = (getSelectedPersona() && isPersonaTrainable(getSelectedPersona()) && !showAllResumes)
    ? currentResumes
    : inProgress;
  const v = state.voice;
  const savedDraft = p.busy ? (p.composerDraft || '') : ($('#chat-input')?.value || p.composerDraft || '');
  const studyMode = engagement === 'assessment' ? 'strict' : (p.studyMode || 'reference');
  const refPkg = p.casePackage || resolvePracticeCasePackage(p.caseInfo?.case_id || state.selectedCaseId);
  const refOpen = !!p.referenceOpen && studyMode === 'reference' && engagement === 'practice' && !!p.sessionId;
  const sessionPersonaLabel = p.persona?.display_name || p.persona?.display_label || '';
  const selectedPersona = getSelectedPersona();
  const personaLabelText = p.sessionId ? sessionPersonaLabel : (selectedPersona?.display_label || '');
  const canStart = isPersonaTrainable(selectedPersona) && Boolean(state.selectedCaseId);
  const personaReady = canStart;
  const selectedCase = getSelectedCaseEntry();
  const assessmentState = selectedPersona
    ? getAssessmentStateForPersona(selectedPersona.persona_id)
    : { inProgress: null, completed: [], total: 0 };
  const blockNewAssessment = engagement === 'assessment' && assessmentState.inProgress;
  const startLabel = engagement === 'assessment'
    ? (assessmentState.completed.length ? '重新考核' : '开始考核')
    : '开始新练习';
  const startHint = engagement === 'assessment'
    ? '考核仅允许一场进行中的对话，结束后保留记录与分数'
    : '可创建多条独立练习对话';
  const panelScroll = inChat ? ($('#chat-panel')?.scrollTop ?? 0) : 0;
  const winScroll = inChat ? window.scrollY : 0;
  const sessionBrief = inChat
    ? ((p.messages || []).find((m) => m.role === 'system')?.content || '')
    : '';
  document.body.classList.toggle('gal-immersive', inChat);

  if (inChat) digitalHumanCtrl.parkShell();

  viewEl.innerHTML = `
    <div class="practice-page ${inChat ? 'is-in-chat is-gal' : ''}">
      ${!inChat ? `
      <div class="practice-hero">
        <p class="hero-eyebrow">${engagement === 'assessment' ? 'Assessment' : 'Practice Chat'}</p>
        <h3>${engagement === 'assessment' ? '模拟沟通考核' : '模拟沟通练习'}</h3>
        <p>${engagement === 'assessment'
    ? '考核：严格模式，不可查阅病例参考。选定受试者 → 完成一场对话 → 结束评分。'
    : '练习：可多次新建对话，参考/严格模式均可。所有记录与分数在「对话记录」中查看。'}</p>
        <button type="button" class="practice-link-btn" data-goto="records">查看全部对话记录 →</button>
      </div>

      <div class="practice-mode-bar engagement-bar">
        <span class="practice-mode-label">场景类型</span>
        <button type="button" class="practice-mode-btn ${engagement === 'practice' ? 'active' : ''}" data-engagement="practice">练习 · 可多次新建</button>
        <button type="button" class="practice-mode-btn ${engagement === 'assessment' ? 'active' : ''}" data-engagement="assessment">考核 · 单场进行</button>
      </div>

      ${engagement === 'practice' ? `
      <div class="practice-mode-bar">
        <span class="practice-mode-label">资料模式</span>
        <button type="button" class="practice-mode-btn ${studyMode === 'reference' ? 'active' : ''}" data-study-mode="reference">
          参考模式 · 可边对话边查阅简介
        </button>
        <button type="button" class="practice-mode-btn ${studyMode === 'strict' ? 'active' : ''}" data-study-mode="strict">
          严格模式 · 仅对话
        </button>
        <span class="practice-mode-hint">${studyMode === 'reference' ? '需要时点「查阅参考」从右侧滑出摘要' : '不显示病例参考，更接近真实面谈'}</span>
      </div>
      ` : `
      <div class="practice-mode-bar assessment-strict-note">
        <span class="practice-mode-label">考核规则</span>
        <span class="practice-mode-hint"><strong>严格模式</strong>：考核中不可查阅病例参考，不可翻书。</span>
      </div>
      `}

      <div class="voice-bar">
        <label class="voice-toggle">
          <input type="checkbox" id="voice-toggle" ${v.enabled ? 'checked' : ''} />
          <span>开启语音模拟</span>
        </label>
        ${v.enabled ? `
          <div class="voice-controls">
            <button type="button" class="voice-ctrl-btn ${v.listening ? 'is-hot' : ''}" id="voice-mic-btn" ${(v.speaking || v.processing) ? 'disabled' : ''}>
              ${v.listening ? '停止说话' : '开始说话'}
            </button>
            <button type="button" class="voice-ctrl-btn secondary" id="voice-pause-btn" ${v.speaking ? '' : 'disabled'}>
              暂停旁白
            </button>
          </div>
          <label class="voice-autosend">
            <input type="checkbox" id="voice-autosend" ${v.autoSend ? 'checked' : ''} />
            <span>说完自动发送</span>
          </label>
        ` : ''}
        <p class="voice-hint" id="voice-status-live">${escapeHtml(voiceStatusText())}</p>
        <p class="voice-draft-hint" id="voice-draft-hint" ${(v.draft || v.interim || v.listening) ? '' : 'hidden'}>${escapeHtml([v.draft, v.interim].filter(Boolean).join(' ') ? `实时识别：${[v.draft, v.interim].filter(Boolean).join(' ')}` : (v.listening ? '说话时文字会实时出现在输入框' : ''))}</p>
      </div>
      ` : ''}

      ${p.pickerOpen ? buildPracticePersonaPickerHtml() : !p.sessionId ? `
        <div class="practice-start-panel">
          ${!personaReady ? `
            <p class="practice-case-hint">
              ${!selectedPersona
    ? '第一步：请先选择一位模拟受试者，再开始练习。'
    : `<strong>${escapeHtml(selectedPersona.display_label)}</strong> 资料待录入，暂不可对话。`}
            </p>
            <div class="practice-start-actions practice-start-actions--single">
              <button type="button" class="practice-start-btn primary" id="practice-open-picker">
                <span class="practice-start-icon">👤</span>
                <span>
                  <strong>${selectedPersona && !isPersonaTrainable(selectedPersona) ? '换其他受试者' : '选择受试者'}</strong>
                  <small>在本页挑选可练习的模拟病人</small>
                </span>
              </button>
            </div>
          ` : `
            <p class="practice-case-hint">已选择受试者，确认后即可${engagement === 'assessment' ? '开始考核' : '开始练习'}。</p>
            <div class="practice-selected-persona">
              <div class="practice-selected-persona-main">
                <strong>${escapeHtml(selectedPersona.display_label)}</strong>
                <span>${escapeHtml(selectedCase?.short_title || selectedCase?.case_id || '')}</span>
              </div>
              <button type="button" class="practice-link-btn" id="practice-open-picker">换受试者</button>
            </div>
            ${buildPracticeGuideHtml()}
            ${(() => {
              const lastId = readPersistedPracticeSessionId();
              const canResume = lastId && (state.practiceHistory || []).some((s) => s.id === lastId && s.status === 'in_progress');
              return canResume ? `
              <div class="practice-resume-last">
                <button type="button" class="practice-start-btn primary" id="practice-resume-last">
                  <span class="practice-start-icon">↩</span>
                  <span><strong>继续刚才的对话</strong><small>恢复完整历史消息，不会只剩一句</small></span>
                </button>
              </div>` : '';
            })()}
            <div class="practice-start-actions practice-start-actions--single">
              <button type="button" class="practice-start-btn primary" id="practice-start" ${p.busy || blockNewAssessment ? 'disabled' : ''}>
                <span class="practice-start-icon">▶</span>
                <span><strong>${startLabel}</strong><small>${startHint}</small></span>
              </button>
            </div>
          `}
          ${blockNewAssessment ? `<p class="practice-case-hint warn">当前受试者有一场考核进行中，请先继续完成，或去「对话记录」查看。</p>` : ''}
          ${inProgress.length ? `
            <div class="practice-resume-block">
              <p class="practice-resume-label">${engagement === 'assessment' ? '未结束的考核' : (getSelectedPersona() && isPersonaTrainable(getSelectedPersona()) ? '当前受试者的未结束练习' : '未结束的练习')}</p>
              ${getSelectedPersona() && isPersonaTrainable(getSelectedPersona()) && !currentResumes.length && !showAllResumes ? `
                <p class="practice-resume-empty">「${escapeHtml(getSelectedPersona().display_label)}」暂无未结束练习，点「${startLabel}」即可。</p>
              ` : ''}
              <div class="practice-resume-list">
                ${resumeList.map((s) => buildPracticeResumeCard(s, { highlight: sessionMatchesSelection(s) })).join('')}
              </div>
              ${otherResumes.length && getSelectedPersona() && isPersonaTrainable(getSelectedPersona()) ? `
                <button type="button" class="practice-link-btn practice-resume-toggle" id="practice-toggle-resumes">
                  ${showAllResumes ? '只显示当前受试者' : `其他受试者还有 ${otherResumes.length} 个未结束练习`}
                </button>
              ` : ''}
            </div>
          ` : ''}
          ${p.error ? `<div class="action-toast">${p.error}</div>` : ''}
        </div>
      ` : `
        <div class="practice-session-wrap practice-gal-wrap${refOpen ? ' is-ref-open' : ''}${p.checkpointOpen ? ' is-checkpoint-open' : ''}">
          <section class="practice-gal-stage-shell">
            <div class="practice-gal-hud">
              <div class="practice-gal-hud-left">
                <button type="button" class="practice-action-btn practice-back-btn" id="practice-back">← 返回</button>
                <span class="status-pill ok">${escapeHtml(p.caseInfo?.short_title || p.caseInfo?.case_id || '')}</span>
                ${personaLabelText ? `<span class="status-pill ok">${escapeHtml(personaLabelText)}</span>` : ''}
                <span class="status-pill ${engagement === 'assessment' ? 'bad' : 'ok'}">${sessionModeLabel(p.sessionMode || engagement)}</span>
                <span class="status-pill ${p.status === 'completed' ? 'ok' : 'warn'}">${p.status === 'completed' ? '已结束' : '进行中'}</span>
                ${p.patientAffect?.stance_label && engagement === 'practice' ? `
                  <span class="status-pill mood" title="详见左侧受试者状态">
                    心情：${escapeHtml(p.patientAffect.stance_label)}
                  </span>` : ''}
                ${engagement === 'practice' && active ? buildCoverageProgressHtml(p.messages, { compact: true }) : ''}
              </div>
              <div class="practice-gal-hud-right">
                ${engagement === 'practice' && active ? `
                  <button type="button" class="practice-action-btn ${p.checkpointOpen ? 'is-active' : ''}" id="practice-checkpoint-toggle">${p.checkpointOpen ? '收起检查点' : '沟通检查点'}</button>
                ` : ''}
                ${engagement === 'practice' ? `<button type="button" class="practice-action-btn" id="practice-exit-cases" title="在本页选择其他受试者">换受试者</button>` : ''}
                ${studyMode === 'reference' && engagement === 'practice' && active ? `
                  <button type="button" class="practice-action-btn ${refOpen ? 'is-active' : ''}" id="practice-ref-toggle">${refOpen ? '收起参考' : '查阅参考'}</button>
                ` : ''}
                <button type="button" class="practice-action-btn" data-goto="records">对话记录</button>
              </div>
            </div>
            <div class="practice-gal-stage-mount" id="digital-human-mount" aria-label="受试者形象"></div>

            ${active && engagement === 'practice' ? buildLiveFeedbackRailHtml(p.messages, p.patientAffect, { busy: p.busy }) : ''}

            ${active && p.checkpointOpen && engagement === 'practice' ? `
              <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
                ${buildCheckpointPanelHtml(p.messages, { engagement })}
              </aside>
            ` : ''}

            <div class="practice-gal-vn-layer">
              <div class="gal-dialog-glass">
                ${sessionBrief ? `
                  <details class="gal-session-brief">
                    <summary>本次任务提示</summary>
                    <p>${escapeHtml(sessionBrief)}</p>
                  </details>
                ` : ''}
                ${studyMode === 'strict' && engagement === 'practice' && p.persona?.lay_bio ? `
                  <p class="gal-dialog-hint"><strong>受试者：</strong>${escapeHtml(p.persona.lay_bio)}</p>
                ` : ''}
                ${engagement === 'assessment' && active ? `
                  <div class="gal-assessment-banner">考核进行中 · 不提供进度提示 · 不可退出，请完成后点「结束考核」</div>
                ` : ''}
                <div class="gal-dialog-feed-meta">
                  <span>对话 ${(p.messages || []).filter((m) => m.role !== 'system').length} 条 · 上滑可看全部历史</span>
                  <button type="button" class="practice-link-btn" id="practice-feed-expand">${p.feedExpanded ? '收起对话框' : '展开全部对话'}</button>
                </div>
                <div class="gal-dialog-feed${p.feedExpanded ? ' is-expanded' : ''}" id="chat-panel" aria-label="对话记录">
                  ${buildGalDialogFeed(p.messages, personaLabelText, p.busy)}
                </div>
                ${active ? `
                  <form class="gal-dialog-input" id="chat-form">
                    <textarea id="chat-input" rows="2" placeholder="输入要对受试者说的话… 上滑查看历史 · Enter 发送" ${p.busy ? '' : ''}></textarea>
                    <div class="chat-actions gal-dialog-actions">
                      <button type="submit" class="gal-action-btn gal-action-btn--primary" id="chat-send" ${p.busy ? 'disabled' : ''}>发送</button>
                      <div class="gal-dialog-actions-right">
                        <div class="gal-voice-actions">${buildGalVoiceActionsInnerHtml()}</div>
                        <button type="button" class="gal-action-btn gal-action-btn--secondary" id="practice-complete" ${p.busy ? 'disabled' : ''}>${engagement === 'assessment' ? '结束考核' : '结束练习'}</button>
                      </div>
                    </div>
                    <p class="gal-voice-status" id="voice-status-live">${escapeHtml(voiceStatusText())}</p>
                    ${p.busy ? '<p class="chat-busy-hint">受试者回复中…</p>' : ''}
                  </form>
                ` : `
                  <div class="gal-dialog-input gal-dialog-done">
                    <button type="button" data-goto="feedback">查看练习反馈</button>
                    <button type="button" class="secondary" id="practice-restart">再练一次</button>
                  </div>
                `}
                ${p.error ? `<div class="action-toast gal-dialog-error">${p.error}</div>` : ''}
              </div>
            </div>
          </section>
        ${studyMode === 'reference' && engagement === 'practice' ? `
          <div class="practice-ref-backdrop${refOpen ? ' is-visible' : ''}" id="practice-ref-backdrop"></div>
          <aside class="practice-ref-sidebar${refOpen ? ' open' : ''}" id="practice-ref-sidebar" aria-label="病例参考">
            <div class="practice-ref-sidebar-head">
              <div>
                <strong>病例参考</strong>
                <span>病历级摘要 · 不含 SP 隐藏答案</span>
              </div>
              <button type="button" class="practice-ref-close" id="practice-ref-close" aria-label="收起">×</button>
            </div>
            <div class="practice-ref-sidebar-body">
              ${buildPracticeReferenceHtml(refPkg, p.caseInfo)}
            </div>
          </aside>
        ` : ''}
        </div>
      `}
    </div>
  `;

  const dhMount = $('#digital-human-mount');
  if (dhMount && p.sessionId) {
    digitalHumanCtrl.attach(dhMount, {
      personaCode: p.persona?.persona_id || state.selectedPersonaId || '',
      displayName: personaLabelText || '模拟受试者',
      enabled: state.digitalHuman.enabled,
      speaking: state.voice.speaking,
      thinking: false,
    });
    requestAnimationFrame(() => {
      digitalHumanCtrl.relayout();
      requestAnimationFrame(() => digitalHumanCtrl.relayout());
    });
  } else {
    digitalHumanCtrl.destroy();
    document.body.classList.remove('gal-immersive');
  }

  if (inChat) {
    bindGalVoiceControls();
  } else {
    $('#voice-toggle')?.addEventListener('change', async (e) => {
      await voiceCtrl.setEnabled(e.target.checked);
      if (state.route === 'practice') renderPractice();
    });
    $('#voice-autosend')?.addEventListener('change', (e) => {
      state.voice.autoSend = e.target.checked;
    });
    bindGalVoiceMicPause();
  }
  bindLiveRailEvents();
  viewEl.querySelectorAll('[data-engagement]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (p.sessionId && p.status !== 'completed') return;
      setEngagementMode(btn.dataset.engagement);
    });
  });
  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      if (target.startsWith('explain-')) {
        navigate('explain', target.slice(8));
        return;
      }
      navigate(target);
    });
  });
  viewEl.querySelectorAll('[data-study-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setPracticeStudyMode(btn.dataset.studyMode));
  });
  $('#practice-start')?.addEventListener('click', startPractice);
  $('#practice-open-picker')?.addEventListener('click', openPracticePicker);
  $('#practice-resume-last')?.addEventListener('click', async () => {
    const id = readPersistedPracticeSessionId();
    if (id) await resumePractice(id);
  });
  $('#practice-feed-expand')?.addEventListener('click', () => {
    state.practice.feedExpanded = !state.practice.feedExpanded;
    patchFeedExpanded();
    scrollChatFeedToEnd();
  });
  $('#practice-checkpoint-toggle')?.addEventListener('click', () => {
    state.practice.checkpointOpen = !state.practice.checkpointOpen;
    patchCheckpointRail();
  });
  $('#practice-toggle-resumes')?.addEventListener('click', () => {
    state.practice.showAllResumes = !state.practice.showAllResumes;
    renderPractice();
  });
  $('#practice-picker-back')?.addEventListener('click', () => {
    state.practice.pickerOpen = false;
    renderPractice();
  });
  $('#practice-picker-search')?.addEventListener('input', (e) => {
    state.practicePickerSearch = e.target.value;
    renderPractice();
  });
  viewEl.querySelectorAll('[data-pick-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!btn.dataset.pickPersona) return;
      selectPracticePersona(btn.dataset.pickDisease, btn.dataset.pickCase, btn.dataset.pickPersona);
    });
  });
  viewEl.querySelectorAll('[data-resume]').forEach((btn) => {
    btn.addEventListener('click', () => resumePractice(btn.dataset.resume));
  });
  $('#practice-exit-cases')?.addEventListener('click', () => exitPractice({ openPicker: true }));
  $('#practice-back')?.addEventListener('click', () => exitPractice({ openPicker: false }));
  $('#practice-ref-toggle')?.addEventListener('click', togglePracticeReference);
  $('#practice-ref-close')?.addEventListener('click', togglePracticeReference);
  $('#practice-ref-backdrop')?.addEventListener('click', togglePracticeReference);
  $('#practice-restart')?.addEventListener('click', () => {
    voiceCtrl.stopListening({ commit: false });
    voiceCtrl.stopPlayback();
    const mode = state.practice.studyMode;
    state.practice = {
      sessionId: null,
      caseInfo: null,
      casePackage: null,
      persona: null,
      messages: [],
      busy: false,
      status: null,
      error: '',
      composerDraft: '',
      studyMode: mode,
      sessionMode: state.engagementMode || 'practice',
      referenceOpen: false,
      pickerOpen: false,
      showAllResumes: false,
      feedExpanded: false,
      restoring: false,
    };
    state.feedbackData = null;
    persistPracticeSessionId(null);
    loadPracticePage();
  });
  $('#practice-complete')?.addEventListener('click', completePractice);
  viewEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      if (target.startsWith('explain-')) {
        navigate('explain', target.slice(8));
        return;
      }
      navigate(target);
    });
  });
  const form = $('#chat-form');
  const input = $('#chat-input');
  if (input) {
    input.value = savedDraft;
    input.addEventListener('input', () => {
      state.practice.composerDraft = input.value;
    });
  }
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.practice.busy) return;
    sendPracticeTurn(input?.value || '');
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.practice.busy) return;
      form?.requestSubmit?.();
      if (!form?.requestSubmit) {
        sendPracticeTurn(input.value || '');
      }
    }
  });
  const panel = $('#chat-panel');
  if (inChat) {
    window.scrollTo({ top: winScroll, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (panel) panel.scrollTop = panelScroll || panel.scrollHeight;
  } else if (panel) {
    panel.scrollTop = panel.scrollHeight;
  }
}

async function resumePractice(sessionId) {
  state.practice.busy = true;
  state.practice.error = '';
  state.practice.pickerOpen = false;
  digitalHumanCtrl.setThinking(true);
  renderPractice();
  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/sessions/${sessionId}`);
    if (!res.ok || !data.ok) throw new Error(data.detail || '无法恢复会话');
    const caseId = data.session.case_code;
    syncSelectionFromCase(caseId, data.session.persona_code);
    const pkg = resolvePracticeCasePackage(caseId);
    const entry = getSelectedCaseEntry();
    state.practice.sessionId = sessionId;
    state.practice.caseInfo = {
      case_id: caseId,
      short_title: entry?.short_title || pkg?.meta?.short_title || caseId,
      scene_label: pkg?.session_script?.scene_label,
    };
    state.practice.casePackage = pkg;
    state.practice.persona = pkg?.persona
      ? {
          persona_id: pkg.persona.persona_id,
          display_name: pkg.persona.display_name,
          lay_bio: pkg.persona.lay_bio,
        }
      : null;
    state.practice.messages = data.messages || [];
    state.practice.status = data.session.status;
    state.practice.sessionMode = data.session.session_mode || 'practice';
    state.practice.studyMode = state.practice.sessionMode === 'assessment'
      ? 'strict'
      : (data.session.study_mode || 'reference');
    state.engagementMode = state.practice.sessionMode;
    localStorage.setItem('engagementMode', state.engagementMode);
    if (data.session.status === 'in_progress') persistPracticeSessionId(sessionId);
    else persistPracticeSessionId(null);
    if (data.patient_affect) {
      state.practice.patientAffect = data.patient_affect;
      digitalHumanCtrl.setPatientMood(data.patient_affect);
    } else if ((data.messages || []).some((m) => m.role === 'patient')) {
      state.practice.patientAffect = inferAffectFromDialogue(null, data.messages);
    }
    updateCheckpointFlash(data.messages || []);
  } catch (err) {
    state.practice.error = String(err.message || err);
  } finally {
    state.practice.busy = false;
    digitalHumanCtrl.setThinking(false);
    if (state.route === 'practice') {
      renderPractice();
      scrollChatFeedToEnd();
    }
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function startPractice() {
  const persona = getSelectedPersona();
  const caseEntry = getSelectedCaseEntry();
  if (!caseEntry || !persona) {
    state.practice.error = '请先选择受试者';
    openPracticePicker();
    return;
  }
  if (!isPersonaTrainable(persona)) {
    state.practice.error = `${persona.display_label || '该受试者'} 资料尚未录入，暂不可对话。请选择李建国、张大爷等已录入受试者。`;
    openPracticePicker();
    return;
  }

  state.practice.busy = true;
  state.practice.error = '';
  state.practice.pickerOpen = false;
  digitalHumanCtrl.setThinking(true);
  renderPractice();
  const caseId = resolvePracticeCaseId();
  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_id: caseId || null,
        session_mode: state.engagementMode || 'practice',
        study_mode: state.engagementMode === 'assessment' ? 'strict' : (state.practice.studyMode || 'reference'),
      }),
    });
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '创建失败');
    syncSelectionFromCase(data.case?.case_id, data.persona?.persona_id);
    state.practice.sessionId = data.session_id;
    state.practice.caseInfo = data.case;
    state.practice.casePackage = resolvePracticeCasePackage(data.case?.case_id);
    state.practice.persona = data.persona;
    state.practice.sessionMode = data.session_mode || state.engagementMode;
    state.practice.studyMode = state.practice.sessionMode === 'assessment' ? 'strict' : (data.study_mode || state.practice.studyMode);
    state.practice.messages = data.messages || [];
    state.practice.status = 'in_progress';
    state.practice.patientAffect = data.patient_affect || null;
    state.practice.lastCheckpointDone = null;
    state.practice.checkpointFlash = '';
    if (data.patient_affect) digitalHumanCtrl.setPatientMood(data.patient_affect);
    state.feedbackData = null;
    persistPracticeSessionId(data.session_id);
  } catch (err) {
    state.practice.error = `无法开始：${err.message || err}（请确认已启动后端 :8000）`;
  } finally {
    state.practice.busy = false;
    digitalHumanCtrl.setThinking(false);
    if (state.route === 'practice') renderPractice();
    if (state.practice.sessionId) speakLatestPatient();
  }
}

async function sendPracticeTurn(text, opts = {}) {
  const content = String(text || '').trim();
  if (!content || !state.practice.sessionId) return;
  if (state.practice.busy) return;

  const nextTurn = Math.max(...(state.practice.messages || []).map((m) => m.turn_index ?? 0), -1) + 1;
  state.practice.messages = [
    ...(state.practice.messages || []),
    {
      turn_index: nextTurn,
      role: 'trainee',
      content,
      created_at: new Date().toISOString(),
      _optimistic: true,
    },
  ];
  state.practice.composerDraft = '';
  state.practice.busy = true;
  state.practice.error = '';
  clearChatInputImmediate();
  patchPracticeInChatUi();

  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/sessions/${state.practice.sessionId}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '发送失败');
    state.practice.messages = data.messages || [];
    if (data.patient_affect) {
      state.practice.patientAffect = data.patient_affect;
      digitalHumanCtrl.setPatientMood(data.patient_affect);
    } else {
      state.practice.patientAffect = inferAffectFromDialogue(null, data.messages || []);
    }
    loadAllSessions().catch(() => {});
    state.practice.busy = false;
    if (state.route === 'practice') patchPracticeInChatUi();
    if (!state.practice.composerDraft) clearChatInputImmediate();
    await speakLatestPatient();
  } catch (err) {
    state.practice.messages = (state.practice.messages || []).filter((m) => !m._optimistic);
    state.practice.composerDraft = content;
    state.practice.error = String(err.message || err);
    const input = $('#chat-input');
    if (input) input.value = content;
    state.practice.busy = false;
    if (state.route === 'practice') patchPracticeInChatUi();
  }
}

async function completePractice() {
  if (!state.practice.sessionId) return;
  voiceCtrl.stopPlayback();
  state.practice.busy = true;
  state.practice.error = '正在生成建议反馈，可能需要几十秒…';
  renderPractice();
  try {
    const { res, data } = await fetchApi(`${API_BASE}/api/sessions/${state.practice.sessionId}/complete`, {
      method: 'POST',
    });
    if (!res.ok || !data.ok) throw new Error(data.detail || data.error || '结束失败');
    state.practice.status = 'completed';
    state.feedbackData = data.feedback;
    state.selectedFeedbackSessionId = state.practice.sessionId;
    state.practice.error = '';
    persistPracticeSessionId(null);
    navigate('feedback');
  } catch (err) {
    state.practice.error = String(err.message || err);
    state.practice.busy = false;
    if (state.route === 'practice') renderPractice();
  } finally {
    state.practice.busy = false;
  }
}

function buildFeedbackScoresHtml(scores) {
  if (!scores) return '';
  if (scores.insufficient_sample) {
    return `
      <div class="feedback-score-panel feedback-score-panel--insufficient">
        <div class="feedback-score-main">
          <div class="feedback-score-number feedback-score-number--muted">—</div>
          <div class="feedback-score-grade">${escapeHtml(scores.grade_label || '样本不足')}</div>
          <p class="feedback-score-note">${escapeHtml(scores.note || '对话太短，不出练习参考分')}</p>
        </div>
        <div class="feedback-score-explainer">
          <strong>这是什么意思？</strong>
          <p>系统需要足够长的对话（建议至少 3 轮、120 字以上）才能对照检查点给出可靠建议。只说一句和完整沟通不应同分，所以本次不出数值参考分。</p>
        </div>
      </div>`;
  }
  if (scores.total_score == null) return '';
  const passLine = scores.pass_score != null ? `达标线 ${scores.pass_score} 分` : '';
  return `
    <div class="feedback-score-panel feedback-score-panel--compact">
      <div class="feedback-score-explainer">
        <strong>这份分数代表什么？</strong>
        <p>0–100 是<strong>练习参考分</strong>：环形图 = 总分，雷达图 = 各维度是否均衡，圆环占比 = 检查项通过情况。${passLine ? `达标线 ${scores.pass_score} 分。` : ''}不是正式考核或合规认证。</p>
      </div>
    </div>`;
}

function buildFeedbackTabBar(activeTab) {
  const tabs = [
    { id: 'overview', label: '总览' },
    { id: 'dimensions', label: '维度得分' },
    { id: 'improve', label: '改进建议' },
    { id: 'items', label: '分项明细' },
    { id: 'transcript', label: '对话全文' },
  ];
  return `
    <div class="feedback-tabs" role="tablist">
      ${tabs.map((t) => `
        <button type="button" class="feedback-tab ${t.id === activeTab ? 'active' : ''}" data-feedback-tab="${t.id}" role="tab" aria-selected="${t.id === activeTab}">
          ${t.label}
        </button>`).join('')}
    </div>`;
}

function buildFeedbackDetailHtml(fb) {
  if (!fb && !(state.feedbackTranscript || []).length) {
    return `
      <div class="feedback-empty-detail">
        <p>该练习尚未生成反馈。请先在「模拟对话」中完成练习并点击结束。</p>
        <div class="guide-cta">
          <button type="button" data-goto="practice">去模拟对话</button>
        </div>
      </div>`;
  }

  if (!fb && (state.feedbackTranscript || []).length) {
    return `
      <div class="feedback-section">
        <div class="section-head">
          <h4 class="section-title">本次对话全文</h4>
          <span class="section-sub">尚未生成评分反馈时可先复盘对话</span>
        </div>
        ${buildTranscriptHtml(state.feedbackTranscript, '受试者')}
      </div>
      <div class="guide-cta">
        <button type="button" data-goto="practice">返回模拟对话</button>
        <button type="button" class="secondary" data-goto="records">返回对话记录</button>
      </div>`;
  }

  const items = fb.items || [];
  const l1 = items.filter((i) => i.layer === 'L1');
  const scores = fb.scores;
  const insufficient = scores?.insufficient_sample;
  const headlinePass = !insufficient && (scores?.practice_pass != null ? scores.practice_pass : fb.overall_pass);
  const tab = state.feedbackTab || 'overview';
  const dimViz = buildFeedbackDimensionsVizHtml(scores);
  const overviewViz = buildFeedbackOverviewVizHtml(scores, items);

  const overviewPanel = `
    ${buildFeedbackScoresHtml(scores)}
    ${overviewViz}
    ${!insufficient && !scores?.total_score && fb.items?.length ? `
      <div class="action-toast">该记录暂无参考分，请刷新页面；系统会自动从分项结果补算。算分规则见「系统功能 → 评分说明」。</div>` : ''}
    <div class="feedback-result-head ${headlinePass ? 'is-pass' : 'is-fail'}">
      <div class="feedback-result-badge">${insufficient ? '样本不足 · 未出参考分' : (headlinePass ? '综合建议：达标' : '综合建议：需改进')}</div>
      <h3>${insufficient ? '请继续多轮沟通后再结束' : (scores?.total_score != null ? `练习参考分 ${scores.total_score}/100` : (headlinePass ? '整体建议：通过' : '整体建议：需改进'))}</h3>
      <p class="feedback-summary">${escapeHtml(fb.summary || '')}</p>
      <div class="feedback-result-meta">
        <span class="status-pill ${headlinePass ? 'ok' : 'bad'}">${headlinePass ? '综合达标' : '综合未达标'}</span>
        ${scores?.checklist_pass != null ? `<span class="status-pill ${scores.checklist_pass ? 'ok' : 'warn'}">清单线 ${scores.checklist_pass ? '过' : '未过'}</span>` : ''}
        <span class="status-pill muted">L1 项 ${l1.length} 条</span>
        <span class="status-pill muted">${fb.case_code || '—'}</span>
        <span class="status-pill muted">${formatDateTime(fb.created_at)}</span>
      </div>
    </div>`;

  const dimensionsPanel = dimViz
    ? dimViz
    : '<p class="card-meta">暂无维度得分（样本不足或未生成分数）。</p>';

  const improvePanel = `
    <div class="core-rules">
      ${(fb.improvements || []).length
        ? fb.improvements.map((im, idx) => `
          <div class="core-rule">
            <span class="core-rule-num">${idx + 1}</span>
            <p><strong>${escapeHtml(im.title || im.item_code)}</strong><br/>${escapeHtml(im.suggestion || '')}</p>
          </div>`).join('')
        : '<p class="card-meta">暂无特别改进项，仍建议请带教老师复核对话。</p>'}
    </div>`;

  const verdictDonut = buildVerdictDonutHtml(items);
  const itemsPanel = `
    ${verdictDonut ? `<div class="fb-items-viz-head">${verdictDonut}<p class="fb-items-viz-note">圆环 = 各检查项结果占比 · 下表可对照证据</p></div>` : ''}
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
    </div>`;

  const transcriptPanel = buildTranscriptHtml(state.feedbackTranscript, PERSONA_LABELS[fb.persona_code] || fb.persona_code || '受试者');

  const tabPanels = {
    overview: overviewPanel,
    dimensions: dimensionsPanel,
    improve: improvePanel,
    items: itemsPanel,
    transcript: transcriptPanel,
  };

  return `
    ${buildFeedbackTabBar(tab)}
    <div class="feedback-tab-panel" data-feedback-panel="${tab}">
      ${tabPanels[tab] || overviewPanel}
    </div>

    <div class="guide-analogy feedback-disclaimer">
      <strong>免责声明：</strong>${escapeHtml(fb.disclaimer || '')}
    </div>

    <div class="guide-cta">
      <button type="button" data-goto="practice">返回对话 / 再练</button>
      <button type="button" class="secondary" data-goto="records">对话记录</button>
      <button type="button" class="secondary" data-goto="explain-rubric">查看评分说明</button>
    </div>
  `;
}

function renderFeedbackHistoryItem(s) {
  const active = s.id === state.selectedFeedbackSessionId;
  const statusLabel = s.has_feedback
    ? (s.overall_pass ? '建议通过' : '建议改进')
    : (s.status === 'in_progress' ? '进行中' : '无反馈');
  const statusCls = s.has_feedback ? (s.overall_pass ? 'ok' : 'bad') : 'warn';
  const scoreBadge = s.insufficient_sample
    ? '<span class="feedback-history-score warn">样本不足</span>'
    : (s.total_score != null ? `<span class="feedback-history-score">${s.total_score}分</span>` : '');
  const info = getSessionDisplayInfo(s);
  const mode = s.session_mode || 'practice';
  const progressLine = s.status === 'in_progress' && sessionProgressLabel(s)
    ? `<div class="feedback-history-progress">${escapeHtml(sessionProgressLabel(s))}</div>`
    : '';
  return `
    <button type="button" class="feedback-history-item ${active ? 'active' : ''}" data-feedback-id="${s.id}">
      <div class="feedback-history-top">
        <span class="feedback-history-time">${formatDateTime(s.feedback_at || s.ended_at || s.started_at)}</span>
        <span class="status-pill ${mode === 'assessment' ? 'bad' : 'ok'}">${sessionModeLabel(mode)}</span>
        <span class="status-pill ${statusCls}">${statusLabel}</span>
        ${scoreBadge}
      </div>
      <div class="feedback-history-case">${escapeHtml(info.personaLabel)} · ${escapeHtml(info.trialTitle)}</div>
      ${progressLine}
      <div class="feedback-history-preview">${escapeHtml(s.summary_preview || s.dialogue_summary || (s.status === 'in_progress' ? '练习尚未结束' : '暂无反馈摘要'))}</div>
    </button>`;
}

function renderFeedback() {
  setPage('练习反馈', '系统建议仅供参考 · 不是最终能力认证');
  const history = state.feedbackHistory || [];
  const withFeedback = history.filter((s) => s.has_feedback);

  if (state.feedbackLoading) {
    viewEl.innerHTML = `
      <div class="feedback-page">
        <div class="feedback-loading"><p>正在加载练习记录…</p></div>
      </div>`;
    return;
  }

  viewEl.innerHTML = `
    <div class="feedback-page">
      ${renderPageBackBar()}
      <div class="feedback-hero">
        <p class="hero-eyebrow">Feedback</p>
        <h3>练习反馈记录</h3>
        <p>反馈从数据库读取并保留历史。左侧选择一次练习查看详情；<strong>仅为系统建议，不是能力认证。</strong></p>
      </div>

      ${state.feedbackError ? `<div class="action-toast">${escapeHtml(state.feedbackError)}（请确认后端 :8000 已启动）</div>` : ''}

      <div class="feedback-layout">
        <aside class="feedback-history-panel">
          <div class="feedback-history-head">
            <strong>历史记录</strong>
            <span>${withFeedback.length} 条有反馈 · 共 ${history.length} 次练习</span>
          </div>
          <div class="feedback-history-list">
            ${history.length
              ? history.map((s) => renderFeedbackHistoryItem(s)).join('')
              : '<div class="feedback-history-empty">还没有练习记录。去「模拟对话」开始第一次练习吧。</div>'}
          </div>
          ${!history.length ? `
            <div class="guide-cta feedback-history-cta">
              <button type="button" data-goto="practice">去模拟对话</button>
            </div>
          ` : ''}
        </aside>

        <main class="feedback-detail-panel">
          <div class="explain-box feedback-advice">
            <div class="explain-box-label">重要说明</div>
            <p>以下仅为系统练习建议，可能有误。真正提升靠真实场景与人对人实践及带教指导。</p>
          </div>
          ${buildFeedbackDetailHtml(state.feedbackData)}
        </main>
      </div>
    </div>
  `;

  viewEl.querySelectorAll('[data-feedback-id]').forEach((btn) => {
    btn.addEventListener('click', () => loadFeedbackDetail(btn.dataset.feedbackId));
  });
  viewEl.querySelectorAll('[data-feedback-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.feedbackTab = btn.dataset.feedbackTab;
      renderFeedback();
    });
  });
  bindPageBackBar('guide');
  viewEl.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.goto;
    if (target.startsWith('explain-')) {
      navigate('explain', target.slice(8));
      return;
    }
    navigate(target);
  }));
}

function renderView() {
  if (state.route !== 'practice' || !state.practice.sessionId) {
    document.body.classList.remove('gal-immersive');
  }
  switch (state.route) {
    case 'guide': return renderGuide();
    case 'explain': return renderExplain();
    case 'cases': return renderCases();
    case 'practice': return renderPractice();
    case 'records': return renderRecords();
    case 'admin': return adminCtrl.render(viewEl, setPage);
    case 'feedback': return renderFeedback();
    case 'auth': return renderAuth();
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
    if (['explain', 'cases'].includes(state.route)) renderView();
  });
}

async function init() {
  try {
    await loadData();
    initModal();
    initSearch();
    await restoreAuth();
    renderUserBar();
    refreshConnStatus();
    voiceCtrl.refreshStatus();
    const parsed = parseHash();
    navFromHash = true;
    navigate(parsed.route, parsed.section, { skipHistory: true });
    navFromHash = false;
    window.addEventListener('hashchange', () => {
      navFromHash = true;
      const p = parseHash();
      navigate(p.route, p.section, { skipHistory: true });
      navFromHash = false;
    });
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">
      <p>数据加载失败。请只用统一入口，并强制刷新（Ctrl+F5）：</p>
      <p style="margin-top:12px"><code>python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000</code></p>
      <p style="margin-top:8px">打开 <a href="http://127.0.0.1:8000/#guide">http://127.0.0.1:8000/#guide</a>（不要用 file:// 或其它端口）</p>
      <pre style="text-align:left;margin-top:16px;font-size:12px">${escapeHtml(err.message || String(err))}</pre>
    </div>`;
  }
}

init();
