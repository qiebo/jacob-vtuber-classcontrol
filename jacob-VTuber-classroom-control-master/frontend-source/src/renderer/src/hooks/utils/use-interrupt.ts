import { useAiState } from '@/context/ai-state-context';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useSubtitle } from '@/context/subtitle-context';
import { audioManager } from '@/utils/audio-manager';

export const useInterrupt = () => {
  const { aiState, thinkingSpeakingPhase, setAiState, setThinkingSpeakingPhase } = useAiState();
  const { sendMessage } = useWebSocket();
  const { fullResponse, clearResponse } = useChatHistory();
  // const { currentModel } = useLive2DModel();
  const { subtitleText, setSubtitleText } = useSubtitle();

  const interrupt = (sendSignal = true) => {
    const canInterrupt = aiState === 'thinking-speaking'
      || thinkingSpeakingPhase === 'speaking'
      || audioManager.hasCurrentAudio();

    if (!canInterrupt) {
      return false;
    }
    console.log('Interrupting conversation chain');

    audioManager.stopCurrentAudioAndLipSync();

    audioTaskQueue.clearQueue();

    setAiState('interrupted');
    setThinkingSpeakingPhase(null);

    if (sendSignal) {
      sendMessage({
        type: 'interrupt-signal',
        text: fullResponse,
      });
    }

    clearResponse();

    if (subtitleText === 'Thinking...') {
      setSubtitleText('');
    }
    console.log('Interrupted!');
    return true;
  };

  return { interrupt };
};
