import { useId } from 'react';

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface Props {
  src: string;
  alt: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  className?: string;
  opacity?: number;
  frame?: Frame;
}

export default function PixelSprite({ src, alt, x, y, width, height, scale = 1, className, opacity = 1, frame }: Props) {
  const clipId = useId().replace(/:/g, '_');
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  if (!frame) {
    return (
      <g role="img" aria-label={alt} className={className} opacity={opacity}>
        <title>{alt}</title>
        <image
          href={src}
          x={x}
          y={y}
          width={scaledWidth}
          height={scaledHeight}
          preserveAspectRatio="xMidYMid meet"
          style={{ imageRendering: 'pixelated', userSelect: 'none' }}
          onDragStart={(event) => event.preventDefault()}
        />
      </g>
    );
  }

  const scaleX = scaledWidth / frame.width;
  const scaleY = scaledHeight / frame.height;

  return (
    <g role="img" aria-label={alt} className={className} opacity={opacity}>
      <title>{alt}</title>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={scaledWidth} height={scaledHeight} />
        </clipPath>
      </defs>
      <image
        href={src}
        x={x - frame.x * scaleX}
        y={y - frame.y * scaleY}
        width={frame.sourceWidth * scaleX}
        height={frame.sourceHeight * scaleY}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="none"
        style={{ imageRendering: 'pixelated', userSelect: 'none' }}
        onDragStart={(event) => event.preventDefault()}
      />
    </g>
  );
}
