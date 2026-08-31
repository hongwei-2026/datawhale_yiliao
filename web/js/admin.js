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

export function createAdminController({ fetchApi, API_BASE, escapeHtml, navigate, state }) {
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

  async function loadAll() {
    cache.busy = true;
    cache.error = '';
    try {
      const [stats, cases, scenes, users, avatars] = await Promise.all([
        fetchApi(`${API_BASE}/api/admin/stats`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/cases`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/scenes`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/users`).then((r) => r.data),
        fetchApi(`${API_BASE}/api/admin/avatars`).then((r) => r.data),
      ]);
      if (!stats?.ok) throw new Error(stats?.detail || '无法加载统计');
      cache.stats = stats;
      cache.cases = cases?.cases || [];
      cache.scenes = scenes?.scenes || [];
      cache.users = users?.users || [];
      cache.avatars = avatars;
    } catch (err) {
      cache.error = String(err.message || err);
    } finally {
      cache.busy = false;
    }
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
    if (path.startsWith('http') || path.startsWith('/')) return path;
    return `/live2d/portraits/${path}`;
  }

  function tabsHtml() {
    const items = [
      { id: 'overview', label: '总览' },
      { id: 'cases', label: '病例资料' },
      { id: 'scenes', label: '训练场景' },
      { id: 'users', label: '账号管理' },
      { id: 'avatars', label: '数字人形象' },
    ];
    return `
      <div class="admin-tabs">
        ${items.map((t) => `
          <button type="button" class="admin-tab ${tab === t.id ? 'is-active' : ''}" data-admin-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>`;
  }

  function overviewHtml() {
    const s = cache.stats || {};
    return `
      <div class="admin-grid-stats">
        <div class="admin-stat"><strong>${s.cases ?? '—'}</strong><span>病例包</span></div>
        <div class="admin-stat"><strong>${s.personas ?? '—'}</strong><span>受试者人设</span></div>
        <div class="admin-stat"><strong>${s.scenes ?? '—'}</strong><span>训练场景</span></div>
        <div class="admin-stat"><strong>${s.trainees ?? '—'}</strong><span>学员账号</span></div>
        <div class="admin-stat"><strong>${s.sessions ?? '—'}</strong><span>练习会话</span></div>
        <div class="admin-stat"><strong>${s.admins ?? '—'}</strong><span>管理员</span></div>
      </div>
      <div class="admin-card">
        <h4>管理端做什么</h4>
        <ul class="admin-bullets">
          <li>导入 / 删除病例：写入资料库后，AI 受试者按新病情与人设回复</li>
          <li>维护训练场景（知情同意、随访等）</li>
          <li>按角色管理账号：管理员 / 老师 / 学员</li>
          <li>为受试者选择默认形象、预览肖像并上传替换</li>
        </ul>
        <p class="admin-hint">系统功能说明请点左侧导航「系统功能」。默认管理员：admin / Admin2026</p>
      </div>`;
  }

  function casesHtml() {
    const cards = (cache.cases || []).map((c) => {
      const title = c.short_title || c.title || '未命名病例';
      const disease = c.disease_name || c.disease_code || '未分类疾病';
      const personas = (c.personas || []).map((p) => p.display_label || p.persona_id).filter(Boolean);
      return `
        <article class="admin-case-card">
          <div class="admin-case-card-main">
            <h5>${escapeHtml(title)}</h5>
            <p class="admin-case-disease">${escapeHtml(disease)}${c.phase ? ` · ${escapeHtml(String(c.phase))} 期` : ''}</p>
            <p class="admin-case-personas">${personas.length ? personas.map((x) => escapeHtml(x)).join('、') : '暂无受试者'}</p>
            <p class="admin-case-status">${c.exists ? '资料已入库，可用于练习' : '文件缺失，请重新导入'}</p>
          </div>
          <button type="button" class="admin-btn danger" data-del-case="${escapeHtml(c.case_id)}">删除</button>
        </article>`;
    }).join('');
    return `
      <div class="admin-card">
        <h4>导入病例样本</h4>
        <p class="admin-hint">上传完整病例 JSON。导入后学员端可选该病例，AI 按其中人设与病情事实回复。</p>
        <div class="admin-import-row">
          <input type="file" id="admin-case-file" accept="application/json,.json" />
          <button type="button" class="admin-btn primary" id="admin-case-import">导入并生效</button>
        </div>
        <textarea id="admin-case-json" rows="5" placeholder="也可直接粘贴病例 JSON…"></textarea>
      </div>
      <div class="admin-card">
        <h4>病例清单（${cache.cases.length}）</h4>
        <div class="admin-case-grid">${cards || '<p class="admin-hint">暂无病例</p>'}</div>
      </div>`;
  }

  function scenesHtml() {
    const rows = (cache.scenes || []).map((s) => {
      const id = s.id || s.scene_key || '';
      const code = s.code ? `（${s.code}）` : '';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(sceneTitle(s))}</strong>${escapeHtml(code)}
            <div class="admin-muted-id">内部编码：${escapeHtml(id)}</div>
          </td>
          <td>${escapeHtml(sceneDesc(s)) || '—'}</td>
          <td>${escapeHtml(sceneStatusLabel(s))}</td>
          <td><button type="button" class="admin-btn danger" data-del-scene="${escapeHtml(id)}">删除</button></td>
        </tr>`;
    }).join('');
    return `
      <div class="admin-card">
        <h4>新增 / 更新场景</h4>
        <div class="admin-form-grid">
          <label>场景名称（给人看）
            <input id="admin-scene-title" placeholder="如：知情同意沟通" />
          </label>
          <label>简码（可选）
            <input id="admin-scene-code" placeholder="如：S1" />
          </label>
          <label class="span-2">说明
            <input id="admin-scene-summary" placeholder="这个场景练什么" />
          </label>
          <label class="span-2">内部编码（英文，系统用；可不填，将按名称自动生成）
            <input id="admin-scene-id" placeholder="如 informed_consent" />
          </label>
        </div>
        <button type="button" class="admin-btn primary" id="admin-scene-save">保存场景</button>
      </div>
      <div class="admin-card">
        <h4>场景列表</h4>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>场景</th><th>说明</th><th>状态</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">暂无场景</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
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
        <p class="admin-hint">点选下方形象，可在受试者卡片里「套用此形象」。</p>
        <div class="admin-gallery-grid" id="admin-gallery-grid">
          ${gallery.map((g) => `
            <button type="button" class="admin-gallery-item" data-gallery-path="${escapeHtml(g.path)}" data-gallery-label="${escapeHtml(g.label || g.file)}" title="${escapeHtml(g.label || g.file)}">
              <img src="${escapeHtml(g.path)}" alt="${escapeHtml(g.label || g.file)}" loading="lazy" />
              <span>${escapeHtml(g.label || g.file)}</span>
            </button>`).join('')}
        </div>
      </div>` : '<p class="admin-hint">暂无可用肖像。请先上传，或检查 web/live2d/portraits/</p>';

    const cards = personas.map((p) => {
      const img = portraitUrl(p.portrait) || (gallery[0] && gallery[0].path) || '';
      const visual = p.visual || 'live2d';
      return `
        <article class="admin-avatar-card" data-persona-card="${escapeHtml(p.persona_id)}">
          <div class="admin-avatar-preview">
            ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.display_label || '')}" />` : '<div class="admin-avatar-empty">暂无肖像</div>'}
          </div>
          <div class="admin-avatar-body">
            <h5>${escapeHtml(p.display_label || '未命名受试者')}</h5>
            <p class="admin-case-disease">${escapeHtml(p.case_title || p.case_id || '')}</p>
            <label>呈现方式
              <select data-av-visual="${escapeHtml(p.persona_id)}">
                ${Object.entries(VISUAL_LABEL).map(([k, lab]) => `
                  <option value="${k}" ${visual === k ? 'selected' : ''}>${lab}</option>`).join('')}
              </select>
            </label>
            <label>动画模型
              <select data-av-model="${escapeHtml(p.persona_id)}">
                <option value="">系统默认</option>
                ${modelIds.map((m) => `
                  <option value="${escapeHtml(m)}" ${p.model === m ? 'selected' : ''}>${escapeHtml(modelLabel(m, modelsMeta))}</option>`).join('')}
              </select>
            </label>
            <label>肖像（预览选择）
              <select data-av-portrait="${escapeHtml(p.persona_id)}">
                <option value="">保持当前</option>
                ${gallery.map((g) => `
                  <option value="${escapeHtml(g.path)}" ${p.portrait === g.path ? 'selected' : ''}>${escapeHtml(g.label || g.file)}</option>`).join('')}
              </select>
            </label>
            <div class="admin-avatar-actions">
              <label class="admin-upload-btn">
                上传替换肖像
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" data-upload-persona="${escapeHtml(p.persona_id)}" hidden />
              </label>
              <button type="button" class="admin-btn" data-apply-gallery="${escapeHtml(p.persona_id)}">套用选中形象</button>
              <button type="button" class="admin-btn primary" data-save-avatar="${escapeHtml(p.persona_id)}">保存</button>
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
        <p class="admin-hint">先点上方形象库选一张，再在受试者卡片点「套用选中形象」，或直接上传替换。</p>
        <div class="admin-avatar-grid">${cards || '<p class="admin-hint">暂无受试者人设，请先导入病例</p>'}</div>
      </div>`;
  }

  function panelHtml() {
    if (tab === 'overview') return overviewHtml();
    if (tab === 'cases') return casesHtml();
    if (tab === 'scenes') return scenesHtml();
    if (tab === 'users') return usersHtml();
    if (tab === 'avatars') return avatarsHtml();
    return '';
  }

  let selectedGalleryPath = '';

  async function render(viewEl, setPage) {
    setPage('管理端', '病例 · 场景 · 账号 · 数字人');
    if (!cache.stats && !cache.busy) await loadAll();

    viewEl.innerHTML = `
      <div class="admin-page">
        <div class="admin-hero">
          <p class="hero-eyebrow">Admin Console</p>
          <h3>管理端</h3>
          <p>维护训练资料库与账号。学员端只保留练习闭环。</p>
        </div>
        ${tabsHtml()}
        ${cache.error ? `<div class="action-toast">${escapeHtml(cache.error)}</div>` : ''}
        ${cache.message ? `<div class="admin-toast-ok">${escapeHtml(cache.message)}</div>` : ''}
        ${cache.busy ? '<div class="feedback-loading"><p>加载中…</p></div>' : panelHtml()}
      </div>`;

    viewEl.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        tab = btn.dataset.adminTab;
        cache.message = '';
        cache.error = '';
        await render(viewEl, setPage);
      });
    });

    viewEl.querySelectorAll('[data-user-role-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        userRoleTab = btn.dataset.userRoleTab;
        await render(viewEl, setPage);
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
        await render(viewEl, setPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage);
      }
    });

    viewEl.querySelectorAll('[data-del-case]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除该病例？学员将无法再选到它。')) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/cases/${encodeURIComponent(btn.dataset.delCase)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = data?.detail || data?.error || '删除失败';
        else {
          cache.message = '病例已删除';
          await loadAll();
        }
        await render(viewEl, setPage);
      });
    });

    document.getElementById('admin-scene-save')?.addEventListener('click', async () => {
      const title = document.getElementById('admin-scene-title')?.value?.trim();
      const summary = document.getElementById('admin-scene-summary')?.value?.trim() || '';
      const code = document.getElementById('admin-scene-code')?.value?.trim() || '';
      let id = document.getElementById('admin-scene-id')?.value?.trim();
      if (!title) {
        cache.error = '请填写场景名称';
        await render(viewEl, setPage);
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
        }),
      });
      if (!data?.ok) cache.error = data?.detail || data?.error || '保存失败';
      else {
        cache.message = `场景「${title}」已保存`;
        await loadAll();
      }
      await render(viewEl, setPage);
    });

    viewEl.querySelectorAll('[data-del-scene]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除该场景？')) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/scenes/${encodeURIComponent(btn.dataset.delScene)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = data?.detail || data?.error || '删除失败';
        else {
          cache.message = '场景已删除';
          await loadAll();
        }
        await render(viewEl, setPage);
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
      await render(viewEl, setPage);
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
        await render(viewEl, setPage);
      });
    });

    viewEl.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除该账号？')) return;
        const { data } = await fetchApi(`${API_BASE}/api/admin/users/${encodeURIComponent(btn.dataset.delUser)}`, { method: 'DELETE' });
        if (!data?.ok) cache.error = data?.detail || data?.error || '删除失败';
        else {
          cache.message = '账号已删除';
          await loadAll();
        }
        await render(viewEl, setPage);
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
          await render(viewEl, setPage);
        } catch (err) {
          cache.error = String(err.message || err);
          await render(viewEl, setPage);
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
        await render(viewEl, setPage);
      } catch (err) {
        cache.error = String(err.message || err);
        await render(viewEl, setPage);
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
            portrait_path: portrait_path || undefined,
          }),
        });
        if (!data?.ok) cache.error = data?.detail || data?.error || '保存失败';
        else {
          cache.message = '形象绑定已保存';
          await loadAll();
        }
        await render(viewEl, setPage);
      });
    });

    // 肖像下拉即时预览
    viewEl.querySelectorAll('[data-av-portrait]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const card = sel.closest('.admin-avatar-card');
        const img = card?.querySelector('.admin-avatar-preview img');
        if (img && sel.value) img.src = sel.value;
      });
    });
  }

  return { render, loadAll, isAdminUser };
}
