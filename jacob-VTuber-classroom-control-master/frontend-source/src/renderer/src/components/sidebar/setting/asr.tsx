/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import { Box, Stack, Text } from "@chakra-ui/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { settingStyles } from "./setting-styles";
import { useASRSettings } from "@/hooks/sidebar/setting/use-asr-settings";
import { useLive2dSettings } from "@/hooks/sidebar/setting/use-live2d-settings";
import { useAgentSettings } from "@/hooks/sidebar/setting/use-agent-settings";
import { SwitchField, NumberField } from "./common";

interface ASRProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function ASR({ onSave, onCancel }: ASRProps): JSX.Element {
  const { t } = useTranslation();
  const {
    localSettings,
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStopMic,
    setAutoStartMicOn,
    setAutoStartMicOnConvEnd,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useASRSettings();
  const {
    modelInfo,
    handleInputChange: handleLive2dInputChange,
    handleSave: handleLive2dSave,
    handleCancel: handleLive2dCancel,
  } = useLive2dSettings();
  const {
    settings: agentSettings,
    handleAllowProactiveSpeakChange,
    handleIdleSecondsChange,
    handleAllowButtonTriggerChange,
  } = useAgentSettings({ onSave, onCancel });

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);
    const cleanupLive2dSave = onSave(handleLive2dSave);
    const cleanupLive2dCancel = onCancel(handleLive2dCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
      cleanupLive2dSave?.();
      cleanupLive2dCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel, handleLive2dSave, handleLive2dCancel]);

  return (
    <Stack {...settingStyles.common.container}>
      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.asr.voiceInteractionModule")}
          </Text>

          <SwitchField
            label={t("settings.asr.autoStopMic")}
            checked={autoStopMic}
            onChange={setAutoStopMic}
          />

          <SwitchField
            label={t("settings.asr.autoStartMicOnConvEnd")}
            checked={autoStartMicOnConvEnd}
            onChange={setAutoStartMicOnConvEnd}
          />

          <SwitchField
            label={t("settings.asr.autoStartMicOn")}
            checked={autoStartMicOn}
            onChange={setAutoStartMicOn}
          />

          <NumberField
            label={t("settings.asr.positiveSpeechThreshold")}
            help={t("settings.asr.positiveSpeechThresholdDesc")}
            value={localSettings.positiveSpeechThreshold}
            onChange={(value) => handleInputChange("positiveSpeechThreshold", value)}
            min={1}
            max={100}
          />

          <NumberField
            label={t("settings.asr.negativeSpeechThreshold")}
            help={t("settings.asr.negativeSpeechThresholdDesc")}
            value={localSettings.negativeSpeechThreshold}
            onChange={(value) => handleInputChange("negativeSpeechThreshold", value)}
            min={0}
            max={100}
          />

          <NumberField
            label={t("settings.asr.redemptionFrames")}
            help={t("settings.asr.redemptionFramesDesc")}
            value={localSettings.redemptionFrames}
            onChange={(value) => handleInputChange("redemptionFrames", value)}
            min={1}
            max={100}
          />
        </Stack>
      </Box>

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t("settings.asr.controlInteractionModule")}
          </Text>

          <SwitchField
            label={t("settings.agent.allowProactiveSpeak")}
            checked={agentSettings.allowProactiveSpeak}
            onChange={handleAllowProactiveSpeakChange}
          />

          {agentSettings.allowProactiveSpeak && (
            <NumberField
              label={t("settings.agent.idleSecondsToSpeak")}
              value={agentSettings.idleSecondsToSpeak}
              onChange={(value) => handleIdleSecondsChange(Number(value))}
              min={0}
              step={0.1}
              allowMouseWheel
            />
          )}

          <SwitchField
            label={t("settings.agent.allowButtonTrigger")}
            checked={agentSettings.allowButtonTrigger}
            onChange={handleAllowButtonTriggerChange}
          />

          <SwitchField
            label={t("settings.live2d.pointerInteractive")}
            checked={modelInfo.pointerInteractive ?? false}
            onChange={(checked) => handleLive2dInputChange("pointerInteractive", checked)}
          />

          <SwitchField
            label={t("settings.live2d.scrollToResize")}
            checked={modelInfo.scrollToResize ?? true}
            onChange={(checked) => handleLive2dInputChange("scrollToResize", checked)}
          />
        </Stack>
      </Box>
    </Stack>
  );
}

export default ASR;
