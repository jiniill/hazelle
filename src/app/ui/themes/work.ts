import type { Theme } from '../foundation/theme';

export const work: Theme = {
  id: 'work',
  name: '업무',
  shapes: { header: 'topic', rail: 'icons', list: 'channels', composer: 'toolbar', message: 'row' },
  finish: { rows: 'close', faces: 'soft', lines: 'close', speakers: 'medium', corners: 'tight' },
  letters: { font: 'sans', size: 15, leading: 'normal', width: 'full' },
  tones: {
    dark: { page: '#1a1d21', text: '#d1d2d3', accent: '#1d9bd1', dialogue: '#8fc8ea', sidebar: '#19171d', rail: '#121016', surface: '#222529', hover: '#26292d', raised: '#35373b', line: '#35373b', outline: '#565856', muted: '#9a9b9e', faint: '#8e9093', name: '#e8e8e8', pointed: '#222529', send: '#007a5a', onSend: '#ffffff' },
    light: { page: '#ffffff', text: '#1d1c1d', accent: '#1264a3', dialogue: '#0b4c8c', surface: '#ffffff', hover: '#f8f8f8', line: '#e6e6e6', outline: '#bcbcbc', muted: '#616061', faint: '#6c6b6c', name: '#1d1c1d', pointed: '#f8f8f8', send: '#007a5a', onSend: '#ffffff' },
  },
  side: {
    light: { mode: 'dark', tone: { page: '#3f0e40', text: '#f0e6f0', accent: '#1d9bd1', dialogue: '#f0e6f0', rail: '#350d36', surface: '#481849', hover: '#512052', raised: '#5a2a5b', line: '#5a2a5b', muted: '#c4afc4', faint: '#b9a2b9', mark: '#36c5f0' } },
  },
};
