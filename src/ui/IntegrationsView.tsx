// IntegrationsView — high-quality integration platform cards.

import { useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { actions, useConnectors, type ConnectorConfig, type PlatformId } from '@core/store/genesisStore';
import { PLATFORM_METADATA, PLATFORM_GROUPS, TASK_TO_PLATFORMS } from '@core/data/platformCapabilities';
import { testConnector } from '@services/connectorClient';
import PlatformIcon from '@ui/PlatformIcon';

function defaultCapabilities(platform: PlatformId): string[] {
  return Object.entries(TASK_TO_PLATFORMS)
    .filter(([, platforms]) => platforms?.includes(platform))
    .map(([taskType]) => taskType);
}

// ─── Platform Card ────────────────────────────────────────────────────────────

interface PlatformCardProps {
  platform: PlatformId;
  connector: ConnectorConfig | undefined;
  lang: string;
}

function PlatformCard({ platform, connector, lang }: PlatformCardProps) {
  const meta = PLATFORM_METADATA[platform];
  const [expanded, setExpanded] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);

  const isConnected = connector?.status === 'connected';
  const isError     = connector?.status === 'error';
  const isPending   = connector?.status === 'pending';

  const statusColor = isConnected ? '#00ff9c' : isError ? '#ff4757' : isPending ? '#ffd24a' : '#374151';
  const statusLabel = isConnected
    ? (lang === 'es' ? 'Conectado' : 'Connected')
    : isError ? 'Error'
    : isPending ? (lang === 'es' ? 'Pendiente' : 'Pending')
    : (lang === 'es' ? 'Desconectado' : 'Disconnected');

  async function handleTest() {
    if (!connector) return;
    setTesting(true);
    try {
      const ok = await testConnector(connector);
      actions.updateConnector(connector.id, {
        status: ok ? 'connected' : 'error',
        lastUsed: new Date().toISOString(),
      });
    } catch {
      actions.updateConnector(connector.id, { status: 'error' });
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const hasValues = Object.values(formValues).some((v) => v.trim().length > 0);
    if (!hasValues) return;
    if (connector) {
      actions.updateConnector(connector.id, {
        config: { ...connector.config, ...Object.fromEntries(Object.entries(formValues).filter(([, v]) => v.trim())) },
        status: 'pending',
      });
    } else {
      actions.addConnector({
        id:           `conn-${platform}-${Date.now()}`,
        name:         meta.name,
        platform,
        config:       Object.fromEntries(Object.entries(formValues).filter(([, v]) => v.trim())),
        status:       'pending',
        capabilities: defaultCapabilities(platform),
        syncCount:    0,
      });
    }
    setExpanded(false);
    setFormValues({});
  }

  const capCount = defaultCapabilities(platform).length;

  return (
    <div
      className="bg-carbon-200 overflow-hidden transition-all duration-150"
      style={{
        border: `1px solid ${isConnected ? meta.color + '50' : '#262d3d'}`,
        borderLeft: `3px solid ${isConnected ? meta.color : meta.color + '30'}`,
      }}
    >
      {/* Card header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-white/[0.03] text-left transition-colors"
      >
        {/* Logo */}
        <div className="rounded-lg overflow-hidden shrink-0 shadow-lg">
          <PlatformIcon platform={platform} size={40} />
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] font-semibold text-zinc-100 leading-tight">
            {meta.name}
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mt-0.5">
            {capCount > 0
              ? `${capCount} ${lang === 'es' ? 'tipos de tarea' : 'task types'}`
              : lang === 'es' ? 'Conector universal' : 'Universal connector'}
          </div>
        </div>

        {/* Status badge */}
        <div className="shrink-0 flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor, boxShadow: isConnected ? `0 0 6px ${statusColor}80` : 'none' }}
          />
          <span
            className="font-mono text-[9px] uppercase tracking-wider"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </span>
        </div>

        {/* Expand chevron */}
        <span className="font-mono text-[10px] text-zinc-700 ml-1 shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded config panel */}
      {expanded && (
        <div className="border-t border-trim px-4 py-4 space-y-3 bg-carbon-300/40">
          {/* Description */}
          <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
            {meta.description[lang as 'es' | 'en']}
          </p>

          {/* Make.com setup hint */}
          {meta.authMethod === 'make' && meta.makeScenarioHint && (
            <div className="rounded border border-purple-500/20 bg-purple-500/5 p-3 space-y-1.5">
              <div className="font-mono text-[8px] uppercase tracking-widest text-purple-400">
                {lang === 'es' ? 'Configurar vía Make.com' : 'Set up via Make.com'}
              </div>
              <div className="font-mono text-[10px] text-zinc-400 leading-relaxed">
                {meta.makeScenarioHint[lang as 'es' | 'en']}
              </div>
              <a
                href="https://www.make.com/en/register"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[9px] text-purple-400 hover:text-purple-300 mt-1"
              >
                {lang === 'es' ? 'Crear cuenta gratuita →' : 'Create free account →'}
              </a>
            </div>
          )}

          {/* Setup URL */}
          {meta.setupUrl && (
            <a
              href={meta.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[9px] text-zinc-500 hover:text-zinc-300"
            >
              {lang === 'es' ? '↗ Obtener credenciales' : '↗ Get credentials'}
            </a>
          )}

          {/* Config fields */}
          <div className="space-y-2.5">
            {meta.configFields.map((field) => (
              <div key={field.key}>
                <label className="block font-mono text-[8px] uppercase tracking-widest text-zinc-600 mb-1">
                  {field.label}
                </label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  defaultValue={connector?.config[field.key] ?? ''}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full gx-tile font-mono text-[11px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-700"
                />
              </div>
            ))}
          </div>

          {/* Sync stats */}
          {connector && (connector.syncCount !== undefined || connector.lastUsed) && (
            <div className="flex gap-4 font-mono text-[9px] text-zinc-700">
              {connector.syncCount !== undefined && (
                <span>{connector.syncCount} {lang === 'es' ? 'syncs' : 'syncs'}</span>
              )}
              {connector.lastUsed && (
                <span>
                  {lang === 'es' ? 'Último' : 'Last'}:{' '}
                  {new Date(connector.lastUsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}

          {/* Error */}
          {connector?.lastError && (
            <div className="font-mono text-[9px] text-red-400 bg-red-900/20 border border-red-500/20 px-3 py-2">
              {connector.lastError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="font-mono text-[10px] uppercase tracking-wider px-4 py-1.5 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-400/10 transition-colors"
            >
              {lang === 'es' ? 'Guardar' : 'Save'}
            </button>
            {connector && (
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing}
                className="font-mono text-[10px] uppercase tracking-wider px-4 py-1.5 border border-trim text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-40 transition-colors"
              >
                {testing ? '…' : (lang === 'es' ? 'Probar' : 'Test')}
              </button>
            )}
            {connector && (
              <button
                type="button"
                onClick={() => actions.removeConnector(connector.id)}
                className="font-mono text-[10px] text-zinc-600 hover:text-red-400 px-2 py-1.5 ml-auto transition-colors"
              >
                {lang === 'es' ? 'Desconectar' : 'Disconnect'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function IntegrationsView() {
  const lang       = useLanguage();
  const connectors = useConnectors();

  const connectedCount = connectors.filter((c) => c.status === 'connected').length;
  const totalSyncs     = connectors.reduce((sum, c) => sum + (c.syncCount ?? 0), 0);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-carbon-300">
      {/* Page header */}
      <div className="px-6 pt-6 pb-5 border-b border-trim bg-carbon-200/60 shrink-0">
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className="font-mono text-[22px] font-bold text-zinc-100 tracking-tight">
            {lang === 'es' ? 'Integraciones' : 'Integrations'}
          </h1>
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
            Genesis HQ · {lang === 'es' ? 'Plataformas externas' : 'External platforms'}
          </span>
        </div>
        <div className="flex items-center gap-5 font-mono text-[10px]">
          <span className="text-zinc-500">
            <span className="text-emerald-400 font-semibold">{connectedCount}</span>
            {' '}{lang === 'es' ? 'conectadas' : 'connected'}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500">
            <span className="text-zinc-300">{12 - connectedCount}</span>
            {' '}{lang === 'es' ? 'disponibles' : 'available'}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500">
            <span className="text-zinc-300">{totalSyncs}</span>
            {' '}syncs
          </span>
        </div>
      </div>

      {/* Platform groups */}
      <div className="px-6 py-5 space-y-8">
        {PLATFORM_GROUPS.map((group) => (
          <section key={group.labelEn}>
            {/* Group header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="gx-overline">
                {lang === 'es' ? group.labelEs : group.labelEn}
              </span>
              <div className="flex-1 h-px bg-trim" />
              <span className="font-mono text-[9px] text-zinc-700">
                {group.platforms.length}
              </span>
            </div>

            {/* Cards grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
              {group.platforms.map((platform) => (
                <PlatformCard
                  key={platform}
                  platform={platform}
                  connector={connectors.find((c) => c.platform === platform)}
                  lang={lang}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
