/**
 * AI 肖像驱动的 3D 半身像（Three.js）
 * 将 MiniMax 生成的 webp 贴到 3D  bust 上，支持呼吸/口型/鼠标视差
 */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

let threeModule = null;

async function loadThree() {
  if (!threeModule) threeModule = await import(THREE_URL);
  return threeModule;
}

export function createAvatar3DEngine() {
  let renderer = null;
  let scene = null;
  let camera = null;
  let bustGroup = null;
  let portraitMesh = null;
  let frameId = 0;
  let hostEl = null;
  let speaking = false;
  let thinking = false;
  let startTime = 0;
  let pointerX = 0;
  let pointerY = 0;
  let resizeObs = null;

  function dispose() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    resizeObs?.disconnect();
    resizeObs = null;
    if (renderer) {
      renderer.dispose();
      if (hostEl?.contains(renderer.domElement)) {
        hostEl.removeChild(renderer.domElement);
      }
    }
    renderer = scene = camera = bustGroup = portraitMesh = hostEl = null;
  }

  function buildBust(THREE, texture) {
    const group = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.05 });
    const matShoulder = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.1, 32), matBody);
    torso.position.y = -0.35;
    group.add(torso);

    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.5), matShoulder);
    shoulders.position.y = 0.18;
    group.add(shoulders);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.22, 24), matBody);
    neck.position.y = 0.42;
    group.add(neck);

    const headGeo = new THREE.SphereGeometry(0.52, 48, 48);
    const headMat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.75,
      metalness: 0.02,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.92;
    head.scale.set(1, 1.12, 0.88);
    group.add(head);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.02, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.92;
    group.add(rim);

    group.position.y = -0.15;
    return { group, head };
  }

  function animate(t) {
    if (!renderer || !scene || !camera || !bustGroup) return;
    const elapsed = (t - startTime) / 1000;
    const breath = Math.sin(elapsed * 1.6) * 0.012;
    const talk = speaking ? Math.sin(elapsed * 14) * 0.018 : 0;
    bustGroup.scale.set(1 + breath, 1 + breath + talk * 0.5, 1 + breath);
    bustGroup.rotation.y = pointerX * 0.22 + Math.sin(elapsed * 0.35) * 0.04;
    bustGroup.rotation.x = pointerY * 0.08 + (thinking ? Math.sin(elapsed * 2.2) * 0.02 : 0);
    if (portraitMesh) {
      portraitMesh.rotation.y = bustGroup.rotation.y * 0.3;
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }

  function onPointerMove(e) {
    if (!hostEl) return;
    const rect = hostEl.getBoundingClientRect();
    pointerX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }

  function resize() {
    if (!hostEl || !renderer || !camera) return;
    const w = Math.max(hostEl.clientWidth, 1);
    const h = Math.max(hostEl.clientHeight, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  async function mount(el, portraitUrl) {
    dispose();
    hostEl = el;
    const THREE = await loadThree();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.55, 2.35);
    camera.lookAt(0, 0.45, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.innerHTML = '';
    el.appendChild(renderer.domElement);
    renderer.domElement.className = 'dh-avatar3d-canvas';

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    const key = new THREE.DirectionalLight(0xfff5e6, 1.1);
    key.position.set(2, 3, 4);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.45);
    fill.position.set(-2, 1, 2);
    scene.add(amb, key, fill);

    const loader = new THREE.TextureLoader();
    const texture = await new Promise((resolve, reject) => {
      loader.load(portraitUrl, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;

    const built = buildBust(THREE, texture);
    bustGroup = built.group;
    portraitMesh = built.head;
    scene.add(bustGroup);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.95;
    scene.add(floor);

    resize();
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(el);
    hostEl.addEventListener('pointermove', onPointerMove);

    startTime = performance.now();
    frameId = requestAnimationFrame(animate);
  }

  return {
    mount,
    unmount: dispose,
    setSpeaking(v) { speaking = !!v; },
    setThinking(v) { thinking = !!v; },
    layout: resize,
  };
}
