// KenneyCharacter — uses a Kenney RPG Urban Pack character sprite as the
// base + per-agent color tint (SVG feColorMatrix) + optional role overlay
// (small SVG accessory) + status animations + chat bubble. Replaces the
// hand-coded SVG primitive character (CharacterLegacy) with a professional
// pixel-art baseline while preserving per-agent identity from the DB.
//
// Pipeline (back-to-front):
//   shadow → halo → tinted Kenney sprite → role overlay → typing arms
//   → learning particles → chat bubble → title
//
// The chat bubble priority is the same as CharacterLegacy:
//   1) chatter prop (live log message)
//   2) agent.currentTask (truncated)
//   3) status glyph fallback
//
// The "working without currentTask → render as idle" invariant is honored.

import { motion } from 'framer-motion';
import type { Agent } from '../types/genesis';
import ChatBubble, { type BubbleKind } from './ChatBubble';
import { ARCHETYPE_TO_TILE } from './KenneyAtlas';
import RoleOverlay from './RoleOverlay';
import { buildSoftTintMatrix, filterIdFor } from '../lib/colorMatrix';

interface Props {
  agent: Agent;
  x: number;
  y: number;
  pose: 'seated' | 'standing';
  /** show small accessory by role on top of sprite (default true) */
  showRoleOverlay?: boolean;
  /** strength of the color tint, 0..1 (default 0.75) */
  tintStrength?: number;
  /** live chatter from log polling — overrides currentTask */
  chatter?: string;
  onClick?: () => void;
}

const CHAR_VIEW = 16;

function LearningParticles({ accent }: { accent: string }) {
  return (
    <g shapeRendering="crispEdges">
      <motion.rect x={1} y={-3} width={1} height={1} fill={accent}
        animate={{ y: [-3, -5, -3], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.rect x={5} y={-5} width={1} height={1} fill={accent}
        animate={{ y: [-5, -7, -5], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }} />
      <motion.rect x={9} y={-4} width={1} height={1} fill={accent}
        animate={{ y: [-4, -6, -4], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }} />
      <motion.rect x={13} y={-3} width={1} height={1} fill={accent}
        animate={{ y: [-3, -5, -3], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut', delay: 0.1 }} />
    </g>
  );
}

function TypingArms({ accent }: { accent: string }) {
  // two tiny dots representing typing fingers below the sprite
  return (
    <g shapeRendering="crispEdges">
      <motion.rect x={3} y={15} width={2} height={1} fill={accent}
        animate={{ y: [15, 15.5, 15] }}
        transition={{ duration: 0.32, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.rect x={11} y={15} width={2} height={1} fill={accent}
        animate={{ y: [15, 15.5, 15] }}
        transition={{ duration: 0.32, repeat: Infinity, ease: 'easeInOut', delay: 0.16 }} />
    </g>
  );
}

export default function KenneyCharacter({
  agent, x, y, pose,
  showRoleOverlay = true,
  tintStrength = 0.75,
  chatter,
  onClick,
}: Props) {
  const { primary, accent, archetype } = agent.visualProfile;

  // Backend invariant: working without currentTask → render as idle.
  const effectiveStatus =
    agent.status === 'working' && !agent.currentTask ? 'idle' : agent.status;

  const isTyping   = effectiveStatus === 'working';
  const isThinking = effectiveStatus === 'thinking';
  const isDebating = effectiveStatus === 'debating';
  const isLearning = effectiveStatus === 'learning';
  const dim        = agent.status === 'fired' || agent.status === 'suspended';

  // Bubble priority: chatter > currentTask > status glyph.
  let bubbleKind: BubbleKind = 'idle';
  let bubbleText: string | undefined;
  if (chatter) { bubbleKind = 'task'; bubbleText = chatter; }
  else if (agent.currentTask && effectiveStatus !== 'idle') {
    bubbleKind = 'task'; bubbleText = agent.currentTask;
  }
  else if (isThinking) bubbleKind = 'thinking';
  else if (isDebating) bubbleKind = 'debating';
  else if (isLearning) bubbleKind = 'learning';
  else if (effectiveStatus === 'warning')  bubbleKind = 'warning';
  else if (effectiveStatus === 'promoted') bubbleKind = 'promoted';

  // Pose-driven motion (matches CharacterLegacy timing so it feels familiar)
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

  const tileId = ARCHETYPE_TO_TILE[archetype];
  const filterId = filterIdFor(primary, archetype);
  const opacity = dim ? 0.4 : 1;

  return (
    <motion.g
      transform={`translate(${x}, ${y})`}
      style={{ opacity, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      {...motionProps}
    >
      {/* per-agent SVG filter defined inline so each color shows correctly */}
      <defs>
        <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values={buildSoftTintMatrix(primary, tintStrength)}
          />
        </filter>
      </defs>

      {/* shadow + halo */}
      <ellipse cx={CHAR_VIEW / 2} cy={CHAR_VIEW + 1} rx={6} ry={1.2} fill="#000" opacity={0.45} />
      {haloColor && (
        <ellipse cx={CHAR_VIEW / 2} cy={CHAR_VIEW + 1} rx={7.5} ry={1.7} fill={haloColor} opacity={0.4} />
      )}

      {/* the Kenney sprite, tinted */}
      <g filter={`url(#${filterId})`}>
        <use
          href={`#t-${tileId}`}
          x={0}
          y={0}
          width={CHAR_VIEW}
          height={CHAR_VIEW}
        />
      </g>

      {/* role accessory on top of sprite */}
      {showRoleOverlay && <RoleOverlay archetype={archetype} accent={accent} />}

      {/* status overlays */}
      {isTyping && <TypingArms accent={accent} />}
      {isLearning && <LearningParticles accent={accent} />}

      {/* chat bubble */}
      <ChatBubble kind={bubbleKind} text={bubbleText} accent={accent} />

      {/* hover tooltip */}
      <title>{`${agent.name}\n${agent.role}${agent.currentTask ? `\n${agent.currentTask}` : ''}`}</title>
    </motion.g>
  );
}
