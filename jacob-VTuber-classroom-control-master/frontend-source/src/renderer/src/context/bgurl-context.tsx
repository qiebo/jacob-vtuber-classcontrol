import {
  createContext, useMemo, useContext, useState, useCallback, useEffect,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useWebSocket } from './websocket-context';

/**
 * Background URL context state interface
 * @interface BgUrlContextState
 */
export interface BgUrlContextState {
  backgroundUrl: string;
  setBackgroundUrl: (url: string) => void;
  backgroundFiles: string[];
  setBackgroundFiles: (files: string[]) => void;
  resetBackground: () => void;
  addBackgroundFile: (file: string) => void;
  removeBackgroundFile: (name: string) => void;
  isDefaultBackground: boolean;
  useCameraBackground: boolean;
  setUseCameraBackground: (use: boolean) => void;
}

/**
 * Create the background URL context
 */
const BgUrlContext = createContext<BgUrlContextState | null>(null);

/**
 * Background URL Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function BgUrlProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useWebSocket();
  const DEFAULT_BACKGROUND = `${baseUrl}/bg/ceiling-window-room-night.jpeg`;

  // Local storage for persistent background URL
  const [backgroundUrl, setBackgroundUrl] = useLocalStorage<string>(
    'backgroundUrl',
    DEFAULT_BACKGROUND,
  );

  // State for background files list
  const [backgroundFiles, setBackgroundFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!backgroundUrl) {
      setBackgroundUrl(DEFAULT_BACKGROUND);
      return;
    }

    try {
      const background = new URL(backgroundUrl);
      const runtimeBase = new URL(baseUrl);
      if (
        (background.hostname === '127.0.0.1' || background.hostname === 'localhost' || background.hostname === '::1')
        && background.pathname.startsWith('/bg/')
      ) {
        background.protocol = runtimeBase.protocol;
        background.host = runtimeBase.host;
        const normalizedBackground = background.toString();
        if (normalizedBackground !== backgroundUrl) {
          setBackgroundUrl(normalizedBackground);
        }
      }
    } catch (error) {
      // Ignore parse errors and leave custom user URLs untouched.
    }
  }, [backgroundUrl, baseUrl, DEFAULT_BACKGROUND, setBackgroundUrl]);

  // Reset background to default
  const resetBackground = useCallback(() => {
    setBackgroundUrl(DEFAULT_BACKGROUND);
  }, [setBackgroundUrl, DEFAULT_BACKGROUND]);

  // Add new background file
  const addBackgroundFile = useCallback((file: string) => {
    setBackgroundFiles((prev) => [...prev, file]);
  }, []);

  // Remove background file
  const removeBackgroundFile = useCallback((name: string) => {
    setBackgroundFiles((prev) => prev.filter((file) => file !== name));
  }, []);

  // Check if current background is default
  const isDefaultBackground = useMemo(
    () => backgroundUrl === DEFAULT_BACKGROUND,
    [backgroundUrl, DEFAULT_BACKGROUND],
  );

  const [useCameraBackground, setUseCameraBackground] = useLocalStorage<boolean>(
    'useCameraBackground',
    false,
  );

  // Memoized context value
  const contextValue = useMemo(() => ({
    backgroundUrl,
    setBackgroundUrl,
    backgroundFiles,
    setBackgroundFiles,
    resetBackground,
    addBackgroundFile,
    removeBackgroundFile,
    isDefaultBackground,
    useCameraBackground,
    setUseCameraBackground,
  }), [backgroundUrl, setBackgroundUrl, backgroundFiles, resetBackground, addBackgroundFile, removeBackgroundFile, isDefaultBackground, useCameraBackground]);

  return (
    <BgUrlContext.Provider value={contextValue}>
      {children}
    </BgUrlContext.Provider>
  );
}

/**
 * Custom hook to use the background URL context
 * @throws {Error} If used outside of BgUrlProvider
 */
export function useBgUrl() {
  const context = useContext(BgUrlContext);

  if (!context) {
    throw new Error('useBgUrl must be used within a BgUrlProvider');
  }

  return context;
}
