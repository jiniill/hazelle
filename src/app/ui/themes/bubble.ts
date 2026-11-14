import type { Theme } from '../foundation/theme';

export const bubble: Theme = {
  id: 'bubble',
  name: '말풍선',
  shapes: { header: 'plain', rail: 'icons', list: 'people', composer: 'bar', message: 'bubble', day: 'pill' },
  finish: { rows: 'close', faces: 'soft', lines: 'close', speakers: 'medium', corners: 'soft' },
  letters: { font: 'sans', size: 15, leading: 'normal', width: 'full' },
  tones: {
    dark: { page: '#1f2023', text: '#f2f2f2', accent: '#fee500', dialogue: '#ffd86b', sidebar: '#1a1a1a', rail: '#141414', surface: '#2a2a2c', hover: '#303032', raised: '#3a3a3c', line: '#333333', muted: '#a6a6a6', faint: '#9a9a9a', name: '#d0d0d0', onAccent: '#191919', pointed: '#2a2a2c', bubble: '#3a3a3c', action: '#b0a9bc' },
    light: { page: '#ffffff', text: '#191919', accent: '#fee500', dialogue: '#7a4b00', rail: '#ececed', sidebar: '#ffffff', surface: '#ffffff', hover: '#f2f2f2', line: '#e5e5e5', muted: '#4a5966', faint: '#536370', name: '#2b3540', mark: '#7a4b00', onAccent: '#191919' },
  },
  room: {
    light: { mode: 'light', tone: { page: '#b2c7da', text: '#191919', accent: '#fee500', dialogue: '#6b4200', action: '#4c4753', surface: '#ffffff', hover: '#a9bfd3', muted: '#36424c', faint: '#3f4c58', name: '#2b3540', mark: '#6b4200', onAccent: '#191919', pointed: '#a9bfd3' } },
  },
};
