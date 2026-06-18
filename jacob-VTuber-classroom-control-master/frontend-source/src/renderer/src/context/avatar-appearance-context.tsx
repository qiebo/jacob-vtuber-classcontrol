import {
  createContext,
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

  const setAvatarMode = (mode: AvatarMode) => {
    setAvatarModeInternal(mode);
  };

  const setAvatarPackId = (packId: string) => {
    setAvatarPackIdInternal((packId || "").trim());
  };

  const activateLive2d = () => {
    setAvatarModeInternal("live2d");
  };

  const activateAvatarPack = (packId: string) => {
    setAvatarModeInternal("avatarpack");
    setAvatarPackIdInternal((packId || "default_avatarpack").trim());
  };

  const value = useMemo(
    () => ({
      avatarMode,
      avatarPackId,
      setAvatarMode,
      setAvatarPackId,
      activateLive2d,
      activateAvatarPack,
    }),
    [avatarMode, avatarPackId],
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
