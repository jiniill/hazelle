import type { LucideIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { hideTool, setToolOrder } from '../../runtime/library/characters';
import { useSettings, useStore } from '../session';
import { IN_USE } from '../common/words';
import { CheckList, ComposerTools, MenuBack, NavRow, Section, useMenuClose, useToolRow } from '../ui';
import { behindMenu, inToolOrder, standing } from './toolMenu';

// live: it acts in this chat. Hiding moves the button only, so the menu and its line mark a hidden one that is live; 기능 is what stops a feature.
// running: its button is the only stop, so it stands by the field while hidden.
// open: what the panel shows for a hidden one, or what it does at once.
export type RowTool = { key: string; label: string; icon: LucideIcon; live: boolean; running?: boolean; node: ReactNode; open: ReactNode | (() => void); openLabel?: string };

// row: the composer stands its tools in a row.
function useRowTools(declared: RowTool[]) {
  const { hiddenTools, toolOrder } = useSettings();
  const row = useToolRow();
  const tools = inToolOrder(declared, toolOrder ?? []);
  return { tools, row, hidden: behindMenu(tools, hiddenTools ?? [], row) };
}

// after: buttons by the field that are not tools to hide, which stand with or without a row.
export function ChatToolRow({ tools: declared, after }: { tools: RowTool[]; after: ReactNode }) {
  const { tools, hidden } = useRowTools(declared);
  return (
    <>
      {standing(tools, hidden).map((tool) => <Fragment key={tool.key}>{tool.node}</Fragment>)}
      {after}
    </>
  );
}

// Stands apart from the row, which wraps: ticking a box must not move the panel under the pointer.
// foot: what the list shows under its tools.
export function ChatToolMore({ tools: declared, foot }: { tools: RowTool[]; foot: ReactNode }) {
  const store = useStore();
  const { tools, row, hidden } = useRowTools(declared);
  return (
    <ComposerTools dot={tools.some((tool) => hidden.has(tool.key) && tool.live)}>
      <Panel
        tools={tools}
        row={row}
        hidden={hidden}
        foot={foot}
        onHide={(key, hide) => void hideTool(store, key, hide)}
        onMove={(from, to) => {
          const keys = tools.map((tool) => tool.key);
          keys.splice(to, 0, keys.splice(from, 1)[0]!);
          void setToolOrder(store, keys);
        }}
      />
    </ComposerTools>
  );
}

function Panel({ tools, row, hidden, foot, onHide, onMove }: { tools: RowTool[]; row: boolean; hidden: ReadonlySet<string>; foot: ReactNode; onHide: (key: string, hide: boolean) => void; onMove: (from: number, to: number) => void }) {
  const close = useMenuClose();
  const [viewing, setViewing] = useState<string | null>(null);
  const view = tools.find((tool) => tool.key === viewing);
  if (view) {
    return (
      <>
        <MenuBack label="도구" onClick={() => setViewing(null)} />
        {view.open as ReactNode}
      </>
    );
  }
  const openOf = ({ key, open }: RowTool) => () => {
    if (typeof open !== 'function') return setViewing(key);
    close();
    open();
  };
  if (!row) {
    return (
      <>
        {tools.map((tool) => <NavRow key={tool.key} icon={tool.icon} label={tool.label} note={tool.live ? IN_USE : undefined} onClick={openOf(tool)} />)}
        {foot}
      </>
    );
  }
  return (
    <Section level={3} title="입력창에 둘 도구">
      <CheckList
        items={tools.map((tool) => {
          const off = hidden.has(tool.key);
          return { id: tool.key, label: tool.label, icon: tool.icon, dot: off && tool.live, checked: !off, action: off ? { label: tool.openLabel ?? '열기', onClick: openOf(tool) } : undefined };
        })}
        onCheck={(key, shown) => onHide(key, !shown)}
        onMove={onMove}
      />
      {foot}
    </Section>
  );
}
