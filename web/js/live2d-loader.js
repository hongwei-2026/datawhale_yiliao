/**
 * Live2D Cubism 4 加载器（参考 Open-LLM-VTuber model_dict 布局）
 * - 运行时从 /live2d/lib 按序加载脚本
 * - 单例 Pixi 应用，mount/unmount 不销毁画布
 * - 半身 Gal 构图：anchor 底部居中 + manifest 调参
 */

const LIB_BASES = ['/live2d/lib', '/static/live2d/lib'];
const MANIFEST_URLS = ['/live2d/manifest.json', '/static/live2d/manifest.json'];
const LIB_CACHE_BUST = '20260906demo';

const RUNTIME_STEPS = [
  { file: 'live2dcubismcore.min.js', ready: () => !!window.Live2DCubismCore },
  { file: 'pixi.min.js', ready: () => !!window.PIXI?.Application },
  { file: 'cubism4.min.js', ready: () => !!window.PIXI?.live2d?.Live2DModel },
];

let manifestCache = null;
let runtimePromise = null;

function waitUntil(test, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (test()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Live2D runtime timeout'));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function scriptLoaded(url) {
  return !!document.querySelector(`script[data-live2d-src="${url}"]`);
}

function injectScript(url) {
  if (scriptLoaded(url)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.async = false;
    el.dataset.live2dSrc = url;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`脚本加载失败: ${url}`));
    document.head.appendChild(el);
  });
}

async function resolveLibUrl(file) {
  for (const base of LIB_BASES) {
    const url = `${base}/${file}?v=${LIB_CACHE_BUST}`;
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
      if (res.ok) return url;
    } catch {
      /* try next */
    }
  }
  return `${LIB_BASES[0]}/${file}?v=${LIB_CACHE_BUST}`;
}

export async function ensureLive2DRuntime() {
  if (RUNTIME_STEPS.every((s) => s.ready())) return;
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    for (const step of RUNTIME_STEPS) {
      if (step.ready()) continue;
      const url = await resolveLibUrl(step.file);
      await injectScript(url);
      await waitUntil(step.ready);
    }
  })();

  try {
    await runtimePromise;
  } catch (err) {
    runtimePromise = null;
    throw err;
  }
}

export async function loadLive2DManifest() {
  if (manifestCache) return manifestCache;
  let lastErr = null;
  for (const url of MANIFEST_URLS) {
    try {
      const res = await fetch(`${url}?v=${LIB_CACHE_BUST}`, { cache: 'force-cache' });
      if (!res.ok) continue;
      manifestCache = await res.json();
      return manifestCache;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('无法加载 live2d/manifest.json');
}

export function resolveModelKey(manifest, personaCode) {
  const map = manifest?.persona_map || {};
  return map[personaCode] || map.default || 'mark';
}

export function createLive2DEngine() {
  let app = null;
  let model = null;
  let hostEl = null;
  let resizeObs = null;
  let loadedKey = '';
  let modelCfg = null;
  let speaking = false;
  let thinking = false;
  let lipTicker = null;
  let audioCtx = null;
  let audioAnalyser = null;
  let audioSource = null;
  let idleTimer = null;

  function libs() {
    return {
      PIXI: window.PIXI,
      Live2DModel: window.PIXI?.live2d?.Live2DModel,
    };
  }

  function mouthIds() {
    return ['ParamMouthOpenY', 'ParamMouthForm', 'PARAM_MOUTH_OPEN_Y'];
  }

  function setMouth(value) {
    if (!model?.internalModel?.coreModel) return;
    const core = model.internalModel.coreModel;
    for (const id of mouthIds()) {
      try {
        core.setParameterValueById(id, value);
        return;
      } catch {
        /* try next */
      }
    }
  }

  function layoutModel() {
    if (!app || !model || !hostEl) return;
    const w = Math.max(hostEl.clientWidth, 320);
    const h = Math.max(hostEl.clientHeight, 360);
    app.renderer.resize(w, h);

    const reserve = modelCfg?.reserveBottom ?? 0.34;
    const usableH = h * (1 - reserve);
    const base = modelCfg?.kScale ?? 0.2;

    model.scale.set(1);
    model.anchor.set(0.5, 0.5);
    const bounds = model.getBounds();
    const modelH = Math.max(bounds.height, 1);
    const modelW = Math.max(bounds.width, 1);

    const scaleH = (usableH * 0.9) / modelH;
    const scaleW = (w * 0.48) / modelW;
    const scale = Math.min(scaleH, scaleW, (w / 720) * base * 2.2);

    model.scale.set(scale);
    model.anchor.set(modelCfg?.anchorX ?? 0.5, modelCfg?.anchorY ?? 1);
    model.x = w / 2 + (modelCfg?.initialXshift ?? 0);
    model.y = h * (1 - reserve) + (modelCfg?.initialYshift ?? 0);
  }

  function stopLipTicker() {
    if (lipTicker) {
      app?.ticker?.remove(lipTicker);
      lipTicker = null;
    }
    setMouth(0);
  }

  function startLipTicker() {
    if (!app || lipTicker) return;
    lipTicker = () => {
      if (!speaking) {
        setMouth(0);
        return;
      }
      if (audioAnalyser) {
        const data = new Uint8Array(audioAnalyser.frequencyBinCount);
        audioAnalyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const avg = sum / Math.max(data.length, 1) / 255;
        setMouth(Math.min(1, avg * 2.2));
      } else {
        setMouth(0.25 + Math.sin(Date.now() / 90) * 0.2);
      }
    };
    app.ticker.add(lipTicker);
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleMotion() {
    clearIdleTimer();
    if (!model || speaking) return;
    const group = modelCfg?.idleMotionGroupName || 'Idle';
    idleTimer = setTimeout(() => {
      try {
        model.motion(group);
      } catch {
        /* ignore */
      }
      scheduleIdleMotion();
    }, 4500 + Math.random() * 3500);
  }

  function applyExpression(name) {
    if (!model || !name) return;
    try {
      model.expression(name);
    } catch {
      /* ignore */
    }
  }

  function refreshEmotion() {
    const map = modelCfg?.emotionMap || {};
    if (speaking) applyExpression(map.speaking);
    else if (thinking) applyExpression(map.thinking);
    else applyExpression(map.neutral);
  }

  async function initPixi(host) {
    await ensureLive2DRuntime();
    const { PIXI } = libs();
    if (!PIXI?.Application) throw new Error('PixiJS 未就绪');

    if (app) {
      hostEl = host;
      if (app.view && !host.contains(app.view)) host.appendChild(app.view);
      layoutModel();
      return;
    }

    hostEl = host;
    app = new PIXI.Application({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      resizeTo: host,
    });
    app.view.classList.add('dh-live2d-canvas');
    host.appendChild(app.view);
    resizeObs = new ResizeObserver(() => layoutModel());
    resizeObs.observe(host);
  }

  async function loadModel(key, manifest) {
    const { Live2DModel } = libs();
    const cfg = manifest?.models?.[key];
    if (!cfg?.path) throw new Error(`未找到模型配置: ${key}`);

    if (model && loadedKey === key) {
      modelCfg = cfg;
      layoutModel();
      return;
    }

    if (model) {
      try {
        app.stage.removeChild(model);
        model.destroy();
      } catch {
        /* ignore */
      }
      model = null;
      loadedKey = '';
    }

    // 简单直载：不再做 blob / 预拉 / 强刷，保证演示流畅
    const instance = await Live2DModel.from(cfg.path, { autoInteract: false });
    modelCfg = cfg;
    model = instance;
    loadedKey = key;
    app.stage.addChild(model);

    instance.on('motionFinish', () => {
      if (!speaking) scheduleIdleMotion();
    });

    layoutModel();
    applyExpression(cfg.emotionMap?.neutral);
    scheduleIdleMotion();
  }

  return {
    rebind(host) {
      if (!host) return;
      hostEl = host;
      if (app?.view && !host.contains(app.view)) {
        host.appendChild(app.view);
      }
      layoutModel();
    },

    /** digital-human / 布局变更时调用 */
    layout() {
      layoutModel();
    },

    async mount(host, personaCode) {
      hostEl = host;
      const manifest = await loadLive2DManifest();
      const key = resolveModelKey(manifest, personaCode);
      await initPixi(host);
      await loadModel(key, manifest);
      if (speaking) startLipTicker();
      return { modelKey: key, manifest, modelCfg };
    },

    unmount() {
      stopLipTicker();
      clearIdleTimer();
      if (app?.view?.parentNode) {
        app.view.parentNode.removeChild(app.view);
      }
      hostEl = null;
    },

    setSpeaking(on) {
      speaking = !!on;
      if (speaking) {
        thinking = false;
        startLipTicker();
      } else {
        stopLipTicker();
        scheduleIdleMotion();
      }
      refreshEmotion();
    },

    setThinking(on) {
      thinking = !!on;
      if (thinking) speaking = false;
      refreshEmotion();
    },

    attachAudio(audio) {
      if (!audio) return;
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioSource = audioCtx.createMediaElementSource(audio);
        audioSource.connect(audioAnalyser);
        audioAnalyser.connect(audioCtx.destination);
      } catch {
        audioAnalyser = null;
      }
    },

    detachAudio() {
      try {
        audioSource?.disconnect();
      } catch {
        /* ignore */
      }
      audioSource = null;
      audioAnalyser = null;
    },

    destroy() {
      this.unmount();
      this.detachAudio();
      stopLipTicker();
      clearIdleTimer();
      resizeObs?.disconnect();
      resizeObs = null;
      try {
        model?.destroy();
      } catch {
        /* ignore */
      }
      model = null;
      try {
        app?.destroy(true);
      } catch {
        /* ignore */
      }
      app = null;
      loadedKey = '';
    },

    getState() {
      return { loadedKey, speaking, thinking, ready: !!model };
    },
  };
}
