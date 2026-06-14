// useChartDrawings.ts — manual drawing state + per-pair localStorage persistence.
// Mouse capture lives in CandleChart (it owns the chart/series for px↔value
// conversion); this hook owns the figure list, the active tool, selection, and
// persistence. AUTO figures are NOT persisted (they're recomputed live).

import { useCallback, useEffect, useState } from 'react';
import type { Figure } from './chartDrawings';

export type DrawTool = 'cursor' | 'trend' | 'hline' | 'rect';

const KEY = (pair: string) => `gx:drawings:${pair}`;

function load(pair: string): Figure[] {
  try {
    const raw = localStorage.getItem(KEY(pair));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Figure[]) : [];
  } catch {
    return [];
  }
}

export function useChartDrawings(pair: string) {
  const [tool, setTool] = useState<DrawTool>('cursor');
  const [figures, setFigures] = useState<Figure[]>(() => load(pair));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reload figures when the pair changes.
  useEffect(() => {
    setFigures(load(pair));
    setSelectedId(null);
  }, [pair]);

  // Persist on every change.
  useEffect(() => {
    try { localStorage.setItem(KEY(pair), JSON.stringify(figures)); } catch { /* quota */ }
  }, [pair, figures]);

  const addFigure = useCallback((f: Figure) => {
    setFigures((prev) => [...prev, f]);
  }, []);

  const deleteSelected = useCallback(() => {
    setSelectedId((id) => {
      if (id) setFigures((prev) => prev.filter((f) => f.id !== id));
      return null;
    });
  }, []);

  const clearAll = useCallback(() => {
    setFigures([]);
    setSelectedId(null);
  }, []);

  return {
    tool, setTool,
    figures, addFigure,
    selectedId, setSelectedId,
    deleteSelected, clearAll,
  };
}
