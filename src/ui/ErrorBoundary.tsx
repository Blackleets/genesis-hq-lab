// ErrorBoundary — last line of defense against a blank/black screen.
// Catches any render/lifecycle error in the whole tree (including wallet
// providers) and shows a visible recovery screen instead of an empty page.
// Also surfaces the real error text so failures are diagnosable in the field.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] captured:', error, info);
    this.setState({ info: info.componentStack ?? null });
  }

  private hardReset = () => {
    try { window.localStorage.clear(); } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'ui-monospace, monospace',
        padding: 24, textAlign: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 40 }}>💊</div>
        <h1 style={{ fontSize: 18, margin: 0, color: '#f87171' }}>
          Algo se rompió al cargar Génesis HQ
        </h1>
        <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 520, lineHeight: 1.5 }}>
          La app encontró un error y no pudo dibujar la pantalla. Casi siempre se
          arregla borrando los datos locales de esta sesión (no afecta tu wallet
          ni el backend).
        </p>
        <button
          type="button"
          onClick={this.hardReset}
          style={{
            background: '#10b981', color: '#04110b', border: 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 14,
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          🔄 Borrar datos locales y recargar
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: 'transparent', color: '#94a3b8',
            border: '1px solid #334155', borderRadius: 8,
            padding: '8px 16px', fontSize: 13, cursor: 'pointer',
          }}
        >
          Solo reintentar
        </button>
        <details style={{ marginTop: 12, maxWidth: 640, width: '100%', textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b' }}>
            Detalle técnico del error
          </summary>
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11,
            color: '#fca5a5', background: '#111827', padding: 12,
            borderRadius: 8, marginTop: 8, maxHeight: 240, overflow: 'auto',
          }}>
            {String(error?.message ?? error)}
            {info ? `\n\n${info}` : ''}
          </pre>
        </details>
      </div>
    );
  }
}
