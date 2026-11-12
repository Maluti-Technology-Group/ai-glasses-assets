// AIMB-G2 Pro exploded teardown: illustrative drawing generator.
// Run: node teardown/generate.cjs   ->  hero-teardown.svg + hero-teardown-interactive.html
// Dimensions that come from the catalog: frame width 148.5, temple length 159, lens 50 x 39.3,
// bridge 22. Everything else (internals, their shapes and positions) is illustrative.
const fs = require('fs');
const path = require('path');

// ---------- vector helpers ----------
const rad = (a) => (a * Math.PI) / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const mean = (pts) => pts.reduce((s, p) => add(s, p), [0, 0, 0]).map((x) => x / pts.length);

// ---------- camera: world x right, y up, z toward the viewer ----------
const AZ = rad(32), EL = rad(20);
const D = [Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL)];
const R = norm(cross([0, 1, 0], D));
const U = cross(D, R);
const proj = (p) => [dot(p, R), -dot(p, U)];
const LIGHT = norm([-0.5, 0.9, 0.7]);

// ---------- 2D shape builders ----------
function rrect(w, h, r, cx, cy, n = 8) {
  const [tl, tr, br, bl] = r; const pts = [];
  const corner = (ccx, ccy, rr, a0) => { for (let i = 0; i <= n; i++) { const a = rad(a0 + (90 * i) / n); pts.push([ccx + rr * Math.cos(a), ccy + rr * Math.sin(a)]); } };
  corner(cx + w / 2 - tr, cy + h / 2 - tr, tr, 0);
  corner(cx - w / 2 + tl, cy + h / 2 - tl, tl, 90);
  corner(cx - w / 2 + bl, cy - h / 2 + bl, bl, 180);
  corner(cx + w / 2 - br, cy - h / 2 + br, br, 270);
  return pts;
}
const circle = (cx, cy, r, n = 28) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
function catmull(pts, per = 10) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < per; t++) {
      const s = t / per, s2 = s * s, s3 = s2 * s;
      out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * s + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * s2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * s3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function ribbon(center, hw) {
  const c = catmull(center.map((p, i) => [p[0], p[1], hw[i]]));
  const L = [], Rr = [];
  c.forEach((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    L.push([p[0] - ty * p[2], p[1] + tx * p[2]]); Rr.push([p[0] + ty * p[2], p[1] - tx * p[2]]);
  });
  return L.concat(Rr.reverse());
}

// ---------- solids ----------
const ident = (u, v, w) => [u, v, w];
const alongX = (u, v, w) => [w, v, u]; // profile in (z, y), extruded along x
function prism(rings, map, w0, w1) {
  const faces = [];
  const cap = (w) => ({ type: 'cap', rings: rings.map((r) => r.map(([u, v]) => map(u, v, w))) });
  faces.push(cap(w0), cap(w1));
  rings.forEach((r, ri) => {
    const hc = ri > 0 ? mean(r.map(([u, v]) => map(u, v, (w0 + w1) / 2))) : null;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      faces.push({ type: 'wall', hole: hc, rings: [[map(a[0], a[1], w0), map(b[0], b[1], w0), map(b[0], b[1], w1), map(a[0], a[1], w1)]] });
    }
  });
  return faces;
}
const box = (x0, x1, y0, y1, z0, z1) => prism([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], ident, z0, z1);
const cylZ = (cx, cy, r, z0, z1, n = 28) => prism([circle(cx, cy, r, n)], ident, z0, z1);
const cylX = (cy, cz, r, x0, x1, n = 28) => prism([circle(cz, cy, r, n)], alongX, x0, x1);

// ---------- parts ----------
const DARK = { base: '#3a3a40', stroke: 'rgba(255,255,255,0.30)', sw: 0.9 };
const LIGHT_PART = { base: '#f4f5f7', stroke: '#16181b', sw: 1, outlineWalls: true };
const parts = [];
const part = (id, faces, style, extra = {}) => parts.push({ id, faces, ...style, ...extra });
const trails = [];

const ARM_EX = 28; // sideways explosion of the temple arms
const armCenter = [[-4, 1], [-45, 0.5], [-95, -0.5], [-122, -3], [-140, -12], [-152, -24]];
const armHW = [7.5, 7, 6, 5.2, 4.4, 3.6];
const armProfile = ribbon(armCenter, armHW);
part('arm-left', prism([armProfile], alongX, -(77.5 + ARM_EX), -(71.5 + ARM_EX)), DARK);
part('arm-right', prism([armProfile], alongX, 71.5 + ARM_EX, 77.5 + ARM_EX), DARK);
const AX = 75 + ARM_EX; // arm centre line x
part('action-key', box(AX + 3.5, AX + 6, -2, 4.5, -26, -15), { base: '#d7261e', stroke: '#5a0f0b', sw: 0.9, outlineWalls: true });

// internals floating above the right arm, each with a vertical assembly trail
const ARM_TOP = 9;
const internals = [
  { id: 'pcb', y: 28, z: [-62, -22], build: (y) => [...box(AX - 0.9, AX + 0.9, y, y + 10, -62, -22), ...box(AX + 0.9, AX + 2.2, y + 2, y + 5, -34, -42), ...box(AX + 0.9, AX + 2.0, y + 3, y + 7.5, -49, -56)], style: { base: '#eceff3', stroke: '#16181b', sw: 1, outlineWalls: true } },
  { id: 'battery', y: 38, z: [-112, -68], build: (y) => box(AX - 3, AX + 3, y, y + 10, -112, -68), style: LIGHT_PART },
  { id: 'speaker', y: 52, z: [-136, -124], build: (y) => cylX(y + 6.5, -130, 6.5, AX - 2.5, AX + 2.5), style: { base: '#dfe2e7', stroke: '#16181b', sw: 1 } },
];
internals.forEach((it) => {
  const zc = (it.z[0] + it.z[1]) / 2;
  trails.push({ a: [AX, ARM_TOP, zc], b: [AX, it.y, zc], dash: true });
});
internals.forEach((it) => part(it.id, it.build(it.y), it.style));
part('pins', [...cylX(24, -11, 1.5, AX - 2.5, AX + 2.5, 16), ...cylX(24, -17, 1.5, AX - 2.5, AX + 2.5, 16)], { base: '#e0a82e', stroke: '#5b4210', sw: 0.9 });
trails.push({ a: [AX, ARM_TOP, -11], b: [AX, 22.5, -11], dash: true }, { a: [AX, ARM_TOP, -17], b: [AX, 22.5, -17], dash: true });

// front frame
const frameOuter = rrect(148.5, 52, [10, 10, 24, 24], 0, 0, 9);
const lensShape = (cx, w = 50, h = 39.3) => rrect(w, h, [9, 9, 17, 17], cx, -1.5, 9);
part('frame', prism([frameOuter, lensShape(-36), lensShape(36)], ident, -5.5, 0), DARK);

// camera module and flash, floating forward of the upper corners
const CAMX = 67.5, CAMY = 19.5;
trails.push({ a: [CAMX, CAMY, 0], b: [CAMX, CAMY, 22], dash: true }, { a: [-CAMX, CAMY, 0], b: [-CAMX, CAMY, 15], dash: true });
part('camera', [...box(CAMX - 6.5, CAMX + 6.5, CAMY - 5.5, CAMY + 5.5, 20, 22.5), ...cylZ(CAMX, CAMY, 4.2, 22.5, 30)], { base: '#2a2a2f', stroke: 'rgba(255,255,255,0.35)', sw: 0.9 });
part('camera-glass', cylZ(CAMX, CAMY, 2.7, 30, 30.6, 24), { base: '#0e2a47', stroke: '#d7261e', sw: 1.2 });
part('flash', box(-CAMX - 3, -CAMX + 3, CAMY - 2, CAMY + 2, 14, 16), { base: '#f4f5f7', stroke: '#16181b', sw: 0.9, outlineWalls: true });

// three interchangeable lens sets floating in front of the frame
const lensSets = [
  { id: 'lens-clear', z: 30, fill: '#cfe3ff', fo: 0.42, stroke: '#16181b' },
  { id: 'lens-black', z: 52, fill: '#0c0c0e', fo: 0.55, stroke: '#16181b' },
  { id: 'lens-amber', z: 74, fill: 'url(#amber)', fo: 0.5, stroke: '#7a3a07' },
];
[-36, 36].forEach((cx) => lensSets.forEach((s) => trails.push({ a: [cx, -1.5, s.z - 28 < 0 ? 0 : (s === lensSets[0] ? 0 : lensSets[lensSets.indexOf(s) - 1].z + 2.2)], b: [cx, -1.5, s.z], dash: true, soft: true })));
lensSets.forEach((s) => part(s.id, [...prism([lensShape(-36, 50.6, 39.9)], ident, s.z, s.z + 2.2), ...prism([lensShape(36, 50.6, 39.9)], ident, s.z, s.z + 2.2)], { base: '#ffffff', glass: s }));

// ---------- order: back to front ----------
const ORDER = ['arm-left', 'arm-right', 'action-key', '@trails-back', 'pcb', 'battery', 'speaker', 'pins', 'frame', 'camera', 'camera-glass', 'flash', '@trails-front', 'lens-clear', 'lens-black', 'lens-amber'];

// ---------- fit ----------
const allPts = parts.flatMap((p) => p.faces.flatMap((f) => f.rings.flat()));
const xs = allPts.map((p) => proj(p)[0]), ys = allPts.map((p) => proj(p)[1]);
const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
const W = 1600, H = 1200, PAD = 90;
const S = Math.min((W - 2 * PAD) / (bx1 - bx0), (H - 2 * PAD) / (by1 - by0));
const OX = (W - S * (bx1 - bx0)) / 2 - S * bx0, OY = (H - S * (by1 - by0)) / 2 - S * by0;
const sp = (p) => { const q = proj(p); return [(q[0] * S + OX).toFixed(1), (q[1] * S + OY).toFixed(1)]; };

// ---------- shading ----------
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function faceNormal(f, center) {
  const r = f.rings[0]; let n = [0, 0, 0];
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
  n = norm(n); const c = mean(r);
  const out = f.hole ? dot(n, sub(f.hole, c)) : dot(n, sub(c, center));
  return out < 0 ? n.map((x) => -x) : n;
}
function renderPart(p) {
  const pts = p.faces.flatMap((f) => f.rings.flat()); const center = mean(pts);
  const faces = p.faces.map((f) => ({ f, depth: dot(mean(f.rings[0]), D), n: faceNormal(f, center) })).sort((a, b) => a.depth - b.depth);
  const out = faces.map(({ f, n }) => {
    const d = f.rings.map((r) => 'M' + r.map(sp).map((q) => q.join(',')).join('L') + 'Z').join('');
    if (p.glass) {
      const g = p.glass;
      return `<path d="${d}" fill="${g.fill}" fill-opacity="${g.fo}" stroke="${g.stroke}" stroke-opacity="0.7" stroke-width="1" stroke-linejoin="round" fill-rule="evenodd"/>`;
    }
    const sh = 0.5 + 0.5 * Math.max(0, dot(n, LIGHT)) + (dot(n, D) > 0.3 ? 0.06 : 0);
    const fill = toHex(hex(p.base).map((x) => x * sh));
    // walls of curved profiles are many thin strips: hide their seams, outline only the caps
    if (f.type === 'wall' && !p.outlineWalls) return `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.7" stroke-linejoin="round"/>`;
    return `<path d="${d}" fill="${fill}" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linejoin="round" fill-rule="evenodd"/>`;
  });
  const depthNorm = dot(center, D);
  return { id: p.id, depth: depthNorm, svg: out.join('') };
}
const rendered = Object.fromEntries(parts.map((p) => [p.id, renderPart(p)]));
const ds = Object.values(rendered).map((r) => r.depth); const dmin = Math.min(...ds), dmax = Math.max(...ds);

function trailsSvg(list) {
  return list.map((t) => { const [a, b] = [sp(t.a), sp(t.b)]; return `<path d="M${a.join(',')}L${b.join(',')}" fill="none" stroke="#d7261e" stroke-opacity="${t.soft ? 0.45 : 0.9}" stroke-width="1.3" stroke-dasharray="6 5" stroke-linecap="round"/>`; }).join(''); }
const backTrails = trails.filter((t) => t.a[0] > 90 || t.b[0] > 90);
const frontTrails = trails.filter((t) => !backTrails.includes(t));

function layer(id, depth, svg, extra = '') { return `<g class="layer" id="${id}" data-depth="${depth.toFixed(3)}"${extra}>${svg}</g>`; }
const body = ORDER.map((id) => {
  if (id === '@trails-back') return layer('trails-back', 0.35, trailsSvg(backTrails));
  if (id === '@trails-front') return layer('trails-front', 0.7, trailsSvg(frontTrails));
  const r = rendered[id];
  return layer(id, (r.depth - dmin) / (dmax - dmin), r.svg);
}).join('\n');

const defs = `<defs>
<linearGradient id="amber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8590c"/><stop offset="1" stop-color="#f7b731"/></linearGradient>
<radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>`;
const shadow = `<ellipse cx="${W / 2}" cy="${H - 70}" rx="${W * 0.34}" ry="34" fill="url(#shadow)"/>`;
const svgInner = `${defs}${shadow}\n${body}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d"><title id="t">Exploded teardown of the AIMB-G2 Pro smart glasses</title><desc id="d">Illustrative exploded view: three lens sets float in front of the black wayfarer frame, a camera module sits at the front corner, and a circuit board, battery and speaker lift out of the temple arm along dashed assembly lines. Internal parts are illustrative.</desc>\n${svgInner}\n</svg>\n`;
const out = path.join(__dirname);
fs.writeFileSync(path.join(out, 'hero-teardown.svg'), svg);

// ---------- interactive demo ----------
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIMB-G2 Pro teardown hero</title>
<style>
:root{--bg:#f8f9fa;--ink:#111;--accent:#d7261e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1012;--ink:#f3f4f6}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.hero{min-height:100svh;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:center;gap:24px;padding:48px clamp(16px,5vw,72px);overflow:hidden}
.copy h1{margin:0;font-size:clamp(3rem,8vw,6.5rem);line-height:.95;letter-spacing:-.03em;font-weight:600;text-wrap:balance;
 background:linear-gradient(90deg,#0b1b3a 0%,#d7261e 38%,#e8890c 52%,#2f9e6a 68%,#3b4cc0 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.copy p{margin:.5rem 0 0;font-size:clamp(1.25rem,2.4vw,2rem);font-weight:600;letter-spacing:-.01em}
.cta{display:inline-block;margin-top:2rem;padding:.9rem 1.6rem;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:600;text-decoration:none}
.cta:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.stage{perspective:1400px;touch-action:pan-y}
.tilt{will-change:transform;transform-style:preserve-3d}
.tilt svg{display:block;width:100%;height:auto;overflow:visible}
.layer{will-change:transform}
@media (max-width:760px){.hero{grid-template-columns:1fr;text-align:left}}
</style></head>
<body>
<main class="hero" id="hero">
  <div class="copy"><h1>AI Glasses</h1><p>AIMB-G2 Pro</p><a class="cta" href="#">Shop now</a></div>
  <div class="stage" id="stage"><div class="tilt" id="tilt">${svg.replace(/<\?xml.*?\?>/, '')}</div></div>
</main>
<script>
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const hero = document.getElementById('hero'), tilt = document.getElementById('tilt');
  const layers = [...tilt.querySelectorAll('.layer')];
  const MAXROT = 9, SHIFT = 26;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const frame = () => {
    cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09;
    tilt.style.transform = 'rotateY(' + (cx * MAXROT).toFixed(2) + 'deg) rotateX(' + (-cy * MAXROT * 0.7).toFixed(2) + 'deg)';
    for (const g of layers) {
      const k = (parseFloat(g.dataset.depth) - 0.5) * SHIFT;
      g.style.transform = 'translate(' + (cx * k).toFixed(2) + 'px,' + (cy * k * 0.7).toFixed(2) + 'px)';
    }
    raf = (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001) ? requestAnimationFrame(frame) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  hero.addEventListener('pointermove', (e) => {
    if (reduce.matches || e.pointerType === 'touch') return;
    const r = hero.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width) * 2 - 1; ty = ((e.clientY - r.top) / r.height) * 2 - 1; kick();
  });
  hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
})();
</script>
</body></html>
`;
fs.writeFileSync(path.join(out, 'hero-teardown-interactive.html'), html);
console.log('wrote svg', (svg.length / 1024).toFixed(0) + 'KB', 'and interactive html');
