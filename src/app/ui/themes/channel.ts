import type { Theme } from '../foundation/theme';

export const channel: Theme = {
  id: 'channel',
  name: '채널',
  shapes: { header: 'topic', rail: 'servers', list: 'channels', composer: 'bar', message: 'row' },
  tones: {
    dark: { page: '#2f3136', text: '#dcdee1', accent: '#959cf7', dialogue: '#ffffff', sidebar: '#282a2e', rail: '#1f2023', surface: '#35373c', hover: '#3a3c42', raised: '#42444b', line: '#42444b', muted: '#b3b8c0', faint: '#a2a7af' },
    light: { page: '#ffffff', text: '#2f3136', accent: '#4752c4', dialogue: '#060607', sidebar: '#f2f3f5', rail: '#e3e5e8', line: '#e1e2e4', muted: '#5c5e66', faint: '#6a6d75' },
  },
};
