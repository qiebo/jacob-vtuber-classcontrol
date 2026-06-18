import {
  createContext, useState, useMemo, useContext, memo, useCallback, useRef,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

export type SubtitleMessageRole = 'human' | 'ai';

export interface SubtitleMessage {
  id: string
  role: SubtitleMessageRole
  text: string
  timestamp: string
}

/**
 * Subtitle context state interface
 * @interface SubtitleState
 */
interface SubtitleState {
  /** Current subtitle text */
  subtitleText: string

  /** Set subtitle text */
  setSubtitleText: (text: string) => void

  /** Real-time conversation overlay messages */
  conversationMessages: SubtitleMessage[]

  /** Push recognized human text into conversation overlay */
  appendHumanSubtitle: (text: string) => void

  /** Append AI text into conversation overlay */
  appendAISubtitle: (text: string) => void

  /** Clear real-time conversation overlay messages */
  clearConversationMessages: () => void

  /** Force the next AI subtitle chunk to start a new bubble */
  markNextAiSubtitleAsNew: () => void

  /** Whether to show subtitle */
  showSubtitle: boolean

  /** Toggle subtitle visibility */
  setShowSubtitle: (show: boolean) => void
}

/**
 * Default values and constants
 */
const DEFAULT_SUBTITLE = {
  text: '',
};

const MAX_CONVERSATION_MESSAGES = 24;
const EMOTE_TAG_REGEX = /\[(?:[a-zA-Z][a-zA-Z0-9:_-]{0,31})\]/g;
const EMOJI_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

const trimConversationMessages = (messages: SubtitleMessage[]) => (
  messages.length > MAX_CONVERSATION_MESSAGES
    ? messages.slice(messages.length - MAX_CONVERSATION_MESSAGES)
    : messages
);

const sanitizeAISubtitleText = (text: string) => (
  text
    .replace(EMOTE_TAG_REGEX, '')
    .replace(EMOJI_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
);

const createSubtitleMessage = (role: SubtitleMessageRole, text: string): SubtitleMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  text,
  timestamp: new Date().toISOString(),
});

/**
 * Create the subtitle context
 */
export const SubtitleContext = createContext<SubtitleState | null>(null);

/**
 * Subtitle Provider Component
 * Manages the subtitle display text state
 *
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export const SubtitleProvider = memo(({ children }: { children: React.ReactNode }) => {
  // State management
  const [subtitleText, setSubtitleTextState] = useState<string>(DEFAULT_SUBTITLE.text);
  const [conversationMessages, setConversationMessages] = useState<SubtitleMessage[]>([]);
  const [showSubtitle, setShowSubtitle] = useLocalStorage<boolean>('showSubtitle', true);
  const shouldStartNewAiBubbleRef = useRef(true);

  const setSubtitleText = useCallback((text: string) => {
    setSubtitleTextState(text);
  }, []);

  const appendHumanSubtitle = useCallback((text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    shouldStartNewAiBubbleRef.current = true;
    setSubtitleTextState('');
    setConversationMessages((prevMessages) => trimConversationMessages([
      ...prevMessages,
      createSubtitleMessage('human', normalizedText),
    ]));
  }, []);

  const appendAISubtitle = useCallback((text: string) => {
    const normalizedText = sanitizeAISubtitleText(text);
    if (!normalizedText) {
      return;
    }

    setSubtitleTextState('');
    setConversationMessages((prevMessages) => {
      const lastMessage = prevMessages[prevMessages.length - 1];

      if (
        shouldStartNewAiBubbleRef.current
        || !lastMessage
        || lastMessage.role !== 'ai'
      ) {
        shouldStartNewAiBubbleRef.current = false;
        return trimConversationMessages([
          ...prevMessages,
          createSubtitleMessage('ai', normalizedText),
        ]);
      }

      return trimConversationMessages([
        ...prevMessages.slice(0, -1),
        {
          ...lastMessage,
          text: `${lastMessage.text}${normalizedText}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
  }, []);

  const clearConversationMessages = useCallback(() => {
    shouldStartNewAiBubbleRef.current = true;
    setConversationMessages([]);
  }, []);

  const markNextAiSubtitleAsNew = useCallback(() => {
    shouldStartNewAiBubbleRef.current = true;
  }, []);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      subtitleText,
      setSubtitleText,
      conversationMessages,
      appendHumanSubtitle,
      appendAISubtitle,
      clearConversationMessages,
      markNextAiSubtitleAsNew,
      showSubtitle,
      setShowSubtitle,
    }),
    [
      subtitleText,
      setSubtitleText,
      conversationMessages,
      appendHumanSubtitle,
      appendAISubtitle,
      clearConversationMessages,
      markNextAiSubtitleAsNew,
      showSubtitle,
    ],
  );

  return (
    <SubtitleContext.Provider value={contextValue}>
      {children}
    </SubtitleContext.Provider>
  );
});

/**
 * Custom hook to use the subtitle context
 * @throws {Error} If used outside of SubtitleProvider
 */
export function useSubtitle() {
  const context = useContext(SubtitleContext);

  if (!context) {
    throw new Error('useSubtitle must be used within a SubtitleProvider');
  }

  return context;
}
