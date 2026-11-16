// The extension Risu's and CCv3's asset lists name a type by; png for a type they have no name for.
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
export const extensionOf = (type: string) => EXTENSIONS[type] ?? 'png';

// One of a Risu character's additionalAssets.
export const risuAsset = (name: string, path: string, type: string): [string, string, string] => [name, path, extensionOf(type)];
