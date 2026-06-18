/* eslint-disable import/no-extraneous-dependencies */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stack, createListCollection } from "@chakra-ui/react";
import { settingStyles } from "./setting-styles";
import { useSubtitle } from "@/context/subtitle-context";
import {
  DEFAULT_IMAGE_COMPRESSION_QUALITY,
  DEFAULT_IMAGE_MAX_WIDTH,
  IMAGE_COMPRESSION_QUALITY_KEY,
  IMAGE_MAX_WIDTH_KEY,
} from "@/hooks/sidebar/setting/use-general-settings";
import { SelectField, SwitchField, InputField } from "./common";

interface GeneralProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

interface GeneralPanelSettings {
  language: string[];
  showSubtitle: boolean;
  imageCompressionQuality: number;
  imageMaxWidth: number;
}

const languages = createListCollection({
  items: [
    { label: "English", value: "en" },
    { label: "中文", value: "zh" },
  ],
});

const loadInitialCompressionQuality = (): number => {
  const storedQuality = localStorage.getItem(IMAGE_COMPRESSION_QUALITY_KEY);
  if (!storedQuality) {
    return DEFAULT_IMAGE_COMPRESSION_QUALITY;
  }

  const quality = parseFloat(storedQuality);
  if (Number.isNaN(quality) || quality < 0.1 || quality > 1.0) {
    return DEFAULT_IMAGE_COMPRESSION_QUALITY;
  }

  return quality;
};

const loadInitialImageMaxWidth = (): number => {
  const storedMaxWidth = localStorage.getItem(IMAGE_MAX_WIDTH_KEY);
  if (!storedMaxWidth) {
    return DEFAULT_IMAGE_MAX_WIDTH;
  }

  const maxWidth = parseInt(storedMaxWidth, 10);
  if (Number.isNaN(maxWidth) || maxWidth < 0) {
    return DEFAULT_IMAGE_MAX_WIDTH;
  }

  return maxWidth;
};

function General({ onSave, onCancel }: GeneralProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const { showSubtitle, setShowSubtitle } = useSubtitle();

  const initialSettings: GeneralPanelSettings = {
    language: [i18n.language || "en"],
    showSubtitle,
    imageCompressionQuality: loadInitialCompressionQuality(),
    imageMaxWidth: loadInitialImageMaxWidth(),
  };

  const [settings, setSettings] = useState<GeneralPanelSettings>(initialSettings);
  const [originalSettings, setOriginalSettings] = useState<GeneralPanelSettings>(initialSettings);

  useEffect(() => {
    const currentLanguage = i18n.language || "en";
    if (settings.language[0] !== currentLanguage) {
      i18n.changeLanguage(settings.language[0]);
    }

    if (showSubtitle !== settings.showSubtitle) {
      setShowSubtitle(settings.showSubtitle);
    }
    localStorage.setItem(
      IMAGE_COMPRESSION_QUALITY_KEY,
      settings.imageCompressionQuality.toString(),
    );
    localStorage.setItem(IMAGE_MAX_WIDTH_KEY, settings.imageMaxWidth.toString());
  }, [
    settings,
    i18n,
    showSubtitle,
    setShowSubtitle,
  ]);

  useEffect(() => {
    const currentLanguage = i18n.language || "en";
    if (settings.language[0] === currentLanguage) {
      return;
    }
    setSettings((prev) => ({ ...prev, language: [currentLanguage] }));
  }, [i18n.language]);

  const handleSettingChange = (
    key: keyof GeneralPanelSettings,
    value: GeneralPanelSettings[keyof GeneralPanelSettings],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = useCallback(() => {
    setOriginalSettings(settings);
  }, [settings]);

  const handleCancel = useCallback(() => {
    setSettings(originalSettings);

    const [language] = originalSettings.language;
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }

    setShowSubtitle(originalSettings.showSubtitle);
    localStorage.setItem(
      IMAGE_COMPRESSION_QUALITY_KEY,
      originalSettings.imageCompressionQuality.toString(),
    );
    localStorage.setItem(
      IMAGE_MAX_WIDTH_KEY,
      originalSettings.imageMaxWidth.toString(),
    );
  }, [
    originalSettings,
    i18n,
    setShowSubtitle,
  ]);

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

  return (
    <Stack {...settingStyles.common.container}>
      <SelectField
        label={t("settings.general.language")}
        value={settings.language}
        onChange={(value) => handleSettingChange("language", value)}
        collection={languages}
        placeholder={t("settings.general.language")}
      />

      <SwitchField
        label={t("settings.general.showSubtitle")}
        checked={settings.showSubtitle}
        onChange={(checked) => handleSettingChange("showSubtitle", checked)}
      />

      <InputField
        label={t("settings.general.imageCompressionQuality")}
        value={settings.imageCompressionQuality.toString()}
        onChange={(value) => {
          const quality = parseFloat(value as string);
          if (!Number.isNaN(quality) && quality >= 0.1 && quality <= 1.0) {
            handleSettingChange("imageCompressionQuality", quality);
          } else if (value === "") {
            handleSettingChange(
              "imageCompressionQuality",
              settings.imageCompressionQuality,
            );
          }
        }}
        help={t("settings.general.imageCompressionQualityHelp")}
      />

      <InputField
        label={t("settings.general.imageMaxWidth")}
        value={settings.imageMaxWidth.toString()}
        onChange={(value) => {
          const maxWidth = parseInt(value as string, 10);
          if (!Number.isNaN(maxWidth) && maxWidth >= 0) {
            handleSettingChange("imageMaxWidth", maxWidth);
          } else if (value === "") {
            handleSettingChange("imageMaxWidth", settings.imageMaxWidth);
          }
        }}
        help={t("settings.general.imageMaxWidthHelp")}
      />

    </Stack>
  );
}

export default General;
