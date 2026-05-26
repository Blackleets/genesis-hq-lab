// Build SVG feColorMatrix values from a target hex color.
// Strategy: replace pixel color by `target * luminance`, preserving the
// sprite's shading (dark pixels stay dark, light pixels stay bright) while
// shifting the dominant hue toward `target`.
//
// We use a 20-value "matrix" (feColorMatrix type="matrix"):
//   R' = a1*R + a2*G + a3*B + a4*A + a5
//   G' = b1*R + b2*G + b3*B + b4*A + b5
//   B' = c1*R + c2*G + c3*B + c4*A + c5
//   A' = d1*R + d2*G + d3*B + d4*A + d5
//
// To collapse the input to grayscale luminance and re-tint with target:
//   R' = lumR * tR; G' = lumR * tG; B' = lumR * tB
// where lumR uses NTSC weights (0.299, 0.587, 0.114). Alpha is preserved.

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = hex.replace('#', '');
  if (n.length !== 6) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

/**
 * Build a 20-value feColorMatrix string that recolors a sprite toward
 * the target hex while preserving shading via luminance mapping.
 *
 * Returns space-separated values suitable for:
 *   <feColorMatrix type="matrix" values="..." />
 */
export function buildTintMatrix(targetHex: string): string {
  const { r, g, b } = hexToRgb(targetHex);
  // Normalize target to 0..1
  const tR = r / 255;
  const tG = g / 255;
  const tB = b / 255;
  // NTSC luminance weights
  const lR = 0.299;
  const lG = 0.587;
  const lB = 0.114;
  // For each output channel, the contribution from R/G/B is luminance * target channel.
  // Alpha passes through unchanged. No constant offset.
  const vals = [
    lR * tR, lG * tR, lB * tR, 0, 0,
    lR * tG, lG * tG, lB * tG, 0, 0,
    lR * tB, lG * tB, lB * tB, 0, 0,
    0,       0,       0,       1, 0,
  ];
  return vals.map((v) => v.toFixed(4)).join(' ');
}

/**
 * Softer variant: blends the original sprite with the recolored version
 * by `strength` (0 = original, 1 = fully tinted). Useful if pure tint
 * looks too flat.
 */
export function buildSoftTintMatrix(targetHex: string, strength = 0.7): string {
  const { r, g, b } = hexToRgb(targetHex);
  const tR = r / 255, tG = g / 255, tB = b / 255;
  const lR = 0.299, lG = 0.587, lB = 0.114;
  const s = Math.max(0, Math.min(1, strength));
  const i = 1 - s;
  // Diagonal "identity" coefficients (i on R-R, G-G, B-B) blended with luminance-tint coefficients (s)
  const vals = [
    i + s * lR * tR, s * lG * tR,     s * lB * tR,     0, 0,
    s * lR * tG,     i + s * lG * tG, s * lB * tG,     0, 0,
    s * lR * tB,     s * lG * tB,     i + s * lB * tB, 0, 0,
    0,               0,               0,               1, 0,
  ];
  return vals.map((v) => v.toFixed(4)).join(' ');
}

/** Stable id derived from a hex color (used as the SVG filter id). */
export function filterIdFor(targetHex: string, suffix = ''): string {
  return `tint-${targetHex.replace('#', '').toLowerCase()}${suffix ? `-${suffix}` : ''}`;
}
