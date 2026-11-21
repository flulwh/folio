/*
 * Folio 3D 书本舞台
 * 一册程序化生成的精装书：封面 CanvasTexture、书页边缘、书脊烫金、书签飘带。
 * 官网与个人主页共用这一套场景，只换封面文字与配色。
 * 依赖本地 vendor/three.module.min.js；WebGL 不可用时由 CSS 回退书本接管。
 */

import * as THREE from './vendor/three.module.min.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

function shade(hex, amount) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const num = parseInt(full, 16);
  const r = clamp(((num >> 16) & 255) + amount, 0, 255);
  const g = clamp(((num >> 8) & 255) + amount, 0, 255);
  const b = clamp((num & 255) + amount, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function makeCoverTexture(cfg, maxAniso) {
  const W = 1024;
  const H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const cream = '#f1e9d8';
  const accent = cfg.accent;

  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, shade(cfg.cover, 22));
  base.addColorStop(0.52, cfg.cover);
  base.addColorStop(1, shade(cfg.cover, -26));
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // 布面纤维
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 5200; i += 1) {
    const x = rand() * W;
    const y = rand() * H;
    g.fillStyle = `rgba(255,240,220,${(rand() * 0.05).toFixed(3)})`;
    g.fillRect(x, y, 1.4, 1.4);
  }

  // 边缘压暗
  const vign = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.78);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vign;
  g.fillRect(0, 0, W, H);

  // 烫印双线
  g.strokeStyle = 'rgba(241,233,216,0.52)';
  g.lineWidth = 2;
  g.strokeRect(62, 62, W - 124, H - 124);
  g.strokeStyle = 'rgba(241,233,216,0.18)';
  g.lineWidth = 1;
  g.strokeRect(82, 82, W - 164, H - 164);

  if ('letterSpacing' in g) g.letterSpacing = '7px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(241,233,216,0.72)';
  g.font = '500 23px "Courier New", monospace';
  g.fillText(cfg.kicker.toUpperCase(), W / 2, 168);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  // 书名
  let size = 188;
  g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  while (g.measureText(cfg.title).width > W - 260 && size > 80) {
    size -= 6;
    g.font = `700 ${size}px Georgia, "Times New Roman", serif`;
  }
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  g.fillStyle = cream;
  g.fillText(cfg.title, W / 2, 424);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  g.strokeStyle = accent;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2 - 150, 512);
  g.lineTo(W / 2 + 150, 512);
  g.stroke();

  g.fillStyle = 'rgba(241,233,216,0.62)';
  if ('letterSpacing' in g) g.letterSpacing = '9px';
  g.font = '500 21px "Courier New", monospace';
  g.fillText(cfg.tagline.toUpperCase(), W / 2, 566);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  // 中缝印记：一册摊开的书
  const cx = W / 2;
  const cy = 800;
  g.strokeStyle = 'rgba(241,233,216,0.72)';
  g.lineWidth = 3.4;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(cx, cy + 54);
  g.lineTo(cx, cy - 46);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy - 40);
  g.quadraticCurveTo(cx - 62, cy - 76, cx - 132, cy - 48);
  g.lineTo(cx - 132, cy + 40);
  g.quadraticCurveTo(cx - 62, cy + 14, cx, cy + 54);
  g.quadraticCurveTo(cx + 62, cy + 14, cx + 132, cy + 40);
  g.lineTo(cx + 132, cy - 48);
  g.quadraticCurveTo(cx + 62, cy - 76, cx, cy - 40);
  g.stroke();

  g.fillStyle = 'rgba(241,233,216,0.5)';
  if ('letterSpacing' in g) g.letterSpacing = '8px';
  g.font = '500 20px "Courier New", monospace';
  g.fillText(cfg.record, cx, 940);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  // 底部署名
  g.fillStyle = 'rgba(241,233,216,0.86)';
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.font = '500 26px "Courier New", monospace';
  g.fillText(cfg.author.toUpperCase(), cx, 1254);
  g.fillStyle = 'rgba(241,233,216,0.44)';
  g.font = '500 19px "Courier New", monospace';
  g.fillText(cfg.year, cx, 1300);
  if ('letterSpacing' in g) g.letterSpacing = '0px';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function makePageTexture(maxAniso) {
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#e7ddc7';
  g.fillRect(0, 0, W, H);
  let seed = 31;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let x = 0; x < W; x += 2) {
    const a = 0.04 + rand() * 0.14;
    g.strokeStyle = `rgba(120,101,74,${a.toFixed(3)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, H);
    g.stroke();
  }
  const top = g.createLinearGradient(0, 0, 0, H);
  top.addColorStop(0, 'rgba(80,62,40,0.18)');
  top.addColorStop(0.16, 'rgba(80,62,40,0)');
  top.addColorStop(0.84, 'rgba(80,62,40,0)');
  top.addColorStop(1, 'rgba(80,62,40,0.2)');
  g.fillStyle = top;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function buildDust(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 9;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 7;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xf3e6cf,
    size: 0.026,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'dust';
  return points;
}

export function mountBookStage(canvas, options = {}) {
  const cfg = {
    title: 'FOLIO',
    kicker: 'LOCAL FIRST READING SYSTEM',
    tagline: 'READ ANYWHERE · SYNC LOCALLY',
    author: 'FLULWH',
    year: 'MMXXVI',
    record: 'EDITION 01',
    cover: '#4d1712',
    accent: '#c9502f',
    ...options,
  };

  const host = canvas.parentElement || canvas;
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof window.WebGLRenderingContext === 'undefined') {
    host.setAttribute('data-webgl', 'off');
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // 高像素密度屏本身就在超采样，再开 MSAA 只是白烧 GPU；1x 屏才保留抗锯齿。
      antialias: (window.devicePixelRatio || 1) < 1.5,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    host.setAttribute('data-webgl', 'off');
    return null;
  }
  if (!renderer || !renderer.getContext()) {
    host.setAttribute('data-webgl', 'off');
    return null;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  camera.position.set(0, 0.18, 7.4);

  /* ---------- 书 ---------- */
  const book = new THREE.Group();
  scene.add(book);

  const coverMat = new THREE.MeshStandardMaterial({
    map: makeCoverTexture(cfg, maxAniso),
    roughness: 0.58,
    metalness: 0.08,
  });
  const boardMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shade(cfg.cover, -10)),
    roughness: 0.7,
    metalness: 0.04,
  });
  const pageSideMat = new THREE.MeshStandardMaterial({
    map: makePageTexture(maxAniso),
    roughness: 0.92,
    metalness: 0,
  });
  const pageFaceMat = new THREE.MeshStandardMaterial({
    color: 0xeae0ca,
    roughness: 0.95,
    metalness: 0,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xc7a568,
    roughness: 0.34,
    metalness: 0.86,
  });

  const W = 2.24;
  const H = 3.24;
  const T = 0.58;

  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.12, H - 0.14, T),
    [pageSideMat, pageSideMat, pageSideMat, pageSideMat, pageFaceMat, pageFaceMat]
  );
  pages.castShadow = true;
  pages.receiveShadow = true;
  book.add(pages);

  const frontCover = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, 0.062),
    [boardMat, boardMat, boardMat, boardMat, coverMat, boardMat]
  );
  frontCover.position.z = T / 2 + 0.031;
  frontCover.castShadow = true;
  book.add(frontCover);

  const backCover = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, 0.062),
    [boardMat, boardMat, boardMat, boardMat, boardMat, boardMat]
  );
  backCover.position.z = -(T / 2 + 0.031);
  backCover.castShadow = true;
  book.add(backCover);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.15, H + 0.02, T + 0.13), boardMat);
  spine.position.set(-W / 2 + 0.075, 0, 0);
  spine.castShadow = true;
  book.add(spine);

  [-0.86, 0, 0.86].forEach((y) => {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.032, T + 0.14), goldMat);
    band.position.set(-W / 2 - 0.004, y, 0);
    book.add(band);
  });

  book.rotation.set(0.03, -0.46, 0.015);
  book.position.y = -0.04;

  /* ---------- 灯光与地面 ---------- */
  scene.add(new THREE.AmbientLight(0x3a4356, 0.85));

  const shadowSize = window.innerWidth < 760 ? 512 : 1024;
  const key = new THREE.DirectionalLight(0xffd6a6, 3.1);
  key.position.set(3.6, 5.2, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 16;
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0006;
  key.shadow.radius = 4;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x74b9ff, 2.1);
  rim.position.set(-5.2, 1.4, -3.4);
  scene.add(rim);

  const ember = new THREE.PointLight(0xff6a3f, 9, 11, 2);
  ember.position.set(3.2, -1.6, 2.4);
  scene.add(ember);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.82;
  ground.receiveShadow = true;
  scene.add(ground);

  const dust = buildDust(reduce ? 64 : 200);
  scene.add(dust);

  /* ---------- 布局 / 性能 ---------- */
  const state = {
    pointerX: 0,
    pointerY: 0,
    scroll: 0,
    baseX: 0,
    baseY: -0.04,
    baseRotY: -0.46,
  };
  const view = { w: 1, h: 1, top: 0, span: 1 };
  const perf = { frames: 0, elapsed: 0, level: 0 };

  function applySize() {
    const base = window.devicePixelRatio || 1;
    const cap = view.w < 760 ? 1.5 : 1.9;
    const scale = perf.level === 0 ? 1 : perf.level === 1 ? 0.8 : 0.64;
    // 降档时允许低于 1，否则 1x 屏（外接大屏常见）永远降不下来。
    renderer.setPixelRatio(Math.max(0.6, Math.min(base, cap) * scale));
    renderer.setSize(view.w, view.h, false);
    dust.visible = perf.level < 2;
  }

  function measure() {
    const rect = host.getBoundingClientRect();
    view.w = Math.max(1, host.clientWidth || window.innerWidth);
    view.h = Math.max(1, host.clientHeight || window.innerHeight);
    view.top = rect.top + window.scrollY;
    view.span = Math.max(1, rect.height * 0.92);
  }

  function readScroll() {
    state.scroll = clamp((window.scrollY - view.top) / view.span, 0, 1);
  }

  function layout() {
    measure();
    applySize();
    camera.aspect = view.w / view.h;
    camera.fov = view.w < 700 ? 44 : 38;
    camera.updateProjectionMatrix();

    const narrow = view.w < 700;
    const medium = view.w < 1080;
    book.scale.setScalar(narrow ? 0.98 : medium ? 0.88 : 0.95);
    state.baseX = narrow ? 0 : medium ? 0.5 : 1.12;
    state.baseY = narrow ? 0.02 : 0.2;
    book.position.x = state.baseX;
    book.position.y = state.baseY;
    readScroll();
    renderFrame(0, 0);
  }

  function renderFrame(t, dt) {
    const ease = reduce ? 1 : 1 - Math.pow(0.0022, dt);
    const targetRotY = state.baseRotY + state.pointerX * 0.2 + state.scroll * 0.62;
    const targetRotX = 0.03 + state.pointerY * 0.08 - state.scroll * 0.05;
    book.rotation.y += (targetRotY - book.rotation.y) * ease;
    book.rotation.x += (targetRotX - book.rotation.x) * ease;
    book.rotation.z += (0.015 + state.pointerX * 0.02 - book.rotation.z) * ease;
    const floatY = reduce ? 0 : Math.sin(t * 0.7) * 0.035;
    book.position.y += (state.baseY + floatY - state.scroll * 0.62 - book.position.y) * ease;
    book.position.x += (state.baseX + (reduce ? 0 : state.pointerX * 0.05) - book.position.x) * ease;

    // 尘埃整体漂移，避免每帧重传顶点数据。
    if (!reduce) {
      dust.rotation.y = t * 0.018;
      dust.position.y = Math.sin(t * 0.085) * 0.07;
    }

    renderer.render(scene, camera);
  }

  // 帧时间持续偏高时降一档分辨率；余量充足时再升回去。
  function adapt(dt) {
    if (reduce) return;
    perf.frames += 1;
    perf.elapsed += dt;
    if (perf.frames < 90) return;
    const avg = perf.elapsed / perf.frames;
    perf.frames = 0;
    perf.elapsed = 0;
    if (avg > 0.027 && perf.level < 2) {
      perf.level += 1;
      applySize();
    } else if (avg < 0.013 && perf.level > 0) {
      perf.level -= 1;
      applySize();
    }
  }

  /* ---------- 事件 ---------- */
  const onPointer = (event) => {
    if (reduce) return;
    state.pointerX = (event.clientX / view.w) * 2 - 1;
    state.pointerY = (event.clientY / view.h) * 2 - 1;
  };

  if (!reduce && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  // 滚动与尺寸变化都合并到下一帧处理，避免连续触发时反复测量。
  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      readScroll();
      if (reduce) renderFrame(0, 0);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  let resizeQueued = false;
  const queueLayout = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      layout();
    });
  };
  const ro = new ResizeObserver(queueLayout);
  ro.observe(host);
  window.addEventListener('orientationchange', queueLayout);
  window.addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure).catch(() => {});
  }

  let raf = 0;
  let last = 0;
  let running = false;
  let inView = true;

  const loop = (now) => {
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;
    renderFrame(t, dt);
    adapt(dt);
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || reduce || !inView || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  layout();

  if (reduce) {
    renderFrame(0, 0);
  } else {
    start();
  }

  // 首屏滚出视野后暂停渲染，把 GPU 让给正文滚动。
  let io = null;
  if (!reduce && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        inView = entries[0].isIntersecting;
        if (inView) start();
        else stop();
      },
      { threshold: 0.01 }
    );
    io.observe(host);
  }

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);

  return {
    destroy() {
      stop();
      ro.disconnect();
      if (io) io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('orientationchange', queueLayout);
      window.removeEventListener('load', measure);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const list = Array.isArray(obj.material) ? obj.material : [obj.material];
          list.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
      host.setAttribute('data-webgl', 'off');
    },
  };
}
