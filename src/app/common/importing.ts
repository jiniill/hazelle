import { createContext, useContext } from 'react';
import { PRESET_EXTENSIONS } from '../../engine/import/preset';

// The app's one import, provided by library/ImportFlow, so any feature can open it. pickChats: the character a file of
// chats goes to, null for 캐릭터 없이. bring: a file the app made, a share link's charx, taken as a dropped one; true once
// a character came of it. drop: files a screen's own drop does not take, as the app's drop takes them.
type Importer = { pick: () => void; pickChats: (target: string | null) => void; pickPrompts: () => void; pickPersonas: () => void; move: () => void; bring: (file: File) => Promise<boolean>; drop: (files: File[]) => void };

// What the import reads, by extension: the picker's accept, and what a chat's drop leaves to it.
const EXTENSIONS = ['.png', '.charx', '.jpg', '.jpeg', '.json', '.lorebook', '.risum', '.bin', '.js', ...PRESET_EXTENSIONS];
export const IMPORT_ACCEPT = EXTENSIONS.join(',');
export const imports = (name: string) => EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

export const ImportContext = createContext<Importer | null>(null);

export function useImport(): Importer {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}
