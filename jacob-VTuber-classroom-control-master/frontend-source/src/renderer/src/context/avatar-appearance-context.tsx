import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useLocalStorage } from "@/hooks/utils/use-local-storage";

export type AvatarMode = "live2d" | "avatarpack";

interface AvatarAppearanceContextState {
  avatarMode: AvatarMode;
  avatarPackId: string;
  setAvatarMode: (mode: AvatarMode) => void;
  setAvatarPackId: (packId: string) => void;
  activateLive2d: () => void;
  activateAvatarPack: (packId: string) => void;
}

const AvatarAppearanceContext = createContext<AvatarAppearanceContextState | null>(null);

export function AvatarAppearanceProvider({ children }: { children: React.ReactNode }) {
  const [avatarMode, setAvatarModeInternal] = useLocalStorage<AvatarMode>(
    "avatarMode",
    "avatarpack",
  );
  const [avatarPackId, setAvatarPackIdInternal] = useLocalStorage<string>(
    "avatarPackId",
    "default_avatarpack",
  );

  const setAvatarMode = useCallback((mode: AvatarMode) => {
    setAvatarModeInternal(mode);
  }, [setAvatarModeInternal]);

  const setAvatarPackId = useCallback((packId: string) => {
    setAvatarPackIdInternal((packId || "").trim());
  }, [setAvatarPackIdInternal]);

  const activateLive2d = useCallback(() => {
    setAvatarModeInternal("live2d");
  }, [setAvatarModeInternal]);

  const activateAvatarPack = useCallback((packId: string) => {
    setAvatarModeInternal("avatarpack");
    setAvatarPackIdInternal((packId || "default_avatarpack").trim());
  }, [setAvatarModeInternal, setAvatarPackIdInternal]);

  const value = useMemo(
    () => ({
      avatarMode,
      avatarPackId,
      setAvatarMode,
      setAvatarPackId,
      activateLive2d,
      activateAvatarPack,
    }),
    [
      activateAvatarPack,
      activateLive2d,
      avatarMode,
      avatarPackId,
      setAvatarMode,
      setAvatarPackId,
    ],
  );

  return (
    <AvatarAppearanceContext.Provider value={value}>
      {children}
    </AvatarAppearanceContext.Provider>
  );
}

export function useAvatarAppearance() {
  const context = useContext(AvatarAppearanceContext);
  if (!context) {
    throw new Error("useAvatarAppearance must be used within AvatarAppearanceProvider");
  }
  return context;
}
