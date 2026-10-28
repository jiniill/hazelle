import type { CacheCandidate, CacheDiagnosis, CacheEdit, Forecast } from '../model/cache';
import type { Lore } from '../model/library';
import type { Prompt } from '../model/prompt';
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

export function cacheCandidates(diagnosis: CacheDiagnosis, forecast: Forecast, scope: PromptInput['scope'], prompt: string | null): CacheCandidate[] {
  const candidates = new Map<string, CacheCandidate>();
  const blocks = conversationBlocks(scope);
  const chat = blocks.findLastIndex((block) => block.kind === 'slot' && block.slot === 'chat');
  const lastPoint = forecast.parts.findLastIndex(({ point }) => point === 'cache');
  const post = blocks.findIndex((block) => block.kind === 'slot' && block.slot === 'postEverything');
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

export function cacheOverlay(scope: PromptInput['scope'], edit: CacheEdit): PromptInput['scope'] | null {
  if (edit.kind === 'prompt') {
    const prompt = scope.prompt && cacheEditedPrompt(scope.prompt, edit);
    return prompt && { ...scope, prompt };
  }
  const entry = scope.lore.find(({ id }) => id === edit.id);
  const value = entry && cacheEditedLore(entry.value, edit);
  return value ? { ...scope, lore: scope.lore.map((each) => each === entry ? { ...each, value } : each) } : null;
}
