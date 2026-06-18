import { Box, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useAiState } from '@/context/ai-state-context';
import { footerStyles } from './footer-styles';

function AIStateIndicator(): JSX.Element {
  const { t } = useTranslation();
  const { aiState, thinkingSpeakingPhase } = useAiState();
  const styles = footerStyles.aiIndicator;
  const stateKey = aiState === 'thinking-speaking'
    ? (thinkingSpeakingPhase === 'speaking' ? 'speaking' : 'thinking')
    : aiState;

  return (
    <Box {...styles.container}>
      <Text {...styles.text}>{t(`aiState.${stateKey}`)}</Text>
    </Box>
  );
}

export default AIStateIndicator;
