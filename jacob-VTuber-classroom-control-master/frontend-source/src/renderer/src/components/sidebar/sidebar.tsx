/* eslint-disable react/require-default-props */
import { Box } from '@chakra-ui/react';
import { FiChevronLeft } from 'react-icons/fi';
import { memo } from 'react';
import { sidebarStyles } from './sidebar-styles';
import SettingUI from './setting/setting-ui';

interface SidebarProps {
  isCollapsed?: boolean
  onToggle: () => void
}

const ToggleButton = memo(({ isCollapsed, onToggle }: {
  isCollapsed: boolean
  onToggle: () => void
}) => (
  <Box
    {...sidebarStyles.sidebar.toggleButton('left', isCollapsed)}
    onClick={onToggle}
  >
    <FiChevronLeft
      size={22}
      style={{
        transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  </Box>
));

ToggleButton.displayName = 'ToggleButton';

function Sidebar({ isCollapsed = false, onToggle }: SidebarProps): JSX.Element {
  return (
    <Box position="relative" width="100%" height="100%" overflow="visible">
      <ToggleButton isCollapsed={isCollapsed} onToggle={onToggle} />
      <Box {...sidebarStyles.sidebar.container(isCollapsed, 'left')}>
        {!isCollapsed && <SettingUI />}
      </Box>
    </Box>
  );
}

export default Sidebar;
