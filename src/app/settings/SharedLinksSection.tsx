import { useState } from 'react';
import { live } from '../../model/library';
import { cutShare, readShares } from '../../runtime/export/share-link';
import { ago } from '../common/time';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { ACCOUNT_ONLY, SHARE, UNKNOWN } from '../common/words';
import { useAccount, useShares, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Empty, List, ListItem, Panel } from '../ui';

// A link lives on the server, which holds nothing of a guest's (design §6.14).
export function SharedLinksSection() {
  const { guest } = useAccount();
  if (!guest) return <SharedLinks />;
  return (
    <Panel title={SHARE.list}>
      <Empty variant="section">{`${SHARE.act}는 ${ACCOUNT_ONLY}.`}</Empty>
    </Panel>
  );
}

// A link no character here names, its character purged, is listed by what the server knows.
function SharedLinks() {
  const store = useStore();
  const toast = useToast();
  const own = useShares();
  const loaded = useLoaded(readShares);
  const [cutting, setCutting] = useState<string | null>(null);

  async function cut(id: string) {
    setCutting(id);
    const done = await cutShare(store, id);
    setCutting(null);
    if (!done.ok) return toast.failed(done, '링크를 끊지 못했어요.');
    toast.show('링크를 끊었어요.');
    loaded.reload();
  }

  const nameOf = (id: string) => {
    const parent = own.find(({ value }) => value.share === id)?.parent;
    return (parent && live(store.get('character', parent))?.value.card.name) ?? UNKNOWN;
  };
  const links = loaded.data?.shares;
  return (
    <Panel title={SHARE.list}>
      {loaded.loading}
      {loaded.failure}
      {links && links.length === 0 && <Empty variant="section">{SHARE.list}가 없어요.</Empty>}
      {links && links.length > 0 && (
        <List label={SHARE.list} box>
          {links.map((link) => (
            <ListItem
              key={link.id}
              title={nameOf(link.id)}
              tags={link.removed ? [SHARE.removed] : link.held ? [SHARE.held] : []}
              description={`${SHARE.received} ${count(link.received)} · ${ago(link.createdAt)} 만듦`}
              control={
                <Button variant="secondary" size="sm" busy={cutting === link.id} disabled={cutting !== null} onClick={() => void cut(link.id)}>
                  {SHARE.cut}
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Panel>
  );
}
