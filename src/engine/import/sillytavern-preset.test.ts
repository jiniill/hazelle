import { expect, it } from 'vitest';
import { presetJson } from './preset';

const prompt = (identifier: string, over: object = {}) => ({ identifier, name: identifier, system_prompt: false, role: 'system', content: `${identifier} 내용`, ...over });
const marker = (identifier: string) => ({ identifier, name: identifier, system_prompt: true, marker: true });
const on = (...identifiers: string[]) => identifiers.map((identifier) => ({ identifier, enabled: true }));

const preset = {
  temperature: 1,
  openai_max_context: 100000,
  new_chat_prompt: '[Start a new Chat]',
  new_example_chat_prompt: '[Example Chat]',
  assistant_prefill: '나:',
  extensions: { regex_scripts: [{ scriptName: 'x' }] },
  prompts: [
    prompt('main', { system_prompt: true, content: '{{char}}로 답해요. {{trim}}' }),
    prompt('jailbreak', { system_prompt: true, content: '', forbid_overrides: true }),
    prompt('nsfw', { system_prompt: true, content: '' }),
    marker('worldInfoBefore'), marker('worldInfoAfter'), marker('charDescription'), marker('charPersonality'), marker('scenario'), marker('dialogueExamples'), marker('personaDescription'), marker('chatHistory'), marker('summaryBox'),
    prompt('style', { role: 'user', content: '{{setvar::x::1}}{{getvar::x}} {{charPrompt}}' }),
    prompt('deep', { injection_position: 1, injection_depth: 2, role: 'user' }),
    prompt('deep-early', { injection_position: 1, injection_depth: 2, injection_order: 50, role: 'assistant' }),
    prompt('last', { injection_position: 1, injection_depth: 0 }),
    prompt('swipe-only', { injection_trigger: ['swipe'] }),
    prompt('unused'),
    prompt('off'),
  ],
  prompt_order: [
    { character_id: 100000, order: on('main') },
    {
      character_id: 100001,
      order: [
        ...on('main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'nsfw', 'worldInfoAfter', 'dialogueExamples', 'style', 'chatHistory', 'jailbreak', 'deep', 'deep-early', 'last', 'swipe-only', 'summaryBox', 'gone'),
        { identifier: 'off', enabled: false },
      ],
    },
  ],
};

it("reads SillyTavern's chat-completion preset in its global order, in-chat prompts cutting the chat at their depth", () => {
  const read = presetJson(preset, 'Default');
  if (!read?.ok) throw new Error('not read');
  expect(read.prompt).toMatchObject({ name: 'Default', imported: 'sillytavern-preset', toggles: [], models: {} });
  expect(read.prompt.blocks.map((block) => (block.kind === 'text' ? [block.name, block.role, block.mark] : block.slot === 'chat' ? ['chat', block.range.from, block.range.to] : [block.slot]))).toEqual([
    ['main', 'system', 'main'],
    ['lorebook'],
    ['persona'],
    ['description'],
    ['style', 'user', null],
    [null, 'system', null],
    ['chat', 0, -2],
    ['deep-early', 'assistant', null],
    ['deep', 'user', null],
    ['chat', -2, null],
    ['last', 'system', null],
    // forbid_overrides keeps the card's post-history instructions out, so the empty prompt sends nothing.
  ]);
  expect(read.regex).toEqual([]);
  expect(read.unsupported).toEqual([
    { kind: 'unread-item', count: 1 },
    { kind: 'off-item', count: 3 },
    // {{trim}} without its text, the write and the name this app does not know.
    { kind: 'macro', count: 3 },
    { kind: 'sillytavern-regex', count: 1 },
    { kind: 'prompt-settings', count: 1 },
    { kind: 'settings', count: 1 },
  ]);
});

it('refuses a SillyTavern preset with no global prompt order', () => {
  expect(presetJson({ prompts: [], prompt_order: [{ character_id: 100000, order: [] }] }, 'x')).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'sillytavern-order' } });
  expect(presetJson({ prompts: [] }, 'x')).toBeNull();
});
