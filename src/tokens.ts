export const TOKENS = {
  colors: {
    ink950: '#070A1A',
    navy900: '#0D1330',
    navy800: '#16224A',
    navy700: '#233B6E',
    navy600: '#34528F',
    steel500: '#5B78B8',
    periwinkle300: '#A3C1FF',
    periwinkle200: '#C6D8FF',
    mist50: '#EEF3FF',
    success: '#4ADE9B',
    warning: '#FFC46B',
    danger: '#FF6B7D',
    violet: '#B79CFF',
    peach: '#FFB26B',
  },
  fonts: {
    sans: '"Poppins", "Noto Sans Bengali", system-ui, sans-serif',
    bengali: '"Noto Sans Bengali", "Poppins", system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
  },
  motion: {
    microMs: 120,
    uiMs: 240,
    panelMs: 480,
    stageStepMs: 700,
    spring: {
      type: 'spring' as const,
      stiffness: 260,
      damping: 24,
    },
  },
} as const;
