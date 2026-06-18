/* eslint-disable import/no-extraneous-dependencies */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  HStack,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { FiCheck } from 'react-icons/fi';
import { settingStyles } from './setting-styles';
import { wsService, MessageEvent } from '@/services/websocket-service';
import { Slider } from '@/components/ui/slider';
import { useDragScroll } from '@/hooks/utils/use-drag-scroll';

interface TTSProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

type EngineConfig = Record<string, unknown>;
type EngineConfigMap = Record<string, EngineConfig>;
type VoiceMemory = Record<string, string>;

interface VoicePreset {
  label: string
  value: string
}

interface VoiceCardViewModel {
  category: string
  name: string
  note: string
  value: string
}

interface TTSPanelSettings {
  ttsModel: string[]
  voice: string
  speed: number
}

const DEFAULT_TTS_MODEL = 'edge_tts';
const VOICE_KEYS = ['voice', 'voice_id', 'default_voice', 'speaker', 'sft_dropdown'];
const SPEED_KEYS = ['speed', 'rate', 'speed_ratio'];
const DEFAULT_SPEED = 1;
const MIN_SPEED = 0.6;
const MAX_SPEED = 1.5;

const TTS_MODEL_OPTIONS = [
  'edge_tts',
  'volcengine_tts',
];

const TTS_MODEL_LABELS: Record<string, string> = {
  edge_tts: 'Edge TTS',
  volcengine_tts: '火山 TTS',
};

const TTS_MODEL_DESCRIPTIONS: Record<string, string> = {
  edge_tts: '系统默认在线音色，稳定轻量。',
  volcengine_tts: '火山普通语音合成音色，适合稳定播报。',
};

const VOICE_PRESETS: Record<string, VoicePreset[]> = {
  edge_tts: [
    { label: '晓晓（zh-CN-XiaoxiaoNeural）', value: 'zh-CN-XiaoxiaoNeural' },
    { label: '云希（zh-CN-YunxiNeural）', value: 'zh-CN-YunxiNeural' },
    { label: '晓伊（zh-CN-XiaoyiNeural）', value: 'zh-CN-XiaoyiNeural' },
    { label: '云健（zh-CN-YunjianNeural）', value: 'zh-CN-YunjianNeural' },
    { label: '云扬（zh-CN-YunyangNeural）', value: 'zh-CN-YunyangNeural' },
    { label: '晓辰（zh-CN-XiaochenNeural）', value: 'zh-CN-XiaochenNeural' },
    { label: '晓北（zh-CN-liaoning-XiaobeiNeural）', value: 'zh-CN-liaoning-XiaobeiNeural' },
    { label: '晓妮（zh-CN-shaanxi-XiaoniNeural）', value: 'zh-CN-shaanxi-XiaoniNeural' },
  ],
  volcengine_tts: [
    { label: '普通女声｜通用女声（推荐）', value: 'BV001_streaming' },
    { label: '普通女声｜活力女声', value: 'BV005_streaming' },
    { label: '普通女声｜亲和女声', value: 'BV007_streaming' },
    { label: '普通女声｜知性姐姐', value: 'BV034_streaming' },
    { label: '普通男声｜通用男声', value: 'BV002_streaming' },
    { label: '普通男声｜情感男声', value: 'BV004_streaming' },
    { label: '普通男声｜活力男声', value: 'BV006_streaming' },
    { label: '普通男声｜沉稳男声', value: 'BV700_V2_streaming' },
    { label: '普通男声｜温和讲解', value: 'BV033_streaming' },
    { label: '儿童音色｜奶气萌娃', value: 'BV051_streaming' },
    { label: '儿童音色｜小萝莉', value: 'BV064_streaming' },
    { label: '儿童音色｜少儿故事', value: 'BV061_streaming' },
    { label: '方言音色｜东北老铁', value: 'BV021_streaming' },
    { label: '方言音色｜东北丫头', value: 'BV020_streaming' },
    { label: '方言音色｜西安佟掌柜', value: 'BV210_streaming' },
    { label: '方言音色｜沪上阿姐', value: 'BV217_streaming' },
    { label: '方言音色｜广西表哥', value: 'BV213_streaming' },
    { label: '方言音色｜甜美台妹', value: 'BV025_streaming' },
    { label: '方言音色｜港剧男神', value: 'BV026_streaming' },
    { label: '方言音色｜广东女仔', value: 'BV424_streaming' },
    { label: '方言音色｜重庆小伙', value: 'BV019_streaming' },
    { label: '方言音色｜长沙靓女', value: 'BV216_streaming' },
  ],
};

const DEFAULT_ENGINE_CONFIGS: Record<string, EngineConfig> = {
  edge_tts: {
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
  },
  volcengine_tts: {
    appid: '',
    access_token: '',
    secret_key: '',
    api_url: 'https://openspeech.bytedance.com/api/v1/tts',
    cluster: 'volcano_tts',
    voice: 'BV001_streaming',
    encoding: 'mp3',
    sample_rate: 24000,
    speed_ratio: 1.0,
    volume_ratio: 1.0,
    pitch_ratio: 1.0,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const findPreferredKey = (config: EngineConfig, candidates: string[]): string =>
  candidates.find((key) => key in config) || candidates[0];

const pickStringValue = (config: EngineConfig, keys: string[]): string => {
  const targetKey = keys.find((key) => typeof config[key] !== 'undefined');
  if (!targetKey) {
    return '';
  }
  return String(config[targetKey] ?? '');
};

const clampSpeed = (value: number): number =>
  Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));

const parseRateSpeed = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.endsWith('%')) {
    const percent = Number(trimmed.replace('%', ''));
    return Number.isFinite(percent) ? 1 + percent / 100 : null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const pickSpeedValue = (config: EngineConfig): number => {
  const speedKey = SPEED_KEYS.find((key) => typeof config[key] !== 'undefined');
  if (!speedKey) {
    return DEFAULT_SPEED;
  }
  const parsedSpeed = parseRateSpeed(config[speedKey]);
  return parsedSpeed === null ? DEFAULT_SPEED : clampSpeed(parsedSpeed);
};

const formatSpeed = (speed: number): string => `${speed.toFixed(1)}x`;

const toEdgeRate = (speed: number): string => {
  const percent = Math.round((speed - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
};

const getVoiceCardViewModel = (preset: VoicePreset): VoiceCardViewModel => {
  const [rawCategory, rawName = rawCategory] = preset.label.split('｜');
  const hasCategory = preset.label.includes('｜');
  const category = hasCategory ? rawCategory : '';
  const nameWithNote = rawName.trim();
  const noteMatch = nameWithNote.match(/（(.+)）$/);
  const name = nameWithNote.replace(/（.+）$/, '').trim();
  const note = noteMatch?.[1] || '';

  return {
    category,
    name: name || preset.label,
    note: note === preset.value ? '' : note,
    value: preset.value,
  };
};

function TTS({ onSave, onCancel }: TTSProps): JSX.Element {
  const { t } = useTranslation();
  const voiceDragScroll = useDragScroll<HTMLDivElement>({
    axis: 'y',
    skipInteractiveTargets: false,
    stopPropagation: true,
    threshold: 16,
  });
  const [engineConfigs, setEngineConfigs] = useState<EngineConfigMap>({});
  const [voiceMemory, setVoiceMemory] = useState<VoiceMemory>({});
  const [settings, setSettings] = useState<TTSPanelSettings>({
    ttsModel: [DEFAULT_TTS_MODEL],
    voice: '',
    speed: DEFAULT_SPEED,
  });
  const [originalSettings, setOriginalSettings] = useState<TTSPanelSettings>({
    ttsModel: [DEFAULT_TTS_MODEL],
    voice: '',
    speed: DEFAULT_SPEED,
  });
  const skipAutoSaveRef = useRef(true);

  const voicePresets = useMemo(
    () => VOICE_PRESETS[settings.ttsModel[0] || DEFAULT_TTS_MODEL] || [],
    [settings.ttsModel],
  );

  const selectedTtsModel = settings.ttsModel[0] || DEFAULT_TTS_MODEL;
  const selectedTtsModelLabel = TTS_MODEL_LABELS[selectedTtsModel] || selectedTtsModel;

  const updateSelectedVoice = useCallback(
    (voice: string) => {
      const normalizedVoice = voice.trim();
      setSettings((prev) => ({ ...prev, voice }));
      setVoiceMemory((prev) => ({
        ...prev,
        [selectedTtsModel]: normalizedVoice,
      }));
    },
    [selectedTtsModel],
  );

  const applyRemoteTtsConfig = useCallback(
    (message: MessageEvent) => {
      const remoteTtsConfig = isRecord(message.tts_config) ? message.tts_config : {};
      const modelFromMessage = typeof message.tts_model === 'string' && message.tts_model
        ? message.tts_model
        : String(remoteTtsConfig.tts_model || DEFAULT_TTS_MODEL);
      const resolvedModel = TTS_MODEL_OPTIONS.includes(modelFromMessage)
        ? modelFromMessage
        : DEFAULT_TTS_MODEL;

      const normalizedConfigs: EngineConfigMap = {};
      Object.entries(remoteTtsConfig).forEach(([key, value]) => {
        if (key === 'tts_model') {
          return;
        }
        if (isRecord(value)) {
          normalizedConfigs[key] = value;
        }
      });

      const activeConfig = normalizedConfigs[resolvedModel] || DEFAULT_ENGINE_CONFIGS[resolvedModel] || {};
      const nextSettings: TTSPanelSettings = {
        ttsModel: [resolvedModel],
        voice: pickStringValue(activeConfig, VOICE_KEYS),
        speed: pickSpeedValue(activeConfig),
      };

      skipAutoSaveRef.current = true;
      setEngineConfigs(normalizedConfigs);
      if (nextSettings.voice) {
        setVoiceMemory((prev) => ({
          ...prev,
          [resolvedModel]: nextSettings.voice,
        }));
      }
      setSettings(nextSettings);
      setOriginalSettings(nextSettings);
    },
    [],
  );

  useEffect(() => {
    const subscription = wsService.onMessage((message: MessageEvent) => {
      if (message.type === 'tts-config') {
        applyRemoteTtsConfig(message);
      }
    });

    wsService.sendMessage({ type: 'request-tts-config' });

    return () => {
      subscription.unsubscribe();
    };
  }, [applyRemoteTtsConfig]);

  const handleModelChange = (value: string[]) => {
    const selectedModel = value[0] || DEFAULT_TTS_MODEL;
    const selectedConfig = engineConfigs[selectedModel] || DEFAULT_ENGINE_CONFIGS[selectedModel] || {};
    const selectedVoice = voiceMemory[selectedModel] || pickStringValue(selectedConfig, VOICE_KEYS);
    setSettings({
      ttsModel: [selectedModel],
      voice: selectedVoice,
      speed: pickSpeedValue(selectedConfig),
    });
  };

  const buildNextEngineConfig = useCallback((): { model: string; config: EngineConfig } => {
    const selectedModel = settings.ttsModel[0] || DEFAULT_TTS_MODEL;
    const currentModelConfig = engineConfigs[selectedModel] || DEFAULT_ENGINE_CONFIGS[selectedModel] || {};
    const nextConfig: EngineConfig = {
      ...(DEFAULT_ENGINE_CONFIGS[selectedModel] || {}),
      ...currentModelConfig,
    };

    const voice = settings.voice.trim();
    if (voice) {
      const targetVoiceKey = findPreferredKey(nextConfig, VOICE_KEYS);
      nextConfig[targetVoiceKey] = voice;
    }

    if (selectedModel === 'edge_tts') {
      nextConfig.rate = toEdgeRate(settings.speed);
    } else if (selectedModel === 'volcengine_tts') {
      nextConfig.speed_ratio = settings.speed;
    }

    return { model: selectedModel, config: nextConfig };
  }, [engineConfigs, settings.speed, settings.ttsModel, settings.voice]);

  const handleSave = useCallback(() => {
    const hasNoLocalChanges = JSON.stringify(settings) === JSON.stringify(originalSettings);
    if (hasNoLocalChanges) {
      return;
    }

    const next = buildNextEngineConfig();

    wsService.sendMessage({
      type: 'update-tts-config',
      tts_model: next.model,
      engine_config: next.config,
    });

    const nextSettings: TTSPanelSettings = {
      ttsModel: [next.model],
      voice: pickStringValue(next.config, VOICE_KEYS),
      speed: pickSpeedValue(next.config),
    };

    setEngineConfigs((prev) => ({ ...prev, [next.model]: next.config }));
    setSettings(nextSettings);
    setOriginalSettings(nextSettings);
  }, [settings, originalSettings, buildNextEngineConfig]);

  useEffect(() => {
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }

    if (JSON.stringify(settings) === JSON.stringify(originalSettings)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const next = buildNextEngineConfig();

      wsService.sendMessage({
        type: 'update-tts-config',
        tts_model: next.model,
        engine_config: next.config,
      });

      const nextSettings: TTSPanelSettings = {
        ttsModel: [next.model],
        voice: pickStringValue(next.config, VOICE_KEYS),
        speed: pickSpeedValue(next.config),
      };

      skipAutoSaveRef.current = true;
      setEngineConfigs((prev) => ({ ...prev, [next.model]: next.config }));
      setSettings(nextSettings);
      setOriginalSettings(nextSettings);
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [settings, originalSettings, buildNextEngineConfig]);

  const handleCancel = useCallback(() => {
    setSettings(originalSettings);
  }, [originalSettings]);

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
      <Stack gap={3}>
        <Text {...settingStyles.general.field.label}>
          {t('settings.tts.ttsModel')}
        </Text>
        <Box
          display="grid"
          gridTemplateColumns="repeat(2, minmax(0, 1fr))"
          gap={3}
        >
          {TTS_MODEL_OPTIONS.map((model) => {
            const isCurrent = selectedTtsModel === model;
            return (
              <Box
                key={model}
                role="button"
                tabIndex={0}
                minH="108px"
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
                onClick={() => handleModelChange([model])}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleModelChange([model]);
                  }
                }}
                _active={{ transform: "scale(0.985)" }}
              >
                <Stack h="100%" gap={2}>
                  <HStack justify="space-between" align="start">
                    <Text fontSize="18px" fontWeight="bold" color="whiteAlpha.950">
                      {TTS_MODEL_LABELS[model] || model}
                    </Text>
                    {isCurrent && (
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
                    )}
                  </HStack>
                  <Text mt="auto" fontSize="13px" color="whiteAlpha.700" lineHeight={1.45}>
                    {TTS_MODEL_DESCRIPTIONS[model]}
                  </Text>
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Stack>

      {voicePresets.length > 0 && (
        <Stack gap={3}>
          <HStack justify="space-between" align="center">
            <Stack gap={1}>
              <Text {...settingStyles.general.field.label}>
                {t('settings.tts.voicePreset')}
              </Text>
              <Text fontSize="13px" color="whiteAlpha.650">
                {selectedTtsModelLabel}
              </Text>
            </Stack>
            {settings.voice && (
              <Text
                px={3}
                py={1}
                borderRadius="full"
                bg="whiteAlpha.100"
                color="cyan.100"
                fontSize="12px"
                fontWeight="semibold"
              >
                {t('settings.tts.selectedVoice')}
              </Text>
            )}
          </HStack>

          <Box
            {...voiceDragScroll}
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
              {voicePresets.map((preset) => {
                const voiceView = getVoiceCardViewModel(preset);
                const isCurrent = settings.voice === preset.value;

                return (
                  <Box
                    key={preset.value}
                    role="button"
                    tabIndex={0}
                    minH="116px"
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
                    onClick={() => updateSelectedVoice(preset.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        updateSelectedVoice(preset.value);
                      }
                    }}
                    _active={{ transform: "scale(0.985)" }}
                  >
                    <Stack gap={2} h="100%">
                      <HStack justify="space-between" align="flex-start" gap={2}>
                        <Stack gap={1} minW={0}>
                          {voiceView.category && (
                            <Text
                              fontSize="12px"
                              color={isCurrent ? "cyan.100" : "whiteAlpha.650"}
                              fontWeight="semibold"
                              lineClamp={1}
                            >
                              {voiceView.category}
                            </Text>
                          )}
                          <Text
                            fontSize="17px"
                            fontWeight="bold"
                            color="whiteAlpha.950"
                            lineHeight={1.25}
                            lineClamp={2}
                          >
                            {voiceView.name}
                          </Text>
                        </Stack>
                        {isCurrent && (
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
                        )}
                      </HStack>
                      <Text
                        mt="auto"
                        fontSize="12px"
                        color="whiteAlpha.700"
                        lineHeight={1.35}
                        lineClamp={2}
                      >
                        {voiceView.value}
                      </Text>
                      {voiceView.note && (
                        <Text fontSize="12px" color="orange.200" lineClamp={1}>
                          {voiceView.note}
                        </Text>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {selectedTtsModel === 'volcengine_tts' && (
            <Text fontSize="13px" color="orange.200" lineHeight={1.5}>
              火山接口凭证沿用后台配置，界面只开放音色与语速选择。
            </Text>
          )}
        </Stack>
      )}

      <Stack gap={3}>
        <HStack justify="space-between" align="center">
          <Text {...settingStyles.general.field.label}>
            {t('settings.tts.speed')}
          </Text>
          <Text
            px={3}
            py={1}
            borderRadius="full"
            bg="whiteAlpha.100"
            color="cyan.100"
            fontSize="13px"
            fontWeight="semibold"
          >
            {formatSpeed(settings.speed)}
          </Text>
        </HStack>
        <Slider
          value={[settings.speed]}
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={0.1}
          marks={[
            { value: MIN_SPEED, label: '慢' },
            { value: DEFAULT_SPEED, label: '标准' },
            { value: MAX_SPEED, label: '快' },
          ]}
          onValueChange={(details) => {
            const [speed = DEFAULT_SPEED] = details.value;
            setSettings((prev) => ({ ...prev, speed: clampSpeed(speed) }));
          }}
          colorPalette="cyan"
        />
      </Stack>
    </Stack>
  );
}

export default TTS;
