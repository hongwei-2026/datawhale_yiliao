import { createVoiceController } from './voice.js?v=20260909chat';
import { createDigitalHumanController } from './digital-human.js?v=20260909chat';
import { createAdminController, isAdminUser } from './admin.js?v=20260910hooks1';

const AUTH_TOKEN_KEY = 'aisp_auth_token';
const AUTH_USER_KEY = 'aisp_auth_user';
const PRACTICE_SESSION_KEY = 'aisp_practice_session_id';
/** 学员熟练度阈值：对话场次 + 累计练习时长（毫秒）都达标 → 老手 */
const UX_VETERAN_SESSIONS = 3;
const UX_VETERAN_DURATION_MS = 15 * 60 * 1000; // 15 分钟
const UX_PROFICIENCY_PREFIX = 'aisp_ux_metrics_';
const AUTH_ROUTES = new Set(['practice', 'feedback', 'records', 'admin', 'admin-cases', 'admin-users']);

/** 学员端主导航（不含系统功能）；顺序会按熟练度重排 */
const STUDENT_ROUTES_BASE = [
  { id: 'guide', label: '使用手册', eyebrow: 'User Manual', newbieHint: '第一次从这里开始' },
  { id: 'practice', label: '模拟对话', eyebrow: 'Practice Chat', regularHint: '老手直接开练' },
  { id: 'records', label: '对话记录', eyebrow: 'Session Records' },
  { id: 'feedback', label: '练习反馈', eyebrow: 'Feedback' },
  { id: 'cases', label: '病例详情资料', eyebrow: 'Case Briefing' },
];
const STUDENT_ROUTES = STUDENT_ROUTES_BASE;

/** 管理端入口（仅 admin 可见）——病例与账号拆开，系统功能仍单独 */
const ADMIN_NAV = [
  { id: 'admin-cases', label: '病例与场景', eyebrow: 'Cases & Scenes' },
  { id: 'admin-users', label: '账号管理', eyebrow: 'Accounts' },
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
  'admin-cases': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V4a2 2 0 0 0-2-2z"/><path d="M8 8h8M8 12h6"/></svg>',
  'admin-users': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};

/** 与页面同域请求 API（云端 8443、本地 8000 均适用）；勿写死 127.0.0.1 */
const API_BASE = (typeof location !== 'undefined') ? '' : 'http://127.0.0.1:8000';

const EXPLAIN_SECTIONS = [
  { id: 'overview', label: '产品总览', hint: '怎么练、怎么评' },
  { id: 'practice', label: '练习与考核', hint: '对话主战场' },
  { id: 'rubric', label: '评分说明', hint: '清单 + 参考分' },
  { id: 'scenes', label: '场景与病例', hint: '知情 / 随访' },
  { id: 'standards', label: '标准解释', hint: '法规白话' },
  { id: 'database', label: '数据与联通', hint: '入库与 Agnes' },
  { id: 'terms', label: '术语表', hint: '统一叫法' },
];

/** 旧 hash 路由 → 系统功能页内锚点（勿纳入学员主路由 id，如 practice） */
const LEGACY_TO_EXPLAIN = {
  standards: 'standards',
  database: 'database',
  rubric: 'rubric',
  terms: 'terms',
  overview: 'overview',
  timeline: 'overview',
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
  guideAudience: localStorage.getItem('aisp_guide_audience') || 'trainee', // trainee | admin
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
    leftStackOpen: localStorage.getItem('practiceLeftStackOpen') === '1',
    liveChecklistOpen: false,
    patientAffect: null,
    lastCheckpointDone: null,
    checkpointFlash: '',
    restoring: false,
  },
  practicePickerSearch: '',
  practicePickerScene: 'all', // all | informed_consent | follow_up | ...
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
  confirmDialog,
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
    if (payload.error && /麦克风|不支持语音识别/.test(payload.error) && !state.voice._alertedError) {
      state.voice._alertedError = payload.error;
      showPracticeAlertModal('语音不可用', payload.error);
    }
    if (!payload.error) state.voice._alertedError = '';
    if (state.route === 'practice') {
      if (!payload.speaking) digitalHumanCtrl.setSpeaking(false);
      const el = $('#voice-status-live');
      if (el && !state.voice.processing) el.textContent = voiceStatusText();
      const toggle = $('#voice-toggle');
      if (toggle) toggle.checked = state.voice.enabled;
      const micBtn = $('#voice-mic-btn');
      if (micBtn) {
        const busyMic = state.voice.speaking || state.voice.processing;
        micBtn.textContent = state.voice.listening ? '停止' : '说话';
        micBtn.title = state.voice.listening
          ? '停止语音输入'
          : (state.voice.enabled ? '开始语音输入（说完再点停止）' : '点此开启语音模式并开始说话');
        micBtn.classList.toggle('is-hot', state.voice.listening);
        micBtn.classList.toggle('is-off', !state.voice.enabled);
        micBtn.disabled = busyMic;
        micBtn.hidden = false;
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
  if (!v.enabled) {
    return '语音模式关：可打字；点输入框旁「说话」可一键开启（含 AI 朗读 + 你的语音输入）';
  }
  if (v.processing) return '正在整理识别结果…';
  if (v.speaking) return '受试者正在朗读回复…可点「暂停旁白」';
  if (v.listening) {
    return v.interim
      ? `正在听你说… ${v.interim}`
      : '正在听你说…说完再点「停止」，文字会填入输入框';
  }
  if (!v.speechRecognition) return '语音模式已开（AI 会朗读）；本浏览器不支持语音输入，请打字';
  if (!v.configured) return '语音模式已开 · 点「说话」可语音输入（旁白未配置，受试者可能无声）';
  return '语音模式已开：AI 会朗读回复；你可点「说话」语音输入，也可继续打字';
}

function patientSpeakHooks() {
  const personaId = state.practice.persona?.persona_id
    || state.selectedPersonaId
    || '';
  const affect = state.practice.patientAffect || {};
  const prosody = affect.tts_prosody || {};
  return {
    personaId,
    emotion: affect.tts_emotion || prosody.emotion || '',
    stance: affect.stance || prosody.stance || '',
    speed: prosody.speed,
    vol: prosody.vol,
    pitch: prosody.pitch,
    pause_sec: prosody.pause_sec,
    comma_pause_sec: prosody.comma_pause_sec,
    prosodyLabel: prosody.label || '',
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

function isSystemPatientFallback(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return t.startsWith('（系统）')
    || t.includes('暂时连不上模拟病人')
    || t.includes('模拟受试者暂时没接上');
}

async function speakLatestPatient() {
  // 仅「语音模式」开启时才请求 TTS；Live2D 开着也不自动朗读
  if (!state.voice.enabled) return;
  if (typeof voiceCtrl.speakPatientNarration !== 'function') {
    console.warn('voice.js 版本过旧，请强制刷新页面（Ctrl+Shift+R）');
    return;
  }
  const msgs = state.practice.messages || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'patient' && msgs[i].content) {
      const text = stripPatientMarkdown(msgs[i].content);
      if (!text || isSystemPatientFallback(text)) continue;
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
  const lines = visible.map((m) => {
    const affect = m.role === 'patient' ? resolveMessageAffect(m, messages) : null;
    return `
    <div class="gal-line role-${m.role}${m._optimistic ? ' is-pending' : ''}">
      <div class="gal-line-head">
        <span class="gal-line-name">${escapeHtml(galSpeakerLabel(m.role, personaLabelText))}${m._optimistic ? ' · 已发送' : ''}</span>
        ${affectChipHtml(affect)}
      </div>
      <p class="gal-line-text">${escapeHtml(stripPatientMarkdown(m.content || (m.role === 'patient' ? '（受试者未回应，请重试）' : '')))}</p>
    </div>
  `;
  }).join('');
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

function uxProfileStorageKey(user = state.auth.user) {
  const id = user?.id || user?.username || 'guest';
  return `${UX_PROFICIENCY_PREFIX}${id}`;
}

function loadUxProfile(user = state.auth.user) {
  try {
    const raw = localStorage.getItem(uxProfileStorageKey(user));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUxProfile(patch, user = state.auth.user) {
  if (!user || isAdminUser(user)) return loadUxProfile(user);
  const next = {
    ...loadUxProfile(user),
    ...patch,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(uxProfileStorageKey(user), JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

function parseSessionDurationMs(session) {
  const start = Date.parse(session?.started_at || '');
  if (!Number.isFinite(start)) return 0;
  let end = Date.parse(session?.ended_at || '');
  if (!Number.isFinite(end)) {
    // 进行中的会话：按已开练时长计入（封顶单场 2 小时，避免异常）
    if (session?.status === 'in_progress') {
      end = Math.min(Date.now(), start + 2 * 60 * 60 * 1000);
    } else {
      return 0;
    }
  }
  return Math.max(0, end - start);
}

function computeMetricsFromHistory(sessions = []) {
  const list = sessions || [];
  const sessionCount = list.length;
  const historyMs = list.reduce((sum, s) => sum + parseSessionDurationMs(s), 0);
  return { sessionCount, historyMs };
}

function getUxMetrics(user = state.auth.user) {
  const p = loadUxProfile(user);
  const fromHistory = computeMetricsFromHistory(state.practiceHistory || []);
  const sessionCount = Math.max(Number(p.sessionCount) || 0, fromHistory.sessionCount);
  const practiceMs = Math.max(Number(p.practiceMs) || 0, fromHistory.historyMs)
    + (Number(p.liveActiveMs) || 0);
  return {
    sessionCount,
    practiceMs,
    needSessions: UX_VETERAN_SESSIONS,
    needMs: UX_VETERAN_DURATION_MS,
  };
}

function getProficiencyProgress(user = state.auth.user) {
  const m = getUxMetrics(user);
  const sessionPct = Math.min(100, Math.round((100 * m.sessionCount) / m.needSessions));
  const timePct = Math.min(100, Math.round((100 * m.practiceMs) / m.needMs));
  // 两次都要达标才变老手：总进度取较短板
  const overall = Math.min(sessionPct, timePct);
  return {
    ...m,
    sessionPct,
    timePct,
    overall,
    remainingSessions: Math.max(0, m.needSessions - m.sessionCount),
    remainingMs: Math.max(0, m.needMs - m.practiceMs),
  };
}

function formatDurationShort(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}小时${m}分`;
  }
  if (min > 0) return `${min}分${sec ? `${sec}秒` : ''}`;
  return `${sec}秒`;
}

/** newbie | regular | admin —— 由场次+时长自动判定，不可手切 */
function getUserProficiency(user = state.auth.user) {
  if (!user) return 'newbie';
  if (isAdminUser(user)) return 'admin';
  const prog = getProficiencyProgress(user);
  return (prog.sessionCount >= UX_VETERAN_SESSIONS && prog.practiceMs >= UX_VETERAN_DURATION_MS)
    ? 'regular'
    : 'newbie';
}

function defaultRouteForUser(user = state.auth.user) {
  if (!user) return 'guide';
  if (isAdminUser(user)) return 'admin-cases';
  return getUserProficiency(user) === 'regular' ? 'practice' : 'guide';
}

function studentRoutesForNav() {
  const base = STUDENT_ROUTES_BASE.map((r) => ({ ...r }));
  if (getUserProficiency() !== 'regular') return base;
  const practice = base.find((r) => r.id === 'practice');
  const rest = base.filter((r) => r.id !== 'practice');
  return practice ? [practice, ...rest] : base;
}

function syncUxFromHistory(sessions, user = state.auth.user) {
  if (!user || isAdminUser(user)) return;
  const { sessionCount, historyMs } = computeMetricsFromHistory(sessions);
  const p = loadUxProfile(user);
  saveUxProfile({
    sessionCount: Math.max(Number(p.sessionCount) || 0, sessionCount),
    practiceMs: Math.max(Number(p.practiceMs) || 0, historyMs),
  }, user);
}

let practiceTimerStartedAt = null;

function startPracticeTimer() {
  if (!isAuthenticated() || isAdminUser(state.auth.user)) return;
  if (!state.practice.sessionId || state.practice.status === 'completed') return;
  if (practiceTimerStartedAt) return;
  practiceTimerStartedAt = Date.now();
}

function flushPracticeTimer() {
  if (!practiceTimerStartedAt) return;
  if (!isAuthenticated() || isAdminUser(state.auth.user)) {
    practiceTimerStartedAt = null;
    return;
  }
  const delta = Math.max(0, Date.now() - practiceTimerStartedAt);
  practiceTimerStartedAt = null;
  if (delta < 1000) return;
  const p = loadUxProfile();
  saveUxProfile({
    practiceMs: (Number(p.practiceMs) || 0) + delta,
  });
  renderUserBar();
  renderNav();
}

function markPracticeStarted() {
  if (!isAuthenticated() || isAdminUser(state.auth.user)) return;
  startPracticeTimer();
  loadAllSessions().then(() => {
    renderUserBar();
    renderNav();
  });
}

function markGuideCompleted() {
  // 手册读完不升老手；老手由场次+时长指标自动判定
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
    if (mode === 'register' && !isAdminUser(data.user)) {
      // 新账号从零指标开始 → 新手路径（使用手册）
      try { localStorage.removeItem(uxProfileStorageKey(data.user)); } catch { /* ignore */ }
      saveUxProfile({ sessionCount: 0, practiceMs: 0 }, data.user);
    }
    if (!isAdminUser(data.user)) {
      await loadAllSessions();
    }
    navigate(defaultRouteForUser(data.user));
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
    el.classList.remove('user-bar--trainee', 'user-bar--admin');
    el.innerHTML = `
      <button type="button" class="user-bar-btn" id="user-login-btn">登录 / 注册</button>
    `;
    $('#user-login-btn')?.addEventListener('click', () => navigate('auth'));
    return;
  }
  const u = state.auth.user;
  const isAdmin = isAdminUser(u);
  el.classList.toggle('user-bar--admin', isAdmin);
  el.classList.toggle('user-bar--trainee', !isAdmin);

  // 管理端：保持原来的简洁账号区，不展示学员新手/老手进度
  if (isAdmin) {
    el.innerHTML = `
      <div class="user-bar-profile">
        <span class="user-bar-avatar">${escapeHtml((u.display_name || u.username || '?').slice(0, 1))}</span>
        <div class="user-bar-text">
          <strong>${escapeHtml(u.display_name || u.username)} <span class="user-bar-role">管理员</span></strong>
          <small>@${escapeHtml(u.username)}</small>
        </div>
      </div>
      <button type="button" class="user-bar-logout" id="user-logout-btn">退出</button>
    `;
    $('#user-logout-btn')?.addEventListener('click', () => {
      flushPracticeTimer();
      clearAuth();
      renderNav();
      if (AUTH_ROUTES.has(state.route) || state.route === 'explain') navigate('auth');
      else renderUserBar();
    });
    return;
  }

  const prof = getUserProficiency(u);
  const prog = getProficiencyProgress(u);
  const stageTag = prof === 'regular'
    ? '<span class="user-stage-tag is-veteran">老手</span>'
    : '<span class="user-stage-tag is-newbie">新手</span>';
  const progressHtml = prog && prof === 'newbie' ? `
    <div class="user-stage-progress" title="需满 ${prog.needSessions} 场模拟对话，且累计练习满 ${Math.round(prog.needMs / 60000)} 分钟，才自动成为老手">
      <div class="user-stage-progress-head">
        <span>升级进度</span>
        <strong>${prog.overall}%</strong>
      </div>
      <div class="user-stage-row">
        <div class="user-stage-row-label">
          <span>对话场次</span>
          <em>${prog.sessionCount}/${prog.needSessions}</em>
        </div>
        <div class="user-stage-progress-track" aria-hidden="true">
          <div class="user-stage-progress-fill is-sessions" style="width:${prog.sessionPct}%"></div>
        </div>
      </div>
      <div class="user-stage-row">
        <div class="user-stage-row-label">
          <span>练习时长</span>
          <em>${formatDurationShort(prog.practiceMs)} / ${Math.round(prog.needMs / 60000)}分</em>
        </div>
        <div class="user-stage-progress-track" aria-hidden="true">
          <div class="user-stage-progress-fill is-time" style="width:${prog.timePct}%"></div>
        </div>
      </div>
      <p class="user-stage-progress-meta">两项都满才会变成老手 · 登录直达模拟对话</p>
    </div>` : (prog && prof === 'regular' ? `
    <p class="user-stage-veteran-note">已达老手：登录直达模拟对话</p>
  ` : '');
  el.innerHTML = `
    <div class="user-bar-profile">
      <span class="user-bar-avatar">${escapeHtml((u.display_name || u.username || '?').slice(0, 1))}</span>
      <div class="user-bar-text">
        <strong>${escapeHtml(u.display_name || u.username)} ${stageTag}</strong>
        <small>@${escapeHtml(u.username)}</small>
      </div>
    </div>
    ${progressHtml}
    <button type="button" class="user-bar-logout" id="user-logout-btn">退出</button>
  `;
  $('#user-logout-btn')?.addEventListener('click', () => {
    flushPracticeTimer();
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
        <p class="auth-sub">新账号为<strong>新手</strong>（先进使用手册）。模拟对话满 ${UX_VETERAN_SESSIONS} 场且累计练习满 ${Math.round(UX_VETERAN_DURATION_MS / 60000)} 分钟后自动成为<strong>老手</strong>，登录直达模拟对话。记录<strong>仅自己可见</strong>。</p>
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
              <button type="button" class="auth-quick-btn" data-fill-user="newbie" data-fill-pass="Newbie2026">新手 · newbie</button>
            </div>
          </div>
        ` : ''}
        <p class="auth-foot">无需登录也可浏览使用手册与病例资料。练对话请登录学员账号。</p>
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
  const prof = isAdminUser(state.auth.user) ? 'admin' : getUserProficiency();
  container.innerHTML = routes.map((r) => {
    const isPrimary = (prof === 'newbie' && r.id === 'guide')
      || (prof === 'regular' && r.id === 'practice');
    const badge = (prof === 'newbie' && r.id === 'guide')
      ? '<em class="nav-badge">新手</em>'
      : ((prof === 'regular' && r.id === 'practice') ? '<em class="nav-badge nav-badge--go">开练</em>' : '');
    return `<button class="nav-btn ${state.route === r.id ? 'active' : ''}${isPrimary ? ' is-primary-path' : ''}" data-route="${r.id}">
      ${ICONS[r.id] || ''}<span>${r.label}</span>${badge}
    </button>`;
  }).join('');
  container.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
}

function renderNav() {
  const routes = isAdminUser(state.auth.user)
    ? [...STUDENT_ROUTES_BASE, ...ADMIN_NAV]
    : studentRoutesForNav();
  const nav = $('#nav');
  renderNavButtons(routes, nav);
  const label = document.querySelector('.nav-label');
  if (label) {
    if (isAdminUser(state.auth.user)) label.textContent = '功能导航';
    else {
      const prof = getUserProficiency();
      label.textContent = prof === 'regular' ? '老手路径 · 优先模拟对话' : '新手路径 · 优先使用手册';
    }
  }
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
  if (!raw) {
    // 无 hash：按熟练度落地（新手手册 / 熟手练习 / 管理端病例）
    return { route: defaultRouteForUser(state.auth.user), section: null };
  }
  if (raw === 'admin') return { route: 'admin-cases', section: null };
  if (raw === 'explain') return { route: 'explain', section: 'overview' };
  if (raw.startsWith('explain-')) {
    const section = raw.slice(8);
    if (EXPLAIN_SECTIONS.some((s) => s.id === section)) {
      return { route: 'explain', section };
    }
    return { route: 'explain', section: 'overview' };
  }
  // 学员 / 管理主路由优先，避免被 LEGACY_TO_EXPLAIN 误伤（曾把 practice 导去系统功能）
  if (STUDENT_ROUTES.some((r) => r.id === raw) || ADMIN_NAV.some((r) => r.id === raw)) {
    return { route: raw, section: null };
  }
  if (raw === 'auth') return { route: 'auth', section: null };
  if (LEGACY_TO_EXPLAIN[raw]) return { route: 'explain', section: LEGACY_TO_EXPLAIN[raw] };
  return { route: 'guide', section: null };
}

let navFromHash = false;

function navEntryLabel(entry) {
  if (!entry) return '使用手册';
  if (entry.route === 'explain') {
    const sec = EXPLAIN_SECTIONS.find((s) => s.id === entry.section);
    return sec ? `系统功能 · ${sec.label}` : '系统功能';
  }
  return [...STUDENT_ROUTES, ...ADMIN_NAV].find((r) => r.id === entry.route)?.label || '上一页';
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
  const isPrimaryRoute = STUDENT_ROUTES.some((r) => r.id === route)
    || ADMIN_NAV.some((r) => r.id === route)
    || route === 'auth'
    || route === 'admin';
  if (!isPrimaryRoute && LEGACY_TO_EXPLAIN[route]) {
    section = LEGACY_TO_EXPLAIN[route];
    route = 'explain';
  }
  if (AUTH_ROUTES.has(route) && !isAuthenticated()) {
    state.auth.error = '';
    route = 'auth';
    section = null;
  }
  // 管理端 / 系统功能仅管理员
  if ((route === 'admin' || route === 'admin-cases' || route === 'admin-users' || route === 'explain') && !isAdminUser(state.auth.user)) {
    if (!isAuthenticated()) {
      state.auth.error = '请先登录管理员账号';
      route = 'auth';
    } else {
      state.auth.error = '';
      route = 'guide';
    }
    section = null;
  }
  if (route === 'admin') route = 'admin-cases';
  if (route === 'explain' && !section) {
    section = state.explainSection || 'overview';
  }
  const prevRoute = state.route;
  const prevSection = state.explainSection;
  if (prevRoute === 'practice' && route !== 'practice') {
    flushPracticeTimer();
  }
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
  document.body.classList.toggle('auth-focus', route === 'auth');
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
  if (route === 'admin' || route === 'admin-cases' || route === 'admin-users') {
    adminCtrl.loadAll().then(() => {
      if (state.route === 'admin' || state.route === 'admin-cases' || state.route === 'admin-users') renderView();
    }).catch(() => {});
  }
}

function switchExplainSection(id) {
  if (!EXPLAIN_SECTIONS.some((s) => s.id === id)) return;
  navigate('explain', id);
  $('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(html, opts = {}) {
  modalBody.innerHTML = html;
  modal.querySelector('.modal-panel')?.classList.toggle('case-modal-wide', !!opts.wide);
  modal.querySelector('.modal-panel')?.classList.toggle('modal-panel--status', !!opts.status);
  modal.classList.toggle('is-locked', !!opts.lock);
  modal.querySelector('.modal-close')?.toggleAttribute('hidden', !!opts.lock);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal({ force = false } = {}) {
  if (modal.classList.contains('is-locked') && !force) return;
  modal.classList.remove('is-locked');
  modal.querySelector('.modal-panel')?.classList.remove('case-modal-wide');
  modal.querySelector('.modal-panel')?.classList.remove('modal-panel--status');
  modal.querySelector('.modal-close')?.removeAttribute('hidden');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function showPracticeLoadingModal() {
  openModal(`
    <div class="practice-status-modal" role="status" aria-live="polite">
      <div class="practice-status-spinner" aria-hidden="true"></div>
      <h2>正在生成练习反馈</h2>
      <p>系统正在对照规范清单评分，通常需要十几秒到几十秒，请稍候…</p>
      <p class="practice-status-note">请勿关闭页面</p>
    </div>
  `, { lock: true, status: true });
}

function showPracticeAlertModal(title, message) {
  openModal(`
    <div class="practice-status-modal is-alert">
      <div class="practice-status-icon" aria-hidden="true">!</div>
      <h2>${escapeHtml(title || '提示')}</h2>
      <p>${escapeHtml(message || '')}</p>
      <button type="button" class="practice-status-ok" data-practice-status-ok>知道了</button>
    </div>
  `, { status: true });
  modalBody.querySelector('[data-practice-status-ok]')?.addEventListener('click', () => closeModal({ force: true }));
}

/** 站内确认框（替代 window.confirm） */
function confirmDialog(message, opts = {}) {
  const title = opts.title || '请确认';
  const okText = opts.okText || '确定';
  const cancelText = opts.cancelText || '取消';
  const danger = opts.danger !== false;
  return new Promise((resolve) => {
    openModal(`
      <div class="practice-status-modal is-alert">
        <div class="practice-status-icon" aria-hidden="true">!</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message || '')}</p>
        <div class="admin-confirm-actions">
          <button type="button" class="admin-btn" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="admin-btn ${danger ? 'danger' : 'primary'}" data-confirm-ok>${escapeHtml(okText)}</button>
        </div>
      </div>
    `, { lock: true, status: true });
    const finish = (val) => {
      closeModal({ force: true });
      resolve(val);
    };
    modalBody.querySelector('[data-confirm-ok]')?.addEventListener('click', () => finish(true));
    modalBody.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => finish(false));
  });
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
  guarded: '有所保留',
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

const TTS_EMOTION_LABEL = {
  neutral: '语气平稳',
  happy: '语气放松',
  sad: '语气低落',
  angry: '语气冲',
  calm: '语气平静',
  fearful: '语气发慌',
  surprised: '语气惊讶',
};

function affectChipHtml(affect, { tone = 'gal' } = {}) {
  if (!affect) return '';
  const mood = affect.stance_label || STANCE_LABEL_MAP[affect.stance] || '';
  const emo = affect.emotion_label || TTS_EMOTION_LABEL[affect.tts_emotion] || '';
  const trust = affect.trust != null ? trustHumanLabel(affect.trust) : '';
  const depth = affect.depth_label || '';
  const pill = tone === 'transcript' ? 'transcript-affect-pill' : 'gal-affect-pill';
  const wrap = tone === 'transcript' ? 'transcript-line-affect' : 'gal-line-affect';
  const bits = [
    mood ? `<span class="${pill} mood">${escapeHtml(mood)}</span>` : '',
    emo ? `<span class="${pill} emo">${escapeHtml(emo)}</span>` : '',
    trust ? `<span class="${pill} trust">信任：${escapeHtml(trust)}</span>` : '',
    depth ? `<span class="${pill} depth">${escapeHtml(depth)}</span>` : '',
  ].filter(Boolean);
  if (!bits.length) return '';
  const title = affect._inferred
    ? '本轮情绪（旧会话无日志，按话术推断）'
    : '本轮受试者情绪与沟通状态';
  return `<div class="${wrap}" title="${title}">${bits.join('')}</div>`;
}

function resolveMessageAffect(message, messages) {
  if (message?.affect) return message.affect;
  if (message?.role !== 'patient') return null;
  // 旧会话无 emotion_log：用当前会话态或文本推断兜底
  const inferred = inferAffectFromDialogue(null, [message]);
  return {
    stance: inferred.stance,
    stance_label: inferred.stance_label,
    trust: inferred.trust,
    depth_label: inferred.depth_label,
    emotion_label: TTS_EMOTION_LABEL.neutral,
    _inferred: true,
  };
}

function buildEmotionTransitionHtml(messages, patientAffect) {
  const patientMsgs = (messages || []).filter((m) => m.role === 'patient');
  if (patientMsgs.length < 2 && !patientAffect) return '';
  const last = patientMsgs[patientMsgs.length - 1];
  const prev = patientMsgs[patientMsgs.length - 2];
  const curA = resolveMessageAffect(last, messages) || patientAffect || {};
  const prevA = prev ? resolveMessageAffect(prev, messages) : null;
  const curLabel = curA.stance_label || STANCE_LABEL_MAP[curA.stance] || '—';
  const curEmo = curA.emotion_label || TTS_EMOTION_LABEL[curA.tts_emotion] || '';
  if (!prevA) {
    return `
      <div class="live-rail-emotion-shift">
        <span class="live-rail-label">情绪轨迹</span>
        <p>当前：<strong>${escapeHtml(curLabel)}</strong>${curEmo ? ` · ${escapeHtml(curEmo)}` : ''}</p>
      </div>`;
  }
  const prevLabel = prevA.stance_label || STANCE_LABEL_MAP[prevA.stance] || '—';
  const prevEmo = prevA.emotion_label || TTS_EMOTION_LABEL[prevA.tts_emotion] || '';
  const changed = prevLabel !== curLabel || prevEmo !== curEmo;
  return `
    <div class="live-rail-emotion-shift${changed ? ' is-changed' : ''}">
      <span class="live-rail-label">情绪转变</span>
      <p>
        <span>${escapeHtml(prevLabel)}${prevEmo ? `（${escapeHtml(prevEmo)}）` : ''}</span>
        <span class="live-rail-arrow" aria-hidden="true">→</span>
        <strong>${escapeHtml(curLabel)}${curEmo ? `（${escapeHtml(curEmo)}）` : ''}</strong>
      </p>
      ${changed ? '<small>本轮相对上一句有变化，可对照对话气泡上的标签</small>' : '<small>相对上一句情绪较稳</small>'}
    </div>`;
}

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
  if (stance === 'defensive' || /什么意思|骗人|忽悠|别生气/.test(t)) {
    return '可能觉得被批评或被冒犯了，宜先道歉/安抚，再具体追问';
  }
  if (stance === 'withdrawn') return '不太想继续深入，建议放慢节奏、先倾听与安抚';
  if (stance === 'guarded' || /担心|副作用|怎么办|严不严重/.test(t)) {
    return '还有顾虑，需要更具体、诚实的说明；别催、别压';
  }
  if (stance === 'cooperative') return '愿意继续听您讲，可按检查点逐项说明';
  if (stance === 'relieved') return '紧张感有所缓解，可顺势追问具体日期与细节';
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

  if (!affect.emotion_label) {
    affect.emotion_label = TTS_EMOTION_LABEL[affect.tts_emotion]
      || (affect.stance === 'defensive' ? TTS_EMOTION_LABEL.angry
        : affect.stance === 'relieved' || affect.stance === 'cooperative' ? TTS_EMOTION_LABEL.happy
          : affect.stance === 'withdrawn' ? TTS_EMOTION_LABEL.sad
            : affect.stance === 'guarded' ? TTS_EMOTION_LABEL.fearful
              : TTS_EMOTION_LABEL.neutral);
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
      <p class="live-rail-progress-note">随对话更新 · 下方可看检查点明细</p>
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

        ${!busy ? `
        <div class="live-rail-row live-rail-row--emotion">
          <span class="live-rail-label">表达情绪</span>
          <span class="live-rail-value">${escapeHtml(affect.emotion_label || TTS_EMOTION_LABEL[affect.tts_emotion] || '语气平稳')}</span>
        </div>` : ''}

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

        ${!busy ? buildEmotionTransitionHtml(messages, patientAffect) : ''}

        ${buildCoverageProgressHtml(messages)}

        ${affect._lastPatientSnippet && !busy ? `
          <blockquote class="live-rail-quote">${escapeHtml(affect._status)}</blockquote>` : ''}
      </div>
    </aside>`;
}

function buildGalVoiceActionsInnerHtml() {
  const v = state.voice;
  return `
    <label class="gal-voice-switch" title="开启后：受试者回复会朗读；你也可点输入框旁「说话」用语音输入">
      <input type="checkbox" id="voice-toggle" ${v.enabled ? 'checked' : ''} />
      <span class="gal-voice-switch-ui" aria-hidden="true"></span>
      <span class="gal-voice-switch-text">语音模式</span>
    </label>
    ${v.enabled ? `
      <label class="gal-voice-autosend" title="识别结束后自动发送">
        <input type="checkbox" id="voice-autosend" ${v.autoSend ? 'checked' : ''} />
        <span>说完发送</span>
      </label>
      <button type="button" class="gal-action-btn gal-action-btn--ghost" id="voice-pause-btn" ${v.speaking ? '' : 'disabled'} title="暂停受试者正在播放的语音">暂停旁白</button>
    ` : ''}`;
}

function buildGalMicButtonHtml() {
  const v = state.voice;
  const hot = !!v.listening;
  const busy = !!(v.speaking || v.processing);
  return `
    <button type="button"
      class="gal-mic-btn ${hot ? 'is-hot' : ''} ${v.enabled ? '' : 'is-off'}"
      id="voice-mic-btn"
      title="${hot ? '停止语音输入' : (v.enabled ? '开始语音输入（说完再点停止）' : '点此开启语音模式并开始说话')}"
      ${busy ? 'disabled' : ''}>
      ${hot ? '停止' : '说话'}
    </button>`;
}

function bindGalVoiceMicPause() {
  $('#voice-mic-btn')?.addEventListener('click', async () => {
    if (state.voice.listening) {
      voiceCtrl.stopListening({ commit: true });
      return;
    }
    if (!state.voice.enabled) {
      await voiceCtrl.setEnabled(true);
      patchGalVoiceActions();
    }
    if (!state.voice.speechRecognition) {
      showPracticeAlertModal('语音不可用', '当前浏览器不支持语音识别，请用 Chrome / Edge，并允许麦克风权限。');
      return;
    }
    const input = $('#chat-input');
    state.voice.inputBase = (input?.value || '').trim();
    const ok = voiceCtrl.startListening();
    if (!ok && state.voice.error) {
      showPracticeAlertModal('语音不可用', state.voice.error);
    }
    const statusEl = $('#voice-status-live');
    if (statusEl) statusEl.textContent = voiceStatusText();
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
  const autosend = $('#voice-autosend');
  if (autosend) {
    autosend.onchange = (e) => {
      state.voice.autoSend = e.target.checked;
    };
  }
  bindGalVoiceMicPause();
}

function patchGalVoiceActions() {
  const slot = document.querySelector('.gal-voice-actions');
  if (slot) {
    slot.innerHTML = buildGalVoiceActionsInnerHtml();
  }
  const micSlot = document.querySelector('.gal-mic-slot');
  if (micSlot) {
    micSlot.innerHTML = buildGalMicButtonHtml();
  }
  bindGalVoiceControls();
  const statusEl = $('#voice-status-live');
  if (statusEl) statusEl.textContent = voiceStatusText();
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

function patchLeftStackCollapsed() {
  const open = state.practice.leftStackOpen !== false;
  const wrap = document.querySelector('.practice-gal-wrap');
  const stack = document.querySelector('.practice-left-stack');
  wrap?.classList.toggle('is-left-stack-collapsed', !open);
  stack?.classList.toggle('is-collapsed', !open);
  const collapseBtn = $('#practice-left-collapse');
  if (collapseBtn) {
    collapseBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    collapseBtn.title = open ? '收起左侧面板' : '展开左侧面板';
    collapseBtn.textContent = open ? '收起' : '展开';
  }
  const toggleBtn = $('#practice-left-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('is-active', open);
    toggleBtn.title = open ? '收起左侧面板' : '展开左侧面板';
    toggleBtn.textContent = open ? '收起侧栏' : '展开侧栏';
  }
  const fab = $('#practice-left-expand-fab');
  if (fab) fab.hidden = open;
}

function setLeftStackOpen(open) {
  state.practice.leftStackOpen = !!open;
  localStorage.setItem('practiceLeftStackOpen', open ? '1' : '0');
  patchLeftStackCollapsed();
}

function patchCheckpointRail() {
  const engagement = state.engagementMode || 'practice';
  if (engagement !== 'practice' && engagement !== 'assessment') return;
  if (!state.practice.sessionId || state.practice.status === 'completed') return;
  const html = `
    <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
      ${buildCheckpointPanelHtml(state.practice.messages, { engagement })}
    </aside>`;
  const rail = $('#practice-checkpoint-drawer');
  if (rail) {
    rail.outerHTML = html;
  } else {
    const stack = document.querySelector('.practice-left-stack');
    if (stack) stack.insertAdjacentHTML('beforeend', html);
    else $('#digital-human-mount')?.insertAdjacentHTML('afterend', html);
  }
  document.querySelector('.practice-gal-wrap')?.classList.add('has-checkpoint-rail', 'is-checkpoint-open');
}

const GAL_DIALOG_H_KEY = 'aisp.galDialogHeightPx';

function getStoredGalDialogHeight() {
  try {
    const n = Number(localStorage.getItem(GAL_DIALOG_H_KEY));
    return Number.isFinite(n) && n >= 240 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

function applyGalDialogHeight(glass, heightPx) {
  if (!glass) return;
  if (heightPx == null) {
    glass.style.height = '';
    glass.style.maxHeight = '';
    glass.classList.remove('is-user-sized');
    return;
  }
  const clamped = Math.max(240, Math.min(Math.round(window.innerHeight * 0.88), Math.round(heightPx)));
  glass.style.height = `${clamped}px`;
  glass.style.maxHeight = `${clamped}px`;
  glass.classList.add('is-user-sized');
}

function bindGalDialogResize() {
  const glass = document.querySelector('.gal-dialog-glass');
  const handle = $('#gal-dialog-resize');
  if (!glass || !handle) return;
  applyGalDialogHeight(glass, getStoredGalDialogHeight());
  if (handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';

  let startY = 0;
  let startH = 0;
  const onMove = (e) => {
    const y = e.clientY;
    const next = startH + (startY - y);
    applyGalDialogHeight(glass, next);
  };
  const onUp = () => {
    glass.classList.remove('is-resizing');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    try {
      const h = Math.round(glass.getBoundingClientRect().height);
      localStorage.setItem(GAL_DIALOG_H_KEY, String(h));
    } catch { /* ignore */ }
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture?.(e.pointerId);
    startY = e.clientY;
    startH = glass.getBoundingClientRect().height;
    glass.classList.add('is-resizing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', () => {
    try { localStorage.removeItem(GAL_DIALOG_H_KEY); } catch { /* ignore */ }
    applyGalDialogHeight(glass, null);
  });
}

function patchFeedExpanded() {
  const expanded = !!state.practice.feedExpanded;
  const feed = $('#chat-panel');
  feed?.classList.toggle('is-expanded', expanded);
  const btn = $('#practice-feed-expand');
  if (btn) btn.textContent = expanded ? '收起对话框' : '展开全部对话';
  const glass = document.querySelector('.gal-dialog-glass');
  if (glass) glass.classList.toggle('is-feed-expanded', expanded);
  const meta = document.querySelector('.gal-dialog-feed-meta span');
  if (meta) {
    const n = (state.practice.messages || []).filter((m) => m.role !== 'system').length;
    meta.textContent = expanded
      ? `对话 ${n} 条 · 已展开，可上滑看更早内容 · 拖顶边调高度`
      : `对话 ${n} 条 · 上滑可看历史 · 拖顶边可调高度`;
  }
  // 展开时滚到顶部，避免只见最后一句误以为「没有历史」
  requestAnimationFrame(() => {
    if (!feed) return;
    if (expanded) feed.scrollTop = 0;
    else scrollChatFeedToEnd();
  });
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

function resolveGuideAudience() {
  if (!isAdminUser(state.auth.user)) return 'trainee';
  const stored = localStorage.getItem('aisp_guide_audience');
  if (stored === 'trainee' || stored === 'admin') return stored;
  return 'admin';
}

function setGuideAudience(audience) {
  state.guideAudience = audience === 'admin' ? 'admin' : 'trainee';
  localStorage.setItem('aisp_guide_audience', state.guideAudience);
}

function renderGuideSections(sections, startNum = 6) {
  return (sections || []).map((sec, i) => {
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
        <h3><span class="guide-num">${startNum + i}</span>${escapeHtml(sec.title)}</h3>
        ${body}
      </section>`;
  }).join('');
}

function renderGuidePageFigures(pages) {
  return (pages || []).map((pg, i) => `
    <figure class="guide-figure guide-page-figure">
      ${pg.image ? `<img src="${escapeHtml(pg.image)}" alt="${escapeHtml(pg.title)}" loading="lazy" decoding="async" />` : ''}
      <figcaption>
        <span class="guide-page-nav">${escapeHtml(pg.nav || '')}</span>
        <strong>${i + 1}. ${escapeHtml(pg.title)}</strong>
        <p>${escapeHtml(pg.meaning || '')}</p>
        ${(pg.points || []).length ? `<ul>${pg.points.map((p) => `<li>${formatText(p)}</li>`).join('')}</ul>` : ''}
      </figcaption>
    </figure>`).join('');
}

function renderGuideAudienceTabs(active) {
  if (!isAdminUser(state.auth.user)) return '';
  return `
    <div class="guide-audience-tabs" role="tablist" aria-label="手册类型">
      <button type="button" class="guide-audience-tab ${active === 'trainee' ? 'is-active' : ''}" data-guide-audience="trainee" role="tab">
        学员端手册
      </button>
      <button type="button" class="guide-audience-tab ${active === 'admin' ? 'is-active' : ''}" data-guide-audience="admin" role="tab">
        管理端手册
      </button>
    </div>`;
}

function bindGuideActions(rootEl) {
  rootEl.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.goto;
      if (btn.hasAttribute('data-mark-guide-done')) markGuideCompleted();
      if (target.startsWith('explain-')) {
        // 学员端不进「系统功能」展示页；评分说明落在手册检查点
        if (!isAdminUser(state.auth.user)) {
          navigate('guide');
          requestAnimationFrame(() => {
            document.getElementById('guide-checkpoints')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          return;
        }
        navigate('explain', target.slice(8));
        return;
      }
      navigate(target);
    });
  });
  rootEl.querySelectorAll('[data-guide-audience]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setGuideAudience(btn.dataset.guideAudience);
      renderGuide();
    });
  });
  rootEl.querySelectorAll('[data-guide-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.guideScroll;
      const el = key === 'checkpoints'
        ? document.getElementById('guide-checkpoints')
        : document.getElementById(key);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderTraineeGuide(g) {
  const theme = g.theme || {};
  const scenarios = g.scenarios || [];
  const expressions = g.expressions || [];
  const modes = g.modes || theme.modes || [];
  const icCheckpoints = buildCheckpointDefsForScene('informed_consent');
  const fuCheckpoints = buildCheckpointDefsForScene('follow_up');
  const isNewbie = getUserProficiency() === 'newbie';

  return `
    ${renderGuideAudienceTabs('trainee')}
    <div class="guide-hero manual-hero guide-theme-hero">
      <p class="hero-eyebrow">Clinical Trial Communication Simulator · 学员端</p>
      <h3>${escapeHtml(theme.headline || g.title)}</h3>
      <p>${escapeHtml(theme.subline || '')}</p>
      ${isNewbie ? `
        <p class="guide-proficiency-banner">你是<strong>新手</strong>（对话未满 ${UX_VETERAN_SESSIONS} 场或练习时长未满 ${Math.round(UX_VETERAN_DURATION_MS / 60000)} 分钟）。请先看完手册再开练；左侧进度条会显示距<strong>老手</strong>还差多少。达标后登录将直达模拟对话。</p>
      ` : `
        <p class="guide-proficiency-banner is-regular">你已是<strong>老手</strong>：日常开练请进「模拟对话」；手册可随时查阅。</p>
      `}
    </div>

    <section class="guide-section">
      <h3><span class="guide-num">①</span>先认页面（左侧导航地图）</h3>
      <p>打开系统后，左侧菜单就是产品地图。建议按下面顺序认识，再开始练习。</p>
      <div class="guide-nav-map">
        ${[
          ['使用手册', '你正在这里：认页面、认场景'],
          ['模拟对话', '主战场：选人 → 看档案 → 开练'],
          ['对话记录', '找回历史会话，继续或回看'],
          ['练习反馈', '对照清单与参考分复盘'],
          ['病例详情资料', '备考资料库，不是开练入口'],
        ].map(([name, desc]) => `
          <div class="guide-nav-map-item">
            <strong>${name}</strong>
            <span>${desc}</span>
          </div>`).join('')}
      </div>
      <div class="guide-page-stack">${renderGuidePageFigures(g.pages)}</div>
    </section>

    <section class="guide-section">
      <h3><span class="guide-num">②</span>业务场景：你在练什么局</h3>
      <p>同一套界面，会落到两种真实业务沟通。开练档案右卡的「练习任务」会随场景切换。</p>
      <div class="guide-scenario-grid">
        ${scenarios.map((sc) => `
          <article class="guide-scenario-card">
            <strong>${escapeHtml(sc.title)}</strong>
            <p>${escapeHtml(sc.summary || '')}</p>
            ${sc.who ? `<p class="guide-scenario-who"><em>典型受试者：</em>${escapeHtml(sc.who)}</p>` : ''}
            ${(sc.focus || []).length ? `<ul class="guide-list">${sc.focus.map((f) => `<li>${formatText(f)}</li>`).join('')}</ul>` : ''}
          </article>`).join('')}
      </div>
      <div class="guide-mode-cards">
        ${modes.map((m) => `
          <div class="guide-mode-card">
            <strong>${escapeHtml(m.label)}</strong>
            <p>${escapeHtml(m.desc)}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="guide-section">
      <h3><span class="guide-num">③</span>这些页面在表达什么</h3>
      <div class="guide-express-list">
        ${expressions.map((ex) => `
          <div class="guide-express-item">
            <strong>${escapeHtml(ex.title)}</strong>
            <p>${formatText(ex.content)}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="guide-section guide-goal-section">
      <h3><span class="guide-num">④</span>${escapeHtml(theme.goalTitle || '练完要达成什么')}</h3>
      <ul class="guide-list guide-goal-list">
        ${(theme.goals || []).map((p) => `<li>${formatText(p)}</li>`).join('')}
      </ul>
    </section>

    <section class="guide-section guide-checkpoint-section" id="guide-checkpoints">
      <h3><span class="guide-num">⑤</span>${escapeHtml(g.checkpointIntro?.title || '沟通检查点')}</h3>
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
          <h4>随访沟通 · ${fuCheckpoints.length} 项</h4>
          <ol class="guide-checkpoint-list">
            ${fuCheckpoints.map((c, i) => `
              <li><span class="guide-cp-num">${i + 1}</span>
                <div><strong>${escapeHtml(c.title)}</strong><span>${escapeHtml(c.hint)}</span></div>
              </li>`).join('')}
          </ol>
        </div>
      </div>
    </section>

    ${renderGuideSections(g.sections, 6)}

    <div class="guide-cta">
      <button type="button" data-goto="practice" data-mark-guide-done>已了解，开始模拟对话</button>
      <button type="button" class="secondary" data-guide-scroll="checkpoints">先看沟通检查点</button>
    </div>`;
}

function renderAdminGuide(ag) {
  const theme = ag.theme || {};
  const workflows = ag.workflows || [];
  const expressions = ag.expressions || [];
  const draftStatuses = ag.draftStatuses || [];

  return `
    ${renderGuideAudienceTabs('admin')}
    <div class="guide-hero manual-hero guide-theme-hero guide-theme-hero--admin">
      <p class="hero-eyebrow">Admin Console · 管理端</p>
      <h3>${escapeHtml(theme.headline || ag.title)}</h3>
      <p>${escapeHtml(theme.subline || '')}</p>
    </div>

    <section class="guide-section">
      <h3><span class="guide-num">①</span>管理端导航地图</h3>
      <p>管理员登录后，左侧在学员入口之下还有管理区。日常加病例请进「病例与场景」。</p>
      <div class="guide-nav-map guide-nav-map--admin">
        ${(ag.navMap || []).map(([name, desc]) => `
          <div class="guide-nav-map-item">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(desc)}</span>
          </div>`).join('')}
      </div>
      <div class="guide-page-stack">${renderGuidePageFigures(ag.pages)}</div>
    </section>

    <section class="guide-section">
      <h3><span class="guide-num">②</span>三种添加路径（最后都进同一审核页）</h3>
      <p>本期只能挂 <strong>知情同意</strong> 或 <strong>随访（询问）</strong>。选错场景会导致学员练错清单。</p>
      <div class="guide-workflow-grid">
        ${workflows.map((wf) => `
          <article class="guide-workflow-card">
            <strong>${escapeHtml(wf.title)}</strong>
            <div class="guide-steps">
              ${(wf.steps || []).map((st) => `
                <div class="guide-step"><strong>${escapeHtml(st.label)}</strong><span>${escapeHtml(st.desc)}</span></div>
              `).join('')}
            </div>
          </article>`).join('')}
      </div>
    </section>

    <section class="guide-section">
      <h3><span class="guide-num">③</span>草稿箱状态说明</h3>
      <div class="guide-draft-status-grid">
        ${draftStatuses.map((ds) => `
          <div class="guide-draft-status">
            <span class="status-pill ${ds.status === 'published' ? 'ok' : 'warn'}">${escapeHtml(ds.label)}</span>
            <p>${escapeHtml(ds.desc || '')}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="guide-section">
      <h3><span class="guide-num">④</span>常见问题（管理端）</h3>
      <div class="guide-express-list">
        ${expressions.map((ex) => `
          <div class="guide-express-item">
            <strong>${escapeHtml(ex.title)}</strong>
            <p>${formatText(ex.content)}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="guide-section guide-goal-section">
      <h3><span class="guide-num">⑤</span>${escapeHtml(theme.goalTitle || '管理端职责')}</h3>
      <ul class="guide-list guide-goal-list">
        ${(theme.goals || []).map((p) => `<li>${formatText(p)}</li>`).join('')}
      </ul>
    </section>

    ${renderGuideSections(ag.sections, 6)}

    <div class="guide-cta">
      <button type="button" data-goto="admin-cases">去添加病例</button>
      <button type="button" class="secondary" data-goto="admin-users">账号管理</button>
    </div>`;
}

function renderGuide() {
  const g = state.guide;
  if (!g) {
    setPage('使用手册', '加载中…');
    viewEl.innerHTML = '<div class="empty"><p>正在加载使用手册…</p></div>';
    return;
  }

  const audience = resolveGuideAudience();
  state.guideAudience = audience;
  const isAdminGuide = audience === 'admin' && g.admin;
  setPage('使用手册', isAdminGuide
    ? '病例接入、审核发布与账号管理'
    : (getUserProficiency() === 'newbie'
      ? '新手：先认清页面与检查点，再去模拟对话'
      : '熟手也可随时查阅；日常开练请进模拟对话'));

  viewEl.innerHTML = isAdminGuide ? renderAdminGuide(g.admin) : renderTraineeGuide(g);
  bindGuideActions(viewEl);
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
  const stds = state.standards?.standards || [];
  const mvpItems = (state.rubric?.items || []).filter((i) => i.enabledMvp);
  const fuItems = (state.rubricFollowup?.items || []).filter((i) => i.enabledMvp);
  const diseases = state.casesIndex?.diseases || [];
  const casesN = diseases.reduce((n, d) => n + ((d.cases || []).length), 0);
  const scenesLive = (state.scenes?.scenes || []).filter((s) => s.status === 'mvp' || s.status === 'beta');

  return `
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">现在这套系统在练什么</div>
      <p>学员与 <strong>AI 受试者</strong>做知情同意 / 随访沟通；结束后看<strong>规范清单</strong>（主）和<strong>练习参考分 0–100</strong>（辅）。语音、Live2D、情绪旁白是增强项，可关。</p>
    </div>

    <div class="stats-grid">
      ${statCard(scenesLive.length, '已启用场景', '#0f766e', '<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/>')}
      ${statCard(mvpItems.length + fuItems.length, '评分检查项', '#2563eb', '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>')}
      ${statCard(stds.length, '纳入标准', '#7c3aed', '<path d="M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z"/>')}
      ${statCard(casesN || '—', '试验病例', '#d97706', '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>')}
    </div>

    <div class="section-head">
      <h3 class="section-title">学员主路径</h3>
      <span class="section-sub">手册 → 选人 → 对话 → 结束 → 反馈</span>
    </div>
    <div class="arch-grid">
      <div class="arch-block">
        <h4>练习模式</h4>
        <ul>
          <li>可多次新建对话，历史评分保留</li>
          <li>可开参考模式查阅病例摘要</li>
          <li>侧栏可见心情 / 进度（练习）</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>考核模式</h4>
        <ul>
          <li>严格模式，不宜开参考</li>
          <li>同受试者同时仅一场进行中</li>
          <li>结束后可「重新考核」新开一场</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>反馈怎么读</h4>
        <ul>
          <li>先看清单大类 pass / fail</li>
          <li>再看练习参考分与维度</li>
          <li>红线项 fail → 综合未达标</li>
        </ul>
      </div>
      <div class="flow-banner">选受试者 → 模拟对话 → 结束练习 → 练习反馈 →（可选）再练一次</div>
    </div>

    <div class="section-head">
      <h3 class="section-title">两套底座</h3>
      <span class="section-sub">评得对 + 演得对</span>
    </div>
    <div class="arch-grid">
      <div class="arch-block">
        <h4>标准与评分</h4>
        <ul>
          <li>标准资料库（${stds.length} 项）</li>
          <li>知情同意清单 ${mvpItems.length} 条 · 随访清单 ${fuItems.length} 条</li>
          <li>术语统一叫法（见「术语表」）</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>病例与受试者</h4>
        <ul>
          <li>病种 → 试验 → 受试者三级资料</li>
          <li>AI 只能基于病例事实说话</li>
          <li>管理端「病例与场景」可导入维护</li>
        </ul>
      </div>
    </div>

    <div class="guide-cta" style="margin-top:8px">
      <button type="button" data-goto="practice">去模拟对话</button>
      <button type="button" class="secondary" data-section="practice">下一步：练习与考核说明</button>
    </div>
  `;
}

function buildPracticeGuideHtml() {
  return `
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">对话页在干什么</div>
      <p>你扮演研究者，对面是 AI 受试者。系统按<strong>场景 + 人设 + 情绪状态</strong>约束回复；结束时对照清单评分。语音朗读可关，纯文字也能完整练。</p>
    </div>

    <div class="scoring-guide-grid">
      <div class="arch-block">
        <h4>开始与继续</h4>
        <ul class="guide-list compact">
          <li>先选受试者（如李建国、张大爷）</li>
          <li>「继续刚才的对话」= 当前受试者最近一场<strong>未结束</strong>练习</li>
          <li>「开始新练习 / 重新考核」= <strong>新建</strong>一场，旧评分保留</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>情绪与语音</h4>
        <ul class="guide-list compact">
          <li>责备 / 安抚会影响对方配合度与话术长短</li>
          <li>语音模式开：旁白可按心情调语速、音量、句间停顿</li>
          <li>关语音：不影响评分与进度</li>
        </ul>
      </div>
      <div class="arch-block">
        <h4>结束与反馈</h4>
        <ul class="guide-list compact">
          <li>至少说一轮才能结束</li>
          <li>结束时弹窗生成反馈（可能几十秒）</li>
          <li>「练习反馈」「对话记录」可复盘历史</li>
        </ul>
      </div>
    </div>

    <div class="section-head">
      <h3 class="section-title">练习 vs 考核</h3>
    </div>
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead><tr><th></th><th>练习</th><th>考核</th></tr></thead>
          <tbody>
            <tr><td>目的</td><td>熟悉话术与清单</td><td>检验沟通表现</td></tr>
            <tr><td>参考资料</td><td>可开「参考模式」</td><td>严格模式，建议不开</td></tr>
            <tr><td>心情侧栏</td><td>可显示</td><td>建议弱化干扰</td></tr>
            <tr><td>并行场次</td><td>可多场未结束</td><td>同受试者仅一场进行中</td></tr>
            <tr><td>再来一次</td><td>新建对话，保留旧分</td><td>重新考核 = 新开一场</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="guide-cta" style="margin-top:16px">
      <button type="button" data-goto="guide">看使用手册</button>
      <button type="button" class="secondary" data-section="rubric">下一步：评分说明</button>
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
        <p>反馈<strong>先看规范清单</strong>（各检查项达标/未达标，按大类折叠）。同时给出 <strong>练习参考分 X/100</strong> 作为教学汇总（非正式认证、非问卷赋分）。并显示维度拆分与清单线。</p>
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
  with_adult_child: '与成年子女同住',
  secondary: '中学文化程度',
  primary: '小学文化程度',
  college: '大专及以上',
  anxious_mild: '轻度焦虑，听到副作用会紧张',
  anxious: '焦虑',
  calm: '情绪较平稳',
  repeats_key_questions: '关键问题会再问一遍，需要说慢一点',
  needs_slow_and_repeat: '需要放慢语速、重复确认',
  mostly_adherent: '大体能按时服药，偶有漏服',
  sometimes_forgets: '偶有漏服或忘记',
  adherent: '服药依从较好',
  average: '理解力一般',
  low: '较少隐瞒病情',
  medium: '关键点可能含糊',
  high: '可能有所隐瞒',
  normal: '听力正常',
  mild_loss: '听力略差',
  spouse_may_attend: '配偶可能会一起听',
  daughter_often_present: '女儿常陪同',
  self: '本人可以签字',
  self_with_witness: '本人签字（可有见证人）',
  retired: '退休',
  taxi_driver: '出租车司机',
};

const PERSONA_PORTRAIT_URLS = {
  'PER-HTN-TAXI-01': '/live2d/portraits/PER-HTN-TAXI-01.webp',
  'PER-ELDER-BASIC-01': '/live2d/portraits/PER-ELDER-BASIC-01.webp',
  'PER-ELDER-FEMALE-02': '/live2d/portraits/PER-ELDER-FEMALE-02.webp',
};

function personaPortraitUrl(personaId) {
  if (!personaId) return PERSONA_PORTRAIT_URLS['PER-ELDER-BASIC-01'];
  return PERSONA_PORTRAIT_URLS[personaId]
    || `/live2d/portraits/${personaId}.webp`;
}

function isPersonaTrainable(persona) {
  return Boolean(persona?.file && persona?.is_trainable !== false);
}

const PRACTICE_SCENE_GROUPS = {
  informed_consent: { label: '知情同意', order: 1 },
  follow_up: { label: '随访（询问）', order: 2 },
  adherence: { label: '依从性沟通', order: 3 },
  other: { label: '其他场景', order: 9 },
};

function resolveCaseSceneKey(caseId, caseEntry) {
  const pkg = state.casePackages?.[caseId];
  const fromPkg = pkg?.session_script?.scene_key;
  if (fromPkg) {
    // 白名单场景进固定分组；测试/新场景保留原 key，归入「其他」展示
    if (PRACTICE_SCENE_GROUPS[fromPkg]) return fromPkg;
    return fromPkg;
  }
  const codes = caseEntry?.mvp_scenes || [];
  if (codes.includes('S1')) return 'informed_consent';
  if (codes.includes('S5') || codes.includes('S4')) return 'follow_up';
  const primary = caseEntry?.primary_scene;
  if (primary && PRACTICE_SCENE_GROUPS[primary]) return primary;
  return 'other';
}

function sceneGroupLabel(sceneKey) {
  if (PRACTICE_SCENE_GROUPS[sceneKey]?.label) return PRACTICE_SCENE_GROUPS[sceneKey].label;
  if (!sceneKey || sceneKey === 'other') return '其他场景';
  return sceneKey;
}

function flattenAllPersonas() {
  const hierarchy = normalizeCasesHierarchy(state.casesIndex);
  const items = [];
  hierarchy.forEach((d) => {
    (d.cases || []).forEach((c) => {
      const sceneKey = resolveCaseSceneKey(c.case_id, c);
      const pkg = state.casePackages?.[c.case_id];
      const sceneLabel = pkg?.session_script?.scene_label
        || sceneGroupLabel(sceneKey);
      (c.personas || []).forEach((p) => {
        items.push({
          diseaseCode: d.disease_code,
          diseaseName: d.name_zh,
          caseId: c.case_id,
          caseEntry: c,
          caseTitle: c.short_title || c.title || c.case_id,
          sceneKey,
          sceneLabel,
          persona: p,
          trainable: isPersonaTrainable(p),
          imported: d.disease_code === 'CUSTOM' || c.data_status === 'imported',
          hay: `${sceneLabel} ${d.name_zh} ${c.short_title} ${c.title} ${c.case_id} ${p.display_label} ${p.display_name || ''} ${p.one_liner}`.toLowerCase(),
        });
      });
    });
  });
  items.sort((a, b) => {
    const oa = PRACTICE_SCENE_GROUPS[a.sceneKey]?.order ?? 9;
    const ob = PRACTICE_SCENE_GROUPS[b.sceneKey]?.order ?? 9;
    if (oa !== ob) return oa - ob;
    return Number(b.imported) - Number(a.imported);
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
  const sceneFilter = state.practicePickerScene || 'all';
  let items = flattenAllPersonas().filter((it) => !q || it.hay.includes(q));
  if (sceneFilter !== 'all') {
    items = items.filter((it) => it.sceneKey === sceneFilter);
  }
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
          <span class="practice-persona-card-avatar">
            <img src="${escapeHtml(personaPortraitUrl(p.persona_id))}" alt="" width="40" height="40" loading="lazy" decoding="async" data-portrait-fallback="/static${escapeHtml(personaPortraitUrl(p.persona_id))}" onerror="if(this.dataset.tried){this.hidden=true;}else{this.dataset.tried='1';this.src=this.dataset.portraitFallback;}" />
          </span>
          <strong>${escapeHtml(p.display_label || p.persona_id)}</strong>
          ${disabled ? '<span class="status-pill warn">待录入</span>' : '<span class="status-pill ok">可练习</span>'}
        </div>
        <p class="practice-persona-card-meta">${escapeHtml(it.sceneLabel)} · ${escapeHtml(it.diseaseName)}</p>
        <p class="practice-persona-card-oneline">${escapeHtml(p.one_liner || '—')}</p>
        ${disabled ? '<p class="practice-persona-card-note">资料尚未录入，暂不可对话</p>' : ''}
      </button>`;
  };

  const renderGrouped = (list, pendingSection) => {
    if (!list.length) return pendingSection ? '' : '<p class="card-meta">没有匹配的受试者，试试换场景或搜索词。</p>';
    const byScene = new Map();
    list.forEach((it) => {
      const key = it.sceneKey || 'other';
      if (!byScene.has(key)) byScene.set(key, []);
      byScene.get(key).push(it);
    });
    const keys = [...byScene.keys()].sort(
      (a, b) => (PRACTICE_SCENE_GROUPS[a]?.order ?? 9) - (PRACTICE_SCENE_GROUPS[b]?.order ?? 9),
    );
    return keys.map((sk) => {
      const group = byScene.get(sk) || [];
      return `
        <div class="practice-picker-scene-group">
          <div class="section-head practice-picker-scene-head">
            <h4 class="section-title">${escapeHtml(sceneGroupLabel(sk))}</h4>
            <span class="practice-picker-scene-count">${group.length} 人</span>
          </div>
          <div class="practice-persona-grid">${group.map(renderCard).join('')}</div>
        </div>`;
    }).join('');
  };

  const sceneTabs = [
    { id: 'all', label: '全部' },
    { id: 'informed_consent', label: '知情同意' },
    { id: 'follow_up', label: '随访（询问）' },
  ];

  return `
    <div class="practice-picker">
      <div class="practice-picker-head">
        <button type="button" class="practice-action-btn" id="practice-picker-back">← 返回</button>
        <div>
          <h3>选择受试者</h3>
          <p>按场景分组；可搜人物姓名或病种。人数多了可在此区域内滚动。</p>
        </div>
      </div>
      <div class="practice-picker-toolbar">
        <div class="practice-picker-scene-tabs">
          ${sceneTabs.map((t) => `
            <button type="button" class="practice-scene-tab ${sceneFilter === t.id ? 'is-active' : ''}" data-practice-scene="${t.id}">
              ${escapeHtml(t.label)}
            </button>`).join('')}
        </div>
        <div class="practice-picker-search">
          <input type="search" id="practice-picker-search" placeholder="搜索人物 / 场景 / 病种 / 试验…" value="${escapeHtml(state.practicePickerSearch || '')}" />
        </div>
      </div>
      <div class="practice-picker-body">
        ${trainable.length || pending.length ? '' : '<p class="card-meta">暂无可用受试者，请稍后再试。</p>'}
        ${trainable.length ? `
          <div class="practice-picker-section">
            <div class="section-head"><h4 class="section-title">可练习（${trainable.length}）</h4></div>
            ${sceneFilter === 'all' ? renderGrouped(trainable) : `<div class="practice-persona-grid">${trainable.map(renderCard).join('')}</div>`}
          </div>` : (pending.length ? '' : '')}
        ${pending.length ? `
          <div class="practice-picker-section">
            <div class="section-head"><h4 class="section-title">待录入（${pending.length}）</h4></div>
            ${sceneFilter === 'all' ? renderGrouped(pending, true) : `<div class="practice-persona-grid">${pending.map(renderCard).join('')}</div>`}
          </div>` : ''}
      </div>
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

/** 当前受试者 + 当前练习/考核模式下，最近一场未结束会话 */
function latestInProgressForSelection() {
  const list = sessionsForEngagement(state.practiceHistory || [])
    .filter((s) => s.status === 'in_progress' && sessionMatchesSelection(s));
  list.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  return list[0] || null;
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
      syncUxFromHistory(state.practiceHistory);
      renderUserBar();
      renderNav();
      return state.practiceHistory;
    }
  } catch {
    state.practiceHistory = [];
  }
  return state.practiceHistory;
}

async function reloadCasesCatalog() {
  try {
    const casesIndex = await fetchJson('./data/cases-index.json');
    state.casesIndex = casesIndex;
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
        try {
          const pkg = await fetchJson(`./data/${file}`);
          const id = pkg.meta?.case_id;
          if (id) state.casePackages[id] = pkg;
        } catch {
          /* 单个病例失败不阻断选人 */
        }
      }),
    );
  } catch (err) {
    console.warn('reloadCasesCatalog failed', err);
  }
}

async function loadPracticePage() {
  if (!isAuthenticated()) return;
  await reloadCasesCatalog();
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
  state.practicePickerScene = state.practicePickerScene || 'all';
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
  reloadCasesCatalog().then(() => {
    if (state.route === 'practice' && state.practice.pickerOpen) renderPractice();
  });
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

function stripMdForDisplay(text) {
  if (!text) return '';
  let t = String(text).trim();
  // 案例文稿误入展示字段时，去掉标题与列表标记
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^[-*+]\s+/gm, '');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (/培训案例|使用场景|建议时长|虚构声明/.test(t) && t.includes('\n')) {
    const lines = t.split(/\n+/).map((x) => x.trim()).filter(Boolean)
      .filter((ln) => !/^(使用场景|培训案例|建议时长|虚构声明|练什么)/.test(ln)
        && !/^[一二三四五六七八九十]+[、.]/.test(ln));
    t = lines.slice(0, 6).join('；') || t;
  }
  return t;
}

function buildPracticeReferenceHtml(pkg, caseInfo) {
  if (!pkg) {
    const bio = caseInfo?.persona?.lay_bio || state.practice.persona?.lay_bio;
    return `
      <div class="practice-ref-card">
        <h4>受试者简介</h4>
        <p>${escapeHtml(caseInfo?.short_title || '—')}</p>
        ${bio ? `<p class="practice-ref-muted">${escapeHtml(stripMdForDisplay(bio))}</p>` : ''}
      </div>`;
  }
  const script = pkg.session_script || {};
  const cs = pkg.clinical_summary || {};
  const p = pkg.persona || {};
  const med = pkg.medication || {};
  const visitItems = (pkg.visits?.[0]?.items || []).map((i) => i.label);
  const topics = (pkg.key_concerns || []).map((k) => k.topic).filter(Boolean);
  const checklist = visitItems.length ? visitItems : topics;
  const layBio = stripMdForDisplay(p.lay_bio || '');
  const visitCtx = stripMdForDisplay(script.visit_context || '');
  const chief = stripMdForDisplay(cs.chief_complaint || '');
  const history = (cs.history_present || [])
    .map((h) => stripMdForDisplay(h))
    .filter((h) => h && !/^(使用场景|培训案例|建议时长|虚构声明|练什么)/.test(h));

  return `
    <div class="practice-ref-card">
      <h4>${escapeHtml(p.display_name || '受试者')}</h4>
      <p>${escapeHtml(layBio)}</p>
      <div class="tag-row">
        ${p.age_years ? `<span class="tag">${p.age_years} 岁</span>` : ''}
        ${p.sex ? `<span class="tag">${personaLabel(p.sex)}</span>` : ''}
        ${p.occupation ? `<span class="tag">${personaLabel(p.occupation)}</span>` : ''}
      </div>
    </div>
    <div class="practice-ref-card">
      <h4>本次访视</h4>
      <p>${escapeHtml(script.scene_label || caseInfo?.scene_label || '')}</p>
      ${visitCtx ? `<p class="practice-ref-muted">${escapeHtml(visitCtx)}</p>` : ''}
      ${script.trainee_role_hint ? `<p class="practice-ref-tip">${escapeHtml(script.trainee_role_hint)}</p>` : ''}
    </div>
    <div class="practice-ref-card">
      <h4>病历可见信息</h4>
      <p><strong>主诉：</strong>${escapeHtml(chief || '—')}</p>
      <p><strong>病程：</strong>${escapeHtml([cs.disease_duration, cs.disease_stage].filter(Boolean).join(' · ') || '—')}</p>
      ${history.length ? `
        <ul class="practice-ref-list">${history.slice(0, 6).map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
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
    leftStackOpen: localStorage.getItem('practiceLeftStackOpen') === '1',
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
      <div class="explain-box cases-library-intro">
        <div class="explain-box-label">训练病例资料库</div>
        <p>全部 SP 训练病例入口。路径：<strong>资料库 → 病种 → 试验 → 受试者 → 详细资料</strong>；也可用上方搜索或下方卡片直达。</p>
      </div>
      <div class="stats-grid cases-stats-grid">
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
  const scenes = state.scenes?.scenes || [];
  const live = scenes.filter((s) => s.status === 'mvp' || s.status === 'beta');
  const planned = scenes.filter((s) => s.status === 'planned');
  const diseases = state.casesIndex?.diseases || [];
  const caseCards = diseases.map((d) => {
    const cases = d.cases || [];
    const personas = cases.flatMap((c) => c.personas || []);
    return `
      <article class="card scene-card">
        <div class="card-accent" style="--cat-color:#0f766e"></div>
        <div class="card-body">
          <div class="scene-code">${escapeHtml(d.disease_code || '')}</div>
          <div class="card-head">
            <h3>${escapeHtml(d.name_zh || d.name || '病种')}</h3>
            <span class="badge badge-active">${cases.length} 个试验</span>
          </div>
          <p class="card-meta">受试者：${personas.map((p) => p.display_label || p.persona_id).filter(Boolean).slice(0, 6).map((x) => escapeHtml(x)).join('、') || '—'}</p>
        </div>
      </article>`;
  }).join('');

  return `
    <div class="explain-box" style="margin-bottom:20px">
      <div class="explain-box-label">场景 × 病例</div>
      <p>场景决定<strong>练哪类沟通</strong>；病例决定<strong>对面是谁、能说哪些事实</strong>。当前已启用知情同意，以及高血压随访 / 依从相关场景。</p>
    </div>

    <div class="section-head">
      <h3 class="section-title">已启用 / 可用场景</h3>
      <span class="section-sub">${live.length} 个</span>
    </div>
    <div class="cards-grid">
      ${live.map((s) => `
        <article class="card scene-card">
          <div class="card-accent" style="--cat-color:${s.status === 'mvp' ? '#059669' : '#2563eb'}"></div>
          <div class="card-body">
            <div class="scene-code">${escapeHtml(s.code)}</div>
            <div class="card-head">
              <h3>${escapeHtml(s.name)}</h3>
              <span class="badge ${s.status === 'mvp' ? 'badge-active' : 'badge-reference'}">${escapeHtml(s.statusLabel)}</span>
            </div>
            <p class="card-meta">${escapeHtml(s.description)}</p>
            <div class="tag-row">
              ${(s.primaryStandards || []).map((id) => {
                const st = state.standards.standards.find((x) => x.id === id);
                return st ? `<span class="tag tag-clickable" data-std="${id}">${st.shortTitle}</span>` : '';
              }).join('')}
            </div>
          </div>
        </article>`).join('') || '<p class="card-meta">暂无场景数据</p>'}
    </div>

    ${planned.length ? `
      <div class="section-head">
        <h3 class="section-title">预留场景</h3>
        <span class="section-sub">尚未作为主练路径</span>
      </div>
      <div class="tag-row" style="margin-bottom:20px">
        ${planned.map((s) => `<span class="tag">${escapeHtml(s.code)} · ${escapeHtml(s.name)}</span>`).join('')}
      </div>
    ` : ''}

    <div class="section-head">
      <h3 class="section-title">病例资料库（概览）</h3>
      <span class="section-sub">详情在「病例资料」页浏览；管理端可导入</span>
    </div>
    <div class="cards-grid">
      ${caseCards || '<p class="card-meta">暂无病例索引</p>'}
    </div>

    <div class="guide-cta" style="margin-top:16px">
      <button type="button" data-goto="cases">打开病例资料</button>
      <button type="button" class="secondary" data-goto="admin-cases">病例与场景维护</button>
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
  practice: buildPracticeGuideHtml,
  standards: buildStandardsHtml,
  rubric: buildRubricHtml,
  database: buildDatabaseHtml,
  scenes: buildScenesHtml,
  terms: buildTermsHtml,
};

const EXPLAIN_SECTION_DESC = {
  overview: '当前产品怎么练、怎么评：练习/考核闭环 + 双底座（标准评分 × 病例事实）',
  practice: '对话页能力：选人、继续/新建、情绪与语音、结束反馈；练习与考核差异',
  standards: '每份法规用白话说明：是什么、为什么需要、跟训练有什么关系',
  rubric: '反馈以规范清单为主，练习参考分 0–100 为辅；含维度权重与红线',
  database: '标准与病例是否入库，Agnes / 会话日志是否可写可读',
  scenes: '知情同意与随访等场景状态，以及病种/受试者资料库概览',
  terms: '统一叫法：受试者、访视、AE、知情同意等',
};

function renderExplain() {
  if (state.explainSection === 'timeline') state.explainSection = 'overview';
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
          <p>${EXPLAIN_SECTIONS.length} 个模块，按现在产品能力说明</p>
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

function getActiveRubricForPractice() {
  const sceneKey = getSceneKeyForPractice();
  const caseId = state.practice.caseInfo?.case_id || state.selectedCaseId || '';
  return isFollowUpScene(sceneKey, caseId) ? state.rubricFollowup : state.rubric;
}

function getRubricGroups(rubric) {
  return [...(rubric?.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function buildGroupProgressFromCheckpoints(checkpoints, rubric) {
  const byId = Object.fromEntries((checkpoints || []).map((c) => [c.id, c]));
  return getRubricGroups(rubric)
    .filter((g) => !g.isGate)
    .map((g) => {
      const members = (rubric?.items || []).filter((i) => i.enabledMvp && i.group_id === g.id && !i.hardFail && i.type !== 'prohibition');
      const done = members.filter((i) => byId[i.id]?.status === 'done').length;
      const total = members.length;
      return {
        id: g.id,
        name: g.name,
        displayMax: g.displayMax,
        done,
        total,
        pct: total ? Math.round((100 * done) / total) : 0,
      };
    })
    .filter((g) => g.total > 0);
}

function buildCheckpointPanelHtml(messages, { compact = false, engagement = 'practice' } = {}) {
  const rubric = getActiveRubricForPractice();
  const checkpoints = inferCheckpointsFromMessages(messages);
  const groupProg = buildGroupProgressFromCheckpoints(checkpoints, rubric);
  const done = checkpoints.filter((s) => s.status === 'done').length;
  const total = checkpoints.length;
  const pct = total ? Math.round((100 * done) / total) : 0;

  if (engagement === 'assessment') {
    return `
      <div class="checkpoint-panel checkpoint-panel--assessment">
        <div class="checkpoint-panel-head">
          <div>
            <strong>考核 · 大类粗进度</strong>
            <span class="checkpoint-panel-sub">不展示小项细节 · 结束后仍有完整清单与参考分</span>
          </div>
          <div class="checkpoint-panel-stats">
            <span class="checkpoint-pct">${pct}%</span>
            <span>约 ${done}/${total}</span>
          </div>
        </div>
        <div class="checkpoint-progress-track" aria-hidden="true">
          <div class="checkpoint-progress-fill" style="width:${pct}%"></div>
        </div>
        <ul class="group-progress-list">
          ${groupProg.map((g) => `
            <li>
              <span class="group-progress-name">${escapeHtml(g.name)}</span>
              <span class="group-progress-bar"><span style="width:${g.pct}%"></span></span>
              <span class="group-progress-pct">${g.pct}%</span>
            </li>`).join('') || '<li class="card-meta">暂无大类进度</li>'}
        </ul>
      </div>`;
  }

  return `
    <div class="checkpoint-panel${compact ? ' is-compact' : ''}">
      <div class="checkpoint-panel-head">
        <div>
          <strong>沟通检查点</strong>
          <span class="checkpoint-panel-sub">启发式参考 · 最终以结束清单为准</span>
        </div>
        <div class="checkpoint-panel-stats">
          <span class="checkpoint-pct">${pct}%</span>
          <span>${done}/${total} 项可能已覆盖</span>
        </div>
      </div>
      <div class="checkpoint-progress-track" aria-hidden="true">
        <div class="checkpoint-progress-fill" style="width:${pct}%"></div>
      </div>
      ${groupProg.length ? `
      <ul class="group-progress-list group-progress-list--compact">
        ${groupProg.map((g) => `
          <li title="${escapeHtml(g.name)} ${g.done}/${g.total}">
            <span class="group-progress-name">${escapeHtml(g.name)}</span>
            <span class="group-progress-bar"><span style="width:${g.pct}%"></span></span>
            <span class="group-progress-pct">${g.pct}%</span>
          </li>`).join('')}
      </ul>` : ''}
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

function buildPracticeBriefingHtml({ engagement = 'practice' } = {}) {
  const selectedPersona = getSelectedPersona();
  const selectedCase = getSelectedCaseEntry();
  const pkg = resolvePracticeCasePackage(selectedCase?.case_id || state.selectedCaseId) || getSelectedCasePackage();
  const p = pkg?.persona || {};
  const cs = pkg?.clinical_summary || {};
  const script = pkg?.session_script || {};
  const personaId = selectedPersona?.persona_id || p.persona_id || '';
  const displayName = p.display_name || selectedPersona?.display_label || '受试者';
  const sex = personaLabel(p.sex) || '';
  const age = p.age_years ? `${p.age_years}岁` : (p.age_band || '');
  const portrait = personaPortraitUrl(personaId);
  const sceneLabel = script.scene_label || selectedCase?.short_title || '';
  const diseaseName = pkg?.disease?.name_zh || getSelectedDisease()?.name_zh || '';
  const diseaseCode = pkg?.disease?.disease_code || state.selectedDiseaseCode || '';
  const scoringEmphasis = pkg?.scoring?.emphasis?.traineeBrief
    || pkg?.scoring?.emphasis?.patientStance
    || '';
  const concerns = (pkg?.key_concerns || []).map((k) => k.topic).filter(Boolean).slice(0, 4);
  const historyBits = (cs.history_present || []).slice(0, 3);

  const sceneKey = getSceneKeyForPractice();
  const caseId = selectedCase?.case_id || state.selectedCaseId || '';
  const isFu = isFollowUpScene(sceneKey, caseId);
  const rubric = getActiveRubricForPractice();
  const groups = getRubricGroups(rubric);
  const lay = state.rubricLay || {};
  const contentGroups = groups.filter((g) => !g.isGate);
  const redline = groups.find((g) => g.isGate);
  const redItems = redline
    ? (rubric?.items || []).filter((i) => i.enabledMvp && (i.group_id === redline.id || i.hardFail))
    : [];
  const checkpointDefs = buildCheckpointDefsForScene(sceneKey, caseId);
  const levelOutcome = isFu
    ? '练完你能：非责备地问清用药/漏服、不适与合并用药，并对照随访清单改进。'
    : '练完你能：把试验目的、流程、风险与自愿退出讲清楚，并回应受试者关切。';
  const levelBrief = (script.system_opening || '').trim()
    || (script.visit_context || '').trim()
    || levelOutcome;
  const openingSeeds = script.patient_greeting_seeds || [];
  const openingHint = openingSeeds.length > 1
    ? `开场会从 ${openingSeeds.length} 种说法切入（每次可能不同），请按对方当下反应应变，不要背稿。`
    : (concerns.length
      ? `对方可能先抛出关切（如「${concerns.slice(0, 2).join('」「')}」），请先接住再展开。`
      : '开场后请先接住对方关切，再按检查点推进。');

  const dossierRows = [
    ['姓名', displayName],
    ['年龄', age || '—'],
    ['性别', sex || '—'],
    ['职业', p.occupation ? personaLabel(p.occupation) : '—'],
    ['本次场景', sceneLabel || '—'],
    ['病种', diseaseName ? `${diseaseName}${diseaseCode ? `（${diseaseCode}）` : ''}` : '—'],
    ['主诉', cs.chief_complaint || selectedPersona?.one_liner || '—'],
  ].filter(([, v]) => v && v !== '—');

  const taskCards = contentGroups.map((g, gi) => {
    const items = (rubric?.items || []).filter((i) => i.enabledMvp && i.group_id === g.id && !i.hardFail);
    const preview = items.slice(0, 3).map((it) => {
      const layItem = lay[it.id] || {};
      return layItem.layTitle || it.title || it.id;
    });
    const more = items.length > preview.length ? items.length - preview.length : 0;
    const maxLabel = g.displayMax != null ? `${g.displayMax} 分` : '';
    return `
      <article class="briefing-task-card">
        <header>
          <span class="briefing-task-num">${gi + 1}</span>
          <div>
            <strong>${escapeHtml(g.name)}</strong>
            <span>${maxLabel ? `展示约 ${maxLabel}` : ''}${items.length ? ` · ${items.length} 项` : ''}</span>
          </div>
        </header>
        <ul>
          ${preview.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
          ${more ? `<li class="is-more">另有 ${more} 项，练习中左侧可查看</li>` : ''}
        </ul>
      </article>`;
  }).join('');

  const redlineText = redItems.length
    ? redItems.map((i) => (lay[i.id] || {}).layTitle || i.title).join('、')
    : (isFu ? '责备恐吓、自行决定医学处理' : '');

  const checkpointPreview = checkpointDefs.slice(0, 8).map((d, i) => `
    <li><span class="briefing-cp-num">${i + 1}</span><span>${escapeHtml(d.title)}</span></li>
  `).join('');
  const checkpointMore = checkpointDefs.length > 8
    ? `<li class="is-more">另有 ${checkpointDefs.length - 8} 项，开练后左侧可全程对照</li>`
    : '';

  return `
    <div class="practice-briefing">
      <div class="briefing-level-hero" aria-label="本关训练目标">
        <span class="briefing-level-kicker">这一关 · ${escapeHtml(isFu ? '随访（询问）' : (sceneLabel || '知情同意'))}${diseaseName ? ` · ${escapeHtml(diseaseName)}` : ''}</span>
        <h3>${escapeHtml(sceneLabel || (isFu ? '随访沟通' : '知情同意沟通'))} · ${escapeHtml(displayName)}</h3>
        <p class="briefing-level-outcome">${escapeHtml(levelOutcome)}</p>
        <p class="briefing-level-brief">${escapeHtml(levelBrief.length > 180 ? `${levelBrief.slice(0, 180)}…` : levelBrief)}</p>
        ${scoringEmphasis ? `<p class="briefing-level-emphasis"><strong>本局侧重点：</strong>${escapeHtml(scoringEmphasis)}</p>` : ''}
        <p class="briefing-level-opening">${escapeHtml(openingHint)}</p>
      </div>

      <aside class="persona-dossier" aria-label="受试者档案">
        <div class="persona-dossier-hero">
          <div class="persona-dossier-avatar">
            <img src="${escapeHtml(portrait)}" alt="${escapeHtml(displayName)}" width="112" height="112" loading="eager" decoding="async" data-portrait-fallback="/static${escapeHtml(portrait)}" onerror="if(this.dataset.tried){this.hidden=true;this.nextElementSibling.hidden=false;}else{this.dataset.tried='1';this.src=this.dataset.portraitFallback;}" />
            <span class="persona-dossier-avatar-fallback" hidden aria-hidden="true">${escapeHtml((displayName || '?').slice(0, 1))}</span>
          </div>
          <div class="persona-dossier-title">
            <span class="persona-dossier-badge">对手档案</span>
            <h3>${escapeHtml(displayName)}${age || sex ? ` · ${escapeHtml([age, sex].filter(Boolean).join(''))}` : ''}</h3>
            <p>同一关卡换人 = 换策略，不是换考纲</p>
          </div>
          <button type="button" class="practice-link-btn" id="practice-open-picker">换受试者</button>
        </div>
        <dl class="persona-dossier-meta">
          ${dossierRows.map(([k, v]) => `
            <div>
              <dt>${escapeHtml(k)}</dt>
              <dd>${escapeHtml(v)}</dd>
            </div>`).join('')}
        </dl>
        ${p.lay_bio ? `
          <section class="persona-dossier-block">
            <h4>人物简介</h4>
            <p>${escapeHtml(p.lay_bio)}</p>
          </section>` : ''}
        ${historyBits.length ? `
          <section class="persona-dossier-block">
            <h4>病情要点</h4>
            <ul>${historyBits.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
          </section>` : ''}
        ${script.trainee_role_hint || script.visit_context ? `
          <section class="persona-dossier-block persona-dossier-block--tip">
            <h4>本场沟通提示</h4>
            ${script.visit_context ? `<p>${escapeHtml(script.visit_context)}</p>` : ''}
            ${script.trainee_role_hint ? `<p class="persona-dossier-tip">${escapeHtml(script.trainee_role_hint)}</p>` : ''}
          </section>` : ''}
        ${concerns.length ? `
          <section class="persona-dossier-block">
            <h4>可能关心的问题</h4>
            <div class="persona-dossier-chips">
              ${concerns.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}
            </div>
          </section>` : ''}
        <p class="persona-dossier-foot">教学模拟档案 · 非真实受试者</p>
      </aside>

      <section class="briefing-tasks" aria-label="今日练习任务">
        <header class="briefing-tasks-head">
          <strong>${engagement === 'assessment' ? '考核' : '练习'}任务地图</strong>
          <span>${isFu ? '随访清单' : '知情清单'} · ${contentGroups.length} 大类 · ${checkpointDefs.length} 检查点</span>
        </header>
        <div class="briefing-task-grid">${taskCards}</div>
        <div class="briefing-checkpoint-preview">
          <header>
            <strong>开练前先认检查点</strong>
            <span>对话中左侧会跟着亮</span>
          </header>
          <ol>${checkpointPreview}${checkpointMore}</ol>
        </div>
        ${redlineText ? `
          <p class="briefing-redline">
            <strong>红线</strong>：${escapeHtml(redlineText)}。触犯会一票否决。
          </p>` : ''}
      </section>
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
      ${visible.map((m) => {
        const affect = m.role === 'patient' ? resolveMessageAffect(m, messages) : null;
        return `
        <div class="transcript-line role-${m.role}">
          <div class="transcript-line-head">
            <span class="transcript-name">${escapeHtml(galSpeakerLabel(m.role, personaLabelText))}</span>
            ${affectChipHtml(affect, { tone: 'transcript' })}
          </div>
          <p>${escapeHtml(stripPatientMarkdown(m.content || ''))}</p>
        </div>`;
      }).join('')}
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
    const n = (p.messages || []).filter((m) => m.role !== 'system').length;
    meta.textContent = p.feedExpanded
      ? `对话 ${n} 条 · 已展开，可上滑看更早内容 · 拖顶边调高度`
      : `对话 ${n} 条 · 上滑可看历史 · 拖顶边可调高度`;
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
  patchCheckpointRail();
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
      <div class="records-toolbar">
        <div class="records-filters">
          <label>类型
            <select id="records-filter-mode">
              <option value="all" ${!f.sessionMode || f.sessionMode === 'all' ? 'selected' : ''}>全部</option>
              <option value="practice" ${f.sessionMode === 'practice' ? 'selected' : ''}>练习</option>
              <option value="assessment" ${f.sessionMode === 'assessment' ? 'selected' : ''}>考核</option>
            </select>
          </label>
          <label>状态
            <select id="records-filter-status">
              <option value="all" ${!f.status || f.status === 'all' ? 'selected' : ''}>全部</option>
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
        <div class="records-summary">共 <strong>${filtered.length}</strong> 条${filtered.length !== history.length ? `（筛选自 ${history.length}）` : ''}</div>
      </div>
      ${state.recordsLoading ? '<div class="feedback-loading"><p>加载中…</p></div>' : ''}
      <div class="records-list">
        ${filtered.length
          ? filtered.map((s) => buildSessionRecordRow(s)).join('')
          : `<div class="feedback-history-empty">
              没有符合条件的记录。
              <button type="button" class="records-action" data-goto-practice style="margin-top:12px">去模拟对话</button>
              <p class="admin-hint" style="margin-top:8px">若刚换了云服务器或账号，历史在对应库下，不会自动合并。</p>
            </div>`}
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
  viewEl.querySelector('[data-goto-practice]')?.addEventListener('click', () => navigate('practice'));
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
    ? '结束后保留本场评分；点「重新考核」会新开一场，不覆盖旧记录'
    : '新建一场独立对话；历史练习与评分都保留，不会覆盖';
  const panelScroll = inChat ? ($('#chat-panel')?.scrollTop ?? 0) : 0;
  const winScroll = inChat ? window.scrollY : 0;
  const sessionBrief = inChat
    ? ((p.messages || []).find((m) => m.role === 'system')?.content || '')
    : '';
  const leftStackOpen = p.leftStackOpen !== false;
  document.body.classList.toggle('gal-immersive', inChat);
  if (inChat && active) startPracticeTimer();
  else if (!inChat) flushPracticeTimer();

  if (inChat) digitalHumanCtrl.parkShell();

  viewEl.innerHTML = `
    <div class="practice-page ${inChat ? 'is-in-chat is-gal' : ''}">
      ${!inChat ? `
      ${getUserProficiency() === 'newbie' && !isAdminUser(state.auth.user) ? `
      <div class="practice-prof-strip" role="note">
        <div>
          <strong>新手阶段</strong>
          <p>登录默认进使用手册。左侧进度：对话满 ${UX_VETERAN_SESSIONS} 场且累计练满 ${Math.round(UX_VETERAN_DURATION_MS / 60000)} 分钟后自动成为老手，之后登录直达本页。</p>
        </div>
        <div class="practice-prof-strip-actions">
          <button type="button" class="practice-link-btn" data-goto="guide">回看使用手册</button>
        </div>
      </div>` : ''}
      <div class="practice-hero">
        <p class="hero-eyebrow">${engagement === 'assessment' ? 'Assessment · 一关一练' : 'Practice · 从小白到会问会讲'}</p>
        <h3>${engagement === 'assessment' ? '模拟沟通考核' : '模拟沟通练习'}</h3>
        <p>${engagement === 'assessment'
    ? '严格模式单场考核：先认清这一关练什么 → 对话 → 对照清单看哪里要改。'
    : '先选关卡与对手，开练前看清「练完多会什么」；对话中对照检查点，结束再改进下一趟。'}</p>
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
            ${buildPracticeBriefingHtml({ engagement })}
            ${(() => {
              const last = latestInProgressForSelection();
              return last ? `
              <div class="practice-resume-last">
                <button type="button" class="practice-start-btn primary" id="practice-resume-last" data-resume-last="${last.id}">
                  <span class="practice-start-icon">↩</span>
                  <span><strong>继续刚才的对话</strong><small>仅当前受试者 · 最近一场未结束练习</small></span>
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
          ${p.error ? `<div class="action-toast${/正在生成|几十秒/.test(p.error) ? ' is-pending' : ''}">${escapeHtml(p.error)}</div>` : ''}
        </div>
      ` : `
        <div class="practice-session-wrap practice-gal-wrap${refOpen ? ' is-ref-open' : ''}${active ? ' has-checkpoint-rail is-checkpoint-open' : ''}${engagement === 'practice' && active ? ' has-live-rail' : ''}${active && !leftStackOpen ? ' is-left-stack-collapsed' : ''}${engagement === 'assessment' ? ' is-assessment' : ''}">
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
                ${active ? `
                  <button type="button" class="practice-action-btn ${leftStackOpen ? 'is-active' : ''}" id="practice-left-toggle" title="${leftStackOpen ? '收起左侧面板' : '展开左侧面板'}">${leftStackOpen ? '收起侧栏' : '展开侧栏'}</button>
                ` : ''}
                ${engagement === 'practice' ? `<button type="button" class="practice-action-btn" id="practice-exit-cases" title="在本页选择其他受试者">换受试者</button>` : ''}
                ${studyMode === 'reference' && engagement === 'practice' && active ? `
                  <button type="button" class="practice-action-btn ${refOpen ? 'is-active' : ''}" id="practice-ref-toggle">${refOpen ? '收起参考' : '查阅参考'}</button>
                ` : ''}
                <button type="button" class="practice-action-btn" data-goto="records">对话记录</button>
              </div>
            </div>

            <div class="practice-gal-stage-mount" id="digital-human-mount" aria-label="受试者形象"></div>

            ${active ? `
              <button type="button" class="practice-left-expand-fab" id="practice-left-expand-fab" ${leftStackOpen ? 'hidden' : ''} title="展开左侧面板">侧栏</button>
              <div class="practice-left-stack${leftStackOpen ? '' : ' is-collapsed'}" id="practice-left-stack">
                <div class="practice-left-stack-toolbar">
                  <strong>练习侧栏</strong>
                  <button type="button" class="practice-left-collapse" id="practice-left-collapse" aria-expanded="${leftStackOpen ? 'true' : 'false'}" title="收起左侧面板">收起</button>
                </div>
                ${engagement === 'practice' ? buildLiveFeedbackRailHtml(p.messages, p.patientAffect, { busy: p.busy }) : ''}
                <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
                  ${buildCheckpointPanelHtml(p.messages, { engagement })}
                </aside>
              </div>
            ` : ''}

            <div class="practice-gal-vn-layer">
              <div class="gal-dialog-glass${p.feedExpanded ? ' is-feed-expanded' : ''}" id="gal-dialog-glass">
                <div class="gal-dialog-resize" id="gal-dialog-resize" title="拖拽上边调整高度（双击恢复默认）" role="separator" aria-orientation="horizontal" aria-label="拖拽调整对话框高度"></div>
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
                  <div class="gal-assessment-banner">考核进行中 · 左侧为大类粗进度 · 不可退出，请完成后点「结束考核」</div>
                ` : ''}
                <div class="gal-dialog-feed-meta">
                  <span>对话 ${(p.messages || []).filter((m) => m.role !== 'system').length} 条 · ${p.feedExpanded ? '已展开，可上滑看更早内容 · 拖顶边调高度' : '上滑可看历史 · 拖顶边可调高度'}</span>
                  <button type="button" class="practice-link-btn" id="practice-feed-expand">${p.feedExpanded ? '收起对话框' : '展开全部对话'}</button>
                </div>
                <div class="gal-dialog-feed${p.feedExpanded ? ' is-expanded' : ''}" id="chat-panel" aria-label="对话记录">
                  ${buildGalDialogFeed(p.messages, personaLabelText, p.busy)}
                </div>
                ${active ? `
                  <form class="gal-dialog-input" id="chat-form">
                    <div class="gal-input-shell">
                      <textarea id="chat-input" rows="2" placeholder="打字输入，或点右侧「说话」用语音… Enter 发送" ${p.busy ? '' : ''}></textarea>
                      <div class="gal-mic-slot">${buildGalMicButtonHtml()}</div>
                    </div>
                    <div class="chat-actions gal-dialog-actions">
                      <div class="gal-dialog-actions-left">
                        <button type="button" class="gal-action-btn gal-action-btn--secondary" id="practice-complete" ${p.busy ? 'disabled' : ''}>${engagement === 'assessment' ? '结束考核' : '结束练习'}</button>
                        <div class="gal-voice-actions">${buildGalVoiceActionsInnerHtml()}</div>
                      </div>
                      <button type="submit" class="gal-action-btn gal-action-btn--primary" id="chat-send" ${p.busy ? 'disabled' : ''}>发送</button>
                    </div>
                    <p class="gal-voice-status" id="voice-status-live">${escapeHtml(voiceStatusText())}</p>
                    <p class="gal-voice-draft" id="voice-draft-hint" ${(v.draft || v.interim || v.listening) ? '' : 'hidden'}>${escapeHtml([v.draft, v.interim].filter(Boolean).join(' ') ? `实时识别：${[v.draft, v.interim].filter(Boolean).join(' ')}` : (v.listening ? '说话时文字会实时出现在输入框' : ''))}</p>
                    ${p.busy ? '<p class="chat-busy-hint">受试者回复中…</p>' : ''}
                  </form>
                ` : `
                  <div class="gal-dialog-input gal-dialog-done">
                    <button type="button" data-goto="feedback">查看练习反馈</button>
                    <button type="button" class="secondary" id="practice-restart">再练一次</button>
                  </div>
                `}
                ${p.error ? `<div class="action-toast gal-dialog-error${/正在生成|几十秒/.test(p.error) ? ' is-pending' : (/连不上|失败|错误|无权|不能/.test(p.error) ? ' is-danger' : '')}">${escapeHtml(p.error)}</div>` : ''}
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
    const id = $('#practice-resume-last')?.dataset?.resumeLast
      || latestInProgressForSelection()?.id;
    if (id) await resumePractice(id);
  });
  $('#practice-feed-expand')?.addEventListener('click', () => {
    state.practice.feedExpanded = !state.practice.feedExpanded;
    patchFeedExpanded();
  });
  bindGalDialogResize();
  const toggleLeft = () => setLeftStackOpen(!(state.practice.leftStackOpen !== false));
  $('#practice-left-toggle')?.addEventListener('click', toggleLeft);
  $('#practice-left-collapse')?.addEventListener('click', () => setLeftStackOpen(false));
  $('#practice-left-expand-fab')?.addEventListener('click', () => setLeftStackOpen(true));
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
  viewEl.querySelectorAll('[data-practice-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.practicePickerScene = btn.dataset.practiceScene || 'all';
      renderPractice();
    });
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
    markPracticeStarted();
    renderNav();
    renderUserBar();
  } catch (err) {
    state.practice.error = `无法开始：${err.message || err}（请确认已启动后端 :8000）`;
  } finally {
    state.practice.busy = false;
    digitalHumanCtrl.setThinking(false);
    if (state.route === 'practice') renderPractice();
    if (state.practice.sessionId) speakLatestPatient();
  }
}

async function forceExitEndedSession(message) {
  voiceCtrl.stopListening({ commit: false });
  voiceCtrl.stopPlayback();
  persistPracticeSessionId(null);
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
    patientAffect: null,
  };
  showPracticeAlertModal(
    '本场对话已结束',
    message || '不能再继续发送。请开始新练习，或到「练习反馈」查看评分。',
  );
  if (state.route === 'practice') await loadPracticePage();
}

async function sendPracticeTurn(text, opts = {}) {
  const content = String(text || '').trim();
  if (!content || !state.practice.sessionId) return;
  if (state.practice.busy) return;
  if (state.practice.status === 'completed') {
    await forceExitEndedSession('这场练习已经结束，请新开一场后再说。');
    return;
  }

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
    if (data.patient_ok === false) {
      state.practice.error = String(data.patient_error || '暂时连不上模拟病人，请稍后重试');
    }
    loadAllSessions().catch(() => {});
    state.practice.busy = false;
    if (state.route === 'practice') patchPracticeInChatUi();
    if (!state.practice.composerDraft) clearChatInputImmediate();
    if (data.patient_ok !== false) await speakLatestPatient();
  } catch (err) {
    const msg = String(err.message || err);
    state.practice.messages = (state.practice.messages || []).filter((m) => !m._optimistic);
    state.practice.composerDraft = content;
    state.practice.busy = false;
    if (/会话已结束|无权访问/.test(msg)) {
      await forceExitEndedSession(msg);
      return;
    }
    state.practice.error = msg;
    const input = $('#chat-input');
    if (input) input.value = content;
    if (state.route === 'practice') patchPracticeInChatUi();
  }
}

async function completePractice() {
  if (!state.practice.sessionId) return;
  voiceCtrl.stopListening({ commit: false });
  voiceCtrl.stopPlayback();
  state.practice.busy = true;
  state.practice.error = '';
  if (state.route === 'practice') patchPracticeInChatUi();
  showPracticeLoadingModal();
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
    closeModal({ force: true });
    navigate('feedback');
  } catch (err) {
    const msg = String(err.message || err);
    state.practice.error = '';
    state.practice.busy = false;
    closeModal({ force: true });
    if (/会话已结束/.test(msg)) {
      await forceExitEndedSession('这场练习其实已经结束了，请查看反馈或开始新练习。');
      return;
    }
    showPracticeAlertModal(
      /至少说一轮|样本不足|太短/.test(msg) ? '暂时还不能结束' : '结束练习失败',
      msg,
    );
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
          <div class="feedback-score-grade">${escapeHtml(scores.grade_label || '样本不足 · 暂无参考分')}</div>
          <p class="feedback-score-note">${escapeHtml(scores.note || '对话太短，暂不出练习参考分')}</p>
        </div>
        <div class="feedback-score-explainer">
          <strong>这不是报错</strong>
          <p>对话样本还不够对照清单逐项核对。建议至少再练几轮（约 3 轮、120 字以上），再点结束。样本够了会先给达标/未达标，再附教学参考分。</p>
        </div>
      </div>`;
  }
  if (scores.total_score == null) return '';
  const passLine = scores.pass_score != null ? `达标线 ${scores.pass_score} 分` : '';
  return `
    <div class="feedback-score-panel feedback-score-panel--compact">
      <div class="feedback-score-explainer">
        <strong>主结果是清单，分数是汇总</strong>
        <p>下面先看各检查项是否达标；0–100 是<strong>练习参考分</strong>（教学汇总，非问卷赋分、非法规定分）。${passLine ? `${passLine}。` : ''}环形图 = 总分，雷达图 = 维度是否均衡。</p>
      </div>
    </div>`;
}

function buildFeedbackGroupsHtml(fb) {
  const groups = fb.groups || fb.scores?.groups || [];
  const items = fb.items || [];
  if (!groups.length || !items.length) return '';
  const byCode = Object.fromEntries(items.map((it) => [it.item_code, it]));
  return `
    <div class="feedback-groups">
      <div class="section-head">
        <h4 class="section-title">规范清单（按大类）</h4>
        <span class="section-sub">主反馈 · 展开看每条 pass / fail 与证据</span>
      </div>
      ${groups.map((g) => {
        const memberItems = (g.items || []).map((code) => byCode[code]).filter(Boolean);
        const scoreLabel = g.is_gate
          ? (g.passed ? '未踩红线' : `踩线 ${g.fail_count || 0}`)
          : (g.display_score != null ? `${g.display_score}/${g.display_max}` : `${g.pct}%`);
        return `
          <details class="fb-group" ${g.is_gate && !g.passed ? 'open' : ''}>
            <summary>
              <span class="fb-group-name">${escapeHtml(g.name)}</span>
              <span class="fb-group-score ${g.passed === false ? 'is-bad' : 'is-ok'}">${escapeHtml(String(scoreLabel))}</span>
              <span class="fb-group-meta">${g.pass_count != null ? `${g.pass_count} 过` : ''} · ${memberItems.length} 项</span>
            </summary>
            <ul class="fb-group-items">
              ${memberItems.map((it) => `
                <li class="fb-group-item verdict-${it.verdict}">
                  <span class="verdict verdict-${it.verdict}">${it.verdict}</span>
                  <div>
                    <strong>${escapeHtml(it.lay_title || it.title || it.item_code)}</strong>
                    <span>${escapeHtml(it.comment || it.lay_explain || '')}</span>
                    ${(it.evidence_spans || []).length ? `<em>${escapeHtml((it.evidence_spans[0] || {}).quote || '')}</em>` : ''}
                  </div>
                </li>`).join('') || '<li class="card-meta">暂无分项</li>'}
            </ul>
          </details>`;
      }).join('')}
    </div>`;
}

function buildFeedbackTabBar(activeTab) {
  const tabs = [
    { id: 'overview', label: '总览·清单' },
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
    ${!insufficient ? buildFeedbackGroupsHtml(fb) : ''}
    ${overviewViz}
    ${!insufficient && !scores?.total_score && fb.items?.length ? `
      <div class="action-toast">该记录暂无参考分，请刷新页面；系统会自动从分项结果补算。检查点说明见「使用手册 → 沟通检查点」。</div>` : ''}
    <div class="feedback-result-head ${headlinePass ? 'is-pass' : 'is-fail'}">
      <div class="feedback-result-badge">${insufficient ? '样本不足 · 暂无参考分' : (headlinePass ? '综合建议：达标' : '综合建议：需改进')}</div>
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
      <button type="button" class="secondary" data-goto="guide">使用手册 · 检查点</button>
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
  document.body.classList.toggle('auth-focus', state.route === 'auth');
  switch (state.route) {
    case 'guide': return renderGuide();
    case 'explain': return renderExplain();
    case 'cases': return renderCases();
    case 'practice': return renderPractice();
    case 'records': return renderRecords();
    case 'admin':
    case 'admin-cases':
      return adminCtrl.render(viewEl, setPage, 'cases');
    case 'admin-users':
      return adminCtrl.render(viewEl, setPage, 'users');
    case 'feedback': return renderFeedback();
    case 'auth': return renderAuth();
    default: return renderGuide();
  }
}

function initModal() {
  modal.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      if (modal.classList.contains('is-locked')) return;
      closeModal();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal.classList.contains('is-locked')) return;
      closeModal();
    }
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPracticeTimer();
      else if (state.route === 'practice' && state.practice.sessionId && state.practice.status !== 'completed') {
        startPracticeTimer();
      }
    });
    window.addEventListener('pagehide', () => flushPracticeTimer());
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
