import {
  Box,
  Flex,
  Text,
  VStack,
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { memo, useEffect, useRef } from 'react';
import { canvasStyles } from './canvas-styles';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitleDisplay } from '@/hooks/canvas/use-subtitle-display';
import { useSubtitle } from '@/context/subtitle-context';

const waveBarAnimation = keyframes`
  0% { transform: scaleY(0.34); opacity: 0.62; }
  18% { transform: scaleY(1.15); opacity: 1; }
  34% { transform: scaleY(0.58); opacity: 0.78; }
  52% { transform: scaleY(1.38); opacity: 1; }
  76% { transform: scaleY(0.42); opacity: 0.7; }
  100% { transform: scaleY(0.9); opacity: 0.9; }
`;

const waveDotAnimation = keyframes`
  0%, 100% { transform: scale(0.9); opacity: 0.78; }
  50% { transform: scale(1.18); opacity: 1; }
`;

const waveBars = [
  { height: 12, duration: 0.76, delay: -0.18 },
  { height: 18, duration: 0.92, delay: -0.42 },
  { height: 24, duration: 0.68, delay: -0.08 },
  { height: 16, duration: 0.84, delay: -0.56 },
  { height: 26, duration: 0.72, delay: -0.28 },
  { height: 14, duration: 0.98, delay: -0.68 },
  { height: 21, duration: 0.8, delay: -0.34 },
  { height: 15, duration: 0.88, delay: -0.5 },
];

function ListeningWave(): JSX.Element {
  return (
    <Box {...canvasStyles.subtitle.listeningWaveContainer}>
      <Box {...canvasStyles.subtitle.listeningWavePill}>
        <Box
          {...canvasStyles.subtitle.listeningWaveDot}
          animation={`${waveDotAnimation} 1.05s ease-in-out infinite`}
        />
        <Box {...canvasStyles.subtitle.listeningWaveBars} aria-label="正在聆听">
          {waveBars.map((bar, index) => (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              {...canvasStyles.subtitle.listeningWaveBar}
              height={`${bar.height}px`}
              animation={`${waveBarAnimation} ${bar.duration}s ease-in-out ${bar.delay}s infinite alternate`}
            />
          ))}
        </Box>
        <Text {...canvasStyles.subtitle.listeningWaveText}>正在听</Text>
      </Box>
    </Box>
  );
}

function Subtitle(): JSX.Element | null {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { subtitleText, conversationMessages, isLoaded } = useSubtitleDisplay();
  const { showSubtitle } = useSubtitle();
  const { isListening } = useAiState();

  useEffect(() => {
    if (!scrollRef.current || conversationMessages.length === 0) {
      return;
    }

    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [conversationMessages]);

  if (!isLoaded || !showSubtitle) {
    return null;
  }

  if (conversationMessages.length === 0 && !subtitleText && !isListening) {
    return null;
  }

  return (
    <Box {...canvasStyles.subtitle.container}>
      <Box {...canvasStyles.subtitle.glow} />
      {isListening && <ListeningWave />}

      {conversationMessages.length > 0 ? (
        <VStack ref={scrollRef} {...canvasStyles.subtitle.scrollArea}>
          {conversationMessages.map((message) => {
            const isHuman = message.role === 'human';

            return (
              <Flex
                key={message.id}
                justify={isHuman ? 'flex-end' : 'flex-start'}
                {...canvasStyles.subtitle.row}
              >
                <Box
                  display="flex"
                  flexDirection="column"
                  alignItems={isHuman ? 'flex-end' : 'flex-start'}
                  width="100%"
                  maxW="92%"
                >
                  <Box
                    {...canvasStyles.subtitle.bubble}
                    {...(isHuman
                      ? canvasStyles.subtitle.humanBubble
                      : canvasStyles.subtitle.aiBubble)}
                  >
                    <Text {...canvasStyles.subtitle.bubbleText}>
                      {message.text}
                    </Text>
                  </Box>
                </Box>
              </Flex>
            );
          })}
        </VStack>
      ) : (
        <Flex {...canvasStyles.subtitle.systemContainer}>
          <Box {...canvasStyles.subtitle.systemPill}>
            <Text {...canvasStyles.subtitle.systemText}>
              {subtitleText}
            </Text>
          </Box>
        </Flex>
      )}
    </Box>
  );
}

export default memo(Subtitle);
