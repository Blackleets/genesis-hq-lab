// GenesisLogo — the official Genesis HQ brand mark.
// A hexagonal network node representing multi-agent architecture:
//   - Hexagon = HQ structure (stable, interconnected)
//   - 3 outer nodes = departments (Trading, Marketing, Tech)
//   - Center node = founder / CEO agent
//   - Lines = agent communication

interface MarkProps {
  size?: number;
  glowColor?: string;
}

export function GenesisLogoMark({ size = 32, glowColor = '#00ff9c' }: MarkProps) {
  const id = `glow-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer hexagon */}
      <polygon
        points="16,1.5 27.5,8 27.5,24 16,30.5 4.5,24 4.5,8"
        stroke={glowColor}
        strokeWidth="1"
        strokeOpacity="0.35"
        fill="none"
      />

      {/* Inner hexagon */}
      <polygon
        points="16,7 22.5,10.75 22.5,18.25 16,22 9.5,18.25 9.5,10.75"
        stroke={glowColor}
        strokeWidth="0.75"
        strokeOpacity="0.2"
        fill="none"
      />

      {/* Agent connection lines */}
      <line x1="16" y1="8.5"  x2="22" y2="19.5" stroke={glowColor} strokeWidth="0.6" strokeOpacity="0.25" />
      <line x1="16" y1="8.5"  x2="10" y2="19.5" stroke={glowColor} strokeWidth="0.6" strokeOpacity="0.25" />
      <line x1="10" y1="19.5" x2="22" y2="19.5" stroke={glowColor} strokeWidth="0.6" strokeOpacity="0.25" />

      {/* Department nodes (outer) */}
      <circle cx="16" cy="8.5"  r="1.6" fill={glowColor} opacity="0.7" filter={`url(#${id})`} />
      <circle cx="22" cy="19.5" r="1.6" fill={glowColor} opacity="0.7" filter={`url(#${id})`} />
      <circle cx="10" cy="19.5" r="1.6" fill={glowColor} opacity="0.7" filter={`url(#${id})`} />

      {/* Center CEO node */}
      <circle cx="16" cy="16" r="2.8" fill={glowColor} opacity="0.15" />
      <circle cx="16" cy="16" r="1.8" fill={glowColor} opacity="0.9" filter={`url(#${id})`} />
    </svg>
  );
}

interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export function GenesisWordmark({ size = 'md', showTagline = true }: WordmarkProps) {
  const cfg = {
    sm: { name: 'text-[10px]', tag: 'text-[8px]' },
    md: { name: 'text-[12px]', tag: 'text-[8px]' },
    lg: { name: 'text-[16px]', tag: 'text-[10px]' },
  }[size];

  return (
    <div>
      <div className={`font-mono font-bold tracking-wider text-zinc-100 leading-none ${cfg.name}`}>
        GENESIS HQ
      </div>
      {showTagline && (
        <div className={`font-mono uppercase tracking-widest text-zinc-600 mt-0.5 ${cfg.tag}`}>
          Corp · GNSS
        </div>
      )}
    </div>
  );
}

// Full lockup: mark + wordmark side by side
interface LockupProps {
  size?: 'sm' | 'md' | 'lg';
  markSize?: number;
  showTagline?: boolean;
}

export default function GenesisLockup({ size = 'md', markSize, showTagline = true }: LockupProps) {
  const defaultMarkSize = { sm: 24, md: 28, lg: 40 }[size];
  return (
    <div className="flex items-center gap-2.5">
      <GenesisLogoMark size={markSize ?? defaultMarkSize} />
      <GenesisWordmark size={size} showTagline={showTagline} />
    </div>
  );
}
