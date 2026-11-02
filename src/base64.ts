// Chunked: one spread of a whole picture or PDF overflows the call stack.
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

// Throws on text atob refuses. Keep atob validation; per-character callbacks cost more than decryption across a full
// account.
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let at = 0; at < decoded.length; at++) bytes[at] = decoded.charCodeAt(at);
  return bytes;
}
