/* eslint-disable import/no-extraneous-dependencies */
import { Box, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';

import { settingStyles } from './setting-styles';
import ASR from './asr';
import General from './general';

interface ConfigProps {
  onSave?: (callback: () => void) => () => void;
  onCancel?: (callback: () => void) => () => void;
}

function Config({ onSave, onCancel }: ConfigProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <Stack {...settingStyles.common.container}>
      <ASR onSave={onSave} onCancel={onCancel} />

      <Box {...settingStyles.common.moduleCard}>
        <Stack gap={4}>
          <Text {...settingStyles.common.sectionTitle}>
            {t('settings.config.generalModule')}
          </Text>
          <General onSave={onSave} onCancel={onCancel} />
        </Stack>
      </Box>
    </Stack>
  );
}

export default Config;
