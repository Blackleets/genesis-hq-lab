// chartDrawings.ts — figure types + a lightweight-charts v5 series primitive that
// renders both manual and AUTO figures onto the chart canvas. Coordinates are
// anchored to (time, price) so figures pan/zoom with the chart.

import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export type Figure =
  | { id: string; type: 'trend'; t1: number; p1: number; t2: number; p2: number; color: string; auto?: boolean }
  | { id: string; type: 'hline'; price: number; color: string; label?: string; auto?: boolean }
  | { id: string; type: 'rect'; t1: number; p1: number; t2: number; p2: number; color: string; auto?: boolean };

export interface DrawState {
  manual: Figure[];
  auto: Figure[];
  draft: Figure | null;     // figure being drawn right now
  selectedId: string | null;
  showAuto: boolean;
}

const EMPTY: DrawState = { manual: [], auto: [], draft: null, selectedId: null, showAuto: true };

function hexA(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

class DrawingsRenderer implements IPrimitivePaneRenderer {
  private src: DrawingsPrimitive;
  constructor(src: DrawingsPrimitive) { this.src = src; }

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.src.chart;
    const series = this.src.series;
    if (!chart || !series) return;
    const st = this.src.state;
    const ts = chart.timeScale();

    const x = (t: number): number | null => ts.timeToCoordinate(t as Time) as number | null;
    const y = (p: number): number | null => series.priceToCoordinate(p) as number | null;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const W = scope.mediaSize.width;
      const figures = [...(st.showAuto ? st.auto : []), ...st.manual];
      if (st.draft) figures.push(st.draft);

      for (const f of figures) {
        const selected = f.id === st.selectedId;
        const auto = f.auto === true;
        ctx.save();
        ctx.lineWidth = selected ? 2.5 : auto ? 1 : 1.6;
        ctx.strokeStyle = f.color;
        ctx.setLineDash(auto ? [5, 4] : []);
        ctx.globalAlpha = auto ? 0.7 : 1;

        if (f.type === 'hline') {
          const yy = y(f.price);
          if (yy == null) { ctx.restore(); continue; }
          ctx.beginPath();
          ctx.moveTo(0, yy);
          ctx.lineTo(W, yy);
          ctx.stroke();
          if (f.label) {
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.font = '10px ui-monospace, monospace';
            ctx.fillStyle = f.color;
            ctx.fillText(f.label, 6, yy - 3);
          }
        } else if (f.type === 'trend') {
          const x1 = x(f.t1); const y1 = y(f.p1);
          const x2 = x(f.t2); const y2 = y(f.p2);
          if (x1 == null || y1 == null || x2 == null || y2 == null) { ctx.restore(); continue; }
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          // extend auto trend lines to the right edge so the channel is readable
          if (auto && x2 !== x1) {
            const slope = (y2 - y1) / (x2 - x1);
            ctx.lineTo(W, y2 + slope * (W - x2));
          }
          ctx.stroke();
        } else if (f.type === 'rect') {
          const x1 = x(f.t1); const y1 = y(f.p1);
          const x2 = x(f.t2); const y2 = y(f.p2);
          if (x1 == null || y1 == null || x2 == null || y2 == null) { ctx.restore(); continue; }
          const left = Math.min(x1, x2); const top = Math.min(y1, y2);
          const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
          ctx.fillStyle = hexA(f.color, auto ? 0.06 : 0.12);
          ctx.fillRect(left, top, w, h);
          ctx.strokeRect(left, top, w, h);
        }
        ctx.restore();
      }
    });
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  private src: DrawingsPrimitive;
  constructor(src: DrawingsPrimitive) { this.src = src; }
  zOrder(): 'top' { return 'top'; }
  renderer(): IPrimitivePaneRenderer { return new DrawingsRenderer(this.src); }
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  state: DrawState = EMPTY;
  private _view = new DrawingsPaneView(this);
  private _requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this._requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this._requestUpdate = null;
  }
  updateAllViews(): void { /* state pushed via setState */ }
  paneViews(): readonly IPrimitivePaneView[] { return [this._view]; }

  setState(next: DrawState): void {
    this.state = next;
    this._requestUpdate?.();
  }
}
