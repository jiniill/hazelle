import { useEffect, useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import { describeMascotFailure } from '../common/failure';
import { useChildren, useCommenting } from '../session';
import { useToast } from '../toast';

// Toast once per chat/session: repeated garnish failures must not cover the composer on every turn.
const told = new Set<string>();
// Fresh (design §6.11: the mark sways until opened once): written after this page loaded and not opened since.
// Page memory only, so a reload counts every line as seen.
const loaded = Date.now();
const seen = new Set<string>();

// A version's line, the newest when a replaced one still shows before its removal syncs.
function remarksByVersion(remarks: Stored<'remark'>[]): ReadonlyMap<string, Stored<'remark'>> {
  const versions = new Map<string, Stored<'remark'>>();
  for (const remark of remarks) {
    const held = versions.get(remark.value.version);
    if (!held || held.value.at < remark.value.at) versions.set(remark.value.version, remark);
  }
  return versions;
}

export function useChatRemarks(chatId: string, id: string | null) {
  const toast = useToast();
  const stored = useChildren('remark', id);
  const remarks = useMemo(() => remarksByVersion(stored), [stored]);
  const commenting = useCommenting();
  const [, setSeen] = useState(0);

  useEffect(() => {
    for (const entry of commenting.values()) {
      if (entry.chat !== chatId || !entry.failure || told.has(chatId)) continue;
      told.add(chatId);
      toast.error(describeMascotFailure(entry.failure));
    }
  }, [commenting]);

  return {
    remarks,
    fresh: (remark: Stored<'remark'>) => remark.value.at > loaded && !seen.has(remark.id),
    actions: {
      seeRemark: (remark: string) => {
        seen.add(remark);
        setSeen((count) => count + 1);
      },
    },
  };
}
