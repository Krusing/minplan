import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';

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
  walls:          [],    // [{id, x1, y1, x2, y2, colorFront, colorBack, floor}]
  openings:       [],    // [{id, wallId, left, width, height, fromFloor, type}]
  gardens:        [],    // [{id, rings:[[{x,y}],...]}]              rings[0]=outer, rings[1+]=inner holes
  trees:          [],    // [{id, x, y, radius, type}] type: 'tree'|'bush'
  floors3d:       [],    // [{id, rings:[[{x,y}],...], color, floor}]  rings[0]=outer, rings[1+]=inner holes
  fillFloors:     [],    // [{id, cells:[{x,y}], color, floor}] (legacy – rendered but not created)
  furniture:      [],    // [{id, x1, y1, x2, y2, height, label, rotation}]
  foundations:    [],    // [{id, points:[{x,y}], height}]
  stairs:         [],    // [{id, x, y, rotation, steps, stepLen, width, floor}]
  floorDefs:      [{id: 0, name: 'BV', wallHeight: 2.6}], // floor definitions
  activeFloor:    0,     // index into floorDefs
  nextWallId:     1,
  nextId:         1,

  tool:           'pan',  // pan | wall | erase | door | window | paint | garden | tree | floor3d | furniture
  rectStart:      null,  // {x,y} start for rectangle tools (furniture/foundation)
  polyPts:        [],    // [{x,y}] polygon in progress (wall/erase/floor3d/garden/foundation)
  wallStart:      null,   // {x,y} or null (wall draw tool)
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

// ── COLOR PALETTE ─────────────────────────────────────────
const DEFAULT_WALL_PALETTE  = ['#f5f0e8','#ede0cc','#d4c4b0','#c8b090','#a89070','#e8e4dc','#d0cbc2','#b8b2aa','#a09890','#908880','#7a7068','#605850'];
const DEFAULT_FLOOR_PALETTE = ['#c8a46e','#b8945e','#a8844e','#d4b47a','#e0c890','#8b6840','#7a5830','#6a4820','#dfc08a','#c4a060','#a88040','#906030'];

let wallPalette   = [...DEFAULT_WALL_PALETTE];
let floorPalette  = [...DEFAULT_FLOOR_PALETTE];
let wallRecent    = [];
let floorRecent   = [];
let wallRemoveMode  = false;
let floorRemoveMode = false;

function addToRecent(color, arr, max = 8) {
  const i = arr.indexOf(color);
  if (i !== -1) arr.splice(i, 1);
  arr.unshift(color);
  if (arr.length > max) arr.pop();
}

function renderColorUI(uiEl, colorInputId, palette, recent, removeMode, onSelect, onRemoveToggle, onPaletteChange) {
  uiEl.innerHTML = '';
  uiEl.className = 'color-ui-wrap';
  const currentColor = document.getElementById(colorInputId)?.value ?? '#ffffff';

  // Palette grid (6 per row)
  const palGrid = document.createElement('div');
  palGrid.className = 'color-row';
  palette.forEach((col, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (col === currentColor && !removeMode ? ' sel' : '');
    sw.style.background = col;
    sw.title = col + '\nHögerklicka = byt färg i paletten';
    sw.onclick = () => onSelect(col);
    sw.addEventListener('contextmenu', e => {
      e.preventDefault();
      const inp = document.createElement('input');
      inp.type = 'color'; inp.value = col;
      inp.style.cssText = 'position:fixed;left:-999px;opacity:0;width:0;height:0;';
      document.body.appendChild(inp);
      inp.onchange = () => { palette[i] = inp.value; onPaletteChange(); inp.remove(); };
      inp.onblur  = () => inp.remove();
      inp.click();
    });
    palGrid.appendChild(sw);
  });
  uiEl.appendChild(palGrid);

  // Recently used row
  if (recent.length > 0) {
    const lbl = document.createElement('div');
    lbl.className = 'color-section-label';
    lbl.textContent = 'Senast använda';
    uiEl.appendChild(lbl);
    const recRow = document.createElement('div');
    recRow.className = 'color-row';
    recent.forEach(col => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (col === currentColor && !removeMode ? ' sel' : '');
      sw.style.background = col;
      sw.title = col;
      sw.onclick = () => onSelect(col);
      recRow.appendChild(sw);
    });
    uiEl.appendChild(recRow);
  }

  // Bottom row: custom picker + remove button
  // NOTE: we create a fresh <input type="color"> each render instead of moving the
  // hidden original, because uiEl.innerHTML='' would delete the original element
  // from the DOM on subsequent refreshes, causing getElementById to return null.
  const bot = document.createElement('div');
  bot.className = 'color-ui-bottom';
  const customLbl = document.createElement('span');
  customLbl.textContent = 'Anpassad';
  customLbl.style.cssText = 'font-size:10px;color:var(--text-muted);flex:1;';
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = currentColor;
  colorPicker.style.cssText = 'width:26px;height:20px;padding:0;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:none;flex-shrink:0;';
  colorPicker.oninput = (ev) => {
    const orig = document.getElementById(colorInputId);
    if (orig) orig.value = ev.target.value;
    onSelect(ev.target.value);
  };
  const removeBtn = document.createElement('button');
  removeBtn.className = 'action-btn color-remove-btn' + (removeMode ? ' remove-active' : '');
  removeBtn.textContent = '✕ Ta bort';
  removeBtn.onclick = onRemoveToggle;
  bot.appendChild(customLbl);
  bot.appendChild(colorPicker);
  bot.appendChild(removeBtn);
  uiEl.appendChild(bot);
}

function refreshWallPalette() {
  const el = document.getElementById('wall-palette-ui');
  if (!el) return;
  renderColorUI(el, 'wall-color', wallPalette, wallRecent, wallRemoveMode,
    (col) => {
      wallRemoveMode = false;
      document.getElementById('wall-color').value = col;
      refreshWallPalette();
    },
    () => { wallRemoveMode = !wallRemoveMode; refreshWallPalette(); },
    () => { refreshWallPalette(); saveSession(); }
  );
}

function refreshFloorPalette() {
  const el = document.getElementById('floor-palette-ui');
  if (!el) return;
  renderColorUI(el, 'floor3d-color', floorPalette, floorRecent, floorRemoveMode,
    (col) => {
      floorRemoveMode = false;
      document.getElementById('floor3d-color').value = col;
      refreshFloorPalette();
    },
    () => { floorRemoveMode = !floorRemoveMode; refreshFloorPalette(); },
    () => { refreshFloorPalette(); saveSession(); }
  );
}

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

// Try to merge new wall segment with a collinear neighbour on the same floor.
// Returns true if merged, false if a new wall was pushed instead.
function addWall(x1, y1, x2, y2, floor, color) {
  const dx = x2 - x1, dy = y2 - y1;
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) continue;
    const wx = w.x2 - w.x1, wy = w.y2 - w.y1;
    // Cross product must be 0 (collinear direction)
    if (Math.abs(dx * wy - dy * wx) > 0.001) continue;
    // Check if endpoints touch
    if (w.x2 === x1 && w.y2 === y1) { w.x2 = x2; w.y2 = y2; return; }
    if (w.x1 === x2 && w.y1 === y2) { w.x1 = x1; w.y1 = y1; return; }
    if (w.x1 === x1 && w.y1 === y1) { w.x1 = x2; w.y1 = y2; return; }
    if (w.x2 === x2 && w.y2 === y2) { w.x2 = x1; w.y2 = y1; return; }
  }
  state.walls.push({ id: state.nextWallId++, x1, y1, x2, y2, floor, color });
}

// ── ERASE HELPERS ─────────────────────────────────────────
// Erase the collinear-overlapping portion of all walls on the active floor.
function eraseWallSegment(ex1, ey1, ex2, ey2, floor) {
  const newWalls = [];
  const removedIds = new Set();
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) { newWalls.push(w); continue; }
    const dWx = w.x2 - w.x1, dWy = w.y2 - w.y1;
    const wLenSq = dWx * dWx + dWy * dWy;
    if (wLenSq < 0.0001) continue;
    // Collinearity: eraser endpoints must lie on wall's line
    if (Math.abs(cross2d(dWx, dWy, ex1 - w.x1, ey1 - w.y1)) > 0.01 ||
        Math.abs(cross2d(dWx, dWy, ex2 - w.x1, ey2 - w.y1)) > 0.01) {
      newWalls.push(w); continue;
    }
    // Parametric projection of eraser onto wall [0,1]
    const te1 = ((ex1 - w.x1) * dWx + (ey1 - w.y1) * dWy) / wLenSq;
    const te2 = ((ex2 - w.x1) * dWx + (ey2 - w.y1) * dWy) / wLenSq;
    const eMin = Math.min(te1, te2), eMax = Math.max(te1, te2);
    if (eMax <= 0.001 || eMin >= 0.999) { newWalls.push(w); continue; } // no overlap
    removedIds.add(w.id);
    const keep = (tA, tB) => {
      tA = Math.max(0, tA); tB = Math.min(1, tB);
      if (tB - tA < 0.001) return;
      newWalls.push({ ...w, id: state.nextWallId++,
        x1: w.x1 + tA * dWx, y1: w.y1 + tA * dWy,
        x2: w.x1 + tB * dWx, y2: w.y1 + tB * dWy });
    };
    keep(0, eMin);
    keep(eMax, 1);
  }
  state.openings = state.openings.filter(op => !removedIds.has(op.wallId));
  state.walls = newWalls;
}

// Convert our rings format to polygon-clipping Polygon format
function toClipPoly(rings) {
  return rings.map(r => r.map(p => [p.x, p.y]));
}
// Convert polygon-clipping Polygon back to our rings format
function fromClipPoly(poly) {
  return poly.map(ring => ring.map(p => ({ x: p[0], y: p[1] })));
}

// Try to merge touching/overlapping items in a collection using polygon union.
// matchFn(a, b) returns true if two items are candidates for merging.
function tryMergeCollection(items, matchFn) {
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!items[i].rings?.[0] || !items[j].rings?.[0]) continue;
        if (!matchFn(items[i], items[j])) continue;
        const result = polygonClipping.union(toClipPoly(items[i].rings), toClipPoly(items[j].rings));
        if (result.length === 1) {
          items[i] = { ...items[i], rings: fromClipPoly(result[0]) };
          items.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return items;
}

// Subtract clipPts polygon from a collection of ring-based items.
// floorLevel: if set, only process items on that floor level; if null, process all.
function subtractPolyFromCollection(items, clipPts, floorLevel) {
  const clip = [clipPts.map(p => [p.x, p.y])];
  const out = [];
  for (const item of items) {
    if (!item.rings?.[0]) { out.push(item); continue; }
    if (floorLevel !== null && floorLevel !== undefined && (item.floor ?? 0) !== floorLevel) {
      out.push(item); continue;
    }
    const outer = item.rings[0];
    const overlaps = clipPts.some(p => pointInPoly(p.x, p.y, outer)) ||
                     outer.some(p => pointInPoly(p.x, p.y, clipPts));
    if (!overlaps) { out.push(item); continue; }
    const result = polygonClipping.difference(toClipPoly(item.rings), clip);
    let first = true;
    for (const poly of result) {
      out.push({ ...item, id: first ? item.id : state.nextId++, rings: fromClipPoly(poly) });
      first = false;
    }
    // result empty → fully covered, remove
  }
  return out;
}

// Subtract erase polygon from all overlapping floors/gardens on the given floor level.
function eraseAreaPolygon(erasePts, activeFloor) {
  // Surfaces
  state.floors3d = subtractPolyFromCollection(state.floors3d, erasePts, activeFloor);
  state.gardens  = subtractPolyFromCollection(state.gardens,  erasePts, null);

  // Walls: clip each wall to the part(s) lying OUTSIDE the erase polygon
  const newWalls = [];
  const removedWallIds = new Set();
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== activeFloor) { newWalls.push(w); continue; }
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) continue;
    // Collect all t values where wall crosses polygon edges
    const ts = [0, 1];
    const n = erasePts.length;
    for (let i = 0; i < n; i++) {
      const p = erasePts[i], q = erasePts[(i + 1) % n];
      const ex = q.x - p.x, ey = q.y - p.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 0.0001) continue;
      const t = ((p.x - w.x1) * ey - (p.y - w.y1) * ex) / denom;
      const u = ((p.x - w.x1) * dy - (p.y - w.y1) * dx) / denom;
      if (t > 0.0001 && t < 0.9999 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    let kept = false;
    for (let i = 0; i < ts.length - 1; i++) {
      const tA = ts[i], tB = ts[i + 1];
      if (tB - tA < 0.0001) continue;
      const mx = w.x1 + (tA + tB) / 2 * dx, my = w.y1 + (tA + tB) / 2 * dy;
      if (!pointInPoly(mx, my, erasePts)) {
        newWalls.push({ ...w, id: kept ? state.nextWallId++ : w.id,
          x1: w.x1 + tA * dx, y1: w.y1 + tA * dy,
          x2: w.x1 + tB * dx, y2: w.y1 + tB * dy });
        kept = true;
      }
    }
    if (!kept) removedWallIds.add(w.id);
  }
  state.walls = newWalls;

  // Openings whose original wall was fully removed
  const keptWallIds = new Set(newWalls.map(w => w.id));
  state.openings = state.openings.filter(op => !removedWallIds.has(op.wallId) && keptWallIds.has(op.wallId));

  // Point objects inside polygon
  state.trees     = state.trees.filter(t  => !pointInPoly(t.x, t.y, erasePts));
  state.furniture = state.furniture.filter(f => !pointInPoly((f.x1+f.x2)/2, (f.y1+f.y2)/2, erasePts));
  state.stairs    = state.stairs.filter(st => (st.floor ?? 0) !== activeFloor || !pointInPoly(st.x, st.y, erasePts));
}

// ── FLOOD FILL ─────────────────────────────────────────────
function cross2d(ax, ay, bx, by) { return ax * by - ay * bx; }

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross2d(dx-cx, dy-cy, ax-cx, ay-cy);
  const d2 = cross2d(dx-cx, dy-cy, bx-cx, by-cy);
  const d3 = cross2d(bx-ax, by-ay, cx-ax, cy-ay);
  const d4 = cross2d(bx-ax, by-ay, dx-ax, dy-ay);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True if two collinear segments share interior points (wall lying along cell edge).
function segsCollinearOverlap(ax, ay, bx, by, cx, cy, dx, dy) {
  const ex = bx - ax, ey = by - ay;
  if (Math.abs(cross2d(ex, ey, cx - ax, cy - ay)) > 0.001) return false;
  if (Math.abs(cross2d(ex, ey, dx - ax, dy - ay)) > 0.001) return false;
  const lenSq = ex * ex + ey * ey;
  if (lenSq < 0.001) return false;
  const t1 = ((cx - ax) * ex + (cy - ay) * ey) / lenSq;
  const t2 = ((dx - ax) * ex + (dy - ay) * ey) / lenSq;
  const tMin = Math.min(t1, t2), tMax = Math.max(t1, t2);
  return tMax > 0.001 && tMin < 0.999;
}

// Is the edge between grid cell (cx,cy) and neighbour (nx,ny) blocked by a wall?
function edgeBlocked(cx, cy, nx, ny, floor) {
  // Boundary edge endpoints
  let ex1, ey1, ex2, ey2;
  if (nx === cx + 1) { ex1 = cx+1; ey1 = cy;   ex2 = cx+1; ey2 = cy+1; }
  else if (nx === cx - 1) { ex1 = cx; ey1 = cy;   ex2 = cx;   ey2 = cy+1; }
  else if (ny === cy + 1) { ex1 = cx; ey1 = cy+1; ex2 = cx+1; ey2 = cy+1; }
  else                    { ex1 = cx; ey1 = cy;   ex2 = cx+1; ey2 = cy;   }
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) continue;
    if (segsIntersect(w.x1, w.y1, w.x2, w.y2, ex1, ey1, ex2, ey2)) return true;
    if (segsCollinearOverlap(w.x1, w.y1, w.x2, w.y2, ex1, ey1, ex2, ey2)) return true;
  }
  return false;
}

function floodFillCells(startX, startY, floor) {
  // BFS from the cell that contains (startX, startY)
  const cx0 = Math.floor(startX), cy0 = Math.floor(startY);
  // Bounds: walls bbox + margin
  let minX = cx0 - 1, maxX = cx0 + 1, minY = cy0 - 1, maxY = cy0 + 1;
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) continue;
    minX = Math.min(minX, w.x1, w.x2) - 1;
    maxX = Math.max(maxX, w.x1, w.x2) + 1;
    minY = Math.min(minY, w.y1, w.y2) - 1;
    maxY = Math.max(maxY, w.y1, w.y2) + 1;
  }
  // Safety cap
  if (maxX - minX > 300 || maxY - minY > 300) return null;

  const visited = new Set();
  const key = (x, y) => `${x},${y}`;
  const queue = [[cx0, cy0]];
  visited.add(key(cx0, cy0));
  const cells = [];

  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) return null; // leaked outside
    cells.push({ x: cx, y: cy });
    for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      if (edgeBlocked(cx, cy, nx, ny, floor)) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
  }
  return cells;
}

// Returns Set of "x,y" keys for all cells enclosed by walls on the given floor.
// Used for the darker-grid overlay in 2D.
let _enclosedCache = null, _enclosedFloor = -1, _enclosedWallSig = '';
function getEnclosedCells() {
  const sig = state.walls
    .filter(w => (w.floor ?? 0) === state.activeFloor)
    .map(w => `${w.x1},${w.y1},${w.x2},${w.y2}`).join('|');
  if (_enclosedCache && _enclosedFloor === state.activeFloor && _enclosedWallSig === sig)
    return _enclosedCache;
  _enclosedFloor  = state.activeFloor;
  _enclosedWallSig = sig;
  _enclosedCache  = computeEnclosedCells(state.activeFloor);
  return _enclosedCache;
}

function computeEnclosedCells(floor) {
  const walls = state.walls.filter(w => (w.floor ?? 0) === floor);
  if (walls.length === 0) return new Set();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2);
  }
  minX -= 2; maxX += 2; minY -= 2; maxY += 2;
  if (maxX - minX > 300 || maxY - minY > 300) return new Set();
  const key     = (x, y) => `${x},${y}`;
  const outside = new Set();
  const queue   = [];
  const seed    = (x, y) => { const k = key(x, y); if (!outside.has(k)) { outside.add(k); queue.push([x, y]); } };
  for (let x = minX; x <= maxX; x++) { seed(x, minY); seed(x, maxY); }
  for (let y = minY; y <= maxY; y++) { seed(minX, y); seed(maxX, y); }
  while (queue.length) {
    const [cx, cy] = queue.shift();
    for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const k = key(nx, ny);
      if (outside.has(k) || edgeBlocked(cx, cy, nx, ny, floor)) continue;
      outside.add(k); queue.push([nx, ny]);
    }
  }
  const enclosed = new Set();
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++)
      if (!outside.has(key(x, y))) enclosed.add(key(x, y));
  return enclosed;
}

// Ray-casting point-in-polygon test (grid coordinates).
function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Which side of wall w is point (px, py) on?
// Returns 'front' (left of direction) or 'back' (right of direction)
function wallSide(w, px, py) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
  return cross2d(dx, dy, px - cx, py - cy) >= 0 ? 'front' : 'back';
}

const POLY_SNAP = 1.5; // grid units — snap-to-close distance for polygon tools

// Add one point to state.polyPts. Calls onClose() and resets polyPts when the polygon closes.
function polyAddPoint(gpt, onClose) {
  if (state.polyPts.length === 0) {
    state.polyPts = [{ ...gpt }];
    return;
  }
  const last = state.polyPts[state.polyPts.length - 1];
  // Close check uses raw gpt (not ortho-snapped) so Shift doesn't prevent closing
  if (state.polyPts.length >= 3 && Math.hypot(gpt.x - state.polyPts[0].x, gpt.y - state.polyPts[0].y) < POLY_SNAP) {
    onClose();
    state.polyPts = [];
    state.dirty3d = true;
  } else {
    const end = wallEnd(last, gpt);
    if (end.x !== last.x || end.y !== last.y) {
      state.polyPts.push({ ...end });
    }
  }
}

// Free angle by default; Shift = ortho snap (0°/90°)
function wallEnd(start, cursor) {
  if (!shiftDown) return { ...cursor };
  const dx = Math.abs(cursor.x - start.x);
  const dy = Math.abs(cursor.y - start.y);
  return dx >= dy ? { x: cursor.x, y: start.y } : { x: start.x, y: cursor.y };
}

// Snap endpoint to nearest 45° from start, keeping grid points

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

  ctx.lineCap   = 'round';
  ctx.lineWidth = isHov ? thick + 2 : thick;

  for (const seg of segments) {
    const t1 = seg.from / wallLen, t2 = seg.to / wallLen;
    const sx1 = p1.x + t1 * (p2.x - p1.x), sy1 = p1.y + t1 * (p2.y - p1.y);
    const sx2 = p1.x + t2 * (p2.x - p1.x), sy2 = p1.y + t2 * (p2.y - p1.y);

    // Wall body
    ctx.strokeStyle = isHov ? '#c04040' : '#4a3f35';
    ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();

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

  // Foundations
  // Foundations (polygon)
  for (const fd of state.foundations) {
    if (!fd.points || fd.points.length < 3) continue;
    ctx.beginPath();
    const p0f = gridToScreen(fd.points[0].x, fd.points[0].y);
    ctx.moveTo(p0f.x, p0f.y);
    for (let i = 1; i < fd.points.length; i++) { const p = gridToScreen(fd.points[i].x, fd.points[i].y); ctx.lineTo(p.x, p.y); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(160,140,110,0.40)'; ctx.strokeStyle = 'rgba(110,90,60,0.70)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
  }

  // Foundation polygon in progress
  if (state.tool === 'foundation' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const last = pts[pts.length - 1];
    const end  = wallEnd(last, state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;
    ctx.strokeStyle = 'rgba(110,90,60,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const p0s = gridToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < pts.length; i++) { const p = gridToScreen(pts[i].x, pts[i].y); ctx.lineTo(p.x, p.y); }
    const ep = gridToScreen(drawEnd.x, drawEnd.y); ctx.lineTo(ep.x, ep.y);
    ctx.stroke(); ctx.setLineDash([]);
    if (snapClose) { ctx.beginPath(); ctx.arc(p0s.x, p0s.y, 7, 0, Math.PI*2); ctx.strokeStyle = 'rgba(80,160,60,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const pt of pts) { const sp = gridToScreen(pt.x, pt.y); ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI*2); ctx.fillStyle = 'rgba(110,90,60,0.8)'; ctx.fill(); }
  }

  // Enclosed rooms — slightly darker grid background (issue #38)
  {
    const enclosed = getEnclosedCells();
    if (enclosed.size > 0) {
      ctx.fillStyle = 'rgba(130,112,95,0.10)';
      for (const k of enclosed) {
        const [cx, cy] = k.split(',').map(Number);
        const sp = gridToScreen(cx, cy);
        ctx.fillRect(sp.x, sp.y, g, g);
      }
    }
  }

  // Legacy fill-floors (flood-filled cells from old saves — rendered but no longer created)
  {
    const gPx = GRID * state.zoom;
    for (const ff of state.fillFloors) {
      if ((ff.floor ?? 0) !== state.activeFloor) continue;
      ctx.fillStyle = 'rgba(160,140,110,0.18)';
      for (const c of ff.cells) {
        const sp = gridToScreen(c.x, c.y);
        ctx.fillRect(sp.x, sp.y, gPx, gPx);
      }
    }
  }

  // Floor surfaces (polygon, neutral in 2D — color only in 3D)
  for (const fl of state.floors3d) {
    if (!fl.rings?.[0] || fl.rings[0].length < 3) continue;
    if ((fl.floor ?? 0) !== state.activeFloor) continue;
    ctx.beginPath();
    for (const ring of fl.rings) {
      const p0 = gridToScreen(ring[0].x, ring[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < ring.length; i++) { const p = gridToScreen(ring[i].x, ring[i].y); ctx.lineTo(p.x, p.y); }
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(180,160,130,0.20)';
    ctx.fill('evenodd');
  }

  // Floor polygon in progress
  if (state.tool === 'floor3d' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const last = pts[pts.length - 1];
    const end  = wallEnd(last, state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;

    ctx.strokeStyle = 'rgba(130,100,70,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const p0s = gridToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < pts.length; i++) {
      const p = gridToScreen(pts[i].x, pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const ep = gridToScreen(drawEnd.x, drawEnd.y);
    ctx.lineTo(ep.x, ep.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (snapClose) {
      ctx.beginPath(); ctx.arc(p0s.x, p0s.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(80,160,60,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Vertex dots
    for (const pt of pts) {
      const sp = gridToScreen(pt.x, pt.y);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(130,100,70,0.8)'; ctx.fill();
    }
  }

  // Gardens (polygon, no stroke between adjacent patches)
  for (const gd of state.gardens) {
    if (!gd.rings?.[0] || gd.rings[0].length < 3) continue;
    ctx.beginPath();
    for (const ring of gd.rings) {
      const p0g = gridToScreen(ring[0].x, ring[0].y);
      ctx.moveTo(p0g.x, p0g.y);
      for (let i = 1; i < ring.length; i++) { const p = gridToScreen(ring[i].x, ring[i].y); ctx.lineTo(p.x, p.y); }
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(110,170,80,0.30)';
    ctx.fill('evenodd');
  }

  // Garden polygon in progress
  if (state.tool === 'garden' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const last = pts[pts.length - 1];
    const end  = wallEnd(last, state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;

    ctx.strokeStyle = 'rgba(80,140,60,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const p0s = gridToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < pts.length; i++) {
      const p = gridToScreen(pts[i].x, pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const ep = gridToScreen(drawEnd.x, drawEnd.y);
    ctx.lineTo(ep.x, ep.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (snapClose) {
      ctx.beginPath(); ctx.arc(p0s.x, p0s.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(80,160,60,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const pt of pts) {
      const sp = gridToScreen(pt.x, pt.y);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,140,60,0.8)'; ctx.fill();
    }
  }

  // Trees / bushes
  for (const t of state.trees) {
    const sp = gridToScreen(t.x, t.y);
    const r  = t.radius * GRID * state.zoom;
    ctx.fillStyle   = t.type === 'tree' ? 'rgba(60,120,50,0.55)' : 'rgba(90,150,60,0.45)';
    ctx.strokeStyle = t.type === 'tree' ? 'rgba(40,90,30,0.8)'   : 'rgba(60,120,40,0.7)';
    ctx.lineWidth   = 1;
    if (t.type === 'bush-square') {
      ctx.fillStyle   = 'rgba(90,150,60,0.45)';
      ctx.strokeStyle = 'rgba(60,120,40,0.7)';
      ctx.beginPath();
      ctx.rect(sp.x - r, sp.y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    }
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

  // Erase polygon preview
  if (state.tool === 'erase' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const end = wallEnd(pts[pts.length - 1], state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;
    ctx.strokeStyle = 'rgba(192,64,64,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const ep0 = gridToScreen(pts[0].x, pts[0].y); ctx.moveTo(ep0.x, ep0.y);
    for (let i = 1; i < pts.length; i++) { const p = gridToScreen(pts[i].x, pts[i].y); ctx.lineTo(p.x, p.y); }
    const ep = gridToScreen(drawEnd.x, drawEnd.y); ctx.lineTo(ep.x, ep.y);
    ctx.stroke(); ctx.setLineDash([]);
    if (snapClose) { ctx.beginPath(); ctx.arc(ep0.x, ep0.y, 7, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(192,64,64,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const pt of pts) { const sp = gridToScreen(pt.x, pt.y); ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(192,64,64,0.8)'; ctx.fill(); }
  }

  // Wall drawing preview
  if (state.tool === 'wall' && state.wallStart && state.hoverPt) {
    const end     = wallEnd(state.wallStart, state.hoverPt);
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
    const snapPt = state.wallStart ? wallEnd(state.wallStart, state.hoverPt) : state.hoverPt;
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
let shiftDown = false;
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
}

function setup3DControls() {
  const el = renderer.domElement;
  let rmb = false;
  let spacePanActive = false;

  el.addEventListener('mousedown', (e) => {
    el.focus();
    if (e.button === 2) { el.requestPointerLock({ unadjustedMovement: true }); e.preventDefault(); }
    if (e.button === 0 && (spaceDown || state.tool === 'pan')) spacePanActive = true;
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

  const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','KeyZ','KeyX']);

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) { document.exitPointerLock(); saveSession(); }
    if (e.button === 0) { if (spacePanActive) saveSession(); spacePanActive = false; }
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const speed = 0.01;
    const fwd   = new THREE.Vector3(-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    cam.pos.addScaledVector(fwd, -e.deltaY * speed);
    if (!fpsMode) cam.pos.y = Math.max(0.5, cam.pos.y);
    updateCamera();
    saveSession();
  }, { passive: false });

  el.addEventListener('click', (e) => {
    if (state.tool !== 'wall') return;
    const gpt = raycastGroundGrid(e.clientX, e.clientY);
    if (!gpt) return;
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = wallEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        addWall(state.wallStart.x, state.wallStart.y, end.x, end.y, state.activeFloor);
        state.wallStart = { ...end };
        state.dirty3d   = true;
      }
    }
    updateStatus();
    scheduleSave();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = true;
    if (inputFocused()) return;
    keys[e.code] = true;
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Escape' && fpsMode) setFpsMode(false);
    if (e.code === 'Escape') {
      if (state.wallStart)          { state.wallStart = null; updateStatus(); }
      if (state.rectStart !== null) { state.rectStart = null; }
      if (state.polyPts.length > 0) { state.polyPts   = [];   updateStatus(); }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftDown = false;
    keys[e.code] = false;
    if (e.code === 'Space') spaceDown = false;
    if (MOVE_KEYS.has(e.code)) saveSession();
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

  const isDiag  = Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001;
  if (isDiag) {
    const cx    = (w.x1 + w.x2) / 2 * UNIT;
    const cz    = (w.y1 + w.y2) / 2 * UNIT;
    const mesh  = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, wallH, WALL_T), wallMat);
    mesh.position.set(cx, yOff + wallH / 2, cz);
    mesh.rotation.y    = -Math.atan2(dz, dx);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    scene.add(mesh);
    return;
  }

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

  // Two-sided color planes
  const wallDirX = (w.x2 - w.x1) * UNIT, wallDirZ = (w.y2 - w.y1) * UNIT;
  const wallLen3  = Math.hypot(wallDirX, wallDirZ);
  const angle3    = Math.atan2(wallDirX, wallDirZ);
  const wCx       = (w.x1 + w.x2) / 2 * UNIT;
  const wCz       = (w.y1 + w.y2) / 2 * UNIT;
  const PAINT_OFF = WALL_T / 2 + 0.01;
  for (const [color, sign] of [[w.colorFront, 1], [w.colorBack, -1]]) {
    if (!color) continue;
    const mat   = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.FrontSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(wallLen3, wallH), mat);
    plane.position.set(
      wCx + sign * Math.cos(angle3) * PAINT_OFF,
      yOff + wallH / 2,
      wCz - sign * Math.sin(angle3) * PAINT_OFF
    );
    plane.rotation.y   = angle3 + (sign > 0 ? 0 : Math.PI);
    plane.userData.dynamic = true;
    scene.add(plane);
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
  renderer.domElement.tabIndex = 0;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf0ebe3, 25, 60);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
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
    } else if (t.type === 'bush-square') {
      // Square bush – low box
      const bushMat = new THREE.MeshLambertMaterial({ color: 0x5a9a3c });
      const side    = r * 2;
      const bush    = new THREE.Mesh(new THREE.BoxGeometry(side, r * 1.2, side), bushMat);
      bush.position.set(cx, r * 0.6, cz);
      bush.userData.dynamic = true;
      scene.add(bush);
    } else {
      // Round bush – low sphere
      const bushMat = new THREE.MeshLambertMaterial({ color: 0x5a9a3c });
      const bush    = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 5), bushMat);
      bush.scale.y = 0.6;
      bush.position.set(cx, r * 0.6, cz);
      bush.userData.dynamic = true;
      scene.add(bush);
    }
  }

  // Foundations (polygon extruded upward from ground)
  const foundMat = new THREE.MeshLambertMaterial({ color: 0xa08c6e, side: THREE.DoubleSide });
  for (const fd of state.foundations) {
    if (!fd.points || fd.points.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(fd.points[0].x * UNIT, -fd.points[0].y * UNIT);
    for (let i = 1; i < fd.points.length; i++) shape.lineTo(fd.points[i].x * UNIT, -fd.points[i].y * UNIT);
    shape.closePath();
    const geom = new THREE.ExtrudeGeometry(shape, { depth: fd.height, bevelEnabled: false });
    const mesh = new THREE.Mesh(geom, foundMat);
    mesh.rotation.x    = -Math.PI / 2;  // same as floors — shape horizontal, extrudes upward (+Y)
    mesh.position.y    = 0;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    scene.add(mesh);
  }

  // Legacy fill-floors (old save data — still rendered)
  for (const ff of state.fillFloors) {
    const yOff = floorYOffset(ff.floor ?? 0);
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(ff.color) });
    for (const c of ff.cells) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(UNIT, UNIT), mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.position.set((c.x + 0.5) * UNIT, yOff + 0.003, (c.y + 0.5) * UNIT);
      mesh.receiveShadow    = true;
      mesh.userData.dynamic = true;
      scene.add(mesh);
    }
  }

  // Floor surfaces (polygon, inner rings as THREE holes if erase punched through)
  for (const fl of state.floors3d) {
    if (!fl.rings?.[0] || fl.rings[0].length < 3) continue;
    const yOff  = floorYOffset(fl.floor ?? 0);
    const outer = fl.rings[0];
    const shape = new THREE.Shape();
    shape.moveTo(outer[0].x * UNIT, -outer[0].y * UNIT);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x * UNIT, -outer[i].y * UNIT);
    shape.closePath();
    for (let r = 1; r < fl.rings.length; r++) {
      const hole = fl.rings[r];
      const path = new THREE.Path();
      path.moveTo(hole[0].x * UNIT, -hole[0].y * UNIT);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x * UNIT, -hole[i].y * UNIT);
      path.closePath();
      shape.holes.push(path);
    }
    const mat  = new THREE.MeshLambertMaterial({ color: new THREE.Color(fl.color ?? '#c8a46e') });
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = yOff + 0.002;
    mesh.receiveShadow = true; mesh.userData.dynamic = true;
    scene.add(mesh);
  }

  // Gardens (polygon, inner rings as THREE holes if erase punched through)
  const gardenMat = new THREE.MeshLambertMaterial({ color: 0x6aaa44, transparent: true, opacity: 0.7 });
  for (const gd of state.gardens) {
    if (!gd.rings?.[0] || gd.rings[0].length < 3) continue;
    const outer = gd.rings[0];
    const shape = new THREE.Shape();
    shape.moveTo(outer[0].x * UNIT, -outer[0].y * UNIT);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x * UNIT, -outer[i].y * UNIT);
    shape.closePath();
    for (let r = 1; r < gd.rings.length; r++) {
      const hole = gd.rings[r];
      const path = new THREE.Path();
      path.moveTo(hole[0].x * UNIT, -hole[0].y * UNIT);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x * UNIT, -hole[i].y * UNIT);
      path.closePath();
      shape.holes.push(path);
    }
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), gardenMat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.003;
    mesh.receiveShadow = true; mesh.userData.dynamic = true;
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
    const dx = mx - state.panSX, dy = my - state.panSY;
    state.panX += dx; state.panY += dy;
    state.panSX = mx; state.panSY = my;
    if (e.buttons & 2) state._rightDragDist = (state._rightDragDist ?? 0) + Math.hypot(dx, dy);
    if (state.tool === 'pan') canvas2d.style.cursor = 'grabbing';
    return;
  }

  state.hoverPt = screenToGrid(mx, my);

  if (state.tool === 'erase') {
    // Only highlight openings (and point objects) — walls are not click-to-delete
    const opId = state.polyPts.length === 0 ? openingHit(mx, my) : null;
    state.hoverOpening = opId;
    state.hoverWall    = -1;
    canvas2d.style.cursor = (opId || (state.polyPts.length === 0 && (
      state.stairs.some(s => Math.hypot(screenToGrid(mx,my).x - s.x, screenToGrid(mx,my).y - s.y) <= 2) ||
      state.trees.some(t  => Math.hypot(screenToGrid(mx,my).x - t.x, screenToGrid(mx,my).y - t.y) <= t.radius + 1) ||
      state.furniture.some(f => { const g = screenToGrid(mx,my); return g.x>=f.x1&&g.x<=f.x2&&g.y>=f.y1&&g.y<=f.y2; })
    ))) ? 'pointer' : 'crosshair';

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
  canvas2d.focus();
  const { mx, my } = getCanvasXY(e);

  if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey) || (e.button === 0 && state.tool === 'pan')) {
    state.isPanning = true; state.panSX = mx; state.panSY = my;
    if (e.button === 2) state._rightDragDist = 0;
    e.preventDefault(); return;
  }
  if (e.button !== 0) return;

  const gpt = screenToGrid(mx, my);

  if (state.tool === 'wall') {
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = wallEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        addWall(state.wallStart.x, state.wallStart.y, end.x, end.y, state.activeFloor);
        state.wallStart = { ...end };
        state.dirty3d   = true;
      }
    }

  } else if (state.tool === 'erase') {
    if (state.polyPts.length === 0) {
      // Click on opening/stair/tree/furniture → delete immediately
      if (state.hoverOpening) {
        state.openings = state.openings.filter(op => op.id !== state.hoverOpening);
        state.hoverOpening = null; state.dirty3d = true;
      } else {
        let removed = false;
        for (let i = 0; i < state.stairs.length && !removed; i++) {
          if (Math.hypot(gpt.x - state.stairs[i].x, gpt.y - state.stairs[i].y) <= 2) {
            state.stairs.splice(i, 1); state.dirty3d = true; removed = true;
          }
        }
        for (let i = 0; i < state.trees.length && !removed; i++) {
          if (Math.hypot(gpt.x - state.trees[i].x, gpt.y - state.trees[i].y) <= state.trees[i].radius + 1) {
            state.trees.splice(i, 1); state.dirty3d = true; removed = true;
          }
        }
        for (let i = 0; i < state.furniture.length && !removed; i++) {
          const f = state.furniture[i];
          if (gpt.x >= f.x1 && gpt.x <= f.x2 && gpt.y >= f.y1 && gpt.y <= f.y2) {
            state.furniture.splice(i, 1); state.dirty3d = true; removed = true;
          }
        }
        if (!removed) {
          // Start draw — every subsequent click adds a point, right-click executes
          state.polyPts = [{ ...gpt }];
          updateStatus();
        }
      }
    } else if (state.polyPts.length >= 3 &&
               Math.hypot(gpt.x - state.polyPts[0].x, gpt.y - state.polyPts[0].y) < POLY_SNAP) {
      // Close polygon near start → area erase immediately
      eraseAreaPolygon([...state.polyPts], state.activeFloor);
      state.polyPts = []; state.dirty3d = true; updateStatus();
    } else {
      // Add next point
      const last = state.polyPts[state.polyPts.length - 1];
      const end  = wallEnd(last, gpt);
      if (end.x !== last.x || end.y !== last.y) {
        state.polyPts.push({ ...end });
        updateStatus();
      }
    }

  } else if (state.tool === 'paint') {
    const color = document.getElementById('wall-color').value;
    if (wallRemoveMode) {
      if (state.hoverWall >= 0) {
        const w    = state.walls[state.hoverWall];
        const side = wallSide(w, gpt.x, gpt.y);
        if (side === 'front') w.colorFront = null;
        else                  w.colorBack  = null;
        state.dirty3d = true;
      }
    } else if (shiftDown) {
      // Flood-fill: color all walls bounding the clicked region on the facing side
      const cells = floodFillCells(gpt.x - 0.5, gpt.y - 0.5, state.activeFloor);
      if (cells) {
        for (const w of state.walls) {
          if ((w.floor ?? 0) !== state.activeFloor) continue;
          const side = wallSide(w, gpt.x, gpt.y);
          if (side === 'front' && !w.colorFront) { w.colorFront = color; state.dirty3d = true; }
          else if (side === 'back' && !w.colorBack) { w.colorBack = color; state.dirty3d = true; }
        }
        addToRecent(color, wallRecent); refreshWallPalette();
      }
    } else if (state.hoverWall >= 0) {
      const w    = state.walls[state.hoverWall];
      const side = wallSide(w, gpt.x, gpt.y);
      if (side === 'front') w.colorFront = color;
      else                  w.colorBack  = color;
      state.dirty3d = true;
      addToRecent(color, wallRecent); refreshWallPalette();
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

  } else if (state.tool === 'foundation') {
    polyAddPoint(gpt, () => {
      const height = parseFloat(document.getElementById('foundation-height').value);
      const newPts = [...state.polyPts];
      state.foundations = state.foundations.filter(fd => {
        if (!fd.points) return true;
        const cx = fd.points.reduce((s, p) => s + p.x, 0) / fd.points.length;
        const cy = fd.points.reduce((s, p) => s + p.y, 0) / fd.points.length;
        return !pointInPoly(cx, cy, newPts);
      });
      state.foundations.push({ id: state.nextId++, points: newPts, height });
    });

  } else if (state.tool === 'floor3d') {
    if (floorRemoveMode) {
      for (let i = 0; i < state.floors3d.length; i++) {
        const fl = state.floors3d[i];
        if (fl.rings?.[0] && pointInPoly(gpt.x, gpt.y, fl.rings[0])) {
          state.floors3d[i].color = null; state.dirty3d = true; break;
        }
      }
    } else {
      polyAddPoint(gpt, () => {
        const color = document.getElementById('floor3d-color').value;
        const newPts  = [...state.polyPts];
        // Subtract new polygon from any different-color floor on the same level
        const out = [];
        for (const fl of state.floors3d) {
          if (!fl.rings?.[0] || (fl.floor ?? 0) !== state.activeFloor || fl.color === color) {
            out.push(fl); continue;
          }
          out.push(...subtractPolyFromCollection([fl], newPts, state.activeFloor));
        }
        state.floors3d = out;
        // If drawing on ground floor, subtract new polygon from gardens too
        if (state.activeFloor === 0) {
          state.gardens = subtractPolyFromCollection(state.gardens, newPts, null);
        }
        state.floors3d.push({ id: state.nextId++, rings: [newPts], color, floor: state.activeFloor });
        // Merge same-color adjacent/overlapping floors
        state.floors3d = tryMergeCollection(state.floors3d,
          (a, b) => (a.floor ?? 0) === (b.floor ?? 0) && a.color === b.color);
        addToRecent(color, floorRecent); refreshFloorPalette();
      });
    }

  } else if (state.tool === 'garden') {
    polyAddPoint(gpt, () => {
      const newPts = [...state.polyPts];
      // Subtract from existing gardens and from floors on ground level
      state.gardens  = subtractPolyFromCollection(state.gardens,  newPts, null);
      state.floors3d = subtractPolyFromCollection(state.floors3d, newPts, 0);
      state.gardens.push({ id: state.nextId++, rings: [newPts] });
      state.gardens = tryMergeCollection(state.gardens, () => true);
    });

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
  saveSession();
});

canvas2d.addEventListener('mouseup',   (e) => { if (e.button === 1 || state.isPanning) state.isPanning = false; });
canvas2d.addEventListener('mouseleave', ()  => { state.hoverPt = null; state.isPanning = false; state.openingPreview = null; });
canvas2d.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  state.isPanning = false;
  if ((state._rightDragDist ?? 0) > 5) { state._rightDragDist = 0; return; } // was a pan drag
  state._rightDragDist = 0;
  if (state.tool === 'erase' && state.polyPts.length >= 2) {
    // Right-click executes the erase: line → wall segment, polygon → area
    if (state.polyPts.length === 2) {
      const end = wallEnd(state.polyPts[0], state.polyPts[1]);
      eraseWallSegment(state.polyPts[0].x, state.polyPts[0].y, end.x, end.y, state.activeFloor);
    } else {
      eraseAreaPolygon([...state.polyPts], state.activeFloor);
    }
    state.polyPts = []; state.dirty3d = true; updateStatus();
    return;
  }
  if (state.tool === 'wall')       { state.wallStart = null; updateStatus(); }
  if (state.rectStart !== null)    { state.rectStart = null; }
  if (state.polyPts.length > 0)   { state.polyPts   = [];   updateStatus(); }
});
canvas2d.addEventListener('dblclick', () => {
  if (state.tool === 'wall') { state.wallStart = null; updateStatus(); }
  if (state.polyPts.length > 0) { state.polyPts = []; updateStatus(); }
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
    state.polyPts     = [];
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
    if (tool === 'paint')   { wallRemoveMode  = false; refreshWallPalette(); }
    document.getElementById('tree-settings').classList.toggle('hidden', tool !== 'tree');
    document.getElementById('floor3d-settings').classList.toggle('hidden', tool !== 'floor3d');
    if (tool === 'floor3d') { floorRemoveMode = false; refreshFloorPalette(); }
    document.getElementById('furniture-settings').classList.toggle('hidden', tool !== 'furniture');
    document.getElementById('stair-settings').classList.toggle('hidden', tool !== 'stair');
    document.getElementById('foundation-settings').classList.toggle('hidden', tool !== 'foundation');

    const cursors = { pan: 'grab', wall: 'crosshair', erase: 'default', door: 'default', window: 'default', paint: 'default', foundation: 'crosshair', garden: 'crosshair', tree: 'crosshair', floor3d: 'crosshair', furniture: 'crosshair', stair: 'crosshair' };
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
  saveSession();
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
  saveSession();
});

document.getElementById('btn-center-camera').addEventListener('click', () => {
  const wrap = document.getElementById('canvas-wrap');
  const gx = cam.pos.x / UNIT;
  const gy = cam.pos.z / UNIT;
  const g  = GRID * state.zoom;
  state.panX = wrap.clientWidth  / 2 - gx * g;
  state.panY = wrap.clientHeight / 2 - gy * g;
});

{ // Triple-click clear (3 clicks within 500 ms each)
  const btn = document.getElementById('btn-clear');
  let _clearClicks = 0, _clearTimer = null;
  btn.addEventListener('click', () => {
    _clearClicks++;
    clearTimeout(_clearTimer);
    if (_clearClicks === 1) btn.textContent = 'Rensa? (2)';
    else if (_clearClicks === 2) btn.textContent = 'Rensa? (3)';
    if (_clearClicks >= 3) {
      _clearClicks = 0;
      btn.textContent = 'Rensa allt';
      state.walls      = [];
      state.openings   = [];
      state.gardens    = [];
      state.trees      = [];
      state.floors3d   = [];
      state.fillFloors = [];
      state.furniture  = [];
      state.stairs      = [];
      state.foundations = [];
      state.floorDefs   = [{ id: 0, name: 'BV', wallHeight: 2.6 }];
      state.activeFloor = 0;
      state.wallStart  = null;
      state.rectStart  = null;
      state.polyPts    = [];
      state.dirty3d    = true;
      renderFloorSelector();
      updateStatus();
      clearTimeout(_saveTimer);
      saveSession();
      return;
    }
    _clearTimer = setTimeout(() => {
      _clearClicks = 0;
      btn.textContent = 'Rensa allt';
    }, 500);
  });
}

function updateStatus() {
  const msgs = {
    pan:    'Klicka och dra för att panorera  ·  Scroll = zooma',
    wall:   state.wallStart
              ? 'Klicka för att placera slutpunkt  ·  Högerklicka = avbryt'
              : 'Klicka för att starta en vägg',
    erase:  state.polyPts.length > 0
              ? `${state.polyPts.length} punkter  ·  Klicka för fler  ·  Klick nära start = stäng yta  ·  Högerklicka = radera`
              : 'Klicka på öppning/möbel = ta bort  ·  Klicka på tomt = starta linje/yta',
    door:   'Håll över en vägg och klicka för att placera dörröppning',
    window: 'Håll över en vägg och klicka för att placera fönster',
    paint:  'Klicka på vägg = färga sida  ·  Shift+klick = fyll alla väggar i slutet område',
    garden: state.polyPts.length > 0
              ? `${state.polyPts.length} punkter  ·  Klick nära start = stäng polygon  ·  Högerklicka = avbryt`
              : 'Klicka för att börja rita gräsmatta',
    tree:    'Klicka för att placera träd eller buske',
    floor3d: state.polyPts.length > 0
               ? `${state.polyPts.length} punkter  ·  Klick nära start = stäng polygon  ·  Högerklicka = avbryt`
               : 'Klicka för att börja rita golv',
    furniture: state.rectStart ? 'Klicka för att placera hörn 2  ·  Högerklicka = avbryt' : 'Klicka för att placera hörn 1',
    foundation: state.polyPts.length > 0
                  ? `${state.polyPts.length} punkter  ·  Klick nära start = stäng polygon  ·  Högerklicka = avbryt`
                  : 'Klicka för att börja rita grund',
    stair:      'Klicka för att placera trappa',
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
      foundations: state.foundations,
      walls:       state.walls,
      openings:    state.openings,
      gardens:     state.gardens,
      trees:       state.trees,
      floors3d:    state.floors3d,
      fillFloors:  state.fillFloors,
      furniture:   state.furniture,
      stairs:      state.stairs,
      floorDefs:   state.floorDefs,
      activeFloor: state.activeFloor,
      nextWallId:  state.nextWallId,
      nextId:      state.nextId,
      cam:  { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z, yaw: cam.yaw, pitch: cam.pitch },
      view: state.view,
      wallPalette, floorPalette, wallRecent, floorRecent,
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
  if (data.foundations) {
    state.foundations = data.foundations.map(fd => {
      if (fd.x1 !== undefined && !fd.points)
        return { id: fd.id, points: [{x:fd.x1,y:fd.y1},{x:fd.x2,y:fd.y1},{x:fd.x2,y:fd.y2},{x:fd.x1,y:fd.y2}], height: fd.height };
      return fd;
    });
  }
  if (data.walls) {
    state.walls = data.walls.map(w => {
      // migrate old single 'color' field to colorFront
      if (w.color && !w.colorFront) { w.colorFront = w.color; delete w.color; }
      return w;
    });
  }
  if (data.openings)    state.openings    = data.openings;
  if (data.gardens) {
    state.gardens = data.gardens.map(gd => {
      if (gd.rings) return gd; // already new format
      const pts = gd.points ?? (gd.x1 !== undefined
        ? [{x:gd.x1,y:gd.y1},{x:gd.x2,y:gd.y1},{x:gd.x2,y:gd.y2},{x:gd.x1,y:gd.y2}]
        : null);
      if (!pts) return gd;
      return { id: gd.id, rings: [pts, ...(gd.holes || [])] };
    });
  }
  if (data.trees)       state.trees       = data.trees;
  if (data.floors3d) {
    state.floors3d = data.floors3d.map(fl => {
      if (fl.rings) return fl; // already new format
      const pts = fl.points ?? (fl.x1 !== undefined
        ? [{x:fl.x1,y:fl.y1},{x:fl.x2,y:fl.y1},{x:fl.x2,y:fl.y2},{x:fl.x1,y:fl.y2}]
        : null);
      if (!pts) return fl;
      return { id: fl.id, rings: [pts, ...(fl.holes || [])], color: fl.color, floor: fl.floor ?? 0 };
    });
  }
  if (data.fillFloors)  state.fillFloors  = data.fillFloors;
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
  if (data.wallPalette  && data.wallPalette.length  === DEFAULT_WALL_PALETTE.length)  wallPalette  = data.wallPalette;
  if (data.floorPalette && data.floorPalette.length === DEFAULT_FLOOR_PALETTE.length) floorPalette = data.floorPalette;
  if (data.wallRecent)  wallRecent  = data.wallRecent;
  if (data.floorRecent) floorRecent = data.floorRecent;
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
  refreshWallPalette();
  refreshFloorPalette();

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
