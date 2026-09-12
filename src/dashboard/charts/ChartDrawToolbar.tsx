// ChartDrawToolbar — floating vertical toolbar for the chart drawing tools.
// Tool selection (cursor/trend/hline/rect), delete + clear, and the AUTO toggle.

import type { DrawTool } from './useChartDrawings';

interface Props {
  tool: DrawTool;
  onTool: (t: DrawTool) => void;
  autoOn: boolean;
  onToggleAuto: () => void;
  hasSelection: boolean;
  onDelete: () => void;
  onClear: () => void;
}

const BTN = 'flex h-7 w-7 items-center justify-center rounded text-[12px] font-mono transition-colors';

function ToolBtn({
  active, title, onClick, children, danger,
}: {
  active?: boolean; title: string; onClick: () => void; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={BTN}
      style={{
        background: active ? '#1d4ed8' : 'rgba(20,24,32,0.9)',
        color: active ? '#fff' : danger ? '#f87171' : '#9aa4b2',
        border: `1px solid ${active ? '#3b82f6' : '#2a313d'}`,
      }}
    >
      {children}
    </button>
  );
}

export function ChartDrawToolbar({
  tool, onTool, autoOn, onToggleAuto, hasSelection, onDelete, onClear,
}: Props) {
  return (
    <div
      className="absolute left-2 top-2 z-[4] flex flex-col gap-1 rounded-lg p-1"
      style={{ background: 'rgba(8,11,16,0.78)', border: '1px solid #232a35', backdropFilter: 'blur(4px)' }}
    >
      <ToolBtn active={tool === 'cursor'} title="Cursor" onClick={() => onTool('cursor')}>✛</ToolBtn>
      <ToolBtn active={tool === 'trend'} title="Línea de tendencia (2 clicks)" onClick={() => onTool('trend')}>╱</ToolBtn>
      <ToolBtn active={tool === 'hline'} title="Nivel horizontal (1 click)" onClick={() => onTool('hline')}>─</ToolBtn>
      <ToolBtn active={tool === 'rect'} title="Rectángulo / zona (2 clicks)" onClick={() => onTool('rect')}>▭</ToolBtn>
      <div className="my-0.5 h-px" style={{ background: '#232a35' }} />
      <ToolBtn title="Borrar seleccionado" onClick={onDelete} danger={hasSelection}>🗑</ToolBtn>
      <ToolBtn title="Limpiar todo" onClick={onClear} danger>✕</ToolBtn>
      <div className="my-0.5 h-px" style={{ background: '#232a35' }} />
      <button
        type="button"
        title="Auto-dibujo de soporte/resistencia y tendencias"
        onClick={onToggleAuto}
        className="flex h-7 w-7 items-center justify-center rounded text-[8px] font-mono font-bold transition-colors"
        style={{
          background: autoOn ? '#065f46' : 'rgba(20,24,32,0.9)',
          color: autoOn ? '#34d399' : '#6b7280',
          border: `1px solid ${autoOn ? '#10b981' : '#2a313d'}`,
        }}
      >
        AUTO
      </button>
    </div>
  );
}
