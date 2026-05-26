// Speech bubble rendered above a character inside an SVG world.
// Ported from ../genesis/src/components/genesis/world/ChatBubble.tsx
// No external assets. Coordinates are in the same units as the containing
// <g transform="translate() scale()">.

import { memo } from 'react';
import { motion } from 'framer-motion';

export type BubbleKind = 'task' | 'thinking' | 'debating' | 'warning' | 'learning' | 'promoted' | 'idle';

interface Props {
  /** Optional short text. If provided overrides the glyph. Max ~22 chars. */
  text?: string;
  kind: BubbleKind;
  /** color accent of the agent (used as bubble top stripe) */
  accent?: string;
}

const FILL = '#0f131c';
const TEXT = '#e6edf3';
const OUTLINE = '#070912';

function ChatBubbleImpl({ text, kind, accent = '#3da9fc' }: Props) {
  if (kind === 'idle' && !text) return null;

  const content = text
    ? text.length > 22 ? text.slice(0, 20).trimEnd() + '…' : text
    : kind === 'thinking' ? '...' :
      kind === 'debating' ? '?!' :
      kind === 'warning'  ? '!'  :
      kind === 'learning' ? '+'  :
      kind === 'promoted' ? '★'  :
      '';

  if (!content) return null;

  const charW = 2.6;
  const padX = 4;
  const padY = 2;
  const fontSize = kind === 'task' ? 4 : 5;
  const width = Math.max(12, Math.ceil(content.length * charW * (fontSize / 4)) + padX * 2);
  const height = fontSize + padY * 2 + 2;
  const bubbleX = 6 - width / 2;
  const bubbleY = -2 - height;
  const tailX = 6 - 1;
  const tailY = -2;

  return (
    <motion.g
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 2 }}
      transition={{ duration: 0.25 }}
      shapeRendering="crispEdges"
    >
      <rect x={bubbleX - 1} y={bubbleY - 1} width={width + 2} height={height + 2} fill={OUTLINE} />
      <rect x={bubbleX} y={bubbleY} width={width} height={height} fill={FILL} />
      <rect x={bubbleX} y={bubbleY} width={width} height={1} fill={accent} opacity={0.7} />
      <rect x={tailX - 1} y={tailY - 2} width={3} height={1} fill={OUTLINE} />
      <rect x={tailX} y={tailY - 2} width={1} height={1} fill={FILL} />
      <rect x={tailX} y={tailY - 1} width={1} height={1} fill={FILL} />
      <text
        x={bubbleX + width / 2}
        y={bubbleY + padY + fontSize - 1}
        fontSize={fontSize}
        fontFamily="monospace"
        fill={TEXT}
        textAnchor="middle"
        letterSpacing={0.2}
      >
        {content}
      </text>
    </motion.g>
  );
}

const ChatBubble = memo(ChatBubbleImpl);
export default ChatBubble;
