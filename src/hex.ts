export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const sha256Hex = async (data: Uint8Array<ArrayBuffer> | string) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)));

// A UUID-shaped id from the first 16 bytes of the text's SHA-256; ids are stored, so its digits never change.
export async function sha256Id(text: string): Promise<string> {
  const digits = (await sha256Hex(text)).slice(0, 32);
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
}
