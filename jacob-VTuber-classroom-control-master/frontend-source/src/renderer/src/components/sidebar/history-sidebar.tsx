/* eslint-disable react/require-default-props */
import { Box, Button } from '@chakra-ui/react';
import {
  FiClock, FiPlus, FiChevronRight,
} from 'react-icons/fi';
import { memo } from 'react';
import { sidebarStyles } from './sidebar-styles';
import ChatHistoryPanel from './chat-history-panel';
import HistoryDrawer from './history-drawer';
import { useSidebar } from '@/hooks/sidebar/use-sidebar';

interface HistorySidebarProps {
  isCollapsed?: boolean
  onToggle: () => void
}

interface HeaderButtonsProps {
  onNewHistory: () => void
}

const ToggleButton = memo(({ isCollapsed, onToggle }: {
  isCollapsed: boolean
  onToggle: () => void
}) => (
  <Box
    {...sidebarStyles.sidebar.toggleButton('right', isCollapsed)}
    onClick={onToggle}
  >
    <FiChevronRight
      size={22}
      style={{
        transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  </Box>
));

ToggleButton.displayName = 'HistoryToggleButton';

const HeaderButtons = memo(({
  onNewHistory,
}: HeaderButtonsProps) => (
  <Box display="flex" gap={1}>
    <HistoryDrawer>
      <Button>
        <FiClock />
      </Button>
    </HistoryDrawer>

    <Button onClick={onNewHistory}>
      <FiPlus />
    </Button>
  </Box>
));

HeaderButtons.displayName = 'HistoryHeaderButtons';

function HistorySidebar({ isCollapsed = false, onToggle }: HistorySidebarProps): JSX.Element {
  const {
    createNewHistory,
  } = useSidebar();

  return (
    <Box position="relative" width="100%" height="100%" overflow="visible">
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />
      <Box {...sidebarStyles.sidebar.container(isCollapsed, 'right')}>
        {!isCollapsed && (
          <Box {...sidebarStyles.sidebar.content}>
            <Box {...sidebarStyles.sidebar.header}>
              <HeaderButtons
                onNewHistory={createNewHistory}
              />
            </Box>
            <ChatHistoryPanel />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default HistorySidebar;
