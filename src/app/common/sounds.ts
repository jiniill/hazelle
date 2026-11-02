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
export async function unlockSound(): Promise<AudioContext | null> {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') await context.resume();
    return context;
  } catch {
    // Sound is optional: a refused context must not fail the reply or translation that rang it.
    return null;
  }
}

export async function playSound(sound: Sound): Promise<boolean> {
  const audio = await unlockSound();
  if (!audio) return false;
  try {
    let buffer = decoded.get(sound);
    if (!buffer) {
      buffer = fetch(FILES[sound]).then((response) => response.arrayBuffer()).then((bytes) => audio.decodeAudioData(bytes));
      decoded.set(sound, buffer);
    }
    const data = await buffer;
    const source = audio.createBufferSource();
    source.buffer = data;
    source.connect(audio.destination);
    source.start();
    return true;
  } catch {
    // A fetch that failed is tried again on the next ring.
    decoded.delete(sound);
    // Automatic chimes may be missed; an explicit preview uses this result to tell the user.
    return false;
  }
}
