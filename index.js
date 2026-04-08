import earcut from 'earcut';
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
  walls:          [],
  openings:       [],
  gardens:        [],
  trees:          [],
  floors3d:       [],
  fillFloors:     [],
  furniture:      [],
  foundations:    [],
  stairs:         [],
  floorDefs:      [{id: 0, name: 'BV', wallHeight: 2.6}],
  activeFloor:    0,
  nextWallId:     1,
  nextId:         1,

  tool:           'pan',
  hoverWall3d:    null,
  hoverFloor3d:   null,
  rectStart:      null,
  polyPts:        [],
  wallStart:      null,
  hoverPt:        null,
  hoverWall:      -1,
  hoverOpening:   null,
  openingPreview: null,

  panX:       0,
  panY:       0,
  zoom:       1,
  isPanning:  false,
  panSX:      0,
  panSY:      0,
  _panStartMx: 0,
  _panStartMy: 0,

  view:       'split',
  dirty3d:    true,
};

// ── COLOR PALETTE ─────────────────────────────────────────
// Wall: whites/creams, warm greys, soft pastels, bold accent colours
const DEFAULT_WALL_PALETTE  = [
  '#ffffff','#f5f0eb','#ede8e0','#e2dbd0',  // whites & off-whites
  '#d6cfc4','#c8c0b4','#b0a898','#8c8478',  // warm greys
  '#dce4e8','#b8ccd4','#8fb0bc','#5c8a98',  // blue-greys
  '#dce8d8','#b8d4b0','#8ab898','#5a8c6e',  // sage greens
  '#f0e8d8','#e4d4b8','#c8b48c','#a89060',  // warm beige/sand
  '#f0dcd8','#e4c0b8','#d49888','#b87060',  // terracotta/dusty rose
  '#e8e0f0','#c8bce0','#a89cc4','#7868a0',  // dusty lavender
  '#2c2c2c','#1a1a1a',                       // dark/charcoal
];
// Floor: light wood, mid wood, dark wood, parquet, concrete, stone, tile
const DEFAULT_FLOOR_PALETTE = [
  '#f0e4cc','#e8d4b0','#d4b87a','#c0a060',  // light/blond wood
  '#b88c50','#a07840','#8c6430','#785020',  // mid wood / oak
  '#5c3c18','#4a2e10','#3c2410','#2c1a08',  // dark wood / walnut
  '#e0d8cc','#ccc4b4','#b4ac9c','#9c9488',  // concrete / stone
  '#dcd8d0','#c4c0b8','#a8a4a0','#888480',  // light tile / grey
  '#c4b8a8','#b0a494','#9c9080','#887c6c',  // limestone / travertine
];

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

function renderColorUI(uiEl, colorInputId, palette, recent, onSelect, onPaletteChange) {
  uiEl.innerHTML = '';
  uiEl.className = 'color-ui-wrap';
  const currentColor = document.getElementById(colorInputId)?.value ?? '#ffffff';

  const palGrid = document.createElement('div');
  palGrid.className = 'color-row';
  palette.forEach((col, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (col === currentColor ? ' sel' : '');
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

  if (recent.length > 0) {
    const lbl = document.createElement('div');
    lbl.className = 'color-section-label';
    lbl.textContent = 'Senast använda';
    uiEl.appendChild(lbl);
    const recRow = document.createElement('div');
    recRow.className = 'color-row';
    recent.forEach(col => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (col === currentColor ? ' sel' : '');
      sw.style.background = col;
      sw.title = col;
      sw.onclick = () => onSelect(col);
      recRow.appendChild(sw);
    });
    uiEl.appendChild(recRow);
  }

  // Full-width "Egen färg" button
  const customWrap = document.createElement('div');
  customWrap.style.cssText = 'position:relative;margin-top:4px;';

  const customBtn = document.createElement('div');
  customBtn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--surface);font-size:10px;color:var(--text);user-select:none;';
  customBtn.innerHTML = '<span id="custom-color-preview-' + colorInputId + '" style="display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid rgba(0,0,0,0.18);background:' + currentColor + ';flex-shrink:0;"></span>Egen färg';

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = currentColor;
  colorPicker.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;padding:0;border:none;';
  colorPicker.oninput = (ev) => {
    const orig = document.getElementById(colorInputId);
    if (orig) orig.value = ev.target.value;
    const preview = document.getElementById('custom-color-preview-' + colorInputId);
    if (preview) preview.style.background = ev.target.value;
    onSelect(ev.target.value);
  };

  customWrap.appendChild(customBtn);
  customWrap.appendChild(colorPicker);
  uiEl.appendChild(customWrap);
}

function refreshWallPalette() {
  const el = document.getElementById('wall-palette-ui');
  if (!el) return;
  renderColorUI(el, 'wall-color', wallPalette, wallRecent,
    (col) => {
      document.getElementById('wall-color').value = col;
      refreshWallPalette();
    },
    () => { refreshWallPalette(); saveSession(); }
  );
}

function refreshFloorPalette() {
  const el = document.getElementById('floor-palette-ui');
  if (!el) return;
  renderColorUI(el, 'floor3d-color', floorPalette, floorRecent,
    (col) => {
      document.getElementById('floor3d-color').value = col;
      refreshFloorPalette();
    },
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

function addWall(x1, y1, x2, y2, floor, color) {
  const segments = clipWallToFoundations(x1, y1, x2, y2);
  for (const seg of segments) {
    addWallSegment(seg.x1, seg.y1, seg.x2, seg.y2, floor, color);
  }
}

function clipWallToFoundations(x1, y1, x2, y2) {
  if (state.foundations.length === 0) {
    return [{ x1, y1, x2, y2 }];
  }
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) return [];

  const ts = [0, 1];
  for (const fd of state.foundations) {
    if (!fd.rings?.[0]) continue;
    for (const ring of fd.rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        const ex = q.x - p.x, ey = q.y - p.y;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 0.0001) continue;
        const t = ((p.x - x1) * ey - (p.y - y1) * ex) / denom;
        const u = ((p.x - x1) * dy - (p.y - y1) * dx) / denom;
        if (t > 0.0001 && t < 0.9999 && u >= 0 && u <= 1) ts.push(t);
      }
    }
  }
  ts.sort((a, b) => a - b);

  const result = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const tA = ts[i], tB = ts[i + 1];
    if (tB - tA < 0.0001) continue;
    const mx = x1 + (tA + tB) / 2 * dx, my = y1 + (tA + tB) / 2 * dy;
    const inside = state.foundations.some(fd => {
      if (!fd.rings?.[0]) return false;
      if (pointInPoly(mx, my, fd.rings[0])) return true;
      const ring = fd.rings[0], n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i+1)%n];
        const ex = b.x-a.x, ey = b.y-a.y, lenE = ex*ex+ey*ey;
        if (lenE < 0.0001) continue;
        const t = Math.max(0, Math.min(1, ((mx-a.x)*ex+(my-a.y)*ey)/lenE));
        const dist = Math.hypot(mx-(a.x+t*ex), my-(a.y+t*ey));
        if (dist < 0.05) return true;
      }
      return false;
    });
    if (inside) result.push({ x1: x1 + tA * dx, y1: y1 + tA * dy, x2: x1 + tB * dx, y2: y1 + tB * dy });
  }
  return result;
}

function addWallSegment(x1, y1, x2, y2, floor, color) {
  const dx = x2 - x1, dy = y2 - y1;
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) continue;
    const wx = w.x2 - w.x1, wy = w.y2 - w.y1;
    if (Math.abs(dx * wy - dy * wx) > 0.001) continue;
    // Cases extending the END: start point unchanged, opening positions stay correct
    if (w.x2 === x1 && w.y2 === y1) { w.x2 = x2; w.y2 = y2; return; }
    if (w.x2 === x2 && w.y2 === y2) { w.x2 = x1; w.y2 = y1; return; }
    // Cases extending the START: start moves, opening positions must shift by new segment length
    if (w.x1 === x2 && w.y1 === y2) {
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      for (const op of state.openings) { if (op.wallId === w.id) op.left += segLen; }
      w.x1 = x1; w.y1 = y1; return;
    }
    if (w.x1 === x1 && w.y1 === y1) {
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      for (const op of state.openings) { if (op.wallId === w.id) op.left += segLen; }
      w.x1 = x2; w.y1 = y2; return;
    }
  }
  state.walls.push({ id: state.nextWallId++, x1, y1, x2, y2, floor, color });
}

// ── ERASE HELPERS ─────────────────────────────────────────
function eraseWallSegment(ex1, ey1, ex2, ey2, floor) {
  const newWalls = [];
  const removedIds = new Set();
  const keptSegments = []; // {origId, newId, tA, tB, wLen}
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) { newWalls.push(w); continue; }
    const dWx = w.x2 - w.x1, dWy = w.y2 - w.y1;
    const wLenSq = dWx * dWx + dWy * dWy;
    if (wLenSq < 0.0001) continue;
    if (Math.abs(cross2d(dWx, dWy, ex1 - w.x1, ey1 - w.y1)) > 0.01 ||
        Math.abs(cross2d(dWx, dWy, ex2 - w.x1, ey2 - w.y1)) > 0.01) {
      newWalls.push(w); continue;
    }
    const te1 = ((ex1 - w.x1) * dWx + (ey1 - w.y1) * dWy) / wLenSq;
    const te2 = ((ex2 - w.x1) * dWx + (ey2 - w.y1) * dWy) / wLenSq;
    const eMin = Math.min(te1, te2), eMax = Math.max(te1, te2);
    if (eMax <= 0.001 || eMin >= 0.999) { newWalls.push(w); continue; }
    removedIds.add(w.id);
    const wLen = Math.sqrt(wLenSq);
    const keep = (tA, tB) => {
      tA = Math.max(0, tA); tB = Math.min(1, tB);
      if (tB - tA < 0.001) return;
      const newId = state.nextWallId++;
      newWalls.push({ ...w, id: newId,
        x1: w.x1 + tA * dWx, y1: w.y1 + tA * dWy,
        x2: w.x1 + tB * dWx, y2: w.y1 + tB * dWy });
      keptSegments.push({ origId: w.id, newId, tA, tB, wLen });
    };
    keep(0, eMin);
    keep(eMax, 1);
  }
  // Transfer openings from split walls to whichever kept segment contains them
  const survivingOpenings = [];
  for (const op of state.openings) {
    if (!removedIds.has(op.wallId)) { survivingOpenings.push(op); continue; }
    const opEnd = op.left + op.width;
    for (const seg of keptSegments) {
      if (seg.origId !== op.wallId) continue;
      const segStart = seg.tA * seg.wLen;
      const segEnd   = seg.tB * seg.wLen;
      if (op.left >= segStart - 0.001 && opEnd <= segEnd + 0.001) {
        survivingOpenings.push({ ...op, wallId: seg.newId, left: op.left - segStart });
        break;
      }
    }
    // opening falls in the erased section — discard it
  }
  state.openings = survivingOpenings;
  state.walls = newWalls;
}

function toClipPoly(rings) {
  return rings.map(r => r.map(p => [p.x, p.y]));
}
function fromClipPoly(poly) {
  return poly.map(ring => ring.map(p => ({ x: p[0], y: p[1] })));
}

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

function subtractPolyFromCollection(items, clipPts, floorLevel) {
  const clip = [clipPts.map(p => [p.x, p.y])];
  const out = [];
  for (const item of items) {
    if (!item.rings?.[0]) { out.push(item); continue; }
    if (floorLevel !== null && floorLevel !== undefined && (item.floor ?? 0) !== floorLevel) {
      out.push(item); continue;
    }
    const outer = item.rings[0];
    const edgesIntersect = () => {
      const n1 = clipPts.length, n2 = outer.length;
      for (let a = 0; a < n1; a++) {
        const p1 = clipPts[a], p2 = clipPts[(a+1)%n1];
        for (let b = 0; b < n2; b++) {
          const p3 = outer[b], p4 = outer[(b+1)%n2];
          if (segsIntersect(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y,p4.x,p4.y)) return true;
        }
      }
      return false;
    };
    const overlaps = clipPts.some(p => pointInPoly(p.x, p.y, outer)) ||
                     outer.some(p => pointInPoly(p.x, p.y, clipPts)) ||
                     edgesIntersect();
    if (!overlaps) { out.push(item); continue; }
    const result = polygonClipping.difference(toClipPoly(item.rings), clip);
    let first = true;
    for (const poly of result) {
      out.push({ ...item, id: first ? item.id : state.nextId++, rings: fromClipPoly(poly) });
      first = false;
    }
  }
  return out;
}

function eraseAreaPolygon(erasePts, activeFloor) {
  state.floors3d    = subtractPolyFromCollection(state.floors3d,    erasePts, activeFloor);
  state.gardens     = subtractPolyFromCollection(state.gardens,     erasePts, null);
  state.foundations = subtractPolyFromCollection(state.foundations, erasePts, null);

  const newWalls = [];
  const removedWallIds = new Set();
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== activeFloor) { newWalls.push(w); continue; }
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) continue;
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

  const keptWallIds = new Set(newWalls.map(w => w.id));
  state.openings = state.openings.filter(op => !removedWallIds.has(op.wallId) && keptWallIds.has(op.wallId));

  const n = erasePts.length;
  for (let i = 0; i < n; i++) {
    const a = erasePts[i], b = erasePts[(i + 1) % n];
    eraseWallSegment(a.x, a.y, b.x, b.y, activeFloor);
  }

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

function edgeBlocked(cx, cy, nx, ny, floor) {
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
  const cx0 = Math.floor(startX), cy0 = Math.floor(startY);
  let minX = cx0 - 1, maxX = cx0 + 1, minY = cy0 - 1, maxY = cy0 + 1;
  for (const w of state.walls) {
    if ((w.floor ?? 0) !== floor) continue;
    minX = Math.min(minX, w.x1, w.x2) - 1;
    maxX = Math.max(maxX, w.x1, w.x2) + 1;
    minY = Math.min(minY, w.y1, w.y2) - 1;
    maxY = Math.max(maxY, w.y1, w.y2) + 1;
  }
  if (maxX - minX > 300 || maxY - minY > 300) return null;

  const visited = new Set();
  const key = (x, y) => `${x},${y}`;
  const queue = [[cx0, cy0]];
  visited.add(key(cx0, cy0));
  const cells = [];

  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) return null;
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

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function wallSide(w, px, py) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
  return cross2d(dx, dy, px - cx, py - cy) >= 0 ? 'front' : 'back';
}

const POLY_SNAP = 0.9;

function polyAddPoint(gpt, onClose) {
  if (state.polyPts.length === 0) {
    state.polyPts = [{ ...gpt }];
    return;
  }
  const last = state.polyPts[state.polyPts.length - 1];
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

function wallEnd(start, cursor) {
  if (!shiftDown) return { ...cursor };
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

function wallHit(mx, my) {
  for (let i = 0; i < state.walls.length; i++) {
    const w  = state.walls[i];
    const p1 = gridToScreen(w.x1, w.y1);
    const p2 = gridToScreen(w.x2, w.y2);
    if (ptToSegDist(mx, my, p1.x, p1.y, p2.x, p2.y) < 9) return i;
  }
  return -1;
}

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
  const center      = Math.round(t * wallLen);
  const left        = center - Math.round(s.width / 2);
  return Math.max(0, Math.min(wallLen - s.width, left));
}

// ── 2D DRAW ────────────────────────────────────────────────
function drawWall(w, isHov, hovColor = '#c04040') {
  const p1      = gridToScreen(w.x1, w.y1);
  const p2      = gridToScreen(w.x2, w.y2);
  const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  const g       = GRID * state.zoom;
  const thick   = Math.max(3, g * 0.3);

  const wallOpenings = state.openings
    .filter(op => op.wallId === w.id)
    .sort((a, b) => a.left - b.left);

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
    ctx.strokeStyle = isHov ? hovColor : '#4a3f35';
    ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
  }

  for (const op of wallOpenings) {
    const t1   = op.left / wallLen;
    const t2   = (op.left + op.width) / wallLen;
    const ox1  = p1.x + t1 * (p2.x - p1.x);
    const oy1  = p1.y + t1 * (p2.y - p1.y);
    const ox2  = p1.x + t2 * (p2.x - p1.x);
    const oy2  = p1.y + t2 * (p2.y - p1.y);
    const isHovOp = op.id === state.hoverOpening;

    if (op.type === 'window') {
      ctx.strokeStyle = isHovOp ? hovColor : 'rgba(80,150,210,0.85)';
      ctx.lineWidth   = isHovOp ? 3 : 2;
      ctx.lineCap     = 'butt';
      ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke();
    } else {
      ctx.strokeStyle = isHovOp ? hovColor : 'rgba(120,90,60,0.6)';
      ctx.lineWidth   = isHovOp ? 2 : 1.5;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke();
      if (!isHovOp) {
        const swingR = Math.hypot(ox2 - ox1, oy2 - oy1);
        const angle  = Math.atan2(oy2 - oy1, ox2 - ox1);
        ctx.strokeStyle = 'rgba(120,90,60,0.3)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(ox1, oy1, swingR, angle, angle - Math.PI / 2, true); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (isHovOp) {
      ctx.fillStyle    = hovColor;
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
  ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke();

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

  for (const fd of state.foundations) {
    if (!fd.rings?.[0] || fd.rings[0].length < 3) continue;
    ctx.beginPath();
    for (const ring of fd.rings) {
      const p0f = gridToScreen(ring[0].x, ring[0].y);
      ctx.moveTo(p0f.x, p0f.y);
      for (let i = 1; i < ring.length; i++) { const p = gridToScreen(ring[i].x, ring[i].y); ctx.lineTo(p.x, p.y); }
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(160,140,110,0.40)'; ctx.strokeStyle = 'rgba(110,90,60,0.70)'; ctx.lineWidth = 1.5;
    ctx.fill('evenodd'); ctx.stroke();
  }

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

  if (state.tool === 'floor3d' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const last = pts[pts.length - 1];
    const end  = wallEnd(last, state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;
    ctx.strokeStyle = 'rgba(130,100,70,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const p0s = gridToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < pts.length; i++) { const p = gridToScreen(pts[i].x, pts[i].y); ctx.lineTo(p.x, p.y); }
    const ep = gridToScreen(drawEnd.x, drawEnd.y); ctx.lineTo(ep.x, ep.y);
    ctx.stroke(); ctx.setLineDash([]);
    if (snapClose) { ctx.beginPath(); ctx.arc(p0s.x, p0s.y, 7, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(80,160,60,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const pt of pts) { const sp = gridToScreen(pt.x, pt.y); ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(130,100,70,0.8)'; ctx.fill(); }
  }

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

  if (state.tool === 'garden' && state.polyPts.length > 0 && state.hoverPt) {
    const pts = state.polyPts;
    const last = pts[pts.length - 1];
    const end  = wallEnd(last, state.hoverPt);
    const snapClose = pts.length >= 3 && Math.hypot(state.hoverPt.x - pts[0].x, state.hoverPt.y - pts[0].y) < POLY_SNAP;
    const drawEnd   = snapClose ? pts[0] : end;
    ctx.strokeStyle = 'rgba(80,140,60,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const p0s = gridToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0s.x, p0s.y);
    for (let i = 1; i < pts.length; i++) { const p = gridToScreen(pts[i].x, pts[i].y); ctx.lineTo(p.x, p.y); }
    const ep = gridToScreen(drawEnd.x, drawEnd.y); ctx.lineTo(ep.x, ep.y);
    ctx.stroke(); ctx.setLineDash([]);
    if (snapClose) { ctx.beginPath(); ctx.arc(p0s.x, p0s.y, 7, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(80,160,60,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const pt of pts) { const sp = gridToScreen(pt.x, pt.y); ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80,140,60,0.8)'; ctx.fill(); }
  }

  for (const t of state.trees) {
    const sp = gridToScreen(t.x, t.y);
    const r  = t.radius * GRID * state.zoom;
    ctx.fillStyle   = t.type === 'tree' ? 'rgba(60,120,50,0.55)' : 'rgba(90,150,60,0.45)';
    ctx.strokeStyle = t.type === 'tree' ? 'rgba(40,90,30,0.8)'   : 'rgba(60,120,40,0.7)';
    ctx.lineWidth   = 1;
    if (t.type === 'bush-square') {
      ctx.fillStyle   = 'rgba(90,150,60,0.45)';
      ctx.strokeStyle = 'rgba(60,120,40,0.7)';
      ctx.beginPath(); ctx.rect(sp.x - r, sp.y - r, r * 2, r * 2);
    } else {
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    }
    ctx.fill(); ctx.stroke();
  }

  if (state.tool === 'tree' && state.hoverPt) {
    const sp = gridToScreen(state.hoverPt.x, state.hoverPt.y);
    const r  = parseFloat(document.getElementById('tree-radius').value) * GRID * state.zoom;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(80,160,60,0.25)';
    ctx.strokeStyle = 'rgba(60,130,40,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }

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
    ctx.beginPath(); ctx.rect(-fw / 2, -fh / 2, fw, fh);
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

  for (let i = 0; i < state.walls.length; i++) {
    const w = state.walls[i];
    if ((w.floor ?? 0) !== state.activeFloor) continue;
    const hovColor = state.tool === 'select' ? '#4a7fc0' : '#c04040';
    drawWall(w, i === state.hoverWall, hovColor);
  }

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
    ctx.beginPath(); ctx.rect(0, 0, wPx, lenPx); ctx.fill(); ctx.stroke();
    for (let s = 1; s < st.steps; s++) {
      const sy = s * st.stepLen * g;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(wPx, sy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(80,60,40,0.6)';
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.1); ctx.lineTo(wPx / 2, lenPx * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.8); ctx.lineTo(wPx / 2 - 4, lenPx * 0.65); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wPx / 2, lenPx * 0.8); ctx.lineTo(wPx / 2 + 4, lenPx * 0.65); ctx.stroke();
    ctx.restore();
  }

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

  if (state.tool === 'wall' && state.wallStart && state.hoverPt) {
    const end     = wallEnd(state.wallStart, state.hoverPt);
    const p1      = gridToScreen(state.wallStart.x, state.wallStart.y);
    const p2      = gridToScreen(end.x, end.y);
    const thick   = Math.max(3, g * 0.3);

    ctx.strokeStyle = 'rgba(74,63,53,0.38)';
    ctx.lineWidth   = thick;
    ctx.lineCap     = 'round';
    ctx.setLineDash([g * 0.45, g * 0.2]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
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

  drawOpeningPreview();
  drawCameraIndicator();
}

function drawCameraIndicator() {
  const gx = cam.pos.x / UNIT;
  const gy = cam.pos.z / UNIT;
  const sp = gridToScreen(gx, gy);

  const g       = GRID * state.zoom;
  const fovHalf = (Math.PI / 180) * 35;
  const coneLen = g * 5;

  // Forward in 3D XZ: (sin(yaw), -cos(yaw)). In screen: X maps to screen-X, Z maps to screen-Y.
  const tipAngle2d = Math.atan2(-Math.cos(cam.yaw), Math.sin(cam.yaw));

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

  ctx.beginPath();
  ctx.arc(sp.x, sp.y, g * 0.35, 0, Math.PI * 2);
  ctx.fillStyle   = '#2864d2';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.fill();
  ctx.stroke();
}

// ══════════════════════════════════════════════════════════════
// ── WEBGL 3D ENGINE ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── Mat4 (column-major Float32Array(16)) ──────────────────
function m4() { const m = new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; }

function m4Perspective(out, fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function m4Ortho(out, l, r, b, t, n, f) {
  out.fill(0);
  out[0] = 2/(r-l); out[5] = 2/(t-b); out[10] = -2/(f-n);
  out[12] = -(r+l)/(r-l); out[13] = -(t+b)/(t-b); out[14] = -(f+n)/(f-n); out[15] = 1;
  return out;
}

function m4Mul(out, a, b) {
  const t = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      t[col*4+row] = a[row]*b[col*4] + a[4+row]*b[col*4+1] + a[8+row]*b[col*4+2] + a[12+row]*b[col*4+3];
    }
  }
  out.set(t);
  return out;
}

function m4Translate(out, a, x, y, z) {
  if (out !== a) out.set(a);
  out[12] += a[0]*x + a[4]*y + a[8]*z;
  out[13] += a[1]*x + a[5]*y + a[9]*z;
  out[14] += a[2]*x + a[6]*y + a[10]*z;
  out[15] += a[3]*x + a[7]*y + a[11]*z;
  return out;
}

function m4RotateY(out, a, rad) {
  const r = m4(); const s = Math.sin(rad), c = Math.cos(rad);
  r[0]=c; r[8]=s; r[2]=-s; r[10]=c;
  return m4Mul(out, a, r);
}

function m4RotateX(out, a, rad) {
  const r = m4(); const s = Math.sin(rad), c = Math.cos(rad);
  r[5]=c; r[9]=-s; r[6]=s; r[10]=c;
  return m4Mul(out, a, r);
}

function m4Scale(out, a, x, y, z) {
  if (out !== a) out.set(a);
  out[0]*=x; out[1]*=x; out[2]*=x; out[3]*=x;
  out[4]*=y; out[5]*=y; out[6]*=y; out[7]*=y;
  out[8]*=z; out[9]*=z; out[10]*=z; out[11]*=z;
  return out;
}

function m4Invert(out, a) {
  const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7],
        a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
  const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,
        b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,
        b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if(!det)return null;
  det=1/det;
  out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a02*b10-a01*b11-a03*b09)*det;
  out[2]=(a31*b05-a32*b04+a33*b03)*det; out[3]=(a22*b04-a21*b05-a23*b03)*det;
  out[4]=(a12*b08-a10*b11-a13*b07)*det; out[5]=(a00*b11-a02*b08+a03*b07)*det;
  out[6]=(a32*b02-a30*b05-a33*b01)*det; out[7]=(a20*b05-a22*b02+a23*b01)*det;
  out[8]=(a10*b10-a11*b08+a13*b06)*det; out[9]=(a01*b08-a00*b10-a03*b06)*det;
  out[10]=(a30*b04-a31*b02+a33*b00)*det; out[11]=(a21*b02-a20*b04-a23*b00)*det;
  out[12]=(a11*b07-a10*b09-a12*b06)*det; out[13]=(a00*b09-a01*b07+a02*b06)*det;
  out[14]=(a31*b01-a30*b03-a32*b00)*det; out[15]=(a20*b03-a21*b01+a22*b00)*det;
  return out;
}

function m4LookAt(out, eye, target, up) {
  let zx=eye[0]-target[0],zy=eye[1]-target[1],zz=eye[2]-target[2];
  let l=Math.hypot(zx,zy,zz); zx/=l;zy/=l;zz/=l;
  let rx=up[1]*zz-up[2]*zy, ry=up[2]*zx-up[0]*zz, rz=up[0]*zy-up[1]*zx;
  l=Math.hypot(rx,ry,rz); rx/=l;ry/=l;rz/=l;
  const ux=zy*rz-zz*ry, uy=zz*rx-zx*rz, uz=zx*ry-zy*rx;
  out[0]=rx;out[1]=ux;out[2]=zx;out[3]=0;
  out[4]=ry;out[5]=uy;out[6]=zy;out[7]=0;
  out[8]=rz;out[9]=uz;out[10]=zz;out[11]=0;
  out[12]=-(rx*eye[0]+ry*eye[1]+rz*eye[2]);
  out[13]=-(ux*eye[0]+uy*eye[1]+uz*eye[2]);
  out[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
  out[15]=1;
  return out;
}

function m4TransformPt(m, x, y, z) {
  const w = m[3]*x+m[7]*y+m[11]*z+m[15];
  return {
    x: (m[0]*x+m[4]*y+m[8]*z+m[12])/w,
    y: (m[1]*x+m[5]*y+m[9]*z+m[13])/w,
    z: (m[2]*x+m[6]*y+m[10]*z+m[14])/w
  };
}

function buildViewMatrix(out) {
  const cy=Math.cos(cam.yaw),sy=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
  const px=cam.pos.x,py=cam.pos.y,pz=cam.pos.z;
  out[0]=cy;     out[1]=-sp*sy; out[2]=-cp*sy; out[3]=0;
  out[4]=0;      out[5]=cp;     out[6]=-sp;    out[7]=0;
  out[8]=sy;     out[9]=sp*cy;  out[10]=cp*cy; out[11]=0;
  out[12]=-(cy*px+sy*pz);
  out[13]=-(-sp*sy*px+cp*py+sp*cy*pz);
  out[14]=-(-cp*sy*px-sp*py+cp*cy*pz);
  out[15]=1;
  return out;
}

// ── Color helpers ─────────────────────────────────────────
function hexToRGB(hex) {
  if (typeof hex === 'number') return [(hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255];
  hex = hex.replace('#','');
  return [parseInt(hex.substr(0,2),16)/255,parseInt(hex.substr(2,2),16)/255,parseInt(hex.substr(4,2),16)/255];
}

// ── Vec3 helpers ──────────────────────────────────────────
function v3addScaled(v, d, s) { v.x += d.x*s; v.y += d.y*s; v.z += d.z*s; }

// ── Shaders ───────────────────────────────────────────────
const MAIN_VS = `#version 300 es
layout(location=0)in vec3 aPos;layout(location=1)in vec3 aNorm;layout(location=2)in vec3 aCol;
uniform mat4 uModel,uView,uProj,uLightVP;
out vec3 vWorldPos,vNorm,vCol;out vec4 vLightPos;out float vFog;
void main(){
  vec4 w=uModel*vec4(aPos,1);vWorldPos=w.xyz;
  vNorm=mat3(uModel)*aNorm;vCol=aCol;
  vLightPos=uLightVP*w;
  vec4 v=uView*w;vFog=-v.z;
  gl_Position=uProj*v;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos,vNorm,vCol;in vec4 vLightPos;in float vFog;
uniform vec3 uSunDir,uSunCol,uFillDir,uFillCol,uAmbient,uFogCol,uTintCol;
uniform float uFogNear,uFogFar,uEmissive,uOpacity,uTintAmt,uFlash;
uniform sampler2D uShadowMap;
out vec4 fragColor;
float shadow(){
  vec3 p=vLightPos.xyz/vLightPos.w*0.5+0.5;
  if(p.z>1.||p.x<0.||p.x>1.||p.y<0.||p.y>1.)return 0.;
  float cosTheta=clamp(dot(normalize(vNorm),uSunDir),0.,1.);
  float bias=mix(0.012,0.002,cosTheta);
  float s=0.;vec2 ts=1./vec2(textureSize(uShadowMap,0));
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
    float d=texture(uShadowMap,p.xy+vec2(x,y)*ts).r;
    s+=(p.z-bias>d)?1.:0.;
  }return s/9.;
}
void main(){
  vec3 N=normalize(vNorm);
  float diff=max(dot(N,uSunDir),0.),sh=shadow(),fill=max(dot(N,uFillDir),0.);
  vec3 light=uAmbient+uSunCol*diff*(1.-sh*0.7)+uFillCol*fill;
  vec3 baseCol=mix(vCol,uTintCol,uTintAmt);
  vec3 col=baseCol*light+uEmissive+uFlash;
  float fog=clamp((vFog-uFogNear)/(uFogFar-uFogNear),0.,1.);
  col=mix(col,uFogCol,fog);
  fragColor=vec4(col,uOpacity);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0)in vec3 aPos;uniform mat4 uModel,uLightVP;
void main(){gl_Position=uLightVP*uModel*vec4(aPos,1);}`;

const SHADOW_FS = `#version 300 es
precision highp float;out vec4 fc;void main(){fc=vec4(1);}`;

const LINE_VS = `#version 300 es
layout(location=0)in vec3 aPos;uniform mat4 uVP,uView;out float vFog;
void main(){gl_Position=uVP*vec4(aPos,1);vFog=-(uView*vec4(aPos,1)).z;}`;

const LINE_FS = `#version 300 es
precision highp float;uniform vec3 uColor,uFogCol;uniform float uFogNear,uFogFar;in float vFog;out vec4 fc;
void main(){float f=clamp((vFog-uFogNear)/(uFogFar-uFogNear),0.,1.);fc=vec4(mix(uColor,uFogCol,f),1.);}`;

// ── GL state ──────────────────────────────────────────────
let gl, canvas3d;
let mainProg, shadowProg, lineProg;
let mainU = {}, shadowU = {}, lineU = {};
let shadowFBO, shadowTex;
const SHADOW_SIZE = 2048;
const sceneMeshes = [];
let gridVao, gridVertCount;
let groundMesh;

const viewMat = m4(), projMat = m4(), lightVP = m4();

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
  return s;
}

function linkProg(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
  return p;
}

function getUniforms(prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

// ── Geometry builders ─────────────────────────────────────
function geoBox(w, h, d, faceColors) {
  const hw=w/2,hh=h/2,hd=d/2;
  const faces = [
    {n:[1,0,0],  v:[[hw,-hh,hd],[hw,-hh,-hd],[hw,hh,-hd],[hw,hh,hd]]},
    {n:[-1,0,0], v:[[-hw,-hh,-hd],[-hw,-hh,hd],[-hw,hh,hd],[-hw,hh,-hd]]},
    {n:[0,1,0],  v:[[-hw,hh,hd],[hw,hh,hd],[hw,hh,-hd],[-hw,hh,-hd]]},
    {n:[0,-1,0], v:[[-hw,-hh,-hd],[hw,-hh,-hd],[hw,-hh,hd],[-hw,-hh,hd]]},
    {n:[0,0,1],  v:[[-hw,-hh,hd],[hw,-hh,hd],[hw,hh,hd],[-hw,hh,hd]]},
    {n:[0,0,-1], v:[[hw,-hh,-hd],[-hw,-hh,-hd],[-hw,hh,-hd],[hw,hh,-hd]]},
  ];
  const pos=[],nrm=[],col=[],idx=[];
  faces.forEach((f,fi)=>{
    const base=fi*4, c=faceColors[fi];
    for(const v of f.v){pos.push(...v);nrm.push(...f.n);col.push(...c);}
    idx.push(base,base+1,base+2, base,base+2,base+3);
  });
  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

function geoPlane(w, d, color) {
  const hw=w/2,hd=d/2;
  return {
    positions:new Float32Array([-hw,0,-hd, hw,0,-hd, hw,0,hd, -hw,0,hd]),
    normals:new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,1,0]),
    colors:new Float32Array([...color,...color,...color,...color]),
    indices:new Uint32Array([0,2,1, 0,3,2])
  };
}

function geoCylinder(rTop, rBot, height, segs, color) {
  const pos=[],nrm=[],col=[],idx=[];
  const hh=height/2;
  const slope=(rBot-rTop)/height;
  const nf=1/Math.sqrt(1+slope*slope);
  const ny=slope*nf;
  for(let i=0;i<=segs;i++){
    const a=(i/segs)*Math.PI*2, c=Math.cos(a),s=Math.sin(a);
    pos.push(c*rTop,hh,s*rTop); nrm.push(c*nf,ny,s*nf); col.push(...color);
    pos.push(c*rBot,-hh,s*rBot); nrm.push(c*nf,ny,s*nf); col.push(...color);
  }
  for(let i=0;i<segs;i++){const a=i*2;idx.push(a,a+1,a+3, a,a+3,a+2);}
  // top cap
  let tc=pos.length/3;
  pos.push(0,hh,0);nrm.push(0,1,0);col.push(...color);
  for(let i=0;i<=segs;i++){const a=(i/segs)*Math.PI*2;pos.push(Math.cos(a)*rTop,hh,Math.sin(a)*rTop);nrm.push(0,1,0);col.push(...color);}
  for(let i=0;i<segs;i++)idx.push(tc,tc+1+i,tc+2+i);
  // bottom cap
  let bc=pos.length/3;
  pos.push(0,-hh,0);nrm.push(0,-1,0);col.push(...color);
  for(let i=0;i<=segs;i++){const a=(i/segs)*Math.PI*2;pos.push(Math.cos(a)*rBot,-hh,Math.sin(a)*rBot);nrm.push(0,-1,0);col.push(...color);}
  for(let i=0;i<segs;i++)idx.push(bc,bc+2+i,bc+1+i);
  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

function geoSphere(radius, ws, hs, color) {
  const pos=[],nrm=[],col=[],idx=[];
  for(let y=0;y<=hs;y++){
    const v=y/hs,phi=v*Math.PI;
    for(let x=0;x<=ws;x++){
      const u=x/ws,theta=u*Math.PI*2;
      const nx=Math.sin(phi)*Math.cos(theta),ny=Math.cos(phi),nz=Math.sin(phi)*Math.sin(theta);
      pos.push(nx*radius,ny*radius,nz*radius);nrm.push(nx,ny,nz);col.push(...color);
    }
  }
  for(let y=0;y<hs;y++)for(let x=0;x<ws;x++){
    const a=y*(ws+1)+x, b=a+ws+1;
    idx.push(a,b,a+1, b,b+1,a+1);
  }
  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

function geoExtrude(rings, height, color) {
  const flatCoords=[], holeIndices=[];
  let ptOff=0;
  for(let r=0;r<rings.length;r++){
    if(r>0)holeIndices.push(ptOff);
    for(const p of rings[r]){flatCoords.push(p.x*UNIT,p.y*UNIT);}
    ptOff+=rings[r].length;
  }
  const tri=earcut(flatCoords,holeIndices.length?holeIndices:undefined);
  const pos=[],nrm=[],col=[],idx=[];
  const nPts=flatCoords.length/2;
  // bottom
  for(let i=0;i<nPts;i++){pos.push(flatCoords[i*2],0,flatCoords[i*2+1]);nrm.push(0,-1,0);col.push(...color);}
  // top
  for(let i=0;i<nPts;i++){pos.push(flatCoords[i*2],height,flatCoords[i*2+1]);nrm.push(0,1,0);col.push(...color);}
  for(let i=0;i<tri.length;i+=3)idx.push(tri[i],tri[i+2],tri[i+1]); // bottom CCW→CW for -Y
  for(let i=0;i<tri.length;i+=3)idx.push(nPts+tri[i],nPts+tri[i+1],nPts+tri[i+2]); // top reversed for +Y
  // sides
  for(const ring of rings){
    const n=ring.length;
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      const ax=ring[i].x*UNIT,az=ring[i].y*UNIT,bx=ring[j].x*UNIT,bz=ring[j].y*UNIT;
      const ex=bx-ax,ez=bz-az,l=Math.hypot(ex,ez)||1;
      const nx=ez/l,nz=-ex/l;
      const base=pos.length/3;
      pos.push(ax,0,az);nrm.push(nx,0,nz);col.push(...color);
      pos.push(bx,0,bz);nrm.push(nx,0,nz);col.push(...color);
      pos.push(bx,height,bz);nrm.push(nx,0,nz);col.push(...color);
      pos.push(ax,height,az);nrm.push(nx,0,nz);col.push(...color);
      idx.push(base,base+1,base+2, base,base+2,base+3);
    }
  }
  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

function geoShape(rings, color, y) {
  const flatCoords=[], holeIndices=[];
  let ptOff=0;
  for(let r=0;r<rings.length;r++){
    if(r>0)holeIndices.push(ptOff);
    for(const p of rings[r]){flatCoords.push(p.x*UNIT,p.y*UNIT);}
    ptOff+=rings[r].length;
  }
  const tri=earcut(flatCoords,holeIndices.length?holeIndices:undefined);
  const pos=[],nrm=[],col=[];
  const nPts=flatCoords.length/2;
  for(let i=0;i<nPts;i++){pos.push(flatCoords[i*2],y,flatCoords[i*2+1]);nrm.push(0,1,0);col.push(...color);}
  // Reverse winding for +Y normal (CCW in XZ gives -Y, so flip)
  const idx=[];
  for(let i=0;i<tri.length;i+=3)idx.push(tri[i],tri[i+2],tri[i+1]);
  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

// ── Mesh creation & management ────────────────────────────
function createMesh(geo, modelMatrix, opts={}) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const n = geo.positions.length / 3;
  const interleaved = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    interleaved[i*9]   = geo.positions[i*3];
    interleaved[i*9+1] = geo.positions[i*3+1];
    interleaved[i*9+2] = geo.positions[i*3+2];
    interleaved[i*9+3] = geo.normals[i*3];
    interleaved[i*9+4] = geo.normals[i*3+1];
    interleaved[i*9+5] = geo.normals[i*3+2];
    interleaved[i*9+6] = geo.colors[i*3];
    interleaved[i*9+7] = geo.colors[i*3+1];
    interleaved[i*9+8] = geo.colors[i*3+2];
  }
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);

  const stride = 36;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {
    vao, vbo, ibo,
    indexCount: geo.indices.length,
    modelMatrix: new Float32Array(modelMatrix),
    dynamic: opts.dynamic ?? false,
    overlay: opts.overlay ?? false,
    castShadow: opts.castShadow ?? true,
    receiveShadow: opts.receiveShadow ?? true,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1.0,
    wallId: opts.wallId ?? null,
    openingId: opts.openingId ?? null,
    hitOnly: opts.hitOnly ?? false,
    halfExtents: opts.halfExtents ?? null,
    floorId: opts.floorId ?? null,
    floorY: opts.floorY ?? 0,
    emissive: 0,
  };
}

function addSceneMesh(geo, modelMatrix, opts={}) {
  const mesh = createMesh(geo, modelMatrix, opts);
  sceneMeshes.push(mesh);
  return mesh;
}

function clearDynamic() {
  for (let i = sceneMeshes.length - 1; i >= 0; i--) {
    if (sceneMeshes[i].dynamic) {
      const m = sceneMeshes[i];
      gl.deleteVertexArray(m.vao);
      gl.deleteBuffer(m.vbo);
      gl.deleteBuffer(m.ibo);
      sceneMeshes.splice(i, 1);
    }
  }
}

function clearOverlay() {
  for (let i = sceneMeshes.length - 1; i >= 0; i--) {
    if (sceneMeshes[i].overlay) {
      const m = sceneMeshes[i];
      gl.deleteVertexArray(m.vao);
      gl.deleteBuffer(m.vbo);
      gl.deleteBuffer(m.ibo);
      sceneMeshes.splice(i, 1);
    }
  }
}

function addOverlayBox(cx, cy, cz, bw, bh, bd, color, opts={}) {
  const fc = Array(6).fill(color);
  const geo = geoBox(bw, bh, bd, fc);
  const model = m4();
  m4Translate(model, model, cx, cy, cz);
  return addSceneMesh(geo, model, { overlay: true, castShadow: false, receiveShadow: false, ...opts });
}

// ── Shadow map ────────────────────────────────────────────
function initShadowMap() {
  shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  shadowFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const lv = m4(), lp = m4();
  m4LookAt(lv, [12,22,10], [0,0,0], [0,1,0]);
  m4Ortho(lp, -25,25,-25,25,0.5,80);
  m4Mul(lightVP, lp, lv);
}

// ── Grid ──────────────────────────────────────────────────
function initGrid() {
  const verts = [];
  for (let i = -60; i <= 60; i++) {
    const t = i * 0.5;
    verts.push(t, 0.001, -30, t, 0.001, 30);
    verts.push(-30, 0.001, t, 30, 0.001, t);
  }
  gridVertCount = verts.length / 3;
  gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// ── Render ────────────────────────────────────────────────
const FOG_COLOR = hexToRGB(0xf0ebe3);
const FOG_NEAR = 25, FOG_FAR = 60;
const SUN_POS = [12,22,10];
const SUN_DIR = (()=>{const l=Math.hypot(...SUN_POS);return SUN_POS.map(v=>v/l);})();
const SUN_COL = hexToRGB(0xfff4e0).map(v=>v*0.45);
const FILL_DIR = (()=>{const p=[-8,10,-5],l=Math.hypot(...p);return p.map(v=>v/l);})();
const FILL_COL = hexToRGB(0xd0e8ff).map(v=>v*0.1);
const AMBIENT = hexToRGB(0xffffff).map(v=>v*0.35);

function renderShadowPass() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
  gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(shadowProg);
  gl.uniformMatrix4fv(shadowU.uLightVP, false, lightVP);
  for (const mesh of sceneMeshes) {
    if (!mesh.castShadow || mesh.hitOnly) continue;
    gl.uniformMatrix4fv(shadowU.uModel, false, mesh.modelMatrix);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function renderMainPass() {
  const c = canvas3d;
  gl.viewport(0, 0, c.width, c.height);
  gl.clearColor(...FOG_COLOR, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Grid
  gl.useProgram(lineProg);
  const vp = m4(); m4Mul(vp, projMat, viewMat);
  gl.uniformMatrix4fv(lineU.uVP, false, vp);
  gl.uniformMatrix4fv(lineU.uView, false, viewMat);
  gl.uniform3fv(lineU.uColor, hexToRGB(0xe8e4dc));
  gl.uniform3fv(lineU.uFogCol, FOG_COLOR);
  gl.uniform1f(lineU.uFogNear, FOG_NEAR);
  gl.uniform1f(lineU.uFogFar, FOG_FAR);
  gl.bindVertexArray(gridVao);
  gl.drawArrays(gl.LINES, 0, gridVertCount);

  // Main meshes
  gl.useProgram(mainProg);
  gl.uniformMatrix4fv(mainU.uView, false, viewMat);
  gl.uniformMatrix4fv(mainU.uProj, false, projMat);
  gl.uniformMatrix4fv(mainU.uLightVP, false, lightVP);
  gl.uniform3fv(mainU.uSunDir, SUN_DIR);
  gl.uniform3fv(mainU.uSunCol, SUN_COL);
  gl.uniform3fv(mainU.uFillDir, FILL_DIR);
  gl.uniform3fv(mainU.uFillCol, FILL_COL);
  gl.uniform3fv(mainU.uAmbient, AMBIENT);
  gl.uniform3fv(mainU.uFogCol, FOG_COLOR);
  gl.uniform1f(mainU.uFogNear, FOG_NEAR);
  gl.uniform1f(mainU.uFogFar, FOG_FAR);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.uniform1i(mainU.uShadowMap, 0);

  // Opaque pass
  gl.disable(gl.BLEND);
  for (const mesh of sceneMeshes) {
    if (mesh.transparent || mesh.hitOnly) continue;
    gl.uniformMatrix4fv(mainU.uModel, false, mesh.modelMatrix);
    gl.uniform1f(mainU.uEmissive, mesh.emissive ?? 0);
    gl.uniform1f(mainU.uOpacity, 1.0);
    gl.uniform3fv(mainU.uTintCol, mesh.tintCol ?? [0,0,0]);
    gl.uniform1f(mainU.uTintAmt, mesh.tintAmt ?? 0);
    gl.uniform1f(mainU.uFlash, mesh.flash ?? 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }

  // Transparent pass
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  for (const mesh of sceneMeshes) {
    if (!mesh.transparent || mesh.hitOnly) continue;
    gl.uniformMatrix4fv(mainU.uModel, false, mesh.modelMatrix);
    gl.uniform1f(mainU.uEmissive, mesh.emissive ?? 0);
    gl.uniform1f(mainU.uOpacity, mesh.opacity);
    gl.uniform3fv(mainU.uTintCol, mesh.tintCol ?? [0,0,0]);
    gl.uniform1f(mainU.uTintAmt, mesh.tintAmt ?? 0);
    gl.uniform1f(mainU.uFlash, mesh.flash ?? 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function render3D() {
  buildViewMatrix(viewMat);
  m4Perspective(projMat, Math.PI/3, canvas3d.width/canvas3d.height, 0.1, 200);
  renderShadowPass();
  renderMainPass();
}

// ── Raycasting ────────────────────────────────────────────
function screenToRay(clientX, clientY) {
  const rect = canvas3d.getBoundingClientRect();
  const ndcX = ((clientX-rect.left)/rect.width)*2-1;
  const ndcY = -((clientY-rect.top)/rect.height)*2+1;
  const ivp = m4(), vp = m4();
  m4Mul(vp, projMat, viewMat);
  m4Invert(ivp, vp);
  const near = m4TransformPt(ivp, ndcX, ndcY, -1);
  const far = m4TransformPt(ivp, ndcX, ndcY, 1);
  const dx=far.x-near.x, dy=far.y-near.y, dz=far.z-near.z;
  const l=Math.hypot(dx,dy,dz);
  return {origin:near, dir:{x:dx/l,y:dy/l,z:dz/l}};
}

function rayAABB(origin, dir, halfEx) {
  let tmin=-1e30, tmax=1e30, hitAxis=-1;
  const o=[origin.x,origin.y,origin.z], d=[dir.x,dir.y,dir.z];
  for(let i=0;i<3;i++){
    if(Math.abs(d[i])<1e-8){if(o[i]<-halfEx[i]||o[i]>halfEx[i])return null;continue;}
    const t1=(-halfEx[i]-o[i])/d[i], t2=(halfEx[i]-o[i])/d[i];
    const tN=Math.min(t1,t2), tF=Math.max(t1,t2);
    if(tN>tmin){tmin=tN;hitAxis=i;}
    tmax=Math.min(tmax,tF);
  }
  if(tmin>tmax||tmax<0)return null;
  if(tmin<0)tmin=tmax;
  const sign=d[hitAxis]>0?-1:1;
  return {t:tmin, axis:hitAxis, sign};
}

function raycastWall(clientX, clientY) {
  const ray = screenToRay(clientX, clientY);
  let closest=null, minDist=Infinity;
  for(const mesh of sceneMeshes){
    if(!mesh.wallId||!mesh.halfExtents)continue;
    const inv=m4();
    m4Invert(inv, mesh.modelMatrix);
    const lo=m4TransformPt(inv, ray.origin.x, ray.origin.y, ray.origin.z);
    const le=m4TransformPt(inv, ray.origin.x+ray.dir.x, ray.origin.y+ray.dir.y, ray.origin.z+ray.dir.z);
    const ld={x:le.x-lo.x, y:le.y-lo.y, z:le.z-lo.z};
    const hit=rayAABB(lo, ld, mesh.halfExtents);
    if(!hit||hit.t>minDist)continue;
    // Local normal → world normal
    const ln=[0,0,0]; ln[hit.axis]=hit.sign;
    const m=mesh.modelMatrix;
    const wn={
      x:m[0]*ln[0]+m[4]*ln[1]+m[8]*ln[2],
      y:m[1]*ln[0]+m[5]*ln[1]+m[9]*ln[2],
      z:m[2]*ln[0]+m[6]*ln[1]+m[10]*ln[2]
    };
    minDist=hit.t;
    closest={wallId:mesh.wallId, worldNormal:wn};
  }
  if(!closest)return null;
  const w=state.walls.find(w=>w.id===closest.wallId);
  if(!w)return null;
  const isH=Math.abs(w.y2-w.y1)<0.001;
  const signX=isH?(w.x2>=w.x1?1:-1):0;
  const signZ=isH?0:(w.y2>=w.y1?1:-1);
  const fnx=-signZ, fnz=signX;
  const dot=closest.worldNormal.x*fnx+closest.worldNormal.z*fnz;
  return {wallId:closest.wallId, side:dot>=0?'front':'back', w};
}

function raycastGroundGrid(clientX, clientY) {
  const ray = screenToRay(clientX, clientY);
  if(Math.abs(ray.dir.y)<0.0001)return null;
  const t=-ray.origin.y/ray.dir.y;
  if(t<0)return null;
  return {
    x:Math.round((ray.origin.x+t*ray.dir.x)/UNIT),
    y:Math.round((ray.origin.z+t*ray.dir.z)/UNIT)
  };
}

function raycastFloor3d(clientX, clientY) {
  const ray = screenToRay(clientX, clientY);
  if (Math.abs(ray.dir.y) < 0.0001) return null;
  let closest = null, minT = Infinity;
  for (const mesh of sceneMeshes) {
    if (!mesh.floorId) continue;
    const y = mesh.floorY ?? 0;
    const t = (y - ray.origin.y) / ray.dir.y;
    if (t < 0 || t >= minT) continue;
    const hx = (ray.origin.x + t * ray.dir.x) / UNIT;
    const hz = (ray.origin.z + t * ray.dir.z) / UNIT;
    const fl = state.floors3d.find(f => f.id === mesh.floorId);
    if (!fl?.rings?.[0]) continue;
    if (pointInPoly(hx, hz, fl.rings[0])) { minT = t; closest = fl; }
  }
  return closest;
}

// ══════════════════════════════════════════════════════════════
// ── FPS CAMERA ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const cam = { yaw: Math.PI / 4, pitch: -0.4, pos: {x:8, y:6, z:8} };
const keys = {};
let spaceDown = false;
let shiftDown = false;
let fpsMode      = false;
let paintFlashUntil = 0; // timestamp ms
let paintFlashWallId = null;
let paintFlashFloorId = null;
let wallPlaceFlashUntil = 0;
let wallPlaceFlashId = null;
let hoverPt3d = null; // {x,y} grid point under cursor in 3D wall mode
let openingPlaceFlashUntil = 0;
let openingPlaceFlashWallId = null;
let hoverOpening3d  = null; // { wallId, wallObj, left, width, height, fromFloor, type, cx, cz, isH }
let hoverInspect3d  = null; // { type, id, wallId } — for 'select' tool hover
let collisionOn  = false;

const EYE_HEIGHT = 1.65;

function inputFocused() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function updateCamera() {
  // View matrix computed each frame in render3D
}

function updateCameraMovement(dt) {
  const SPEED = 5, TURN = 1.5;
  const fwd = {
    x: Math.cos(cam.pitch) * Math.sin(cam.yaw),
    y: Math.sin(cam.pitch),
    z: -Math.cos(cam.pitch) * Math.cos(cam.yaw)
  };
  const right = { x: Math.cos(cam.yaw), y: 0, z: Math.sin(cam.yaw) };

  if (fpsMode) {
    const fwdFlat = { x: Math.sin(cam.yaw), y: 0, z: -Math.cos(cam.yaw) };
    if (keys['KeyW'] || keys['ArrowUp'])    v3addScaled(cam.pos, fwdFlat,  SPEED * dt);
    if (keys['KeyS'] || keys['ArrowDown'])  v3addScaled(cam.pos, fwdFlat, -SPEED * dt);
    if (keys['KeyA'] || keys['ArrowLeft'])  v3addScaled(cam.pos, right,   -SPEED * dt);
    if (keys['KeyD'] || keys['ArrowRight']) v3addScaled(cam.pos, right,    SPEED * dt);
    if (keys['KeyQ'])                       cam.yaw += TURN * dt;
    if (keys['KeyE'])                       cam.yaw -= TURN * dt;
    cam.pos.y = EYE_HEIGHT;
  } else {
    if (keys['KeyW']     || keys['ArrowUp'])    v3addScaled(cam.pos, fwd,    SPEED * dt);
    if (keys['KeyS']     || keys['ArrowDown'])  v3addScaled(cam.pos, fwd,   -SPEED * dt);
    if (keys['KeyA']     || keys['ArrowLeft'])  v3addScaled(cam.pos, right, -SPEED * dt);
    if (keys['KeyD']     || keys['ArrowRight']) v3addScaled(cam.pos, right,  SPEED * dt);
    if (keys['KeyX'])                           cam.pos.y += SPEED * dt;
    if (keys['KeyZ'])                           cam.pos.y -= SPEED * dt;
    if (keys['KeyQ'])                           cam.yaw   += TURN  * dt;
    if (keys['KeyE'])                           cam.yaw   -= TURN  * dt;
    cam.pos.y = Math.max(0.5, cam.pos.y);
  }
  if (collisionOn) resolveCollision();
  updateCamera();
}

// ── INSPECTOR ─────────────────────────────────────────────
const inspectorEl    = document.getElementById('inspector');
const inspectorTitle = document.getElementById('inspector-title');
const inspectorBody  = document.getElementById('inspector-body');

document.getElementById('inspector-close').addEventListener('click', hideInspector);

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') hideInspector();
});

document.addEventListener('mousedown', (e) => {
  if (!inspectorEl.classList.contains('hidden') && !inspectorEl.contains(e.target)) {
    // Don't hide on canvas clicks in select mode — the click handler toggles
    const onCanvas = e.target === canvas2d || e.target === canvas3d;
    if (!(onCanvas && state.tool === 'select')) hideInspector();
  }
});

let _inspectorCurrentId = null;

function hideInspector() {
  inspectorEl.classList.add('hidden');
  _inspectorCurrentId = null;
}

function showInspector(type, id, clientX, clientY) {
  if (_inspectorCurrentId === id && !inspectorEl.classList.contains('hidden')) {
    hideInspector();
    return;
  }
  _inspectorCurrentId = id;
  inspectorEl.classList.remove('hidden');

  let title, fields;
  if (type === 'wall') {
    const w = state.walls.find(w => w.id === id);
    if (!w) return;
    const floorIdx = w.floor ?? 0;
    const fd = state.floorDefs[floorIdx] ?? state.floorDefs[0];
    const currentH = w.wallHeight ?? fd.wallHeight;
    title  = 'Vägg';
    fields = [
      { label: 'Höjd', value: currentH.toFixed(2), min: '1.0', max: '6.0', step: '0.1', unit: 'm',
        onChange: v => { w.wallHeight = v; state.dirty3d = true; scheduleSave(); }
      },
    ];
  } else if (type === 'opening') {
    const op = state.openings.find(op => op.id === id);
    if (!op) return;
    if (op.type === 'door') {
      title  = 'Dörr';
      fields = [
        { label: 'Bredd', value: (op.width * UNIT).toFixed(2), min: '0.5', max: '4.0', step: '0.1', unit: 'm',
          onChange: v => { op.width = v / UNIT; state.dirty3d = true; scheduleSave(); }
        },
        { label: 'Höjd', value: (op.height * UNIT).toFixed(2), min: '1.0', max: '3.0', step: '0.1', unit: 'm',
          onChange: v => { op.height = v / UNIT; state.dirty3d = true; scheduleSave(); }
        },
      ];
    } else {
      title  = 'Fönster';
      fields = [
        { label: 'Bredd', value: (op.width * UNIT).toFixed(2), min: '0.5', max: '4.0', step: '0.1', unit: 'm',
          onChange: v => { op.width = v / UNIT; state.dirty3d = true; scheduleSave(); }
        },
        { label: 'Höjd', value: (op.height * UNIT).toFixed(2), min: '0.5', max: '3.0', step: '0.1', unit: 'm',
          onChange: v => { op.height = v / UNIT; state.dirty3d = true; scheduleSave(); }
        },
        { label: 'Från golv', value: (op.fromFloor * UNIT).toFixed(2), min: '0.0', max: '2.5', step: '0.1', unit: 'm',
          onChange: v => { op.fromFloor = v / UNIT; state.dirty3d = true; scheduleSave(); }
        },
      ];
    }
  } else {
    return;
  }

  inspectorTitle.textContent = title;
  inspectorBody.innerHTML = '';
  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const lbl = document.createElement('span');
    lbl.className = 'setting-label';
    lbl.textContent = f.label;

    const inp = document.createElement('input');
    inp.type  = 'number';
    inp.value = f.value;
    inp.min   = f.min;
    inp.max   = f.max;
    inp.step  = f.step;
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) f.onChange(v);
    });

    const unit = document.createElement('span');
    unit.className = 'setting-unit';
    unit.textContent = f.unit;

    row.appendChild(lbl);
    row.appendChild(inp);
    row.appendChild(unit);
    inspectorBody.appendChild(row);
  }

  // Position near click, keep within viewport (deferred so DOM has rendered)
  inspectorEl.style.left = '0px';
  inspectorEl.style.top  = '0px';
  requestAnimationFrame(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const dw = inspectorEl.offsetWidth  || 200;
    const dh = inspectorEl.offsetHeight || 120;
    let x = clientX + 12, y = clientY - 12;
    if (x + dw > W - 8) x = clientX - dw - 12;
    if (y + dh > H - 8) y = H - dh - 8;
    if (y < 8)          y = 8;
    if (x < 8)          x = 8;
    inspectorEl.style.left = x + 'px';
    inspectorEl.style.top  = y + 'px';
  });
}

function raycastForInspector(clientX, clientY) {
  const ray = screenToRay(clientX, clientY);
  let closest = null, minDist = Infinity;
  for (const mesh of sceneMeshes) {
    if (!mesh.halfExtents) continue;
    const hasTarget = mesh.wallId || mesh.openingId;
    if (!hasTarget) continue;
    const inv = m4();
    m4Invert(inv, mesh.modelMatrix);
    const lo = m4TransformPt(inv, ray.origin.x, ray.origin.y, ray.origin.z);
    const le = m4TransformPt(inv, ray.origin.x+ray.dir.x, ray.origin.y+ray.dir.y, ray.origin.z+ray.dir.z);
    const ld = {x:le.x-lo.x, y:le.y-lo.y, z:le.z-lo.z};
    const hit = rayAABB(lo, ld, mesh.halfExtents);
    if (!hit || hit.t > minDist) continue;
    minDist = hit.t;
    closest = { wallId: mesh.wallId, openingId: mesh.openingId, t: hit.t };
  }
  if (!closest) return null;

  // Direct opening hit (glass or door hit-target)
  if (closest.openingId) {
    const op = state.openings.find(op => op.id === closest.openingId);
    if (op) return { type: 'opening', id: op.id, wallId: closest.wallId ?? op.wallId };
  }

  const w = state.walls.find(w => w.id === closest.wallId);
  if (!w) return null;

  // World hit position
  const hx = ray.origin.x + closest.t * ray.dir.x;
  const hy = ray.origin.y + closest.t * ray.dir.y;
  const hz = ray.origin.z + closest.t * ray.dir.z;

  // Project onto wall axis to find position along wall and height above floor
  const wdx = w.x2 - w.x1, wdz = w.y2 - w.y1;
  const wallLen = Math.hypot(wdx, wdz);
  if (wallLen > 0.001) {
    const ax = wdx / wallLen, az = wdz / wallLen;
    const posAlongWall = (hx / UNIT - w.x1) * ax + (hz / UNIT - w.y1) * az;
    const yOff = floorYOffset(w.floor ?? 0);
    const heightAboveFloor = hy - yOff;
    for (const op of state.openings) {
      if (op.wallId !== w.id) continue;
      if (posAlongWall >= op.left - 0.15 && posAlongWall <= op.left + op.width + 0.15) {
        const opBottom = op.fromFloor * UNIT;
        const opTop    = (op.fromFloor + op.height) * UNIT;
        if (heightAboveFloor >= opBottom - 0.15 && heightAboveFloor <= opTop + 0.15)
          return { type: 'opening', id: op.id, wallId: w.id };
      }
    }
  }
  return { type: 'wall', id: w.id, wallId: w.id };
}

function setup3DControls() {
  const el = canvas3d;
  let rmb = false;
  let spacePanActive = false;

  el.addEventListener('mousedown', (e) => {
    el.focus();
    if (e.button === 2) {
      if (state.tool === 'wall' && state.wallStart) {
        state.wallStart = null; updateStatus(); e.preventDefault(); return;
      }
      el.requestPointerLock({ unadjustedMovement: true }); e.preventDefault();
    }
    if (e.button === 0 && (spaceDown || state.tool === 'pan')) spacePanActive = true;
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === el) rmb = true;
    else rmb = false;
  });

  window.addEventListener('mousemove', (e) => {
    if (rmb && document.pointerLockElement === el) {
      cam.yaw   += e.movementX * 0.003;
      cam.pitch -= e.movementY * 0.003;
      cam.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, cam.pitch));
      updateCamera();
    }
    if (spacePanActive && (e.buttons & 1)) {
      const r = { x: Math.cos(cam.yaw), y: 0, z: -Math.sin(cam.yaw) };
      v3addScaled(cam.pos, r, -e.movementX * 0.02);
      cam.pos.y += e.movementY * 0.02;
      updateCamera();
    }
  });

  const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','KeyZ','KeyX']);

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) { rmb = false; document.exitPointerLock(); saveSession(); }
    if (e.button === 0) { if (spacePanActive) saveSession(); spacePanActive = false; }
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const speed = 0.01;
    const fwd = {
      x: Math.cos(cam.pitch) * Math.sin(cam.yaw),
      y: Math.sin(cam.pitch),
      z: -Math.cos(cam.pitch) * Math.cos(cam.yaw)
    };
    v3addScaled(cam.pos, fwd, -e.deltaY * speed);
    if (!fpsMode) cam.pos.y = Math.max(0.5, cam.pos.y);
    updateCamera();
    saveSession();
  }, { passive: false });

  el.addEventListener('mousemove', (e) => {
    if (state.tool === 'paint') {
      const hit = raycastWall(e.clientX, e.clientY);
      state.hoverWall3d = hit ? { wallId: hit.wallId, side: hit.side } : null;
      state.hoverFloor3d = null;
      hoverPt3d = null; hoverOpening3d = null;
    } else if (state.tool === 'floor3d') {
      state.hoverWall3d = null;
      const fl = raycastFloor3d(e.clientX, e.clientY);
      state.hoverFloor3d = fl ? fl.id : null;
      hoverPt3d = null; hoverOpening3d = null;
    } else if (state.tool === 'wall') {
      state.hoverWall3d = null; state.hoverFloor3d = null;
      hoverPt3d = raycastGroundGrid(e.clientX, e.clientY);
      hoverOpening3d = null;
    } else if (state.tool === 'door' || state.tool === 'window') {
      state.hoverWall3d = null; state.hoverFloor3d = null; hoverPt3d = null;
      const hit = raycastWall(e.clientX, e.clientY);
      if (hit) {
        const w = hit.w;
        const s = getOpeningSettings();
        const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        // Find hit point in world, project onto wall axis
        const ray = screenToRay(e.clientX, e.clientY);
        const yOff = floorYOffset(w.floor ?? 0);
        // Use AABB hit to get world point along wall
        const ax = (w.x2 - w.x1) / wallLen, az = (w.y2 - w.y1) / wallLen;
        let hitAlongWall = wallLen / 2;
        let bestT = Infinity;
        for (const mesh of sceneMeshes) {
          if (mesh.wallId !== w.id || !mesh.halfExtents) continue;
          const inv = m4();
          m4Invert(inv, mesh.modelMatrix);
          const lo = m4TransformPt(inv, ray.origin.x, ray.origin.y, ray.origin.z);
          const le = m4TransformPt(inv, ray.origin.x+ray.dir.x, ray.origin.y+ray.dir.y, ray.origin.z+ray.dir.z);
          const ld = {x:le.x-lo.x, y:le.y-lo.y, z:le.z-lo.z};
          const aabbHit = rayAABB(lo, ld, mesh.halfExtents);
          if (aabbHit && aabbHit.t < bestT) {
            bestT = aabbHit.t;
            const wx = ray.origin.x + aabbHit.t * ray.dir.x;
            const wz = ray.origin.z + aabbHit.t * ray.dir.z;
            hitAlongWall = (wx / UNIT - w.x1) * ax + (wz / UNIT - w.y1) * az;
          }
        }
        // Snap center of opening to hit, clamp
        let left = Math.max(0, Math.min(wallLen - s.width, Math.round((hitAlongWall - s.width / 2) * 2) / 2));
        // Push left out of any existing opening on this wall
        const existingOps = state.openings.filter(op => op.wallId === w.id);
        for (const op of existingOps) {
          if (left < op.left + op.width && left + s.width > op.left) {
            // Overlap: snap to whichever side is closer
            const toLeft  = op.left - s.width;
            const toRight = op.left + op.width;
            if (Math.abs(hitAlongWall - (toLeft + s.width/2)) < Math.abs(hitAlongWall - (toRight + s.width/2)))
              left = Math.max(0, toLeft);
            else
              left = Math.min(wallLen - s.width, toRight);
          }
        }
        const midG = left + s.width / 2;
        hoverOpening3d = {
          wallId: w.id, wallObj: w, left, ...s,
          cx: (w.x1 + ax * midG) * UNIT,
          cz: (w.y1 + az * midG) * UNIT,
          yOff,
        };
      } else {
        hoverOpening3d = null;
      }
    } else if (state.tool === 'select') {
      state.hoverWall3d = null; state.hoverFloor3d = null;
      hoverPt3d = null; hoverOpening3d = null;
      hoverInspect3d = raycastForInspector(e.clientX, e.clientY);
    } else {
      state.hoverWall3d = null; state.hoverFloor3d = null;
      hoverPt3d = null; hoverOpening3d = null;
      hoverInspect3d = null;
    }
  });

  el.addEventListener('click', (e) => {
    if (state.tool === 'paint') {
      const hit = raycastWall(e.clientX, e.clientY);
      const color = document.getElementById('wall-color').value;
      if (!hit) return;
      const w = hit.w;
      if (wallRemoveMode) {
        if (hit.side === 'front') w.colorFront = null;
        else                      w.colorBack  = null;
      } else {
        if (hit.side === 'front') w.colorFront = color;
        else                      w.colorBack  = color;
        addToRecent(color, wallRecent); refreshWallPalette();
      }
      paintFlashUntil = performance.now() + 200;
      paintFlashWallId = hit.wallId;
      paintFlashFloorId = null;
      state.dirty3d = true;
      scheduleSave();
      return;
    }
    if (state.tool === 'floor3d') {
      const fl = raycastFloor3d(e.clientX, e.clientY);
      if (fl) {
        const color = document.getElementById('floor3d-color').value;
        fl.color = color;
        addToRecent(color, floorRecent); refreshFloorPalette();
        paintFlashUntil = performance.now() + 200;
        paintFlashFloorId = fl.id;
        paintFlashWallId = null;
        state.dirty3d = true;
        scheduleSave();
      }
      return;
    }
    if (state.tool === 'door' || state.tool === 'window') {
      if (hoverOpening3d) {
        const h = hoverOpening3d;
        state.openings.push({ id: state.nextId++, wallId: h.wallId, left: h.left, width: h.width, height: h.height, fromFloor: h.fromFloor, type: h.type });
        openingPlaceFlashUntil = performance.now() + 300;
        openingPlaceFlashWallId = h.wallId;
        state.dirty3d = true;
        scheduleSave();
      }
      return;
    }
    if (state.tool === 'select') {
      const hit = raycastForInspector(e.clientX, e.clientY);
      if (hit) showInspector(hit.type, hit.id, e.clientX, e.clientY);
      else hideInspector();
      return;
    }
    if (state.tool !== 'wall') return;
    const gpt = raycastGroundGrid(e.clientX, e.clientY);
    if (!gpt) return;
    if (!state.wallStart) {
      state.wallStart = { ...gpt };
    } else {
      const end = wallEnd(state.wallStart, gpt);
      if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
        addWall(state.wallStart.x, state.wallStart.y, end.x, end.y, state.activeFloor);
        wallPlaceFlashId = state.walls[state.walls.length - 1]?.id ?? null;
        state.wallStart = { ...end };
        state.dirty3d   = true;
        wallPlaceFlashUntil = performance.now() + 250;
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

// ══════════════════════════════════════════════════════════════
// ── 3D SCENE ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function addBoxMesh(cx, cy, cz, bw, bh, bd, color, opts={}) {
  const fc = Array(6).fill(color);
  const geo = geoBox(bw, bh, bd, fc);
  const model = m4();
  m4Translate(model, model, cx, cy, cz);
  if (opts.rotY) m4RotateY(model, model, opts.rotY);
  if (opts.scaleY !== undefined) m4Scale(model, model, 1, opts.scaleY, 1);
  return addSceneMesh(geo, model, { dynamic: true, castShadow: true, receiveShadow: true, ...opts });
}

// Build extruded wall geometry from 4 XZ corners + height
// corners: [startLeft, startRight, endRight, endLeft] each {x,z}
// yBot/yTop: vertical extent
// frontCol/backCol/capCol: colors for left side, right side, and everything else
// skipStartCap/skipEndCap: omit perpendicular end faces (used at T-junctions, buried inside other walls)
function geoWallShape(sl, sr, er, el, yBot, yTop, frontCol, backCol, capCol, skipStartCap=false, skipEndCap=false) {
  const pos=[], nrm=[], col=[], idx=[];
  const yb=yBot, yt=yTop;
  // wall direction for normals
  const edx=((el.x+er.x)-(sl.x+sr.x))/2, edz=((el.z+er.z)-(sl.z+sr.z))/2;
  const elen=Math.hypot(edx,edz)||1;
  const nx=-edz/elen, nz=edx/elen; // left-side normal

  function quad(a,b,c,d,n,color){
    const base=pos.length/3;
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, d.x,d.y,d.z);
    for(let i=0;i<4;i++){nrm.push(n.x,n.y,n.z);col.push(...color);}
    idx.push(base,base+1,base+2, base,base+2,base+3);
  }

  // Front (left side): sl → el
  quad({x:sl.x,y:yb,z:sl.z},{x:el.x,y:yb,z:el.z},{x:el.x,y:yt,z:el.z},{x:sl.x,y:yt,z:sl.z},{x:nx,y:0,z:nz},frontCol);
  // Back (right side): er → sr
  quad({x:er.x,y:yb,z:er.z},{x:sr.x,y:yb,z:sr.z},{x:sr.x,y:yt,z:sr.z},{x:er.x,y:yt,z:er.z},{x:-nx,y:0,z:-nz},backCol);
  // Top
  quad({x:sl.x,y:yt,z:sl.z},{x:el.x,y:yt,z:el.z},{x:er.x,y:yt,z:er.z},{x:sr.x,y:yt,z:sr.z},{x:0,y:1,z:0},capCol);
  // Bottom
  quad({x:sl.x,y:yb,z:sl.z},{x:sr.x,y:yb,z:sr.z},{x:er.x,y:yb,z:er.z},{x:el.x,y:yb,z:el.z},{x:0,y:-1,z:0},capCol);
  // Start cap: sr → sl
  if (!skipStartCap) {
    const sn={x:-(sl.z-sr.z),y:0,z:sl.x-sr.x};
    const snl=Math.hypot(sn.x,sn.z)||1; sn.x/=snl; sn.z/=snl;
    if(sn.x*(-edx)+sn.z*(-edz)<0){sn.x=-sn.x;sn.z=-sn.z;}
    quad({x:sr.x,y:yb,z:sr.z},{x:sl.x,y:yb,z:sl.z},{x:sl.x,y:yt,z:sl.z},{x:sr.x,y:yt,z:sr.z},sn,capCol);
  }
  // End cap: el → er
  if (!skipEndCap) {
    const en={x:-(er.z-el.z),y:0,z:er.x-el.x};
    const enl=Math.hypot(en.x,en.z)||1; en.x/=enl; en.z/=enl;
    if(en.x*edx+en.z*edz<0){en.x=-en.x;en.z=-en.z;}
    quad({x:el.x,y:yb,z:el.z},{x:er.x,y:yb,z:er.z},{x:er.x,y:yt,z:er.z},{x:el.x,y:yt,z:el.z},en,capCol);
  }

  return {positions:new Float32Array(pos),normals:new Float32Array(nrm),colors:new Float32Array(col),indices:new Uint32Array(idx)};
}

// Compute miter shift at a wall endpoint.
// Returns sL: the shift for the left-side vertex along the wall's outgoing direction from P.
// Right-side vertex shifts by -sL.
function getMiterShift(px, pz, outDirX, outDirZ, wallId, floor) {
  const t = WALL_T / 2;
  const nWx = -outDirZ, nWz = outDirX; // left perp
  const neighbors = state.walls.filter(o => {
    if (o.id === wallId || (o.floor ?? 0) !== floor) return false;
    return (o.x1 === px && o.y1 === pz) || (o.x2 === px && o.y2 === pz);
  });
  if (neighbors.length === 0) return null; // free end — use push-back formula
  if (neighbors.length >= 2) {
    // T/X-junction: check if this wall is collinear with any neighbor
    // (i.e. the neighbor goes the opposite direction — it's the "crossing" wall pair)
    for (const o of neighbors) {
      let dOx, dOz;
      if (o.x1 === px && o.y1 === pz) { dOx = o.x2 - o.x1; dOz = o.y2 - o.y1; }
      else { dOx = o.x1 - o.x2; dOz = o.y1 - o.y2; }
      const oLen = Math.hypot(dOx, dOz); if (oLen < 0.001) continue;
      dOx /= oLen; dOz /= oLen;
      if (outDirX * dOx + outDirZ * dOz < -0.99) return 0; // collinear pair → flat end
    }
    return null; // entering wall → use push-back formula (embeds into crossing wall)
  }
  const o = neighbors[0];
  // Neighbor's direction going OUT from P
  let dOx, dOz;
  if (o.x1 === px && o.y1 === pz) { dOx = o.x2 - o.x1; dOz = o.y2 - o.y1; }
  else { dOx = o.x1 - o.x2; dOz = o.y1 - o.y2; }
  const oLen = Math.hypot(dOx, dOz); if (oLen < 0.001) return null;
  dOx /= oLen; dOz /= oLen;
  const nOx = -dOz, nOz = dOx; // left perp of neighbor
  const det = -outDirX * dOz + dOx * outDirZ;
  if (Math.abs(det) < 0.001) return null; // parallel
  const sL = t * ((nWx + nOx) * dOz - (nWz + nOz) * dOx) / det;
  // Clamp to prevent extreme spikes at near-parallel or very acute angles
  return Math.max(-WALL_T * 3, Math.min(WALL_T * 3, sL));
}

function addWallShapeMesh(sl, sr, er, el, yBot, yTop, frontCol, backCol, capCol, wallId, opts = {}) {
  const geo = geoWallShape(sl, sr, er, el, yBot, yTop, frontCol, backCol, capCol, opts.skipStartCap, opts.skipEndCap);
  const model = m4(); // identity — vertices are already in world space
  // Compute AABB center and half-extents from vertices
  const xs = [sl.x, sr.x, er.x, el.x], zs = [sl.z, sr.z, er.z, el.z];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX+maxX)/2, cy = (yBot+yTop)/2, cz = (minZ+maxZ)/2;
  m4Translate(model, model, cx, cy, cz);
  const halfExtents = [(maxX-minX)/2, (yTop-yBot)/2, (maxZ-minZ)/2];
  // Shift vertices to be centered at origin (so AABB raycasting works with model matrix)
  const p = geo.positions;
  for (let i = 0; i < p.length; i += 3) { p[i] -= cx; p[i+1] -= cy; p[i+2] -= cz; }
  return addSceneMesh(geo, model, { dynamic: true, castShadow: true, receiveShadow: true, wallId, halfExtents });
}


function buildWallMeshes(w, wallColor, yOff, wallH) {
  const dx = (w.x2 - w.x1) * UNIT;
  const dz = (w.y2 - w.y1) * UNIT;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return;

  const wallLen = len / UNIT;
  const floor = w.floor ?? 0;

  // Wall direction (normalized, in grid units)
  const wdx = (w.x2 - w.x1) / wallLen, wdz = (w.y2 - w.y1) / wallLen;
  // Perpendicular (left side when looking from start to end)
  const pnx = -wdz, pnz = wdx;
  const t = WALL_T / 2;

  // Compute miter at each endpoint
  // Direction from P along wall body (toward the other endpoint)
  const miterStart = getMiterShift(w.x1, w.y1, wdx, wdz, w.id, floor);
  const miterEnd   = getMiterShift(w.x2, w.y2, -wdx, -wdz, w.id, floor);

  // Skip end caps at any joined endpoint — cap faces are buried inside other walls.
  // For T-junction entering walls miterStart===null but cap still must be skipped.
  const countNeighbors = (px, pz) => state.walls.filter(o =>
    o.id !== w.id && (o.floor ?? 0) === floor &&
    ((o.x1 === px && o.y1 === pz) || (o.x2 === px && o.y2 === pz))).length;
  const skipStartCap = countNeighbors(w.x1, w.y1) >= 1;
  const skipEndCap   = countNeighbors(w.x2, w.y2) >= 1;
  // Entering wall at T-junction: miterShift===null (no collinear neighbor) but 2+ neighbors
  // The end case reuses the existing free-end formula which already gives the far-side result
  const startIsT = miterStart === null && countNeighbors(w.x1, w.y1) >= 2;

  // Face colors for paint
  const frontCol = w.colorFront ? hexToRGB(w.colorFront) : wallColor;
  const backCol  = w.colorBack  ? hexToRGB(w.colorBack)  : wallColor;

  // Build corner positions for a wall segment between two points along the wall (in grid units from start)
  // "left" = pn side, "right" = -pn side (consistent with wall's own perp, not the dW frame)
  function segCorners(fromG, toG, isWallStart, isWallEnd) {
    const sx = w.x1 * UNIT + wdx * fromG * UNIT;
    const sz = w.y1 * UNIT + wdz * fromG * UNIT;
    const ex = w.x1 * UNIT + wdx * toG * UNIT;
    const ez = w.y1 * UNIT + wdz * toG * UNIT;

    // Start vertices: sL is shift along wallDir for the pn-side vertex
    let slx, slz, srx, srz;
    if (isWallStart && miterStart !== null) {
      // sL shifts the left(pn) vertex along wallDir, right(-pn) shifts by -sL
      slx = sx + pnx*t + wdx*miterStart;
      slz = sz + pnz*t + wdz*miterStart;
      srx = sx - pnx*t - wdx*miterStart;
      srz = sz - pnz*t - wdz*miterStart;
    } else if (isWallStart && startIsT) {
      // T-junction entering wall: start at FAR side of crossing wall (+wallDir by t)
      // so the wall body begins just outside the crossing wall with no overlap
      slx = sx + pnx*t + wdx*t; slz = sz + pnz*t + wdz*t;
      srx = sx - pnx*t + wdx*t; srz = sz - pnz*t + wdz*t;
    } else if (isWallStart) {
      // Free end: extend both sides by t past the grid point (in -wallDir)
      slx = sx + pnx*t - wdx*t; slz = sz + pnz*t - wdz*t;
      srx = sx - pnx*t - wdx*t; srz = sz - pnz*t - wdz*t;
    } else {
      slx = sx + pnx*t; slz = sz + pnz*t;
      srx = sx - pnx*t; srz = sz - pnz*t;
    }

    // End vertices: sL is along -wallDir frame, convert to wallDir frame for pn-side vertex
    let elx, elz, erx, erz;
    if (isWallEnd && miterEnd !== null) {
      // miterEnd was computed with dW = -wallDir, so the pn-side shift along wallDir = +sL*wallDir
      elx = ex + pnx*t + wdx*miterEnd;
      elz = ez + pnz*t + wdz*miterEnd;
      erx = ex - pnx*t - wdx*miterEnd;
      erz = ez - pnz*t - wdz*miterEnd;
    } else if (isWallEnd) {
      elx = ex + pnx*t + wdx*t; elz = ez + pnz*t + wdz*t;
      erx = ex - pnx*t + wdx*t; erz = ez - pnz*t + wdz*t;
    } else {
      elx = ex + pnx*t; elz = ez + pnz*t;
      erx = ex - pnx*t; erz = ez - pnz*t;
    }

    return {
      sl: {x:slx, z:slz}, sr: {x:srx, z:srz},
      el: {x:elx, z:elz}, er: {x:erx, z:erz}
    };
  }

  const wallOpenings = state.openings
    .filter(op => op.wallId === w.id)
    .sort((a, b) => a.left - b.left);

  if (wallOpenings.length === 0) {
    const c = segCorners(0, wallLen, true, true);
    addWallShapeMesh(c.sl, c.sr, c.er, c.el, yOff, yOff + wallH, frontCol, backCol, hexToRGB(0x4a3f35), w.id, { skipStartCap, skipEndCap });
  } else {
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
      const atStart = piece.fromG < 0.001;
      const atEnd   = piece.toG >= wallLen - 0.001;
      const c = segCorners(piece.fromG, piece.toG, atStart, atEnd);
      addWallShapeMesh(c.sl, c.sr, c.er, c.el, yOff + piece.yFrom, yOff + piece.yTo, frontCol, backCol, hexToRGB(0x4a3f35), w.id,
        { skipStartCap: atStart && skipStartCap, skipEndCap: atEnd && skipEndCap });
    }
  }

  const glassCol = hexToRGB(0xadd8e6);
  for (const op of wallOpenings) {
    const opW  = op.width  * UNIT;
    const opH  = op.height * UNIT;
    const midG = op.left + op.width / 2;
    const cx   = w.x1 * UNIT + wdx * midG * UNIT;
    const cz   = w.y1 * UNIT + wdz * midG * UNIT;
    const cy   = yOff + op.fromFloor * UNIT + opH / 2;
    const rotY = Math.atan2(-wdz, wdx);
    if (op.type === 'window') {
      addBoxMesh(cx, cy, cz, opW, opH, 0.02, glassCol, {
        transparent: true, opacity: 0.28, castShadow: false, rotY,
        openingId: op.id, wallId: w.id,
        halfExtents: [opW / 2, opH / 2, 0.01],
      });
    } else {
      // Door: invisible hit-target mesh fills the opening for raycasting
      addBoxMesh(cx, cy, cz, opW, opH, WALL_T * 1.5, [0, 0, 0], {
        hitOnly: true, castShadow: false, rotY,
        openingId: op.id, wallId: w.id,
        halfExtents: [opW / 2, opH / 2, WALL_T * 0.75],
      });
    }
  }
}

function init3D() {
  const container = document.getElementById('view-3d');
  canvas3d = document.createElement('canvas');
  canvas3d.tabIndex = 0;
  container.appendChild(canvas3d);

  gl = canvas3d.getContext('webgl2', { antialias: true });
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  mainProg   = linkProg(MAIN_VS, MAIN_FS);
  shadowProg = linkProg(SHADOW_VS, SHADOW_FS);
  lineProg   = linkProg(LINE_VS, LINE_FS);

  mainU   = getUniforms(mainProg, ['uModel','uView','uProj','uLightVP','uSunDir','uSunCol','uFillDir','uFillCol','uAmbient','uFogCol','uFogNear','uFogFar','uEmissive','uOpacity','uShadowMap','uTintCol','uTintAmt','uFlash']);
  shadowU = getUniforms(shadowProg, ['uModel','uLightVP']);
  lineU   = getUniforms(lineProg, ['uVP','uView','uColor','uFogCol','uFogNear','uFogFar']);

  initShadowMap();
  initGrid();

  // Ground plane
  const groundGeo = geoPlane(60, 60, hexToRGB(0xd8cfc4));
  const groundModel = m4();
  groundMesh = addSceneMesh(groundGeo, groundModel, { castShadow: false, receiveShadow: true });

  resize3D();
  setup3DControls();
}

function rebuild3D() {
  if (!state.dirty3d) return;
  state.dirty3d = false;

  clearDynamic();

  for (const w of state.walls) {
    const floorIdx = w.floor ?? 0;
    const fd       = state.floorDefs[floorIdx] ?? state.floorDefs[0];
    const wallH    = w.wallHeight ?? fd.wallHeight;
    const wallColor = w.color ? hexToRGB(w.color) : hexToRGB(0xf5f0e8);
    const wmx = (w.x1 + w.x2) / 2, wmy = (w.y1 + w.y2) / 2;
    const foundUnder = state.foundations.find(fn => {
      if (!fn.rings?.[0]) return false;
      if (pointInPoly(wmx, wmy, fn.rings[0])) return true;
      for (const ring of fn.rings) {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const a = ring[i], b = ring[(i+1)%n];
          const ex = b.x-a.x, ey = b.y-a.y, len2 = ex*ex+ey*ey;
          if (len2 < 0.0001) continue;
          const t = Math.max(0, Math.min(1, ((wmx-a.x)*ex+(wmy-a.y)*ey)/len2));
          if (Math.hypot(wmx-(a.x+t*ex), wmy-(a.y+t*ey)) < 0.1) return true;
        }
      }
      return false;
    });
    const yOff = floorYOffset(floorIdx) + (foundUnder ? foundUnder.height : 0);
    buildWallMeshes(w, wallColor, yOff, wallH);
  }

  // Floor slabs
  const slabCol = hexToRGB(0xe8e0d4);
  for (let i = 1; i < state.floorDefs.length; i++) {
    const y = floorYOffset(i);
    addBoxMesh(0, y - FLOOR_SLAB_H / 2, 0, 60, FLOOR_SLAB_H, 60, slabCol, { castShadow: false });
  }

  // Stairs
  const stairCol = hexToRGB(0xd4c4a8);
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
      const fc = Array(6).fill(stairCol);
      const geo = geoBox(stepW, stepH * (i + 1), stepD, fc);
      const model = m4();
      m4Translate(model, model, ox, 0, oz);
      m4RotateY(model, model, -angle);
      m4Translate(model, model, 0, yOff + stepH * (i + 1) / 2, (i + 0.5) * stepD);
      addSceneMesh(geo, model, { dynamic: true, castShadow: true, receiveShadow: true });
    }
  }

  // Furniture
  const furnCol = hexToRGB(0xc8a060);
  for (const furn of state.furniture) {
    const w   = Math.abs(furn.x2 - furn.x1) * UNIT;
    const d   = Math.abs(furn.y2 - furn.y1) * UNIT;
    const h   = furn.height;
    const cx  = (furn.x1 + furn.x2) / 2;
    const cz  = (furn.y1 + furn.y2) / 2;
    const foundUnder = state.foundations.find(fn => {
      if (!fn.rings?.[0]) return false;
      if (pointInPoly(cx, cz, fn.rings[0])) return true;
      const ring = fn.rings[0], n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i+1)%n];
        const ex = b.x-a.x, ey = b.y-a.y, len2 = ex*ex+ey*ey;
        if (len2 < 0.0001) continue;
        const t = Math.max(0, Math.min(1, ((cx-a.x)*ex+(cz-a.y)*ey)/len2));
        if (Math.hypot(cx-(a.x+t*ex), cz-(a.y+t*ey)) < 0.1) return true;
      }
      return false;
    });
    const yBase = foundUnder ? foundUnder.height : 0;
    const fc = Array(6).fill(furnCol);
    const geo = geoBox(w, h, d, fc);
    const model = m4();
    m4Translate(model, model, cx * UNIT, yBase + h / 2, cz * UNIT);
    m4RotateY(model, model, (furn.rotation || 0) * Math.PI / 180);
    addSceneMesh(geo, model, { dynamic: true, castShadow: true, receiveShadow: true });
  }

  // Trees / bushes
  for (const t of state.trees) {
    const cx = t.x * UNIT, cz = t.y * UNIT;
    const r  = t.radius * UNIT;
    if (t.type === 'tree') {
      const trunkCol = hexToRGB(0x7a5230);
      const trunkGeo = geoCylinder(0.06, 0.10, 1.2, 6, trunkCol);
      const trunkModel = m4(); m4Translate(trunkModel, trunkModel, cx, 0.6, cz);
      addSceneMesh(trunkGeo, trunkModel, { dynamic: true });

      const canopyCol = hexToRGB(0x3a7a28);
      const canopyGeo = geoSphere(r, 8, 6, canopyCol);
      const canopyModel = m4(); m4Translate(canopyModel, canopyModel, cx, 1.2 + r * 0.7, cz);
      addSceneMesh(canopyGeo, canopyModel, { dynamic: true });
    } else if (t.type === 'bush-square') {
      const bushCol = hexToRGB(0x5a9a3c);
      const side = r * 2;
      addBoxMesh(cx, r * 0.6, cz, side, r * 1.2, side, bushCol);
    } else {
      const bushCol = hexToRGB(0x5a9a3c);
      const bushGeo = geoSphere(r, 8, 5, bushCol);
      const bushModel = m4();
      m4Translate(bushModel, bushModel, cx, r * 0.6, cz);
      m4Scale(bushModel, bushModel, 1, 0.6, 1);
      addSceneMesh(bushGeo, bushModel, { dynamic: true });
    }
  }

  // Foundations
  const foundCol = hexToRGB(0xa08c6e);
  for (const fd of state.foundations) {
    if (!fd.rings?.[0] || fd.rings[0].length < 3) continue;
    const geo = geoExtrude(fd.rings, fd.height, foundCol);
    const model = m4();
    addSceneMesh(geo, model, { dynamic: true, castShadow: true, receiveShadow: true });
  }

  // Legacy fill-floors
  for (const ff of state.fillFloors) {
    const yOff = floorYOffset(ff.floor ?? 0);
    const col = hexToRGB(ff.color);
    for (const c of ff.cells) {
      const geo = geoPlane(UNIT, UNIT, col);
      const model = m4(); m4Translate(model, model, (c.x + 0.5) * UNIT, yOff + 0.003, (c.y + 0.5) * UNIT);
      addSceneMesh(geo, model, { dynamic: true, castShadow: false, receiveShadow: true });
    }
  }

  // Floor surfaces
  for (const fl of state.floors3d) {
    if (!fl.rings?.[0] || fl.rings[0].length < 3) continue;
    const outer = fl.rings[0];
    const fcx = outer.reduce((s,p)=>s+p.x,0)/outer.length;
    const fcz = outer.reduce((s,p)=>s+p.y,0)/outer.length;
    const foundUnder = state.foundations.find(fn => fn.rings?.[0] && pointInPoly(fcx, fcz, fn.rings[0]));
    const yOff = floorYOffset(fl.floor ?? 0) + (foundUnder ? foundUnder.height : 0);
    const col = hexToRGB(fl.color ?? '#c8a46e');
    const geo = geoShape(fl.rings, col, yOff + 0.002);
    const model = m4();
    addSceneMesh(geo, model, { dynamic: true, castShadow: false, receiveShadow: true, floorId: fl.id, floorY: yOff + 0.002 });
  }

  // Gardens
  const gardenCol = hexToRGB(0x4a8c28);
  for (const gd of state.gardens) {
    if (!gd.rings?.[0] || gd.rings[0].length < 3) continue;
    const geo = geoShape(gd.rings, gardenCol, 0.003);
    const model = m4();
    addSceneMesh(geo, model, { dynamic: true, castShadow: false, receiveShadow: true, transparent: true, opacity: 0.7 });
  }
}

function resize3D() {
  const c = document.getElementById('view-3d');
  if (!c.clientWidth || !c.clientHeight || !gl) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas3d.width = c.clientWidth * dpr;
  canvas3d.height = c.clientHeight * dpr;
  canvas3d.style.width = c.clientWidth + 'px';
  canvas3d.style.height = c.clientHeight + 'px';
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
  } else if (state.tool === 'select') {
    const opId = openingHit(mx, my);
    state.hoverOpening = opId;
    state.hoverWall    = opId !== null ? -1 : wallHit(mx, my);
    canvas2d.style.cursor = (opId !== null || state.hoverWall >= 0) ? 'pointer' : 'default';
  } else if (state.tool === 'pan') {
    canvas2d.style.cursor = 'grab';
  } else if (state.tool === 'paint') {
    canvas2d.style.cursor = 'default';
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

  if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey) || (e.button === 0 && (state.tool === 'pan' || state.tool === 'select'))) {
    state.isPanning = true; state.panSX = mx; state.panSY = my;
    if (e.button === 2) state._rightDragDist = 0;
    if (e.button === 0) { state._panStartMx = mx; state._panStartMy = my; }
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
          state.polyPts = [{ ...gpt }];
          updateStatus();
        }
      }
    } else if (state.polyPts.length >= 3 &&
               Math.hypot(gpt.x - state.polyPts[0].x, gpt.y - state.polyPts[0].y) < POLY_SNAP) {
      eraseAreaPolygon([...state.polyPts], state.activeFloor);
      state.polyPts = []; state.dirty3d = true; updateStatus();
    } else {
      const last = state.polyPts[state.polyPts.length - 1];
      const end  = wallEnd(last, gpt);
      if (end.x !== last.x || end.y !== last.y) {
        state.polyPts.push({ ...end });
        updateStatus();
      }
    }

  } else if (state.tool === 'stair') {
    const steps   = parseInt(document.getElementById('stair-steps').value, 10);
    const stepLen = parseFloat(document.getElementById('stair-steplen').value) * 2;
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
      const out = [];
      for (const fd of state.foundations) {
        if (!fd.rings?.[0]) { out.push(fd); continue; }
        if (fd.height === height) { out.push(fd); continue; }
        out.push(...subtractPolyFromCollection([fd], newPts, null));
      }
      state.foundations = out;
      state.foundations.push({ id: state.nextId++, rings: [newPts], height });
      state.foundations = tryMergeCollection(state.foundations, (a, b) => a.height === b.height);
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
        const out = [];
        for (const fl of state.floors3d) {
          if (!fl.rings?.[0] || (fl.floor ?? 0) !== state.activeFloor || fl.color === color) {
            out.push(fl); continue;
          }
          out.push(...subtractPolyFromCollection([fl], newPts, state.activeFloor));
        }
        state.floors3d = out;
        if (state.activeFloor === 0) {
          state.gardens = subtractPolyFromCollection(state.gardens, newPts, null);
        }
        let clippedPts = [newPts];
        if (state.activeFloor === 0 && state.foundations.length > 0) {
          const foundUnion = state.foundations.reduce((acc, fd) => {
            if (!fd.rings?.[0]) return acc;
            const r = polygonClipping.union(acc, toClipPoly(fd.rings));
            return r.length ? r : acc;
          }, [[[]]]);
          const clipped = polygonClipping.intersection([newPts.map(p=>[p.x,p.y])], foundUnion);
          clippedPts = clipped.map(poly => fromClipPoly(poly)[0]);
        }
        for (const pts of clippedPts) {
          if (!pts || pts.length < 3) continue;
          state.floors3d.push({ id: state.nextId++, rings: [pts], color, floor: state.activeFloor });
        }
        state.floors3d = tryMergeCollection(state.floors3d,
          (a, b) => (a.floor ?? 0) === (b.floor ?? 0) && a.color === b.color);
        addToRecent(color, floorRecent); refreshFloorPalette();
      });
    }

  } else if (state.tool === 'garden') {
    polyAddPoint(gpt, () => {
      const newPts = [...state.polyPts];
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

canvas2d.addEventListener('mouseup', (e) => {
  if (e.button === 0 && state.isPanning && state.tool === 'select') {
    const { mx, my } = getCanvasXY(e);
    const dragDist = Math.hypot(mx - state._panStartMx, my - state._panStartMy);
    if (dragDist < 5) {
      const opId = openingHit(mx, my);
      if (opId !== null) {
        showInspector('opening', opId, e.clientX, e.clientY);
      } else {
        const wIdx = wallHit(mx, my);
        if (wIdx >= 0) showInspector('wall', state.walls[wIdx].id, e.clientX, e.clientY);
        else hideInspector();
      }
    }
  }
  if (e.button === 1 || state.isPanning) state.isPanning = false;
});
canvas2d.addEventListener('mouseleave', ()  => { state.hoverPt = null; state.isPanning = false; state.openingPreview = null; });
canvas2d.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  state.isPanning = false;
  if ((state._rightDragDist ?? 0) > 5) { state._rightDragDist = 0; return; }
  state._rightDragDist = 0;
  if (state.tool === 'erase' && state.polyPts.length >= 2) {
    if (state.polyPts.length === 2) {
      const end = wallEnd(state.polyPts[0], state.polyPts[1]);
      eraseWallSegment(state.polyPts[0].x, state.polyPts[0].y, end.x, end.y, state.activeFloor);
    } else {
      eraseAreaPolygon([...state.polyPts], state.activeFloor);
    }
    state.polyPts = []; state.dirty3d = true; updateStatus(); saveSession();
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

    if (tool !== 'select') hoverInspect3d = null;
    const cursors = { pan: 'grab', select: 'default', wall: 'crosshair', erase: 'default', door: 'default', window: 'default', paint: 'default', foundation: 'crosshair', garden: 'crosshair', tree: 'crosshair', floor3d: 'crosshair', furniture: 'crosshair', stair: 'crosshair' };
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
  const R = WALL_T / 2 + 0.15;
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
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;padding:1px 6px;';

    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (i === state.activeFloor ? ' active' : '');
    btn.style.cssText = 'font-size:11px;flex:1;padding:5px 6px;';
    btn.textContent = fd.name;
    btn.addEventListener('click', () => {
      state.activeFloor = i;
      state.wallStart   = null;
      renderFloorSelector();
    });

    const heightInput = document.createElement('input');
    heightInput.type  = 'number';
    heightInput.value = fd.wallHeight;
    heightInput.min   = '1.0';
    heightInput.max   = '6.0';
    heightInput.step  = '0.1';
    heightInput.title = 'Vägghöjd (m)';
    heightInput.style.cssText = 'width:42px;font-size:11px;padding:3px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);text-align:right;';
    heightInput.addEventListener('change', () => {
      const v = parseFloat(heightInput.value);
      if (!isNaN(v) && v >= 1.0 && v <= 6.0) {
        state.floorDefs[i].wallHeight = v;
        state.dirty3d = true;
        saveSession();
      }
    });
    heightInput.addEventListener('click', e => e.stopPropagation());

    const unit = document.createElement('span');
    unit.textContent = 'm';
    unit.style.cssText = 'font-size:11px;color:var(--text-muted);';

    wrap.appendChild(btn);
    wrap.appendChild(heightInput);
    wrap.appendChild(unit);
    el.appendChild(wrap);
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

{ // Triple-click clear
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
      panX: state.panX, panY: state.panY, zoom: state.zoom,
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
      if (fd.rings) return fd;
      const pts = fd.points ?? (fd.x1 !== undefined
        ? [{x:fd.x1,y:fd.y1},{x:fd.x2,y:fd.y1},{x:fd.x2,y:fd.y2},{x:fd.x1,y:fd.y2}]
        : null);
      if (!pts) return fd;
      return { id: fd.id, rings: [pts, ...(fd.holes || [])], height: fd.height };
    });
  }
  if (data.walls) {
    state.walls = data.walls.map(w => {
      if (w.color && !w.colorFront) { w.colorFront = w.color; delete w.color; }
      return w;
    });
  }
  if (data.openings)    state.openings    = data.openings;
  if (data.gardens) {
    state.gardens = data.gardens.map(gd => {
      if (gd.rings) return gd;
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
      if (fl.rings) return fl;
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
    cam.pos.x = data.cam.x; cam.pos.y = data.cam.y; cam.pos.z = data.cam.z;
    cam.yaw   = data.cam.yaw;
    cam.pitch = data.cam.pitch;
  }
  if (data.panX !== undefined) { state.panX = data.panX; state.panY = data.panY; state.zoom = data.zoom; }
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
  if (gl && state.view !== '2d') {
    rebuild3D();
    if (!inputFocused()) updateCameraMovement(dt);
    // Paint hover preview + click flash
    const h = state.hoverWall3d;
    const wallColor = document.getElementById('wall-color')?.value;
    const wallTint = wallColor ? hexToRGB(wallColor) : [1,1,1];
    const floorColor = document.getElementById('floor3d-color')?.value;
    const floorTint = floorColor ? hexToRGB(floorColor) : [1,1,1];
    const now = performance.now();
    const flashAmt = now < paintFlashUntil
      ? 0.35 * (1 - (now - (paintFlashUntil - 200)) / 200)
      : 0;
    for (const mesh of sceneMeshes) {
      if (mesh.wallId || mesh.openingId) {
        const isPaintHover    = h && mesh.wallId === h.wallId && state.tool === 'paint';
        const isSelectWall    = hoverInspect3d && hoverInspect3d.type === 'wall'    && mesh.wallId === hoverInspect3d.wallId && state.tool === 'select';
        const isSelectOpening = hoverInspect3d && hoverInspect3d.type === 'opening' && mesh.openingId === hoverInspect3d.id    && state.tool === 'select';
        const isSelectHover   = isSelectWall || isSelectOpening;
        const isFlash = mesh.wallId === paintFlashWallId && flashAmt > 0;
        mesh.emissive = 0;
        const selectTint = [0.4, 0.72, 1.0];
        mesh.tintCol  = isPaintHover ? wallTint : isSelectHover ? selectTint : [0,0,0];
        mesh.tintAmt  = isPaintHover ? 0.55 : isSelectHover ? 0.45 : 0;
        mesh.flash    = isFlash ? flashAmt : 0;
      } else if (mesh.floorId) {
        const isHover = state.hoverFloor3d === mesh.floorId && state.tool === 'floor3d';
        const isFlash = mesh.floorId === paintFlashFloorId && flashAmt > 0;
        mesh.emissive = 0;
        mesh.tintCol  = isHover ? floorTint : [0,0,0];
        mesh.tintAmt  = isHover ? 0.55 : 0;
        mesh.flash    = isFlash ? flashAmt : 0;
      } else {
        mesh.emissive = 0; mesh.tintCol = [0,0,0]; mesh.tintAmt = 0; mesh.flash = 0;
      }
    }
    clearOverlay();
    // Select hover: blue overlay for door holes (no geometry to tint otherwise)
    if (state.tool === 'select' && hoverInspect3d && hoverInspect3d.type === 'opening') {
      const op = state.openings.find(op => op.id === hoverInspect3d.id);
      if (op && op.type === 'door') {
        const w = state.walls.find(w => w.id === hoverInspect3d.wallId);
        if (w) {
          const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
          if (wallLen > 0.001) {
            const wdx = (w.x2 - w.x1) / wallLen, wdz = (w.y2 - w.y1) / wallLen;
            const opW = op.width * UNIT, opH = op.height * UNIT;
            const midG = op.left + op.width / 2;
            const cx = w.x1 * UNIT + wdx * midG * UNIT;
            const cz = w.y1 * UNIT + wdz * midG * UNIT;
            const cy = floorYOffset(w.floor ?? 0) + op.fromFloor * UNIT + opH / 2;
            const rotY = Math.atan2(-wdz, wdx);
            const hoverCol = [0.4, 0.72, 1.0];
            const geo = geoBox(opW, opH, WALL_T + 0.06, Array(6).fill(hoverCol));
            const model = m4();
            m4Translate(model, model, cx, cy, cz);
            m4RotateY(model, model, rotY);
            addSceneMesh(geo, model, { overlay: true, castShadow: false, receiveShadow: false, transparent: true, opacity: 0.38 });
          }
        }
      }
    }
    // Wall tool: ghost wall + snap dot + place flash
    if (state.tool === 'wall' && hoverPt3d) {
      const fd = state.floorDefs[state.activeFloor] ?? state.floorDefs[0];
      const wallH = fd.wallHeight;
      const yOff  = floorYOffset(state.activeFloor);
      const snapCol = [0.35, 0.65, 1.0]; // blue snap dot
      const dotR = 0.08;
      // Snap dot at hover point
      const sx = hoverPt3d.x * UNIT, sz = hoverPt3d.y * UNIT;
      addOverlayBox(sx, yOff + dotR, sz, dotR*2, dotR*2, dotR*2, snapCol, { transparent: true, opacity: 0.9 });
      // Ghost wall if we have a start point
      if (state.wallStart) {
        const end = wallEnd(state.wallStart, hoverPt3d);
        if (end.x !== state.wallStart.x || end.y !== state.wallStart.y) {
          const dx = (end.x - state.wallStart.x) * UNIT;
          const dz = (end.y - state.wallStart.y) * UNIT;
          const len = Math.hypot(dx, dz);
          const cx = (state.wallStart.x + end.x) / 2 * UNIT;
          const cz = (state.wallStart.y + end.y) / 2 * UNIT;
          const ghostCol = [0.35, 0.65, 1.0];
          const rotY = Math.atan2(-dz, dx);
          const geo = geoBox(len, wallH, WALL_T, Array(6).fill(ghostCol));
          const model = m4();
          m4Translate(model, model, cx, yOff + wallH/2, cz);
          m4RotateY(model, model, rotY);
          addSceneMesh(geo, model, { overlay: true, castShadow: false, receiveShadow: false, transparent: true, opacity: 0.35 });
          // Snap dot at start
          addOverlayBox(state.wallStart.x*UNIT, yOff+dotR, state.wallStart.y*UNIT, dotR*2, dotR*2, dotR*2, snapCol, { transparent: true, opacity: 0.9 });
        }
      }
    }
    // Ghost opening (door/window)
    if ((state.tool === 'door' || state.tool === 'window') && hoverOpening3d) {
      const h = hoverOpening3d;
      const w = h.wallObj;
      const wallLen = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const wdx = (w.x2 - w.x1) / wallLen, wdz = (w.y2 - w.y1) / wallLen;
      const opW = h.width * UNIT, opH = h.height * UNIT;
      const fromFloorM = h.fromFloor * UNIT;
      const cy = h.yOff + fromFloorM + opH / 2;
      const rotY = Math.atan2(-wdz, wdx);
      const ghostCol = [0.35, 0.65, 1.0];
      const geo = geoBox(opW, opH, WALL_T + 0.06, Array(6).fill(ghostCol));
      const model = m4();
      m4Translate(model, model, h.cx, cy, h.cz);
      m4RotateY(model, model, rotY);
      addSceneMesh(geo, model, { overlay: true, castShadow: false, receiveShadow: false, transparent: true, opacity: 0.4 });
    }

    // Wall place flash: only the newly placed wall
    const now2 = performance.now();
    if (now2 < wallPlaceFlashUntil && wallPlaceFlashId != null) {
      const t = 1 - (now2 - (wallPlaceFlashUntil - 250)) / 250;
      for (const mesh of sceneMeshes) {
        if (mesh.wallId === wallPlaceFlashId) mesh.flash = (mesh.flash ?? 0) + 0.5 * t;
      }
    }
    // Opening place flash: dark "punch" pulse on the wall
    if (now2 < openingPlaceFlashUntil && openingPlaceFlashWallId != null) {
      const t = 1 - (now2 - (openingPlaceFlashUntil - 300)) / 300;
      for (const mesh of sceneMeshes) {
        if (mesh.wallId === openingPlaceFlashWallId) {
          // Darken by reducing emissive to negative (subtracts from lit color)
          mesh.flash = (mesh.flash ?? 0) - 0.25 * t;
        }
      }
    }

    render3D();
  }
}

// ── INIT ───────────────────────────────────────────────────
function init() {
  resizeCanvas();
  loadSession();
  init3D();
  updateCameraMovement(0);
  updateStatus();
  renderFloorSelector();
  refreshWallPalette();
  refreshFloorPalette();

  document.querySelectorAll('.setting-row input[type="number"]').forEach(input => {
    input.value = parseFloat(input.value).toFixed(1);
    input.addEventListener('change', () => {
      input.value = parseFloat(input.value).toFixed(1);
    });
  });

  loop();
}

init();
