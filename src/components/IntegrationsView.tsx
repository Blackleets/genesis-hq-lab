// IntegrationsView — connect Genesis HQ agents to external platforms.
// Agents use these connections to execute real work (posts, issues, logs)
// when they complete tasks like campaign_launch, code_review, etc.

import { useState } from 'react';
import { useLanguage } from '../i18n/languageStore';
import { actions, useConnectors, type ConnectorConfig, type PlatformId } from '../state/genesisStore';
import { PLATFORM_METADATA, PLATFORM_GROUPS, TASK_TO_PLATFORMS } from '../data/platformCapabilities';
import { testConnector } from '../lib/connectorClient';
import PlatformIcon from './PlatformIcon';

// Derive default capabilities for a platform from TASK_TO_PLATFORMS
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
  const isError = connector?.status === 'error';
  const isPending = connector?.status === 'pending';

  const statusColor = isConnected ? '#00ff9c'
    : isError ? '#ff4757'
    : isPending ? '#ffd24a'
    : '#4a5568';

  const statusLabel = isConnected ? (lang === 'es' ? 'Conectado' : 'Connected')
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
        lastError: ok ? undefined : 'Test failed — check credentials',
      });
    } catch {
      actions.updateConnector(connector.id, { status: 'error', lastError: 'Unreachable' });
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
        id: `conn-${platform}-${Date.now()}`,
        name: meta.name,
        platform,
        config: Object.fromEntries(Object.entries(formValues).filter(([, v]) => v.trim())),
        status: 'pending',
        capabilities: defaultCapabilities(platform),
        syncCount: 0,
      });
    }
    setExpanded(false);
    setFormValues({});
  }

  function handleDisconnect() {
    if (!connector) return;
    actions.removeConnector(connector.id);
    setExpanded(false);
  }

  const capCount = defaultCapabilities(platform).length;

  return (
    <div
      className="border border-trim bg-carbon-200 flex flex-col"
      style={{ borderLeftWidth: 3, borderLeftColor: isConnected ? '#00ff9c' : meta.color + '40' }}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left w-full"
      >
        <PlatformIcon platform={platform} size={28} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] font-semibold text-zinc-100">{meta.name}</div>
          <div className="font-mono text-[9px] text-zinc-600 truncate">
            {capCount > 0
              ? `${capCount} ${lang === 'es' ? 'tipo(s) de tarea' : 'task type(s)'}`
              : (lang === 'es' ? 'Conector universal' : 'Universal connector')}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-trim px-4 py-3 space-y-3">
          {/* Description */}
          <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
            {meta.description[lang as 'es' | 'en']}
          </p>

          {/* Make.com hint for social platforms */}
          {meta.authMethod === 'make' && meta.makeScenarioHint && (
            <div className="bg-carbon-300 border border-trim p-2.5 space-y-1">
              <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                {lang === 'es' ? 'Cómo conectar (vía Make.com)' : 'How to connect (via Make.com)'}
              </div>
              <div className="font-mono text-[10px] text-zinc-400 leading-relaxed">
                {meta.makeScenarioHint[lang as 'es' | 'en']}
              </div>
              {meta.setupUrl === undefined && (
                <a
                  href="https://www.make.com/en/register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-mono text-[9px] text-purple-400 hover:text-purple-300 underline mt-1"
                >
                  {lang === 'es' ? 'Crear cuenta en Make.com →' : 'Create Make.com account →'}
                </a>
              )}
            </div>
          )}

          {/* Setup URL for direct integrations */}
          {meta.setupUrl && (
            <a
              href={meta.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-mono text-[9px] text-zinc-500 hover:text-zinc-300 underline"
            >
              {lang === 'es' ? 'Obtener credenciales →' : 'Get credentials →'}
            </a>
          )}

          {/* Config fields */}
          <div className="space-y-2">
            {meta.configFields.map((field) => (
              <div key={field.key}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
                  {field.label}
                </div>
                <input
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  defaultValue={connector?.config[field.key] ?? ''}
                  onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full bg-carbon-300 border border-trim font-mono text-[11px] text-zinc-100 px-3 py-1.5 focus:outline-none focus:border-zinc-400"
                />
              </div>
            ))}
          </div>

          {/* Sync count / last used */}
          {connector && (connector.syncCount !== undefined || connector.lastUsed) && (
            <div className="flex gap-4 font-mono text-[9px] text-zinc-700">
              {connector.syncCount !== undefined && (
                <span>{connector.syncCount} {lang === 'es' ? 'sincronizaciones' : 'syncs'}</span>
              )}
              {connector.lastUsed && (
                <span>
                  {lang === 'es' ? 'Último uso' : 'Last used'}:{' '}
                  {new Date(connector.lastUsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}

          {/* Last error */}
          {connector?.lastError && (
            <div className="font-mono text-[9px] text-red-400 bg-red-900/20 border border-red-500/20 px-2 py-1.5">
              {connector.lastError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10"
            >
              {lang === 'es' ? 'Guardar' : 'Save'}
            </button>
            {connector && (
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing}
                className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border border-trim text-zinc-400 hover:text-zinc-200 hover:border-zinc-400 disabled:opacity-40"
              >
                {testing ? '…' : (lang === 'es' ? 'Probar' : 'Test')}
              </button>
            )}
            {connector && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="font-mono text-[10px] text-red-400 hover:text-red-200 px-2 py-1.5 ml-auto"
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

// ─── Main View ────────────────────────────────────────────────────────────────

export default function IntegrationsView() {
  const lang = useLanguage();
  const connectors = useConnectors();

  const connectedCount = connectors.filter((c) => c.status === 'connected').length;
  const totalSyncs = connectors.reduce((sum, c) => sum + (c.syncCount ?? 0), 0);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-carbon-300">
      {/* Header */}
      <div className="px-6 py-5 border-b border-trim bg-carbon-200 shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400" />
          <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            Genesis HQ · {lang === 'es' ? 'Plataformas Externas' : 'External Platforms'}
          </span>
        </div>
        <h1 className="font-mono text-2xl font-bold text-zinc-100">
          {lang === 'es' ? 'Integraciones' : 'Integrations'}
        </h1>
        <div className="flex items-center gap-4 mt-1.5 font-mono text-[10px] text-zinc-500">
          <span>
            <span className="text-emerald-400 font-semibold">{connectedCount}</span>
            {' '}{lang === 'es' ? 'plataformas conectadas' : 'platforms connected'}
          </span>
          <span>·</span>
          <span>
            <span className="text-zinc-300">{totalSyncs}</span>
            {' '}{lang === 'es' ? 'sincronizaciones totales' : 'total syncs'}
          </span>
          <span>·</span>
          <span>{lang === 'es' ? '12 plataformas disponibles' : '12 platforms available'}</span>
        </div>
      </div>

      {/* Platform groups */}
      <div className="px-6 py-5 space-y-6">
        {PLATFORM_GROUPS.map((group) => (
          <section key={group.labelEn}>
            <div className="font-mono text-[9px] uppercase tracking-widest text-zinc-500 mb-3">
              {lang === 'es' ? group.labelEs : group.labelEn}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
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
