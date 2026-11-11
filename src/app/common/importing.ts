import { createContext, useContext } from 'react';
import { PACKED_EXTENSION, UNPACKED_EXTENSIONS } from '../../engine/import/extensions';

// All features share library/ImportFlow. pickChats null means characterless; bring uses dropped-file handling
// and succeeds only for an imported character; drop forwards files the current screen did not accept; pickLink opens
// the link dialog holding text, a pasted link or ''.
type Importer = { pick: () => void; pickChats: (target: string | null) => void; pickPrompts: () => void; pickPersonas: () => void; pickLink: (text: string) => void; move: () => void; bring: (file: File) => Promise<boolean>; drop: (files: File[]) => void };

// What the import reads, by extension: the picker's accept, and what a chat's drop leaves to it.
const EXTENSIONS = [...UNPACKED_EXTENSIONS, PACKED_EXTENSION];
export const IMPORT_ACCEPT = EXTENSIONS.join(',');
export const imports = (name: string) => EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

export const ImportContext = createContext<Importer | null>(null);

export function useImport(): Importer {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}
