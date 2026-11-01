import { ExternalLink, Package } from 'lucide-react';
import { ToolSetting } from '../common/ToolSetting';
import { useTool } from '../session';
import { Button, Menu, Stack, ToolButton, useMenuClose } from '../ui';
import type { RowTool } from './ChatToolRow';
import { pressRuns, type ToolComposer } from './toolMenu';

type Props = { tool: ToolComposer; running: string | null; on: boolean; onRun: (module: string, item: string) => void; onStop: () => void; onOpen: (module: string) => void };

// A //@composer item of the chat's tools: its fields are the module's own, the same in every chat, as 삽화's are.
// running: the module whose input item runs now, whose button stops it.
export function composerTool(props: Props): RowTool {
  const { tool, running, on, onRun } = props;
  const runs = pressRuns(tool);
  return {
    key: tool.module,
    label: tool.name,
    icon: Package,
    live: on,
    running: running === tool.module,
    node: <ChatComposerTool {...props} />,
    open: runs ? () => onRun(tool.module, runs.id) : <ToolForm {...props} />,
    openLabel: runs ? '실행' : undefined,
  };
}

function ChatComposerTool(props: Props) {
  const { tool, running, on, onRun, onStop } = props;
  if (running === tool.module) return <ToolButton icon={Package} label="멈추기" detail={tool.label} busy onClick={onStop} />;
  const runs = pressRuns(tool);
  if (runs) return <ToolButton icon={Package} label={tool.label} phone="icon" onClick={() => onRun(tool.module, runs.id)} />;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label={tool.name}
      trigger={(opener) => <ToolButton icon={Package} label={tool.label} phone="icon" detail={on ? '켜짐' : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <ToolForm {...props} />
    </Menu>
  );
}

function ToolForm({ tool, onRun, onOpen }: Props) {
  const settings = useTool(tool.module)?.value.settings ?? {};
  return (
    <Stack gap="related">
      {tool.inputs.map((item) => <InputItem key={item.id} label={item.label} onRun={() => onRun(tool.module, item.id)} />)}
      {tool.fields.map((field) => <ToolSetting key={field.key} module={tool.module} field={field} value={settings[field.key]} />)}
      {tool.page && <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => onOpen(tool.module)}>열기</Button>}
    </Stack>
  );
}

function InputItem({ label, onRun }: { label: string; onRun: () => void }) {
  const close = useMenuClose();
  return <Button variant="secondary" size="sm" onClick={() => { close(); onRun(); }}>{label}</Button>;
}
