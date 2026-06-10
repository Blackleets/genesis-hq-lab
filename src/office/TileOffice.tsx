// TileOffice — React wrapper for the Phase 1 tile office canvas.
// If the tilesheet fails to load it reports up via onAssetError so HQView
// can fall back to the legacy pixel office without breaking anything.

import { useEffect, useRef, useState } from 'react';
import { OFFICE_CANVAS_H, OFFICE_CANVAS_W } from './officeLayout';
import { drawTileOffice, loadOfficeTilesheet } from './TileOfficeRenderer';

interface Props {
  onAssetError: (error: Error) => void;
}

export default function TileOffice({ onAssetError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let active = true;
    loadOfficeTilesheet()
      .then((img) => {
        if (active) setSheet(img);
      })
      .catch((error: Error) => {
        if (active) onAssetError(error);
      });
    return () => {
      active = false;
    };
    // onAssetError is a stable fallback setter in HQView; load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onAssetError(new Error('2d context unavailable'));
      return;
    }
    drawTileOffice(ctx, sheet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  return (
    <div className="relative" style={{ width: `${OFFICE_CANVAS_W}px`, height: `${OFFICE_CANVAS_H}px` }}>
      <canvas
        ref={canvasRef}
        width={OFFICE_CANVAS_W}
        height={OFFICE_CANVAS_H}
        className="block absolute inset-0"
        style={{ imageRendering: 'pixelated' }}
      />
      {!sheet && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          loading office assets…
        </div>
      )}
    </div>
  );
}
