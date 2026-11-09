import { PRESET_EXTENSIONS } from './preset';

// What the import reads as itself; a zip is opened first, and a zip inside it is not opened.
export const UNPACKED_EXTENSIONS = [...new Set(['.png', '.charx', '.jpg', '.jpeg', '.json', '.lorebook', '.risum', '.bin', '.js', '.html', ...PRESET_EXTENSIONS])];
export const PACKED_EXTENSION = '.zip';
