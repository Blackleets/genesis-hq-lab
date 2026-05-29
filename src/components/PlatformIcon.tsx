// PlatformIcon — real SVG icons for each integration platform.
// Uses /public/icons.svg symbols for GitHub and Twitter/X.
// Uses inline SVG lettermarks for all other platforms.
// No emoji, no external icon library.

import type { PlatformId } from '../state/genesisStore';

interface Props {
  platform: PlatformId;
  size?: number;
  className?: string;
}

interface LettermarkConfig {
  bg: string;
  fg: string;
  label: string;
  gradient?: [string, string];
}

const LETTERMARKS: Record<PlatformId, LettermarkConfig> = {
  facebook:   { bg: '#1877F2', fg: '#ffffff', label: 'f' },
  instagram:  { bg: '#E1306C', fg: '#ffffff', label: 'ig', gradient: ['#F77737', '#E1306C'] },
  linkedin:   { bg: '#0A66C2', fg: '#ffffff', label: 'in' },
  tiktok:     { bg: '#010101', fg: '#ffffff', label: 'tt' },
  google_ads: { bg: '#4285F4', fg: '#ffffff', label: 'G↑' },
  slack:      { bg: '#4A154B', fg: '#ECB22E', label: '#' },
  notion:     { bg: '#1a1a1a', fg: '#ffffff', label: 'N' },
  sheets:     { bg: '#34A853', fg: '#ffffff', label: '≡' },
  make:       { bg: '#6D00CC', fg: '#ffffff', label: '⚙' },
  webhook:    { bg: '#374151', fg: '#9ca3af', label: '{}' },
  // github and twitter handled via /public/icons.svg
  github:     { bg: '#24292F', fg: '#ffffff', label: '' },
  twitter:    { bg: '#000000', fg: '#ffffff', label: '' },
};

export default function PlatformIcon({ platform, size = 32, className }: Props) {
  const gradId = `grad-${platform}`;

  // GitHub — use SVG symbol from /public/icons.svg
  if (platform === 'github') {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          background: '#24292F',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width={size * 0.625} height={size * 0.625} viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.207 11.387.6.113.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
        </svg>
      </div>
    );
  }

  // Twitter/X — use X icon SVG
  if (platform === 'twitter') {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          background: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width={size * 0.5625} height={size * 0.5625} viewBox="0 0 300 300" fill="#ffffff">
          <path d="M178.57 127.15 290.27 0h-26.46l-97.03 110.38L89.34 0H0l117.13 166.93L0 300.25h26.46l102.41-116.59 81.8 116.59h89.34M36.01 19.54H76.66l187.13 262.13h-40.66" />
        </svg>
      </div>
    );
  }

  // Lettermark for all other platforms
  const cfg = LETTERMARKS[platform];
  const hasGradient = !!cfg.gradient;
  const fontSize = cfg.label.length === 1 ? size * 0.44 : cfg.label.length === 2 ? size * 0.33 : size * 0.28;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
      >
        {hasGradient && (
          <defs>
            <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={cfg.gradient![0]} />
              <stop offset="100%" stopColor={cfg.gradient![1]} />
            </linearGradient>
          </defs>
        )}
        <rect
          width="32"
          height="32"
          fill={hasGradient ? `url(#${gradId})` : cfg.bg}
        />
        <text
          x="16"
          y="16"
          textAnchor="middle"
          dominantBaseline="central"
          fill={cfg.fg}
          fontSize={Math.round(fontSize * (32 / size))}
          fontFamily="'JetBrains Mono', 'Courier New', monospace"
          fontWeight="700"
        >
          {cfg.label}
        </text>
      </svg>
    </div>
  );
}
