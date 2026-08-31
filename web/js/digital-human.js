/**
 * 受试者沟通舞台（Phase 5：自制肖像 + 诊室场景，Live2D 可选）
 * - 默认：项目 SVG 半身像（按 persona 匹配中年/老年男女性）
 * - 可选：Live2D CubismWebSamples 官方示例（manifest persona_visual=live2d）
 * - 背景：CSS 诊室 + 可选 MiniMax 生成图（scripts/generate_persona_assets.py）
 */

import { createLive2DEngine, loadLive2DManifest } from './live2d-loader.js';
import { createAvatar3DEngine } from './avatar3d.js';

const PERSONA_META = {
  'PER-HTN-TAXI-01': { tone: 'middle-male', role: '中年男性 · 模拟受试者' },
  'PER-ELDER-BASIC-01': { tone: 'elder-male', role: '老年男性 · 模拟受试者' },
  'PER-ELDER-FEMALE-02': { tone: 'elder-female', role: '老年女性 · 模拟受试者' },
  default: { tone: 'neutral', role: '模拟受试者' },
};

const PORTRAIT_SVG = {
  'PER-HTN-TAXI-01': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 520" role="img"><ellipse cx="180" cy="470" rx="130" ry="28" fill="#0f172a" opacity=".12"/><path d="M95 500 L265 500 L250 360 Q180 330 110 360 Z" fill="#334155"/><path d="M120 360 L240 360 L225 250 Q180 220 135 250 Z" fill="#475569"/><defs><radialGradient id="face-htn" cx="50%" cy="38%" r="42%"><stop offset="0%" stop-color="#f0d0b0"/><stop offset="100%" stop-color="#d4a574"/></radialGradient></defs><path d="M145 250 Q180 205 215 250 L205 175 Q180 150 155 175 Z" fill="url(#face-htn)"/><path d="M118 178 C125 130 155 108 180 108 C205 108 235 130 242 178 C228 168 152 168 118 178 Z" fill="#3f3f46"/><path d="M150 175 Q180 188 210 175" stroke="#8b5e3c" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="158" cy="198" rx="9" ry="6" fill="#1e293b"/><ellipse cx="202" cy="198" rx="9" ry="6" fill="#1e293b"/><ellipse cx="160" cy="197" rx="3" ry="3" fill="#fff" opacity=".7"/><ellipse cx="204" cy="197" rx="3" ry="3" fill="#fff" opacity=".7"/><path d="M165 218 Q180 228 195 218" stroke="#92400e" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  'PER-ELDER-BASIC-01': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 520" role="img"><ellipse cx="180" cy="470" rx="130" ry="28" fill="#0f172a" opacity=".12"/><path d="M95 500 L265 500 L250 360 Q180 330 110 360 Z" fill="#475569"/><path d="M120 360 L240 360 L225 250 Q180 220 135 250 Z" fill="#64748b"/><defs><radialGradient id="face-elder-m" cx="50%" cy="38%" r="42%"><stop offset="0%" stop-color="#f3dcc8"/><stop offset="100%" stop-color="#d9b896"/></radialGradient></defs><path d="M142 250 Q180 200 218 250 L210 172 Q180 145 150 172 Z" fill="url(#face-elder-m)"/><path d="M112 182 C118 125 148 102 180 102 C212 102 242 125 248 182 C230 170 130 170 112 182 Z" fill="#d4d4d8"/><path d="M138 168 Q148 158 158 168" stroke="#9ca3af" stroke-width="3" fill="none"/><path d="M202 168 Q212 158 222 168" stroke="#9ca3af" stroke-width="3" fill="none"/><ellipse cx="156" cy="200" rx="8" ry="5" fill="#334155"/><ellipse cx="204" cy="200" rx="8" ry="5" fill="#334155"/><path d="M164 222 Q180 232 196 222" stroke="#a16207" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  'PER-ELDER-FEMALE-02': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 520" role="img"><ellipse cx="180" cy="470" rx="130" ry="28" fill="#0f172a" opacity=".12"/><path d="M95 500 L265 500 L248 360 Q180 332 112 360 Z" fill="#7c6f8a"/><path d="M118 360 L242 360 L228 252 Q180 222 132 252 Z" fill="#a78bb5"/><defs><radialGradient id="face-elder-f" cx="50%" cy="38%" r="42%"><stop offset="0%" stop-color="#f8e0d4"/><stop offset="100%" stop-color="#e8b8a8"/></radialGradient></defs><path d="M148 252 Q180 205 212 252 L204 174 Q180 148 156 174 Z" fill="url(#face-elder-f)"/><path d="M120 188 C128 132 152 110 180 110 C208 110 232 132 240 188 C222 176 138 176 120 188 Z" fill="#d4a574"/><ellipse cx="154" cy="200" rx="7" ry="5" fill="#334155"/><ellipse cx="206" cy="200" rx="7" ry="5" fill="#334155"/><path d="M168 224 Q180 234 192 224" stroke="#be185d" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="142" cy="216" rx="10" ry="6" fill="#fda4af" opacity=".35"/><ellipse cx="218" cy="216" rx="10" ry="6" fill="#fda4af" opacity=".35"/></svg>`,
};

const ASSET_BASES = ['', '/static'];

async function resolveAssetUrl(url) {
  if (!url) return null;
  const candidates = [url];
  if (url.startsWith('/live2d/')) {
    candidates.push(`/static${url}`);
    candidates.push(url.replace('/live2d/', 'live2d/'));
  }
  for (const candidate of candidates) {
    for (const base of ASSET_BASES) {
      const full = base ? `${base}${candidate}` : candidate;
      try {
        const res = await fetch(full, { method: 'HEAD', cache: 'no-cache' });
        if (res.ok) return full;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

const stageHolder = (() => {
  let el = document.getElementById('dh-stage-park');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dh-stage-park';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
})();

const live2d = createLive2DEngine();
const avatar3d = createAvatar3DEngine();

function meta(code) {
  return PERSONA_META[code] || PERSONA_META.default;
}

function resolveVisualMode(manifest, code) {
  return manifest?.persona_visual?.[code]
    || manifest?.default_visual
    || 'portrait';
}

function portraitUrl(manifest, code) {
  return manifest?.portraits?.[code] || manifest?.portraits?.default || '';
}

export function createDigitalHumanController({ onStatus } = {}) {
  let speaking = false;
  let thinking = false;
  let personaCode = '';
  let displayName = '模拟受试者';
  let enabled = true;
  let mountEl = null;
  let portraitReady = false;
  let live2dReady = false;
  let avatar3dReady = false;
  let live2dError = '';
  let loading = false;
  let visualMode = 'portrait';
  let sceneChain = Promise.resolve();
  let portraitAudioCtx = null;
  let portraitAudioSource = null;
  let portraitAnalyser = null;
  let portraitLipRaf = null;
  let patientMoodLabel = '';
  let lastLive2dExp = '';
  /** 同一受试者形象加载成功后锁定，避免离开再回来重新解析成另一套脸 */
  let sceneSettledFor = '';

  function portraitStageEl() {
    return shellRoot()?.querySelector('.dh-portrait-stage');
  }

  function stopPortraitLip() {
    if (portraitLipRaf) {
      cancelAnimationFrame(portraitLipRaf);
      portraitLipRaf = null;
    }
    const stage = portraitStageEl();
    if (stage) {
      stage.classList.remove('has-audio-lip');
      stage.style.removeProperty('--lip-open');
    }
    if (portraitAudioSource) {
      try { portraitAudioSource.disconnect(); } catch { /* ignore */ }
      portraitAudioSource = null;
    }
    portraitAnalyser = null;
  }

  function startPortraitLipLoop() {
    const stage = portraitStageEl();
    if (!stage || portraitLipRaf) return;
    stage.classList.add('has-audio-lip');
    const tick = () => {
      if (!speaking) {
        stopPortraitLip();
        return;
      }
      let open = 0.12;
      if (portraitAnalyser) {
        const buf = new Uint8Array(portraitAnalyser.frequencyBinCount);
        portraitAnalyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / (buf.length || 1);
        open = Math.min(1, avg / 80);
      } else {
        open = 0.18 + Math.abs(Math.sin(Date.now() / 88)) * 0.32;
      }
      stage.style.setProperty('--lip-open', open.toFixed(3));
      portraitLipRaf = requestAnimationFrame(tick);
    };
    portraitLipRaf = requestAnimationFrame(tick);
  }

  function attachPortraitAudio(audio) {
    stopPortraitLip();
    if (!audio) {
      startPortraitLipLoop();
      return;
    }
    try {
      if (!portraitAudioCtx) {
        portraitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      portraitAnalyser = portraitAudioCtx.createAnalyser();
      portraitAnalyser.fftSize = 256;
      portraitAudioSource = portraitAudioCtx.createMediaElementSource(audio);
      portraitAudioSource.connect(portraitAnalyser);
      portraitAnalyser.connect(portraitAudioCtx.destination);
    } catch {
      portraitAnalyser = null;
    }
    startPortraitLipLoop();
  }

  function shellRoot() {
    return findShell();
  }

  function statusText() {
    if (loading) return '正在加载…';
    if (live2dError && visualMode === 'live2d') return 'Live2D 暂不可用';
    if (speaking) return '正在说话…';
    if (thinking) return '正在思考…';
    return portraitReady || live2dReady ? '就绪' : '等待对话';
  }

  function canvasHost() {
    return shellRoot()?.querySelector('.dh-live2d-canvas-host');
  }

  async function applyBackground(bgUrl) {
    const scene = shellRoot()?.querySelector('.dh-clinic-scene');
    if (!scene) return;
    scene.classList.remove('has-generated-bg');
    scene.style.backgroundImage = '';
    if (!bgUrl) return;
    const resolved = await resolveAssetUrl(bgUrl);
    if (resolved) {
      scene.classList.add('has-generated-bg');
      scene.style.backgroundImage = `linear-gradient(180deg, rgba(15,23,42,.12), rgba(15,23,42,.38)), url("${resolved}")`;
    }
  }

  async function setPortraitArt(url) {
    const art = shellRoot()?.querySelector('.dh-portrait-art');
    if (!art) return;
    const inline = PORTRAIT_SVG[personaCode] || PORTRAIT_SVG['PER-HTN-TAXI-01'];
    const isRaster = url && /\.(webp|png|jpe?g)(\?|$)/i.test(url);
    if (isRaster) {
      const resolved = await resolveAssetUrl(url);
      if (resolved) {
        art.innerHTML = `<img class="dh-portrait-img-el" src="${resolved}" alt="" decoding="async" />`;
        const img = art.querySelector('img');
        if (img) {
          img.onerror = () => { art.innerHTML = inline; };
        }
        return;
      }
    }
    art.innerHTML = inline;
  }

  function refreshShell() {
    const root = shellRoot();
    if (!root) return;
    const m = meta(personaCode);
    let mode = 'is-loading';
    if (live2dReady) mode = 'is-live2d';
    else if (avatar3dReady) mode = 'is-avatar3d';
    else if (portraitReady) mode = 'is-portrait';
    else if (live2dError) mode = 'is-fallback';
    if (speaking && shellRoot()?.querySelector('.dh-talking-video-wrap:not([hidden])')) {
      mode = 'is-talking-video';
    }

    root.className = `dh-stage dh-tone-${m.tone} ${mode}${speaking ? ' is-speaking' : thinking ? ' is-thinking' : ' is-idle'}`;

    const stateEl = root.querySelector('.dh-live2d-state');
    if (stateEl) {
      stateEl.textContent = loading ? '正在加载受试者形象…' : (live2dError && visualMode === 'live2d' ? live2dError : '');
      stateEl.className = `dh-live2d-state${loading ? ' is-loading' : ''}${live2dError && visualMode === 'live2d' ? ' is-error' : ''}`;
    }

    if (visualMode === 'live2d') {
      live2d.setSpeaking(speaking);
    } else if (visualMode === 'avatar3d') {
      avatar3d.setSpeaking(speaking);
    }

    const moodEl = root.querySelector('.dh-mood-badge');
    if (moodEl) {
      moodEl.textContent = patientMoodLabel || '';
      moodEl.hidden = !patientMoodLabel;
    }
    onStatus?.({ speaking, thinking, enabled, loading, live2dReady, portraitReady, avatar3dReady, live2dError, visualMode });
  }

  function buildShell() {
    const m = meta(personaCode);
    return `
      <div class="dh-stage dh-tone-${m.tone} is-loading is-idle">
        <div class="dh-clinic-scene" aria-hidden="true">
          <div class="dh-clinic-ambient"></div>
          <div class="dh-clinic-wall"></div>
          <div class="dh-clinic-window"></div>
          <div class="dh-clinic-poster"></div>
          <div class="dh-clinic-shelf"></div>
          <div class="dh-clinic-desk"></div>
          <div class="dh-clinic-floor"></div>
          <div class="dh-clinic-vignette"></div>
        </div>
        <div class="dh-portrait-stage">
          <div class="dh-portrait-glow"></div>
          <div class="dh-portrait-art" role="img" aria-label="${escapeHtml(displayName)}"></div>
        </div>
        <div class="dh-talking-video-wrap" hidden>
          <video class="dh-talking-video-el" playsinline preload="auto"></video>
        </div>
        <div class="dh-live2d-canvas-host" aria-hidden="true"></div>
        <div class="dh-avatar3d-host" aria-hidden="true"></div>
        <div class="dh-live2d-state is-loading">正在加载受试者形象…</div>
        <div class="dh-mood-badge" hidden aria-live="polite"></div>
      </div>
    `;
  }

  function findShell() {
    return stageHolder.querySelector('.dh-stage')
      || mountEl?.querySelector('.dh-stage')
      || document.querySelector('#digital-human-mount .dh-stage');
  }

  function moveShellTo(target) {
    const shell = findShell();
    if (shell && target) {
      target.innerHTML = '';
      target.appendChild(shell);
    } else if (target && !target.querySelector('.dh-stage')) {
      target.innerHTML = buildShell();
    }
    mountEl = target;
  }

  async function ensurePortraitScene(manifest) {
    const url = portraitUrl(manifest, personaCode);
    await setPortraitArt(url);
    portraitReady = true;
    live2dReady = false;
    loading = false;
    live2dError = '';
    refreshShell();
  }

  async function ensureAvatar3DScene(manifest) {
    const host = shellRoot()?.querySelector('.dh-avatar3d-host');
    if (!host) throw new Error('3D 容器不存在');
    const url = portraitUrl(manifest, personaCode);
    const resolved = await resolveAssetUrl(url);
    if (!resolved) throw new Error('缺少 AI 肖像资源');
    await avatar3d.mount(host, resolved);
    avatar3dReady = true;
    portraitReady = false;
    live2dReady = false;
    loading = false;
    live2dError = '';
    refreshShell();
  }

  async function ensureLive2DScene(manifest) {
    const host = canvasHost();
    if (!host) throw new Error('画布容器不存在');
    await live2d.mount(host, personaCode);
    live2dReady = true;
    portraitReady = false;
    loading = false;
    live2dError = '';
    refreshShell();
  }

  async function ensureVisualScene() {
    if (!enabled || !mountEl) return;
    // 已为当前受试者加载过，且壳还在：禁止再跑一遍（Live2D 常因画布尺寸短暂为 0 而误回退肖像）
    if (sceneSettledFor && sceneSettledFor === personaCode) {
      const shell = findShell();
      const artOk = shell?.querySelector('.dh-portrait-art svg, .dh-portrait-art img, .dh-live2d-canvas-host canvas, .dh-avatar3d-host canvas');
      if (shell && artOk) {
        loading = false;
        refreshShell();
        return;
      }
    }

    loading = true;
    live2dError = '';
    portraitReady = false;
    live2dReady = false;
    avatar3dReady = false;
    refreshShell();

    try {
      const manifest = await loadLive2DManifest();
      const bgUrl = manifest?.backgrounds?.[personaCode] || manifest?.backgrounds?.default;
      applyBackground(bgUrl);

      visualMode = resolveVisualMode(manifest, personaCode);
      live2d.unmount();
      avatar3d.unmount();
      if (visualMode === 'live2d') {
        await ensureLive2DScene(manifest);
        const host = canvasHost();
        const hasCanvas = host?.querySelector('canvas');
        const sized = host && host.clientWidth > 40 && host.clientHeight > 40;
        if (!hasCanvas || !sized) {
          console.warn('[Visual] Live2D 画布未就绪，回退到肖像模式');
          live2d.unmount();
          visualMode = 'portrait';
          await ensurePortraitScene(manifest);
        }
      } else if (visualMode === 'avatar3d') {
        await ensureAvatar3DScene(manifest);
      } else {
        await ensurePortraitScene(manifest);
      }
      sceneSettledFor = personaCode;
    } catch (err) {
      console.error('[Visual]', err);
      live2d.unmount();
      avatar3d.unmount();
      try {
        const manifest = await loadLive2DManifest();
        await ensurePortraitScene(manifest);
        live2dError = '';
        sceneSettledFor = personaCode;
      } catch {
        live2dReady = false;
        portraitReady = false;
        loading = false;
        live2dError = err?.message || String(err);
        sceneSettledFor = '';
        refreshShell();
      }
    }
  }

  function queueScene() {
    sceneChain = sceneChain.then(() => ensureVisualScene()).catch((err) => {
      console.error('[Visual queue]', err);
    });
    return sceneChain;
  }

  function attach(el, opts = {}) {
    if (!el) return;
    const prevCode = personaCode;
    moveShellTo(el);
    if (opts.personaCode != null) personaCode = opts.personaCode || '';
    if (opts.displayName != null) displayName = opts.displayName || '模拟受试者';
    if (opts.enabled != null) enabled = !!opts.enabled;
    if (opts.speaking != null) speaking = !!opts.speaking;
    // 勿在 UI 重挂时强制改 thinking，避免点按钮就变表情
    if (opts.thinking != null && opts.forceThinking) thinking = !!opts.thinking;

    const personaChanged = prevCode !== personaCode;
    if (personaChanged) sceneSettledFor = '';
    refreshShell();

    if (!enabled) {
      live2d.unmount();
      avatar3d.unmount();
      live2dReady = false;
      portraitReady = false;
      avatar3dReady = false;
      sceneSettledFor = '';
      return;
    }

    const shell = findShell();
    const artOk = !!shell?.querySelector('.dh-portrait-art svg, .dh-portrait-art img, .dh-live2d-canvas-host canvas, .dh-avatar3d-host canvas');
    const settled = !personaChanged && sceneSettledFor === personaCode && artOk;
    const alreadyReady = live2dReady || portraitReady || avatar3dReady;

    if (settled || (!personaChanged && alreadyReady && artOk)) {
      if (visualMode === 'live2d') {
        const host = canvasHost();
        if (host?.querySelector('canvas')) live2d.rebind(host);
      }
      sceneSettledFor = personaCode;
      loading = false;
      refreshShell();
      return;
    }

    live2d.unmount();
    avatar3d.unmount();
    portraitReady = false;
    live2dReady = false;
    avatar3dReady = false;
    sceneSettledFor = '';
    queueScene();
  }

  function stopTalkingVideoLocal() {
    const wrap = shellRoot()?.querySelector('.dh-talking-video-wrap');
    const video = wrap?.querySelector('video');
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch { /* ignore */ }
    }
    if (wrap) wrap.hidden = true;
    stopPortraitLip();
    speaking = false;
    refreshShell();
  }

  return {
    mount(el) { attach(el, {}); },
    attach,
    parkShell() {
      const shell = mountEl?.querySelector('.dh-stage') || findShell();
      if (shell) {
        stageHolder.innerHTML = '';
        stageHolder.appendChild(shell);
      }
      mountEl = null;
    },
    relayout() {
      live2d.layout();
      avatar3d.layout();
    },
    setPersona({ personaCode: code, displayName: name }) {
      attach(mountEl || stageHolder, { personaCode: code, displayName: name });
    },
    setSubtitle() {},
    setStatusHint(text) {
      const stateEl = shellRoot()?.querySelector('.dh-live2d-state');
      if (stateEl && text) {
        stateEl.textContent = text;
        stateEl.className = 'dh-live2d-state is-loading';
      } else if (stateEl) {
        stateEl.textContent = '';
        stateEl.className = 'dh-live2d-state';
      }
    },
    playTalkingVideo(url) {
      const root = shellRoot();
      const wrap = root?.querySelector('.dh-talking-video-wrap');
      const video = wrap?.querySelector('video');
      if (!root || !wrap || !video || !url) return Promise.resolve();
      stopPortraitLip();
      speaking = true;
      wrap.hidden = false;
      video.src = url;
      video.muted = false;
      refreshShell();
      return new Promise((resolve) => {
        const done = () => {
          stopTalkingVideoLocal();
          resolve();
        };
        video.onended = done;
        video.onerror = done;
        video.play().catch(done);
      });
    },
    stopTalkingVideo() {
      stopTalkingVideoLocal();
    },
    setEnabled(on) {
      enabled = !!on;
      if (!on) {
        speaking = false;
        thinking = false;
        live2d.unmount();
        live2dReady = false;
        portraitReady = false;
      } else if (mountEl) queueScene();
      refreshShell();
    },
    setSpeaking(on) {
      speaking = !!on;
      if (speaking) thinking = false;
      if (visualMode === 'live2d') live2d.setSpeaking(speaking);
      refreshShell();
    },
    setThinking(on) {
      thinking = !!on;
      if (thinking) speaking = false;
      refreshShell();
    },
    attachAudio(audio) {
      speaking = true;
      thinking = false;
      if (visualMode === 'live2d' && audio) live2d.attachAudio(audio);
      else if (visualMode === 'live2d') live2d.setSpeaking(true);
      else if (visualMode === 'portrait') attachPortraitAudio(audio);
      else if (visualMode === 'avatar3d' && audio) avatar3d.attachAudio?.(audio);
      refreshShell();
    },
    detachAudio() {
      speaking = false;
      if (visualMode === 'live2d') live2d.detachAudio();
      else if (visualMode === 'portrait') stopPortraitLip();
      else if (visualMode === 'avatar3d') avatar3d.detachAudio?.();
      refreshShell();
    },
    setPatientMood(affect) {
      if (!affect) {
        patientMoodLabel = '';
        lastLive2dExp = '';
        refreshShell();
        return;
      }
      const parts = [];
      if (affect.stance_label) parts.push(affect.stance_label);
      if (affect.depth_label) parts.push(affect.depth_label);
      patientMoodLabel = parts.join(' · ');
      if (visualMode === 'live2d' && affect.live2d_exp && affect.live2d_exp !== lastLive2dExp) {
        lastLive2dExp = affect.live2d_exp;
        live2d.setMood(affect.live2d_exp);
      }
      refreshShell();
    },
    destroy() {
      stopTalkingVideoLocal();
      stopPortraitLip();
      live2d.destroy();
      if (mountEl) mountEl.innerHTML = '';
      stageHolder.innerHTML = '';
      mountEl = null;
      speaking = false;
      thinking = false;
      live2dReady = false;
      portraitReady = false;
      avatar3dReady = false;
      live2dError = '';
      loading = false;
      sceneSettledFor = '';
      lastLive2dExp = '';
      patientMoodLabel = '';
    },
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
