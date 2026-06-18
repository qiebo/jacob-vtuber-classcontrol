import {
  SIDEBAR_COLLAPSED_WIDTH,
} from './components/sidebar/sidebar-styles';

const isElectron = window.api !== undefined;

const getAppHeight = () => {
  if (typeof window !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent)) {
    return `${window.innerHeight}px`;
  }
  return isElectron ? 'calc(100vh - 30px)' : '100vh';
};



export const layoutStyles = {
  appContainer: {
    width: '100vw',
    height: getAppHeight(),
    bg: 'gray.900',
    color: 'white',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    flexDirection: { base: 'column', md: 'row' },
    mt: isElectron ? '30px' : '0',
  },
  sidebar: (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    [side]: 0,
    width: SIDEBAR_COLLAPSED_WIDTH,
    height: '100%',
    minWidth: SIDEBAR_COLLAPSED_WIDTH,
    bg: 'transparent',
    overflow: 'visible',
    flexShrink: 0,
    transition: 'none',
    zIndex: 30,
  }),
  mainContent: {
    flex: 1,
    height: '100%',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    width: '100%',
    overflow: 'hidden',
  },
  canvas: {
    position: 'relative',
    width: '100%',
    flex: 1,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    overflow: 'hidden',
    willChange: 'transform',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '6px',
    width: '100%',
    height: '196px',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    willChange: 'transform',
    zIndex: 1,
    overflow: 'visible',
  },
  toggleButton: {
    position: 'absolute',
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    height: '60px',
    bg: 'whiteAlpha.100',
    _hover: { bg: 'whiteAlpha.200' },
    borderLeftRadius: 0,
    borderRightRadius: 'md',
    zIndex: 10,
  },
  canvasHeight: (isFooterCollapsed: boolean) => ({
    height: isFooterCollapsed ? 'calc(100% - 24px)' : 'calc(100% - 120px)',
  }),
  sidebarToggleButton: {
    position: 'absolute',
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    height: '60px',
    bg: 'gray.800',
    borderLeftRadius: 0,
    borderRightRadius: 'md',
    zIndex: 10,
  },
  collapsedFooter: {},
  windowsTitleBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '30px',
    backgroundColor: 'gray.800',
    paddingX: '10px',
    zIndex: 1000,
    css: { '-webkit-app-region': 'drag' },
  },
  macTitleBar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '30px',
    backgroundColor: 'gray.800',
    zIndex: 1000,
    css: {
      '-webkit-app-region': 'drag',
      '-webkit-user-select': 'none',
    },
  },
  titleBarTitle: {
    fontSize: 'sm',
    color: 'whiteAlpha.800',
    textAlign: 'center',
  },
  titleBarButtons: {
    display: 'flex',
    gap: '1',
  },
  titleBarButton: {
    size: 'sm',
    variant: 'ghost',
    color: 'whiteAlpha.800',
    css: { '-webkit-app-region': 'no-drag' },
    _hover: { backgroundColor: 'whiteAlpha.200' },
  },
  closeButton: {
    size: 'sm',
    variant: 'ghost',
    color: 'whiteAlpha.800',
    css: { '-webkit-app-region': 'no-drag' },
    _hover: { backgroundColor: 'red.500' },
  },
} as const;
