/* eslint-disable import/no-extraneous-dependencies */
import {
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
  Input,
  IconButton,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { FiCheck, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { settingStyles } from "./setting-styles";
import { useConfig } from "@/context/character-config-context";
import { useClassroom } from "@/context/classroom-context";
import { useWebSocket } from "@/context/websocket-context";
import { useSwitchCharacter } from "@/hooks/utils/use-switch-character";
import { wsService } from "@/services/websocket-service";
import { toaster } from "@/components/ui/toaster";

interface CharacterProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

interface PersonaFormValues {
  characterName: string;
  description: string;
  generatedPrompt: string;
}

interface LegacyPersonaFormValues {
  characterName?: string;
  humanName?: string;
  gender?: string;
  personality?: string;
  tone?: string;
  interactionRule?: string;
  extra?: string;
  description?: string;
  generatedPrompt?: string;
}

interface CustomPersonaPreset {
  id: string;
  label: string;
  characterName: string;
  humanName: string;
  personaPrompt: string;
  form: PersonaFormValues;
  createdAt: string;
}

interface PresetOption {
  label: string;
  value: string;
  deletable: boolean;
  kind: "builtin" | "custom" | "current";
  description: string;
  meta: string;
}

const CUSTOM_PRESET_STORAGE_KEY = "customPersonaPresets";
const ACTIVE_CUSTOM_PRESET_STORAGE_KEY = "activeCustomPersonaPresetId";
const HIDDEN_BUILTIN_PRESET_STORAGE_KEY = "hiddenBuiltinPersonaPresets";
const LAST_SELECTED_PRESET_STORAGE_KEY = "lastSelectedCharacterPresetValue";
const PRESET_PRUNE_ONCE_STORAGE_KEY = "personaPresetPrunedToCurrentCustomV1";
const CUSTOM_PRESET_PREFIX = "custom::";
const CURRENT_SESSION_PRESET_VALUE = "__current_session_persona__";

const toCustomPresetValue = (id: string): string => `${CUSTOM_PRESET_PREFIX}${id}`;

const parseCustomPresetId = (value: string): string | null =>
  value.startsWith(CUSTOM_PRESET_PREFIX)
    ? value.replace(CUSTOM_PRESET_PREFIX, "")
    : null;

const normalizePresetText = (value?: string): string =>
  (value || "").replace(/\s+/g, " ").trim();

const normalizeUniqueName = (value?: string): string =>
  (value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();

const getConfUidSearchTokens = (confUid?: string): string[] => {
  const normalizedUid = (confUid || "").trim();
  if (!normalizedUid) {
    return [];
  }

  const tokens = new Set<string>([normalizedUid]);
  const browserPersonaId = normalizedUid.match(/browser_persona_(\d+)/)?.[1];
  if (browserPersonaId) {
    tokens.add(`persona_${browserPersonaId}`);
    tokens.add(browserPersonaId);
  }

  return [...tokens];
};

const getDisplayInitial = (name: string): string => {
  const trimmedName = name.trim();
  return trimmedName ? trimmedName.slice(0, 1).toUpperCase() : "?";
};

const getPromptExcerpt = (prompt: string, fallback: string): string => {
  const normalizedPrompt = prompt
    .replace(/\s+/g, " ")
    .replace(/^你是/, "")
    .trim();

  if (!normalizedPrompt) {
    return fallback;
  }

  return normalizedPrompt.length > 70
    ? `${normalizedPrompt.slice(0, 70)}...`
    : normalizedPrompt;
};

const loadCustomPresets = (): CustomPersonaPreset[] => {
  try {
    const rawValue = localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item) =>
        item
        && typeof item.id === "string"
        && typeof item.label === "string"
        && typeof item.characterName === "string"
        && typeof item.humanName === "string"
        && typeof item.personaPrompt === "string"
        && item.form,
    );
  } catch (error) {
    console.warn("Failed to load custom persona presets:", error);
    return [];
  }
};

const saveCustomPresets = (presets: CustomPersonaPreset[]) => {
  localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(presets));
};

const loadHiddenBuiltinPresets = (): string[] => {
  try {
    const rawValue = localStorage.getItem(HIDDEN_BUILTIN_PRESET_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => typeof item === "string");
  } catch (error) {
    console.warn("Failed to load hidden builtin presets:", error);
    return [];
  }
};

const saveHiddenBuiltinPresets = (filenames: string[]) => {
  localStorage.setItem(HIDDEN_BUILTIN_PRESET_STORAGE_KEY, JSON.stringify(filenames));
};

const loadActiveCustomPresetId = (): string | null => {
  try {
    const rawValue = localStorage.getItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    return rawValue;
  } catch (error) {
    console.warn("Failed to load active custom preset id:", error);
    return null;
  }
};

const loadLastSelectedPresetValue = (): string | null => {
  try {
    const rawValue = localStorage.getItem(LAST_SELECTED_PRESET_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    return rawValue;
  } catch (error) {
    console.warn("Failed to load last selected preset value:", error);
    return null;
  }
};

const toSimpleDescriptionFromLegacyForm = (legacyForm: LegacyPersonaFormValues): string => {
  const lines = [
    legacyForm.gender ? `性别设定：${legacyForm.gender}` : "",
    legacyForm.personality ? `性格设定：${legacyForm.personality}` : "",
    legacyForm.tone ? `说话风格：${legacyForm.tone}` : "",
    legacyForm.interactionRule ? `互动规则：${legacyForm.interactionRule}` : "",
    legacyForm.extra ? `补充设定：${legacyForm.extra}` : "",
  ].filter(Boolean);
  return lines.join("\n");
};

const normalizePersonaForm = (
  rawForm: LegacyPersonaFormValues | PersonaFormValues | undefined,
  fallbackCharacterName: string,
  fallbackPrompt: string,
): PersonaFormValues => {
  const form = rawForm || {};
  const characterName =
    (typeof form.characterName === "string" ? form.characterName : "").trim()
    || fallbackCharacterName;

  const description =
    (typeof (form as PersonaFormValues).description === "string"
      ? (form as PersonaFormValues).description
      : "") || toSimpleDescriptionFromLegacyForm(form);

  const generatedPrompt =
    (typeof (form as PersonaFormValues).generatedPrompt === "string"
      ? (form as PersonaFormValues).generatedPrompt
      : "")
    || fallbackPrompt
    || (typeof (form as LegacyPersonaFormValues).extra === "string"
      ? (form as LegacyPersonaFormValues).extra
      : "")
    || "";

  return {
    characterName,
    description,
    generatedPrompt,
  };
};

const toPersonaInputKey = (characterName: string, description: string): string =>
  `${characterName.trim()}::${description.trim()}`;

function Character({ onSave, onCancel }: CharacterProps): JSX.Element {
  const { t } = useTranslation();
  const {
    confName,
    confUid,
    characterName,
    humanName,
    personaPrompt,
    configFiles,
    getFilenameByName,
    setCharacterName,
    setHumanName,
    setPersonaPrompt,
  } = useConfig();
  const { switchCharacter } = useSwitchCharacter();
  const { markDirty } = useClassroom();
  const { wsState } = useWebSocket();
  const [isApplyingPersona, setIsApplyingPersona] = useState(false);
  const [customPresets, setCustomPresets] = useState<CustomPersonaPreset[]>(() => loadCustomPresets());
  const [hiddenBuiltinPresetFiles, setHiddenBuiltinPresetFiles] = useState<string[]>(() => loadHiddenBuiltinPresets());
  const [activeCustomPresetId, setActiveCustomPresetId] = useState<string | null>(() => loadActiveCustomPresetId());
  const [selectedCharacterPreset, setSelectedCharacterPreset] = useState<string[]>([]);
  const [, setLastSelectedPresetValue] = useState<string | null>(
    () => loadLastSelectedPresetValue(),
  );
  const latestPersonaRequestIdRef = useRef<string>("");
  const latestPersonaInputKeyRef = useRef<string>("");
  const pendingPersonaInputKeyRef = useRef<string>("");

  const defaultFormValues = useMemo(
    () => normalizePersonaForm(
      undefined,
      characterName || confName || "",
      personaPrompt || "",
    ),
    [characterName, confName, personaPrompt],
  );

  const [personaForm, setPersonaForm] = useState<PersonaFormValues>(defaultFormValues);
  const [originalPersonaForm, setOriginalPersonaForm] = useState<PersonaFormValues>(defaultFormValues);
  const [isGeneratingPersona, setIsGeneratingPersona] = useState(false);

  const applyPresetToSession = useCallback((preset: CustomPersonaPreset) => {
    wsService.sendMessage({
      type: "update-persona",
      character_name: preset.characterName,
      human_name: preset.humanName,
      persona_prompt: preset.personaPrompt,
    });
    setCharacterName(preset.characterName);
    setHumanName(preset.humanName);
    setPersonaPrompt(preset.personaPrompt);
  }, [setCharacterName, setHumanName, setPersonaPrompt]);

  const persistLastSelectedPresetValue = useCallback((value: string | null) => {
    setLastSelectedPresetValue(value);
    if (!value) {
      localStorage.removeItem(LAST_SELECTED_PRESET_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LAST_SELECTED_PRESET_STORAGE_KEY, value);
  }, []);

  const visibleBuiltinPresets = useMemo(
    () =>
      configFiles.filter(
        (config) => !hiddenBuiltinPresetFiles.includes(config.filename),
      ),
    [configFiles, hiddenBuiltinPresetFiles],
  );

  const runtimeCustomPreset = useMemo(() => {
    const normalizedPrompt = normalizePresetText(personaPrompt);
    const normalizedCharacterName = normalizePresetText(characterName || confName);

    if (activeCustomPresetId) {
      const activePreset = customPresets.find((preset) => preset.id === activeCustomPresetId);
      if (activePreset) {
        return activePreset;
      }
    }

    if (!normalizedPrompt) {
      return null;
    }

    return customPresets.find((preset) => {
      const presetPrompt = normalizePresetText(preset.personaPrompt);
      const presetName = normalizePresetText(preset.characterName || preset.label);
      return (
        presetPrompt === normalizedPrompt
        && (!normalizedCharacterName || presetName === normalizedCharacterName)
      );
    }) || null;
  }, [activeCustomPresetId, characterName, confName, customPresets, personaPrompt]);

  const runtimeBuiltinPreset = useMemo(() => {
    const uidTokens = getConfUidSearchTokens(confUid);
    const normalizedPrompt = normalizePresetText(personaPrompt);

    const uidMatchedPreset = uidTokens.length
      ? visibleBuiltinPresets.find((config) =>
        uidTokens.some((token) => config.filename.includes(token)))
      : null;
    if (uidMatchedPreset) {
      return uidMatchedPreset;
    }

    if (normalizedPrompt) {
      const promptMatchedPreset = visibleBuiltinPresets.find(
        (config) => normalizePresetText(config.persona_prompt) === normalizedPrompt,
      );
      if (promptMatchedPreset) {
        return promptMatchedPreset;
      }
    }

    const filename = confName ? getFilenameByName(confName) : undefined;
    return visibleBuiltinPresets.find((config) => config.filename === filename) || null;
  }, [confName, confUid, getFilenameByName, personaPrompt, visibleBuiltinPresets]);

  const resolvedCurrentPresetValue = useMemo(() => {
    if (runtimeCustomPreset) {
      return toCustomPresetValue(runtimeCustomPreset.id);
    }
    if (runtimeBuiltinPreset) {
      return runtimeBuiltinPreset.filename;
    }
    if (characterName || confName || personaPrompt) {
      return CURRENT_SESSION_PRESET_VALUE;
    }
    return selectedCharacterPreset[0] || "";
  }, [
    characterName,
    confName,
    personaPrompt,
    runtimeBuiltinPreset,
    runtimeCustomPreset,
    selectedCharacterPreset,
  ]);

  const currentSessionPreset = useMemo((): PresetOption | null => {
    if (runtimeCustomPreset || runtimeBuiltinPreset) {
      return null;
    }
    if (!characterName && !confName && !personaPrompt) {
      return null;
    }

    return {
      label: characterName || confName || t("settings.character.currentPreset"),
      value: CURRENT_SESSION_PRESET_VALUE,
      deletable: false,
      kind: "current",
      description: getPromptExcerpt(
        personaPrompt || "",
        t("settings.character.builtinPresetDescription"),
      ),
      meta: t("settings.character.currentPreset"),
    };
  }, [characterName, confName, personaPrompt, runtimeBuiltinPreset, runtimeCustomPreset, t]);

  const presetCollection = useMemo(
    (): PresetOption[] => [
      ...(currentSessionPreset ? [currentSessionPreset] : []),
      ...visibleBuiltinPresets.map((config) => {
        const isCurrentBuiltin = resolvedCurrentPresetValue === config.filename;
        return {
          label: config.character_name || config.name,
          value: config.filename,
          deletable: true,
          kind: "builtin" as const,
          description: getPromptExcerpt(
            config.persona_prompt || (isCurrentBuiltin ? personaPrompt : ""),
            t("settings.character.builtinPresetDescription"),
          ),
          meta: t("settings.character.builtinPresetTag"),
        };
      }),
      ...customPresets.map((preset) => ({
        label: preset.label,
        value: toCustomPresetValue(preset.id),
        deletable: true,
        kind: "custom" as const,
        description:
          (preset.form?.description || "").trim()
          || getPromptExcerpt(preset.personaPrompt || "", t("settings.character.customPresetDescription")),
        meta: t("settings.character.customPresetTag"),
      })),
    ],
    [
      currentSessionPreset,
      visibleBuiltinPresets,
      customPresets,
      resolvedCurrentPresetValue,
      personaPrompt,
      t,
    ],
  );

  const hasDuplicatePersonaPresetName = useCallback((
    candidateName: string,
    excludedCustomPresetId: string | null,
  ): boolean => {
    const normalizedName = normalizeUniqueName(candidateName);
    if (!normalizedName) {
      return false;
    }

    const customPresetExists = customPresets.some((preset) => {
      if (preset.id === excludedCustomPresetId) {
        return false;
      }
      return [preset.label, preset.characterName].some(
        (name) => normalizeUniqueName(name) === normalizedName,
      );
    });
    if (customPresetExists) {
      return true;
    }

    return configFiles.some((config) => {
      const presetName = config.character_name || config.name;
      return normalizeUniqueName(presetName) === normalizedName;
    });
  }, [configFiles, customPresets]);

  useEffect(() => {
    if (activeCustomPresetId) {
      const currentCustomPreset = customPresets.find(
        (preset) => preset.id === activeCustomPresetId,
      );
      if (currentCustomPreset) {
        const normalizedForm = normalizePersonaForm(
          currentCustomPreset.form,
          currentCustomPreset.characterName || characterName || confName || "",
          currentCustomPreset.personaPrompt || "",
        );
        setSelectedCharacterPreset([toCustomPresetValue(currentCustomPreset.id)]);
        setPersonaForm(normalizedForm);
        setOriginalPersonaForm(normalizedForm);
        latestPersonaInputKeyRef.current = toPersonaInputKey(
          normalizedForm.characterName,
          normalizedForm.description,
        );
        return;
      }

      setActiveCustomPresetId(null);
      localStorage.removeItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY);
    }

    const nextPresetValue = runtimeBuiltinPreset
      ? runtimeBuiltinPreset.filename
      : resolvedCurrentPresetValue;
    setSelectedCharacterPreset(nextPresetValue ? [nextPresetValue] : []);
    setPersonaForm(defaultFormValues);
    setOriginalPersonaForm(defaultFormValues);
    latestPersonaInputKeyRef.current = toPersonaInputKey(
      defaultFormValues.characterName,
      defaultFormValues.description,
    );
  }, [
    activeCustomPresetId,
    customPresets,
    characterName,
    confName,
    getFilenameByName,
    defaultFormValues,
    runtimeBuiltinPreset,
    resolvedCurrentPresetValue,
  ]);

  useEffect(() => {
    if (localStorage.getItem(PRESET_PRUNE_ONCE_STORAGE_KEY) === "true") {
      return;
    }
    if (customPresets.length === 0 || configFiles.length === 0) {
      return;
    }

    const currentCharacterName = (characterName || "").trim();
    const currentPersonaPrompt = (personaPrompt || "").trim();

    const activePreset =
      (activeCustomPresetId
        ? customPresets.find((preset) => preset.id === activeCustomPresetId)
        : null) || null;

    const matchedPreset =
      customPresets.find(
        (preset) =>
          (preset.characterName || "").trim() === currentCharacterName
          && (preset.personaPrompt || "").trim() === currentPersonaPrompt,
      ) || null;

    const presetToKeep = activePreset || matchedPreset || customPresets[0];
    if (!presetToKeep) {
      return;
    }

    const normalizedForm = normalizePersonaForm(
      presetToKeep.form,
      presetToKeep.characterName || characterName || confName || "",
      presetToKeep.personaPrompt || personaPrompt || "",
    );
    const normalizedPreset: CustomPersonaPreset = {
      ...presetToKeep,
      form: normalizedForm,
      characterName:
        (presetToKeep.characterName || characterName || confName || "").trim() || "AI",
      humanName: (presetToKeep.humanName || humanName || "Human").trim() || "Human",
      personaPrompt: (presetToKeep.personaPrompt || personaPrompt || "").trim(),
    };

    const selectedValue = toCustomPresetValue(normalizedPreset.id);
    const allBuiltinPresetFiles = configFiles.map((config) => config.filename);

    setCustomPresets([normalizedPreset]);
    saveCustomPresets([normalizedPreset]);

    setHiddenBuiltinPresetFiles(allBuiltinPresetFiles);
    saveHiddenBuiltinPresets(allBuiltinPresetFiles);

    setActiveCustomPresetId(normalizedPreset.id);
    localStorage.setItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY, normalizedPreset.id);
    setSelectedCharacterPreset([selectedValue]);
    persistLastSelectedPresetValue(selectedValue);

    setPersonaForm(normalizedForm);
    setOriginalPersonaForm(normalizedForm);
    latestPersonaInputKeyRef.current = toPersonaInputKey(
      normalizedForm.characterName,
      normalizedForm.description,
    );

    localStorage.setItem(PRESET_PRUNE_ONCE_STORAGE_KEY, "true");
  }, [
    customPresets,
    configFiles,
    activeCustomPresetId,
    characterName,
    humanName,
    personaPrompt,
    confName,
    persistLastSelectedPresetValue,
  ]);

  const persistCustomPreset = (
    id: string | null,
    form: PersonaFormValues,
    resolvedCharacterName: string,
    resolvedHumanName: string,
    finalPrompt: string,
  ): string => {
    const presetId = id || `persona_${Date.now()}`;
    const presetLabel = (resolvedCharacterName || t("settings.character.defaultCustomPresetName")).trim();
    const nextPreset: CustomPersonaPreset = {
      id: presetId,
      label: presetLabel,
      characterName: resolvedCharacterName,
      humanName: resolvedHumanName,
      personaPrompt: finalPrompt,
      form,
      createdAt: new Date().toISOString(),
    };

    const withoutCurrent = customPresets.filter((item) => item.id !== presetId);
    const updated = [nextPreset, ...withoutCurrent].slice(0, 50);
    setCustomPresets(updated);
    saveCustomPresets(updated);

    return presetId;
  };

  const applyPersona = (persistToPresetList: boolean) => {
    const finalPrompt = (personaForm.generatedPrompt || "").trim();
    if (!finalPrompt) {
      toaster.create({
        title: t("error.personaPromptRequired"),
        type: "error",
        duration: 2000,
      });
      return;
    }

    const resolvedCharacterName = (personaForm.characterName || confName || "").trim() || "AI";
    const resolvedHumanName = (humanName || "Human").trim() || "Human";

    if (
      persistToPresetList
      && hasDuplicatePersonaPresetName(
        resolvedCharacterName,
        activeCustomPresetId || runtimeCustomPreset?.id || null,
      )
    ) {
      toaster.create({
        title: t("error.personaNameDuplicate", { name: resolvedCharacterName }),
        type: "error",
        duration: 2600,
      });
      return;
    }

    const normalizedForm: PersonaFormValues = {
      ...personaForm,
      characterName: resolvedCharacterName,
      generatedPrompt: finalPrompt,
    };

    setIsApplyingPersona(true);

    wsService.sendMessage({
      type: "update-persona",
      character_name: resolvedCharacterName,
      human_name: resolvedHumanName,
      persona_prompt: finalPrompt,
    });

    setCharacterName(resolvedCharacterName);
    setHumanName(resolvedHumanName);
    setPersonaPrompt(finalPrompt);

    if (persistToPresetList) {
      const currentEditingPreset = activeCustomPresetId
        ? customPresets.find((preset) => preset.id === activeCustomPresetId) || null
        : null;
      const shouldCreateNewPreset = Boolean(
        currentEditingPreset
        && currentEditingPreset.characterName.trim() !== resolvedCharacterName,
      );

      const nextPresetId = persistCustomPreset(
        shouldCreateNewPreset ? null : activeCustomPresetId,
        normalizedForm,
        resolvedCharacterName,
        resolvedHumanName,
        finalPrompt,
      );
      const nextPresetValue = toCustomPresetValue(nextPresetId);
      setActiveCustomPresetId(nextPresetId);
      localStorage.setItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY, nextPresetId);
      setSelectedCharacterPreset([nextPresetValue]);
      persistLastSelectedPresetValue(nextPresetValue);
    }

    setPersonaForm(normalizedForm);
    setOriginalPersonaForm(normalizedForm);
    latestPersonaInputKeyRef.current = toPersonaInputKey(
      normalizedForm.characterName,
      normalizedForm.description,
    );
    markDirty();
    setIsApplyingPersona(false);
  };

  const handleCharacterPresetChange = (value: string[]) => {
    const selectedValue = value[0];
    if (!selectedValue) {
      return;
    }

    setSelectedCharacterPreset(value);
    persistLastSelectedPresetValue(selectedValue);

    if (selectedValue === CURRENT_SESSION_PRESET_VALUE) {
      setPersonaForm(defaultFormValues);
      setOriginalPersonaForm(defaultFormValues);
      latestPersonaInputKeyRef.current = toPersonaInputKey(
        defaultFormValues.characterName,
        defaultFormValues.description,
      );
      return;
    }

    const selectedCustomPresetId = parseCustomPresetId(selectedValue);
    if (selectedCustomPresetId) {
      const preset = customPresets.find((item) => item.id === selectedCustomPresetId);
      if (!preset) {
        return;
      }

      setActiveCustomPresetId(selectedCustomPresetId);
      localStorage.setItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY, selectedCustomPresetId);
      const normalizedForm = normalizePersonaForm(
        preset.form,
        preset.characterName || characterName || confName || "",
        preset.personaPrompt || "",
      );
      setPersonaForm(normalizedForm);
      setOriginalPersonaForm(normalizedForm);
      latestPersonaInputKeyRef.current = toPersonaInputKey(
        normalizedForm.characterName,
        normalizedForm.description,
      );
      applyPresetToSession(preset);
      markDirty();
      return;
    }

    const hadActiveCustomPreset = Boolean(activeCustomPresetId);
    setActiveCustomPresetId(null);
    localStorage.removeItem(ACTIVE_CUSTOM_PRESET_STORAGE_KEY);
    const currentFilename = confName ? getFilenameByName(confName) : "";
    if (selectedValue !== currentFilename || hadActiveCustomPreset) {
      switchCharacter(selectedValue, { force: hadActiveCustomPreset });
      markDirty();
    }
  };

  const handleDeletePreset = (presetValue: string) => {
    if (
      presetValue === selectedCharacterPreset[0]
      || presetValue === resolvedCurrentPresetValue
      || presetValue === CURRENT_SESSION_PRESET_VALUE
    ) {
      return;
    }

    const customPresetId = parseCustomPresetId(presetValue);
    if (customPresetId) {
      setCustomPresets((previous) => {
        const updated = previous.filter((item) => item.id !== customPresetId);
        saveCustomPresets(updated);
        return updated;
      });

      if (selectedCharacterPreset[0] === toCustomPresetValue(customPresetId)) {
        const filename = confName ? getFilenameByName(confName) : undefined;
        setSelectedCharacterPreset(filename ? [filename] : []);
      }

      toaster.create({
        title: t("notification.personaPresetDeleted"),
        type: "success",
        duration: 1600,
      });
      return;
    }

    const builtinFile = presetValue;
    setHiddenBuiltinPresetFiles((previous) => {
      if (previous.includes(builtinFile)) {
        return previous;
      }
      const updated = [...previous, builtinFile];
      saveHiddenBuiltinPresets(updated);
      return updated;
    });

    toaster.create({
      title: t("notification.personaPresetDeleted"),
      type: "success",
      duration: 1600,
    });
  };

  const handlePersonaFieldChange = (
    key: keyof PersonaFormValues,
    value: string,
  ) => {
    setPersonaForm((prev) => ({ ...prev, [key]: value }));
  };

  const requestPersonaGeneration = useCallback(
    ({
      force = false,
      silentIfUnavailable = false,
    }: {
      force?: boolean;
      silentIfUnavailable?: boolean;
    } = {}) => {
      const resolvedCharacterName = (personaForm.characterName || confName || "").trim() || "AI";
      const description = (personaForm.description || "").trim();
      if (!description) {
        if (!silentIfUnavailable) {
          toaster.create({
            title: t("error.personaDescriptionRequired"),
            type: "error",
            duration: 2000,
          });
        }
        return;
      }

      if (wsState !== "OPEN") {
        if (!silentIfUnavailable) {
          toaster.create({
            title: t("error.websocketNotOpen"),
            type: "error",
            duration: 2000,
          });
        }
        return;
      }

      const inputKey = toPersonaInputKey(resolvedCharacterName, description);
      if (!force && inputKey === latestPersonaInputKeyRef.current) {
        return;
      }

      const requestId = `persona_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      latestPersonaRequestIdRef.current = requestId;
      pendingPersonaInputKeyRef.current = inputKey;
      setIsGeneratingPersona(true);

      wsService.sendMessage({
        type: "generate-persona-prompt",
        request_id: requestId,
        character_name: resolvedCharacterName,
        persona_description: description,
      });
    },
    [confName, personaForm.characterName, personaForm.description, wsState, t],
  );

  useEffect(() => {
    const subscription = wsService.onMessage((message) => {
      if (message.type !== "persona-generated") {
        return;
      }

      if (
        message.request_id
        && message.request_id !== latestPersonaRequestIdRef.current
      ) {
        return;
      }

      setIsGeneratingPersona(false);

      if (message.error) {
        toaster.create({
          title: `${t("error.personaGenerateFailed")}: ${message.error}`,
          type: "error",
          duration: 2200,
        });
        return;
      }

      const generatedPrompt = (message.persona_prompt || "").trim();
      if (!generatedPrompt) {
        toaster.create({
          title: t("error.personaGenerateFailed"),
          type: "error",
          duration: 2200,
        });
        return;
      }

      latestPersonaInputKeyRef.current = pendingPersonaInputKeyRef.current;
      setPersonaForm((prev) => ({
        ...prev,
        generatedPrompt,
      }));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [t]);

  const handleApplyPersona = () => {
    applyPersona(true);
  };

  useEffect(() => {
    if (!onSave || !onCancel) {
      return;
    }

    const cleanupSave = onSave(() => {
      if (JSON.stringify(personaForm) !== JSON.stringify(originalPersonaForm)) {
        applyPersona(true);
      }
    });

    const cleanupCancel = onCancel(() => {
      setPersonaForm(originalPersonaForm);
      latestPersonaInputKeyRef.current = toPersonaInputKey(
        originalPersonaForm.characterName,
        originalPersonaForm.description,
      );
    });

    return () => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, personaForm, originalPersonaForm, confName, activeCustomPresetId]);

  return (
    <Stack {...settingStyles.common.container}>
      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.character.presetModule")}
          </Text>

          {presetCollection.length === 0 ? (
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
                {t("settings.character.noCustomPreset")}
              </Text>
            </Box>
          ) : (
            <Box
              display="grid"
              gridTemplateColumns="repeat(2, minmax(0, 1fr))"
              gap={3}
            >
              {presetCollection.map((presetItem) => {
                const isCurrent = presetItem.value === resolvedCurrentPresetValue;
                return (
                  <Box
                    key={presetItem.value}
                    role="button"
                    tabIndex={0}
                    minH="152px"
                    p={3}
                    borderRadius="lg"
                    borderWidth="2px"
                    borderColor={isCurrent ? "cyan.300" : "whiteAlpha.200"}
                    bg={isCurrent
                      ? "linear-gradient(155deg, rgba(34,211,238,0.22), rgba(15,23,42,0.94))"
                      : "whiteAlpha.50"}
                    boxShadow={isCurrent
                      ? "0 14px 30px rgba(34,211,238,0.18)"
                      : "0 8px 20px rgba(2,6,23,0.16)"}
                    cursor="pointer"
                    transition="all 0.18s ease"
                    onClick={() => handleCharacterPresetChange([presetItem.value])}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleCharacterPresetChange([presetItem.value]);
                      }
                    }}
                    _active={{ transform: "scale(0.985)" }}
                  >
                    <Stack gap={2} h="100%">
                      <HStack justify="space-between" align="flex-start" gap={2}>
                        <HStack gap={2} minW={0}>
                          <Box
                            flexShrink={0}
                            w="38px"
                            h="38px"
                            borderRadius="14px"
                            bg={isCurrent ? "cyan.500" : "whiteAlpha.120"}
                            color="white"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            fontSize="18px"
                            fontWeight="bold"
                          >
                            {getDisplayInitial(presetItem.label)}
                          </Box>
                          <Stack gap={0} minW={0}>
                            <Text
                              fontSize="17px"
                              fontWeight="bold"
                              color="whiteAlpha.950"
                              lineHeight={1.25}
                              lineClamp={2}
                            >
                              {presetItem.label}
                            </Text>
                            <Text fontSize="12px" color="whiteAlpha.650" lineClamp={1}>
                              {presetItem.meta}
                            </Text>
                          </Stack>
                        </HStack>
                        {isCurrent ? (
                          <Box
                            flexShrink={0}
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
                        ) : (
                          presetItem.deletable && (
                            <IconButton
                              aria-label={t("settings.character.deletePreset")}
                              size="sm"
                              minW="36px"
                              minH="36px"
                              variant="ghost"
                              colorPalette="red"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleDeletePreset(presetItem.value);
                              }}
                            >
                              <FiTrash2 />
                            </IconButton>
                          )
                        )}
                      </HStack>
                      <Text
                        mt="auto"
                        fontSize="13px"
                        color="whiteAlpha.760"
                        lineHeight={1.45}
                        lineClamp={3}
                      >
                        {presetItem.description}
                      </Text>
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          )}
        </Stack>
      </Box>

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.live2d.personaModule")}
          </Text>

          <Stack gap={2}>
            <Text {...settingStyles.common.fieldLabel}>{t("settings.character.personaName")}</Text>
            <Input
              {...settingStyles.general.input}
              value={personaForm.characterName}
              lang="zh-CN"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={t("settings.character.personaNamePlaceholder")}
              onChange={(event) => handlePersonaFieldChange("characterName", event.target.value)}
            />
          </Stack>

          <Stack gap={2}>
            <Text {...settingStyles.common.fieldLabel}>
              {t("settings.character.personaDescription")}
            </Text>

            <Textarea
              value={personaForm.description}
              lang="zh-CN"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => handlePersonaFieldChange("description", event.target.value)}
              placeholder={t("settings.character.personaDescriptionPlaceholder")}
              minH="120px"
              bg="whiteAlpha.100"
              borderColor="whiteAlpha.200"
              _hover={{ bg: "whiteAlpha.200" }}
            />
            <Text fontSize="xs" color="blue.100">
              {t("settings.character.personaDescriptionHelp")}
            </Text>

            <Button
              {...settingStyles.common.primaryActionButton}
              loading={isGeneratingPersona}
              disabled={isGeneratingPersona}
              onClick={() => requestPersonaGeneration({ force: true })}
            >
              <HStack gap={2}>
                <FiRefreshCw />
                <Text>
                  {isGeneratingPersona
                    ? t("settings.character.generatingPersonaPrompt")
                    : t("settings.character.generatePersonaPrompt")}
                </Text>
              </HStack>
            </Button>
          </Stack>

          <Stack gap={2}>
            <Text {...settingStyles.common.fieldLabel}>
              {t("settings.character.generatedPersonaPrompt")}
            </Text>
            <Textarea
              value={personaForm.generatedPrompt}
              lang="zh-CN"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => handlePersonaFieldChange("generatedPrompt", event.target.value)}
              placeholder={t("settings.character.generatedPersonaPromptPlaceholder")}
              minH="180px"
              bg="whiteAlpha.100"
              borderColor="whiteAlpha.200"
              _hover={{ bg: "whiteAlpha.200" }}
            />
          </Stack>

          <Button
            colorPalette="blue"
            onClick={handleApplyPersona}
            loading={isApplyingPersona}
          >
            {t("settings.live2d.applyPersona")}
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}

export default Character;
