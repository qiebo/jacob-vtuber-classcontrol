/* eslint-disable import/no-extraneous-dependencies */
import {
  Tabs,
  Button,
  Box,
  Flex,
} from '@chakra-ui/react';
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toaster } from '@/components/ui/toaster';
import { useDragScroll } from '@/hooks/utils/use-drag-scroll';

import { settingStyles } from './setting-styles';
import Character from './character';
import Classroom from './classroom';
import Stage from './stage';
import TTS from './tts';
import Knowledge from './knowledge';
import About from './about';
import Config from './config';

function SettingUI(): JSX.Element {
  const { t } = useTranslation();
  const [saveHandlers, setSaveHandlers] = useState<(() => void)[]>([]);
  const [cancelHandlers, setCancelHandlers] = useState<(() => void)[]>([]);
  const [activeTab, setActiveTab] = useState('stage');
  const drawerDragScroll = useDragScroll<HTMLDivElement>({ axis: 'y' });

  const handleSaveCallback = useCallback((handler: () => void) => {
    setSaveHandlers((prev) => [...prev, handler]);
    return (): void => {
      setSaveHandlers((prev) => prev.filter((h) => h !== handler));
    };
  }, []);

  const handleCancelCallback = useCallback((handler: () => void) => {
    setCancelHandlers((prev) => [...prev, handler]);
    return (): void => {
      setCancelHandlers((prev) => prev.filter((h) => h !== handler));
    };
  }, []);

  const handleSave = useCallback((): void => {
    saveHandlers.forEach((handler) => handler());
    toaster.create({
      title: t('notification.settingsSaved'),
      type: 'success',
      duration: 1600,
    });
  }, [saveHandlers, t]);

  const handleCancel = useCallback((): void => {
    cancelHandlers.forEach((handler) => handler());
  }, [cancelHandlers]);

  const tabsContent = useMemo(
    () => (
      <Tabs.ContentGroup {...settingStyles.settingUI.tabs.contentGroup}>
        <Tabs.Content value="classroom" {...settingStyles.settingUI.tabs.content}>
          <Classroom />
        </Tabs.Content>
        <Tabs.Content value="stage" {...settingStyles.settingUI.tabs.content}>
          <Stage
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="character" {...settingStyles.settingUI.tabs.content}>
          <Character
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="tts" {...settingStyles.settingUI.tabs.content}>
          <TTS
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="knowledge" {...settingStyles.settingUI.tabs.content}>
          <Knowledge />
        </Tabs.Content>
        <Tabs.Content value="config" {...settingStyles.settingUI.tabs.content}>
          <Config
            onSave={handleSaveCallback}
            onCancel={handleCancelCallback}
          />
        </Tabs.Content>
        <Tabs.Content value="about" {...settingStyles.settingUI.tabs.content}>
          <About />
        </Tabs.Content>
      </Tabs.ContentGroup>
    ),
    [handleSaveCallback, handleCancelCallback],
  );

  return (
    <Flex {...settingStyles.settingUI.panelRoot}>
      <Box {...settingStyles.settingUI.drawerHeader}>
        <Box {...settingStyles.settingUI.drawerTitle}>
            {t('common.settings')}
        </Box>
      </Box>

      <Box {...settingStyles.settingUI.drawerBody} {...drawerDragScroll}>
          <Tabs.Root
            defaultValue="stage"
            value={activeTab}
            onValueChange={(details) => setActiveTab(details.value)}
            {...settingStyles.settingUI.tabs.root}
          >
            <Tabs.List {...settingStyles.settingUI.tabs.list}>
              <Tabs.Trigger
                value="classroom"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.classroom')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="stage"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.stage')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="character"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.character')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="tts"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.tts')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="knowledge"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.knowledge')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="config"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.config')}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="about"
                {...settingStyles.settingUI.tabs.trigger}
              >
                {t('settings.tabs.about')}
              </Tabs.Trigger>
            </Tabs.List>

            {tabsContent}
          </Tabs.Root>
      </Box>

      <Box {...settingStyles.settingUI.footer}>
          <Button colorPalette="red" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button colorPalette="blue" onClick={handleSave}>
            {t('common.save')}
          </Button>
      </Box>
    </Flex>
  );
}

export default SettingUI;
