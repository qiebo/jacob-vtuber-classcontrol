import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAvatarAppearance, AvatarMode } from "@/context/avatar-appearance-context";
import { useBgUrl } from "@/context/bgurl-context";
import { useConfig } from "@/context/character-config-context";
import { ModelInfo, useLive2DConfig } from "@/context/live2d-config-context";
import { useWebSocket } from "@/context/websocket-context";

export interface ClassroomStatus {
  online: boolean;
  app_ready: boolean;
  server_time: string;
  current_username: string | null;
  class_name: string | null;
  character_name: string | null;
  avatar_mode: string | null;
  avatar_pack_id: string | null;
  live2d_model_name: string | null;
  dirty: boolean;
  submitted: boolean;
  last_saved_at: string | null;
  locked: boolean;
}

export interface ClassroomProfile {
  schema_version: number;
  username: string;
  class_name: string | null;
  character_config: Record<string, unknown>;
  workspace_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_saved_at: string | null;
  dirty: boolean;
  submitted: boolean;
  pending_sync: boolean;
}

interface Live2DModelCatalogItem {
  name: string;
  url: string;
}

interface ClassroomContextState {
  profiles: ClassroomProfile[];
  currentProfile: ClassroomProfile | null;
  status: ClassroomStatus | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  // auth
  authUsername: string | null;
  isAuthenticated: boolean;
  pendingSync: boolean;
  checkUsername: (username: string) => Promise<{ available: boolean; offline?: boolean; conflict?: string | null }>;
  createUser: (username: string, className?: string) => Promise<boolean>;
  loginUser: (username: string) => Promise<boolean>;
  logoutUser: (saveBeforeExit?: boolean) => Promise<void>;
  refreshStatus: () => Promise<ClassroomStatus | null>;
  loadProfiles: () => Promise<ClassroomProfile[]>;
  createProfile: (username: string, className?: string) => Promise<ClassroomProfile | null>;
  loadProfile: (username: string) => Promise<ClassroomProfile | null>;
  saveProfile: () => Promise<ClassroomProfile | null>;
  submitProfile: () => Promise<ClassroomProfile | null>;
  markDirty: () => void;
}

const ClassroomContext = createContext<ClassroomContextState | null>(null);

const defaultStatus: ClassroomStatus = {
  online: false,
  app_ready: false,
  server_time: "",
  current_username: null,
  class_name: null,
  character_name: null,
  avatar_mode: null,
  avatar_pack_id: null,
  live2d_model_name: null,
  dirty: false,
  submitted: false,
  last_saved_at: null,
  locked: false,
};

const defaultModelInfo = (name: string, url: string): ModelInfo => ({
  name,
  description: "",
  url,
  kScale: 0.5,
  initialXshift: 0,
  initialYshift: 0,
  idleMotionGroupName: "Idle",
  emotionMap: {
    neutral: 0,
    joy: 0,
    sadness: 0,
    anger: 0,
    surprise: 0,
    fear: 0,
    disgust: 0,
    smirk: 0,
  },
  tapMotions: {},
});

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || window.location.origin).replace(/\/+$/, "");
}

function normalizeAssetUrl(baseUrl: string, rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }
  if (/^https?:\/\//.test(rawUrl)) {
    return rawUrl;
  }
  const normalizedPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}

export function ClassroomProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useWebSocket();
  const {
    setConfName,
    setConfUid,
    setCharacterName,
    setHumanName,
    setPersonaPrompt,
  } = useConfig();
  const { modelInfo, setModelInfo } = useLive2DConfig();
  const {
    avatarMode,
    avatarPackId,
    setAvatarMode,
    setAvatarPackId,
  } = useAvatarAppearance();
  const bgUrlContext = useBgUrl();
  const [profiles, setProfiles] = useState<ClassroomProfile[]>([]);
  const profilesRef = useRef<ClassroomProfile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<ClassroomProfile | null>(null);
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // auth state
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  const requestJson = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : response.statusText,
        );
      }
      return payload as T;
    },
    [baseUrl],
  );

  const withLoading = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setLoadingCount((count) => count + 1);
    setError(null);
    try {
      return await operation();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      throw err;
    } finally {
      setLoadingCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const refreshStatus = useCallback(async () => withLoading(async () => {
    const nextStatus = await requestJson<ClassroomStatus>("/classroom/status");
    const normalizedStatus = { ...defaultStatus, ...nextStatus };
    setStatus(normalizedStatus);
    setDirty(normalizedStatus.dirty);
    setCurrentProfile((current) =>
      profilesRef.current.find((profile) => profile.username === normalizedStatus.current_username)
      || current);
    return normalizedStatus;
  }), [requestJson, withLoading]);

  const loadProfiles = useCallback(async () => withLoading(async () => {
    const payload = await requestJson<{ profiles?: ClassroomProfile[] }>("/classroom/profiles");
    const nextProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    profilesRef.current = nextProfiles;
    setProfiles(nextProfiles);
    setCurrentProfile((current) => {
      const currentName = current?.username;
      return nextProfiles.find((profile) => profile.username === currentName) || current;
    });
    return nextProfiles;
  }), [requestJson, withLoading]);

  const fetchLive2dModelInfo = useCallback(async (
    modelName: string,
  ): Promise<ModelInfo | undefined> => {
    if (!modelName) {
      return undefined;
    }

    const payload = await requestJson<{ models?: Live2DModelCatalogItem[] }>(
      "/live2d-models/catalog",
    );
    const catalogModel = (payload.models || []).find((model) => model.name === modelName);
    if (!catalogModel?.url) {
      return undefined;
    }

    const fallback = modelInfo?.name === modelName ? modelInfo : undefined;
    return {
      ...defaultModelInfo(modelName, normalizeAssetUrl(baseUrl, catalogModel.url)),
      ...(fallback || {}),
      name: modelName,
      url: normalizeAssetUrl(baseUrl, catalogModel.url),
    };
  }, [baseUrl, modelInfo, requestJson]);

  const applyCharacterConfig = useCallback(async (characterConfig: Record<string, unknown>) => {
    const stringValue = (key: string): string =>
      typeof characterConfig[key] === "string" ? characterConfig[key] as string : "";

    setConfName(stringValue("conf_name"));
    setConfUid(stringValue("conf_uid"));
    setCharacterName(stringValue("character_name"));
    setHumanName(stringValue("human_name") || "Human");
    setPersonaPrompt(stringValue("persona_prompt"));

    const avatarMode = stringValue("avatar_mode");
    if (avatarMode === "live2d" || avatarMode === "avatarpack") {
      setAvatarMode(avatarMode as AvatarMode);
    }
    const avatarPackId = stringValue("avatar_pack_id");
    if (avatarPackId) {
      setAvatarPackId(avatarPackId);
    }

    const live2dModelName = stringValue("live2d_model_name");
    if (avatarMode === "live2d" && live2dModelName) {
      setModelInfo(await fetchLive2dModelInfo(live2dModelName));
    } else if (avatarMode === "avatarpack") {
      setModelInfo(undefined);
    }

    const backgroundUrl = stringValue("background_url");
    if (backgroundUrl) {
      bgUrlContext.setBackgroundUrl(normalizeAssetUrl(baseUrl, backgroundUrl));
    }
    if (typeof characterConfig.use_camera_background === "boolean") {
      bgUrlContext.setUseCameraBackground(characterConfig.use_camera_background);
    }
  }, [
    baseUrl,
    bgUrlContext,
    fetchLive2dModelInfo,
    setAvatarMode,
    setAvatarPackId,
    setCharacterName,
    setConfName,
    setConfUid,
    setHumanName,
    setModelInfo,
    setPersonaPrompt,
  ]);

  const buildWorkspaceState = useCallback(() => ({
    stage: {
      background_url: bgUrlContext.backgroundUrl,
      use_camera_background: bgUrlContext.useCameraBackground,
    },
    appearance: {
      avatar_mode: avatarMode,
      avatar_pack_id: avatarPackId,
      live2d_model_name: modelInfo?.name || "",
    },
    knowledge: {
      enabled: window.localStorage.getItem("knowledgeEnabled") === "true",
    },
  }), [
    avatarMode,
    avatarPackId,
    bgUrlContext.backgroundUrl,
    bgUrlContext.useCameraBackground,
    modelInfo?.name,
  ]);

  const applyWorkspaceState = useCallback((workspaceState: Record<string, unknown>) => {
    const stage = workspaceState.stage;
    if (stage && typeof stage === "object") {
      const backgroundUrl = (stage as Record<string, unknown>).background_url;
      const useCameraBackground = (stage as Record<string, unknown>).use_camera_background;
      if (typeof backgroundUrl === "string" && backgroundUrl) {
        bgUrlContext.setBackgroundUrl(normalizeAssetUrl(baseUrl, backgroundUrl));
      }
      if (typeof useCameraBackground === "boolean") {
        bgUrlContext.setUseCameraBackground(useCameraBackground);
      }
    }

    const knowledge = workspaceState.knowledge;
    if (knowledge && typeof knowledge === "object") {
      const enabled = (knowledge as Record<string, unknown>).enabled;
      if (typeof enabled === "boolean") {
        const serialized = JSON.stringify(enabled);
        window.localStorage.setItem("knowledgeEnabled", serialized);
        window.dispatchEvent(new StorageEvent("storage", {
          key: "knowledgeEnabled",
          newValue: serialized,
        }));
      }
    }
  }, [baseUrl, bgUrlContext]);

  const syncProfileResult = useCallback(async (profile: ClassroomProfile) => {
    setCurrentProfile(profile);
    setDirty(profile.dirty);
    setProfiles((previous) => {
      const withoutProfile = previous.filter(
        (item) => item.username !== profile.username,
      );
      const nextProfiles = [profile, ...withoutProfile].sort((a, b) =>
        `${a.class_name || ""}/${a.username}`.localeCompare(`${b.class_name || ""}/${b.username}`),
      );
      profilesRef.current = nextProfiles;
      return nextProfiles;
    });
    await refreshStatus();
  }, [refreshStatus]);

  const createProfile = useCallback(async (
    username: string,
    className?: string,
  ) => withLoading(async () => {
    const payload = await requestJson<{ profile?: ClassroomProfile }>(
      "/classroom/profile/create",
      {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          class_name: className?.trim() || null,
          workspace_state: buildWorkspaceState(),
        }),
      },
    );
    if (!payload.profile) {
      return null;
    }
    await applyCharacterConfig(payload.profile.character_config);
    applyWorkspaceState(payload.profile.workspace_state || {});
    await syncProfileResult(payload.profile);
    return payload.profile;
  }), [
    applyCharacterConfig,
    applyWorkspaceState,
    buildWorkspaceState,
    requestJson,
    syncProfileResult,
    withLoading,
  ]);

  const loadProfile = useCallback(async (username: string) => withLoading(async () => {
    const payload = await requestJson<{ profile?: ClassroomProfile }>(
      "/classroom/profile/load",
      {
        method: "POST",
        body: JSON.stringify({ username: username }),
      },
    );
    if (!payload.profile) {
      return null;
    }
    await applyCharacterConfig(payload.profile.character_config);
    applyWorkspaceState(payload.profile.workspace_state || {});
    await syncProfileResult(payload.profile);
    return payload.profile;
  }), [
    applyCharacterConfig,
    applyWorkspaceState,
    requestJson,
    syncProfileResult,
    withLoading,
  ]);

  const saveProfile = useCallback(async () => withLoading(async () => {
    const payload = await requestJson<{ profile?: ClassroomProfile }>(
      "/classroom/profile/save",
      {
        method: "POST",
        body: JSON.stringify({ workspace_state: buildWorkspaceState() }),
      },
    );
    if (!payload.profile) {
      return null;
    }
    await syncProfileResult(payload.profile);
    return payload.profile;
  }), [buildWorkspaceState, requestJson, syncProfileResult, withLoading]);

  const submitProfile = useCallback(async () => withLoading(async () => {
    const payload = await requestJson<{ profile?: ClassroomProfile }>(
      "/classroom/profile/submit",
      {
        method: "POST",
        body: JSON.stringify({ workspace_state: buildWorkspaceState() }),
      },
    );
    if (!payload.profile) {
      return null;
    }
    await syncProfileResult(payload.profile);
    return payload.profile;
  }), [buildWorkspaceState, requestJson, syncProfileResult, withLoading]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setStatus((previous) => (previous ? { ...previous, dirty: true } : previous));
    requestJson("/classroom/profile/dirty", {
      method: "POST",
      body: JSON.stringify({ dirty: true }),
    }).catch(() => undefined);
  }, [requestJson]);

  // --- auth ---
  const refreshAuth = useCallback(async () => {
    try {
      const me = await requestJson<{ username: string | null; pending_sync?: boolean }>(
        "/auth/me",
      );
      setAuthUsername(me.username);
      setPendingSync(Boolean(me.pending_sync));
      if (me.username) {
        refreshStatus().catch(() => undefined);
      }
    } catch {
      setAuthUsername(null);
    }
  }, [requestJson, refreshStatus]);

  const checkUsername = useCallback(async (username: string) => {
    const payload = await requestJson<{
      available: boolean;
      offline?: boolean;
      conflict?: string | null;
    }>("/auth/check-username", {
      method: "POST",
      body: JSON.stringify({ username: username.trim() }),
    });
    return {
      available: payload.available,
      offline: payload.offline,
      conflict: payload.conflict,
    };
  }, [requestJson]);

  const createUser = useCallback(async (username: string, className?: string) => {
    const payload = await requestJson<{
      username: string;
      profile?: { character_config?: Record<string, unknown>; workspace_state?: Record<string, unknown> };
      pending_sync?: boolean;
    }>("/auth/create", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), class_name: className?.trim() || null }),
    });
    setAuthUsername(payload.username);
    setPendingSync(Boolean(payload.pending_sync));
    // 创建后必须把档案的人设配置应用到前端 Live2D
    if (payload.profile?.character_config) {
      await applyCharacterConfig(payload.profile.character_config);
    }
    if (payload.profile?.workspace_state) {
      applyWorkspaceState(payload.profile.workspace_state);
    }
    await refreshStatus().catch(() => undefined);
    await loadProfiles().catch(() => undefined);
    return true;
  }, [requestJson, applyCharacterConfig, applyWorkspaceState, refreshStatus, loadProfiles]);

  const loginUser = useCallback(async (username: string) => {
    const payload = await requestJson<{
      username: string;
      profile?: { character_config?: Record<string, unknown>; workspace_state?: Record<string, unknown> };
      pending_sync?: boolean;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim() }),
    });
    setAuthUsername(payload.username);
    setPendingSync(Boolean(payload.pending_sync));
    // 登录后必须把档案的人设配置应用到前端 Live2D，否则人物形象加载不出来
    if (payload.profile?.character_config) {
      await applyCharacterConfig(payload.profile.character_config);
    }
    if (payload.profile?.workspace_state) {
      applyWorkspaceState(payload.profile.workspace_state);
    }
    await refreshStatus().catch(() => undefined);
    await loadProfiles().catch(() => undefined);
    return true;
  }, [requestJson, applyCharacterConfig, applyWorkspaceState, refreshStatus, loadProfiles]);

  const logoutUser = useCallback(async (saveBeforeExit = false) => {
    try {
      await requestJson("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ save_before_exit: saveBeforeExit }),
      });
    } catch {
      // 忽略，仍清本地态
    }
    setAuthUsername(null);
    setPendingSync(false);
    setCurrentProfile(null);
    setProfiles([]);
    profilesRef.current = [];
    await refreshStatus().catch(() => undefined);
  }, [requestJson, refreshStatus]);

  useEffect(() => {
    refreshStatus().catch(() => undefined);
    loadProfiles().catch(() => undefined);
    refreshAuth().catch(() => undefined);
  }, [refreshStatus, loadProfiles, refreshAuth]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshStatus().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [refreshStatus]);

  const value = useMemo(
    () => ({
      profiles,
      currentProfile,
      status,
      dirty,
      loading: loadingCount > 0,
      error,
      authUsername,
      isAuthenticated: authUsername !== null,
      pendingSync,
      checkUsername,
      createUser,
      loginUser,
      logoutUser,
      refreshStatus,
      loadProfiles,
      createProfile,
      loadProfile,
      saveProfile,
      submitProfile,
      markDirty,
    }),
    [
      profiles,
      currentProfile,
      status,
      dirty,
      loadingCount,
      error,
      authUsername,
      pendingSync,
      checkUsername,
      createUser,
      loginUser,
      logoutUser,
      refreshStatus,
      loadProfiles,
      createProfile,
      loadProfile,
      saveProfile,
      submitProfile,
      markDirty,
    ],
  );

  return (
    <ClassroomContext.Provider value={value}>
      {children}
    </ClassroomContext.Provider>
  );
}

export function useClassroom() {
  const context = useContext(ClassroomContext);
  if (!context) {
    throw new Error("useClassroom must be used within ClassroomProvider");
  }
  return context;
}
