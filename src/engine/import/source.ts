// Backups/.risum may exceed memory: slice reads only, never whole-file arrayBuffer.
// Leave picture bytes in the file until their owning item is imported.
export type FileSource = { size: number; read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> };

export const fileSource = (file: File): FileSource => ({
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
});
