import {
  createContext, useContext, useMemo, ReactNode,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

export const SHOW_GROUP_ENTRY_KEY = 'showGroupManagementEntry';
export const SHOW_MODE_ENTRY_KEY = 'showModeSwitcherEntry';

interface UiEntryVisibilityContextState {
  showGroupManagementEntry: boolean;
  showModeSwitcherEntry: boolean;
  setShowGroupManagementEntry: (show: boolean) => void;
  setShowModeSwitcherEntry: (show: boolean) => void;
}

const UiEntryVisibilityContext = createContext<UiEntryVisibilityContextState | null>(null);

export function UiEntryVisibilityProvider({ children }: { children: ReactNode }) {
  const [showGroupManagementEntry, setShowGroupManagementEntry] = useLocalStorage<boolean>(
    SHOW_GROUP_ENTRY_KEY,
    false,
  );
  const [showModeSwitcherEntry, setShowModeSwitcherEntry] = useLocalStorage<boolean>(
    SHOW_MODE_ENTRY_KEY,
    false,
  );

  const contextValue = useMemo(
    () => ({
      showGroupManagementEntry,
      showModeSwitcherEntry,
      setShowGroupManagementEntry,
      setShowModeSwitcherEntry,
    }),
    [
      showGroupManagementEntry,
      showModeSwitcherEntry,
      setShowGroupManagementEntry,
      setShowModeSwitcherEntry,
    ],
  );

  return (
    <UiEntryVisibilityContext.Provider value={contextValue}>
      {children}
    </UiEntryVisibilityContext.Provider>
  );
}

export function useUiEntryVisibility() {
  const context = useContext(UiEntryVisibilityContext);
  if (!context) {
    throw new Error('useUiEntryVisibility must be used within UiEntryVisibilityProvider');
  }
  return context;
}
