import React, {
  useRef, useState, useEffect, useCallback,
} from 'react';
import { useVAD, VADSettings } from '@/context/vad-context';

export const useASRSettings = () => {
  const {
    settings,
    updateSettings,
    autoStopMic,
    setAutoStopMic,
    autoStartMicOn,
    setAutoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStartMicOnConvEnd,
  } = useVAD();

  const localSettingsRef = useRef<VADSettings>(settings);
  const currentSettingsRef = useRef<VADSettings>(settings);
  const originalSettingsRef = useRef(settings);
  const originalAutoStopMicRef = useRef(autoStopMic);
  const originalAutoStartMicOnRef = useRef(autoStartMicOn);
  const originalAutoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const localVoiceInterruptionRef = useRef(autoStopMic);
  const localAutoStartMicRef = useRef(autoStartMicOn);
  const localAutoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const [localVoiceInterruption, setLocalVoiceInterruption] = useState(autoStopMic);
  const [localAutoStartMic, setLocalAutoStartMic] = useState(autoStartMicOn);
  const [localAutoStartMicOnConvEnd, setLocalAutoStartMicOnConvEnd] = useState(autoStartMicOnConvEnd);
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  useEffect(() => {
    setLocalVoiceInterruption(autoStopMic);
    setLocalAutoStartMic(autoStartMicOn);
    setLocalAutoStartMicOnConvEnd(autoStartMicOnConvEnd);
    localVoiceInterruptionRef.current = autoStopMic;
    localAutoStartMicRef.current = autoStartMicOn;
    localAutoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStopMic, autoStartMicOn, autoStartMicOnConvEnd]);

  useEffect(() => {
    currentSettingsRef.current = settings;
    localSettingsRef.current = settings;
    originalSettingsRef.current = settings;
    forceUpdate();
  }, [settings]);

  const handleVoiceInterruptionChange = (value: boolean) => {
    localVoiceInterruptionRef.current = value;
    setLocalVoiceInterruption(value);
    setAutoStopMic(value);
    originalAutoStopMicRef.current = value;
  };

  const handleAutoStartMicChange = (value: boolean) => {
    localAutoStartMicRef.current = value;
    setLocalAutoStartMic(value);
    setAutoStartMicOn(value);
    originalAutoStartMicOnRef.current = value;
  };

  const handleAutoStartMicOnConvEndChange = (value: boolean) => {
    localAutoStartMicOnConvEndRef.current = value;
    setLocalAutoStartMicOnConvEnd(value);
    setAutoStartMicOnConvEnd(value);
    originalAutoStartMicOnConvEndRef.current = value;
  };

  const sanitizeSettings = useCallback((value: VADSettings): VADSettings => {
    const safeNumber = (input: number, fallback: number) => {
      if (Number.isNaN(input)) {
        return fallback;
      }
      return input;
    };

    return {
      positiveSpeechThreshold: safeNumber(
        Number(value.positiveSpeechThreshold),
        currentSettingsRef.current.positiveSpeechThreshold,
      ),
      negativeSpeechThreshold: safeNumber(
        Number(value.negativeSpeechThreshold),
        currentSettingsRef.current.negativeSpeechThreshold,
      ),
      redemptionFrames: safeNumber(
        Number(value.redemptionFrames),
        currentSettingsRef.current.redemptionFrames,
      ),
    };
  }, []);

  const handleSave = useCallback((): void => {
    const sanitized = sanitizeSettings(localSettingsRef.current);
    localSettingsRef.current = sanitized;
    updateSettings(sanitized);
    originalSettingsRef.current = localSettingsRef.current;
    originalAutoStopMicRef.current = localVoiceInterruptionRef.current;
    originalAutoStartMicOnRef.current = localAutoStartMicRef.current;
    originalAutoStartMicOnConvEndRef.current = localAutoStartMicOnConvEndRef.current;
    forceUpdate();
  }, [sanitizeSettings, updateSettings]);

  const handleCancel = useCallback((): void => {
    localSettingsRef.current = originalSettingsRef.current;
    localVoiceInterruptionRef.current = originalAutoStopMicRef.current;
    localAutoStartMicRef.current = originalAutoStartMicOnRef.current;
    localAutoStartMicOnConvEndRef.current = originalAutoStartMicOnConvEndRef.current;
    setLocalVoiceInterruption(originalAutoStopMicRef.current);
    setLocalAutoStartMic(originalAutoStartMicOnRef.current);
    setAutoStopMic(originalAutoStopMicRef.current);
    setAutoStartMicOn(originalAutoStartMicOnRef.current);
    setLocalAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    setAutoStartMicOnConvEnd(originalAutoStartMicOnConvEndRef.current);
    forceUpdate();
  }, [setAutoStartMicOn, setAutoStartMicOnConvEnd, setAutoStopMic]);

  const persistSettingsImmediately = useCallback((nextSettings: VADSettings) => {
    const sanitized = sanitizeSettings(nextSettings);
    localSettingsRef.current = sanitized;
    updateSettings(sanitized);
    originalSettingsRef.current = sanitized;
    forceUpdate();
  }, [sanitizeSettings, updateSettings]);

  const handleInputChange = (key: keyof VADSettings, value: number | string): void => {
    if (value === '' || value === '-') {
      forceUpdate();
      return;
    }

    const parsed = Number(value);
    // eslint-disable-next-line no-restricted-globals
    if (!isNaN(parsed)) {
      persistSettingsImmediately({ ...localSettingsRef.current, [key]: parsed });
      return;
    }

    forceUpdate();
  };

  return {
    localSettings: localSettingsRef.current,
    autoStopMic: localVoiceInterruption,
    autoStartMicOn: localAutoStartMic,
    autoStartMicOnConvEnd: localAutoStartMicOnConvEnd,
    setAutoStopMic: handleVoiceInterruptionChange,
    setAutoStartMicOn: handleAutoStartMicChange,
    setAutoStartMicOnConvEnd: handleAutoStartMicOnConvEndChange,
    handleInputChange,
    handleSave,
    handleCancel,
  };
};
