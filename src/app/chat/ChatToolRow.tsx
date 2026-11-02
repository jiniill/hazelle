import type { LucideIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { hideTool, setToolOrder } from '../../runtime/characters';
import { useSettings, useStore } from '../session';
import { CheckList, MenuBack, MoreMenu, Section, useMenuClose } from '../ui';
import { inToolOrder } from './toolMenu';

// live: it acts in this chat. Hiding moves the button only, so ⋯ and its line carry a dot while a hidden one is live; 기능 is what stops a feature.
// running: its button is the only stop, so it stands on the row while hidden.
// open: what the panel shows for a hidden one, or what it does at once.
export type RowTool = { key: string; label: string; icon: LucideIcon; live: boolean; running?: boolean; node: ReactNode; open: ReactNode | (() => void); openLabel?: string };

function useRowTools(declared: RowTool[]) {
  const { hiddenTools, toolOrder } = useSettings();
  return { tools: inToolOrder(declared, toolOrder ?? []), hidden: new Set(hiddenTools) };
}

// after: buttons of the row that are not tools to hide.
export function ChatToolRow({ tools: declared, after }: { tools: RowTool[]; after: ReactNode }) {
  const { tools, hidden } = useRowTools(declared);
  return (
    <>
      {tools.filter((tool) => !hidden.has(tool.key) || tool.running).map((tool) => <Fragment key={tool.key}>{tool.node}</Fragment>)}
      {after}
    </>
  );
}

// Stands apart from the row, which wraps: ticking a box must not move the panel under the pointer.
// foot: what the list shows under its tools.
export function ChatToolMore({ tools: declared, foot }: { tools: RowTool[]; foot: ReactNode }) {
  const store = useStore();
  const { tools, hidden } = useRowTools(declared);
  return (
    <MoreMenu of="입력창 도구" kind="dialog" size="form" place="above-end" dot={tools.some((tool) => hidden.has(tool.key) && tool.live)}>
      <Panel
        tools={tools}
        hidden={hidden}
        foot={foot}
        onHide={(key, hide) => void hideTool(store, key, hide)}
        onMove={(from, to) => {
          const keys = tools.map((tool) => tool.key);
          keys.splice(to, 0, keys.splice(from, 1)[0]!);
          void setToolOrder(store, keys);
        }}
      />
    </MoreMenu>
  );
}

function Panel({ tools, hidden, foot, onHide, onMove }: { tools: RowTool[]; hidden: Set<string>; foot: ReactNode; onHide: (key: string, hide: boolean) => void; onMove: (from: number, to: number) => void }) {
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
