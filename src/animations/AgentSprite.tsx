import type { Agent } from '@core/types/genesis';
import GenesisWorker from '@animations/GenesisWorker';
import { eyeShapeForAnim, paletteForAgent, workerAnimForAgent } from '@animations/genesisWorkerDesign';

interface Props {
  agent: Agent;
  isSpeaking?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  onHover?: (agent: Agent | null) => void;
}

const CHARACTER_SIZE = 52;

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

export default function AgentSprite({ agent, isSpeaking, highlighted, onClick, onHover }: Props) {
  const haloColor = statusHalo(agent.status);
  const dim = agent.status === 'fired' || agent.status === 'suspended';

  const palette = paletteForAgent(agent);
  const anim = workerAnimForAgent(agent.status, agent.movementState);
  const eye = eyeShapeForAnim(anim);

  const size = CHARACTER_SIZE;
  const anchorX = agent.position.x - size / 2;
  // feet (~grid row 14) rest on the ground line at position.y
  const anchorY = agent.position.y - size * 0.875;

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(agent)}
      onMouseLeave={() => onHover?.(null)}
    >
      <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={15} ry={4} fill="#000" opacity={0.34} />
      {haloColor && <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={19} ry={5} fill={haloColor} opacity={0.28} />}
      {highlighted && <ellipse cx={agent.position.x} cy={agent.position.y + 1} rx={23} ry={6} fill="#fff" opacity={0.14} />}

      <GenesisWorker
        palette={palette}
        anim={anim}
        eye={eye}
        accessory={agent.visualProfile.accessory}
        x={anchorX}
        y={anchorY}
        size={size}
        dim={dim}
      />

      {isSpeaking && (
        <g shapeRendering="crispEdges">
          <rect x={agent.position.x + 20} y={anchorY + 4} width={3} height={3} fill="#ffffff" opacity={0.9} />
          <rect x={agent.position.x + 25} y={anchorY} width={3} height={3} fill="#ffffff" opacity={0.7} />
        </g>
      )}
    </g>
  );
}
