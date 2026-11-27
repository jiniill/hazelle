import type { CacheCandidate, CacheDiagnosis, CacheEdit, Forecast } from '../model/cache';
import type { Lore } from '../model/library';
import type { Prompt, Toggle, ToggleValues } from '../model/prompt';
import { TOGGLE_GLOBAL } from './cbs/tags';
import { parseDecorators } from './lorebook/decorators';
import { conversationBlocks, type PromptInput } from './pipeline';

// replaces: the decorators that set what line sets, dropped with their @@@ fallbacks so the entry reads one rule.
function withDecorator(content: string, line: string, replaces: readonly string[]): string {
  const { decorators, body } = parseDecorators(content);
  return [...decorators.filter(({ name }) => !replaces.includes(name)).flatMap(({ name, value, fallbacks }) => [
    `@@${name}${value ? ` ${value}` : ''}`,
    ...fallbacks.map(({ name, value }) => `@@@${name}${value ? ` ${value}` : ''}`),
  ]), line, body].join('\n');
}

// prompt: the stored prompt the blocks are, null when they are not one's. character: whose chats hold the toggle values,
// null for 캐릭터 없이's. held: those values as stored.
export type CacheOwners = { prompt: string | null; character: string | null; toggles: readonly Toggle[]; held: ToggleValues };

const held = (values: ToggleValues, key: string) => (Object.hasOwn(values, key) ? values[key]! : null);

export function cacheCandidates(diagnosis: CacheDiagnosis, forecast: Forecast, scope: PromptInput['scope'], { prompt, character, toggles, held: values }: CacheOwners): CacheCandidate[] {
  const candidates = new Map<string, CacheCandidate>();
  const blocks = conversationBlocks(scope);
  const chat = blocks.findLastIndex((block) => block.kind === 'slot' && block.slot === 'chat');
  const lastPoint = forecast.parts.findLastIndex(({ point }) => point === 'cache');
  const post = blocks.findIndex((block) => block.kind === 'slot' && block.slot === 'postEverything');
  const firstChat = blocks.findIndex((block) => block.kind === 'slot' && block.slot === 'chat');
  for (const part of diagnosis.parts) {
    const { from, role } = part;
    const add = (candidate: Omit<CacheCandidate, 'from' | 'role'>) => candidates.set(JSON.stringify(candidate.edit), { ...candidate, from, role });
    const block = from.kind === 'block' ? blocks.find(({ id }) => id === from.id) : undefined;
    for (const cause of part.causes) {
      if (cause.kind === 'tag' && prompt && block?.kind === 'text' && part.after !== null && part.after <= lastPoint && chat !== -1) {
        const rest = blocks.filter(({ id }) => id !== block.id);
        const afterChat = rest.findLastIndex((block) => block.kind === 'slot' && block.slot === 'chat') + 1;
        const after = rest.toSpliced(afterChat, 0, block);
        if (after.some((block, at) => block !== blocks[at])) add({ cause: 'tag', action: 'after-chat', edit: { kind: 'prompt', id: prompt, block: block.id, field: 'blocks', before: blocks, after } });
      }
      // A block between or after the chat's messages lands one message later each turn. Before the chat it stays; a
      // toggle its text reads may be what placed it there, and only pricing tells (each value is tried).
      if (cause.kind === 'moved' && block && blocks.indexOf(block) > firstChat && firstChat !== -1) {
        if (prompt) {
          const rest = blocks.filter(({ id }) => id !== block.id);
          add({ cause: 'moved', action: 'before-chat', edit: { kind: 'prompt', id: prompt, block: block.id, field: 'blocks', before: blocks, after: rest.toSpliced(firstChat, 0, block) } });
        }
        const source = block.kind === 'text' ? block.text : 'wrapper' in block ? (block.wrapper ?? '') : '';
        for (const toggle of toggles) {
          if (toggle.kind === 'text' || !source.includes(TOGGLE_GLOBAL + toggle.key)) continue;
          const options = toggle.kind === 'check' ? [null, null] : toggle.options;
          options.forEach((says, at) => {
            if (String(at) !== scope.toggles.get(toggle.key)) add({ cause: 'moved', action: 'toggle', edit: { kind: 'toggle', character, key: toggle.key, name: toggle.label, says, before: held(values, toggle.key), after: String(at) } });
          });
        }
      }
      if (cause.kind === 'lore') {
        const entry = scope.lore.find(({ id }) => id === cause.id);
        if (!entry) continue;
        if (!entry.value.constant) add({ cause: 'lore', action: 'constant', edit: { kind: 'lore', id: entry.id, name: entry.value.name, field: 'constant', before: false, after: true } });
        // @@depth 0 follows postEverything when present; that slot need not be after the chat.
        if (chat !== -1 && (post === -1 || post > chat)) add({ cause: 'lore', action: 'after-chat', edit: { kind: 'lore', id: entry.id, name: entry.value.name, field: 'content', before: entry.value.content, after: withDecorator(entry.value.content, '@@depth 0', ['depth', 'reverse_depth', 'end', 'position']) } });
      }
    }
  }
  return [...candidates.values()];
}

export function cacheEditedPrompt<T extends Prompt>(prompt: T, edit: Extract<CacheEdit, { kind: 'prompt' }>): T | null {
  if (prompt.deleted !== undefined || prompt.purging) return null;
  return JSON.stringify(prompt.blocks) === JSON.stringify(edit.before) ? { ...prompt, blocks: edit.after } : null;
}

export function cacheEditedLore<T extends Omit<Lore, 'folder'>>(entry: T, edit: Extract<CacheEdit, { kind: 'lore' }>): T | null {
  return entry[edit.field] === edit.before ? { ...entry, [edit.field]: edit.after } : null;
}

export function cacheToggled<T extends { toggles?: ToggleValues }>(holder: T, edit: Extract<CacheEdit, { kind: 'toggle' }>): T | null {
  if (held(holder.toggles ?? {}, edit.key) !== edit.before) return null;
  const rest = Object.fromEntries(Object.entries(holder.toggles ?? {}).filter(([key]) => key !== edit.key));
  return { ...holder, toggles: edit.after === null ? rest : { ...rest, [edit.key]: edit.after } };
}

export function cacheOverlay(scope: PromptInput['scope'], edit: CacheEdit): PromptInput['scope'] | null {
  if (edit.kind === 'toggle') return edit.after === null ? null : { ...scope, toggles: new Map([...scope.toggles, [edit.key, edit.after]]) };
  if (edit.kind === 'prompt') {
    const prompt = scope.prompt && cacheEditedPrompt(scope.prompt, edit);
    return prompt && { ...scope, prompt };
  }
  const entry = scope.lore.find(({ id }) => id === edit.id);
  const value = entry && cacheEditedLore(entry.value, edit);
  return value ? { ...scope, lore: scope.lore.map((each) => each === entry ? { ...each, value } : each) } : null;
}
