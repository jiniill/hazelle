import type { InputPicture } from '../connectors/types';
import { MAX_PICTURE_BYTES } from '../contracts/board';
import { fromBase64, toBase64 } from '../vault/aead';

const THUMB = 400;
// The longest side of a picture shown to a model: enough to read a character's looks, a few hundred tokens each.
const SHOWN = 768;

// A picture sent to a model at most: Anthropic's long side and area, past which it would shrink the picture itself, and
// bytes whose base64 stays within its 5 MB. OpenAI and Gemini read one this size whole; Gemini takes no GIF.
const SENT_SIDE = 1568;
const SENT_AREA = 1_150_000;
const SENT_BYTES = 3_750_000;
const SENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string };
const decoded = ({ bytes, type }: Picture) => createImageBitmap(new Blob([bytes], { type }));

// Safari cannot write WebP and hands back PNG, which is far larger, so it gets JPEG instead.
async function drawn(bitmap: ImageBitmap, scale: number): Promise<Blob> {
  // Rounded down, so a picture drawn within a bound stays within it when it is measured again (sentPicture).
  const canvas = new OffscreenCanvas(Math.max(1, Math.floor(bitmap.width * scale)), Math.max(1, Math.floor(bitmap.height * scale)));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  return blob.type === 'image/webp' ? blob : canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

async function shrink(picture: Picture, longest: number): Promise<Blob> {
  const bitmap = await decoded(picture);
  return drawn(bitmap, Math.min(1, longest / Math.max(bitmap.width, bitmap.height)));
}

// One within every codec's reach is kept byte for byte, so the same picture sent again reads the same to a provider's
// cache; any other is drawn again within it.
export async function sentPicture(picture: Picture): Promise<Picture> {
  const bitmap = await decoded(picture);
  const { width, height } = bitmap;
  const scale = Math.min(1, SENT_SIDE / Math.max(width, height), Math.sqrt(SENT_AREA / (width * height)));
  if (scale === 1 && SENT_TYPES.has(picture.type) && picture.bytes.length <= SENT_BYTES) {
    bitmap.close();
    return picture;
  }
  const blob = await drawn(bitmap, scale);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
}

// A phone's screenshot stays its own size. Always drawn again, so only its look leaves the device, never a photo's
// location or anything else in the file. null: not a picture, or too large even so.
const POSTED_SIDE = 2400;
export async function postedPicture(file: File): Promise<Picture | null> {
  try {
    const blob = await shrink({ bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }, POSTED_SIDE);
    return blob.size > MAX_PICTURE_BYTES ? null : { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  } catch {
    return null;
  }
}

export async function thumbnail(picture: Picture): Promise<string> {
  const blob = await shrink(picture, THUMB);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A thumbnail, which shrink writes as WebP or JPEG, redrawn as a PNG; none is a grey 256×256 square, as Risu's persona
// file holds then.
export async function pngOf(thumb: string | null): Promise<Uint8Array<ArrayBuffer>> {
  let canvas: OffscreenCanvas;
  if (thumb === null) {
    canvas = new OffscreenCanvas(256, 256);
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'grey';
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const type = thumb.slice('data:'.length, thumb.indexOf(';'));
    const bitmap = await createImageBitmap(new Blob([fromBase64(thumb.slice(thumb.indexOf(',') + 1))], { type }));
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

// type: what the canvas wrote, not the stored picture's.
export async function shownPicture(picture: Picture): Promise<InputPicture> {
  const blob = await shrink(picture, SHOWN);
  return { type: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}
