// ─────────────────────────────────────────────────────────────────────────
// GENESIS WORKER — original pixel mascot, drawn 100% from <rect> primitives.
// No external sprite sheets, no borrowed brand characters. The silhouette is
// a rounded blocky body with a visor face, two expressive eyes, a signature
// antenna, a department-colored glow, and per-state CSS animation.
//
// Rendered on a 16×16 design grid scaled to `size`. Every pixel is crisp.
// ─────────────────────────────────────────────────────────────────────────

import { GENESIS_TOKENS, type EyeShape, type WorkerAnim, type WorkerPalette } from '@animations/genesisWorkerDesign';
import type { VisualProfile } from '@core/types/genesis';

const GRID = 16;
const VISOR = '#11151f';   // face screen — slightly above the #0a0c12 outline
const EYE = '#eaf2ff';     // expressive eye-white
const LID = '#2a3144';     // closed-eye line

type Span = [y: number, x0: number, w: number];

// Rounded blocky silhouette (cute-tech). Symmetric, clean, readable at 1×.
const BODY: Span[] = [
  [3, 5, 6],
  [4, 4, 8],
  [5, 3, 10],
  [6, 3, 10],
  [7, 3, 10],
  [8, 3, 10],
  [9, 3, 10],
  [10, 3, 10],
  [11, 3, 10],
  [12, 4, 8],
  [13, 5, 6],
];

// Visor face panel (darker screen the eyes sit on).
const VISOR_SPANS: Span[] = [
  [6, 4, 8],
  [7, 4, 8],
  [8, 4, 8],
];

interface Props {
  palette: WorkerPalette;
  anim: WorkerAnim;
  eye: EyeShape;
  accessory?: VisualProfile['accessory'];
  /** top-left of the 16-unit grid, in office coordinates */
  x: number;
  y: number;
  size: number;
  dim?: boolean;
}

function Rects({ spans, fill, u, ox, oy }: { spans: Span[]; fill: string; u: number; ox: number; oy: number }) {
  return (
    <>
      {spans.map(([sy, sx, w], i) => (
        <rect key={i} x={ox + sx * u} y={oy + sy * u} width={w * u} height={u} fill={fill} />
      ))}
    </>
  );
}

function Eyes({ eye, accent, u, ox, oy }: { eye: EyeShape; accent: string; u: number; ox: number; oy: number }) {
  const px = (gx: number, gy: number, gw: number, gh: number, fill: string, key: string) => (
    <rect key={key} x={ox + gx * u} y={oy + gy * u} width={gw * u} height={gh * u} fill={fill} />
  );
  switch (eye) {
    case 'closed':
      return <>{px(5, 8, 2, 1, LID, 'l')}{px(9, 8, 2, 1, LID, 'r')}</>;
    case 'focused': // narrowed, concentrating
      return <>{px(5, 8, 2, 1, EYE, 'l')}{px(9, 8, 2, 1, EYE, 'r')}</>;
    case 'wide': // alert
      return (
        <>
          {px(5, 6, 2, 3, EYE, 'l')}{px(9, 6, 2, 3, EYE, 'r')}
          {px(5, 6, 1, 1, accent, 'ls')}{px(9, 6, 1, 1, accent, 'rs')}
        </>
      );
    case 'happy': // ^ ^ celebrating
      return (
        <>
          {px(5, 8, 1, 1, EYE, 'l0')}{px(6, 7, 1, 1, EYE, 'l1')}
          {px(9, 7, 1, 1, EYE, 'r0')}{px(10, 8, 1, 1, EYE, 'r1')}
        </>
      );
    case 'open':
    default:
      return (
        <>
          {px(5, 7, 2, 2, EYE, 'l')}{px(9, 7, 2, 2, EYE, 'r')}
          {px(5, 7, 1, 1, accent, 'ls')}{px(9, 7, 1, 1, accent, 'rs')}
        </>
      );
  }
}

function Accessory({ kind, accent, u, ox, oy }: {
  kind: VisualProfile['accessory']; accent: string; u: number; ox: number; oy: number;
}) {
  const px = (gx: number, gy: number, gw: number, gh: number, fill: string, key: string) => (
    <rect key={key} x={ox + gx * u} y={oy + gy * u} width={gw * u} height={gh * u} fill={fill} />
  );
  switch (kind) {
    case 'crown': // CEO / orchestrator — calm gold authority
      return (
        <>
          {px(5, 2, 6, 1, GENESIS_TOKENS.gold, 'base')}
          {px(5, 1, 1, 1, GENESIS_TOKENS.gold, 'p0')}
          {px(7, 0, 2, 1, GENESIS_TOKENS.gold, 'p1')}
          {px(10, 1, 1, 1, GENESIS_TOKENS.gold, 'p2')}
        </>
      );
    case 'shield':
      return (
        <>
          {px(11, 9, 3, 4, GENESIS_TOKENS.outline, 'o')}
          {px(11, 9, 3, 1, accent, 't')}
          {px(11, 10, 3, 2, GENESIS_TOKENS.red, 'b')}
        </>
      );
    case 'book':
    case 'clipboard':
      return (
        <>
          {px(11, 9, 3, 4, '#e6dac0', 'pg')}
          {px(11, 9, 3, 1, accent, 'cl')}
        </>
      );
    default: // signature antenna + glow dot (the Genesis brand mark)
      return (
        <>
          {px(8, 2, 1, 1, GENESIS_TOKENS.outline, 'stalk')}
          {px(7, 0, 2, 2, accent, 'dot')}
        </>
      );
  }
}

export default function GenesisWorker({ palette, anim, eye, accessory, x, y, size, dim }: Props) {
  const u = size / GRID;
  // shadow offsets for the 1px outline (4-direction expand of every body cell)
  const OUT_OFFSETS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // chest "core" light — a small department-accent glow on the body
  const cx = x + 8 * u;
  const cy = y + 9 * u;

  return (
    <g
      className={`gw-anim-${anim}`}
      style={{ transformBox: 'fill-box', transformOrigin: 'center', opacity: dim ? 0.4 : 1 }}
    >
      {/* soft layered department glow (no blur filter → cheap with many workers) */}
      <ellipse cx={cx} cy={y + 8 * u} rx={size * 0.62} ry={size * 0.5} fill={palette.glow} opacity={dim ? 0 : 0.1} />
      <ellipse cx={cx} cy={y + 8 * u} rx={size * 0.45} ry={size * 0.38} fill={palette.glow} opacity={dim ? 0 : 0.12} />

      <g shapeRendering="crispEdges">
        {/* 1px dark outline: expand every body span in 4 directions */}
        {OUT_OFFSETS.map(([dx, dy], k) => (
          <Rects key={k} spans={BODY} fill={GENESIS_TOKENS.outline} u={u} ox={x + dx * u} oy={y + dy * u} />
        ))}

        {/* body */}
        <Rects spans={BODY} fill={palette.primary} u={u} ox={x} oy={y} />
        {/* subtle top highlight for a premium, rounded read */}
        <rect x={x + 4 * u} y={y + 4 * u} width={3 * u} height={u} fill="#ffffff" opacity={0.14} />

        {/* visor face */}
        <Rects spans={VISOR_SPANS} fill={VISOR} u={u} ox={x} oy={y} />
        <Eyes eye={eye} accent={palette.accent} u={u} ox={x} oy={y} />

        {/* chest core light */}
        <rect className="gw-core" x={cx - u} y={cy} width={2 * u} height={u} fill={palette.accent} opacity={0.85} />

        <Accessory kind={accessory ?? 'none'} accent={palette.accent} u={u} ox={x} oy={y} />
      </g>
    </g>
  );
}
