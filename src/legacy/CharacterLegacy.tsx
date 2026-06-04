// CharacterLegacy — the SVG-primitives character ported from ../genesis.
// Kept here as the BASELINE for visual comparison in the playground.
// Do not edit this to "improve" it — the whole point is to compare against
// it. New iterations live in KenneyCharacter.tsx.

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Agent } from '@core/types/genesis';
import ChatBubble, { type BubbleKind } from '@ui/ChatBubble';

interface Props {
  agent: Agent;
  x: number; y: number;
  pose: 'seated' | 'standing';
  onClick?: () => void;
  chatter?: string;
}

function shade(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
}

type Variant =
  | 'commander' | 'analyst' | 'sentinel' | 'scientist' | 'listener'
  | 'mediator' | 'archivist' | 'guardian' | 'reviewer'
  | 'engineer' | 'designer' | 'broadcaster' | 'operator';

function variantOf(archetype: string): Variant {
  const m: Record<string, Variant> = {
    commander: 'commander', analyst: 'analyst', sentinel: 'sentinel', scientist: 'scientist',
    listener: 'listener', mediator: 'mediator', archivist: 'archivist', guardian: 'guardian',
    reviewer: 'reviewer', operator: 'operator',
    engineering: 'engineer', design: 'designer', product: 'reviewer', strategy: 'scientist',
    testing: 'analyst', finance: 'analyst', marketing: 'broadcaster', sales: 'broadcaster',
    specialized: 'guardian', 'project-management': 'reviewer', support: 'listener',
    academic: 'archivist', 'paid-media': 'broadcaster', 'game-development': 'designer',
    'spatial-computing': 'designer',
  };
  return m[archetype] ?? 'operator';
}

interface Look {
  hair: string;
  hairStyle: 'short' | 'long' | 'cap' | 'helmet' | 'bun' | 'hood' | 'crown';
  hasHeadset: boolean;
  hasGlasses: boolean;
  badge: 'shield' | 'lock' | 'tie' | 'clipboard' | 'spark' | 'book' | 'crown' | 'mic' | 'none';
  shirtAccent: string;
}

function lookFor(v: Variant, primary: string, accent: string): Look {
  switch (v) {
    case 'commander':  return { hair: '#5b6478', hairStyle: 'crown',  hasHeadset: false, hasGlasses: false, badge: 'crown',    shirtAccent: accent };
    case 'sentinel':   return { hair: shade(primary, -40), hairStyle: 'helmet', hasHeadset: false, hasGlasses: false, badge: 'shield', shirtAccent: '#ff4757' };
    case 'guardian':   return { hair: '#1b1f27', hairStyle: 'cap',    hasHeadset: false, hasGlasses: true,  badge: 'lock',     shirtAccent: '#00ff9c' };
    case 'analyst':    return { hair: '#3b2a18', hairStyle: 'short',  hasHeadset: false, hasGlasses: true,  badge: 'tie',      shirtAccent: accent };
    case 'scientist':  return { hair: '#6b6f78', hairStyle: 'short',  hasHeadset: false, hasGlasses: true,  badge: 'spark',    shirtAccent: '#22d3ee' };
    case 'listener':   return { hair: '#3b2a18', hairStyle: 'short',  hasHeadset: true,  hasGlasses: false, badge: 'mic',      shirtAccent: accent };
    case 'mediator':   return { hair: accent,    hairStyle: 'short',  hasHeadset: false, hasGlasses: false, badge: 'tie',      shirtAccent: '#7c5cff' };
    case 'archivist':  return { hair: '#8b6b3a', hairStyle: 'bun',    hasHeadset: false, hasGlasses: true,  badge: 'book',     shirtAccent: '#1f6fb0' };
    case 'reviewer':   return { hair: '#5b3a1c', hairStyle: 'long',   hasHeadset: false, hasGlasses: true,  badge: 'clipboard',shirtAccent: '#a855f7' };
    case 'engineer':   return { hair: '#1b1f27', hairStyle: 'hood',   hasHeadset: true,  hasGlasses: false, badge: 'spark',    shirtAccent: accent };
    case 'designer':   return { hair: '#a8825f', hairStyle: 'long',   hasHeadset: false, hasGlasses: false, badge: 'spark',    shirtAccent: accent };
    case 'broadcaster':return { hair: '#3b2a18', hairStyle: 'short',  hasHeadset: true,  hasGlasses: false, badge: 'mic',      shirtAccent: accent };
    default:           return { hair: '#3b2a18', hairStyle: 'short',  hasHeadset: false, hasGlasses: false, badge: 'none',     shirtAccent: accent };
  }
}

function Badge({ kind, accent }: { kind: Look['badge']; accent: string }) {
  if (kind === 'none') return null;
  const x = 5, y = 9;
  switch (kind) {
    case 'shield':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y} width={2} height={1} fill={accent} />
          <rect x={x} y={y + 1} width={2} height={1} fill="#ffb547" />
        </g>
      );
    case 'lock':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y - 1} width={2} height={1} fill="#070912" />
          <rect x={x} y={y} width={2} height={2} fill={accent} />
        </g>
      );
    case 'tie':
      return <rect x={x} y={y - 1} width={1} height={3} fill={accent} shapeRendering="crispEdges" />;
    case 'clipboard':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y} width={2} height={3} fill="#e6dac0" />
          <rect x={x} y={y} width={2} height={1} fill={accent} />
        </g>
      );
    case 'spark':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y - 1} width={1} height={1} fill={accent} />
          <rect x={x + 1} y={y + 1} width={1} height={1} fill={accent} />
          <rect x={x} y={y + 1} width={1} height={1} fill="#ffd24a" />
        </g>
      );
    case 'book':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y} width={2} height={2} fill="#1f6fb0" />
          <rect x={x + 1} y={y} width={1} height={2} fill={accent} />
        </g>
      );
    case 'crown':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y} width={2} height={1} fill="#ffd24a" />
          <rect x={x} y={y + 1} width={2} height={1} fill={accent} />
        </g>
      );
    case 'mic':
      return (
        <g shapeRendering="crispEdges">
          <rect x={x} y={y - 1} width={2} height={2} fill={accent} />
          <rect x={x} y={y + 1} width={1} height={1} fill="#070912" />
        </g>
      );
    default:
      return null;
  }
}

function SeatedBack({ p, accent, look }: { p: string; accent: string; look: Look }) {
  const pDark = shade(p, -36);
  const pLite = shade(p, 24);
  const outline = '#070912';
  return (
    <g shapeRendering="crispEdges">
      <rect x={3} y={1} width={6} height={1} fill={outline} />
      <rect x={2} y={2} width={8} height={5} fill={look.hair} />
      <rect x={2} y={2} width={1} height={5} fill={outline} />
      <rect x={9} y={2} width={1} height={5} fill={outline} />
      <rect x={2} y={6} width={8} height={1} fill={outline} />
      <rect x={3} y={1} width={6} height={1} fill={look.hair} />
      {look.hairStyle === 'long' && (
        <>
          <rect x={1} y={4} width={1} height={5} fill={look.hair} />
          <rect x={10} y={4} width={1} height={5} fill={look.hair} />
          <rect x={2} y={7} width={8} height={2} fill={look.hair} />
        </>
      )}
      {look.hairStyle === 'bun' && <rect x={4} y={-1} width={4} height={2} fill={look.hair} />}
      {look.hairStyle === 'cap' && <rect x={2} y={1} width={8} height={1} fill={shade(look.hair, 18)} />}
      {look.hairStyle === 'helmet' && (
        <>
          <rect x={2} y={1} width={8} height={1} fill={pDark} />
          <rect x={1} y={2} width={10} height={5} fill={pDark} />
          <rect x={2} y={6} width={8} height={1} fill={accent} />
        </>
      )}
      {look.hairStyle === 'hood' && (
        <>
          <rect x={1} y={1} width={10} height={6} fill={pDark} />
          <rect x={0} y={2} width={1} height={5} fill={pDark} />
          <rect x={11} y={2} width={1} height={5} fill={pDark} />
        </>
      )}
      {look.hairStyle === 'crown' && (
        <>
          <rect x={3} y={0} width={1} height={1} fill={accent} />
          <rect x={5} y={-1} width={2} height={2} fill={accent} />
          <rect x={8} y={0} width={1} height={1} fill={accent} />
        </>
      )}
      {look.hasHeadset && (
        <>
          <rect x={1} y={3} width={1} height={2} fill={accent} />
          <rect x={10} y={3} width={1} height={2} fill={accent} />
          <rect x={2} y={2} width={8} height={1} fill={accent} />
        </>
      )}
      <rect x={1} y={7} width={10} height={1} fill={outline} />
      <rect x={1} y={8} width={10} height={5} fill={p} />
      <rect x={1} y={8} width={10} height={1} fill={pLite} />
      <rect x={1} y={8} width={1} height={5} fill={pLite} />
      <rect x={10} y={8} width={1} height={5} fill={pDark} />
      <rect x={1} y={13} width={10} height={1} fill={outline} />
      <rect x={0} y={9} width={1} height={3} fill={p} />
      <rect x={11} y={9} width={1} height={3} fill={p} />
    </g>
  );
}

function StandingFront({ p, accent, look }: { p: string; accent: string; look: Look }) {
  const pDark = shade(p, -36);
  const pLite = shade(p, 24);
  const skin = '#d6b48a';
  const skinDark = '#a8895f';
  const outline = '#070912';
  return (
    <g shapeRendering="crispEdges">
      <rect x={3} y={1} width={6} height={1} fill={outline} />
      <rect x={2} y={2} width={8} height={5} fill={skin} />
      <rect x={2} y={2} width={1} height={5} fill={outline} />
      <rect x={9} y={2} width={1} height={5} fill={outline} />
      <rect x={2} y={6} width={8} height={1} fill={outline} />
      <rect x={9} y={3} width={1} height={3} fill={skinDark} />
      <rect x={3} y={1} width={6} height={2} fill={look.hair} />
      <rect x={2} y={2} width={1} height={2} fill={look.hair} />
      <rect x={9} y={2} width={1} height={2} fill={look.hair} />
      {look.hairStyle === 'long' && (
        <>
          <rect x={1} y={3} width={1} height={4} fill={look.hair} />
          <rect x={10} y={3} width={1} height={4} fill={look.hair} />
        </>
      )}
      {look.hairStyle === 'bun' && <rect x={4} y={-1} width={4} height={2} fill={look.hair} />}
      {look.hairStyle === 'cap' && <rect x={2} y={1} width={8} height={2} fill={shade(look.hair, 18)} />}
      {look.hairStyle === 'helmet' && (
        <>
          <rect x={2} y={1} width={8} height={3} fill={pDark} />
          <rect x={1} y={2} width={1} height={3} fill={pDark} />
          <rect x={10} y={2} width={1} height={3} fill={pDark} />
          <rect x={3} y={4} width={6} height={1} fill={accent} />
        </>
      )}
      {look.hairStyle === 'hood' && (
        <>
          <rect x={1} y={1} width={10} height={5} fill={pDark} />
          <rect x={0} y={3} width={1} height={4} fill={pDark} />
          <rect x={11} y={3} width={1} height={4} fill={pDark} />
        </>
      )}
      {look.hairStyle === 'crown' && (
        <>
          <rect x={3} y={0} width={1} height={1} fill={accent} />
          <rect x={5} y={-1} width={2} height={2} fill={accent} />
          <rect x={8} y={0} width={1} height={1} fill={accent} />
        </>
      )}
      {!look.hasGlasses && look.hairStyle !== 'helmet' && (
        <>
          <rect x={4} y={4} width={1} height={1} fill={outline} />
          <rect x={7} y={4} width={1} height={1} fill={outline} />
        </>
      )}
      {look.hasGlasses && (
        <>
          <rect x={3} y={4} width={2} height={1} fill={outline} />
          <rect x={5} y={4} width={2} height={1} fill={outline} />
          <rect x={3} y={3} width={2} height={1} fill={outline} />
          <rect x={5} y={3} width={2} height={1} fill={outline} />
          <rect x={3} y={5} width={2} height={1} fill={outline} />
          <rect x={5} y={5} width={2} height={1} fill={outline} />
          <rect x={4} y={4} width={1} height={1} fill={shade(accent, 30)} />
          <rect x={6} y={4} width={1} height={1} fill={shade(accent, 30)} />
        </>
      )}
      {look.hairStyle !== 'helmet' && <rect x={4} y={6} width={4} height={1} fill={skinDark} />}
      {look.hasHeadset && (
        <>
          <rect x={1} y={3} width={1} height={2} fill={accent} />
          <rect x={10} y={3} width={1} height={2} fill={accent} />
          <rect x={2} y={2} width={8} height={1} fill={accent} />
        </>
      )}
      <rect x={1} y={7} width={10} height={1} fill={outline} />
      <rect x={1} y={8} width={10} height={5} fill={p} />
      <rect x={1} y={8} width={10} height={1} fill={pLite} />
      <rect x={10} y={8} width={1} height={5} fill={pDark} />
      <rect x={5} y={8} width={2} height={4} fill={look.shirtAccent} />
      <Badge kind={look.badge} accent={look.shirtAccent} />
      <rect x={0} y={9} width={1} height={3} fill={p} />
      <rect x={11} y={9} width={1} height={3} fill={p} />
      <rect x={0} y={12} width={2} height={1} fill={skin} />
      <rect x={10} y={12} width={2} height={1} fill={skin} />
      <rect x={2} y={13} width={3} height={2} fill={pDark} />
      <rect x={7} y={13} width={3} height={2} fill={pDark} />
      <rect x={2} y={15} width={3} height={1} fill={outline} />
      <rect x={7} y={15} width={3} height={1} fill={outline} />
      <rect x={2} y={16} width={3} height={1} fill="#1a1d24" />
      <rect x={7} y={16} width={3} height={1} fill="#1a1d24" />
    </g>
  );
}

function LearningParticles({ accent }: { accent: string }) {
  return (
    <g shapeRendering="crispEdges">
      <motion.rect x={-1} y={-2} width={1} height={1} fill={accent}
        animate={{ y: [-2, -4, -2], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.rect x={3} y={-4} width={1} height={1} fill={accent}
        animate={{ y: [-4, -6, -4], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }} />
      <motion.rect x={7} y={-3} width={1} height={1} fill={accent}
        animate={{ y: [-3, -5, -3], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }} />
      <motion.rect x={11} y={-2} width={1} height={1} fill={accent}
        animate={{ y: [-2, -4, -2], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut', delay: 0.1 }} />
    </g>
  );
}

function TypingArms({ p }: { p: string }) {
  return (
    <g shapeRendering="crispEdges">
      <motion.rect x={-1} y={9} width={1} height={3} fill={p}
        animate={{ y: [9, 9.5, 9] }}
        transition={{ duration: 0.32, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.rect x={12} y={9} width={1} height={3} fill={p}
        animate={{ y: [9, 9.5, 9] }}
        transition={{ duration: 0.32, repeat: Infinity, ease: 'easeInOut', delay: 0.16 }} />
    </g>
  );
}

export default function CharacterLegacy({ agent, x, y, pose, onClick, chatter }: Props) {
  const primary = agent.visualProfile.primary;
  const accent = agent.visualProfile.accent;
  const look = useMemo(
    () => lookFor(variantOf(agent.visualProfile.archetype), primary, accent),
    [agent.visualProfile.archetype, primary, accent]
  );

  const effectiveStatus =
    agent.status === 'working' && !agent.currentTask ? 'idle' : agent.status;

  const isTyping = effectiveStatus === 'working';
  const isThinking = effectiveStatus === 'thinking';
  const isDebating = effectiveStatus === 'debating';
  const isLearning = effectiveStatus === 'learning';

  const dim = agent.status === 'fired' || agent.status === 'suspended';
  const opacity = dim ? 0.4 : 1;

  let bubbleKind: BubbleKind = 'idle';
  let bubbleText: string | undefined;
  if (chatter) { bubbleKind = 'task'; bubbleText = chatter; }
  else if (agent.currentTask && effectiveStatus !== 'idle') { bubbleKind = 'task'; bubbleText = typeof agent.currentTask === 'string' ? agent.currentTask : agent.currentTask.en; }
  else if (isThinking) bubbleKind = 'thinking';
  else if (isDebating) bubbleKind = 'debating';
  else if (isLearning) bubbleKind = 'learning';
  else if (effectiveStatus === 'warning') bubbleKind = 'warning';
  else if (effectiveStatus === 'promoted') bubbleKind = 'promoted';

  const motionProps =
    pose === 'seated' && (isTyping || isThinking || isDebating)
      ? { animate: { y: [0, -0.6, 0] }, transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' as const } }
      : pose === 'standing' && (isTyping || isDebating)
      ? { animate: { x: [0, -0.5, 0.5, 0] }, transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const } }
      : pose === 'standing'
      ? { animate: { y: [0, -0.3, 0] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const } }
      : {};

  const haloColor =
    effectiveStatus === 'warning'  ? '#ffb547' :
    effectiveStatus === 'failed'   ? '#ff4757' :
    effectiveStatus === 'promoted' ? '#ffd24a' :
    effectiveStatus === 'learning' ? '#22d3ee' :
    effectiveStatus === 'debating' ? '#7c5cff' :
    effectiveStatus === 'working'  ? '#00ff9c' :
    effectiveStatus === 'thinking' ? '#3da9fc' :
    null;

  return (
    <motion.g
      transform={`translate(${x}, ${y})`}
      style={{ opacity, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      {...motionProps}
    >
      <ellipse cx={6} cy={pose === 'standing' ? 18 : 14} rx={5.5} ry={1.1} fill="#000" opacity={0.45} />
      {haloColor && (
        <ellipse cx={6} cy={pose === 'standing' ? 18 : 14} rx={7} ry={1.6} fill={haloColor} opacity={0.35} />
      )}
      {pose === 'seated'
        ? <SeatedBack p={primary} accent={accent} look={look} />
        : <StandingFront p={primary} accent={accent} look={look} />}
      {pose === 'seated' && isTyping && <TypingArms p={primary} />}
      {isLearning && <LearningParticles accent={accent} />}
      <ChatBubble kind={bubbleKind} text={bubbleText} accent={accent} />
      <title>{`${agent.name}\n${agent.role}${agent.currentTask ? `\n${agent.currentTask}` : ''}`}</title>
    </motion.g>
  );
}
