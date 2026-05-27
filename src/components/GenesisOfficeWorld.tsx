import type { JSX } from 'react';
import type { Agent } from '../types/genesis';
import { officeAssets } from '../assets/officePixelAssets';
import AgentConversationBubble from './AgentConversationBubble';
import AgentSprite from './AgentSprite';
import PixelSprite from './PixelSprite';
import { useT } from '../i18n/languageStore';

interface Props {
  agents: Agent[];
  speakingAgentId: string | null;
  speakingText: string | null;
  highlightedAgentId: string | null;
  onAgentClick: (agent: Agent) => void;
  onAgentHover: (agent: Agent | null, screenX: number, screenY: number) => void;
}

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;

const FLOOR_BASE = '#3a2a1c';
const FLOOR_PLANK = '#2a1f15';
const FLOOR_HIGHLIGHT = '#4a3a2a';
const WALL_FILL = '#181d28';
const WALL_TRIM = '#262d3d';
const OUTLINE = '#0a0c12';
const PAPER = '#e6dac0';

const SPRITE_SCALE = {
  furniture: 0.88,
  chair: 0.78,
  prop: 0.82,
  plant: 0.74,
  partition: 0.8,
} as const;

function WoodFloor() {
  const planks: JSX.Element[] = [];

  for (let y = 0; y < WORLD_HEIGHT; y += 32) {
    planks.push(<rect key={`p-${y}`} x={0} y={y} width={WORLD_WIDTH} height={1} fill={FLOOR_PLANK} />);
    const offsets = [80, 280, 480, 700, 920, 1140, 1380];
    offsets.forEach((offset, i) => {
      const seamX = (offset + (Math.floor(y / 32) % 2) * 60) % WORLD_WIDTH;
      planks.push(<rect key={`v-${y}-${i}`} x={seamX} y={y} width={1} height={32} fill={FLOOR_PLANK} />);
    });
  }

  const highlights = [
    [120, 60], [900, 120], [1300, 200], [220, 400], [780, 520],
    [1180, 480], [320, 700], [800, 750], [1260, 760],
  ] as const;

  return (
    <g shapeRendering="crispEdges">
      <rect x={0} y={0} width={WORLD_WIDTH} height={WORLD_HEIGHT} fill={FLOOR_BASE} />
      {planks}
      {highlights.map(([hx, hy], i) => (
        <rect key={`h-${i}`} x={hx} y={hy} width={26} height={2} fill={FLOOR_HIGHLIGHT} opacity={0.36} />
      ))}
    </g>
  );
}

function Rug({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={h} fill={color} opacity={0.06} />
      <rect x={x + 8} y={y + 8} width={w - 16} height={h - 16} fill="#0b0d13" opacity={0.05} />
      <rect x={x + 8} y={y + 8} width={w - 16} height={2} fill={color} opacity={0.18} />
      <rect x={x + 8} y={y + h - 10} width={w - 16} height={2} fill={color} opacity={0.1} />
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
  return (
    <g shapeRendering="crispEdges" style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={h} fill={color} opacity={0.45} />
      <rect x={x} y={y} width={w} height={2} fill={color} opacity={0.78} />
      <rect x={x} y={y + h - 2} width={w} height={2} fill={color} opacity={0.78} />
    </g>
  );
}

function Desk({ x, y }: { x: number; y: number }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.deskWithPc}
        alt="Office desk with PC"
        x={x}
        y={y}
        width={72}
        height={72}
        scale={SPRITE_SCALE.furniture}
      />
      <PixelSprite
        src={officeAssets.furniture.pc1}
        alt="Desk terminal"
        x={x + 24}
        y={y + 6}
        width={18}
        height={18}
        scale={SPRITE_SCALE.prop}
        opacity={0.88}
      />
    </g>
  );
}

function ChairTopDown({ x, y, facing = 'south' }: { x: number; y: number; facing?: 'north' | 'south' | 'east' | 'west' }) {
  const rotation = facing === 'north' ? 180 : facing === 'east' ? 270 : facing === 'west' ? 90 : 0;

  return (
    <g transform={`rotate(${rotation} ${x + 13} ${y + 13})`} style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.chair}
        alt={`Office chair facing ${facing}`}
        x={x}
        y={y}
        width={26}
        height={26}
        scale={SPRITE_SCALE.chair}
      />
    </g>
  );
}

function Plant({ x, y, variant = 'bush' }: { x: number; y: number; variant?: 'bush' | 'palm' | 'fern' }) {
  const size = variant === 'palm' ? 48 : variant === 'fern' ? 36 : 32;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.plant}
        alt={`${variant} office plant`}
        x={x}
        y={y}
        width={size}
        height={size}
        scale={SPRITE_SCALE.plant}
      />
    </g>
  );
}

function Bookshelf({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.cabinet}
        alt="Archive cabinet"
        x={x}
        y={y - 6}
        width={46}
        height={46}
        scale={SPRITE_SCALE.furniture}
      />
      <PixelSprite
        src={officeAssets.furniture.cabinet}
        alt="Archive cabinet"
        x={x + 42}
        y={y - 6}
        width={46}
        height={46}
        scale={SPRITE_SCALE.furniture}
      />
      <rect x={x + 8} y={y + 8} width={74} height={3} fill={color} opacity={0.18} />
    </g>
  );
}

function Whiteboard({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={140} height={60} fill={OUTLINE} />
      <rect x={x + 3} y={y + 3} width={134} height={54} fill="#f3efe2" />
      <rect x={x + 12} y={y + 14} width={18} height={18} fill={color} opacity={0.85} />
      <rect x={x + 50} y={y + 14} width={18} height={18} fill="#ff4757" opacity={0.85} />
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
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={220} height={80} fill="#5b3a1c" />
      <rect x={x} y={y} width={220} height={4} fill="#7a4f28" />
      <rect x={x} y={y + 76} width={220} height={4} fill="#2a1f15" />
      <rect x={x} y={y} width={4} height={80} fill="#2a1f15" />
      <rect x={x + 216} y={y} width={4} height={80} fill="#2a1f15" />
      <ellipse cx={x + 110} cy={y + 40} rx={28} ry={9} fill={color} opacity={0.16} />
      <ellipse cx={x + 110} cy={y + 40} rx={16} ry={5} fill={color} opacity={0.36} />
      <rect x={x + 18} y={y + 16} width={16} height={12} fill={PAPER} />
      <rect x={x + 18} y={y + 16} width={16} height={2} fill="#5b3a1c" />
      <rect x={x + 188} y={y + 50} width={16} height={12} fill={PAPER} />
      <rect x={x + 188} y={y + 50} width={16} height={2} fill="#5b3a1c" />
    </g>
  );
}

function CoffeeStation({ x, y }: { x: number; y: number }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.writingTable}
        alt="Coffee station counter"
        x={x}
        y={y + 10}
        width={68}
        height={68}
        scale={SPRITE_SCALE.furniture}
      />
      <PixelSprite
        src={officeAssets.furniture.coffeeMaker}
        alt="Coffee maker"
        x={x + 8}
        y={y + 3}
        width={34}
        height={34}
        scale={SPRITE_SCALE.prop}
      />
      <PixelSprite
        src={officeAssets.furniture.sink}
        alt="Utility sink"
        x={x + 40}
        y={y + 6}
        width={24}
        height={24}
        scale={SPRITE_SCALE.prop}
        opacity={0.86}
      />
      <PixelSprite
        src={officeAssets.furniture.waterCooler}
        alt="Water cooler"
        x={x + 76}
        y={y + 8}
        width={20}
        height={40}
        scale={SPRITE_SCALE.prop}
      />
      <PixelSprite
        src={officeAssets.furniture.trash}
        alt="Trash bin"
        x={x + 52}
        y={y + 34}
        width={14}
        height={14}
        scale={SPRITE_SCALE.prop}
      />
    </g>
  );
}

function Sofa({ x, y, color = '#3a2a4a' }: { x: number; y: number; color?: string }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y + 12} width={140} height={36} fill={color} />
      <rect x={x} y={y + 12} width={140} height={3} fill={OUTLINE} />
      <rect x={x} y={y + 45} width={140} height={3} fill={OUTLINE} />
      <rect x={x} y={y + 12} width={4} height={36} fill={OUTLINE} />
      <rect x={x + 136} y={y + 12} width={4} height={36} fill={OUTLINE} />
      <rect x={x} y={y} width={140} height={12} fill={OUTLINE} />
      <rect x={x + 4} y={y + 3} width={132} height={9} fill={color} />
      <rect x={x + 68} y={y + 14} width={2} height={34} fill={OUTLINE} opacity={0.4} />
    </g>
  );
}

function ServerRack({ x, y, scale = 0.82 }: { x: number; y: number; scale?: number }) {
  const width = 64 * scale;
  const height = 96 * scale;

  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={width} height={height} fill={OUTLINE} />
      <rect x={x + 3 * scale} y={y + 3 * scale} width={58 * scale} height={90 * scale} fill="#1a1d24" />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <g key={`r-${row}`}>
          <rect x={x + 6 * scale} y={y + 6 * scale + row * 14 * scale} width={52 * scale} height={11 * scale} fill="#262d3d" />
          <rect x={x + 6 * scale} y={y + 6 * scale + row * 14 * scale} width={52 * scale} height={2 * scale} fill={OUTLINE} />
          <rect x={x + 9 * scale} y={y + 9 * scale + row * 14 * scale} width={2 * scale} height={2 * scale} fill="#00ff9c" />
          <rect x={x + 13 * scale} y={y + 9 * scale + row * 14 * scale} width={2 * scale} height={2 * scale} fill={row % 2 === 0 ? '#00ff9c' : '#ffb547'} />
          <rect x={x + 20 * scale} y={y + 11 * scale + row * 14 * scale} width={32 * scale} height={2 * scale} fill="#3a3f4a" />
        </g>
      ))}
    </g>
  );
}

function VaultDoor({ x, y }: { x: number; y: number }) {
  return (
    <g shapeRendering="crispEdges">
      <rect x={x} y={y} width={90} height={110} fill={OUTLINE} />
      <rect x={x + 4} y={y + 4} width={82} height={102} fill="#262d3d" />
      <rect x={x + 4} y={y + 4} width={82} height={4} fill="#3a3f4a" />
      <circle cx={x + 45} cy={y + 55} r={32} fill="#3a3f4a" stroke={OUTLINE} strokeWidth={2} />
      <circle cx={x + 45} cy={y + 55} r={20} fill="#262d3d" stroke={OUTLINE} strokeWidth={1} />
      <circle cx={x + 45} cy={y + 55} r={6} fill="#ffb547" />
      <rect x={x + 44} y={y + 22} width={3} height={12} fill={OUTLINE} />
      <rect x={x + 44} y={y + 76} width={3} height={12} fill={OUTLINE} />
      <rect x={x + 12} y={y + 54} width={12} height={3} fill={OUTLINE} />
      <rect x={x + 66} y={y + 54} width={12} height={3} fill={OUTLINE} />
    </g>
  );
}

function BulletinBoard({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={officeAssets.furniture.writingTable}
        alt="HR notice table"
        x={x + 14}
        y={y - 2}
        width={68}
        height={68}
        scale={SPRITE_SCALE.furniture}
      />
      <PixelSprite
        src={officeAssets.furniture.printer}
        alt="HR printer"
        x={x + 6}
        y={y + 22}
        width={42}
        height={21}
        scale={SPRITE_SCALE.prop}
      />
      <rect x={x + 58} y={y + 12} width={34} height={5} fill={color} opacity={0.24} />
      <rect x={x + 58} y={y + 22} width={28} height={3} fill={PAPER} opacity={0.92} />
      <rect x={x + 58} y={y + 30} width={32} height={3} fill={PAPER} opacity={0.92} />
    </g>
  );
}

function OfficePartition({
  x,
  y,
  width,
  height,
  variant = 'partition1',
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  variant?: 'partition1' | 'partition2';
}) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <PixelSprite
        src={variant === 'partition1' ? officeAssets.office.partition1 : officeAssets.office.partition2}
        alt="Office partition"
        x={x}
        y={y}
        width={width}
        height={height}
        scale={SPRITE_SCALE.partition}
      />
    </g>
  );
}

function ZoneLabel({ x, y, glyph, label, color }: { x: number; y: number; glyph: string; label: string; color: string }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <text
        x={x}
        y={y}
        fontSize={11}
        fontFamily="ui-monospace, 'JetBrains Mono', monospace"
        fontWeight={600}
        letterSpacing={1.4}
        fill={color}
        opacity={0.58}
      >
        {glyph} {label.toUpperCase()}
      </text>
    </g>
  );
}

const COL = {
  market: '#3da9fc',
  strategy: '#22d3ee',
  risk: '#ff4757',
  memory: '#1f6fb0',
  open: '#7c5cff',
  debate: '#a855f7',
  board: '#ffd24a',
  hr: '#ffb547',
  execution: '#00ff9c',
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
      <WoodFloor />

      <Wall x={0} y={0} w={WORLD_WIDTH} h={10} />
      <Wall x={0} y={WORLD_HEIGHT - 10} w={WORLD_WIDTH} h={10} />
      <Wall x={0} y={0} w={10} h={WORLD_HEIGHT} />
      <Wall x={WORLD_WIDTH - 10} y={0} w={10} h={WORLD_HEIGHT} />

      <Rug x={44} y={78} w={510} h={214} color={COL.market} />
      <Rug x={580} y={78} w={404} h={214} color={COL.strategy} />
      <Rug x={44} y={344} w={986} h={234} color={COL.open} />
      <Rug x={46} y={628} w={374} h={248} color={COL.debate} />
      <Rug x={438} y={628} w={364} h={248} color={COL.board} />
      <Rug x={836} y={628} w={296} h={248} color={COL.hr} />
      <Rug x={1154} y={628} w={394} h={248} color={COL.execution} />

      <Wall x={1040} y={20} w={10} h={160} />
      <DoorFrame x={1040} y={180} w={10} h={55} color={COL.risk} />
      <Wall x={1040} y={235} w={10} h={85} />
      <Wall x={1040} y={20} w={550} h={10} />
      <Wall x={1040} y={310} w={550} h={10} />
      <rect x={1050} y={30} width={530} height={280} fill={COL.risk} opacity={0.055} />
      <VaultDoor x={1244} y={40} />
      <ServerRack x={1070} y={62} scale={0.8} />
      <ServerRack x={1468} y={62} scale={0.8} />
      <Desk x={1098} y={220} />
      <Desk x={1220} y={220} />
      <ChairTopDown x={1120} y={266} facing="north" />
      <ChairTopDown x={1242} y={266} facing="north" />
      <OfficePartition x={1364} y={204} width={76} height={76} variant="partition2" />

      <Wall x={1040} y={360} w={10} h={100} />
      <DoorFrame x={1040} y={460} w={10} h={55} color={COL.memory} />
      <Wall x={1040} y={515} w={10} h={65} />
      <Wall x={1040} y={580} w={550} h={10} />
      <rect x={1050} y={360} width={530} height={220} fill={COL.memory} opacity={0.065} />
      <Bookshelf x={1060} y={374} color={COL.memory} />
      <Bookshelf x={1150} y={374} color={COL.memory} />
      <Bookshelf x={1240} y={374} color={COL.memory} />
      <Bookshelf x={1330} y={374} color={COL.memory} />
      <Bookshelf x={1420} y={374} color={COL.memory} />
      <Bookshelf x={1060} y={540} color={COL.memory} />
      <Bookshelf x={1150} y={540} color={COL.memory} />
      <Bookshelf x={1240} y={540} color={COL.memory} />
      <Bookshelf x={1330} y={540} color={COL.memory} />
      <Bookshelf x={1420} y={540} color={COL.memory} />
      <Desk x={1288} y={454} />
      <ChairTopDown x={1310} y={500} facing="north" />
      <PixelSprite
        src={officeAssets.furniture.printer}
        alt="Archive printer"
        x={1176}
        y={452}
        width={52}
        height={26}
        scale={SPRITE_SCALE.prop}
      />

      <ZoneLabel x={64} y={58} glyph="M" label={t('hq.zone.market')} color={COL.market} />
      <Desk x={92} y={146} />
      <Desk x={208} y={146} />
      <Desk x={324} y={146} />
      <ChairTopDown x={114} y={194} facing="north" />
      <ChairTopDown x={230} y={194} facing="north" />
      <ChairTopDown x={346} y={194} facing="north" />
      <Plant x={458} y={112} variant="palm" />
      <Plant x={458} y={236} variant="bush" />
      <OfficePartition x={494} y={126} width={76} height={76} variant="partition1" />

      <ZoneLabel x={604} y={58} glyph="S" label={t('hq.zone.strategy')} color={COL.strategy} />
      <Whiteboard x={620} y={94} color={COL.strategy} />
      <Desk x={630} y={176} />
      <Desk x={774} y={176} />
      <ChairTopDown x={652} y={224} facing="north" />
      <ChairTopDown x={796} y={224} facing="north" />
      <Plant x={938} y={236} variant="fern" />
      <PixelSprite
        src={officeAssets.furniture.pc2}
        alt="Strategy side terminal"
        x={892}
        y={126}
        width={28}
        height={28}
        scale={SPRITE_SCALE.prop}
      />

      <ZoneLabel x={64} y={332} glyph="O" label={t('hq.zone.open')} color={COL.open} />
      <CoffeeStation x={70} y={378} />
      <Sofa x={72} y={500} color="#2a1f3a" />
      <Plant x={224} y={374} variant="bush" />
      <Plant x={420} y={516} variant="palm" />
      <Plant x={654} y={372} variant="fern" />
      <Plant x={888} y={504} variant="bush" />
      <Desk x={518} y={424} />
      <ChairTopDown x={540} y={470} facing="south" />
      <OfficePartition x={688} y={400} width={82} height={82} variant="partition2" />
      <OfficePartition x={796} y={400} width={82} height={82} variant="partition1" />

      <ZoneLabel x={64} y={610} glyph="D" label={t('hq.zone.debate')} color={COL.debate} />
      <MeetingTable x={84} y={696} color={COL.debate} />
      <ChairTopDown x={96} y={676} facing="south" />
      <ChairTopDown x={174} y={676} facing="south" />
      <ChairTopDown x={252} y={676} facing="south" />
      <ChairTopDown x={96} y={782} facing="north" />
      <ChairTopDown x={174} y={782} facing="north" />
      <ChairTopDown x={252} y={782} facing="north" />
      <Plant x={350} y={836} variant="bush" />

      <ZoneLabel x={462} y={610} glyph="B" label={t('hq.zone.board')} color={COL.board} />
      <MeetingTable x={482} y={696} color={COL.board} />
      <ChairTopDown x={494} y={676} facing="south" />
      <ChairTopDown x={572} y={676} facing="south" />
      <ChairTopDown x={650} y={676} facing="south" />
      <ChairTopDown x={494} y={782} facing="north" />
      <ChairTopDown x={572} y={782} facing="north" />
      <ChairTopDown x={650} y={782} facing="north" />

      <ZoneLabel x={862} y={610} glyph="H" label={t('hq.zone.hr')} color={COL.hr} />
      <BulletinBoard x={876} y={654} color={COL.hr} />
      <Desk x={994} y={752} />
      <ChairTopDown x={1016} y={798} facing="north" />
      <Plant x={872} y={814} variant="bush" />
      <OfficePartition x={934} y={722} width={82} height={82} variant="partition1" />
      <PixelSprite
        src={officeAssets.furniture.cabinet}
        alt="HR archive cabinet"
        x={956}
        y={654}
        width={42}
        height={42}
        scale={SPRITE_SCALE.furniture}
      />
      <PixelSprite
        src={officeAssets.furniture.cabinet}
        alt="Onboarding cabinet"
        x={1078}
        y={658}
        width={42}
        height={42}
        scale={SPRITE_SCALE.furniture}
      />

      <ZoneLabel x={1182} y={610} glyph="X" label={t('hq.zone.execution')} color={COL.execution} />
      <ServerRack x={1184} y={654} scale={0.76} />
      <ServerRack x={1254} y={654} scale={0.76} />
      <ServerRack x={1324} y={654} scale={0.76} />
      <Desk x={1428} y={752} />
      <ChairTopDown x={1450} y={798} facing="north" />
      <OfficePartition x={1442} y={694} width={76} height={76} variant="partition2" />
      <PixelSprite
        src={officeAssets.furniture.pc2}
        alt="Execution terminal"
        x={1480}
        y={660}
        width={30}
        height={30}
        scale={SPRITE_SCALE.prop}
      />

      {agents.map((agent) => (
        <AgentSprite
          key={agent.id}
          agent={agent}
          isSpeaking={agent.id === speakingAgentId}
          highlighted={agent.id === highlightedAgentId}
          onClick={() => onAgentClick(agent)}
          onHover={(hoveredAgent) => {
            onAgentHover(hoveredAgent, 0, 0);
          }}
        />
      ))}

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
