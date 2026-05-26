// GenesisOfficeWorld — the top-down RPG office, drawn entirely with SVG.
// World coords: 1600 × 900. Rendered inside an <svg> by OfficeViewport.
//
// Layout (one continuous floor, NOT a grid of cards):
//   • Outer building wall surrounds everything
//   • Risk Bunker (top-right) and Memory Archive (right-middle) are the
//     ONLY closed rooms — they have full walls + a single door
//   • Everything else is open-plan with rugs + plants + furniture
//     clusters as soft dividers
//
// Furniture, plants, sprites are all drawn with pixel-art friendly rects
// and shape-rendering="crispEdges".

import type { JSX } from 'react';
import type { Agent } from '../types/genesis';
import AgentSprite from './AgentSprite';
import AgentConversationBubble from './AgentConversationBubble';
import { useT } from '../i18n/languageStore';

interface Props {
  agents: Agent[];
  speakingAgentId: string | null;
  speakingText: string | null;
  highlightedAgentId: string | null;
  onAgentClick: (agent: Agent) => void;
  onAgentHover: (agent: Agent | null, screenX: number, screenY: number) => void;
}

// ---------- color tokens ----------
const FLOOR_BASE = '#3a2a1c';
const FLOOR_PLANK = '#2a1f15';
const FLOOR_HIGHLIGHT = '#4a3a2a';
const WALL_FILL = '#181d28';
const WALL_TRIM = '#262d3d';
const OUTLINE = '#0a0c12';
const DESK_TOP = '#7a4f28';
const DESK_SHADOW = '#3a2310';
const MONITOR_BEZEL = '#0a0c12';
const MONITOR_SCREEN = '#04060b';
const CHAIR = '#1a1d24';
const PAPER = '#e6dac0';

// ---------- furniture primitives ----------

function WoodFloor() {
  // 1600 × 900 fill with horizontal plank lines every 32px and subtle vertical splits
  const planks: JSX.Element[] = [];
  for (let y = 0; y < 900; y += 32) {
    planks.push(<rect key={`p-${y}`} x={0} y={y} width={1600} height={1} fill={FLOOR_PLANK} />);
    // staggered short verticals to suggest plank seams
    const offsets = [80, 280, 480, 700, 920, 1140, 1380];
    offsets.forEach((ox, i) => {
      const oxx = (ox + (Math.floor(y / 32) % 2) * 60) % 1600;
      planks.push(
        <rect key={`v-${y}-${i}`} x={oxx} y={y} width={1} height={32} fill={FLOOR_PLANK} />
      );
    });
  }
  // a few warm highlights to break monotony
  const highlights = [
    [120, 60], [900, 120], [1300, 200], [220, 400], [780, 520],
    [1180, 480], [320, 700], [800, 750], [1260, 760],
  ] as const;
  return (
    <g shapeRendering="crispEdges">
      <rect x={0} y={0} width={1600} height={900} fill={FLOOR_BASE} />
      {planks}
      {highlights.map(([hx, hy], i) => (
        <rect key={`h-${i}`} x={hx} y={hy} width={26} height={2} fill={FLOOR_HIGHLIGHT} opacity={0.4} />
      ))}
    </g>
  );
}

function Rug({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={h} fill={color} opacity={0.10} />
      <rect x={x} y={y} width={w} height={4} fill={color} opacity={0.35} />
      <rect x={x} y={y + h - 4} width={w} height={4} fill={color} opacity={0.35} />
      <rect x={x} y={y} width={4} height={h} fill={color} opacity={0.35} />
      <rect x={x + w - 4} y={y} width={4} height={h} fill={color} opacity={0.35} />
    </g>
  );
}

function Wall({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={w} height={h} fill={WALL_FILL} />
      <rect x={x} y={y} width={w} height={2} fill={WALL_TRIM} />
      <rect x={x} y={y + h - 2} width={w} height={2} fill={OUTLINE} />
    </g>
  );
}

function DoorFrame({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  // a colored sliver at a wall gap to mark the doorway
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={h} fill={color} opacity={0.55} />
      <rect x={x} y={y} width={w} height={2} fill={color} opacity={0.85} />
      <rect x={x} y={y + h - 2} width={w} height={2} fill={color} opacity={0.85} />
    </g>
  );
}

function Desk({ x, y }: { x: number; y: number }) {
  // 80 wide × 50 tall: desk top + monitor + keyboard
  return (
    <g shapeRendering="crispEdges">
      {/* desk surface */}
      <rect x={x} y={y + 18} width={80} height={32} fill={DESK_TOP} />
      <rect x={x} y={y + 18} width={80} height={3} fill={'#92602f'} />
      <rect x={x} y={y + 47} width={80} height={3} fill={DESK_SHADOW} />
      <rect x={x} y={y + 18} width={2} height={32} fill={DESK_SHADOW} />
      <rect x={x + 78} y={y + 18} width={2} height={32} fill={DESK_SHADOW} />
      {/* monitor on top */}
      <rect x={x + 22} y={y} width={36} height={22} fill={MONITOR_BEZEL} />
      <rect x={x + 25} y={y + 3} width={30} height={14} fill={MONITOR_SCREEN} />
      {/* screen content: green chart hint */}
      <rect x={x + 27} y={y + 12} width={2} height={3} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 30} y={y + 10} width={2} height={5} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 33} y={y + 8} width={2} height={7} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 36} y={y + 6} width={2} height={9} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 39} y={y + 7} width={2} height={8} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 42} y={y + 5} width={2} height={10} fill={'#00ff9c'} opacity={0.9} />
      <rect x={x + 45} y={y + 8} width={2} height={7} fill={'#00ff9c'} opacity={0.9} />
      {/* stand */}
      <rect x={x + 36} y={y + 22} width={8} height={2} fill={MONITOR_BEZEL} />
      <rect x={x + 32} y={y + 24} width={16} height={2} fill={MONITOR_BEZEL} />
      {/* keyboard */}
      <rect x={x + 22} y={y + 38} width={36} height={6} fill={'#262d3d'} />
      <rect x={x + 23} y={y + 39} width={34} height={1} fill={'#3a3f4a'} />
      {/* coffee cup */}
      <rect x={x + 65} y={y + 30} width={6} height={8} fill={PAPER} />
      <rect x={x + 65} y={y + 30} width={6} height={2} fill={'#7a4f28'} />
    </g>
  );
}

function ChairTopDown({ x, y, facing = 'south' }: { x: number; y: number; facing?: 'north' | 'south' | 'east' | 'west' }) {
  // 32 × 32 footprint
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      <ellipse cx={x + 16} cy={y + 18} rx={12} ry={9} fill={CHAIR} stroke={OUTLINE} strokeWidth={1} />
      <ellipse cx={x + 16} cy={y + 17} rx={10} ry={7} fill={'#262d3d'} />
      {/* backrest hint depending on facing */}
      {facing === 'south' && (
        <rect x={x + 6} y={y + 4} width={20} height={4} fill={CHAIR} stroke={OUTLINE} strokeWidth={1} />
      )}
      {facing === 'north' && (
        <rect x={x + 6} y={y + 26} width={20} height={4} fill={CHAIR} stroke={OUTLINE} strokeWidth={1} />
      )}
      {facing === 'east' && (
        <rect x={x + 4} y={y + 8} width={4} height={18} fill={CHAIR} stroke={OUTLINE} strokeWidth={1} />
      )}
      {facing === 'west' && (
        <rect x={x + 24} y={y + 8} width={4} height={18} fill={CHAIR} stroke={OUTLINE} strokeWidth={1} />
      )}
    </g>
  );
}

function Plant({ x, y, variant = 'bush' }: { x: number; y: number; variant?: 'bush' | 'palm' | 'fern' }) {
  // 28 × 36 footprint
  const pot = (
    <g shapeRendering="crispEdges">
      <rect x={x + 8} y={y + 26} width={12} height={8} fill={'#5b3a1c'} />
      <rect x={x + 8} y={y + 26} width={12} height={2} fill={'#7a4f28'} />
      <rect x={x + 6} y={y + 24} width={16} height={2} fill={OUTLINE} />
    </g>
  );
  return (
    <g shapeRendering="crispEdges">
      {pot}
      {variant === 'bush' && (
        <>
          <rect x={x + 6} y={y + 14} width={16} height={10} fill={'#1a6b3a'} />
          <rect x={x + 4} y={y + 16} width={4} height={6} fill={'#1a6b3a'} />
          <rect x={x + 20} y={y + 16} width={4} height={6} fill={'#1a6b3a'} />
          <rect x={x + 9} y={y + 10} width={10} height={6} fill={'#2a8a4f'} />
          <rect x={x + 11} y={y + 6} width={6} height={6} fill={'#2a8a4f'} />
          <rect x={x + 10} y={y + 12} width={2} height={2} fill={'#ffb547'} />
          <rect x={x + 16} y={y + 10} width={2} height={2} fill={'#ff4757'} />
        </>
      )}
      {variant === 'palm' && (
        <>
          <rect x={x + 13} y={y + 6} width={2} height={20} fill={'#5b3a1c'} />
          <rect x={x + 2}  y={y + 4}  width={10} height={2} fill={'#1a6b3a'} />
          <rect x={x + 0}  y={y + 6}  width={10} height={2} fill={'#1a6b3a'} />
          <rect x={x + 16} y={y + 4}  width={10} height={2} fill={'#1a6b3a'} />
          <rect x={x + 18} y={y + 6}  width={10} height={2} fill={'#1a6b3a'} />
          <rect x={x + 8}  y={y + 0}  width={4}  height={4} fill={'#1a6b3a'} />
          <rect x={x + 16} y={y + 0}  width={4}  height={4} fill={'#1a6b3a'} />
        </>
      )}
      {variant === 'fern' && (
        <>
          <rect x={x + 13} y={y + 0}  width={2} height={26} fill={'#2a8a4f'} />
          <rect x={x + 8}  y={y + 4}  width={2} height={22} fill={'#1a6b3a'} />
          <rect x={x + 18} y={y + 4}  width={2} height={22} fill={'#1a6b3a'} />
          <rect x={x + 4}  y={y + 10} width={2} height={16} fill={'#1a6b3a'} />
          <rect x={x + 22} y={y + 10} width={2} height={16} fill={'#1a6b3a'} />
        </>
      )}
    </g>
  );
}

function Bookshelf({ x, y, color }: { x: number; y: number; color: string }) {
  // mounted against a wall — 110 × 32 footprint
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={110} height={32} fill={'#3a2a1c'} />
      <rect x={x} y={y} width={110} height={2} fill={OUTLINE} />
      <rect x={x} y={y + 30} width={110} height={2} fill={OUTLINE} />
      <rect x={x} y={y + 14} width={110} height={2} fill={OUTLINE} />
      {[2, 8, 16, 24, 32, 42, 52, 60, 68, 76, 84, 92, 100].map((bx, i) => {
        const palette = [color, '#ff4757', '#ffd24a', color, '#22d3ee', '#a855f7'];
        const c = palette[i % palette.length];
        return <rect key={`bk1-${i}`} x={x + bx} y={y + 2} width={5} height={11} fill={c} />;
      })}
      {[3, 11, 19, 27, 36, 44, 52, 60, 70, 80, 90, 100].map((bx, i) => {
        const palette = ['#1f6fb0', color, '#7c5cff', '#ffb547', color, '#00ff9c'];
        const c = palette[i % palette.length];
        return <rect key={`bk2-${i}`} x={x + bx} y={y + 16} width={5} height={12} fill={c} />;
      })}
    </g>
  );
}

function Whiteboard({ x, y, color }: { x: number; y: number; color: string }) {
  // 140 × 60
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={140} height={60} fill={OUTLINE} />
      <rect x={x + 3} y={y + 3} width={134} height={54} fill={'#f3efe2'} />
      {/* diagram */}
      <rect x={x + 12} y={y + 14} width={18} height={18} fill={color} opacity={0.85} />
      <rect x={x + 50} y={y + 14} width={18} height={18} fill={'#ff4757'} opacity={0.85} />
      <rect x={x + 88} y={y + 14} width={18} height={18} fill={color} opacity={0.85} />
      <rect x={x + 30} y={y + 22} width={20} height={2} fill={OUTLINE} />
      <rect x={x + 68} y={y + 22} width={20} height={2} fill={OUTLINE} />
      <rect x={x + 12} y={y + 40} width={110} height={2} fill={OUTLINE} />
      <rect x={x + 18} y={y + 46} width={50} height={2} fill={OUTLINE} />
      <rect x={x + 70} y={y + 46} width={40} height={2} fill={OUTLINE} />
    </g>
  );
}

function MeetingTable({ x, y, color }: { x: number; y: number; color: string }) {
  // 220 × 80
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={220} height={80} fill={'#5b3a1c'} />
      <rect x={x} y={y} width={220} height={4} fill={'#7a4f28'} />
      <rect x={x} y={y + 76} width={220} height={4} fill={'#2a1f15'} />
      <rect x={x} y={y} width={4} height={80} fill={'#2a1f15'} />
      <rect x={x + 216} y={y} width={4} height={80} fill={'#2a1f15'} />
      {/* center holo */}
      <ellipse cx={x + 110} cy={y + 40} rx={30} ry={10} fill={color} opacity={0.25} />
      <ellipse cx={x + 110} cy={y + 40} rx={18} ry={6} fill={color} opacity={0.5} />
      <ellipse cx={x + 110} cy={y + 40} rx={6} ry={2} fill={color} opacity={0.9} />
      {/* paper sheets */}
      <rect x={x + 18} y={y + 16} width={16} height={12} fill={PAPER} />
      <rect x={x + 18} y={y + 16} width={16} height={2} fill={'#5b3a1c'} />
      <rect x={x + 188} y={y + 50} width={16} height={12} fill={PAPER} />
      <rect x={x + 188} y={y + 50} width={16} height={2} fill={'#5b3a1c'} />
    </g>
  );
}

function CoffeeStation({ x, y }: { x: number; y: number }) {
  // 120 × 50: counter + coffee machine + mugs
  return (
    <g shapeRendering="crispEdges">
      {/* counter */}
      <rect x={x} y={y + 24} width={120} height={20} fill={'#5b3a1c'} />
      <rect x={x} y={y + 24} width={120} height={3} fill={'#7a4f28'} />
      <rect x={x} y={y + 41} width={120} height={3} fill={'#2a1f15'} />
      {/* coffee machine */}
      <rect x={x + 14} y={y + 6} width={28} height={26} fill={'#1a1d24'} />
      <rect x={x + 14} y={y + 6} width={28} height={3} fill={'#262d3d'} />
      <rect x={x + 18} y={y + 12} width={20} height={6} fill={MONITOR_SCREEN} />
      <rect x={x + 20} y={y + 14} width={5} height={2} fill={'#00ff9c'} />
      <rect x={x + 26} y={y + 22} width={4} height={6} fill={OUTLINE} />
      {/* mug */}
      <rect x={x + 60} y={y + 18} width={10} height={14} fill={PAPER} />
      <rect x={x + 60} y={y + 18} width={10} height={3} fill={'#5b3a1c'} />
      {/* water dispenser */}
      <rect x={x + 84} y={y + 4} width={22} height={20} fill={'#3da9fc'} opacity={0.55} />
      <rect x={x + 84} y={y + 4} width={22} height={3} fill={'#22d3ee'} opacity={0.7} />
      <rect x={x + 84} y={y + 22} width={22} height={12} fill={'#dcdfe5'} />
      <rect x={x + 90} y={y + 28} width={5} height={3} fill={'#3da9fc'} />
      <rect x={x + 96} y={y + 28} width={5} height={3} fill={'#ff4757'} />
    </g>
  );
}

function Sofa({ x, y, color = '#3a2a4a' }: { x: number; y: number; color?: string }) {
  // 140 × 48
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y + 12} width={140} height={36} fill={color} />
      <rect x={x} y={y + 12} width={140} height={3} fill={OUTLINE} />
      <rect x={x} y={y + 45} width={140} height={3} fill={OUTLINE} />
      <rect x={x} y={y + 12} width={4} height={36} fill={OUTLINE} />
      <rect x={x + 136} y={y + 12} width={4} height={36} fill={OUTLINE} />
      <rect x={x} y={y} width={140} height={12} fill={OUTLINE} />
      <rect x={x + 4} y={y + 3} width={132} height={9} fill={color} />
      {/* seam */}
      <rect x={x + 68} y={y + 14} width={2} height={34} fill={OUTLINE} opacity={0.5} />
    </g>
  );
}

function ServerRack({ x, y }: { x: number; y: number }) {
  // 64 × 96
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={64} height={96} fill={OUTLINE} />
      <rect x={x + 3} y={y + 3} width={58} height={90} fill={'#1a1d24'} />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <g key={`r-${row}`}>
          <rect x={x + 6} y={y + 6 + row * 14} width={52} height={11} fill={'#262d3d'} />
          <rect x={x + 6} y={y + 6 + row * 14} width={52} height={2} fill={OUTLINE} />
          <rect x={x + 9}  y={y + 9 + row * 14} width={2} height={2} fill={'#00ff9c'} />
          <rect x={x + 13} y={y + 9 + row * 14} width={2} height={2} fill={row % 2 === 0 ? '#00ff9c' : '#ffb547'} />
          <rect x={x + 20} y={y + 11 + row * 14} width={32} height={2} fill={'#3a3f4a'} />
        </g>
      ))}
    </g>
  );
}

function VaultDoor({ x, y }: { x: number; y: number }) {
  // 90 × 110
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={90} height={110} fill={OUTLINE} />
      <rect x={x + 4} y={y + 4} width={82} height={102} fill={'#262d3d'} />
      <rect x={x + 4} y={y + 4} width={82} height={4} fill={'#3a3f4a'} />
      <circle cx={x + 45} cy={y + 55} r={32} fill={'#3a3f4a'} stroke={OUTLINE} strokeWidth={2} />
      <circle cx={x + 45} cy={y + 55} r={20} fill={'#262d3d'} stroke={OUTLINE} strokeWidth={1} />
      <circle cx={x + 45} cy={y + 55} r={6} fill={'#ffb547'} />
      <rect x={x + 44} y={y + 22} width={3} height={12} fill={OUTLINE} />
      <rect x={x + 44} y={y + 76} width={3} height={12} fill={OUTLINE} />
      <rect x={x + 12} y={y + 54} width={12} height={3} fill={OUTLINE} />
      <rect x={x + 66} y={y + 54} width={12} height={3} fill={OUTLINE} />
    </g>
  );
}

function BulletinBoard({ x, y, color }: { x: number; y: number; color: string }) {
  // 110 × 50
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={110} height={50} fill={OUTLINE} />
      <rect x={x + 3} y={y + 3} width={104} height={44} fill={'#6b3a18'} />
      {[0, 1, 2, 3].map((i) => (
        <g key={`c-${i}`}>
          <rect x={x + 8 + i * 24} y={y + 8} width={18} height={14} fill={PAPER} />
          <rect x={x + 8 + i * 24} y={y + 8} width={18} height={3} fill={color} />
          <rect x={x + 12 + i * 24} y={y + 16} width={10} height={2} fill={OUTLINE} />
        </g>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <g key={`d-${i}`}>
          <rect x={x + 8 + i * 24} y={y + 26} width={18} height={14} fill={PAPER} />
          <rect x={x + 8 + i * 24} y={y + 26} width={18} height={3} fill={color} />
          <rect x={x + 12 + i * 24} y={y + 34} width={10} height={2} fill={OUTLINE} />
        </g>
      ))}
    </g>
  );
}

function ZoneLabel({ x, y, glyph, label, color }: { x: number; y: number; glyph: string; label: string; color: string }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <text
        x={x}
        y={y}
        fontSize={14}
        fontFamily="ui-monospace, 'JetBrains Mono', monospace"
        fontWeight={600}
        letterSpacing={2}
        fill={color}
        opacity={0.75}
      >
        {glyph}  {label.toUpperCase()}
      </text>
    </g>
  );
}

// ---------- world component ----------

const COL = {
  market:   '#3da9fc',
  strategy: '#22d3ee',
  risk:     '#ff4757',
  memory:   '#1f6fb0',
  open:     '#7c5cff',
  debate:   '#a855f7',
  board:    '#ffd24a',
  hr:       '#ffb547',
  execution:'#00ff9c',
  coffee:   '#7a4f28',
};

export default function GenesisOfficeWorld({
  agents,
  speakingAgentId,
  speakingText,
  highlightedAgentId,
  onAgentClick,
  onAgentHover,
}: Props) {
  const speakingAgent = speakingAgentId ? agents.find((a) => a.id === speakingAgentId) ?? null : null;
  const t = useT();

  return (
    <g shapeRendering="crispEdges">
      {/* === FLOOR === */}
      <WoodFloor />

      {/* === OUTER BUILDING WALL === */}
      <Wall x={0}    y={0}    w={1600} h={10} />
      <Wall x={0}    y={890}  w={1600} h={10} />
      <Wall x={0}    y={0}    w={10}   h={900} />
      <Wall x={1590} y={0}    w={10}   h={900} />

      {/* === RUGS (open-plan zone markers) === */}
      <Rug x={40}   y={70}   w={520}  h={230} color={COL.market} />
      <Rug x={580}  y={70}   w={420}  h={230} color={COL.strategy} />
      {/* Open Workspace + Coffee */}
      <Rug x={40}   y={340}  w={1000} h={240} color={COL.open} />
      {/* Debate */}
      <Rug x={40}   y={620}  w={380}  h={260} color={COL.debate} />
      {/* Board */}
      <Rug x={440}  y={620}  w={380}  h={260} color={COL.board} />
      {/* HR */}
      <Rug x={840}  y={620}  w={300}  h={260} color={COL.hr} />
      {/* Execution */}
      <Rug x={1160} y={620}  w={400}  h={260} color={COL.execution} />

      {/* === CLOSED ROOM: RISK BUNKER (top-right) === */}
      {/* room space inside walls: x=1040..1580, y=20..320 */}
      {/* west wall, with door at y=180..235 */}
      <Wall x={1040} y={20}  w={10}   h={160} />
      <DoorFrame x={1040} y={180} w={10} h={55} color={COL.risk} />
      <Wall x={1040} y={235} w={10}   h={85} />
      {/* north wall */}
      <Wall x={1040} y={20}  w={550}  h={10} />
      {/* south wall (segment from 1040..1590) */}
      <Wall x={1040} y={310} w={550}  h={10} />
      {/* interior tint */}
      <rect x={1050} y={30} width={530} height={280} fill={COL.risk} opacity={0.06} shapeRendering="crispEdges" />
      {/* furniture inside risk bunker */}
      <VaultDoor x={1244} y={40} />
      <ServerRack x={1070} y={56} />
      <ServerRack x={1466} y={56} />
      {/* desks for risk + assistant */}
      <Desk x={1090} y={220} />
      <Desk x={1220} y={220} />
      <ChairTopDown x={1115} y={260} facing="north" />
      <ChairTopDown x={1245} y={260} facing="north" />

      {/* === CLOSED ROOM: MEMORY ARCHIVE === */}
      {/* x=1040..1580, y=360..580 */}
      <Wall x={1040} y={360} w={10}   h={100} />
      <DoorFrame x={1040} y={460} w={10} h={55} color={COL.memory} />
      <Wall x={1040} y={515} w={10}   h={65} />
      <Wall x={1040} y={580} w={550}  h={10} />
      {/* interior tint */}
      <rect x={1050} y={360} width={530} height={220} fill={COL.memory} opacity={0.08} shapeRendering="crispEdges" />
      {/* bookshelves lining north + south walls */}
      <Bookshelf x={1058} y={372} color={COL.memory} />
      <Bookshelf x={1172} y={372} color={COL.memory} />
      <Bookshelf x={1286} y={372} color={COL.memory} />
      <Bookshelf x={1400} y={372} color={COL.memory} />
      <Bookshelf x={1058} y={540} color={COL.memory} />
      <Bookshelf x={1172} y={540} color={COL.memory} />
      <Bookshelf x={1286} y={540} color={COL.memory} />
      <Bookshelf x={1400} y={540} color={COL.memory} />
      {/* memory curator's desk */}
      <Desk x={1290} y={460} />
      <ChairTopDown x={1315} y={500} facing="north" />

      {/* === MARKET DESK (open) === */}
      <ZoneLabel x={60}  y={62}  glyph="▦" label={t('hq.zone.market')} color={COL.market} />
      <Desk x={80}  y={140} />
      <Desk x={200} y={140} />
      <Desk x={320} y={140} />
      <ChairTopDown x={104} y={188} facing="north" />
      <ChairTopDown x={224} y={188} facing="north" />
      <ChairTopDown x={344} y={188} facing="north" />
      <Plant x={460} y={90}  variant="palm" />
      <Plant x={460} y={250} variant="bush" />

      {/* === STRATEGY LAB (open) === */}
      <ZoneLabel x={600} y={62}  glyph="⟁" label={t('hq.zone.strategy')} color={COL.strategy} />
      <Whiteboard x={600} y={80} color={COL.strategy} />
      <Desk x={620} y={170} />
      <Desk x={780} y={170} />
      <ChairTopDown x={644} y={220} facing="north" />
      <ChairTopDown x={804} y={220} facing="north" />
      <Plant x={950} y={250} variant="fern" />

      {/* === OPEN WORKSPACE + COFFEE === */}
      <ZoneLabel x={60}  y={334} glyph="✦" label={t('hq.zone.open')} color={COL.open} />
      {/* coffee corner top-left of open area */}
      <CoffeeStation x={60} y={370} />
      {/* sofa */}
      <Sofa x={60} y={500} color={'#2a1f3a'} />
      {/* plants as soft dividers */}
      <Plant x={220} y={360} variant="bush" />
      <Plant x={420} y={520} variant="palm" />
      <Plant x={660} y={360} variant="fern" />
      <Plant x={900} y={510} variant="bush" />
      {/* intern's small desk */}
      <Desk x={520} y={420} />
      <ChairTopDown x={544} y={470} facing="south" />

      {/* === DEBATE ROOM === */}
      <ZoneLabel x={60}  y={612} glyph="⚖" label={t('hq.zone.debate')} color={COL.debate} />
      <MeetingTable x={80} y={690} color={COL.debate} />
      <ChairTopDown x={80}  y={670} facing="south" />
      <ChairTopDown x={160} y={670} facing="south" />
      <ChairTopDown x={240} y={670} facing="south" />
      <ChairTopDown x={80}  y={780} facing="north" />
      <ChairTopDown x={160} y={780} facing="north" />
      <ChairTopDown x={240} y={780} facing="north" />
      <Plant x={360} y={850} variant="bush" />

      {/* === BOARD ROOM === */}
      <ZoneLabel x={460} y={612} glyph="◰" label={t('hq.zone.board')} color={COL.board} />
      <MeetingTable x={480} y={690} color={COL.board} />
      <ChairTopDown x={480} y={670} facing="south" />
      <ChairTopDown x={560} y={670} facing="south" />
      <ChairTopDown x={640} y={670} facing="south" />
      <ChairTopDown x={480} y={780} facing="north" />
      <ChairTopDown x={560} y={780} facing="north" />
      <ChairTopDown x={640} y={780} facing="north" />

      {/* === HR POD === */}
      <ZoneLabel x={860} y={612} glyph="⌸" label={t('hq.zone.hr')} color={COL.hr} />
      <BulletinBoard x={870} y={650} color={COL.hr} />
      <Desk x={1000} y={760} />
      <ChairTopDown x={1024} y={810} facing="north" />
      <Plant x={870} y={820} variant="bush" />

      {/* === EXECUTION DESK === */}
      <ZoneLabel x={1180} y={612} glyph="⌷" label={t('hq.zone.execution')} color={COL.execution} />
      <ServerRack x={1180} y={650} />
      <ServerRack x={1260} y={650} />
      <ServerRack x={1340} y={650} />
      <Desk x={1430} y={760} />
      <ChairTopDown x={1454} y={810} facing="north" />

      {/* === AGENTS === */}
      {agents.map((a) => (
        <AgentSprite
          key={a.id}
          agent={a}
          isSpeaking={a.id === speakingAgentId}
          highlighted={a.id === highlightedAgentId}
          onClick={() => onAgentClick(a)}
          onHover={(agent) => {
            // Forward both the agent and a screen-relative position; the SVG
            // doesn't know screen px directly, so we send 0,0 and let the
            // App-level layer use the mouse event itself instead. We just
            // emit hover events here; positions are handled by the world's
            // wrapper.
            onAgentHover(agent, 0, 0);
          }}
        />
      ))}

      {/* === SPEECH BUBBLE === */}
      {speakingAgent && speakingText && (
        <AgentConversationBubble
          x={speakingAgent.position.x}
          y={speakingAgent.position.y - 72}
          text={speakingText}
        />
      )}
    </g>
  );
}
