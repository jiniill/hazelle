import type { Stored } from '../../model/kinds';
import { framePage } from '../common/frame';
import { navigate, openPart } from '../shell/router';
import type { Back } from '../shell/routes';
import { EditorRoom } from '../ui';
import { PromptEditor, type PromptAt } from './PromptEditor';

export function PromptScreen({ stored, at, back }: { stored: Stored<'prompt'>; at: PromptAt; back: Back }) {
  return (
    <EditorRoom>
      {(layout) => (
        <PromptEditor
          stored={stored}
          layout={layout}
          at={at}
          // Drilled, only going into a block or out of one is a step back can undo; a tab, or the block beside this one,
          // takes the place of what was open.
          onAt={(next) => openPart({ kind: 'prompt', id: stored.id, ...next }, layout === 'split' || (next.block === undefined) === (at.block === undefined))}
          backLabel={back.label}
          onBack={() => navigate(back.to)}
          onOpen={(id) => navigate({ kind: 'prompt', id, pane: null })}
          onErased={() => navigate(back.to, { replace: true })}
          frame={framePage}
        />
      )}
    </EditorRoom>
  );
}
