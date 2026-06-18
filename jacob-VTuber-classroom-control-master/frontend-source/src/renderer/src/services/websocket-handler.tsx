/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  WebSocketContext, HistoryInfo, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useAudioTask } from '@/hooks/utils/use-audio-task';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { useVAD } from '@/context/vad-context';
import { AiState, useAiState } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useGroup } from '@/context/group-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useBrowser } from '@/context/browser-context';
import { audioManager } from '@/utils/audio-manager';
import { useAvatarAppearance } from '@/context/avatar-appearance-context';

interface BufferedAudioStream {
  chunks: string[];
  displayText: MessageEvent['display_text'] | null;
  expressions: string[] | number[] | null;
  forwarded: boolean;
}

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const {
    aiState,
    setAiState,
    backendSynthComplete,
    setBackendSynthComplete,
    setThinkingSpeakingPhase,
  } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const {
    setSubtitleText,
    appendHumanSubtitle,
    clearConversationMessages,
    markNextAiSubtitleAsNew,
  } = useSubtitle();
  const { clearResponse, setForceNewMessage, appendHumanMessage, appendOrUpdateToolCallMessage } = useChatHistory();
  const { addAudioTask } = useAudioTask();
  const bgUrlContext = useBgUrl();
  const {
    setConfName,
    setConfUid,
    setConfigFiles,
    setCharacterName,
    setHumanName,
    setPersonaPrompt,
  } = useConfig();
  const { setSelfUid, setGroupMembers, setIsOwner } = useGroup();
  const { startMic, stopMic, autoStopMic, autoStartMicOnConvEnd, micOn } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const autoStopMicRef = useRef(autoStopMic);
  const micOnRef = useRef(micOn);
  const pausedMicByConversationRef = useRef(false);
  const audioStreamBuffersRef = useRef<Map<string, BufferedAudioStream>>(new Map());
  const { interrupt } = useInterrupt();
  const { setBrowserViewData } = useBrowser();
  const { setAvatarMode, setAvatarPackId } = useAvatarAppearance();

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    autoStopMicRef.current = autoStopMic;
  }, [autoStopMic]);

  useEffect(() => {
    micOnRef.current = micOn;
  }, [micOn]);

  const {
    setCurrentHistoryUid, setMessages, setHistoryList,
  } = useChatHistory();

  const finalizeConversationCycle = useCallback(() => {
    pausedMicByConversationRef.current = false;
    setThinkingSpeakingPhase(null);
    setAiState('idle');

    if (autoStartMicOnConvEndRef.current && !micOnRef.current) {
      startMic();
    }
  }, [setAiState, setThinkingSpeakingPhase, startMic]);

  const handleControlMessage = useCallback((controlText: string) => {
    switch (controlText) {
      case 'start-mic':
        console.log('Starting microphone...');
        startMic();
        break;
      case 'stop-mic':
        console.log('Stopping microphone...');
        stopMic();
        break;
      case 'conversation-chain-start':
        setBackendSynthComplete(false);
        setAiState('thinking-speaking');
        setThinkingSpeakingPhase('thinking');
        // Prevent overlap when a new round starts before previous audio fully ends.
        audioManager.stopCurrentAudioAndLipSync();
        audioTaskQueue.clearQueue();
        audioStreamBuffersRef.current.clear();
        pausedMicByConversationRef.current = false;
        if (autoStopMicRef.current && micOnRef.current) {
          // Preserve original voice interaction behavior: only pause mic when this setting is enabled.
          pausedMicByConversationRef.current = true;
          stopMic();
        }
        clearResponse();
        break;
      case 'conversation-chain-end':
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          finalizeConversationCycle();
          resolve();
        }));
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  }, [
    clearResponse,
    finalizeConversationCycle,
    setAiState,
    setBackendSynthComplete,
    setThinkingSpeakingPhase,
    startMic,
    stopMic,
  ]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.log('Received message from server:', message);
    switch (message.type) {
      case 'control':
        if (message.text) {
          handleControlMessage(message.text);
        }
        break;
      case 'set-model-and-conf':
        setAiState('loading');
        clearConversationMessages();
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid !== undefined) {
          setConfUid(message.conf_uid);
          console.log('confUid', message.conf_uid);
        }
        if (message.client_uid) {
          setSelfUid(message.client_uid);
        }
        if (message.character_name !== undefined) {
          setCharacterName(message.character_name);
        }
        if (message.human_name !== undefined) {
          setHumanName(message.human_name);
        }
        if (message.persona_prompt !== undefined) {
          setPersonaPrompt(message.persona_prompt);
        }
        if (message.avatar_mode === "live2d" || message.avatar_mode === "avatarpack") {
          setAvatarMode(message.avatar_mode);
        }
        if (typeof message.avatar_pack_id === "string") {
          setAvatarPackId(message.avatar_pack_id);
        }
        let normalizedModelInfo = message.model_info;
        if (normalizedModelInfo?.url && !normalizedModelInfo.url.startsWith("http")) {
          const normalizedBaseUrl = (baseUrl || window.location.origin).replace(/\/+$/, "");
          const normalizedPath = normalizedModelInfo.url.startsWith("/")
            ? normalizedModelInfo.url
            : `/${normalizedModelInfo.url}`;
          normalizedModelInfo = {
            ...normalizedModelInfo,
            url: `${normalizedBaseUrl}${normalizedPath}`,
          };
        }
        setModelInfo(normalizedModelInfo);

        setAiState('idle');
        break;
      case 'full-text':
        if (message.text) {
          setSubtitleText(message.text);
        }
        break;
      case 'config-files':
        if (message.configs) {
          setConfigFiles(message.configs);
        }
        break;
      case 'config-switched':
        setAiState('idle');
        clearConversationMessages();
        setSubtitleText(t('notification.characterLoaded'));

        toaster.create({
          title: t('notification.characterSwitched'),
          type: 'success',
          duration: 2000,
        });

        // setModelInfo(undefined);

        wsService.sendMessage({ type: 'fetch-history-list' });
        wsService.sendMessage({ type: 'create-new-history' });
        break;
      case 'persona-updated':
        toaster.create({
          title: t('notification.personaUpdated'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'persona-generated':
        break;
      case 'live2d-model-updated':
        toaster.create({
          title: t('notification.live2dModelUpdated'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'avatar-pack-updated':
        toaster.create({
          title: t('notification.avatarPackUpdated'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'tts-config':
        break;
      case 'knowledge-settings':
        break;
      case 'tts-updated':
        toaster.create({
          title: t('notification.ttsUpdated'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'background-files':
        if (message.files) {
          bgUrlContext?.setBackgroundFiles(message.files);
        }
        break;
      case 'audio':
        if (aiState !== 'interrupted') {
          setAiState('thinking-speaking');
          setThinkingSpeakingPhase('speaking');
        }
        if (aiState === 'interrupted') {
          console.log('Audio playback intercepted. Sentence:', message.display_text?.text);
        } else {
          console.log("actions", message.actions);
          addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            forwarded: message.forwarded || false,
          });
        }
        break;
      case 'audio-stream-start':
        if (aiState !== 'interrupted') {
          setAiState('thinking-speaking');
          setThinkingSpeakingPhase('speaking');
        }
        if (message.stream_id) {
          audioStreamBuffersRef.current.set(message.stream_id, {
            chunks: [],
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            forwarded: message.forwarded || false,
          });
        } else {
          console.warn('Received audio-stream-start without stream_id');
        }
        break;
      case 'audio-stream-chunk':
        if (message.stream_id && message.chunk !== undefined) {
          const bufferedStream = audioStreamBuffersRef.current.get(message.stream_id);
          if (bufferedStream) {
            bufferedStream.chunks.push(message.chunk);
          }
        }
        break;
      case 'audio-stream-end':
        if (!message.stream_id) {
          console.warn('Received audio-stream-end without stream_id');
          break;
        }

        {
          const bufferedStream = audioStreamBuffersRef.current.get(message.stream_id);
          if (!bufferedStream) {
            console.warn('audio-stream-end received before stream start:', message.stream_id);
            break;
          }

          audioStreamBuffersRef.current.delete(message.stream_id);

          if (aiState === 'interrupted') {
            console.log('Audio stream playback intercepted. Sentence:', bufferedStream.displayText?.text);
            break;
          }

          addAudioTask({
            audioBase64: bufferedStream.chunks.join(''),
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: bufferedStream.displayText || null,
            expressions: bufferedStream.expressions || null,
            forwarded: bufferedStream.forwarded || false,
          });
        }
        break;
      case 'history-data':
        if (message.messages) {
          setMessages(message.messages);
        }
        clearConversationMessages();
        toaster.create({
          title: t('notification.historyLoaded'),
          type: 'success',
          duration: 2000,
        });
        break;
      case 'new-history-created':
        setAiState('idle');
        setThinkingSpeakingPhase(null);
        clearConversationMessages();
        setSubtitleText(t('notification.newConversation'));
        // No need to open mic here
        if (message.history_uid) {
          setCurrentHistoryUid(message.history_uid);
          setMessages([]);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: t('notification.newChatHistory'),
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case 'history-deleted':
        toaster.create({
          title: message.success
            ? t('notification.historyDeleteSuccess')
            : t('notification.historyDeleteFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'history-list':
        if (message.histories) {
          setHistoryList(message.histories);
          if (message.histories.length > 0) {
            setCurrentHistoryUid(message.histories[0].uid);
          }
        }
        break;
      case 'user-input-transcription':
        console.log('user-input-transcription: ', message.text);
        if (message.text) {
          appendHumanMessage(message.text);
          appendHumanSubtitle(message.text);
        }
        break;
      case 'error':
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case 'group-update':
        console.log('Received group-update:', message.members);
        if (message.members) {
          setGroupMembers(message.members);
        }
        if (message.is_owner !== undefined) {
          setIsOwner(message.is_owner);
        }
        break;
      case 'group-operation-result':
        toaster.create({
          title: message.message,
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'backend-synth-complete':
        setBackendSynthComplete(true);
        break;
      case 'conversation-chain-end':
        if (!audioTaskQueue.hasTask()) {
          finalizeConversationCycle();
        }
        break;
      case 'force-new-message':
        setForceNewMessage(true);
        markNextAiSubtitleAsNew();
        break;
      case 'interrupt-signal':
        // Handle forwarded interrupt
        audioStreamBuffersRef.current.clear();
        interrupt(false); // do not send interrupt signal to server
        break;
      case 'tool_call_status':
        if (message.tool_id && message.tool_name && message.status) {
          // If there's browser view data included, store it in the browser context
          if (message.browser_view) {
            console.log('Browser view data received:', message.browser_view);
            setBrowserViewData(message.browser_view);
          }

          appendOrUpdateToolCallMessage({
            id: message.tool_id,
            type: 'tool_call_status',
            role: 'ai',
            tool_id: message.tool_id,
            tool_name: message.tool_name,
            name: message.name,
            status: message.status as ('running' | 'completed' | 'error'),
            content: message.content || '',
            timestamp: message.timestamp || new Date().toISOString(),
          });
        } else {
          console.warn('Received incomplete tool_call_status message:', message);
        }
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }, [aiState, addAudioTask, appendHumanMessage, appendHumanSubtitle, baseUrl, bgUrlContext, clearConversationMessages, setAiState, setThinkingSpeakingPhase, setConfName, setConfUid, setCharacterName, setHumanName, setPersonaPrompt, setConfigFiles, setCurrentHistoryUid, setHistoryList, setMessages, setModelInfo, setSubtitleText, startMic, stopMic, setSelfUid, setGroupMembers, setIsOwner, setAvatarMode, setAvatarPackId, backendSynthComplete, setBackendSynthComplete, clearResponse, handleControlMessage, appendOrUpdateToolCallMessage, interrupt, markNextAiSubtitleAsNew, setBrowserViewData, t]);

  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [wsUrl, handleWebSocketMessage]);

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
