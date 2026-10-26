import ding from './chimes/ding.wav';
import dingdong from './chimes/dingdong.wav';
import tap from './chimes/tap.wav';

export type Sound = 'ding' | 'dingdong' | 'tap';
export type Chime = Sound | 'off';

export const CHIMES: Record<Chime, string> = { off: '끄기', ding: '띵', dingdong: '딩동', tap: '톡' };

// WAV, which every browser decodes. ding was made here; dingdong (confirmation_001) and tap (drop_003) are Kenney's
// Interface Sounds, CC0. The page's CSP allows media only from blob:, so they are fetched and decoded, never <audio>.
const FILES: Record<Sound, string> = { ding, dingdong, tap };

let context: AudioContext | null = null;
const decoded = new Map<Sound, Promise<AudioBuffer>>();

// A phone plays only from a context resumed inside a tap or key press; a desktop browser, once the page was touched.
export function unlockSound() {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

export async function playSound(sound: Sound) {
  const audio = unlockSound();
  let buffer = decoded.get(sound);
  if (!buffer) {
    buffer = fetch(FILES[sound]).then((response) => response.arrayBuffer()).then((bytes) => audio.decodeAudioData(bytes));
    // A fetch that failed is tried again on the next ring.
    buffer.catch(() => decoded.delete(sound));
    decoded.set(sound, buffer);
  }
  const source = audio.createBufferSource();
  source.buffer = await buffer;
  source.connect(audio.destination);
  source.start();
}
