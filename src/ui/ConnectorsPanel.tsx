// ConnectorsPanel — MCP server config + quick connector list in Settings.
// Full platform management is in the Integrations module.

import { useLanguage } from '@core/i18n/languageStore';
import { useConnectors } from '@core/store/genesisStore';
import { PLATFORM_METADATA } from '@core/data/platformCapabilities';
import PlatformIcon from '@ui/PlatformIcon';

export default function ConnectorsPanel() {
  const lang = useLanguage();
  const connectors = useConnectors();

  const mcpConfigSnippet = JSON.stringify({
    mcpServers: {
      'genesis-hq': {
        command: 'node',
        args: ['C:/Users/Usuario/genesis-hq-lab/server/mcpServer.mjs'],
      },
    },
  }, null, 2);

  return (
    <div className="space-y-6">
      {/* MCP Server section */}
      <section className="gx-card">
        <header className="gx-card-head flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="gx-card-title">
              {lang === 'es' ? 'Genesis HQ como Servidor MCP' : 'Genesis HQ as MCP Server'}
            </span>
          </div>
          <span className="font-mono text-[9px] text-emerald-400 uppercase tracking-wider">
            {lang === 'es' ? 'Disponible' : 'Available'}
          </span>
        </header>
        <div className="px-4 py-3 space-y-3">
          <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">
            {lang === 'es'
              ? 'Permite a Claude Desktop controlar Genesis HQ. Herramientas: check_health, get_metrics, get_polymarket_events, create_plan, create_task.'
              : 'Allows Claude Desktop to control Genesis HQ. Tools: check_health, get_metrics, get_polymarket_events, create_plan, create_task.'}
          </p>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 mb-1.5">
              {lang === 'es' ? 'Comando de inicio' : 'Start command'}
            </div>
            <div className="gx-tile px-3 py-2 font-mono text-[11px] text-emerald-300">
              npm run mcp
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 mb-1.5">
              claude_desktop_config.json
            </div>
            <pre className="gx-tile px-3 py-2 font-mono text-[10px] text-zinc-300 overflow-x-auto whitespace-pre-wrap">
              {mcpConfigSnippet}
            </pre>
          </div>
        </div>
      </section>

      {/* Connected platforms summary */}
      <section className="gx-card">
        <header className="gx-card-head flex items-center justify-between">
          <span className="gx-card-title">
            {lang === 'es' ? 'Plataformas Conectadas' : 'Connected Platforms'}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {connectors.filter((c) => c.status === 'connected').length}/{connectors.length}
          </span>
        </header>
        {connectors.length === 0 ? (
          <div className="px-4 py-4 font-mono text-[11px] text-zinc-600">
            {lang === 'es'
              ? 'Sin plataformas configuradas. Ve a Integraciones para conectar.'
              : 'No platforms configured. Go to Integrations to connect.'}
          </div>
        ) : (
          <ul className="divide-y divide-trim">
            {connectors.map((c) => {
              const meta = PLATFORM_METADATA[c.platform];
              const isConnected = c.status === 'connected';
              return (
                <li key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <PlatformIcon platform={c.platform} size={22} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] text-zinc-200">{meta?.name ?? c.platform}</div>
                    {c.lastUsed && (
                      <div className="font-mono text-[8px] text-zinc-600">
                        {lang === 'es' ? 'Último uso' : 'Last used'}:{' '}
                        {new Date(c.lastUsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: isConnected ? '#00ff9c' : c.status === 'error' ? '#ff4757' : '#4a5568' }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
