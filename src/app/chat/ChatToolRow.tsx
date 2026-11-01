import { Fragment, useState, type ReactNode } from 'react';
import { hideTool } from '../../runtime/characters';
import { useSettings, useStore } from '../session';
import { Checkbox, Divider, MoreMenu, Section, ToolEnd, ToolShelf } from '../ui';

// live: the tool acts in this chat, so hiding it must not hide that. Hiding moves the button only; 기능 is what stops a feature.
export type RowTool = { key: string; label: string; live: boolean; node: ReactNode };

// after: buttons of the row that are not tools to hide. ⋯ holds the row's far end: ticking a box must not move the panel under the pointer.
export function ChatToolRow({ tools, after }: { tools: RowTool[]; after: ReactNode }) {
  const store = useStore();
  const hidden = new Set(useSettings().hiddenTools);
  // Once live a hidden tool keeps its button for the visit: turning it off from its own form would close that form.
  const stayed = useEverKeys(tools.filter((tool) => tool.live && hidden.has(tool.key)));
  const onRow = (tool: RowTool) => !hidden.has(tool.key) || tool.live || stayed.has(tool.key);
  return (
    <>
      {tools.filter(onRow).map((tool) => <Fragment key={tool.key}>{tool.node}</Fragment>)}
      {after}
      <ToolEnd>
        <MoreMenu of="입력창 도구" kind="dialog" place="above-end">
          <Shelf tools={tools} hidden={hidden} onRow={onRow} onHide={(key, hide) => void hideTool(store, key, hide)} />
        </MoreMenu>
      </ToolEnd>
    </>
  );
}

function useEverKeys(tools: RowTool[]): ReadonlySet<string> {
  const [ever, setEver] = useState<ReadonlySet<string>>(new Set());
  const fresh = tools.filter((tool) => !ever.has(tool.key));
  if (fresh.length) setEver(new Set([...ever, ...fresh.map((tool) => tool.key)]));
  return ever;
}

function Shelf({ tools, hidden, onRow, onHide }: { tools: RowTool[]; hidden: Set<string>; onRow: (tool: RowTool) => boolean; onHide: (key: string, hide: boolean) => void }) {
  // Once listed a tool stays until the panel closes: turning live from its form here must not remount that form on the row.
  const listed = useEverKeys(tools.filter((tool) => !onRow(tool)));
  const shelved = tools.filter((tool) => hidden.has(tool.key) && (!onRow(tool) || listed.has(tool.key)));
  return (
    <>
      <Section level={3} title="입력창에 둘 도구">
        <div>
          {tools.map((tool) => (
            <Checkbox
              key={tool.key}
              label={tool.label}
              note={hidden.has(tool.key) && tool.live ? '사용 중이라 보여요' : undefined}
              checked={!hidden.has(tool.key)}
              onChange={(shown) => onHide(tool.key, !shown)}
            />
          ))}
        </div>
      </Section>
      {/* Last, by the row: a form these open rises from here, over the list, with the room the row's own have. */}
      {shelved.length > 0 && (
        <>
          <Divider variant="menu" />
          <ToolShelf>{shelved.map((tool) => <Fragment key={tool.key}>{tool.node}</Fragment>)}</ToolShelf>
        </>
      )}
    </>
  );
}
