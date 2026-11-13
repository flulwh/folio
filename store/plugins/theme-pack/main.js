const THEMES = [
  {
    id: 'amber',
    label: '琥珀',
    tone: 'light',
    tokens: {
      bg: '#fbf3e6',
      bgElevated: '#fffaf0',
      bgSunken: '#f3e7d2',
      bgHover: 'rgba(140, 96, 40, 0.1)',
      text: '#2a1f12',
      textSoft: 'rgba(64, 46, 26, 0.62)',
      textFaint: 'rgba(64, 46, 26, 0.34)',
      line: 'rgba(110, 80, 42, 0.24)',
      accent: '#c2681a',
      accentSoft: 'rgba(194, 104, 26, 0.14)',
      accentContrast: '#fffaf0',
      sheetBg: 'rgba(255, 250, 240, 0.88)',
      toolbarBg: 'rgba(251, 243, 230, 0.84)',
    },
  },
  {
    id: 'ink',
    label: '墨绿',
    tone: 'dark',
    tokens: {
      bg: '#0c1210',
      bgElevated: '#151d1a',
      bgSunken: '#070b0a',
      bgHover: 'rgba(190, 255, 226, 0.08)',
      text: '#e6f2ec',
      textSoft: 'rgba(214, 235, 226, 0.6)',
      textFaint: 'rgba(214, 235, 226, 0.3)',
      line: 'rgba(190, 255, 226, 0.18)',
      accent: '#3ddc97',
      accentSoft: 'rgba(61, 220, 151, 0.16)',
      accentContrast: '#07110c',
      sheetBg: 'rgba(21, 29, 26, 0.88)',
      toolbarBg: 'rgba(12, 18, 16, 0.82)',
    },
  },
];

module.exports.activate = (folio) => {
  for (const theme of THEMES) folio.themes.register(theme);
};
