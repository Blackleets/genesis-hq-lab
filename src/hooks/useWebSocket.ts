// useWebSocket — connects to the server's /ws endpoint with auto-reconnect.
// Falls back gracefully when WebSocket is unavailable.

import { useCallback, useEffect, useRef, useState } from 'react';

export type WsMessage = {
  type:
    | 'agent:tick' | 'trade:executed' | 'trade:resolved' | 'lesson:learned' | 'capital:updated'
    | 'agent:status' | 'agent:log' | 'agent:completed';
  [key: string]: unknown;
};

type ConnectionStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketReturn {
  lastMessage: WsMessage | null;
  connectionStatus: ConnectionStatus;
}

const WS_URL = (() => {
  try {
    const base = import.meta.env?.VITE_API_BASE ?? '';
    if (base) {
      return base.replace(/^http/, 'ws') + '/ws';
    }
    return `ws://${window.location.hostname}:8787/ws`;
  } catch {
    return 'ws://localhost:8787/ws';
  }
})();

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1000;

export function useWebSocket(): UseWebSocketReturn {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef<() => void>(() => { });

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        retryCountRef.current = 0;
        setConnectionStatus('open');
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as WsMessage;
          setLastMessage(msg);
        } catch { /* ignore non-JSON */ }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setConnectionStatus('closed');
        wsRef.current = null;
        // Exponential backoff, capped at MAX_RETRIES
        if (retryCountRef.current < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current);
          retryCountRef.current++;
          timeoutRef.current = setTimeout(() => connectRef.current(), delay);
        }
      };

      ws.onerror = () => {
        ws.close();  // triggers onclose which handles retry
      };
    } catch {
      setConnectionStatus('closed');
    }
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    timeoutRef.current = setTimeout(() => {
      if (!unmountedRef.current) connectRef.current();
    }, 0);
    return () => {
      unmountedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { lastMessage, connectionStatus };
}
