import * as THREE from 'three';

// ── CONSTANTS ──────────────────────────────────────────────
const GRID          = 24;    // pixels per grid unit
const WALL_H        = 2.6;   // default wall height in meters (3D)
const WALL_T        = 0.15;  // wall thickness in meters (3D)
const UNIT          = 0.5;   // 1 grid unit = 0.5 meters
const FLOOR_SLAB_H  = 0.2;   // thickness of the floor slab between storeys

function floorYOffset(floorIdx) {
  let y = 0;
  for (let i = 0; i < floorIdx; i++) {
    const fd = state.floorDefs[i];
    y += (fd ? fd.wallHeight : WALL_H) + FLOOR_SLAB_H;
  }
  return y;
}

// ── STATE ──────────────────────────────────────────────────
const state = {
  walls:          [],    // [{id, x1, y1, x2, y2, color, floor}]
  openings:       [],    // [{id, wallId, left, width, height, fromFloor, type}]
  gardens:        [],    // [{id, x1, y1, x2, y2}]
  trees:          [],    // [{id, x, y, radius, type}] type: 'tree'|'bush'
  floors3d:       [],    // [{id, x1, y1, x2, y2, color}]
  furniture:      [],    // [{id, x1, y1, x2, y2, height, label, rotation}]
  stairs:         [],    // [{id, x, y, rotation, steps, stepLen, width, floor}]
  floorDefs:      [{id: 0, name: 'BV', wallHeight: 2.6}], // floor definitions
  activeFloor:    0,     // index into floorDefs
  nextWallId:     1,
  nextId:         1,

  tool:           'pan',  // pan | wall | erase | door | window | paint | garden | tree | floor3d | furniture
  rectStart:      null,  // {x,y} start for rectangle tools (garden/floor3d/furniture)
  wallStart:      null,   // {x,y} or null
  hoverPt:        null,
  hoverWall:      -1,     // wall index (erase/placement hover)
  hoverOpening:   null,   // opening id (erase hover)
  openingPreview: null,   // {wallIdx, left, width, height, fromFloor, type}

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

function orthoEnd(start, cursor) {
  const dx = Math.abs(cursor.x - start.x);
  const dy = Math.abs(cursor.y - start.y);
  return dx >= dy ? { x: cursor.x, y: start.y } : { x: start.x, y: cursor.y };
}

function ptToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Returns wall index or -1
function wallHit(mx, my) {
  for (let i = 0; i < state.walls.length; i++) {
    const w  = state.walls[i];
    const p1 = gridToScreen(w.x1, w.y1);
    const p2 = gridToScreen(w.x2, w.y2);
    if (ptToSegDist(mx, my, p1.x, p1.y, p2.x, p2.y) < 9) return i;
  }
  return -1;
}

// Returns opening id or null
function openingHit(mx, my) {
  for (const op of state.openings) {
    const wIdx = state.walls.findIndex(w => w.id === op.wallId);
    if (wIdx < 0) continue;
    const w       = state.walls[wIdx];
    const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (wallLen === 0) continue;
    const p1 = gridToScreen(w.x1, w.y1);
    const p2 = gridToScreen(w.x2, w.y2);
    const t1 = op.left / wallLen;
    const t2 = (op.left + op.width) / wallLen;
    const sx1 = p1.x + t1 * (p2.x - p1.x);
    const sy1 = p1.y + t1 * (p2.y - p1.y);
    const sx2 = p1.x + t2 * (p2.x - p1.x);
    const sy2 = p1.y + t2 * (p2.y - p1.y);
    if (ptToSegDist(mx, my, sx1, sy1, sx2, sy2) < 9) return op.id;
  }
  return null;
}

// ── OPENING HELPERS ────────────────────────────────────────
function getOpeningSettings() {
  if (state.tool === 'door') {
    return {
      width:     parseFloat(document.getElementById('door-width').value)  * 2,
      height:    parseFloat(document.getElementById('door-height').value) * 2,
      fromFloor: 0,
      type:      'door',
    };
  }
  return {
    width:     parseFloat(document.getElementById('win-width').value) * 2,
    height:    parseFloat(document.getElementById('win-height').value) * 2,
    fromFloor: parseFloat(document.getElementById('win-floor').value)  * 2,
    type:      'window',
  };
}

// Returns snapped left-edge (grid units from wall start), or null if wall too short
function snapOpeningLeft(wallIdx, mx, my) {
  const w       = state.walls[wallIdx];
  const p1      = gridToScreen(w.x1, w.y1);
  const p2      = gridToScreen(w.x2, w.y2);
  const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const lenSq   = dx * dx + dy * dy;
  if (lenSq < 0.001) return null;

  const s    = getOpeningSettings();
  if (s.width > wallLen) return null;

  const t           = Math.max(0, Math.min(1, ((mx - p1.x) * dx + (my - p1.y) * dy) / lenSq));
  const center      = Math.round(t * wallLen);           // snap center to grid
  const left        = center - Math.round(s.width / 2);
  return Math.max(0, Math.min(wallLen - s.width, left));
}

// ── 2D DRAW ────────────────────────────────────────────────
function drawWall(w, isHov) {
  const p1      = gridToScreen(w.x1, w.y1);
  const p2      = gridToScreen(w.x2, w.y2);
  const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  const g       = GRID * state.zoom;
  const thick   = Math.max(3, g * 0.3);

  const wallOpenings = state.openings
    .filter(op => op.wallId === w.id)
    .sort((a, b) => a.left - b.left);

  // Solid segments
  const segments = [];
  let cursor = 0;
  for (const op of wallOpenings) {
    if (op.left > cursor) segments.push({ from: cursor, to: op.left });
    cursor = op.left + op.width;
  }
  if (cursor < wallLen) segments.push({ from: cursor, to: wallLen });

  ctx.lineCap     = 'round';
  ctx.strokeStyle = isHov ? '#c04040' : (w.color || '#4a3f35');
  ctx.lineWidth   = isHov ? thick + 2 : thick;

  for (const seg of segments) {
    const t1 = seg.from / wallLen, t2 = seg.to / wallLen;
    ctx.beginPath();
    ctx.moveTo(p1.x + t1 * (p2.x - p1.x), p1.y + t1 * (p2.y - p1.y));
    ctx.lineTo(p1.x + t2 * (p2.x - p1.x), p1.y + t2 * (p2.y - p1.y));
    ctx.stroke();
  }

  // Opening symbols
  for (const op of wallOpenings) {
    const t1   = op.left / wallLen;
    const t2   = (op.left + op.width) / wallLen;
    const ox1  = p1.x + t1 * (p2.x - p1.x);
    const oy1  = p1.y + t1 * (p2.y - p1.y);
    const ox2  = p1.x + t2 * (p2.x - p1.x);
    const oy2  = p1.y + t2 * (p2.y - p1.y);
    const isHovOp = op.id === state.hoverOpening;

    if (op.type === 'window') {
      ctx.strokeStyle = isHovOp ? '#c04040' : 'rgba(80,150,210,0.85)';
      ctx.lineWidth   = isHovOp ? 3 : 2;
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      ctx.moveTo(ox1, oy1);
      ctx.lineTo(ox2, oy2);
      ctx.stroke();
    } else {
      // Door: thin line + small arc for swing
      ctx.strokeStyle = isHovOp ? '#c04040' : 'rgba(120,90,60,0.6)';
      ctx.lineWidth   = isHovOp ? 2 : 1.5;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(ox1, oy1);
      ctx.lineTo(ox2, oy2);
      ctx.stroke();

      // Swing arc (quarter circle from ox1 corner)
      if (!isHovOp) {
        const swingR = Math.hypot(ox2 - ox1, oy2 - oy1);
        const angle  = Math.atan2(oy2 - oy1, ox2 - ox1);
        ctx.strokeStyle = 'rgba(120,90,60,0.3)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(ox1, oy1, swingR, angle, angle - Math.PI / 2, true);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Hover label for erase
    if (isHovOp) {
      ctx.fillStyle    = '#c04040';
      ctx.font         = '10px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(op.type === 'door' ? 'Dörr' : 'Fönster', (ox1 + ox2) / 2, (oy1 + oy2) / 2 - 7);
    }
  }
}

function drawOpeningPreview() {
  const prev = state.openingPreview;
  if (!prev) return;

  const w       = state.walls[prev.wallIdx];
  const p1      = gridToScreen(w.x1, w.y1);
  const p2      = gridToScreen(w.x2, w.y2);
  const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

  const t1  = prev.left / wallLen;
  const t2  = (prev.left + prev.width) / wallLen;
  const ox1 = p1.x + t1 * (p2.x - p1.x);
  const oy1 = p1.y + t1 * (p2.y - p1.y);
  const ox2 = p1.x + t2 * (p2.x - p1.x);
  const oy2 = p1.y + t2 * (p2.y - p1.y);

  const g     = GRID * state.zoom;
  const thick = Math.max(3, g * 0.3);
  const color = prev.type === 'door' ? 'rgba(100,170,90,0.85)' : 'rgba(60,130,210,0.85)';

  ctx.strokeStyle = color;
  ctx.lineWidth   = thick + 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ox1, oy1);
  ctx.lineTo(ox2, oy2);
  ctx.stroke();

  // Dimension label
  const widthM = prev.width * UNIT;
  ctx.fillStyle    = prev.type === 'door' ? '#3a8a30' : '#2060b0';
  ctx.font         = '11px system-ui';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${widthM.toFixed(1)} m`, (ox1 + ox2) / 2, (oy1 + oy2) / 2 - 7);
}

function draw2D() {
  const W = canvas2d.width;
  const H = canvas2d.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#ede8e0';
  ctx.fillRect(0, 0, W, H);

  const g   = GRID * state.zoom;
  const sx0 = Math.floor(-state.panX / g);
  const sy0 = Math.floor(-state.panY / g);
  const sx1 = Math.ceil((W - state.panX) / g);
  const sy1 = Math.ceil((H - state.panY) / g);

  ctx.strokeStyle = 'rgba(160,148,135,0.22)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  for (let x = sx0; x <= sx1; x++) { const px = x * g + state.panX; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
  for (let y = sy0; y <= sy1; y++) { const py = y * g + state.panY; ctx.moveTo(0, py); ctx.lineTo(W, py); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(160,148,135,0.50)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  for (let x = sx0; x <= sx1; x++) { if (x % 2 === 0) { const px = x * g + state.panX; ctx.moveTo(px, 0); ctx.lineTo(px, H); } }
  for (let y = sy0; y <= sy1; y++) { if (y % 2 === 0) { const py = y * g + state.panY; ctx.moveTo(0, py); ctx.lineTo(W, py); } }
  ctx.stroke();

  // Floor surfaces
  for (const fl of state.floors3d) {
    const p1 = gridToScreen(fl.x1, fl.y1);
    const p2 = gridToScreen(fl.x2, fl.y2);
    ctx.fillStyle   = fl.color + '66'; // 40% alpha
    ctx.strokeStyle = fl.color + 'aa';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.rect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.abs(p2.x-p1.x), Math.abs(p2.y-p1.y));
    ctx.fill(); ctx.stroke();
  }

  // Floor placement preview
  if (state.tool === 'floor3d' && state.rectStart && state.hoverPt) {
    const p1 = gridToScreen(state.rectStart.x, state.rectStart.y);
    const p2 = gridToScreen(state.hoverPt.x,   state.hoverPt.y);
    const col = document.getElementById('floor3d-color').value;
    ctx.fillStyle   = col + '44';
    ctx.strokeStyle = col + '88';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.rect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.abs(p2.x-p1.x), Math.abs(p2.y-p1.y));
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Gardens
  ctx.fillStyle   = 'rgba(110,170,80,0.30)';
  ctx.strokeStyle = 'rgba(80,140,60,0.60)';
  ctx.lineWidth   = 1.5;
  for (const gd of state.gardens) {
    const p1 = gridToScreen(gd.x1, gd.y1);
    const p2 = gridToScreen(gd.x2, gd.y2);
    ctx.beginPath();
    ctx.rect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.abs(p2.x-p1.x), Math.abs(p2.y-p1.y));
    ctx.fill(); ctx.stroke();
  }

  // Trees / bushes
  for (const t of state.trees) {
    const sp = gridToScreen(t.x, t.y);
    const r  = t.radius * GRID * state.zoom;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = t.type === 'tree' ? 'rgba(60,120,50,0.55)' : 'rgba(90,150,60,0.45)';
    ctx.strokeStyle = t.type === 'tree' ? 'rgba(40,90,30,0.8)'   : 'rgba(60,120,40,0.7)';
    ctx.lineWidth   = 1;
    ctx.fill();
    ctx.stroke();
  }

  // Tree hover preview
  if (state.tool === 'tree' && state.hoverPt) {
    const sp = gridToScreen(state.hoverPt.x, state.hoverPt.y);
    const r  = parseFloat(document.getElementById('tree-radius').value) * GRID * state.zoom;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(80,160,60,0.25)';
    ctx.strokeStyle = 'rgba(60,130,40,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Garden placement preview
  if ((state.tool === 'garden') && state.rectStart && state.hoverPt) {
    const p1 = gridToScreen(state.rectStart.x, state.rectStart.y);
    const p2 = gridToScreen(state.hoverPt.x,   state.hoverPt.y);
    ctx.fillStyle   = 'rgba(110,170,80,0.18)';
    ctx.strokeStyle = 'rgba(80,140,60,0.50)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.rect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.abs(p2.x-p1.x), Math.abs(p2.y-p1.y));
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Furniture
  for (const furn of state.furniture) {
    const sp1 = gridToScreen(furn.x1, furn.y1);
    const sp2 = gridToScreen(furn.x2, furn.y2);
    const fw = Math.abs(sp2.x - sp1.x), fh = Math.abs(sp2.y - sp1.y);
    const scx = (sp1.x + sp2.x) / 2, scy = (sp1.y + sp2.y) / 2;
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate((furn.rotation || 0) * Math.PI / 180);
    ctx.fillStyle   = 'rgba(180,140,90,0.35)';
    ctx.strokeStyle = 'rgba(130,90,50,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.rect(-fw / 2, -fh / 2, fw, fh);
    ctx.fill(); ctx.stroke();
    if (furn.label) {
      ctx.fillStyle    = 'rgba(80,50,20,0.85)';
      ctx.font         = `${Math.max(9, Math.min(13, fw / 5))}px system-ui`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(furn.label, 0, 0);
    }
    ctx.restore();
  }

  // Furniture placement preview
  if (state.tool === 'furniture' && state.rectStart && state.hoverPt) {
    const p1 = gridToScreen(state.rectStart.x, state.rectStart.y);
    const p2 = gridToScreen(state.hoverPt.x,   state.hoverPt.y);
    ctx.fillStyle   = 'rgba(180,140,90,0.20)';
    ctx.strokeStyle = 'rgba(130,90,50,0.50)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.rect(Math.min(p1.x,p2.x), Math.min(p1.y,p2.y), Math.abs(p2.x-p1.x), Math.abs(p2.y-p1.y));
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Walls for active floor (with opening gaps)
  for (let i = 0; i < state.walls.length; i++) {
    const w = state.walls[i];
    if ((w.floor ?? 0) !== state.activeFloor) continue;
    drawWall(w, i === state.hoverWall);
  }

  // Stairs
  for (const st of state.stairs) {
    if ((st.floor ?? 0) !== state.activeFloor) continue;
    const sp     = gridToScreen(st.x, st.y);
    const g      = GRID * state.zoom;
    const wPx    = st.width  * g;
    const lenPx  = st.steps * st.stepLen * g;
    const angle  = (st.rotation || 0) * Math.PI / 180;
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(100,80,60,0.7)';
    ctx.fillStyle   = 'rgba(200,180,150,0.35)';
    ctx.lineWidth   = 1;
    // Outline
    ctx.beginPath(); ctx.rect(0, 0, wPx, lenPx); ctx.fill(); ctx.stroke();
    // Step lines
    for (let s = 1; s < st.steps; s++) {
      const sy = s * st.stepLen * g;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(wPx, sy); ctx.stroke();
    }
    // Arrow showing direction
    ctx.strokeStyle = 'rgba(80,60,40,0.6)';
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.1); ctx.lineTo(wPx / 2, lenPx * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.8); ctx.lineTo(wPx / 2 - 4, lenPx * 0.65); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.8); ctx.lineTo(wPx / 2 + 4, lenPx * 0.65); ctx.stroke();
    ctx.restore();
  }

  // Wall drawing preview
  if (state.tool === 'wall' && state.wallStart && state.hoverPt) {
    const end     = orthoEnd(state.wallStart, state.hoverPt);
    const p1      = gridToScreen(state.wallStart.x, state.wallStart.y);
    const p2      = gridToScreen(end.x, end.y);
    const thick   = Math.max(3, g * 0.3);

    ctx.strokeStyle = 'rgba(74,63,53,0.38)';
    ctx.lineWidth   = thick;
    ctx.lineCap     = 'round';
    ctx.setLineDash([g * 0.45, g * 0.2]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const lenM = Math.hypot(end.x - state.wallStart.x, end.y - state.wallStart.y) * UNIT;
    if (lenM > 0) {
      ctx.fillStyle    = '#8b7355';
      ctx.font         = '11px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${lenM.toFixed(1)} m`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 6);
    }
  }

  // Snap indicator (wall tool)
  if (state.tool === 'wall' && state.hoverPt) {
    const snapPt = state.wallStart ? orthoEnd(state.wallStart, state.hoverPt) : state.hoverPt;
    if (state.wallStart) {
      const sp1 = gridToScreen(state.wallStart.x, state.wallStart.y);
      ctx.fillStyle = '#8b7355';
      ctx.beginPath(); ctx.arc(sp1.x, sp1.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    const sp = gridToScreen(snapPt.x, snapPt.y);
    ctx.fillStyle   = '#8b7355';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Opening placement preview
  drawOpeningPreview();

  // Camera indicator
  drawCameraIndicator();
}

function drawCameraIndicator() {
  // Convert world position to screen: world units → grid units → screen
  const gx = cam.pos.x / UNIT;
  const gy = cam.pos.z / UNIT;
  const sp = gridToScreen(gx, gy);

  const g       = GRID * state.zoom;
  const fovHalf = (Math.PI / 180) * 35; // half of ~70° display cone
  const coneLen = g * 5;                // cone length in screen pixels

  // 2D look direction: world (X,Z) → screen (x,y), forward = (-sin yaw, -cos yaw)
  const tipAngle2d = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));

  // FOV cone
  const a1 = tipAngle2d - fovHalf;
  const a2 = tipAngle2d + fovHalf;
  ctx.beginPath();
  ctx.moveTo(sp.x, sp.y);
  ctx.arc(sp.x, sp.y, coneLen, a1, a2);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(60,120,220,0.10)';
  ctx.strokeStyle = 'rgba(60,120,220,0.35)';
  ctx.lineWidth   = 1;
  ctx.fill();
  ctx.stroke();

  // Direction triangle
  const tipAngle = tipAngle2d;
  const tipLen   = g * 1.2;
  const baseHalf = g * 0.55;
  const perpAngle = tipAngle + Math.PI / 2;
  const tip  = { x: sp.x + Math.cos(tipAngle) * tipLen,  y: sp.y + Math.sin(tipAngle) * tipLen  };
  const bl   = { x: sp.x + Math.cos(perpAngle) * baseHalf,  y: sp.y + Math.sin(perpAngle) * baseHalf  };
  const br   = { x: sp.x - Math.cos(perpAngle) * baseHalf,  y: sp.y - Math.sin(perpAngle) * baseHalf  };
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.fillStyle   = 'rgba(40,100,210,0.9)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.fill();
  ctx.stroke();

  // Camera dot
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, g * 0.35, 0, Math.PI * 2);
  ctx.fillStyle   = '#2864d2';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.fill();
  ctx.stroke();
}

// ── FPS CAMERA ────────────────────────────────────────────
const cam = { yaw: Math.PI / 4, pitch: -0.4, pos: new THREE.Vector3(8, 6, 8) };
const keys = {};
let spaceDown = false;
let fpsMode      = false;
let collisionOn  = false;

const EYE_HEIGHT = 1.65;

function inputFocused() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function updateCamera() {
  camera.position.copy(cam.pos);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = cam.yaw;
  camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, cam.pitch));
}

function updateCameraMovement(dt) {
  const SPEED = 5;    // m/s
  const TURN  = 1.5;  // rad/s
  const fwd   = new THREE.Vector3(-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
  const right = new THREE.Vector3( Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));

  if (fpsMode) {
    // Horizontal movement only in FPS mode
    const fwdFlat = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    if (keys['KeyW'] || keys['ArrowUp'])    cam.pos.addScaledVector(fwdFlat,  SPEED * dt);
    if (keys['KeyS'] || keys['ArrowDown'])  cam.pos.addScaledVector(fwdFlat, -SPEED * dt);
    if (keys['KeyA'] || keys['ArrowLeft'])  cam.pos.addScaledVector(right,   -SPEED * dt);
    if (keys['KeyD'] || keys['ArrowRight']) cam.pos.addScaledVector(right,    SPEED * dt);
    if (keys['KeyQ'])                       cam.yaw += TURN * dt;
    if (keys['KeyE'])                       cam.yaw -= TURN * dt;
    cam.pos.y = EYE_HEIGHT;
  } else {
    if (keys['KeyW']     || keys['ArrowUp'])    cam.pos.addScaledVector(fwd,    SPEED * dt);
    if (keys['KeyS']     || keys['ArrowDown'])  cam.pos.addScaledVector(fwd,   -SPEED * dt);
    if (keys['KeyA']     || keys['ArrowLeft'])  cam.pos.addScaledVector(right, -SPEED * dt);
    if (keys['KeyD']     || keys['ArrowRight']) cam.pos.addScaledVector(right,  SPEED * dt);
    if (keys['KeyX'])                           cam.pos.y += SPEED * dt;
    if (keys['KeyZ'])                           cam.pos.y -= SPEED * dt;
    if (keys['KeyQ'])                           cam.yaw   += TURN  * dt;
    if (keys['KeyE'])                           cam.yaw   -= TURN  * dt;
    cam.pos.y = Math.max(0.5, cam.pos.y);
  }
  if (collisionOn) resolveCollision();
  updateCamera();
  scheduleSave();
}

function setup3DControls() {
  const el = renderer.domElement;
  let rmb = false;
  let spacePanActive = false;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 2) { el.requestPointerLock({ unadjustedMovement: true }); e.preventDefault(); }
    if (e.button === 0 && spaceDown) spacePanActive = true;
  });

  document.addEventListener('pointerlockchange', () => {
    rmb = document.pointerLockElement === el;
  });

  window.addEventListener('mousemove', (e) => {
    if (rmb) {
      cam.yaw   -= e.movementX * 0.003;
      cam.pitch -= e.movementY * 0.003;
      updateCamera();
    }
    if (spacePanActive && (e.buttons & 1)) {
      const r = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
      cam.pos.addScaledVector(r, -e.movementX * 0.02);
      cam.pos.y += e.movementY * 0.02;
      updateCamera();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) document.exitPointerLock();
    if (e.button === 0) spacePanActive = false;
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('click', (e) => {
    if (state.tool !== 'wall') return;
    const gpt = raycastGroundGrid(e.clientX, e.clientY);
    if (!gpt) return;
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = orthoEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        state.walls.push({ id: state.nextWallId++, x1: state.wallStart.x, y1: state.wallStart.y, x2: end.x, y2: end.y, floor: state.activeFloor });
        state.wallStart = { ...end };
        state.dirty3d   = true;
      }
    }
    updateStatus();
    scheduleSave();
  });

  window.addEventListener('keydown', (e) => {
    if (inputFocused()) return;
    keys[e.code] = true;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Escape' && fpsMode) setFpsMode(false);
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space') spaceDown = false;
  });
}

// ── 3D SCENE ──────────────────────────────────────────────
let renderer, scene, camera;

function addBox(cx, cy, cz, bw, bh, bd, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow       = true;
  mesh.receiveShadow    = true;
  mesh.userData.dynamic = true;
  scene.add(mesh);
}

function buildWallMeshes(w, wallMat, yOff, wallH) {
  const dx      = (w.x2 - w.x1) * UNIT;
  const dz      = (w.y2 - w.y1) * UNIT;
  const len     = Math.hypot(dx, dz);
  if (len < 0.001) return;

  const isH     = Math.abs(dz) < 0.001;
  const signX   = isH ? (w.x2 >= w.x1 ? 1 : -1) : 0;
  const signZ   = isH ? 0 : (w.y2 >= w.y1 ? 1 : -1);
  const wallLen = len / UNIT;  // grid units

  const wallOpenings = state.openings
    .filter(op => op.wallId === w.id)
    .sort((a, b) => a.left - b.left);

  if (wallOpenings.length === 0) {
    const cx = (w.x1 + w.x2) / 2 * UNIT;
    const cz = (w.y1 + w.y2) / 2 * UNIT;
    addBox(cx, yOff + wallH / 2, cz, isH ? len + WALL_T : WALL_T, wallH, isH ? WALL_T : len + WALL_T, wallMat);
    return;
  }

  const pieces = [];
  let cursor = 0;

  for (const op of wallOpenings) {
    if (op.left > cursor)
      pieces.push({ fromG: cursor, toG: op.left, yFrom: 0, yTo: wallH });

    if (op.fromFloor > 0)
      pieces.push({ fromG: op.left, toG: op.left + op.width, yFrom: 0, yTo: op.fromFloor * UNIT });

    const topM = (op.fromFloor + op.height) * UNIT;
    if (topM < wallH)
      pieces.push({ fromG: op.left, toG: op.left + op.width, yFrom: topM, yTo: wallH });

    cursor = op.left + op.width;
  }
  if (cursor < wallLen)
    pieces.push({ fromG: cursor, toG: wallLen, yFrom: 0, yTo: wallH });

  for (const piece of pieces) {
    const lenG   = piece.toG - piece.fromG;
    const pieceH = piece.yTo - piece.yFrom;
    if (lenG < 0.001 || pieceH < 0.001) continue;

    const fromG  = piece.fromG === 0      ? piece.fromG - WALL_T / (2 * UNIT) : piece.fromG;
    const toG    = piece.toG   >= wallLen ? piece.toG   + WALL_T / (2 * UNIT) : piece.toG;
    const adjLen = (toG - fromG) * UNIT;
    const midG   = (fromG + toG) / 2;

    const cx = w.x1 * UNIT + signX * midG * UNIT;
    const cz = w.y1 * UNIT + signZ * midG * UNIT;
    const cy = yOff + piece.yFrom + pieceH / 2;

    addBox(cx, cy, cz, isH ? adjLen : WALL_T, pieceH, isH ? WALL_T : adjLen, wallMat);
  }

  const glassMat = new THREE.MeshLambertMaterial({ color: 0xadd8e6, transparent: true, opacity: 0.28 });
  for (const op of wallOpenings) {
    if (op.type !== 'window') continue;
    const opW  = op.width  * UNIT;
    const opH  = op.height * UNIT;
    const midG = op.left + op.width / 2;
    const cx   = w.x1 * UNIT + signX * midG * UNIT;
    const cz   = w.y1 * UNIT + signZ * midG * UNIT;
    const cy   = yOff + op.fromFloor * UNIT + opH / 2;
    addBox(cx, cy, cz, isH ? opW : 0.02, opH, isH ? 0.02 : opW, glassMat);
  }
}

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

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  cam.pos.set(8, 6, 8);
  cam.yaw   =  Math.PI / 4;
  cam.pitch = -0.4;
  updateCamera();

  scene.add(new THREE.AmbientLight(0xfff8f2, 0.55));

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
  sun.position.set(12, 22, 10);
  sun.castShadow             = true;
  sun.shadow.mapSize.width   = 2048;
  sun.shadow.mapSize.height  = 2048;
  sun.shadow.camera.near     = 0.5;
  sun.shadow.camera.far      = 80;
  sun.shadow.camera.left     = -25;
  sun.shadow.camera.right    = 25;
  sun.shadow.camera.top      = 25;
  sun.shadow.camera.bottom   = -25;
  sun.shadow.bias            = -0.001;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
  fill.position.set(-8, 10, -5);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshLambertMaterial({ color: 0xf5efe6 })
  );
  floor.rotation.x    = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(60, 120, 0xddd8d0, 0xe8e4dc);
  grid.position.y = 0.001;
  scene.add(grid);

  resize3D();
  setup3DControls();
}

function rebuild3D() {
  if (!state.dirty3d) return;
  state.dirty3d = false;

  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (scene.children[i].userData.dynamic) scene.remove(scene.children[i]);
  }

  for (const w of state.walls) {
    const floorIdx = w.floor ?? 0;
    const fd       = state.floorDefs[floorIdx] ?? state.floorDefs[0];
    const yOff     = floorYOffset(floorIdx);
    const wallH    = fd.wallHeight;
    const wallMat  = new THREE.MeshLambertMaterial({ color: w.color ? new THREE.Color(w.color) : 0xf5f0e8 });
    buildWallMeshes(w, wallMat, yOff, wallH);
  }

  // Floor slabs between storeys
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d4 });
  for (let i = 1; i < state.floorDefs.length; i++) {
    const y = floorYOffset(i);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(60, FLOOR_SLAB_H, 60), slabMat);
    slab.position.set(0, y - FLOOR_SLAB_H / 2, 0);
    slab.receiveShadow    = true;
    slab.userData.dynamic = true;
    scene.add(slab);
  }

  // Stairs
  const stairMat = new THREE.MeshLambertMaterial({ color: 0xd4c4a8 });
  for (const st of state.stairs) {
    const floorIdx = st.floor ?? 0;
    const yOff     = floorYOffset(floorIdx);
    const fd       = state.floorDefs[floorIdx] ?? state.floorDefs[0];
    const totalH   = fd.wallHeight + FLOOR_SLAB_H;
    const stepH    = totalH / st.steps;
    const stepD    = st.stepLen * UNIT;
    const stepW    = st.width   * UNIT;
    const angle    = (st.rotation || 0) * Math.PI / 180;
    const ox       = st.x * UNIT, oz = st.y * UNIT;
    for (let i = 0; i < st.steps; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH * (i + 1), stepD), stairMat);
      mesh.position.set(0, yOff + stepH * (i + 1) / 2, (i + 0.5) * stepD);
      const pivot = new THREE.Object3D();
      pivot.position.set(ox, 0, oz);
      pivot.rotation.y = -angle;
      pivot.add(mesh);
      pivot.userData.dynamic = true;
      scene.add(pivot);
    }
  }

  // Furniture
  const furnMat = new THREE.MeshLambertMaterial({ color: 0xc8a060 });
  for (const furn of state.furniture) {
    const w   = Math.abs(furn.x2 - furn.x1) * UNIT;
    const d   = Math.abs(furn.y2 - furn.y1) * UNIT;
    const h   = furn.height;
    const cx  = (furn.x1 + furn.x2) / 2 * UNIT;
    const cz  = (furn.y1 + furn.y2) / 2 * UNIT;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), furnMat);
    mesh.position.set(cx, h / 2, cz);
    mesh.rotation.y    = (furn.rotation || 0) * Math.PI / 180;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    scene.add(mesh);
  }

  // Trees / bushes
  for (const t of state.trees) {
    const cx = t.x * UNIT, cz = t.y * UNIT;
    const r  = t.radius * UNIT;
    if (t.type === 'tree') {
      // Trunk
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
      const trunk    = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.10, 1.2, 6), trunkMat);
      trunk.position.set(cx, 0.6, cz);
      trunk.userData.dynamic = true;
      scene.add(trunk);
      // Canopy
      const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3a7a28 });
      const canopy    = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), canopyMat);
      canopy.position.set(cx, 1.2 + r * 0.7, cz);
      canopy.userData.dynamic = true;
      scene.add(canopy);
    } else {
      // Bush – low sphere
      const bushMat = new THREE.MeshLambertMaterial({ color: 0x5a9a3c });
      const bush    = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 5), bushMat);
      bush.scale.y = 0.6;
      bush.position.set(cx, r * 0.6, cz);
      bush.userData.dynamic = true;
      scene.add(bush);
    }
  }

  // Floor surfaces
  for (const fl of state.floors3d) {
    const w  = (fl.x2 - fl.x1) * UNIT;
    const d  = (fl.y2 - fl.y1) * UNIT;
    const cx = (fl.x1 + fl.x2) / 2 * UNIT;
    const cz = (fl.y1 + fl.y2) / 2 * UNIT;
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(fl.color) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(w), Math.abs(d)), mat);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.position.set(cx, 0.002, cz);
    mesh.receiveShadow    = true;
    mesh.userData.dynamic = true;
    scene.add(mesh);
  }

  // Gardens
  const gardenMat = new THREE.MeshLambertMaterial({ color: 0x6aaa44, transparent: true, opacity: 0.7 });
  for (const gd of state.gardens) {
    const w  = (gd.x2 - gd.x1) * UNIT;
    const d  = (gd.y2 - gd.y1) * UNIT;
    const cx = (gd.x1 + gd.x2) / 2 * UNIT;
    const cz = (gd.y1 + gd.y2) / 2 * UNIT;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(w), Math.abs(d)), gardenMat);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.position.set(cx, 0.003, cz);
    mesh.receiveShadow    = true;
    mesh.userData.dynamic = true;
    scene.add(mesh);
  }
}

function raycastGroundGrid(clientX, clientY) {
  const rect    = renderer.domElement.getBoundingClientRect();
  const ndcX    = ((clientX - rect.left)  / rect.width)  * 2 - 1;
  const ndcY    = -((clientY - rect.top) / rect.height) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const ground  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target  = new THREE.Vector3();
  raycaster.ray.intersectPlane(ground, target);
  if (!target) return null;
  return {
    x: Math.round(target.x / UNIT),
    y: Math.round(target.z / UNIT),
  };
}

function resize3D() {
  const c = document.getElementById('view-3d');
  if (!c.clientWidth || !c.clientHeight || !renderer) return;
  renderer.setSize(c.clientWidth, c.clientHeight);
  camera.aspect = c.clientWidth / c.clientHeight;
  camera.updateProjectionMatrix();
}

// ── INPUT ──────────────────────────────────────────────────
function getCanvasXY(e) {
  const r = canvas2d.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

canvas2d.addEventListener('mousemove', (e) => {
  const { mx, my } = getCanvasXY(e);

  if (state.isPanning) {
    state.panX += mx - state.panSX;
    state.panY += my - state.panSY;
    state.panSX = mx; state.panSY = my;
    if (state.tool === 'pan') canvas2d.style.cursor = 'grabbing';
    return;
  }

  state.hoverPt = screenToGrid(mx, my);

  if (state.tool === 'erase') {
    // Opening takes priority over wall in erase mode
    const opId = openingHit(mx, my);
    state.hoverOpening = opId;
    state.hoverWall    = opId ? -1 : wallHit(mx, my);
    canvas2d.style.cursor = (opId || state.hoverWall >= 0) ? 'pointer' : 'default';

  } else if (state.tool === 'door' || state.tool === 'window') {
    const wIdx = wallHit(mx, my);
    if (wIdx >= 0) {
      const left = snapOpeningLeft(wIdx, mx, my);
      if (left !== null) {
        const s = getOpeningSettings();
        state.openingPreview = { wallIdx: wIdx, left, ...s };
      } else {
        state.openingPreview = null;
      }
      canvas2d.style.cursor = 'crosshair';
    } else {
      state.openingPreview  = null;
      state.hoverWall       = -1;
      canvas2d.style.cursor = 'default';
    }
  } else if (state.tool === 'pan') {
    canvas2d.style.cursor = 'grab';
  } else if (state.tool === 'paint') {
    state.hoverWall    = wallHit(mx, my);
    canvas2d.style.cursor = state.hoverWall >= 0 ? 'pointer' : 'default';
  } else {
    state.hoverWall       = -1;
    state.hoverOpening    = null;
    state.openingPreview  = null;
    canvas2d.style.cursor = 'crosshair';
  }
});

canvas2d.addEventListener('mousedown', (e) => {
  const { mx, my } = getCanvasXY(e);

  if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && state.tool === 'pan')) {
    state.isPanning = true; state.panSX = mx; state.panSY = my;
    e.preventDefault(); return;
  }
  if (e.button !== 0) return;

  const gpt = screenToGrid(mx, my);

  if (state.tool === 'wall') {
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = orthoEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        state.walls.push({ id: state.nextWallId++, x1: state.wallStart.x, y1: state.wallStart.y, x2: end.x, y2: end.y, floor: state.activeFloor });
        state.wallStart = { ...end };
        state.dirty3d   = true;
      }
    }

  } else if (state.tool === 'erase') {
    if (state.hoverOpening) {
      state.openings     = state.openings.filter(op => op.id !== state.hoverOpening);
      state.hoverOpening = null;
      state.dirty3d      = true;
    } else if (state.hoverWall >= 0) {
      const wallId = state.walls[state.hoverWall].id;
      state.openings = state.openings.filter(op => op.wallId !== wallId);
      state.walls.splice(state.hoverWall, 1);
      state.hoverWall = -1;
      state.dirty3d   = true;
    } else {
      // Erase garden under cursor
      for (let i = 0; i < state.gardens.length; i++) {
        const gd = state.gardens[i];
        if (gpt.x >= gd.x1 && gpt.x <= gd.x2 && gpt.y >= gd.y1 && gpt.y <= gd.y2) {
          state.gardens.splice(i, 1);
          state.dirty3d = true;
          break;
        }
      }
    }

  } else if (state.tool === 'paint') {
    if (state.hoverWall >= 0) {
      state.walls[state.hoverWall].color = document.getElementById('wall-color').value;
      state.dirty3d = true;
    }

  } else if (state.tool === 'stair') {
    const steps   = parseInt(document.getElementById('stair-steps').value, 10);
    const stepLen = parseFloat(document.getElementById('stair-steplen').value) * 2; // grid units
    const width   = parseFloat(document.getElementById('stair-width').value)   * 2;
    const rotation = parseInt(document.getElementById('stair-rotation').value, 10);
    state.stairs.push({ id: state.nextId++, x: gpt.x, y: gpt.y, steps, stepLen, width, rotation, floor: state.activeFloor });
    state.dirty3d = true;

  } else if (state.tool === 'tree') {
    const type   = document.getElementById('tree-type').value;
    const radius = parseFloat(document.getElementById('tree-radius').value);
    state.trees.push({ id: state.nextId++, x: gpt.x, y: gpt.y, radius, type });
    state.dirty3d = true;

  } else if (state.tool === 'furniture') {
    if (!state.rectStart) {
      state.rectStart = { ...gpt };
    } else {
      const s = state.rectStart, e = gpt;
      if (s.x !== e.x || s.y !== e.y) {
        const height   = parseFloat(document.getElementById('furn-height').value);
        const label    = document.getElementById('furn-label').value.trim();
        const rotation = parseInt(document.getElementById('furn-rotation').value, 10);
        state.furniture.push({ id: state.nextId++, x1: Math.min(s.x,e.x), y1: Math.min(s.y,e.y), x2: Math.max(s.x,e.x), y2: Math.max(s.y,e.y), height, label, rotation });
        state.dirty3d = true;
      }
      state.rectStart = null;
    }

  } else if (state.tool === 'floor3d') {
    if (!state.rectStart) {
      state.rectStart = { ...gpt };
    } else {
      const s = state.rectStart, e = gpt;
      if (s.x !== e.x || s.y !== e.y) {
        const color = document.getElementById('floor3d-color').value;
        state.floors3d.push({ id: state.nextId++, x1: Math.min(s.x,e.x), y1: Math.min(s.y,e.y), x2: Math.max(s.x,e.x), y2: Math.max(s.y,e.y), color });
        state.dirty3d = true;
      }
      state.rectStart = null;
    }

  } else if (state.tool === 'garden') {
    if (!state.rectStart) {
      state.rectStart = { ...gpt };
    } else {
      const s = state.rectStart, e = gpt;
      if (s.x !== e.x || s.y !== e.y) {
        state.gardens.push({ id: state.nextId++, x1: Math.min(s.x,e.x), y1: Math.min(s.y,e.y), x2: Math.max(s.x,e.x), y2: Math.max(s.y,e.y) });
        state.dirty3d = true;
      }
      state.rectStart = null;
    }

  } else if (state.tool === 'door' || state.tool === 'window') {
    if (state.openingPreview) {
      const prev = state.openingPreview;
      state.openings.push({
        id:        state.nextId++,
        wallId:    state.walls[prev.wallIdx].id,
        left:      prev.left,
        width:     prev.width,
        height:    prev.height,
        fromFloor: prev.fromFloor,
        type:      prev.type,
      });
      state.dirty3d = true;
    }
  }

  updateStatus();
  scheduleSave();
});

canvas2d.addEventListener('mouseup',   (e) => { if (e.button === 1 || state.isPanning) state.isPanning = false; });
canvas2d.addEventListener('mouseleave', ()  => { state.hoverPt = null; state.isPanning = false; state.openingPreview = null; });
canvas2d.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.tool === 'wall')   { state.wallStart = null; updateStatus(); }
  if (state.rectStart !== null) { state.rectStart = null; }
});
canvas2d.addEventListener('dblclick', () => {
  if (state.tool === 'wall') { state.wallStart = null; updateStatus(); }
});
canvas2d.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { mx, my } = getCanvasXY(e);
  const oldZoom = state.zoom;
  state.zoom    = Math.max(0.25, Math.min(5, state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  state.panX    = mx - (mx - state.panX) * (state.zoom / oldZoom);
  state.panY    = my - (my - state.panY) * (state.zoom / oldZoom);
}, { passive: false });

window.addEventListener('mouseup', () => { state.isPanning = false; });

// ── UI ─────────────────────────────────────────────────────
const openingSettingsEl = document.getElementById('opening-settings');
const doorSettingsEl    = document.getElementById('door-settings');
const windowSettingsEl  = document.getElementById('window-settings');

document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    state.tool      = tool;
    state.wallStart = null;
    state.rectStart = null;
    state.openingPreview = null;

    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show/hide opening settings panel
    if (tool === 'door') {
      openingSettingsEl.classList.remove('hidden');
      doorSettingsEl.classList.remove('hidden');
      windowSettingsEl.classList.add('hidden');
    } else if (tool === 'window') {
      openingSettingsEl.classList.remove('hidden');
      doorSettingsEl.classList.add('hidden');
      windowSettingsEl.classList.remove('hidden');
    } else {
      openingSettingsEl.classList.add('hidden');
    }
    document.getElementById('paint-settings').classList.toggle('hidden', tool !== 'paint');
    document.getElementById('tree-settings').classList.toggle('hidden', tool !== 'tree');
    document.getElementById('floor3d-settings').classList.toggle('hidden', tool !== 'floor3d');
    document.getElementById('furniture-settings').classList.toggle('hidden', tool !== 'furniture');
    document.getElementById('stair-settings').classList.toggle('hidden', tool !== 'stair');

    const cursors = { pan: 'grab', wall: 'crosshair', erase: 'default', door: 'default', window: 'default', paint: 'default', garden: 'crosshair', tree: 'crosshair', floor3d: 'crosshair', furniture: 'crosshair', stair: 'crosshair' };
    canvas2d.style.cursor = cursors[tool] ?? 'default';

    updateStatus();
  });
});

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('canvas-wrap').style.display = state.view !== '3d' ? 'block' : 'none';
    document.getElementById('view-3d').style.display     = state.view !== '2d' ? 'block' : 'none';
    setTimeout(() => { resize3D(); resizeCanvas(); }, 50);
  });
});

function resolveCollision() {
  const R = WALL_T / 2 + 0.15; // camera radius
  const px = cam.pos.x, pz = cam.pos.z;
  for (const w of state.walls) {
    const ax = w.x1 * UNIT, az = w.y1 * UNIT;
    const bx = w.x2 * UNIT, bz = w.y2 * UNIT;
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
    const nx = ax + t * dx - px;
    const nz = az + t * dz - pz;
    const dist = Math.hypot(nx, nz);
    if (dist < R && dist > 0.001) {
      cam.pos.x -= nx / dist * (R - dist);
      cam.pos.z -= nz / dist * (R - dist);
    }
  }
}

// Fullscreen: pointer lock inside fullscreen avoids browser popup on most browsers (issue #12)
document.getElementById('btn-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    document.getElementById('btn-fullscreen').classList.add('active');
  } else {
    document.exitFullscreen();
    document.getElementById('btn-fullscreen').classList.remove('active');
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement)
    document.getElementById('btn-fullscreen').classList.remove('active');
});

document.getElementById('btn-collision').addEventListener('click', () => {
  collisionOn = !collisionOn;
  document.getElementById('btn-collision').classList.toggle('active', collisionOn);
});

function setFpsMode(on) {
  fpsMode = on;
  if (on) cam.pos.y = EYE_HEIGHT;
  document.getElementById('btn-fps-mode').classList.toggle('active', on);
}

document.getElementById('btn-fps-mode').addEventListener('click', () => setFpsMode(!fpsMode));

function renderFloorSelector() {
  const el = document.getElementById('floor-selector');
  el.innerHTML = '';
  state.floorDefs.forEach((fd, i) => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (i === state.activeFloor ? ' active' : '');
    btn.style.fontSize = '11px';
    btn.textContent   = fd.name;
    btn.title         = `Vägghöjd: ${fd.wallHeight} m`;
    btn.addEventListener('click', () => {
      state.activeFloor = i;
      state.wallStart   = null;
      renderFloorSelector();
    });
    el.appendChild(btn);
  });
}

document.getElementById('btn-add-floor').addEventListener('click', () => {
  const n  = state.floorDefs.length + 1;
  state.floorDefs.push({ id: n - 1, name: n === 2 ? '1V' : `${n - 1}V`, wallHeight: 2.6 });
  state.activeFloor = state.floorDefs.length - 1;
  state.dirty3d     = true;
  renderFloorSelector();
  scheduleSave();
});

document.getElementById('btn-del-floor').addEventListener('click', () => {
  if (state.floorDefs.length <= 1) return;
  state.walls    = state.walls.filter(w => (w.floor ?? 0) !== state.activeFloor);
  state.openings = state.openings.filter(op => {
    const w = state.walls.find(w => w.id === op.wallId);
    return !!w;
  });
  state.stairs = state.stairs.filter(s => (s.floor ?? 0) !== state.activeFloor);
  state.floorDefs.splice(state.activeFloor, 1);
  state.activeFloor = Math.max(0, state.activeFloor - 1);
  state.dirty3d     = true;
  renderFloorSelector();
  scheduleSave();
});

document.getElementById('btn-center-camera').addEventListener('click', () => {
  const wrap = document.getElementById('canvas-wrap');
  const gx = cam.pos.x / UNIT;
  const gy = cam.pos.z / UNIT;
  const g  = GRID * state.zoom;
  state.panX = wrap.clientWidth  / 2 - gx * g;
  state.panY = wrap.clientHeight / 2 - gy * g;
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Rensa allt?')) return;
  state.walls      = [];
  state.openings   = [];
  state.gardens    = [];
  state.trees      = [];
  state.floors3d   = [];
  state.furniture  = [];
  state.stairs      = [];
  state.floorDefs   = [{ id: 0, name: 'BV', wallHeight: 2.6 }];
  state.activeFloor = 0;
  state.wallStart  = null;
  state.rectStart  = null;
  state.dirty3d    = true;
  renderFloorSelector();
  updateStatus();
  scheduleSave();
});

function updateStatus() {
  const msgs = {
    pan:    'Klicka och dra för att panorera  ·  Scroll = zooma',
    wall:   state.wallStart
              ? 'Klicka för att placera slutpunkt  ·  Högerklicka = avbryt'
              : 'Klicka för att starta en vägg',
    erase:  'Klicka på en vägg eller öppning för att ta bort den',
    door:   'Håll över en vägg och klicka för att placera dörröppning',
    window: 'Håll över en vägg och klicka för att placera fönster',
    paint:  'Klicka på en vägg för att applicera vald färg',
    garden: state.rectStart ? 'Klicka för att placera hörn 2  ·  Högerklicka = avbryt' : 'Klicka för att placera hörn 1',
    tree:    'Klicka för att placera träd eller buske',
    floor3d:   state.rectStart ? 'Klicka för att placera hörn 2  ·  Högerklicka = avbryt' : 'Klicka för att placera hörn 1',
    furniture: state.rectStart ? 'Klicka för att placera hörn 2  ·  Högerklicka = avbryt' : 'Klicka för att placera hörn 1',
    stair:     'Klicka för att placera trappa',
  };
  document.getElementById('status').textContent = msgs[state.tool] ?? '';
}

// ── CANVAS RESIZE ──────────────────────────────────────────
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  const first = canvas2d.width === 0;
  canvas2d.width  = w;
  canvas2d.height = h;
  if (first) { state.panX = w / 2 - 10 * GRID; state.panY = h / 2 - 8 * GRID; }
}

// ── LOCALSTORAGE ───────────────────────────────────────────
const STORAGE_KEY = 'minplan_v1';
let   _saveTimer  = null;

function saveSession() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      walls:       state.walls,
      openings:    state.openings,
      gardens:     state.gardens,
      trees:       state.trees,
      floors3d:    state.floors3d,
      furniture:   state.furniture,
      stairs:      state.stairs,
      floorDefs:   state.floorDefs,
      activeFloor: state.activeFloor,
      nextWallId:  state.nextWallId,
      nextId:      state.nextId,
      cam:  { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z, yaw: cam.yaw, pitch: cam.pitch },
      view: state.view,
    }));
  } catch (_) {}
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveSession, 600);
}

function loadSession() {
  let data;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) {}
  if (!data) return;
  if (data.walls)       state.walls       = data.walls;
  if (data.openings)    state.openings    = data.openings;
  if (data.gardens)     state.gardens     = data.gardens;
  if (data.trees)       state.trees       = data.trees;
  if (data.floors3d)    state.floors3d    = data.floors3d;
  if (data.furniture)   state.furniture   = data.furniture;
  if (data.stairs)      state.stairs      = data.stairs;
  if (data.floorDefs)   state.floorDefs   = data.floorDefs;
  if (data.activeFloor !== undefined) state.activeFloor = data.activeFloor;
  if (data.nextWallId)  state.nextWallId  = data.nextWallId;
  if (data.nextId)      state.nextId      = data.nextId;
  if (data.cam) {
    cam.pos.set(data.cam.x, data.cam.y, data.cam.z);
    cam.yaw   = data.cam.yaw;
    cam.pitch = data.cam.pitch;
  }
  if (data.view) {
    state.view = data.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    document.getElementById('canvas-wrap').style.display = state.view !== '3d' ? 'block' : 'none';
    document.getElementById('view-3d').style.display     = state.view !== '2d' ? 'block' : 'none';
  }
  state.dirty3d = true;
}

// ── MAIN LOOP ──────────────────────────────────────────────
let lastW3d = 0, lastH3d = 0, lastTime = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const wrap = document.getElementById('canvas-wrap');
  if (wrap.clientWidth !== canvas2d.width || wrap.clientHeight !== canvas2d.height) resizeCanvas();

  const v3d = document.getElementById('view-3d');
  if (v3d.clientWidth !== lastW3d || v3d.clientHeight !== lastH3d) {
    lastW3d = v3d.clientWidth; lastH3d = v3d.clientHeight;
    resize3D();
  }

  if (state.view !== '3d') draw2D();
  if (renderer && state.view !== '2d') {
    rebuild3D();
    if (!inputFocused()) updateCameraMovement(dt);
    renderer.render(scene, camera);
  }
}

// ── INIT ───────────────────────────────────────────────────
function init() {
  resizeCanvas();
  loadSession();
  init3D();
  updateCameraMovement(0); // apply restored cam
  updateStatus();
  renderFloorSelector();

  // Always show one decimal in dimension inputs (e.g. "1.0" not "1")
  document.querySelectorAll('.setting-row input[type="number"]').forEach(input => {
    input.value = parseFloat(input.value).toFixed(1);
    input.addEventListener('change', () => {
      input.value = parseFloat(input.value).toFixed(1);
    });
  });

  loop();
}

init();
