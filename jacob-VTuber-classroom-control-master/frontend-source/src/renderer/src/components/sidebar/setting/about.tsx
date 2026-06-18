import {
  Box,
  Stack,
  Text,
  Heading,
} from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';

function About(): JSX.Element {
  const { t } = useTranslation();
  const appVersion = '1.0.0';

  return (
    <Stack {...settingStyles.common.container} gap={3}>
      <Heading size="md" mb={1}>
        {t("settings.about.title")}
      </Heading>
      <Box>
        <Text fontWeight="bold" mb={0}>
          {t("settings.about.version")}
        </Text>
        <Text>{appVersion}</Text>
      </Box>
      <Box mt={1}>
        <Text fontWeight="bold" mb={0}>
          {t("settings.about.copyright")}
        </Text>
        <Text>© {new Date().getFullYear()} 远播翼生涯数字人桌面版</Text>
      </Box>
    </Stack>
  );
}

export default About;
