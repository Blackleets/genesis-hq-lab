import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, ChevronDown, LockKeyhole, Route, WifiOff, X } from 'lucide-react';

type ArbitrageEventType =
  | 'SCAN_STARTED' | 'QUOTE_RECEIVED' | 'ROUTE_FOUND' | 'COSTS_CALCULATED'
  | 'QUALIFIED' | 'OPPORTUNITY_DETECTED' | 'SIMULATION_STARTED' | 'SIMULATION_PASSED'
  | 'SIMULATION_FAILED' | 'REJECTED' | 'PAPER_EXECUTED' | 'CAPTURE_MEASURED' | 'FAILED' | 'SCAN_FAILED';

interface ArbitrageEvent {
  id: string; runId?: string; recordedAt: string; observedAt: string; type: ArbitrageEventType;
  chain: 'SOLANA'; mode: 'SHADOW' | 'PAPER'; executionAuthority: false; liveLocked: true;
  route?: string; leg?: string; venues?: string[]; inputUsdc?: number | null;
  quotedEdgeBps?: number | null; netEdgeBps?: number | null; netPnlUsd?: number | null;
  decision?: 'QUALIFIED' | 'REJECTED'; reason?: string | null; blockers?: string[];
  quoteLatencyMs?: number | null; slot?: number | null;
  grossEdgeBps?: number | null; totalCostBps?: number | null; expectedNetPnlUsd?: number | null;
  capturedNetPnlUsd?: number | null; capturedEdgeBps?: number | null; captureRatio?: number | null;
  simulationResult?: { attempted?: boolean; success?: boolean; balancesVerified?: boolean; minOutVerified?: boolean } | null;
  estimatedCosts?: Record<string, number | null> | null;
}

interface HistoryRow {
  recordedAt?: string;
  observation?: {
    observedAt?: string; status?: string; quoteLatencyMs?: number;
    venues?: { firstLeg?: string[]; secondLeg?: string[] };
    economics?: { quotedRoundTripEdgeBps?: number; netEdgeBps?: number; netPnlUsd?: number };
    captureEvidence?: { measured?: boolean; capturedEdgeBps?: number; capturedNetPnlUsd?: number; captureRatio?: number };
  };
}

interface RadarResponse {
  events?: ArbitrageEvent[]; history?: HistoryRow[];
  executionAuthority?: false; liveLocked?: true; mode?: 'SHADOW' | 'PAPER'; chain?: 'SOLANA';
}

const eventLabels: Record<ArbitrageEventType, string> = {
  SCAN_STARTED: 'Buscando', QUOTE_RECEIVED: 'Precio recibido', ROUTE_FOUND: 'Ruta encontrada',
  COSTS_CALCULATED: 'Costes calculados', QUALIFIED: 'Oportunidad',
  OPPORTUNITY_DETECTED: 'Oportunidad', SIMULATION_STARTED: 'Simulando', SIMULATION_PASSED: 'Simulada',
  SIMULATION_FAILED: 'Falló simulación', REJECTED: 'Descartada', PAPER_EXECUTED: 'Paper ejecutada',
  CAPTURE_MEASURED: 'Capturada', FAILED: 'Error', SCAN_FAILED: 'Error',
};

function bps(value?: number | null) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value); return `${n >= 0 ? '+' : ''}${n.toFixed(2)} bps`;
}
function money(value?: number | null) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value); return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
}
function ageLabel(value?: string | null) {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'ahora';
  const s = Math.floor(ms / 1000); if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h`;
}
function reasonLabel(value?: string | null) {
  const labels: Record<string,string> = {
    net_not_positive: 'Sin beneficio neto',
    atomic_simulation_missing: 'Simulación atómica pendiente',
    capture_evidence_missing: 'Evidencia pendiente',
    dex_fee_normalization_missing: 'Costes DEX pendientes',
  };
  return value ? (labels[value] ?? value.replaceAll('_', ' ')) : '—';
}
function Sparkline({ values, captured = [] }: { values: number[]; captured?: number[] }) {
  if (values.length < 2) return <div className="h-20 rounded-lg border border-white/5 bg-black/10" />;
  const allValues=[...values,...captured];
  const w=720,h=90,p=8,min=Math.min(...allValues),max=Math.max(...allValues),range=Math.max(max-min,0.01);
  const points=values.map((v,i)=>`${p+(i*(w-p*2))/(values.length-1)},${h-p-((v-min)/range)*(h-p*2)}`).join(' ');
  const zeroY=max >= 0 && min <= 0 ? h-p-((0-min)/range)*(h-p*2) : null;
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" aria-label="Net edge history">
    {zeroY !== null ? <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="currentColor" className="text-zinc-800" strokeDasharray="4 5" /> : null}
    <polyline points={points} fill="none" stroke="currentColor" className="text-[#14F195]" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    {captured.length > 1 ? <polyline points={captured.map((v,i)=>`${p+(i*(w-p*2))/(captured.length-1)},${h-p-((v-min)/range)*(h-p*2)}`).join(' ')} fill="none" stroke="currentColor" className="text-[#00C2FF]" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
  </svg>;
}

export function ArbitrageRadarPanel() {
  const [events,setEvents]=useState<ArbitrageEvent[]>([]);
  const [history,setHistory]=useState<HistoryRow[]>([]);
  const [state,setState]=useState<'loading'|'ready'|'offline'>('loading');
  const [openId,setOpenId]=useState<string|null>(null);
  const [selected,setSelected]=useState<ArbitrageEvent|null>(null);

  useEffect(()=>{
    let alive=true; let timer:ReturnType<typeof setTimeout>|null=null;
    const tick=async()=>{
      try {
        const response=await fetch('/api/genesis/context?view=solana-arbitrage-radar',{cache:'no-store'});
        if(!response.ok) throw new Error('feed unavailable');
        const body=await response.json() as RadarResponse;
        if(!alive) return;
        if(!['SHADOW','PAPER'].includes(String(body.mode))||body.executionAuthority!==false||body.liveLocked!==true||body.chain!=='SOLANA') throw new Error('safety contract');
        setEvents(Array.isArray(body.events)?body.events:[]);
        setHistory(Array.isArray(body.history)?body.history:[]);
        setState('ready');
      } catch { if(alive) setState('offline'); }
      finally { if(alive) timer=setTimeout(tick,15000); }
    };
    void tick(); return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[]);

  const decisions=useMemo(()=>events.filter(e=>['OPPORTUNITY_DETECTED','QUALIFIED','REJECTED','SIMULATION_PASSED','SIMULATION_FAILED','PAPER_EXECUTED','CAPTURE_MEASURED','FAILED','SCAN_FAILED'].includes(e.type)),[events]);
  const qualified=decisions.filter(e=>e.type==='OPPORTUNITY_DETECTED'||e.type==='QUALIFIED').length;
  const captures=decisions.filter(e=>e.type==='CAPTURE_MEASURED'&&Number.isFinite(Number(e.captureRatio)));
  const latest=decisions[0]??events[0]??null;
  const series=useMemo(()=>history.slice().reverse().map(r=>Number(r.observation?.economics?.netEdgeBps)).filter(Number.isFinite),[history]);
  const best=series.length?Math.max(...series):null;
  const latestNet=latest?.netEdgeBps ?? (series.length?series[series.length-1]:null);
  const latestPnl=latest?.netPnlUsd ?? history[0]?.observation?.economics?.netPnlUsd ?? null;
  const latestLatency=latest?.quoteLatencyMs ?? history[0]?.observation?.quoteLatencyMs ?? null;
  const captureRate=captures.length?captures.reduce((sum,event)=>sum+Number(event.captureRatio),0)/captures.length:null;
  const pnlShadow=captures.reduce((sum,event)=>sum+Number(event.capturedNetPnlUsd??0),0);
  const capturedSeries=history.slice().reverse().map(row=>Number(row.observation?.captureEvidence?.capturedEdgeBps)).filter(Number.isFinite);
  const engineStatus=latest?.type==='PAPER_EXECUTED'||latest?.type==='CAPTURE_MEASURED'?'PAPER EXECUTED':latest?.type==='SIMULATION_STARTED'?'SIMULATING':qualified>0?'OPPORTUNITY':'SCANNING';

  return <section className="space-y-3" aria-label="Solana arbitrage radar">
    <div className="rounded-xl border border-[#14F19522] bg-[#090f18] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#14F195]"><Activity size={13} className="animate-pulse"/>SOLANA ARBITRAGE · {engineStatus}</div>
          <p className="mt-1 text-[11px] text-zinc-500">Busca rutas, calcula costes y guarda cada decisión.</p>
        </div>
        <div className="flex gap-2 font-mono text-[9px] uppercase">
          <span className="rounded border border-[#14F19533] px-2 py-1 text-[#14F195]"><Bell size={10} className="mr-1 inline"/>{qualified} oportunidades</span>
          <span className="rounded border border-red-500/25 px-2 py-1 text-red-300"><LockKeyhole size={10} className="mr-1 inline"/>LIVE LOCKED</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Net Edge</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{bps(latestNet)}</strong></div>
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Best Edge</span><strong className="mt-1 block font-mono text-sm text-[#14F195]">{bps(best)}</strong></div>
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Opportunities</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{qualified}</strong></div>
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Capture Rate</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{captureRate==null?'—':`${(captureRate*100).toFixed(1)}%`}</strong></div>
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">PnL Shadow</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{captures.length?money(pnlShadow):money(latestPnl)}</strong></div>
        <div className="rounded-lg border border-white/7 bg-white/[0.02] p-3"><span className="text-[9px] uppercase tracking-wider text-zinc-600">Latency</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{latestLatency??'—'} ms</strong></div>
      </div>
      <div className="mt-3 rounded-lg border border-white/7 bg-black/10 px-2 pt-2">
        <div className="px-1 text-[9px] uppercase tracking-wider text-zinc-600">Edge neto observado</div>
        <Sparkline values={series} captured={capturedSeries}/>
        {capturedSeries.filter(Number.isFinite).length > 1 ? <div className="flex gap-4 px-1 pb-2 text-[8px] uppercase text-zinc-600"><span className="text-[#14F195]">Quoted edge</span><span className="text-[#00C2FF]">Captured edge</span></div> : null}
      </div>
    </div>

    <div className="overflow-hidden rounded-xl border border-white/8 bg-[#090f18]">
      <header className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2"><Route size={13} className="text-[#00C2FF]"/><div><strong className="block text-[11px] text-zinc-200">Actividad reciente</strong><span className="text-[9px] text-zinc-600">Solo decisiones y rutas importantes · toca para ver detalle</span></div></div>
        <span className="font-mono text-[9px] text-zinc-600">{decisions.length} decisiones</span>
      </header>
      {state==='offline'?<div className="flex items-center gap-2 px-4 py-8 text-[11px] text-zinc-500"><WifiOff size={13}/>Radar no disponible</div>:
       state==='loading'?<div className="px-4 py-8 text-[11px] text-zinc-500">Cargando radar…</div>:
       decisions.length===0?<div className="px-4 py-8 text-[11px] text-zinc-500">Buscando oportunidades…</div>:
       <div className="divide-y divide-white/5">
        {decisions.slice(0,24).map(event=>{
          const open=openId===event.id; const positive=(event.netEdgeBps??0)>0;
          const route=event.route??'USDC → SOL → USDC';
          return <div key={event.id}>
            <button type="button" onClick={()=>setOpenId(open?null:event.id)} onDoubleClick={()=>setSelected(event)} className="grid w-full grid-cols-[62px_minmax(0,1fr)_78px] items-center gap-2 px-3 py-3 text-left hover:bg-white/[0.025] sm:grid-cols-[80px_minmax(0,1fr)_100px_100px]">
              <span className="font-mono text-[9px] text-zinc-600">{new Date(event.observedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
              <span className="min-w-0"><span className="flex items-center gap-1.5"><ChevronDown size={11} className={`shrink-0 text-zinc-600 ${open?'rotate-180':''}`}/><strong className="truncate text-[11px] text-zinc-200">{route}</strong></span><span className="ml-4 block text-[9px] text-zinc-600">{reasonLabel(event.reason)}</span></span>
              <span className={`text-right font-mono text-[10px] ${positive?'text-[#14F195]':'text-zinc-400'}`}>{bps(event.netEdgeBps)}</span>
              <span className={`hidden justify-self-end rounded border px-2 py-1 font-mono text-[8px] uppercase sm:block ${event.type==='QUALIFIED'||event.type==='OPPORTUNITY_DETECTED'||event.type==='CAPTURE_MEASURED'?'border-[#14F19555] text-[#14F195]':'border-zinc-700 text-zinc-500'}`}>{eventLabels[event.type]}</span>
            </button>
            {open?<div className="grid gap-2 bg-black/15 px-4 py-3 sm:grid-cols-4">
              <div><span className="text-[8px] uppercase text-zinc-600">Capital observado</span><div className="font-mono text-[10px] text-zinc-300">{event.inputUsdc??'—'} USDC</div></div>
              <div><span className="text-[8px] uppercase text-zinc-600">Edge cotizado</span><div className="font-mono text-[10px] text-zinc-300">{bps(event.quotedEdgeBps)}</div></div>
              <div><span className="text-[8px] uppercase text-zinc-600">Latencia</span><div className="font-mono text-[10px] text-zinc-300">{event.quoteLatencyMs??'—'} ms</div></div>
              <div><span className="text-[8px] uppercase text-zinc-600">Resultado sombra</span><div className="font-mono text-[10px] text-zinc-300">{money(event.netPnlUsd)}</div></div>
              <button type="button" onClick={()=>setSelected(event)} className="rounded border border-[#14F19544] px-2 py-2 font-mono text-[9px] text-[#7cf6c3] sm:col-span-4">VER OPORTUNIDAD</button>
            </div>:null}
          </div>;
        })}
       </div>}
      <footer className="flex justify-between gap-2 border-t border-white/8 px-4 py-2 text-[8px] uppercase tracking-wider text-zinc-600"><span>Actualizado {ageLabel(latest?.observedAt)}</span><span>Observación · capital real bloqueado</span></footer>
    </div>
    {selected?<div className="fixed inset-0 z-[130] grid place-items-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Solana opportunity detail"><div className="w-full max-w-xl rounded-xl border border-[#14F19533] bg-[#090f18] shadow-2xl"><header className="flex items-center justify-between border-b border-white/8 px-4 py-3"><div><strong className="text-[11px] text-zinc-100">SOLANA OPPORTUNITY</strong><span className="ml-2 font-mono text-[9px] text-[#14F195]">{eventLabels[selected.type]}</span></div><button type="button" onClick={()=>setSelected(null)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-zinc-500" aria-label="Close opportunity"><X size={14}/></button></header><div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">{[['Route',selected.route??'USDC → SOL → USDC'],['Capital',selected.inputUsdc==null?'—':`$${selected.inputUsdc.toFixed(2)}`],['Gross edge',bps(selected.grossEdgeBps??selected.quotedEdgeBps)],['Costs',bps(selected.totalCostBps)],['Net edge',bps(selected.netEdgeBps)],['Expected PnL',money(selected.expectedNetPnlUsd??selected.netPnlUsd)],['Simulation',selected.simulationResult?.success?'PASSED':'PENDING / FAILED'],['Latency',selected.quoteLatencyMs==null?'—':`${selected.quoteLatencyMs} ms`],['Slot',selected.slot??'—'],['Captured',money(selected.capturedNetPnlUsd)],['Capture ratio',selected.captureRatio==null?'—':`${(selected.captureRatio*100).toFixed(1)}%`],['Decision',selected.decision??'—']].map(([label,value])=><div key={String(label)} className="rounded-lg border border-white/7 bg-black/15 p-3"><span className="block text-[8px] uppercase text-zinc-600">{label}</span><strong className="mt-1 block break-words font-mono text-[10px] text-zinc-200">{value}</strong></div>)}</div><details className="border-t border-white/8 px-4 py-3 text-[9px] text-zinc-500"><summary className="cursor-pointer uppercase tracking-wider">Detalles avanzados</summary><div className="mt-3 font-mono leading-5">Run: {selected.runId??'—'}<br/>Event: {selected.id}<br/>Reason: {reasonLabel(selected.reason)}<br/>Mode: {selected.mode} · LIVE LOCKED</div></details></div></div>:null}
  </section>;
}
export default ArbitrageRadarPanel;
