import { describe, expect, it } from 'vitest';
import { joinAudio } from './audio';

function wav(samples: number[], rate = 24000): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => bytes.set(Uint8Array.from(text, (char) => char.charCodeAt(0)), at);
  put(0, 'RIFF');
  view.setUint32(4, 36 + samples.length, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, samples.length, true);
  bytes.set(samples, 44);
  return bytes;
}

describe('joinAudio', () => {
  it('joins MP3 stretches end to end', () => {
    expect(joinAudio([{ bytes: new Uint8Array([1, 2]), type: 'audio/mpeg' }, { bytes: new Uint8Array([3]), type: 'audio/mpeg' }])).toEqual({ bytes: new Uint8Array([1, 2, 3]), type: 'audio/mpeg' });
  });

  it('joins MP3 stretches without their ID3 tags and the Info frames that count only their own frames', () => {
    const frame = (fill: number) => [0xff, 0xfb, 0x50, 0xc0, fill, fill];
    const stretch = (fill: number) => {
      const info = new Uint8Array(208);
      info.set(frame(0).slice(0, 4));
      info.set(Uint8Array.from('Info', (char) => char.charCodeAt(0)), 4 + 17);
      return new Uint8Array([...Uint8Array.from('ID3', (char) => char.charCodeAt(0)), 4, 0, 0, 0, 0, 0, 2, 7, 7, ...info, ...frame(fill)]);
    };
    expect(joinAudio([{ bytes: stretch(1), type: 'audio/mpeg' }, { bytes: stretch(2), type: 'audio/mpeg' }])).toEqual({ bytes: new Uint8Array([...frame(1), ...frame(2)]), type: 'audio/mpeg' });
  });

  it("joins WAV stretches' samples under one header", () => {
    expect(joinAudio([{ bytes: wav([1, 2]), type: 'audio/wav' }, { bytes: wav([3, 4]), type: 'audio/wav' }])).toEqual({ bytes: wav([1, 2, 3, 4]), type: 'audio/wav' });
  });

  it('joins nothing it cannot read as one sound', () => {
    expect(joinAudio([{ bytes: wav([1, 2]), type: 'audio/wav' }, { bytes: wav([3, 4], 16000), type: 'audio/wav' }])).toBeNull();
    expect(joinAudio([{ bytes: wav([1, 2]), type: 'audio/wav' }, { bytes: new Uint8Array([1]), type: 'audio/mpeg' }])).toBeNull();
    expect(joinAudio([{ bytes: new Uint8Array([1]), type: 'audio/ogg' }, { bytes: new Uint8Array([2]), type: 'audio/ogg' }])).toBeNull();
  });
});
