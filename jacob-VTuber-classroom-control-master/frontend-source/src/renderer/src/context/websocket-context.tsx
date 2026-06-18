/* eslint-disable react/jsx-no-constructed-context-values */
import React, { useContext, useCallback, useEffect } from 'react';
import { wsService } from '@/services/websocket-service';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const isElectronRuntime = () => typeof window !== 'undefined' && window.api !== undefined;

const getRuntimeBaseUrl = () => {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:12393';
  }

  if (isElectronRuntime()) {
    return 'http://127.0.0.1:12393';
  }

  return window.location.origin.replace(/\/+$/, '');
};

const getRuntimeWsUrl = () => {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:12393/client-ws';
  }

  if (isElectronRuntime()) {
    return 'ws://127.0.0.1:12393/client-ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/client-ws`;
};

const isLoopbackUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch (error) {
    return false;
  }
};

const replaceUrlOrigin = (rawUrl: string, nextOrigin: string) => {
  try {
    const parsed = new URL(rawUrl);
    const targetOrigin = new URL(nextOrigin);
    parsed.protocol = targetOrigin.protocol;
    parsed.host = targetOrigin.host;
    return parsed.toString();
  } catch (error) {
    return rawUrl;
  }
};

const normalizeStoredBaseUrl = (rawUrl: string) => {
  const runtimeBaseUrl = getRuntimeBaseUrl();
  if (isElectronRuntime()) {
    return rawUrl || runtimeBaseUrl;
  }

  if (!rawUrl) {
    return runtimeBaseUrl;
  }

  return isLoopbackUrl(rawUrl) ? replaceUrlOrigin(rawUrl, runtimeBaseUrl) : rawUrl;
};

const normalizeStoredWsUrl = (rawUrl: string) => {
  const runtimeWsUrl = getRuntimeWsUrl();
  if (isElectronRuntime()) {
    return rawUrl || runtimeWsUrl;
  }

  if (!rawUrl) {
    return runtimeWsUrl;
  }

  return isLoopbackUrl(rawUrl) ? replaceUrlOrigin(rawUrl, runtimeWsUrl) : rawUrl;
};

const DEFAULT_WS_URL = getRuntimeWsUrl();
const DEFAULT_BASE_URL = getRuntimeBaseUrl();

export interface HistoryInfo {
  uid: string;
  latest_message: {
    role: 'human' | 'ai';
    timestamp: string;
    content: string;
  } | null;
  timestamp: string | null;
}

interface WebSocketContextProps {
  sendMessage: (message: object) => void;
  wsState: string;
  reconnect: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
}

export const WebSocketContext = React.createContext<WebSocketContextProps>({
  sendMessage: wsService.sendMessage.bind(wsService),
  wsState: 'CLOSED',
  reconnect: () => wsService.connect(DEFAULT_WS_URL),
  wsUrl: DEFAULT_WS_URL,
  setWsUrl: () => {},
  baseUrl: DEFAULT_BASE_URL,
  setBaseUrl: () => {},
});

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export const defaultWsUrl = DEFAULT_WS_URL;
export const defaultBaseUrl = DEFAULT_BASE_URL;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [storedWsUrl, setStoredWsUrl] = useLocalStorage('wsUrl', DEFAULT_WS_URL);
  const [storedBaseUrl, setStoredBaseUrl] = useLocalStorage('baseUrl', DEFAULT_BASE_URL);
  const wsUrl = normalizeStoredWsUrl(storedWsUrl);
  const baseUrl = normalizeStoredBaseUrl(storedBaseUrl);
  const handleSetWsUrl = useCallback((url: string) => {
    const normalizedUrl = normalizeStoredWsUrl(url);
    setStoredWsUrl(normalizedUrl);
    wsService.connect(normalizedUrl);
  }, [setStoredWsUrl]);

  const handleSetBaseUrl = useCallback((url: string) => {
    const normalizedUrl = normalizeStoredBaseUrl(url);
    setStoredBaseUrl(normalizedUrl);
  }, [setStoredBaseUrl]);

  useEffect(() => {
    if (storedWsUrl !== wsUrl) {
      setStoredWsUrl(wsUrl);
    }
  }, [storedWsUrl, wsUrl, setStoredWsUrl]);

  useEffect(() => {
    if (storedBaseUrl !== baseUrl) {
      setStoredBaseUrl(baseUrl);
    }
  }, [storedBaseUrl, baseUrl, setStoredBaseUrl]);

  const value = {
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState: 'CLOSED',
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl: handleSetWsUrl,
    baseUrl,
    setBaseUrl: handleSetBaseUrl,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
