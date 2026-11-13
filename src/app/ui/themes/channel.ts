import type { Theme } from '../foundation/theme';

export const channel: Theme = {
  id: 'channel',
  name: '채널',
  shapes: { header: 'topic', rail: 'servers', list: 'channels', composer: 'bar', message: 'row' },
  finish: { rows: 'close', faces: 'round', lines: 'close' },
  letters: { font: 'sans', size: 15, leading: 'normal', width: 'widest' },
  tones: {
    dark: { page: '#313338', text: '#dbdee1', accent: '#5865f2', dialogue: '#ffffff', sidebar: '#2b2d31', rail: '#1e1f22', surface: '#383a40', hover: '#3c3e44', raised: '#404249', line: '#3f4147', muted: '#aeb4ba', faint: '#a3a9b0', name: '#f0b232', pointed: '#2e3035' },
    light: { page: '#ffffff', text: '#313338', accent: '#5865f2', dialogue: '#060607', sidebar: '#f2f3f5', rail: '#e3e5e8', surface: '#ebedef', hover: '#e6e8eb', raised: '#d7d9dc', line: '#e1e2e4', muted: '#5c5e66', faint: '#666870', name: '#a15c00', pointed: '#f4f4f5' },
  },
};
