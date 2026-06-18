import { useMemo } from 'react';
import { useSubtitle } from '@/context/subtitle-context';

export const useSubtitleDisplay = () => {
  const context = useSubtitle();

  const subtitleText = useMemo(() => {
    if (!context) return null;
    return context.subtitleText;
  }, [context?.subtitleText]);

  const conversationMessages = useMemo(() => {
    if (!context) return [];
    return context.conversationMessages;
  }, [context?.conversationMessages]);

  return {
    subtitleText,
    conversationMessages,
    isLoaded: !!context,
  };
};
