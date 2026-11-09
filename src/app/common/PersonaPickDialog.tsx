import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../ui';
import { PersonaGrid, usePersonaPlaces } from './PersonaGrid';

type Props = { title: string; using: string | null; pinned?: string; onChoose: (id: string) => void; onClose: () => void; footer?: ReactNode };

// Mounted only while open, so each opening starts with an empty search, in the folder of the persona in use.
export function PersonaPickDialog({ title, using, pinned, onChoose, onClose, footer }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const places = usePersonaPlaces({ ref: field, onEnter: ({ persona }) => onChoose(persona.id) });
  const [place, setPlace] = useState(() => (using === null ? null : (places.byId(using)?.value.folder ?? null)));
  return (
    <Dialog title={title} size="wide" onClose={onClose} toolbar={places.search.field || undefined} footer={footer}>
      <PersonaGrid places={places} place={place} onGo={setPlace} onOpen={({ id }) => onChoose(id)} current={using ?? undefined} tagOf={(id) => (id === pinned ? '고정' : undefined)} />
    </Dialog>
  );
}
