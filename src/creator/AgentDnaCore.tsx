// AgentDnaCore — the living "digital being" that forms as the user builds it.
// Pure SVG + CSS. Reacts to the draft: color, archetype glyph, skill rings, accessory.

import { PERSONALITY_GENES, type AgentDraft } from '@creator/creatorData';

interface Props {
  draft: AgentDraft;
  /** 0..1 — overall completion, drives intensity */
  intensity: number;
  size?: number;
}

export default function AgentDnaCore({ draft, intensity, size = 220 }: Props) {
  const gene = draft.archetype
    ? PERSONALITY_GENES.find((g) => g.archetype === draft.archetype)
    : null;

  const primary = draft.primaryColor;
  const accent = draft.accentColor;
  const glyph = gene?.glyph ?? '◯';
  const skillCount = draft.skills.length;
  const cx = size / 2;
  const cy = size / 2;

  // Intensity drives glow strength + pulse speed
  const glowBlur = 8 + intensity * 22;
  const pulseSpeed = 3.2 - intensity * 1.2; // faster as it completes

  return (
    <div className="relative select-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id="dna-core-grad" cx="38%" cy="35%" r="75%">
            <stop offset="0%" stopColor={lighten(primary)} />
            <stop offset="55%" stopColor={primary} />
            <stop offset="100%" stopColor={darken(primary)} />
          </radialGradient>
          <filter id="dna-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={glowBlur} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Outer orbital rings (one per skill) ── */}
        {Array.from({ length: Math.min(skillCount, 6) }).map((_, i) => {
          const r = 58 + i * 13;
          const dur = 14 + i * 5;
          const reverse = i % 2 === 0;
          return (
            <g key={i} style={{
              transformOrigin: `${cx}px ${cy}px`,
              animation: `dna-spin-${reverse ? 'cw' : 'ccw'} ${dur}s linear infinite`,
            }}>
              <circle
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={accent}
                strokeWidth={1}
                strokeOpacity={0.18 + intensity * 0.12}
                strokeDasharray={`${4 + i} ${10 + i * 3}`}
              />
              {/* orbiting node */}
              <circle cx={cx + r} cy={cy} r={2.4} fill={accent} opacity={0.8} />
            </g>
          );
        })}

        {/* ── Pulse halo ── */}
        <circle
          cx={cx} cy={cy} r={46}
          fill="none"
          stroke={primary}
          strokeWidth={1.5}
          opacity={0.5}
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: `dna-pulse ${pulseSpeed}s ease-in-out infinite` }}
        />

        {/* ── Core orb ── */}
        <circle
          cx={cx} cy={cy} r={40}
          fill="url(#dna-core-grad)"
          filter="url(#dna-glow)"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: `dna-breathe ${pulseSpeed}s ease-in-out infinite` }}
        />

        {/* ── Inner energy ring ── */}
        <circle
          cx={cx} cy={cy} r={32}
          fill="none"
          stroke={lighten(accent)}
          strokeWidth={1}
          strokeOpacity={0.4}
          strokeDasharray="2 6"
          style={{ transformOrigin: `${cx}px ${cy}px`, animation: 'dna-spin-cw 8s linear infinite' }}
        />

        {/* ── Archetype glyph ── */}
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={30}
          fill="#0a0c12"
          fontWeight="bold"
          opacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          {glyph}
        </text>
      </svg>

      {/* ── Accessory badge ── */}
      {draft.accessory !== 'none' && (
        <div
          className="absolute flex items-center justify-center font-mono"
          style={{
            top: size * 0.16, right: size * 0.18,
            width: 26, height: 26,
            borderRadius: '50%',
            background: '#0a0c12',
            border: `1.5px solid ${accent}`,
            color: accent,
            fontSize: 13,
            boxShadow: `0 0 10px ${accent}66`,
          }}
        >
          {accessoryGlyph(draft.accessory)}
        </div>
      )}

      <style>{DNA_KEYFRAMES}</style>
    </div>
  );
}

function accessoryGlyph(a: string): string {
  const map: Record<string, string> = {
    shield: '⛨', glasses: '◉', crown: '♛', headset: '⌖',
    flask: '⚗', book: '▤', lock: '⚿', clipboard: '▤',
    mic: '⌗', wrench: '⚙', palette: '◍',
  };
  return map[a] ?? '◆';
}

// Color helpers — shift lightness via simple hex math
function lighten(hex: string): string { return shade(hex, 38); }
function darken(hex: string): string { return shade(hex, -45); }
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
function clamp(v: number): number { return Math.max(0, Math.min(255, v)); }

const DNA_KEYFRAMES = `
@keyframes dna-breathe {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.06); }
}
@keyframes dna-pulse {
  0%        { transform: scale(1);   opacity: 0.5; }
  70%       { transform: scale(1.5); opacity: 0;   }
  100%      { transform: scale(1.5); opacity: 0;   }
}
@keyframes dna-spin-cw  { from { transform: rotate(0deg); }   to { transform: rotate(360deg); } }
@keyframes dna-spin-ccw { from { transform: rotate(0deg); }   to { transform: rotate(-360deg); } }
`;
