/* eslint-disable import/no-extraneous-dependencies */
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  HStack,
  IconButton,
  Input,
  Stack,
  Text,
  Textarea,
  createListCollection,
} from "@chakra-ui/react";
import { FiPlus } from "react-icons/fi";
import { settingStyles } from "./setting-styles";
import { useLive2dSettings } from "@/hooks/sidebar/setting/use-live2d-settings";
import { useGeneralSettings } from "@/hooks/sidebar/setting/use-general-settings";
import { useBgUrl } from "@/context/bgurl-context";
import { useConfig } from "@/context/character-config-context";
import { useWebSocket } from "@/context/websocket-context";
import { SwitchField, SelectField, InputField } from "./common";
import { wsService } from "@/services/websocket-service";
import { toaster } from "@/components/ui/toaster";

interface Live2DProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

interface PersonaFormValues {
  characterName: string;
  humanName: string;
  gender: string;
  personality: string;
  tone: string;
  teachingStyle: string;
  interactionRule: string;
  extra: string;
}

const buildPersonaPrompt = (form: PersonaFormValues): string => {
  const lines = [
    `你是${form.characterName || "AI助教"}，正在与学生进行教学对话。`,
    form.gender ? `性别设定：${form.gender}` : "",
    form.personality ? `性格设定：${form.personality}` : "",
    form.tone ? `说话风格：${form.tone}` : "",
    form.teachingStyle ? `教学风格：${form.teachingStyle}` : "",
    form.interactionRule ? `互动规则：${form.interactionRule}` : "",
    form.extra ? `补充设定：${form.extra}` : "",
    "请保持表达清晰、鼓励式反馈，并优先帮助学生理解知识点。",
  ].filter(Boolean);

  return lines.join("\n");
};

const useCollections = () => {
  const { backgroundFiles } = useBgUrl() || {};
  const { configFiles } = useConfig();

  const backgrounds = createListCollection({
    items:
      backgroundFiles?.map((filename) => ({
        label: String(filename),
        value: `/bg/${filename}`,
      })) || [],
  });

  const characterPresets = createListCollection({
    items: configFiles.map((config) => ({
      label: config.name,
      value: config.filename,
    })),
  });

  return {
    backgrounds,
    characterPresets,
  };
};

function Live2D({ onSave, onCancel }: Live2DProps): JSX.Element {
  const { t } = useTranslation();
  const bgUrlContext = useBgUrl();
  const {
    confName,
    confUid,
    characterName,
    humanName,
    personaPrompt,
    setConfName,
    setCharacterName,
    setHumanName,
    setPersonaPrompt,
  } = useConfig();
  const { wsUrl, setWsUrl, baseUrl, setBaseUrl } = useWebSocket();
  const collections = useCollections();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isApplyingPersona, setIsApplyingPersona] = useState(false);

  const {
    modelInfo,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useLive2dSettings();

  const {
    settings,
    handleSettingChange,
    handleCameraToggle,
    handleCharacterPresetChange,
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

  const initialPersonaForm = (): PersonaFormValues => ({
    characterName: characterName || confName || "",
    humanName: humanName || "Human",
    gender: "",
    personality: "",
    tone: "",
    teachingStyle: "",
    interactionRule: "",
    extra: personaPrompt || "",
  });

  const [personaForm, setPersonaForm] = useState<PersonaFormValues>(initialPersonaForm);
  const [originalPersonaForm, setOriginalPersonaForm] = useState<PersonaFormValues>(initialPersonaForm);
  const personaPromptPreview = buildPersonaPrompt(personaForm);

  useEffect(() => {
    const resetForm = initialPersonaForm();
    setPersonaForm(resetForm);
    setOriginalPersonaForm(resetForm);
  }, [confUid, characterName, humanName, personaPrompt, confName]);

  useEffect(() => {
    if (!onSave || !onCancel) {
      return;
    }

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return () => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel]);

  const handlePersonaFieldChange = (
    key: keyof PersonaFormValues,
    value: string,
  ) => {
    setPersonaForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyPersona = () => {
    const finalPrompt = personaPromptPreview.trim();
    if (!finalPrompt) {
      toaster.create({
        title: t("error.personaPromptRequired"),
        type: "error",
        duration: 2000,
      });
      return;
    }

    const resolvedCharacterName = (personaForm.characterName || confName || "").trim() || "AI";
    const resolvedHumanName = (personaForm.humanName || "Human").trim() || "Human";

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
    setOriginalPersonaForm(personaForm);
    setIsApplyingPersona(false);
  };

  useEffect(() => {
    if (!onSave || !onCancel) {
      return;
    }

    const cleanupSave = onSave(() => {
      if (JSON.stringify(personaForm) !== JSON.stringify(originalPersonaForm)) {
        handleApplyPersona();
      }
    });
    const cleanupCancel = onCancel(() => {
      setPersonaForm(originalPersonaForm);
    });

    return () => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, personaForm, originalPersonaForm, confName]);

  const handleSelectBackgroundFile = () => {
    fileInputRef.current?.click();
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
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
        bgUrlContext?.setUseCameraBackground(false);
        bgUrlContext?.setBackgroundUrl(fullUrl);
        handleSettingChange("useCameraBackground", false);
        handleSettingChange("selectedBgUrl", [payload.url]);
        handleSettingChange("customBgUrl", "");
      }

      wsService.sendMessage({ type: "fetch-backgrounds" });
      toaster.create({
        title: t("notification.backgroundUploadSuccess"),
        type: "success",
        duration: 2000,
      });
    } catch (error) {
      toaster.create({
        title: `${t("error.backgroundUploadFailed")}: ${(error as Error).message}`,
        type: "error",
        duration: 2500,
      });
    } finally {
      setIsUploadingBackground(false);
      event.target.value = "";
    }
  };

  return (
    <Stack {...settingStyles.common.container}>
      <Text fontSize="sm" color="whiteAlpha.900" fontWeight="semibold">
        {t("settings.live2d.stageModule")}
      </Text>

      <SwitchField
        label={t("settings.general.useCameraBackground")}
        checked={settings.useCameraBackground}
        onChange={handleCameraToggle}
      />

      {!settings.useCameraBackground && (
        <>
          <SelectField
            label={t("settings.general.backgroundImage")}
            value={settings.selectedBgUrl}
            onChange={(value) => handleSettingChange("selectedBgUrl", value)}
            collection={collections.backgrounds}
            placeholder={t("settings.general.backgroundImage")}
          />

          <InputField
            label={t("settings.general.customBgUrl")}
            value={settings.customBgUrl}
            onChange={(value) => handleSettingChange("customBgUrl", value)}
            placeholder={t("settings.general.customBgUrlPlaceholder")}
          />
        </>
      )}

      <HStack justify="flex-start" align="center" gap={3} mt={-2}>
        <Text fontSize="sm" color="whiteAlpha.800">
          {t("settings.general.uploadBackground")}
        </Text>
        <IconButton
          aria-label={t("settings.general.uploadBackground")}
          size="sm"
          colorPalette="blue"
          variant="solid"
          onClick={handleSelectBackgroundFile}
          disabled={isUploadingBackground}
        >
          <FiPlus />
        </IconButton>
        <Text fontSize="xs" color="whiteAlpha.700">
          {isUploadingBackground
            ? t("settings.general.uploadingBackground")
            : t("settings.general.uploadBackgroundHint")}
        </Text>
      </HStack>
      <Input
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp"
        ref={fileInputRef}
        onChange={handleBackgroundUpload}
        display="none"
      />

      <SelectField
        label={t("settings.general.characterPreset")}
        value={settings.selectedCharacterPreset}
        onChange={handleCharacterPresetChange}
        collection={collections.characterPresets}
        placeholder={confName || t("settings.general.characterPreset")}
      />

      <Text fontSize="sm" color="whiteAlpha.900" fontWeight="semibold" pt={2}>
        {t("settings.live2d.personaModule")}
      </Text>

      <InputField
        label={t("settings.live2d.personaCharacterName")}
        value={personaForm.characterName}
        onChange={(value) => handlePersonaFieldChange("characterName", value)}
      />

      <InputField
        label={t("settings.live2d.personaHumanName")}
        value={personaForm.humanName}
        onChange={(value) => handlePersonaFieldChange("humanName", value)}
      />

      <InputField
        label={t("settings.live2d.personaGender")}
        value={personaForm.gender}
        onChange={(value) => handlePersonaFieldChange("gender", value)}
      />

      <InputField
        label={t("settings.live2d.personaPersonality")}
        value={personaForm.personality}
        onChange={(value) => handlePersonaFieldChange("personality", value)}
      />

      <InputField
        label={t("settings.live2d.personaTone")}
        value={personaForm.tone}
        onChange={(value) => handlePersonaFieldChange("tone", value)}
      />

      <InputField
        label={t("settings.live2d.personaTeachingStyle")}
        value={personaForm.teachingStyle}
        onChange={(value) => handlePersonaFieldChange("teachingStyle", value)}
      />

      <InputField
        label={t("settings.live2d.personaRule")}
        value={personaForm.interactionRule}
        onChange={(value) => handlePersonaFieldChange("interactionRule", value)}
      />

      <Stack gap={2}>
        <Text {...settingStyles.common.fieldLabel}>{t("settings.live2d.personaExtra")}</Text>
        <Textarea
          value={personaForm.extra}
          onChange={(event) => handlePersonaFieldChange("extra", event.target.value)}
          minH="80px"
          bg="whiteAlpha.100"
          borderColor="whiteAlpha.200"
          _hover={{ bg: "whiteAlpha.200" }}
        />
      </Stack>

      <Stack gap={2}>
        <Text {...settingStyles.common.fieldLabel}>{t("settings.live2d.personaPromptPreview")}</Text>
        <Text fontSize="xs" color="whiteAlpha.700">
          {t("settings.live2d.personaPromptHelp")}
        </Text>
        <Textarea
          value={personaPromptPreview}
          readOnly
          minH="140px"
          bg="whiteAlpha.100"
          borderColor="whiteAlpha.200"
        />
      </Stack>

      <Button
        colorPalette="blue"
        onClick={handleApplyPersona}
        loading={isApplyingPersona}
      >
        {t("settings.live2d.applyPersona")}
      </Button>

      <Text fontSize="sm" color="whiteAlpha.900" fontWeight="semibold" pt={2}>
        {t("settings.live2d.interactionModule")}
      </Text>

      <SwitchField
        label={t("settings.live2d.pointerInteractive")}
        checked={modelInfo.pointerInteractive ?? false}
        onChange={(checked) => handleInputChange("pointerInteractive", checked)}
      />

      <SwitchField
        label={t("settings.live2d.scrollToResize")}
        checked={modelInfo.scrollToResize ?? true}
        onChange={(checked) => handleInputChange("scrollToResize", checked)}
      />
    </Stack>
  );
}

export default Live2D;
