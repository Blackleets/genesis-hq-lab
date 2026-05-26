// AgentSprite — top-down RPG-style pixel character drawn in pure SVG.
// Source grid is 16 × 24 "art pixels"; we scale ×3 so each source pixel
// becomes a 3-world-unit block (a 48 × 72 footprint). Feet are at the
// character's anchor (x, y) in world coords.

import type { Agent } from '../types/genesis';

interface Props {
  agent: Agent;
  isSpeaking?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  onHover?: (agent: Agent | null) => void;
}

const SKIN = '#e8c39a';
const SKIN_SHADE = '#a8895f';
const OUTLINE = '#0a0c12';
const EYE = '#0a0c12';
const SHOE = '#181b22';

function shade(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const adj = (v: number) => Math.max(0, Math.min(255, v + amount));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
}

function statusHalo(status: Agent['status']): string | null {
  switch (status) {
    case 'working':  return '#00ff9c';
    case 'thinking': return '#3da9fc';
    case 'debating': return '#a855f7';
    case 'learning': return '#22d3ee';
    case 'warning':  return '#ffb547';
    case 'failed':   return '#ff4757';
    case 'promoted': return '#ffd24a';
    default:         return null;
  }
}

function Accessory({ kind, accent }: { kind: NonNullable<Agent['visualProfile']['accessory']>; accent: string }) {
  // All accessories overlay on top of the head (y 0..6 area in source)
  switch (kind) {
    case 'crown':
      return (
        <g shapeRendering="crispEdges">
          <rect x={5}  y={-2} width={1} height={2} fill="#ffd24a" />
          <rect x={7}  y={-3} width={2} height={3} fill="#ffd24a" />
          <rect x={10} y={-2} width={1} height={2} fill="#ffd24a" />
          <rect x={5}  y={0}  width={6} height={1} fill={accent} />
        </g>
      );
    case 'shield':
      return (
        <g shapeRendering="crispEdges">
          <rect x={12} y={11} width={3} height={4} fill={OUTLINE} />
          <rect x={12} y={11} width={3} height={1} fill="#ffb547" />
          <rect x={12} y={12} width={3} height={3} fill="#ff4757" />
          <rect x={13} y={14} width={1} height={1} fill="#ffb547" />
        </g>
      );
    case 'lock':
      return (
        <g shapeRendering="crispEdges">
          <rect x={12} y={11} width={3} height={1} fill={OUTLINE} />
          <rect x={12} y={12} width={3} height={3} fill={accent} />
          <rect x={13} y={13} width={1} height={1} fill={OUTLINE} />
        </g>
      );
    case 'glasses':
      return (
        <g shapeRendering="crispEdges">
          <rect x={5}  y={5}  width={2} height={2} fill={OUTLINE} />
          <rect x={9}  y={5}  width={2} height={2} fill={OUTLINE} />
          <rect x={7}  y={6}  width={2} height={1} fill={OUTLINE} />
          <rect x={5}  y={5}  width={1} height={1} fill={accent} />
          <rect x={9}  y={5}  width={1} height={1} fill={accent} />
        </g>
      );
    case 'clipboard':
      return (
        <g shapeRendering="crispEdges">
          <rect x={11} y={11} width={3} height={4} fill="#e6dac0" />
          <rect x={11} y={11} width={3} height={1} fill={accent} />
          <rect x={12} y={13} width={1} height={1} fill={OUTLINE} />
        </g>
      );
    case 'flask':
      return (
        <g shapeRendering="crispEdges">
          <rect x={12} y={10} width={1} height={1} fill={OUTLINE} />
          <rect x={11} y={11} width={3} height={4} fill={OUTLINE} />
          <rect x={12} y={12} width={1} height={3} fill={accent} />
          <rect x={11} y={12} width={1} height={1} fill="#ffd24a" />
        </g>
      );
    case 'headset':
      return (
        <g shapeRendering="crispEdges">
          <rect x={5}  y={1}  width={6} height={1} fill={accent} />
          <rect x={4}  y={2}  width={1} height={3} fill={accent} />
          <rect x={11} y={2}  width={1} height={3} fill={accent} />
        </g>
      );
    case 'book':
      return (
        <g shapeRendering="crispEdges">
          <rect x={11} y={12} width={4} height={3} fill={OUTLINE} />
          <rect x={11} y={12} width={4} height={1} fill={accent} />
          <rect x={12} y={13} width={2} height={1} fill="#e6dac0" />
        </g>
      );
    case 'mic':
      return (
        <g shapeRendering="crispEdges">
          <rect x={12} y={11} width={2} height={3} fill={accent} />
          <rect x={11} y={14} width={4} height={1} fill={OUTLINE} />
        </g>
      );
    case 'wrench':
      return (
        <g shapeRendering="crispEdges">
          <rect x={12} y={10} width={2} height={1} fill={accent} />
          <rect x={12} y={11} width={2} height={4} fill={accent} />
        </g>
      );
    case 'palette':
      return (
        <g shapeRendering="crispEdges">
          <rect x={11} y={11} width={4} height={3} fill="#e6dac0" />
          <rect x={11} y={11} width={1} height={1} fill={accent} />
          <rect x={13} y={11} width={1} height={1} fill="#ff4757" />
          <rect x={12} y={12} width={1} height={1} fill="#22d3ee" />
        </g>
      );
    case 'none':
    default:
      return null;
  }
}

export default function AgentSprite({ agent, isSpeaking, highlighted, onClick, onHover }: Props) {
  const { position, visualProfile, status } = agent;
  const { primary, accent, hair = '#3a2a1c', pants = '#1a1d24', accessory = 'none' } = visualProfile;
  const dim = status === 'fired' || status === 'suspended';
  const haloColor = statusHalo(status);
  const primaryDark = shade(primary, -36);
  const primaryLight = shade(primary, 26);

  // Anchor at feet (x, y) — character extends 48 wide (24 left/right) × 72 tall up
  return (
    <g
      transform={`translate(${position.x - 24}, ${position.y - 72}) scale(3)`}
      style={{ cursor: onClick ? 'pointer' : undefined, opacity: dim ? 0.45 : 1 }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(agent)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* shadow at feet (in source coords: y=24 baseline) */}
      <ellipse cx={8} cy={24} rx={6} ry={1.1} fill="#000" opacity={0.45} />
      {haloColor && (
        <ellipse cx={8} cy={24} rx={7.5} ry={1.6} fill={haloColor} opacity={0.4} />
      )}
      {highlighted && (
        <ellipse cx={8} cy={24} rx={9} ry={2} fill="#ffffff" opacity={0.25} />
      )}

      <g shapeRendering="crispEdges">
        {/* head 6 wide × 6 tall, centered around x=5..10 (column-wise) */}
        <rect x={5} y={0} width={6} height={1} fill={OUTLINE} />
        <rect x={5} y={6} width={6} height={1} fill={OUTLINE} />
        <rect x={4} y={1} width={1} height={5} fill={OUTLINE} />
        <rect x={11} y={1} width={1} height={5} fill={OUTLINE} />
        <rect x={5} y={1} width={6} height={5} fill={SKIN} />
        {/* face shadow side (right) */}
        <rect x={10} y={2} width={1} height={4} fill={SKIN_SHADE} />
        {/* hair top */}
        <rect x={5} y={0} width={6} height={2} fill={hair} />
        <rect x={4} y={1} width={1} height={2} fill={hair} />
        <rect x={11} y={1} width={1} height={2} fill={hair} />
        {/* eyes */}
        <rect x={6} y={3} width={1} height={1} fill={EYE} />
        <rect x={9} y={3} width={1} height={1} fill={EYE} />
        {/* mouth */}
        <rect x={7} y={5} width={2} height={1} fill={SKIN_SHADE} />

        {/* neck */}
        <rect x={7} y={7} width={2} height={1} fill={SKIN_SHADE} />

        {/* torso (10 wide × 6 tall) */}
        <rect x={3} y={8}  width={10} height={1} fill={OUTLINE} />
        <rect x={3} y={9}  width={10} height={6} fill={primary} />
        <rect x={3} y={9}  width={10} height={1} fill={primaryLight} />
        <rect x={12} y={10} width={1}  height={5} fill={primaryDark} />
        <rect x={2} y={9}  width={1}  height={6} fill={OUTLINE} />
        <rect x={13} y={9} width={1}  height={6} fill={OUTLINE} />
        <rect x={3} y={15} width={10} height={1} fill={OUTLINE} />

        {/* accent stripe (tie / zipper) */}
        <rect x={7} y={9}  width={2} height={6} fill={accent} />
        <rect x={7} y={9}  width={2} height={1} fill={shade(accent, 24)} />

        {/* arms (3 wide × 5 tall each, hands beneath torso) */}
        <rect x={1} y={10} width={1} height={5} fill={primary} />
        <rect x={0} y={10} width={1} height={5} fill={OUTLINE} />
        <rect x={1} y={15} width={1} height={1} fill={SKIN} />
        <rect x={14} y={10} width={1} height={5} fill={primary} />
        <rect x={15} y={10} width={1} height={5} fill={OUTLINE} />
        <rect x={14} y={15} width={1} height={1} fill={SKIN} />

        {/* legs (4 wide each) */}
        <rect x={4} y={16} width={3} height={6} fill={pants} />
        <rect x={9} y={16} width={3} height={6} fill={pants} />
        <rect x={3} y={16} width={1} height={6} fill={OUTLINE} />
        <rect x={7} y={16} width={1} height={6} fill={OUTLINE} />
        <rect x={8} y={16} width={1} height={6} fill={OUTLINE} />
        <rect x={12} y={16} width={1} height={6} fill={OUTLINE} />
        <rect x={4} y={16} width={3} height={1} fill={shade(pants, 20)} />
        <rect x={9} y={16} width={3} height={1} fill={shade(pants, 20)} />

        {/* shoes */}
        <rect x={3} y={22} width={5} height={2} fill={SHOE} />
        <rect x={8} y={22} width={5} height={2} fill={SHOE} />
        <rect x={3} y={22} width={5} height={1} fill={shade(SHOE, 18)} />
        <rect x={8} y={22} width={5} height={1} fill={shade(SHOE, 18)} />

        {/* role accessory */}
        <Accessory kind={accessory} accent={accent} />

        {/* "speaking" indicator: tiny dots above head */}
        {isSpeaking && (
          <g>
            <rect x={11} y={-2} width={1} height={1} fill="#ffffff" opacity={0.9} />
            <rect x={13} y={-3} width={1} height={1} fill="#ffffff" opacity={0.7} />
          </g>
        )}
      </g>
    </g>
  );
}
