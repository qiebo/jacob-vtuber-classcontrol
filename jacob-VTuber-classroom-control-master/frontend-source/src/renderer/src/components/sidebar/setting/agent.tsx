/* eslint-disable import/no-extraneous-dependencies */
import { Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';

interface AgentProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function Agent({ onSave, onCancel }: AgentProps): JSX.Element {
  const { t } = useTranslation();
  void onSave;
  void onCancel;

  return (
    <Stack {...settingStyles.common.container}>
      <Text fontSize="sm" color="whiteAlpha.700">
        {t('settings.agent.movedToCharacter')}
      </Text>
    </Stack>
  );
}

export default Agent;
