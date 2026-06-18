import { SystemStyleObject } from '@chakra-ui/react';

interface FooterStyles {
  wrapper: SystemStyleObject
  container: (isCollapsed: boolean) => SystemStyleObject
  toggleButton: (isCollapsed: boolean) => SystemStyleObject
  inlineToggleButton: SystemStyleObject
  actionButton: SystemStyleObject
  input: SystemStyleObject
  attachButton: SystemStyleObject
}

interface AIIndicatorStyles {
  container: SystemStyleObject
  text: SystemStyleObject
}

export const footerStyles: {
  footer: FooterStyles
  aiIndicator: AIIndicatorStyles
} = {
  footer: {
    wrapper: {
      position: 'relative',
      width: '100%',
      height: '196px',
      mx: 'auto',
      overflow: 'visible',
    },
    container: (isCollapsed) => ({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: '-28px',
      bg: 'rgba(15, 23, 42, 0.56)',
      borderRadius: '24px',
      border: '1px solid rgba(255,255,255,0.14)',
      backdropFilter: 'blur(14px)',
      boxShadow: '0 18px 42px rgba(15,23,42,0.32)',
      transform: isCollapsed ? 'translateY(calc(100% + 72px))' : 'translateY(0)',
      opacity: isCollapsed ? 0 : 1,
      visibility: isCollapsed ? 'hidden' : 'visible',
      pointerEvents: isCollapsed ? 'none' : 'auto',
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, visibility 0s linear',
      width: '100%',
      overflow: 'hidden',
      px: 4,
      pt: 6,
      pb: 4,
    }),
    toggleButton: (isCollapsed) => ({
      position: 'absolute',
      ...(isCollapsed
        ? {
          left: '50%',
          right: 'auto',
          bottom: '0',
          transform: 'translateX(-50%)',
        }
        : {
          left: 'auto',
          right: '14px',
          bottom: '118px',
          transform: 'none',
        }),
      width: '88px',
      height: '42px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: 'white',
      borderRadius: 'full',
      borderWidth: '1px',
      borderColor: 'whiteAlpha.200',
      bg: 'rgba(15, 23, 42, 0.56)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 12px 28px rgba(15,23,42,0.28)',
      _hover: {
        color: 'white',
        bg: 'rgba(15, 23, 42, 0.74)',
        borderColor: 'whiteAlpha.300',
      },
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex: 5,
    }),
    inlineToggleButton: {
      width: '64px',
      height: '72px',
      minW: '64px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: 'white',
      borderRadius: '18px',
      borderWidth: '1px',
      borderColor: 'whiteAlpha.200',
      bg: 'rgba(15, 23, 42, 0.56)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 12px 28px rgba(15,23,42,0.22)',
      flexShrink: 0,
      _hover: {
        color: 'white',
        bg: 'rgba(15, 23, 42, 0.74)',
        borderColor: 'whiteAlpha.300',
      },
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    },
    actionButton: {
      borderRadius: '16px',
      width: '64px',
      height: '72px',
      minW: '64px',
      boxShadow: '0 12px 24px rgba(15,23,42,0.22)',
      border: '1px solid rgba(255,255,255,0.12)',
      flexShrink: 0,
    },
    input: {
      bg: 'rgba(30, 41, 59, 0.66)',
      border: '1px solid rgba(255,255,255,0.12)',
      height: '72px',
      borderRadius: '18px',
      fontSize: '18px',
      pl: '12',
      pr: '4',
      color: 'whiteAlpha.900',
      _placeholder: {
        color: 'whiteAlpha.500',
      },
      _focus: {
        border: '1px solid rgba(255,255,255,0.18)',
        bg: 'rgba(30, 41, 59, 0.72)',
      },
      resize: 'none',
      minHeight: '72px',
      maxHeight: '72px',
      py: '0',
      display: 'flex',
      alignItems: 'center',
      paddingTop: '24px',
      lineHeight: '1.4',
    },
    attachButton: {
      position: 'absolute',
      left: '1',
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'whiteAlpha.700',
      zIndex: 2,
      _hover: {
        bg: 'transparent',
        color: 'white',
      },
    },
  },
  aiIndicator: {
    container: {
      bg: '#7C5CFF',
      color: 'white',
      width: '110px',
      height: '30px',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
      overflow: 'hidden',
    },
    text: {
      fontSize: '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
  },
};
