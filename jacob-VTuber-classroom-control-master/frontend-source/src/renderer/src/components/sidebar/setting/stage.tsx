/* eslint-disable import/no-extraneous-dependencies */
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  HStack,
  Image,
  IconButton,
  Input,
  Stack,
  Tabs,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { FiCheck, FiPlus, FiTrash2, FiUpload, FiX } from "react-icons/fi";
import { settingStyles } from "./setting-styles";
import { useGeneralSettings } from "@/hooks/sidebar/setting/use-general-settings";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useBgUrl } from "@/context/bgurl-context";
import { useConfig } from "@/context/character-config-context";
import { useWebSocket } from "@/context/websocket-context";
import { useAvatarAppearance } from "@/context/avatar-appearance-context";
import { useClassroom } from "@/context/classroom-context";
import { wsService } from "@/services/websocket-service";
import { toaster } from "@/components/ui/toaster";
import { Field } from "@/components/ui/field";
import { useDragScroll } from "@/hooks/utils/use-drag-scroll";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";

interface StageProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

interface BackgroundOption {
  label: string;
  value: string;
  deletable: boolean;
}

interface Live2DModelCatalogItem {
  name: string;
  url: string;
  avatar?: string | null;
  is_custom: boolean;
  can_delete: boolean;
}

interface Live2DModelOption {
  label: string;
  value: string;
  canDelete: boolean;
  isCustom: boolean;
}

interface AvatarPackCatalogItem {
  pack_id: string;
  name: string;
  thumb_url?: string;
  is_custom: boolean;
  can_delete: boolean;
  has_action: boolean;
}

interface AvatarPackOption {
  label: string;
  value: string;
  canDelete: boolean;
  isCustom: boolean;
  hasAction: boolean;
  thumbUrl?: string;
}

const DEFAULT_BACKGROUND_FILENAME = "ceiling-window-room-night.jpeg";
const PROTECTED_BACKGROUND_FILENAMES = new Set([DEFAULT_BACKGROUND_FILENAME]);
const LAST_SELECTED_LIVE2D_MODEL_STORAGE_KEY = "lastSelectedLive2dModelName";
const MAX_AVATAR_PACK_FILE_COUNT = 300;

const SUPPORTED_AVATAR_ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".zip",
]);

const getBackgroundFilenameFromPath = (path: string): string =>
  decodeURIComponent(path.replace(/^\/bg\//, ""));

const loadLastSelectedLive2dModelName = (): string | null => {
  try {
    const rawValue = localStorage.getItem(LAST_SELECTED_LIVE2D_MODEL_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    return rawValue;
  } catch (error) {
    console.warn("Failed to load last selected live2d model:", error);
    return null;
  }
};

const formatFileSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

const isAvatarAssetFileSupported = (fileName: string): boolean => {
  const extension = fileName.includes(".")
    ? `.${fileName.split(".").pop()?.toLowerCase() || ""}`
    : "";
  return SUPPORTED_AVATAR_ASSET_EXTENSIONS.has(extension);
};

const normalizeUniqueName = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const getUploadFileStem = (fileName: string): string => {
  const rawName = fileName.split(/[\\/]/).pop() || "";
  const dotIndex = rawName.lastIndexOf(".");
  return dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
};

const sanitizeLive2dUploadModelName = (fileName: string): string => {
  const stem = getUploadFileStem(fileName);
  const safeStem = stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
  const safeModelName = (safeStem || "background").replace(/^[._-]+|[._-]+$/g, "");
  return safeModelName || "live2d_model";
};

const getDisplayInitial = (name: string): string => {
  const trimmedName = name.trim();
  return trimmedName ? trimmedName.slice(0, 1).toUpperCase() : "?";
};

const isLive2dTextureAtlasAssetUrl = (assetUrl?: string | null): boolean => {
  if (!assetUrl) {
    return false;
  }
  const normalizedUrl = assetUrl.toLowerCase();
  return (
    /(^|\/)texture[_-]\d+\.(png|jpe?g|webp)(\?|#|$)/.test(normalizedUrl)
    || /\/textures?\//.test(normalizedUrl)
    || /\/[^/]+\.(1024|2048|4096)\//.test(normalizedUrl)
  );
};

function Stage({ onSave, onCancel }: StageProps): JSX.Element {
  const { t } = useTranslation();
  const backgroundDragScroll = useDragScroll<HTMLDivElement>({
    axis: "y",
    skipInteractiveTargets: false,
    stopPropagation: true,
    threshold: 16,
  });
  const bgUrlContext = useBgUrl();
  const { backgroundFiles } = bgUrlContext || {};
  const { confName, setConfName } = useConfig();
  const { wsUrl, setWsUrl, baseUrl, setBaseUrl } = useWebSocket();
  const live2dConfig = useLive2DConfig();
  const {
    avatarMode,
    avatarPackId,
    activateLive2d,
    activateAvatarPack,
  } = useAvatarAppearance();
  const { markDirty } = useClassroom();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const live2dModelZipInputRef = useRef<HTMLInputElement>(null);
  const avatarAssetInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isBackgroundDropActive, setIsBackgroundDropActive] = useState(false);
  const [deletingBackgroundName, setDeletingBackgroundName] = useState<string | null>(null);
  const [live2dModels, setLive2dModels] = useState<Live2DModelCatalogItem[]>([]);
  const [selectedLive2dModel, setSelectedLive2dModel] = useState<string[]>([]);
  const [lastSelectedLive2dModel, setLastSelectedLive2dModel] = useState<string | null>(
    () => loadLastSelectedLive2dModelName(),
  );
  const [isLoadingLive2dModels, setIsLoadingLive2dModels] = useState(false);
  const [isUploadingLive2dModel, setIsUploadingLive2dModel] = useState(false);
  const [deletingLive2dModelName, setDeletingLive2dModelName] = useState<string | null>(null);
  const [avatarPacks, setAvatarPacks] = useState<AvatarPackCatalogItem[]>([]);
  const [selectedAvatarPack, setSelectedAvatarPack] = useState<string[]>([]);
  const [isLoadingAvatarPacks, setIsLoadingAvatarPacks] = useState(false);
  const [isUploadingAvatarPack, setIsUploadingAvatarPack] = useState(false);
  const [deletingAvatarPackId, setDeletingAvatarPackId] = useState<string | null>(null);
  const [avatarUploadDialogOpen, setAvatarUploadDialogOpen] = useState(false);
  const [avatarPackNameInput, setAvatarPackNameInput] = useState("");
  const [avatarUploadFiles, setAvatarUploadFiles] = useState<File[]>([]);
  const [isAvatarDropActive, setIsAvatarDropActive] = useState(false);
  const [stageAvatarTab, setStageAvatarTab] = useState<"avatarpack" | "live2d">(
    avatarMode === "avatarpack" ? "avatarpack" : "live2d",
  );

  const backgrounds = useMemo(
    () =>
      createListCollection<BackgroundOption>({
        items:
          backgroundFiles?.map((filename) => ({
            label: String(filename),
            value: `/bg/${filename}`,
            deletable: !PROTECTED_BACKGROUND_FILENAMES.has(String(filename)),
          })) || [],
      }),
    [backgroundFiles],
  );

  const live2dModelCollection = useMemo(
    () =>
      createListCollection<Live2DModelOption>({
        items: live2dModels.map((model) => ({
          label: model.name,
          value: model.name,
          canDelete: model.can_delete,
          isCustom: model.is_custom,
        })),
      }),
    [live2dModels],
  );

  const avatarPackCollection = useMemo(
    () =>
      createListCollection<AvatarPackOption>({
        items: avatarPacks.map((pack) => ({
          label: pack.name,
          value: pack.pack_id,
          canDelete: pack.can_delete,
          isCustom: pack.is_custom,
          hasAction: pack.has_action,
          thumbUrl: pack.thumb_url,
        })),
      }),
    [avatarPacks],
  );

  const normalizedBaseUrl = useMemo(
    () => baseUrl.replace(/\/+$/, ""),
    [baseUrl],
  );

  const resolveBackgroundFullUrl = useCallback((backgroundPath: string): string => {
    if (!backgroundPath) {
      return "";
    }
    if (/^https?:\/\//.test(backgroundPath)) {
      return backgroundPath;
    }
    const normalizedPath = backgroundPath.startsWith("/")
      ? backgroundPath
      : `/${backgroundPath}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
  }, [normalizedBaseUrl]);

  const {
    settings,
    handleSettingChange,
  } = useGeneralSettings({
    bgUrlContext,
    confName,
    setConfName,
    baseUrl,
    wsUrl,
    onWsUrlChange: setWsUrl,
    onBaseUrlChange: setBaseUrl,
    onSave,
    onCancel,
  });

  const selectedBackgroundPath = useMemo(() => {
    const configuredPath = settings.selectedBgUrl[0] || "";
    if (configuredPath) {
      return configuredPath;
    }

    const currentBackgroundUrl = bgUrlContext?.backgroundUrl || "";
    if (currentBackgroundUrl.startsWith(normalizedBaseUrl)) {
      return currentBackgroundUrl.replace(normalizedBaseUrl, "");
    }
    return "";
  }, [settings.selectedBgUrl, bgUrlContext?.backgroundUrl, normalizedBaseUrl]);

  const persistLastSelectedLive2dModelValue = useCallback((value: string | null) => {
    setLastSelectedLive2dModel(value);
    if (!value) {
      localStorage.removeItem(LAST_SELECTED_LIVE2D_MODEL_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LAST_SELECTED_LIVE2D_MODEL_STORAGE_KEY, value);
  }, []);

  const fetchLive2dModels = useCallback(async (): Promise<Live2DModelCatalogItem[]> => {
    const endpoint = `${normalizedBaseUrl}/live2d-models/catalog`;

    setIsLoadingLive2dModels(true);
    try {
      const response = await fetch(endpoint);
      const payload = await response
        .json()
        .catch(() => ({} as { error?: string; models?: Live2DModelCatalogItem[] }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.live2dModelFetchFailed"));
      }

      const models = Array.isArray(payload.models) ? payload.models : [];
      setLive2dModels(models);
      return models;
    } catch (error) {
      toaster.create({
        title: `${t("error.live2dModelFetchFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
      return [] as Live2DModelCatalogItem[];
    } finally {
      setIsLoadingLive2dModels(false);
    }
  }, [normalizedBaseUrl, t]);

  const fetchAvatarPacks = useCallback(async (): Promise<AvatarPackCatalogItem[]> => {
    const endpoint = `${normalizedBaseUrl}/avatar-packs/catalog`;

    setIsLoadingAvatarPacks(true);
    try {
      const response = await fetch(endpoint);
      const payload = await response
        .json()
        .catch(() => ({} as { error?: string; packs?: AvatarPackCatalogItem[] }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.avatarPackFetchFailed"));
      }

      const packs = Array.isArray(payload.packs) ? payload.packs : [];
      setAvatarPacks(packs);
      return packs;
    } catch (error) {
      toaster.create({
        title: `${t("error.avatarPackFetchFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
      return [] as AvatarPackCatalogItem[];
    } finally {
      setIsLoadingAvatarPacks(false);
    }
  }, [normalizedBaseUrl, t]);

  const currentLive2dModelName = useMemo(
    () => (typeof live2dConfig.modelInfo?.name === "string" ? live2dConfig.modelInfo.name : ""),
    [live2dConfig.modelInfo?.name],
  );

  const activeAvatarPack = useMemo(() => {
    const selectedPackId = selectedAvatarPack[0] || avatarPackId;
    if (!selectedPackId) {
      return null;
    }
    return avatarPacks.find((pack) => pack.pack_id === selectedPackId) || null;
  }, [selectedAvatarPack, avatarPackId, avatarPacks]);

  const resolveStageAssetUrl = useCallback((assetUrl?: string | null): string => {
    if (!assetUrl) {
      return "";
    }
    if (/^https?:\/\//.test(assetUrl)) {
      return assetUrl;
    }
    const normalizedPath = assetUrl.startsWith("/")
      ? assetUrl
      : `/${assetUrl}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
  }, [normalizedBaseUrl]);

  const resolveLive2dPreviewUrl = useCallback((assetUrl?: string | null): string => {
    if (isLive2dTextureAtlasAssetUrl(assetUrl)) {
      return "";
    }
    return resolveStageAssetUrl(assetUrl);
  }, [resolveStageAssetUrl]);

  const activeLive2dModel = useMemo(() => {
    const selectedModelName = selectedLive2dModel[0] || currentLive2dModelName;
    if (!selectedModelName) {
      return null;
    }
    return live2dModels.find((model) => model.name === selectedModelName) || null;
  }, [selectedLive2dModel, currentLive2dModelName, live2dModels]);

  const resolveLive2dModelName = useCallback(
    (candidate?: string): string => {
      const candidates = [
        candidate,
        selectedLive2dModel[0],
        currentLive2dModelName,
        lastSelectedLive2dModel || "",
        live2dModels[0]?.name || "",
      ];

      for (const item of candidates) {
        const name = (item || "").trim();
        if (!name) {
          continue;
        }
        if (!live2dModels.length) {
          return name;
        }
        if (live2dModels.some((model) => model.name === name)) {
          return name;
        }
      }
      return "";
    },
    [selectedLive2dModel, currentLive2dModelName, lastSelectedLive2dModel, live2dModels],
  );

  const resolveAvatarPackId = useCallback(
    (candidate?: string): string => {
      const trimmedCandidate = (candidate || "").trim();
      if (trimmedCandidate) {
        return trimmedCandidate;
      }
      if (selectedAvatarPack[0]) {
        return selectedAvatarPack[0];
      }
      if (avatarPackId) {
        return avatarPackId;
      }
      if (avatarPacks[0]?.pack_id) {
        return avatarPacks[0].pack_id;
      }
      return "";
    },
    [selectedAvatarPack, avatarPackId, avatarPacks],
  );

  const activateLive2dMode = useCallback((candidate?: string) => {
    const modelName = resolveLive2dModelName(candidate);
    if (!modelName) {
      return;
    }

    setSelectedLive2dModel([modelName]);
    setStageAvatarTab("live2d");
    activateLive2d();
    persistLastSelectedLive2dModelValue(modelName);
    wsService.sendMessage({
      type: "update-live2d-model",
      live2d_model: modelName,
    });
    markDirty();
  }, [resolveLive2dModelName, activateLive2d, persistLastSelectedLive2dModelValue, markDirty]);

  const activateAvatarPackMode = useCallback((candidate?: string) => {
    const packId = resolveAvatarPackId(candidate);
    if (!packId) {
      return;
    }

    setSelectedAvatarPack([packId]);
    activateAvatarPack(packId);
    wsService.sendMessage({
      type: "update-avatar-pack",
      avatar_pack_id: packId,
    });
    markDirty();
  }, [resolveAvatarPackId, activateAvatarPack, markDirty]);

  useEffect(() => {
    fetchLive2dModels();
    fetchAvatarPacks();
  }, [fetchLive2dModels, fetchAvatarPacks]);

  useEffect(() => {
    if (!currentLive2dModelName) {
      return;
    }
    setSelectedLive2dModel([currentLive2dModelName]);
  }, [currentLive2dModelName]);

  useEffect(() => {
    if (!avatarPacks.length) {
      setSelectedAvatarPack([]);
      return;
    }

    const packId = avatarPackId || avatarPacks[0].pack_id;
    const exists = avatarPacks.some((pack) => pack.pack_id === packId);
    if (exists) {
      setSelectedAvatarPack([packId]);
      return;
    }
    setSelectedAvatarPack([avatarPacks[0].pack_id]);
  }, [avatarPacks, avatarPackId]);

  useEffect(() => {
    setStageAvatarTab(avatarMode === "avatarpack" ? "avatarpack" : "live2d");
  }, [avatarMode]);

  useEffect(() => {
    if (!lastSelectedLive2dModel || !live2dModels.length) {
      return;
    }
    const exists = live2dModels.some((model) => model.name === lastSelectedLive2dModel);
    if (!exists) {
      persistLastSelectedLive2dModelValue(null);
    }
  }, [live2dModels, lastSelectedLive2dModel, persistLastSelectedLive2dModelValue]);

  const handleAvatarModeTabChange = (value: string[]) => {
    const selectedTab = value[0] as "avatarpack" | "live2d" | undefined;
    if (!selectedTab) {
      return;
    }

    setStageAvatarTab(selectedTab);

    if (selectedTab === "live2d") {
      const modelName = resolveLive2dModelName();
      if (!modelName) {
        toaster.create({
          title: t("settings.character.noLive2dModels"),
          type: "error",
          duration: 1800,
        });
        return;
      }
      activateLive2dMode(modelName);
      return;
    }

    const packId = resolveAvatarPackId();
    if (!packId) {
      toaster.create({
        title: t("settings.stage.noAvatarPacks"),
        type: "error",
        duration: 1800,
      });
      return;
    }
    activateAvatarPackMode(packId);
  };

  const handleLive2dModelChange = (value: string[]) => {
    const selectedModelName = value[0];
    if (!selectedModelName) {
      return;
    }

    setSelectedLive2dModel(value);
    persistLastSelectedLive2dModelValue(selectedModelName);
    activateLive2dMode(selectedModelName);
  };

  const handleAvatarPackChange = (value: string[]) => {
    const selectedPackId = value[0];
    if (!selectedPackId) {
      return;
    }

    setSelectedAvatarPack(value);
    setStageAvatarTab("avatarpack");
    activateAvatarPackMode(selectedPackId);
  };

  const handleOpenLive2dUploadDialog = () => {
    live2dModelZipInputRef.current?.click();
  };

  const handleLive2dModelUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isUploadingLive2dModel) {
      return;
    }

    const uploadModelName = sanitizeLive2dUploadModelName(file.name);
    const hasDuplicateModelName = live2dModels.some(
      (model) => normalizeUniqueName(model.name) === normalizeUniqueName(uploadModelName),
    );

    if (hasDuplicateModelName) {
      toaster.create({
        title: t("error.live2dModelNameDuplicate", { name: uploadModelName }),
        type: "error",
        duration: 2600,
      });
      event.target.value = "";
      return;
    }

    const endpoint = `${normalizedBaseUrl}/live2d-models/upload`;
    const formData = new FormData();
    formData.append("file", file);

    setIsUploadingLive2dModel(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const payload = await response
        .json()
        .catch(() => ({} as { error?: string; model?: { name?: string } }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.live2dModelUploadFailed"));
      }

      const uploadedModelName = payload.model?.name?.trim();
      await fetchLive2dModels();

      if (uploadedModelName) {
        activateLive2dMode(uploadedModelName);
      }

      toaster.create({
        title: t("notification.live2dModelUploaded"),
        type: "success",
        duration: 2000,
      });
    } catch (error) {
      toaster.create({
        title: `${t("error.live2dModelUploadFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2500,
      });
    } finally {
      setIsUploadingLive2dModel(false);
      event.target.value = "";
    }
  };

  const handleDeleteLive2dModel = async (modelName: string) => {
    if (!modelName || deletingLive2dModelName) {
      return;
    }
    if (modelName === currentLive2dModelName) {
      return;
    }

    const endpoint = `${normalizedBaseUrl}/live2d-models/custom/${encodeURIComponent(modelName)}`;
    setDeletingLive2dModelName(modelName);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response
        .json()
        .catch(() => ({} as { error?: string }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.live2dModelDeleteFailed"));
      }

      if (lastSelectedLive2dModel === modelName) {
        persistLastSelectedLive2dModelValue(null);
      }

      await fetchLive2dModels();
      toaster.create({
        title: t("notification.live2dModelDeleted"),
        type: "success",
        duration: 1800,
      });
      markDirty();
    } catch (error) {
      toaster.create({
        title: `${t("error.live2dModelDeleteFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
    } finally {
      setDeletingLive2dModelName(null);
    }
  };

  const handleDeleteAvatarPack = async (packId: string) => {
    if (!packId || deletingAvatarPackId) {
      return;
    }

    setDeletingAvatarPackId(packId);
    const endpoint = `${normalizedBaseUrl}/avatar-packs/custom/${encodeURIComponent(packId)}`;

    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response
        .json()
        .catch(() => ({} as { error?: string }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.avatarPackDeleteFailed"));
      }

      const nextPacks = await fetchAvatarPacks();
      const deletedWasCurrent = (selectedAvatarPack[0] || avatarPackId) === packId;

      if (deletedWasCurrent) {
        const fallbackPack = nextPacks[0];
        if (fallbackPack?.pack_id) {
          setSelectedAvatarPack([fallbackPack.pack_id]);
          setStageAvatarTab("avatarpack");
          activateAvatarPackMode(fallbackPack.pack_id);
        } else {
          setSelectedAvatarPack([]);
          const fallbackLive2d = resolveLive2dModelName();
          if (fallbackLive2d) {
            setStageAvatarTab("live2d");
            activateLive2dMode(fallbackLive2d);
          }
        }
      }

      toaster.create({
        title: t("notification.avatarPackDeleted"),
        type: "success",
        duration: 1800,
      });
      markDirty();
    } catch (error) {
      toaster.create({
        title: `${t("error.avatarPackDeleteFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
    } finally {
      setDeletingAvatarPackId(null);
    }
  };

  const resetAvatarUploadDialogState = useCallback(() => {
    setAvatarPackNameInput("");
    setAvatarUploadFiles([]);
    setIsAvatarDropActive(false);
    if (avatarAssetInputRef.current) {
      avatarAssetInputRef.current.value = "";
    }
  }, []);

  const mergeAvatarUploadFiles = useCallback((incomingFiles: File[]) => {
    if (!incomingFiles.length) {
      return;
    }

    const rejectedFileNames: string[] = [];
    const acceptedFiles: File[] = [];

    incomingFiles.forEach((file) => {
      if (!isAvatarAssetFileSupported(file.name)) {
        rejectedFileNames.push(file.name);
        return;
      }
      acceptedFiles.push(file);
    });

    if (rejectedFileNames.length > 0) {
      toaster.create({
        title: `${t("error.avatarPackUploadFailed")}: ${rejectedFileNames.join(", ")}`,
        type: "error",
        duration: 2600,
      });
    }

    setAvatarUploadFiles((previous) => {
      const fileMap = new Map<string, File>();
      previous.forEach((file) => {
        fileMap.set(`${file.name}-${file.size}-${file.lastModified}`, file);
      });
      acceptedFiles.forEach((file) => {
        fileMap.set(`${file.name}-${file.size}-${file.lastModified}`, file);
      });

      const merged = Array.from(fileMap.values());
      if (merged.length <= MAX_AVATAR_PACK_FILE_COUNT) {
        return merged;
      }

      toaster.create({
        title: t("error.avatarPackUploadFailed"),
        type: "error",
        duration: 2200,
      });
      return merged.slice(0, MAX_AVATAR_PACK_FILE_COUNT);
    });
  }, [t]);

  const handleAvatarAssetInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    mergeAvatarUploadFiles(files);
    event.target.value = "";
  };

  const handleOpenAvatarAssetFileDialog = () => {
    avatarAssetInputRef.current?.click();
  };

  const handleAvatarDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsAvatarDropActive(false);
    const droppedFiles = Array.from(event.dataTransfer.files || []);
    mergeAvatarUploadFiles(droppedFiles);
  };

  const handleAvatarPackUpload = async () => {
    const trimmedPackName = avatarPackNameInput.trim();
    if (!trimmedPackName) {
      toaster.create({
        title: t("error.avatarPackNameRequired"),
        type: "error",
        duration: 1800,
      });
      return;
    }

    const hasDuplicatePackName = avatarPacks.some(
      (pack) => normalizeUniqueName(pack.name) === normalizeUniqueName(trimmedPackName),
    );

    if (hasDuplicatePackName) {
      toaster.create({
        title: t("error.avatarPackNameDuplicate", { name: trimmedPackName }),
        type: "error",
        duration: 2600,
      });
      return;
    }

    if (!avatarUploadFiles.length) {
      toaster.create({
        title: t("error.avatarPackFilesRequired"),
        type: "error",
        duration: 1800,
      });
      return;
    }

    const formData = new FormData();
    formData.append("pack_name", trimmedPackName);
    avatarUploadFiles.forEach((file) => {
      formData.append("files", file);
    });

    setIsUploadingAvatarPack(true);
    try {
      const response = await fetch(`${normalizedBaseUrl}/avatar-packs/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = await response
        .json()
        .catch(() => ({} as { error?: string; pack?: AvatarPackCatalogItem }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.avatarPackUploadFailed"));
      }

      const uploadedPackId = payload.pack?.pack_id || "";
      const nextPacks = await fetchAvatarPacks();
      const targetPackId = uploadedPackId
        || nextPacks.find((pack) => pack.name === trimmedPackName)?.pack_id
        || nextPacks[0]?.pack_id
        || "";

      if (targetPackId) {
        setSelectedAvatarPack([targetPackId]);
        setStageAvatarTab("avatarpack");
        activateAvatarPackMode(targetPackId);
      }

      toaster.create({
        title: t("notification.avatarPackUploaded"),
        type: "success",
        duration: 2000,
      });

      setAvatarUploadDialogOpen(false);
      resetAvatarUploadDialogState();
    } catch (error) {
      toaster.create({
        title: `${t("error.avatarPackUploadFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2600,
      });
    } finally {
      setIsUploadingAvatarPack(false);
    }
  };

  const closeAvatarUploadDialog = () => {
    setAvatarUploadDialogOpen(false);
    resetAvatarUploadDialogState();
  };

  const handleAvatarUploadDialogOpenChange = (details: { open: boolean }) => {
    setAvatarUploadDialogOpen(details.open);
    if (!details.open) {
      resetAvatarUploadDialogState();
    }
  };

  const handleRemoveAvatarUploadFile = (index: number) => {
    setAvatarUploadFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleSelectBackgroundFile = () => {
    fileInputRef.current?.click();
  };

  const handleBackgroundSelectChange = (value: string[]) => {
    const selectedBackgroundPath = value[0] || "";
    handleSettingChange("selectedBgUrl", value);
    handleSettingChange("customBgUrl", "");
    handleSettingChange("useCameraBackground", false);
    bgUrlContext?.setUseCameraBackground(false);
    if (selectedBackgroundPath) {
      bgUrlContext?.setBackgroundUrl(resolveBackgroundFullUrl(selectedBackgroundPath));
    }
    markDirty();
  };

  const handleDeleteBackground = async (backgroundPath: string) => {
    if (!backgroundPath || deletingBackgroundName) {
      return;
    }

    const backgroundName = getBackgroundFilenameFromPath(backgroundPath);
    if (!backgroundName || PROTECTED_BACKGROUND_FILENAMES.has(backgroundName)) {
      return;
    }

    const normalizedBaseUrl = settings.baseUrl.replace(/\/+$/, "");
    const endpoint = `${normalizedBaseUrl}/backgrounds/${encodeURIComponent(backgroundName)}`;
    const isCurrentBackground = settings.selectedBgUrl[0] === backgroundPath;

    setDeletingBackgroundName(backgroundName);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response
        .json()
        .catch(() => ({} as { error?: string }));

      if (!response.ok) {
        throw new Error(payload.error || t("error.backgroundDeleteFailed"));
      }

      bgUrlContext?.removeBackgroundFile(backgroundName);

      if (isCurrentBackground) {
        const fallbackBackgroundPath = backgrounds.items
          .map((item) => item.value)
          .find((value) => value !== backgroundPath)
          || `/bg/${DEFAULT_BACKGROUND_FILENAME}`;
        const fallbackBackgroundUrl = `${normalizedBaseUrl}${fallbackBackgroundPath}`;

        bgUrlContext?.setBackgroundUrl(fallbackBackgroundUrl);
        handleSettingChange("selectedBgUrl", [fallbackBackgroundPath]);
      }

      wsService.sendMessage({ type: "fetch-backgrounds" });
      toaster.create({
        title: t("notification.backgroundDeleted"),
        type: "success",
        duration: 1800,
      });
      markDirty();
    } catch (error) {
      toaster.create({
        title: `${t("error.backgroundDeleteFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2200,
      });
    } finally {
      setDeletingBackgroundName(null);
    }
  };

  const uploadBackgroundFile = async (file: File | null) => {
    if (!file || isUploadingBackground) {
      return;
    }

    const normalizedBaseUrl = settings.baseUrl.replace(/\/+$/, "");
    const endpoint = `${normalizedBaseUrl}/backgrounds/upload`;
    const formData = new FormData();
    formData.append("file", file);

    setIsUploadingBackground(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const payload = await response
        .json()
        .catch(() => ({} as { error?: string; url?: string }));

      if (!response.ok) {
        throw new Error(
          payload.error || t("error.backgroundUploadFailed"),
        );
      }

      if (payload.url) {
        const fullUrl = payload.url.startsWith("http")
          ? payload.url
          : `${normalizedBaseUrl}${payload.url}`;
        bgUrlContext?.setBackgroundUrl(fullUrl);
        handleSettingChange("selectedBgUrl", [payload.url]);
      }

      wsService.sendMessage({ type: "fetch-backgrounds" });
      toaster.create({
        title: t("notification.backgroundUploadSuccess"),
        type: "success",
        duration: 2000,
      });
      markDirty();
    } catch (error) {
      toaster.create({
        title: `${t("error.backgroundUploadFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2500,
      });
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    await uploadBackgroundFile(file);
    event.target.value = "";
  };

  const handleBackgroundDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsBackgroundDropActive(false);
    const file = Array.from(event.dataTransfer.files || []).find((droppedFile) =>
      [".jpg", ".jpeg", ".png", ".gif", ".webp"].some((extension) =>
        droppedFile.name.toLowerCase().endsWith(extension),
      ),
    ) || null;
    await uploadBackgroundFile(file);
  };

  return (
    <Stack {...settingStyles.common.container}>
      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.stage.avatarModule")}
          </Text>

          <Tabs.Root
            value={stageAvatarTab}
            onValueChange={(details) => handleAvatarModeTabChange([details.value])}
            variant="plain"
            colorPalette="gray"
          >
            <Box display="flex" justifyContent="center" width="100%" mb={4}>
              <Tabs.List
                bg="linear-gradient(135deg, rgba(30,41,59,0.86), rgba(15,23,42,0.94))"
                borderRadius="full"
                p="6px"
                gap={2}
                width="fit-content"
                minW="304px"
                borderWidth="1px"
                borderColor="whiteAlpha.200"
                boxShadow="0 10px 28px rgba(2,6,23,0.28)"
                backdropFilter="blur(16px)"
                justifyContent="center"
              >
                <Tabs.Trigger
                  value="avatarpack"
                  color="whiteAlpha.760"
                  minW="136px"
                  minH="42px"
                  px={5}
                  py={2}
                  borderRadius="full"
                  fontSize="sm"
                  fontWeight="semibold"
                  letterSpacing="0.02em"
                  transition="all 0.18s ease"
                  _selected={{
                    color: "white",
                    bg: "linear-gradient(135deg, rgba(14,165,233,0.95), rgba(37,99,235,0.95))",
                    boxShadow: "0 8px 18px rgba(37,99,235,0.35)",
                    transform: "translateY(-1px)",
                  }}
                  _hover={{
                    color: "white",
                    bg: "whiteAlpha.120",
                  }}
                >
                  {t("settings.stage.avatarPackTab")}
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="live2d"
                  color="whiteAlpha.760"
                  minW="136px"
                  minH="42px"
                  px={5}
                  py={2}
                  borderRadius="full"
                  fontSize="sm"
                  fontWeight="semibold"
                  letterSpacing="0.02em"
                  transition="all 0.18s ease"
                  _selected={{
                    color: "white",
                    bg: "linear-gradient(135deg, rgba(56,189,248,0.95), rgba(99,102,241,0.95))",
                    boxShadow: "0 8px 18px rgba(59,130,246,0.32)",
                    transform: "translateY(-1px)",
                  }}
                  _hover={{
                    color: "white",
                    bg: "whiteAlpha.120",
                  }}
                >
                  {t("settings.stage.live2dTab")}
                </Tabs.Trigger>
              </Tabs.List>
            </Box>

            <Tabs.Content value="avatarpack">
              <Stack gap={4}>
                <Stack gap={3}>
                  <Text {...settingStyles.general.field.label}>
                    {t("settings.stage.avatarPackSelect")}
                  </Text>
                  {avatarPackCollection.items.length === 0 ? (
                    <Box
                      minH="120px"
                      borderRadius="lg"
                      borderWidth="1px"
                      borderStyle="dashed"
                      borderColor="whiteAlpha.300"
                      bg="whiteAlpha.50"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Text fontSize="md" color="gray.400">
                        {isLoadingAvatarPacks
                          ? t("common.loading")
                          : t("settings.stage.noAvatarPacks")}
                      </Text>
                    </Box>
                  ) : (
                    <Box
                      display="grid"
                      gridTemplateColumns="repeat(2, minmax(0, 1fr))"
                      gap={3}
                    >
                      {avatarPackCollection.items.map((packItem) => {
                        const isCurrent = packItem.value === selectedAvatarPack[0]
                          && avatarMode === "avatarpack";
                        const isDeleting = deletingAvatarPackId === packItem.value;
                        const previewUrl = resolveStageAssetUrl(packItem.thumbUrl);

                        return (
                          <Box
                            key={packItem.value}
                            role="button"
                            tabIndex={0}
                            minH="214px"
                            p={3}
                            borderRadius="lg"
                            borderWidth="2px"
                            borderColor={isCurrent ? "blue.300" : "whiteAlpha.200"}
                            bg={isCurrent
                              ? "linear-gradient(160deg, rgba(14,165,233,0.26), rgba(15,23,42,0.92))"
                              : "whiteAlpha.50"}
                            boxShadow={isCurrent
                              ? "0 14px 30px rgba(14,165,233,0.20)"
                              : "0 8px 20px rgba(2,6,23,0.18)"}
                            cursor="pointer"
                            transition="all 0.18s ease"
                            onClick={() => handleAvatarPackChange([packItem.value])}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleAvatarPackChange([packItem.value]);
                              }
                            }}
                            _active={{ transform: "scale(0.985)" }}
                          >
                            <Stack gap={3} h="100%">
                              <Box
                                h="112px"
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor={isCurrent ? "blue.200" : "whiteAlpha.200"}
                                bg="blackAlpha.420"
                                overflow="hidden"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                position="relative"
                              >
                                {previewUrl ? (
                                  <Image
                                    src={previewUrl}
                                    alt={packItem.label}
                                    maxW="100%"
                                    maxH="100%"
                                    objectFit="contain"
                                  />
                                ) : (
                                  <Text fontSize="3xl" fontWeight="bold" color="whiteAlpha.700">
                                    {getDisplayInitial(packItem.label)}
                                  </Text>
                                )}
                                {isCurrent && (
                                  <Box
                                    position="absolute"
                                    top={2}
                                    right={2}
                                    w="28px"
                                    h="28px"
                                    borderRadius="full"
                                    bg="blue.500"
                                    color="white"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                  >
                                    <FiCheck />
                                  </Box>
                                )}
                              </Box>
                              <Stack gap={2} flex={1}>
                                <Text
                                  fontSize="16px"
                                  fontWeight="bold"
                                  color="whiteAlpha.950"
                                  lineHeight={1.25}
                                  lineClamp={2}
                                >
                                  {packItem.label}
                                </Text>
                                <HStack gap={2} flexWrap="wrap">
                                  {packItem.isCustom && (
                                    <Text fontSize="12px" color="blue.200">
                                      {t("settings.character.customModelTag")}
                                    </Text>
                                  )}
                                  {packItem.hasAction && (
                                    <Text fontSize="12px" color="green.200">
                                      {t("settings.stage.actionTag")}
                                    </Text>
                                  )}
                                  {isCurrent && (
                                    <Text fontSize="12px" color="blue.100">
                                      {t("settings.character.currentPreset")}
                                    </Text>
                                  )}
                                </HStack>
                              </Stack>
                              {packItem.canDelete && !isCurrent && (
                                <IconButton
                                  aria-label={t("settings.stage.deleteAvatarPack")}
                                  size="sm"
                                  minH="40px"
                                  alignSelf="stretch"
                                  variant="outline"
                                  colorPalette="red"
                                  loading={isDeleting}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleDeleteAvatarPack(packItem.value);
                                  }}
                                >
                                  <FiTrash2 />
                                </IconButton>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                  {activeAvatarPack?.has_action && (
                    <Text fontSize="sm" color="whiteAlpha.700" lineHeight={1.6}>
                      {t("settings.stage.avatarActionHint")}
                    </Text>
                  )}
                </Stack>

                <Box {...settingStyles.common.accentCard}>
                  <Stack gap={3}>
                    <Text {...settingStyles.common.sectionTitle}>
                      {t("settings.stage.avatarUploadModule")}
                    </Text>
                    <Text fontSize="sm" color="blue.100" lineHeight={1.6}>
                      {t("settings.stage.avatarUploadHint")}
                    </Text>
                    <Button
                      w="100%"
                      size="md"
                      minH="46px"
                      borderRadius="lg"
                      colorPalette="blue"
                      onClick={() => setAvatarUploadDialogOpen(true)}
                    >
                      <HStack gap={2}>
                        <FiUpload />
                        <Text>
                          {t("settings.stage.uploadAvatarAssetsButton")}
                        </Text>
                      </HStack>
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Tabs.Content>

            <Tabs.Content value="live2d">
              <Stack gap={4}>
                <Stack gap={3}>
                  <Text {...settingStyles.general.field.label}>
                    {t("settings.character.live2dModel")}
                  </Text>
                  {live2dModelCollection.items.length === 0 ? (
                    <Box
                      minH="120px"
                      borderRadius="lg"
                      borderWidth="1px"
                      borderStyle="dashed"
                      borderColor="whiteAlpha.300"
                      bg="whiteAlpha.50"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Text px={3} py={2} fontSize="sm" color="gray.400">
                        {isLoadingLive2dModels
                          ? t("common.loading")
                          : t("settings.character.noLive2dModels")}
                      </Text>
                    </Box>
                  ) : (
                    <Box
                      display="grid"
                      gridTemplateColumns="repeat(2, minmax(0, 1fr))"
                      gap={3}
                    >
                      {live2dModelCollection.items.map((modelItem) => {
                        const isCurrent = modelItem.value === selectedLive2dModel[0]
                          && avatarMode === "live2d";
                        const isDeleting = deletingLive2dModelName === modelItem.value;
                        const catalogItem = live2dModels.find((model) => model.name === modelItem.value);
                        const previewUrl = resolveLive2dPreviewUrl(catalogItem?.avatar);

                        return (
                          <Box
                            key={modelItem.value}
                            role="button"
                            tabIndex={0}
                            minH="188px"
                            p={3}
                            borderRadius="lg"
                            borderWidth="2px"
                            borderColor={isCurrent ? "cyan.300" : "whiteAlpha.200"}
                            bg={isCurrent
                              ? "linear-gradient(160deg, rgba(34,211,238,0.22), rgba(15,23,42,0.92))"
                              : "whiteAlpha.50"}
                            boxShadow={isCurrent
                              ? "0 14px 30px rgba(34,211,238,0.18)"
                              : "0 8px 20px rgba(2,6,23,0.18)"}
                            cursor="pointer"
                            transition="all 0.18s ease"
                            onClick={() => handleLive2dModelChange([modelItem.value])}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleLive2dModelChange([modelItem.value]);
                              }
                            }}
                            _active={{ transform: "scale(0.985)" }}
                          >
                            <Stack gap={3} h="100%">
                              <Box
                                h="92px"
                                borderRadius="md"
                                borderWidth="1px"
                                borderColor={isCurrent ? "cyan.200" : "whiteAlpha.200"}
                                bg="blackAlpha.420"
                                overflow="hidden"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                position="relative"
                              >
                                {previewUrl ? (
                                  <Image
                                    src={previewUrl}
                                    alt={modelItem.label}
                                    maxW="100%"
                                    maxH="100%"
                                    objectFit="contain"
                                  />
                                ) : (
                                  <Box
                                    w="72px"
                                    h="72px"
                                    borderRadius="24px"
                                    bg="linear-gradient(160deg, rgba(34,211,238,0.30), rgba(59,130,246,0.12))"
                                    borderWidth="1px"
                                    borderColor="cyan.200"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    boxShadow="inset 0 0 28px rgba(34,211,238,0.12)"
                                  >
                                    <Stack gap={0} align="center">
                                      <Text fontSize="2xl" fontWeight="bold" color="cyan.50" lineHeight={1}>
                                        {getDisplayInitial(modelItem.label)}
                                      </Text>
                                      <Text fontSize="10px" color="cyan.100" fontWeight="semibold">
                                        Live2D
                                      </Text>
                                    </Stack>
                                  </Box>
                                )}
                                {isCurrent && (
                                  <Box
                                    position="absolute"
                                    top={2}
                                    right={2}
                                    w="28px"
                                    h="28px"
                                    borderRadius="full"
                                    bg="cyan.500"
                                    color="white"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                  >
                                    <FiCheck />
                                  </Box>
                                )}
                              </Box>
                              <Stack gap={2} flex={1}>
                                <Text
                                  fontSize="16px"
                                  fontWeight="bold"
                                  color="whiteAlpha.950"
                                  lineHeight={1.25}
                                  lineClamp={2}
                                >
                                  {modelItem.label}
                                </Text>
                                <HStack gap={2} flexWrap="wrap">
                                  {modelItem.isCustom && (
                                    <Text fontSize="12px" color="blue.200">
                                      {t("settings.character.customModelTag")}
                                    </Text>
                                  )}
                                  {isCurrent && (
                                    <Text fontSize="12px" color="cyan.100">
                                      {t("settings.character.currentPreset")}
                                    </Text>
                                  )}
                                </HStack>
                              </Stack>
                              {modelItem.canDelete && !isCurrent && (
                                <IconButton
                                  aria-label={t("settings.character.deleteLive2dModel")}
                                  size="sm"
                                  minH="40px"
                                  alignSelf="stretch"
                                  variant="outline"
                                  colorPalette="red"
                                  loading={isDeleting}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleDeleteLive2dModel(modelItem.value);
                                  }}
                                >
                                  <FiTrash2 />
                                </IconButton>
                              )}
                            </Stack>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                  {activeLive2dModel && (
                    <Text fontSize="sm" color="whiteAlpha.700" lineHeight={1.6}>
                      {activeLive2dModel.name}
                    </Text>
                  )}
                </Stack>

                <Box {...settingStyles.common.accentCard}>
                  <Stack gap={3}>
                    <Text {...settingStyles.common.sectionTitle}>
                      {t("settings.character.uploadLive2dModel")}
                    </Text>
                    <Text fontSize="xs" color="blue.100">
                      {t("settings.character.uploadLive2dModelHint")}
                    </Text>
                    <Button
                      w="100%"
                      size="md"
                      minH="46px"
                      borderRadius="lg"
                      colorPalette="blue"
                      onClick={handleOpenLive2dUploadDialog}
                      disabled={isUploadingLive2dModel}
                    >
                      <HStack gap={2}>
                        <FiPlus />
                        <Text fontWeight="semibold">
                          {isUploadingLive2dModel
                            ? t("settings.character.uploadingLive2dModel")
                            : t("settings.character.uploadLive2dModelButton")}
                        </Text>
                      </HStack>
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Tabs.Content>
          </Tabs.Root>
        </Stack>
      </Box>

      <Input
        type="file"
        accept=".zip"
        ref={live2dModelZipInputRef}
        onChange={handleLive2dModelUpload}
        display="none"
      />

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.stage.backgroundModule")}
          </Text>

          <Stack gap={3}>
            <HStack justify="space-between" align="center">
              <Text {...settingStyles.general.field.label}>
                {t("settings.general.backgroundImage")}
              </Text>
              {selectedBackgroundPath && (
                <Text
                  px={3}
                  py={1}
                  borderRadius="full"
                  bg="whiteAlpha.100"
                  color="blue.100"
                  fontSize="12px"
                  fontWeight="semibold"
                >
                  {t("settings.character.currentPreset")}
                </Text>
              )}
            </HStack>

            {backgrounds.items.length === 0 ? (
              <Box
                minH="120px"
                borderRadius="lg"
                borderWidth="1px"
                borderStyle="dashed"
                borderColor="whiteAlpha.300"
                bg="whiteAlpha.50"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <Text px={3} py={2} fontSize="sm" color="gray.400">
                  {t("settings.stage.noBackgrounds")}
                </Text>
              </Box>
            ) : (
              <Box
                {...backgroundDragScroll}
                maxH="424px"
                overflowY="auto"
                pr={1}
                css={{
                  touchAction: "pan-y",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  "&::-webkit-scrollbar": {
                    width: "4px",
                  },
                  "&::-webkit-scrollbar-track": {
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: "999px",
                  },
                  "&::-webkit-scrollbar-thumb": {
                    background: "rgba(255,255,255,0.26)",
                    borderRadius: "999px",
                  },
                }}
              >
                <Box
                  display="grid"
                  gridTemplateColumns="repeat(2, minmax(0, 1fr))"
                  gap={3}
                >
                  {backgrounds.items.map((backgroundItem) => {
                    const isCurrent = backgroundItem.value === selectedBackgroundPath;
                    const isDeleting = deletingBackgroundName === getBackgroundFilenameFromPath(backgroundItem.value);
                    const previewUrl = resolveBackgroundFullUrl(backgroundItem.value);

                    return (
                      <Box
                        key={backgroundItem.value}
                        role="button"
                        tabIndex={0}
                        minH="150px"
                        p={2}
                        borderRadius="lg"
                        borderWidth="2px"
                        borderColor={isCurrent ? "blue.300" : "whiteAlpha.200"}
                        bg={isCurrent
                          ? "linear-gradient(160deg, rgba(14,165,233,0.24), rgba(15,23,42,0.92))"
                          : "whiteAlpha.50"}
                        boxShadow={isCurrent
                          ? "0 14px 30px rgba(14,165,233,0.18)"
                          : "0 8px 20px rgba(2,6,23,0.16)"}
                        cursor="pointer"
                        transition="all 0.18s ease"
                        onClick={() => handleBackgroundSelectChange([backgroundItem.value])}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleBackgroundSelectChange([backgroundItem.value]);
                          }
                        }}
                        _active={{ transform: "scale(0.985)" }}
                      >
                        <Stack gap={2} h="100%">
                          <Box
                            h="86px"
                            borderRadius="md"
                            borderWidth="1px"
                            borderColor={isCurrent ? "blue.200" : "whiteAlpha.200"}
                            bg="blackAlpha.420"
                            overflow="hidden"
                            position="relative"
                          >
                            <Image
                              src={previewUrl}
                              alt={backgroundItem.label}
                              w="100%"
                              h="100%"
                              objectFit="cover"
                            />
                            {isCurrent && (
                              <Box
                                position="absolute"
                                top={2}
                                right={2}
                                w="28px"
                                h="28px"
                                borderRadius="full"
                                bg="blue.500"
                                color="white"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                              >
                                <FiCheck />
                              </Box>
                            )}
                          </Box>

                          <HStack gap={2} align="start" justify="space-between">
                            <Text
                              flex={1}
                              minW={0}
                              fontSize="13px"
                              fontWeight="semibold"
                              color="whiteAlpha.900"
                              lineHeight={1.3}
                              lineClamp={2}
                            >
                              {backgroundItem.label}
                            </Text>
                            {backgroundItem.deletable && !isCurrent && (
                              <IconButton
                                aria-label={t("settings.stage.deleteBackground")}
                                size="xs"
                                minW="34px"
                                minH="34px"
                                variant="ghost"
                                colorPalette="red"
                                loading={isDeleting}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDeleteBackground(backgroundItem.value);
                                }}
                              >
                                <FiTrash2 />
                              </IconButton>
                            )}
                          </HStack>
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Stack>

          <Box {...settingStyles.common.accentCard}>
            <Stack gap={3}>
              <Text {...settingStyles.common.sectionTitle}>
                {t("settings.stage.uploadCardTitle")}
              </Text>
              <Text fontSize="sm" color="whiteAlpha.700" lineHeight={1.5}>
                {t("settings.stage.uploadCardDescription")}
              </Text>
              <Text fontSize="sm" color="blue.100">
                {t("settings.general.uploadBackgroundHint")}
              </Text>

              <Box
                p={5}
                borderRadius="lg"
                borderWidth="2px"
                borderStyle="dashed"
                borderColor={isBackgroundDropActive ? "blue.300" : "whiteAlpha.300"}
                bg={isBackgroundDropActive ? "blue.900/30" : "whiteAlpha.50"}
                transition="all 0.2s ease"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsBackgroundDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsBackgroundDropActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsBackgroundDropActive(false);
                }}
                onDrop={handleBackgroundDrop}
              >
                <Stack align="center" gap={3}>
                  <IconButton
                    aria-label={t("settings.stage.uploadButton")}
                    size="sm"
                    colorPalette="blue"
                    variant="solid"
                    onClick={handleSelectBackgroundFile}
                    disabled={isUploadingBackground}
                  >
                    <FiPlus />
                  </IconButton>
                  <Text fontSize="md" color="whiteAlpha.900" fontWeight="medium" textAlign="center">
                    {isUploadingBackground
                      ? t("settings.general.uploadingBackground")
                      : t("settings.stage.uploadButton")}
                  </Text>
                  <Text fontSize="sm" color="whiteAlpha.700" textAlign="center" lineHeight={1.5}>
                    {t("settings.stage.uploadBackgroundDropHint")}
                  </Text>
                  <Button
                    size="sm"
                    variant="outline"
                    colorPalette="blue"
                    onClick={handleSelectBackgroundFile}
                    disabled={isUploadingBackground}
                  >
                    {t("settings.stage.uploadButton")}
                  </Button>
                </Stack>
              </Box>
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Input
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp"
        ref={fileInputRef}
        onChange={handleBackgroundUpload}
        display="none"
      />

      <Input
        type="file"
        ref={avatarAssetInputRef}
        onChange={handleAvatarAssetInputChange}
        display="none"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gif,.zip"
      />

      <DialogRoot
        lazyMount
        open={avatarUploadDialogOpen}
        onOpenChange={handleAvatarUploadDialogOpenChange}
      >
        <DialogContent
          maxW="720px"
          bg="gray.900"
          borderWidth="1px"
          borderColor="whiteAlpha.300"
          boxShadow="0 24px 48px rgba(2, 6, 23, 0.45)"
        >
          <DialogHeader>
            <DialogTitle>{t("settings.stage.avatarUploadDialogTitle")}</DialogTitle>
            <DialogCloseTrigger onClick={closeAvatarUploadDialog} />
          </DialogHeader>
          <DialogBody>
            <Stack gap={4}>
              <Field
                label={<Text {...settingStyles.general.field.label}>{t("settings.stage.avatarPackName")}</Text>}
              >
                <Input
                  {...settingStyles.common.input}
                  value={avatarPackNameInput}
                  onChange={(event) => setAvatarPackNameInput(event.target.value)}
                  placeholder={t("settings.stage.avatarPackNamePlaceholder")}
                />
              </Field>

              <Box
                p={3}
                borderRadius="md"
                borderWidth="1px"
                borderColor="whiteAlpha.200"
                bg="whiteAlpha.50"
              >
                <Stack gap={2}>
                  <Text fontSize="sm" color="whiteAlpha.900" fontWeight="medium">
                    {t("settings.stage.avatarUploadSupportTitle")}
                  </Text>
                  <Text fontSize="xs" color="whiteAlpha.700" lineHeight={1.6}>
                    {t("settings.stage.avatarUploadSupportDesc")}
                  </Text>
                  <Text fontSize="xs" color="whiteAlpha.700" lineHeight={1.7}>
                    {t("settings.stage.avatarUploadNamingRules")}
                  </Text>
                </Stack>
              </Box>

              <Box
                p={5}
                borderRadius="lg"
                borderWidth="2px"
                borderStyle="dashed"
                borderColor={isAvatarDropActive ? "blue.300" : "whiteAlpha.300"}
                bg={isAvatarDropActive ? "blue.900/30" : "whiteAlpha.50"}
                transition="all 0.2s ease"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsAvatarDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsAvatarDropActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsAvatarDropActive(false);
                }}
                onDrop={handleAvatarDrop}
              >
                <Stack align="center" gap={3}>
                  <IconButton
                    aria-label={t("settings.stage.chooseAvatarAssets")}
                    size="sm"
                    colorPalette="blue"
                    variant="solid"
                    onClick={handleOpenAvatarAssetFileDialog}
                  >
                    <FiPlus />
                  </IconButton>
                  <Text fontSize="sm" color="whiteAlpha.900" fontWeight="medium">
                    {t("settings.stage.avatarDropHint")}
                  </Text>
                  <Text fontSize="xs" color="whiteAlpha.700" textAlign="center" lineHeight={1.5}>
                    {t("settings.stage.avatarDropSubHint")}
                  </Text>
                  <Button
                    size="sm"
                    variant="outline"
                    colorPalette="blue"
                    onClick={handleOpenAvatarAssetFileDialog}
                  >
                    {t("settings.stage.chooseAvatarAssets")}
                  </Button>
                </Stack>
              </Box>

              {avatarUploadFiles.length > 0 && (
                <Box
                  maxH="210px"
                  overflowY="auto"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="whiteAlpha.200"
                  bg="whiteAlpha.50"
                  p={2}
                >
                  <Stack gap={2}>
                    {avatarUploadFiles.map((file, index) => (
                      <HStack
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        justify="space-between"
                        align="center"
                        px={2}
                        py={1.5}
                        borderRadius="sm"
                        bg="whiteAlpha.100"
                      >
                        <Stack gap={0}>
                          <Text fontSize="sm" color="whiteAlpha.900" maxW="420px" truncate>
                            {file.name}
                          </Text>
                          <Text fontSize="xs" color="whiteAlpha.700">
                            {formatFileSize(file.size)}
                          </Text>
                        </Stack>
                        <IconButton
                          aria-label={t("common.close")}
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          onClick={() => handleRemoveAvatarUploadFile(index)}
                        >
                          <FiX />
                        </IconButton>
                      </HStack>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </DialogBody>
          <DialogFooter>
            <Button colorPalette="red" onClick={closeAvatarUploadDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              colorPalette="blue"
              loading={isUploadingAvatarPack}
              onClick={handleAvatarPackUpload}
            >
              {isUploadingAvatarPack
                ? t("settings.character.uploadingLive2dModel")
                : t("settings.stage.processAvatarAssets")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </Stack>
  );
}

export default Stage;
