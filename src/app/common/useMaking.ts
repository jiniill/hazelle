import type { Removable } from '../../model/library';
import type { ApiResult } from '../../runtime/api';
import { useToast } from '../toast';
import { COPY_SAID, copyName, makeFailed } from './words';

// A new thing or a copy, under an id made here so its page opens before the write is answered. A copy is of what the
// open editor holds: its edits are stored first, and its name read after.
export function useMaking() {
  const toast = useToast();
  return {
    create(kind: Removable, make: (id: string) => Promise<ApiResult<unknown>>, open: (id: string) => void) {
      const id = crypto.randomUUID();
      toast.settled(make(id), makeFailed(kind));
      open(id);
    },
    async copy({ flush, name, make, open }: { flush: () => Promise<boolean>; name: () => string; make: (name: string, id: string) => Promise<ApiResult<unknown>>; open: (id: string) => void }) {
      if (!(await flush())) return;
      const id = crypto.randomUUID();
      const copying = make(copyName(name()), id);
      open(id);
      const copied = await copying;
      if (!copied.ok) return toast.failed(copied, COPY_SAID.failed);
      toast.show(COPY_SAID.made);
    },
  };
}
