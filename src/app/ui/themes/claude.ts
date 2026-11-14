import type { Theme } from '../foundation/theme';

export const claude: Theme = {
  id: 'claude',
  name: '클로드',
  shapes: { header: 'bare', rail: 'icons', list: 'titles', composer: 'box', message: 'page', day: 'rule' },
  finish: { rows: 'open', faces: 'soft', lines: 'open', speakers: 'small', corners: 'round', dock: 'lifted' },
  letters: { font: 'serif', size: 16, leading: 'narrow', width: 'narrow' },
  tones: {
    dark: { page: '#262624', text: '#f5f4ee', accent: '#d97757', dialogue: '#e8a58c', sidebar: '#1f1e1d', rail: '#1a1918', surface: '#30302e', hover: '#363633', raised: '#3e3d3a', line: '#3a3936', muted: '#b3b0a7', faint: '#a6a39a', mark: '#e08a6e', onAccent: '#1a1915', bubble: '#141413' },
    light: { page: '#faf9f5', text: '#1a1915', accent: '#ba5837', dialogue: '#9c4a2e', sidebar: '#f5f4ed', rail: '#efede4', surface: '#ffffff', hover: '#f0eee6', line: '#e8e6dc', muted: '#5f5e59', faint: '#6b6a64', mark: '#a34c2d', onAccent: '#ffffff', bubble: '#f0eee6' },
  },
};
