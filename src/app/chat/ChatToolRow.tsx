import type { LucideIcon } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { hideTool, setToolOrder } from '../../runtime/characters';
import { useSettings, useStore } from '../session';
import { CheckList, MenuBack, MoreMenu, Section, ToolEnd, useMenuClose } from '../ui';
import { inToolOrder } from './toolMenu';

// live: it acts in this chat. Hiding moves the button only, so ⋯ and its line carry a dot while a hidden one is live; 기능 is what stops a feature.
// running: its button is the only stop, so it stands on the row while hidden.
// open: what the panel shows for a hidden one, or what it does at once.
export type RowTool = { key: string; label: string; icon: LucideIcon; live: boolean; running?: boolean; node: ReactNode; open: ReactNode | (() => void); openLabel?: string };

// after: buttons of the row that are not tools to hide. ⋯ holds the row's far end: ticking a box must not move the panel under the pointer.
export function ChatToolRow({ tools: declared, after }: { tools: RowTool[]; after: ReactNode }) {
  const store = useStore();
  const { hiddenTools, toolOrder } = useSettings();
  const hidden = new Set(hiddenTools);
  const tools = inToolOrder(declared, toolOrder ?? []);
  return (
    <>
      {tools.filter((tool) => !hidden.has(tool.key) || tool.running).map((tool) => <Fragment key={tool.key}>{tool.node}</Fragment>)}
      {after}
      <ToolEnd>
        <MoreMenu of="입력창 도구" kind="dialog" size="form" place="above-end" dot={tools.some((tool) => hidden.has(tool.key) && tool.live)}>
          <Panel
            tools={tools}
            hidden={hidden}
            onHide={(key, hide) => void hideTool(store, key, hide)}
            onMove={(from, to) => {
              const keys = tools.map((tool) => tool.key);
              keys.splice(to, 0, keys.splice(from, 1)[0]!);
              void setToolOrder(store, keys);
            }}
          />
        </MoreMenu>
      </ToolEnd>
    </>
  );
}

function Panel({ tools, hidden, onHide, onMove }: { tools: RowTool[]; hidden: Set<string>; onHide: (key: string, hide: boolean) => void; onMove: (from: number, to: number) => void }) {
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
    </Section>
  );
}
