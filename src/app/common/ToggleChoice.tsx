import type { Toggle } from '../../model/prompt';
import { ChoiceGroup, Switch } from '../ui';

type Props = { label: string; options: readonly string[]; value: string; onChange: (value: string) => void };

// Use a menu beside the name even for few choices: strips wrap names and fields below look like the next toggle
// (user, 2026-10-15). Values remain option indices like Risu select.
export function ToggleChoice({ label, options, value, onChange }: Props) {
  return <ChoiceGroup label={label} layout="menu" options={options.map((option, index) => ({ value: String(index), label: option }))} value={value} onChange={onChange} />;
}

export type FlippedToggle = Exclude<Toggle, { kind: 'text' }>;

export function ToggleFlip({ toggle, value, onFlip }: { toggle: FlippedToggle; value: string; onFlip: (key: string, value: string) => void }) {
  return toggle.kind === 'check'
    ? <Switch label={toggle.label} checked={value === '1'} onChange={(on) => onFlip(toggle.key, on ? '1' : '0')} />
    : <ToggleChoice label={toggle.label} options={toggle.options} value={value} onChange={(next) => onFlip(toggle.key, next)} />;
}
