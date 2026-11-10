import { useMemo } from 'react';
import { cbsLanguage } from '../common/code/cbs';
import { useTrial } from '../common/code/Trial';
import { SLOT } from '../common/prompt-words';
import type { Block } from '../../model/prompt';
import { Icon, List, ListItem, MarkupText } from '../ui';
import { blockIcon, blockMeta, blockTitle, CACHE_WORDS, MARKS, type CacheMark } from './blocks';

type Props = {
  blocks: readonly Block[];
  marks: ReadonlyMap<string, CacheMark>;
  onOpen: (id: string) => void;
};

// The whole prompt in the order it is sent, each text whole, to be read through; a block opens to be edited.
export function PromptRead({ blocks, marks, onOpen }: Props) {
  const trial = useTrial(null);
  const cbs = useMemo(() => cbsLanguage({ variables: trial.variables }), [trial.variables]);
  return (
    <List label="전체 읽기" places>
      {blocks.map((block, index) => {
        const cache = marks.get(block.id);
        return (
          <ListItem
            key={block.id}
            leading={<Icon icon={blockIcon(block)} />}
            title={`${index + 1}. ${blockTitle(block).title}`}
            badge={block.kind === 'text' && block.mark ? MARKS[block.mark].label : undefined}
            tags={cache ? [CACHE_WORDS[cache]] : []}
            description={block.kind === 'slot' ? SLOT[block.slot].line : undefined}
            note={blockMeta(block)}
            detail={block.kind === 'text' && block.text !== '' && <MarkupText text={block.text} language={cbs} />}
            onClick={() => onOpen(block.id)}
          />
        );
      })}
    </List>
  );
}
