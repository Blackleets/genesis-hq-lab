// Pixel-style speech bubble rendered inside the world SVG, anchored above
// an agent's head. Width auto-sizes to text length (~6 chars per 8 world
// units). Tail points down toward the speaker.

interface Props {
  /** World-coord x of the speaking agent's head center */
  x: number;
  /** World-coord y of the speaking agent's head top */
  y: number;
  text: string;
}

const PADDING_X = 18;
const PADDING_Y = 10;
const LINE_HEIGHT = 22;
const FONT_SIZE = 16;
const CHAR_WIDTH = 9;

const FILL = '#0a0c12';
const TEXT = '#e6edf3';
const BORDER = '#3a3f4a';
const TAIL_HEIGHT = 12;

function wrap(text: string, maxChars = 28): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export default function AgentConversationBubble({ x, y, text }: Props) {
  const lines = wrap(text);
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(longest * CHAR_WIDTH + PADDING_X * 2, 80);
  const h = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  // Bubble bottom sits 14 world units above the head top.
  const bx = x - w / 2;
  const by = y - h - TAIL_HEIGHT - 14;

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* drop shadow */}
      <rect x={bx + 3} y={by + 3} width={w} height={h} fill="#000" opacity={0.45} />
      {/* outer border (hard pixel edges) */}
      <rect x={bx} y={by} width={w} height={h} fill={BORDER} />
      <rect x={bx + 2} y={by + 2} width={w - 4} height={h - 4} fill={FILL} />
      {/* tail */}
      <polygon
        points={`${x - 8},${by + h} ${x + 8},${by + h} ${x},${by + h + TAIL_HEIGHT}`}
        fill={BORDER}
      />
      <polygon
        points={`${x - 6},${by + h} ${x + 6},${by + h} ${x},${by + h + TAIL_HEIGHT - 3}`}
        fill={FILL}
      />
      {/* text */}
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={by + PADDING_Y + FONT_SIZE + i * LINE_HEIGHT - 2}
          fontSize={FONT_SIZE}
          fontFamily="ui-monospace, 'JetBrains Mono', monospace"
          fontWeight={500}
          fill={TEXT}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
