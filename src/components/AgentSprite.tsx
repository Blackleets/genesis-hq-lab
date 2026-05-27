import type { Agent } from '../types/genesis';
import { officeAssets } from '../assets/officePixelAssets';
import PixelSprite from './PixelSprite';

interface Props {
  agent: Agent;
  isSpeaking?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  onHover?: (agent: Agent | null) => void;
}

const OUTLINE = '#0a0c12';
const CHARACTER_HEIGHT = 52;
const CHARACTER_WIDTH = 52;

function statusHalo(status: Agent['status']): string | null {
  switch (status) {
    case 'working': return '#00ff9c';
    case 'thinking': return '#3da9fc';
    case 'debating': return '#a855f7';
    case 'learning': return '#22d3ee';
    case 'warning': return '#ffb547';
    case 'failed': return '#ff4757';
    case 'promoted': return '#ffd24a';
    default: return null;
  }
}

function pickCharacter(agent: Agent): { src: string; frame?: { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number } } {
  if (agent.id === 'visual-genesis-core') return { src: officeAssets.characters.boss };
  if (agent.id === 'visual-market-scanner') return { src: officeAssets.characters.worker1 };
  if (agent.id === 'visual-risk-guardian') return { src: officeAssets.characters.worker2 };
  if (agent.id === 'visual-memory-curator') {
    if (agent.movementState === 'moving') {
      return {
        src: officeAssets.animations.juliaWalkForward,
        frame: { x: 64, y: 0, width: 64, height: 64, sourceWidth: 256, sourceHeight: 64 },
      };
    }
    return {
      src: officeAssets.characters.juliaIdle,
      frame: { x: 0, y: 0, width: 32, height: 32, sourceWidth: 128, sourceHeight: 32 },
    };
  }
  if (agent.id === 'visual-hr-evaluator') return { src: officeAssets.characters.worker4 };
  if (agent.department === 'Genesis HR') return { src: officeAssets.characters.worker4 };
  if (agent.department === 'Risk Office') return { src: officeAssets.characters.worker2 };
  if (agent.department === 'Memory Archive') {
    return {
      src: officeAssets.characters.juliaIdle,
      frame: { x: 0, y: 0, width: 32, height: 32, sourceWidth: 128, sourceHeight: 32 },
    };
  }
  return { src: officeAssets.characters.worker1 };
}

function Accessory({ kind, accent }: { kind: NonNullable<Agent['visualProfile']['accessory']>; accent: string }) {
  switch (kind) {
    case 'crown':
      return (
        <g shapeRendering="crispEdges">
          <rect x={6} y={-2} width={2} height={2} fill="#ffd24a" />
          <rect x={11} y={-3} width={3} height={3} fill="#ffd24a" />
          <rect x={17} y={-2} width={2} height={2} fill="#ffd24a" />
          <rect x={6} y={0} width={13} height={2} fill={accent} />
        </g>
      );
    case 'shield':
      return (
        <g shapeRendering="crispEdges">
          <rect x={24} y={24} width={6} height={8} fill={OUTLINE} />
          <rect x={24} y={24} width={6} height={2} fill="#ffb547" />
          <rect x={24} y={26} width={6} height={6} fill="#ff4757" />
        </g>
      );
    case 'glasses':
      return (
        <g shapeRendering="crispEdges">
          <rect x={8} y={10} width={5} height={4} fill={OUTLINE} />
          <rect x={17} y={10} width={5} height={4} fill={OUTLINE} />
          <rect x={13} y={11} width={4} height={2} fill={OUTLINE} />
        </g>
      );
    case 'clipboard':
      return (
        <g shapeRendering="crispEdges">
          <rect x={23} y={24} width={7} height={10} fill="#e6dac0" />
          <rect x={23} y={24} width={7} height={2} fill={accent} />
        </g>
      );
    case 'book':
      return (
        <g shapeRendering="crispEdges">
          <rect x={22} y={25} width={9} height={7} fill={OUTLINE} />
          <rect x={22} y={25} width={9} height={2} fill={accent} />
        </g>
      );
    case 'none':
    default:
      return null;
  }
}

export default function AgentSprite({ agent, isSpeaking, highlighted, onClick, onHover }: Props) {
  const haloColor = statusHalo(agent.status);
  const dim = agent.status === 'fired' || agent.status === 'suspended';
  const { src, frame } = pickCharacter(agent);
  const spriteHeight = CHARACTER_HEIGHT;
  const spriteWidth = CHARACTER_WIDTH;
  const anchorX = agent.position.x - spriteWidth / 2;
  const anchorY = agent.position.y - spriteHeight + 10;

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : undefined, opacity: dim ? 0.45 : 1 }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(agent)}
      onMouseLeave={() => onHover?.(null)}
    >
      <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={15} ry={4} fill="#000" opacity={0.34} />
      {haloColor && <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={19} ry={5} fill={haloColor} opacity={0.28} />}
      {highlighted && <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={23} ry={6} fill="#fff" opacity={0.14} />}

      <PixelSprite
        src={src}
        alt={agent.name}
        x={anchorX}
        y={anchorY}
        width={spriteWidth}
        height={spriteHeight}
        frame={frame}
      />

      <g transform={`translate(${anchorX + 14}, ${anchorY + 7})`}>
        <Accessory kind={agent.visualProfile.accessory ?? 'none'} accent={agent.visualProfile.accent} />
      </g>

      {isSpeaking && (
        <g shapeRendering="crispEdges">
          <rect x={agent.position.x + 20} y={anchorY + 4} width={3} height={3} fill="#ffffff" opacity={0.9} />
          <rect x={agent.position.x + 25} y={anchorY} width={3} height={3} fill="#ffffff" opacity={0.7} />
        </g>
      )}
    </g>
  );
}
