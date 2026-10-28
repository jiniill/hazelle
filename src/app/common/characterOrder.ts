import { useMemo } from 'react';
import { indexFolders } from '../../model/folders';
import { arrange, arrangeFolders, ORDER_ID, placeBefore } from '../../model/order';
import { setOrder } from '../../runtime/characters';
import type { Library } from '../../runtime/read-model';
import { useLibrary, useStore, useStored } from '../session';
import { useToast } from '../toast';
import { usePersisted } from './usePersisted';

export type CharacterSort = 'recent' | 'own';
export const CHARACTER_SORTS = [{ value: 'recent', label: '최근 대화' }, { value: 'own', label: '사용자 지정' }] as const;

// 캐릭터 둘러보기 and the phone's character list never stand together, so one key serves both; the rail is always 직접.
export const useCharacterSort = () => usePersisted<CharacterSort>('risu-alpha:character-sort', (stored) => (stored === 'own' ? 'own' : 'recent'), 'recent', String);

export function useSortedLibrary(sort: CharacterSort): Library {
  const library = useLibrary();
  const order = useStored('order', ORDER_ID)?.value.ids;
  return useMemo(() => {
    if (sort === 'recent') return library;
    const characters = arrange(order ?? [], library.characters, ({ id }) => id, ({ character }) => character.card.name);
    return { ...library, characters, ...indexFolders(characters, arrangeFolders(order ?? [], library.folders), ({ character }) => character.folder) };
  }, [library, order, sort]);
}

// shown: the ids of one place's characters, or its folders, as they stand. A move made in 최근 대화 starts from what was
// shown there and turns the view to 직접 (user, 2026-10-19).
export function useReorder(setSort: (sort: CharacterSort) => void) {
  const store = useStore();
  const toast = useToast();
  return (shown: string[], id: string, before: string | null) => {
    const sequence = placeBefore(shown, id, before);
    if (sequence.every((each, index) => each === shown[index])) return;
    // Turned only once stored: before, 직접 would show the old order for a moment.
    void setOrder(store, sequence).then((saved) => (saved.ok ? setSort('own') : toast.failed(saved, '순서를 바꾸지 못했어요.')));
  };
}
