const isElectron = window.api !== undefined;
export const settingStyles = {
  settingUI: {
    panelRoot: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      bg: 'gray.900',
      color: 'white',
      css: {
        '& button, & [role="button"], & [role="tab"], & [role="tablist"]': {
          userSelect: 'none',
          WebkitUserSelect: 'none',
        },
        '& input, & textarea, [contenteditable="true"]': {
          userSelect: 'text',
          WebkitUserSelect: 'text',
          touchAction: 'auto',
        },
      },
    },
    container: {
      width: '100%',
      height: '100%',
      p: 4,
      gap: 4,
      position: 'relative',
      overflowY: 'auto',
      css: {
        '&::-webkit-scrollbar': {
          width: '4px',
        },
        '&::-webkit-scrollbar-track': {
          bg: 'whiteAlpha.100',
          borderRadius: 'full',
        },
        '&::-webkit-scrollbar-thumb': {
          bg: 'whiteAlpha.300',
          borderRadius: 'full',
        },
      },
    },
    header: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 1,
    },
    title: {
      ml: 4,
      fontSize: '20px',
      fontWeight: 'bold',
    },
    tabs: {
      root: {
        width: '100%',
        variant: 'plain' as const,
        colorPalette: 'gray',
        bg: 'transparent',
      },
      contentGroup: {
        bg: 'transparent',
        width: '100%',
      },
      content: {
        bg: 'transparent',
        width: '100%',
      },
      trigger: {
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minH: '52px',
        minW: '72px',
        px: 5,
        py: 2,
        borderRadius: 'lg',
        color: 'gray.300',
        bg: 'transparent',
        fontSize: '18px',
        fontWeight: '700',
        _selected: {
          color: 'white',
          bg: 'whiteAlpha.300',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
        },
        _hover: {
          color: 'white',
          bg: 'whiteAlpha.100',
        },
      },
      list: {
        position: 'sticky' as const,
        top: 0,
        zIndex: 2,
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-start',
        width: '100%',
        bg: 'gray.900',
        borderRadius: 'lg',
        p: 1,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid',
        borderColor: 'whiteAlpha.200',
        mb: 4,
        pl: 0,
        css: {
          touchAction: 'pan-x',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          '&::-webkit-scrollbar': {
            height: '4px',
          },
          '&::-webkit-scrollbar-track': {
            bg: 'whiteAlpha.100',
            borderRadius: 'full',
          },
          '&::-webkit-scrollbar-thumb': {
            bg: 'whiteAlpha.300',
            borderRadius: 'full',
          },
        },
      },
    },
    footer: {
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 2,
      mt: 'auto',
      px: 6,
      py: 4,
      borderTop: '1px solid',
      borderColor: 'whiteAlpha.200',
      bg: 'gray.900',
      css: {
        '& button': {
          minHeight: '52px',
          minWidth: '96px',
          fontSize: '17px',
          fontWeight: 700,
          borderRadius: '14px',
        },
      },
    },
    drawerContent: {
      bg: 'gray.900',
      maxWidth: '440px',
      height: isElectron ? 'calc(100vh - 30px)' : '100vh',
      borderLeft: '1px solid',
      borderColor: 'whiteAlpha.200',
    },
    drawerHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      position: 'relative',
      px: 6,
      py: 4,
    },
    drawerBody: {
      bg: 'gray.900',
      color: 'white',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      px: 6,
      pb: 4,
      css: {
        touchAction: 'pan-y',
      },
    },
    drawerTitle: {
      color: 'white',
      fontSize: '20px',
      fontWeight: 'semibold',
    },
    closeButton: {
      position: 'absolute',
      right: 1,
      top: 1,
      color: 'white',

    },
  },
  general: {
    container: {
      align: 'stretch',
      gap: 6,
      p: 4,
    },
    field: {
      label: {
        color: 'whiteAlpha.800',
        fontSize: '17px',
        fontWeight: '500',
      },
      width: '100%',
    },
    select: {
      root: {
        colorPalette: 'gray',
        bg: 'gray.800',
        width: '100%',
      },
      trigger: {
        bg: 'gray.800',
        width: '100%',
        minH: '46px',
        fontSize: '17px',
      },
    },
    input: {
      bg: 'gray.800',
      width: '100%',
      minH: '46px',
      fontSize: '17px',
    },
    buttonGroup: {
      gap: 4,
      width: '100%',
    },
    button: {
      width: '50%',
      variant: 'outline' as const,
      bg: 'blue',
      color: 'white',
      _hover: {
        bg: 'whiteAlpha.300',
      },
    },
    fieldLabel: {
      fontSize: '17px',
      color: 'gray.600',
    },
  },
  common: {
    field: {
      orientation: 'horizontal' as const,
    },
    fieldLabel: {
      fontSize: '17px',
      color: 'whiteAlpha.800',
      whiteSpace: 'nowrap' as const,
    },
    switch: {
      size: 'md' as const,
      colorPalette: 'blue' as const,
      variant: 'solid' as const,
    },
    numberInput: {
      root: {
        pattern: '[0-9]*\\.?[0-9]*',
        inputMode: 'decimal' as const,
        width: '100%',
      },
      input: {
        bg: 'whiteAlpha.100',
        borderColor: 'whiteAlpha.200',
        _hover: {
          bg: 'whiteAlpha.200',
        },
      },
    },
    container: {
      width: '100%',
      gap: 8,
      maxW: 'none',
      align: 'stretch',
      css: { '--field-label-width': '140px' },
    },
    sectionTitle: {
      fontSize: '18px',
      color: 'whiteAlpha.900',
      fontWeight: 'semibold',
      letterSpacing: '0.02em',
    },
    moduleCard: {
      width: '100%',
      p: 4,
      borderRadius: 'xl',
      borderWidth: '1px',
      borderColor: 'whiteAlpha.200',
      bg: 'linear-gradient(160deg, rgba(30,41,59,0.76), rgba(15,23,42,0.9))',
      boxShadow: '0 12px 28px rgba(2,6,23,0.28)',
    },
    accentCard: {
      width: '100%',
      p: 4,
      borderRadius: 'xl',
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderColor: 'blue.300',
      bg: 'linear-gradient(135deg, rgba(56,189,248,0.18), rgba(59,130,246,0.14))',
    },
    primaryActionButton: {
      w: '100%',
      size: 'md' as const,
      minH: '48px',
      borderRadius: 'xl',
      bg: 'linear-gradient(90deg, #0ea5e9 0%, #2563eb 55%, #1d4ed8 100%)',
      color: 'white',
      fontWeight: 'semibold',
      boxShadow: '0 10px 20px rgba(37,99,235,0.35)',
      transition: 'all 0.18s ease',
      _hover: {
        transform: 'translateY(-1px)',
        filter: 'brightness(1.06)',
      },
      _active: {
        transform: 'translateY(0)',
      },
      _disabled: {
        opacity: 0.72,
      },
    },
    input: {
      bg: 'whiteAlpha.100',
      borderColor: 'whiteAlpha.200',
      minH: '46px',
      fontSize: '17px',
      _hover: {
        bg: 'whiteAlpha.200',
      },
    },
  },
  live2d: {
    container: {
      width: '100%',
      gap: 8,
      maxW: 'none',
      align: 'stretch',
      css: { '--field-label-width': '140px' },
    },
    emotionMap: {
      title: {
        fontWeight: 'bold',
        mb: 4,
      },
      entry: {
        mb: 2,
      },
      button: {
        colorPalette: 'blue',
        mt: 2,
      },
      deleteButton: {
        colorPalette: 'red',
      },
    },
  },
};
