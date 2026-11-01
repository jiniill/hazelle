import { ExternalLink, Package } from 'lucide-react';
import { ToolSetting } from '../common/ToolSetting';
import { useTool } from '../session';
import { Button, Menu, Stack, ToolButton, useMenuClose } from '../ui';
import { pressRuns, toolIsOn, type ToolComposer } from './toolMenu';

type Props = { tool: ToolComposer; running: string | null; onRun: (module: string, item: string) => void; onStop: () => void; onOpen: (module: string) => void };

// A //@composer item of the chat's tools: its fields are the module's own, the same in every chat, as 삽화's are.
// running: the module whose input item runs now, whose button stops it.
export function ChatComposerTool({ tool, running, onRun, onStop, onOpen }: Props) {
  return running === tool.module
    ? <ToolButton icon={Package} label="멈추기" detail={tool.label} busy onClick={onStop} />
    : <ComposerTool tool={tool} onRun={(item) => onRun(tool.module, item)} onOpen={() => onOpen(tool.module)} />;
}

function ComposerTool({ tool, onRun, onOpen }: { tool: ToolComposer; onRun: (item: string) => void; onOpen: () => void }) {
  const settings = useTool(tool.module)?.value.settings ?? {};
  const on = toolIsOn(tool, settings);
  const close = useMenuClose();
  const runs = pressRuns(tool);
  if (runs) return <ToolButton icon={Package} label={tool.label} phone="icon" onClick={() => { close(); onRun(runs.id); }} />;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label={tool.name}
      trigger={(opener) => <ToolButton icon={Package} label={tool.label} phone="icon" detail={on ? '켜짐' : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Stack gap="related">
        {tool.inputs.map((item) => <InputItem key={item.id} label={item.label} onRun={() => onRun(item.id)} />)}
        {tool.fields.map((field) => <ToolSetting key={field.key} module={tool.module} field={field} value={settings[field.key]} />)}
        {tool.page && <Button variant="secondary" size="sm" icon={ExternalLink} onClick={onOpen}>열기</Button>}
      </Stack>
    </Menu>
  );
}

function InputItem({ label, onRun }: { label: string; onRun: () => void }) {
  const close = useMenuClose();
  return <Button variant="secondary" size="sm" onClick={() => { close(); onRun(); }}>{label}</Button>;
}
