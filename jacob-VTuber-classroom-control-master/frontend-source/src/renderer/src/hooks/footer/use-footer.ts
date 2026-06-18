import { ChangeEvent, KeyboardEvent } from 'react';
import { useVAD } from '@/context/vad-context';
import { useTextInput } from '@/hooks/footer/use-text-input';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useMicToggle } from '@/hooks/utils/use-mic-toggle';
import { useAiState, AiStateEnum } from '@/context/ai-state-context';
import { useTriggerSpeak } from '@/hooks/utils/use-trigger-speak';
import { useProactiveSpeak } from '@/context/proactive-speak-context';
import { useWebSocket } from '@/context/websocket-context';
import { toaster } from '@/components/ui/toaster';
import i18n from 'i18next';

export const useFooter = () => {
  const {
    inputText: inputValue,
    setInputText: handleChange,
    handleKeyPress: handleKey,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextInput();

  const { interrupt } = useInterrupt();
  const { startMic, autoStartMicOn } = useVAD();
  const { handleMicToggle, micOn } = useMicToggle();
  const { setAiState, aiState } = useAiState();
  const { sendTriggerSignal } = useTriggerSpeak();
  const { settings } = useProactiveSpeak();
  const { baseUrl } = useWebSocket();

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    handleChange({ target: { value: e.target.value } } as ChangeEvent<HTMLInputElement>);
    setAiState(AiStateEnum.WAITING);
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    handleKey(e as any);
  };

  const handleInterrupt = () => {
    const didInterrupt = interrupt();
    if (didInterrupt) {
      if (autoStartMicOn) {
        startMic();
      }
      return;
    }

    if (settings.allowButtonTrigger) {
      sendTriggerSignal(-1);
    }
  };

  const handleExitProject = async () => {
    const normalizedBaseUrl = (baseUrl || 'http://localhost:12393').replace(/\/+$/, '');
    try {
      let response = await fetch(`${normalizedBaseUrl}/system/exit`, {
        method: 'POST',
      });
      if (response.status === 404 || response.status === 405) {
        // Backward compatibility: some old backend sessions may only accept GET.
        response = await fetch(`${normalizedBaseUrl}/system/exit`, {
          method: 'GET',
        });
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      toaster.create({
        title: `${i18n.t('footer.exitProjectFailed')}: ${(error as Error).message}`,
        type: 'error',
        duration: 3000,
      });
    }
  };

  return {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleExitProject,
    handleMicToggle,
    micOn,
  };
};
