// Generates an animated SVG contact sheet of Genesis Workers.
// Mirrors the rect geometry in src/components/GenesisWorker.tsx so the
// artifact stays faithful to what ships. Run: node scripts/genWorkerPreview.mjs
import { writeFileSync } from 'node:fs';

const T = {
  outline: '#0a0c12', gold: '#ffd24a', goldSoft: '#fff0b8', green: '#00ff9c',
  blue: '#3da9fc', deepBlue: '#1f6fb0', cyan: '#22d3ee', red: '#ff4757',
  amber: '#ffb547', purple: '#a855f7', violet: '#7c5cff', gray: '#5b6678',
};
const VISOR = '#11151f', EYE = '#eaf2ff', LID = '#2a3144';
const GRID = 16;
const BODY = [[3,5,6],[4,4,8],[5,3,10],[6,3,10],[7,3,10],[8,3,10],[9,3,10],[10,3,10],[11,3,10],[12,4,8],[13,5,6]];
const VISOR_SPANS = [[6,4,8],[7,4,8],[8,4,8]];
const OUT = [[-1,0],[1,0],[0,-1],[0,1]];

const DEPTS = [
  { label: 'CEO',       primary: T.gold,     accent: T.goldSoft, glow: T.gold,     acc: 'crown' },
  { label: 'TRADING',   primary: T.green,    accent: T.blue,     glow: T.green,    acc: 'none' },
  { label: 'RISK',      primary: T.red,      accent: T.amber,    glow: T.red,      acc: 'shield' },
  { label: 'MARKETING', primary: T.purple,   accent: T.violet,   glow: T.purple,   acc: 'none' },
  { label: 'RESEARCH',  primary: T.amber,    accent: T.blue,     glow: T.amber,    acc: 'book' },
  { label: 'MEMORY',    primary: T.deepBlue, accent: T.cyan,     glow: T.cyan,     acc: 'none' },
  { label: 'SECURITY',  primary: T.gray,     accent: T.cyan,     glow: T.gray,     acc: 'none' },
];
const STATES = [
  { anim: 'idle', eye: 'open' }, { anim: 'walking', eye: 'open' }, { anim: 'working', eye: 'focused' },
  { anim: 'debating', eye: 'open' }, { anim: 'thinking', eye: 'focused' }, { anim: 'alert', eye: 'wide' },
  { anim: 'resting', eye: 'closed' }, { anim: 'celebrating', eye: 'happy' }, { anim: 'blocked', eye: 'closed' },
];

const r = (x, y, w, h, f, o = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${o !== 1 ? ` opacity="${o}"` : ''}/>`;

function eyes(shape, accent, u, ox, oy) {
  const px = (gx, gy, gw, gh, f) => r(ox + gx * u, oy + gy * u, gw * u, gh * u, f);
  if (shape === 'closed') return px(5,8,2,1,LID) + px(9,8,2,1,LID);
  if (shape === 'focused') return px(5,8,2,1,EYE) + px(9,8,2,1,EYE);
  if (shape === 'wide') return px(5,6,2,3,EYE)+px(9,6,2,3,EYE)+px(5,6,1,1,accent)+px(9,6,1,1,accent);
  if (shape === 'happy') return px(5,8,1,1,EYE)+px(6,7,1,1,EYE)+px(9,7,1,1,EYE)+px(10,8,1,1,EYE);
  return px(5,7,2,2,EYE)+px(9,7,2,2,EYE)+px(5,7,1,1,accent)+px(9,7,1,1,accent);
}
function accessory(kind, accent, u, ox, oy) {
  const px = (gx, gy, gw, gh, f) => r(ox + gx * u, oy + gy * u, gw * u, gh * u, f);
  if (kind === 'crown') return px(5,2,6,1,T.gold)+px(5,1,1,1,T.gold)+px(7,0,2,1,T.gold)+px(10,1,1,1,T.gold);
  if (kind === 'shield') return px(11,9,3,4,T.outline)+px(11,9,3,1,accent)+px(11,10,3,2,T.red);
  if (kind === 'book') return px(11,9,3,4,'#e6dac0')+px(11,9,3,1,accent);
  return px(8,2,1,1,T.outline)+px(7,0,2,2,accent);
}
function worker(p, st, x, y, size) {
  const u = size / GRID, ox = x, oy = y;
  const cx = x + 8 * u;
  let s = `<g class="gw-anim-${st.anim}" style="transform-box:fill-box;transform-origin:center">`;
  s += `<ellipse cx="${cx}" cy="${y+8*u}" rx="${size*0.62}" ry="${size*0.5}" fill="${p.glow}" opacity="0.1"/>`;
  s += `<ellipse cx="${cx}" cy="${y+8*u}" rx="${size*0.45}" ry="${size*0.38}" fill="${p.glow}" opacity="0.12"/>`;
  s += `<g shape-rendering="crispEdges">`;
  for (const [dx, dy] of OUT) for (const [sy, sx, w] of BODY) s += r(ox+(sx+dx)*u, oy+(sy+dy)*u, w*u, u, T.outline);
  for (const [sy, sx, w] of BODY) s += r(ox+sx*u, oy+sy*u, w*u, u, p.primary);
  s += r(x+4*u, y+4*u, 3*u, u, '#ffffff', 0.14);
  for (const [sy, sx, w] of VISOR_SPANS) s += r(ox+sx*u, oy+sy*u, w*u, u, VISOR);
  s += eyes(st.eye, p.accent, u, ox, oy);
  s += `<rect class="gw-core" x="${cx-u}" y="${y+9*u}" width="${2*u}" height="${u}" fill="${p.accent}" opacity="0.85"/>`;
  s += accessory(p.acc, p.accent, u, ox, oy);
  s += `</g></g>`;
  return s;
}

const CSS = `
@keyframes gw-idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes gw-walk{0%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-2px) rotate(-2deg)}75%{transform:translateY(-2px) rotate(2deg)}}
@keyframes gw-work{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.6px) scaleY(0.98)}}
@keyframes gw-debate{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
@keyframes gw-think{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-1px) rotate(1deg)}}
@keyframes gw-alert{0%,100%{transform:translateX(0)}20%{transform:translateX(-1.5px)}60%{transform:translateX(1.5px)}}
@keyframes gw-rest{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(0.5px) scaleY(0.97)}}
@keyframes gw-celebrate{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-4px) scale(1.04)}60%{transform:translateY(0) scale(1)}}
@keyframes gw-blocked{0%,100%{transform:translateX(0)}25%,75%{transform:translateX(-0.8px)}50%{transform:translateX(0.8px)}}
@keyframes gw-core{0%,100%{opacity:0.55}50%{opacity:1}}
.gw-anim-idle{animation:gw-idle 2.6s ease-in-out infinite}.gw-anim-walking{animation:gw-walk .5s ease-in-out infinite}
.gw-anim-working{animation:gw-work .9s ease-in-out infinite}.gw-anim-debating{animation:gw-debate 1.1s ease-in-out infinite}
.gw-anim-thinking{animation:gw-think 2.2s ease-in-out infinite}.gw-anim-alert{animation:gw-alert .45s ease-in-out infinite}
.gw-anim-resting{animation:gw-rest 3.4s ease-in-out infinite}.gw-anim-celebrating{animation:gw-celebrate .9s ease-in-out infinite}
.gw-anim-blocked{animation:gw-blocked .6s steps(2) infinite}.gw-core{animation:gw-core 2.4s ease-in-out infinite}
text{font-family:'Inter',ui-sans-serif,system-ui,sans-serif}`;

const CELL = 96, SIZE = 60, X0 = 150, Y0 = 90;
const W = X0 + STATES.length * CELL + 20;
const H = Y0 + DEPTS.length * CELL + 20;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${CSS}</style>`;
svg += r(0, 0, W, H, '#0a0c12');
svg += `<text x="24" y="40" fill="#e6edf3" font-size="22" font-weight="700">GENESIS WORKERS</text>`;
svg += `<text x="24" y="62" fill="#7c8696" font-size="12" letter-spacing="2">DEPARTMENT × STATE — LIVING PIXEL HQ</text>`;
STATES.forEach((st, i) => {
  svg += `<text x="${X0 + i * CELL + CELL / 2}" y="${Y0 - 8}" fill="#9aa6b6" font-size="10" text-anchor="middle" letter-spacing="1">${st.anim.toUpperCase()}</text>`;
});
DEPTS.forEach((d, row) => {
  const cy = Y0 + row * CELL;
  svg += `<text x="20" y="${cy + CELL / 2 + 4}" fill="${d.primary}" font-size="11" font-weight="700" letter-spacing="1">${d.label}</text>`;
  STATES.forEach((st, col) => {
    const x = X0 + col * CELL + (CELL - SIZE) / 2;
    const y = cy + (CELL - SIZE) / 2;
    svg += worker(d, st, x, y, SIZE);
  });
});
svg += `</svg>`;
writeFileSync(new URL('../assets/genesis-workers-preview.svg', import.meta.url), svg);
console.log('wrote assets/genesis-workers-preview.svg', W + 'x' + H);
