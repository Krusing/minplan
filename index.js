import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── CONSTANTS ──────────────────────────────────────────────
const GRID   = 24;    // pixels per grid unit
const WALL_H = 2.6;   // wall height in meters (3D)
const WALL_T = 0.15;  // wall thickness in meters (3D)
const UNIT   = 0.5;   // 1 grid unit = 0.5 meters

// ── STATE ──────────────────────────────────────────────────
const state = {
  walls:     [],    // [{x1,y1,x2,y2}] grid coordinates
  tool:      'wall', // wall | erase
  wallStart:  null,  // {x,y} or null
  hoverPt:    null,  // current snapped grid point
  hoverWall:  -1,    // index of highlighted wall (erase mode)

  panX:       0,
  panY:       0,
  zoom:       1,
  isPanning:  false,
  panSX:      0,
  panSY:      0,

  view:       'split',
  dirty3d:    true,
};

// ── 2D CANVAS ──────────────────────────────────────────────
const canvas2d = document.getElementById('floor-plan');
const ctx      = canvas2d.getContext('2d');

function screenToGrid(sx, sy) {
  const g = GRID * state.zoom;
  return {
    x: Math.round((sx - state.panX) / g),
    y: Math.round((sy - state.panY) / g),
  };
}

function gridToScreen(gx, gy) {
  const g = GRID * state.zoom;
  return { x: gx * g + state.panX, y: gy * g + state.panY };
}

// Enforce orthogonal endpoint (snap to H or V from start)
function orthoEnd(start, cursor) {
  const dx = Math.abs(cursor.x - start.x);
  const dy = Math.abs(cursor.y - start.y);
  return dx >= dy
    ? { x: cursor.x, y: start.y }
    : { x: start.x, y: cursor.y };
}

function ptToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function wallHit(mx, my) {
  const threshold = 9;
  for (let i = 0; i < state.walls.length; i++) {
    const w  = state.walls[i];
    const p1 = gridToScreen(w.x1, w.y1);
    const p2 = gridToScreen(w.x2, w.y2);
    if (ptToSegDist(mx, my, p1.x, p1.y, p2.x, p2.y) < threshold) return i;
  }
  return -1;
}

function draw2D() {
  const W = canvas2d.width;
  const H = canvas2d.height;
  ctx.clearRect(0, 0, W, H);

  // Canvas background
  ctx.fillStyle = '#ede8e0';
  ctx.fillRect(0, 0, W, H);

  const g = GRID * state.zoom;
  const sx0 = Math.floor(-state.panX / g);
  const sy0 = Math.floor(-state.panY / g);
  const sx1 = Math.ceil((W - state.panX) / g);
  const sy1 = Math.ceil((H - state.panY) / g);

  // Minor grid lines
  ctx.strokeStyle = 'rgba(160,148,135,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = sx0; x <= sx1; x++) {
    const px = x * g + state.panX;
    ctx.moveTo(px, 0); ctx.lineTo(px, H);
  }
  for (let y = sy0; y <= sy1; y++) {
    const py = y * g + state.panY;
    ctx.moveTo(0, py); ctx.lineTo(W, py);
  }
  ctx.stroke();

  // Major grid lines (every 2 units = 1 m)
  ctx.strokeStyle = 'rgba(160,148,135,0.50)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = sx0; x <= sx1; x++) {
    if (x % 2 === 0) {
      const px = x * g + state.panX;
      ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
  }
  for (let y = sy0; y <= sy1; y++) {
    if (y % 2 === 0) {
      const py = y * g + state.panY;
      ctx.moveTo(0, py); ctx.lineTo(W, py);
    }
  }
  ctx.stroke();

  // ── Walls ──
  const wallThickPx = Math.max(3, g * 0.3);
  ctx.lineCap = 'round';
  for (let i = 0; i < state.walls.length; i++) {
    const w   = state.walls[i];
    const p1  = gridToScreen(w.x1, w.y1);
    const p2  = gridToScreen(w.x2, w.y2);
    const isHov = i === state.hoverWall;

    ctx.strokeStyle = isHov ? '#c04040' : '#4a3f35';
    ctx.lineWidth   = isHov ? wallThickPx + 2 : wallThickPx;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // ── Wall preview while drawing ──
  if (state.tool === 'wall' && state.wallStart && state.hoverPt) {
    const end = orthoEnd(state.wallStart, state.hoverPt);
    const p1  = gridToScreen(state.wallStart.x, state.wallStart.y);
    const p2  = gridToScreen(end.x, end.y);

    ctx.strokeStyle = 'rgba(74,63,53,0.38)';
    ctx.lineWidth   = wallThickPx;
    ctx.lineCap     = 'round';
    ctx.setLineDash([g * 0.45, g * 0.2]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Length label
    const lenM = Math.hypot(end.x - state.wallStart.x, end.y - state.wallStart.y) * UNIT;
    if (lenM > 0) {
      const mx2 = (p1.x + p2.x) / 2;
      const my2 = (p1.y + p2.y) / 2;
      ctx.fillStyle    = '#8b7355';
      ctx.font         = '11px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${lenM.toFixed(1)} m`, mx2, my2 - 6);
    }
  }

  // ── Snap indicator ──
  if (state.tool === 'wall' && state.hoverPt) {
    const snapPt = state.wallStart ? orthoEnd(state.wallStart, state.hoverPt) : state.hoverPt;

    if (state.wallStart) {
      const sp1 = gridToScreen(state.wallStart.x, state.wallStart.y);
      ctx.fillStyle = '#8b7355';
      ctx.beginPath();
      ctx.arc(sp1.x, sp1.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const sp = gridToScreen(snapPt.x, snapPt.y);
    ctx.fillStyle   = '#8b7355';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ── 3D SCENE ──────────────────────────────────────────────
let renderer, scene, camera, orbitCtrl;

function init3D() {
  const container = document.getElementById('view-3d');

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf0ebe3);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf0ebe3, 25, 60);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(8, 8, 8);
  camera.lookAt(0, 0, 0);

  orbitCtrl = new OrbitControls(camera, renderer.domElement);
  orbitCtrl.enableDamping  = true;
  orbitCtrl.dampingFactor  = 0.08;
  orbitCtrl.minDistance    = 1;
  orbitCtrl.maxDistance    = 50;
  orbitCtrl.maxPolarAngle  = Math.PI / 2 - 0.02;

  // Lighting
  const ambLight = new THREE.AmbientLight(0xfff8f2, 0.55);
  scene.add(ambLight);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.3);
  sunLight.position.set(12, 22, 10);
  sunLight.castShadow              = true;
  sunLight.shadow.mapSize.width    = 2048;
  sunLight.shadow.mapSize.height   = 2048;
  sunLight.shadow.camera.near      = 0.5;
  sunLight.shadow.camera.far       = 80;
  sunLight.shadow.camera.left      = -25;
  sunLight.shadow.camera.right     = 25;
  sunLight.shadow.camera.top       = 25;
  sunLight.shadow.camera.bottom    = -25;
  sunLight.shadow.bias             = -0.001;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0xd0e8ff, 0.35);
  fillLight.position.set(-8, 10, -5);
  scene.add(fillLight);

  // Floor
  const floorGeo = new THREE.PlaneGeometry(60, 60);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0xf5efe6 });
  const floor    = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x   = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid helper (very subtle)
  const gridHelper = new THREE.GridHelper(60, 120, 0xddd8d0, 0xe8e4dc);
  gridHelper.position.y = 0.001;
  scene.add(gridHelper);

  resize3D();
}

function rebuild3D() {
  if (!state.dirty3d) return;
  state.dirty3d = false;

  // Remove previously built objects
  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (scene.children[i].userData.dynamic) scene.remove(scene.children[i]);
  }

  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf5f0e8 });

  for (const w of state.walls) {
    const dx  = (w.x2 - w.x1) * UNIT;
    const dz  = (w.y2 - w.y1) * UNIT;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) continue;

    const cx = (w.x1 + w.x2) / 2 * UNIT;
    const cz = (w.y1 + w.y2) / 2 * UNIT;

    let bw, bd;
    if (Math.abs(dz) < 0.001) {   // horizontal wall
      bw = Math.abs(dx) + WALL_T;
      bd = WALL_T;
    } else {                       // vertical wall
      bw = WALL_T;
      bd = Math.abs(dz) + WALL_T;
    }

    const geo  = new THREE.BoxGeometry(bw, WALL_H, bd);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(cx, WALL_H / 2, cz);
    mesh.castShadow        = true;
    mesh.receiveShadow     = true;
    mesh.userData.dynamic  = true;
    scene.add(mesh);
  }
}

function resize3D() {
  const c = document.getElementById('view-3d');
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h || !renderer) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── INPUT HANDLING ─────────────────────────────────────────
function getCanvasXY(e) {
  const r = canvas2d.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

canvas2d.addEventListener('mousemove', (e) => {
  const { mx, my } = getCanvasXY(e);

  if (state.isPanning) {
    state.panX += mx - state.panSX;
    state.panY += my - state.panSY;
    state.panSX = mx;
    state.panSY = my;
    return;
  }

  state.hoverPt = screenToGrid(mx, my);

  if (state.tool === 'erase') {
    state.hoverWall = wallHit(mx, my);
    canvas2d.style.cursor = state.hoverWall >= 0 ? 'pointer' : 'default';
  } else {
    state.hoverWall = -1;
    canvas2d.style.cursor = 'crosshair';
  }
});

canvas2d.addEventListener('mousedown', (e) => {
  const { mx, my } = getCanvasXY(e);

  // Middle-click or Alt+drag → pan
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    state.isPanning = true;
    state.panSX = mx;
    state.panSY = my;
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;

  const gpt = screenToGrid(mx, my);

  if (state.tool === 'wall') {
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = orthoEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        state.walls.push({ x1: state.wallStart.x, y1: state.wallStart.y, x2: end.x, y2: end.y });
        state.wallStart = { ...end }; // continue from here
        state.dirty3d   = true;
      }
    }
  } else if (state.tool === 'erase') {
    if (state.hoverWall >= 0) {
      state.walls.splice(state.hoverWall, 1);
      state.hoverWall = -1;
      state.dirty3d   = true;
    }
  }

  updateStatus();
});

canvas2d.addEventListener('mouseup', (e) => {
  if (state.isPanning || e.button === 1) { state.isPanning = false; }
});

canvas2d.addEventListener('mouseleave', () => {
  state.hoverPt   = null;
  state.isPanning = false;
});

canvas2d.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.tool === 'wall') {
    state.wallStart = null;
    updateStatus();
  }
});

canvas2d.addEventListener('dblclick', () => {
  if (state.tool === 'wall') {
    state.wallStart = null;
    updateStatus();
  }
});

canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { mx, my } = getCanvasXY(e);
  const oldZoom    = state.zoom;
  const factor     = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.zoom       = Math.max(0.25, Math.min(5, state.zoom * factor));
  state.panX       = mx - (mx - state.panX) * (state.zoom / oldZoom);
  state.panY       = my - (my - state.panY) * (state.zoom / oldZoom);
}, { passive: false });

window.addEventListener('mouseup', () => { state.isPanning = false; });

// ── UI CONTROLS ────────────────────────────────────────────
document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.tool      = btn.dataset.tool;
    state.wallStart = null;

    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    updateStatus();
  });
});

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const cw  = document.getElementById('canvas-wrap');
    const v3d = document.getElementById('view-3d');
    cw.style.display  = state.view !== '3d' ? 'block' : 'none';
    v3d.style.display = state.view !== '2d' ? 'block' : 'none';

    setTimeout(() => { resize3D(); resizeCanvas(); }, 50);
  });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Rensa alla väggar?')) return;
  state.walls     = [];
  state.wallStart = null;
  state.dirty3d   = true;
  updateStatus();
});

function updateStatus() {
  const msgs = {
    wall:  state.wallStart
             ? 'Klicka för att placera slutpunkt  ·  Högerklicka = avbryt'
             : 'Klicka för att starta en vägg',
    erase: 'Klicka på en vägg för att ta bort den',
  };
  document.getElementById('status').textContent = msgs[state.tool] ?? '';
}

// ── CANVAS RESIZE ──────────────────────────────────────────
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const w    = wrap.clientWidth;
  const h    = wrap.clientHeight;
  if (!w || !h) return;

  const firstResize = canvas2d.width === 0;
  canvas2d.width  = w;
  canvas2d.height = h;

  if (firstResize) {
    state.panX = w / 2 - 10 * GRID;
    state.panY = h / 2 - 8  * GRID;
  }
}

// ── MAIN LOOP ──────────────────────────────────────────────
let lastW3d = 0, lastH3d = 0;

function loop() {
  requestAnimationFrame(loop);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap.clientWidth !== canvas2d.width || wrap.clientHeight !== canvas2d.height) {
    resizeCanvas();
  }

  const v3d = document.getElementById('view-3d');
  if (v3d.clientWidth !== lastW3d || v3d.clientHeight !== lastH3d) {
    lastW3d = v3d.clientWidth;
    lastH3d = v3d.clientHeight;
    resize3D();
  }

  if (state.view !== '3d') draw2D();

  if (renderer && state.view !== '2d') {
    rebuild3D();
    orbitCtrl.update();
    renderer.render(scene, camera);
  }
}

// ── INIT ───────────────────────────────────────────────────
function init() {
  resizeCanvas();
  init3D();
  updateStatus();
  loop();
}

init();
