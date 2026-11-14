import type { Theme } from '../foundation/theme';

export const claude: Theme = {
  id: 'claude',
  name: '클로드',
  mode: 'light',
  shapes: { header: 'bare', rail: 'icons', list: 'titles', composer: 'tray', message: 'page', day: 'rule' },
  finish: { rows: 'open', faces: 'soft', lines: 'open', speakers: 'small', corners: 'round', dock: 'lifted' },
  letters: { font: 'serif', size: 16, leading: 'narrow', width: 'normal' },
  tones: {
    dark: { page: '#262624', text: '#f5f4ee', accent: '#d97757', dialogue: '#e8a58c', sidebar: '#1f1e1d', rail: '#1a1918', surface: '#30302e', hover: '#363633', raised: '#3e3d3a', line: '#3a3936', muted: '#b3b0a7', faint: '#a6a39a', mark: '#e08a6e', onAccent: '#1a1915', bubble: '#141413' },
    light: { page: '#ffffff', text: '#181818', accent: '#ba5837', dialogue: '#9c4a2e', sidebar: '#fafafa', rail: '#fafafa', surface: '#ffffff', hover: '#f2f2f2', line: '#e5e5e5', muted: '#5f5f5f', faint: '#6b6b6b', mark: '#a34c2d', onAccent: '#ffffff', bubble: '#f2f2f2', current: '#e1e1e1' },
  },
};
