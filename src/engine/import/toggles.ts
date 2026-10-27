import type { ToggleLine } from '../../model/prompt';
import { args } from '../lorebook/decorators';

// Risu syntax: key=label=kind=option; choices store indices. Read layout kinds before validating their empty keys.
// Preserve unknown lines verbatim, never guess. Used only at import, stored-text upgrade or explicit line repair.
export function readToggles(text: string): ToggleLine[] {
  const lines: ToggleLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, label = '', kind, ...rest] = line.split('=').map((part) => part.trim());
    const options = kind === 'select' && rest.length === 1 ? args(rest[0]!) : [];
    if (kind === 'group' || kind === 'divider') lines.push({ kind, label });
    // Risu ignores a lowercase groupend, so its group runs on; it is read as the end its writer meant.
    else if (kind === 'groupEnd' || kind === 'groupend') lines.push({ kind: 'groupEnd' });
    else if (kind === 'caption' && label) lines.push({ kind, label });
    else if (!key || !label) lines.push({ kind: 'unread', text: line });
    else if (kind === undefined || (kind === 'check' && rest.length === 0)) lines.push({ key, label, kind: 'check', default: '0' });
    else if (options.length) lines.push({ key, label, kind: 'choice', options, default: '0' });
    else if (kind === 'text') lines.push({ key, label, kind: 'text', default: '' });
    else if (kind === 'textarea') lines.push({ key, label, kind: 'text', lines: true, default: '' });
    else lines.push({ kind: 'unread', text: line });
  }
  return lines;
}

// The inverse of readToggles for every line it reads, so the two change together. Risu's text holds no default, so a
// default set here does not go out.
export function writeToggles(lines: readonly ToggleLine[]): string {
  return lines
    .map((line) => {
      switch (line.kind) {
        case 'check':
          return `${line.key}=${line.label}`;
        case 'choice':
          return `${line.key}=${line.label}=select=${line.options.join(',')}`;
        case 'text':
          return `${line.key}=${line.label}=${line.lines ? 'textarea' : 'text'}`;
        case 'groupEnd':
          return '==groupEnd';
        case 'unread':
          return line.text;
        default:
          return `=${line.label}=${line.kind}`;
      }
    })
    .join('\n');
}
