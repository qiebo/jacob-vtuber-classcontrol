import {
  Box,
  HStack,
  Text,
} from '@chakra-ui/react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { canvasStyles } from './canvas-styles';
import { useWSStatus } from '@/hooks/canvas/use-ws-status';
import { useAiState } from '@/context/ai-state-context';

// Main component
const WebSocketStatus = memo((): JSX.Element => {
  const {
    color, handleClick, isDisconnected,
  } = useWSStatus();
  const { t } = useTranslation();
  const { aiState, thinkingSpeakingPhase } = useAiState();
  const stateKey = aiState === 'thinking-speaking'
    ? (thinkingSpeakingPhase === 'speaking' ? 'speaking' : 'thinking')
    : aiState;

  return (
    <Box
      {...canvasStyles.wsStatus.container}
      onClick={handleClick}
      cursor={isDisconnected ? 'pointer' : 'default'}
      _hover={{
        opacity: isDisconnected ? 0.8 : 1,
      }}
    >
      <HStack gap={2}>
        <Box
          {...canvasStyles.wsStatus.dot}
          backgroundColor={color}
        />
        <Text {...canvasStyles.wsStatus.text}>
          {t(`aiState.${stateKey}`)}
        </Text>
      </HStack>
    </Box>
  );
});

WebSocketStatus.displayName = 'WebSocketStatus';

export default WebSocketStatus;
