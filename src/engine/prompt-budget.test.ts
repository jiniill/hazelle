import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { expect, it, vi } from 'vitest';
import { anthropicMessages } from '../connectors/anthropic-messages';
import { bareModel } from '../connectors/chat-completions';
import { gemini } from '../connectors/gemini';
import { prepareChat } from '../connectors/preparation';
import { requestRoute } from '../connectors/registry';
import type { ChatMessage } from '../connectors/types';
import { cachePoints } from './cache-points';
import type { Assembled, From } from './pipeline';
import { fitChat, rewritten, wireTokens, type Part, type ProviderFit } from './prompt-budget';

const chat: From = { kind: 'block', name: null, slot: 'chat' };
const fitFor = (protocol: 'anthropic-messages' | 'gemini', allowance: number): ProviderFit => ({
  allowance,
  route: { provider: null, endpoint: { baseUrl: 'https://example.test', protocol } },
  model: { ...bareModel('m'), maxOutput: 1024 },
  settings: {},
});

it('bounds full request builds independently of the number of discarded messages, in assembly and script refits', () => {
  const paragraph = 'The lantern glowed by the harbor while the travelers waited for dawn. '.repeat(28);
  const messages: ChatMessage[] = Array.from({ length: 220 }, (_, at) => ({ role: at % 3 ? 'assistant' : 'user', content: `${at}: ${paragraph}` }));
  const fixed = ['Follow the story.', 'Keep the scene consistent.'].map((content) => ({ message: { role: 'system' as const, content }, from: { kind: 'script' as const } }));
  const template: Part[] = [...fixed, { range: { from: 0, to: null }, from: chat }];
  const all = [...fixed, ...messages.map((message) => ({ message, from: chat }))];
  const prompt: Assembled = { messages: all.map(({ message }) => message), parts: all.map(({ message, from }) => ({ from, tokens: countTokens(message.content) })), dropped: 0, lore: null, silent: null, invalidKeys: [], loreBudget: 0, memory: null, memoryShape: null, problems: { found: [], omitted: 0 }, unseen: 0 };
  for (const protocol of ['anthropic-messages', 'gemini'] as const) {
    const fit = fitFor(protocol, 20000);
    for (const mode of ['assemble', 'rewrite'] as const) {
      const builds = vi.spyOn(protocol === 'gemini' ? gemini : anthropicMessages, 'chat');
      const counted = vi.fn(countTokens);
      try {
        const result = mode === 'assemble' ? fitChat(template, messages.map((message) => ({ message })), [], counted, fit) : rewritten(prompt, prompt.messages, counted, fit);
        expect(builds).toHaveBeenCalledTimes(2);
        expect(new Set(counted.mock.calls.map(([text]) => text)).size).toBe(counted.mock.calls.length);
        expect(result).not.toHaveProperty('kind');
        if ('kind' in result) throw new Error('expected a fitting request');
        expect(result.dropped).toBeGreaterThan(150);
        const kept = 'messages' in result ? result.messages : cachePoints(result.parts).map(({ message }) => message);
        expect(wireTokens(fit, kept, countTokens)).toBeLessThanOrEqual(fit.allowance!);
        expect(wireTokens(fit, [...fixed.map(({ message }) => message), ...messages.slice(result.dropped - 1)], countTokens)).toBeGreaterThan(fit.allowance!);
      } finally {
        builds.mockRestore();
      }
    }
  }
});

it('caps corrections when changing system joins defeat successive estimates, and checks the last cut exactly', () => {
  const messages: ChatMessage[] = Array.from({ length: 20 }, (_, at) => ({ role: 'system', content: String(at) }));
  const template: Part[] = [
    { message: { role: 'system', content: 'fixed' }, from: { kind: 'script' } },
    { range: { from: 0, to: null }, from: chat },
  ];
  const builds = vi.spyOn(anthropicMessages, 'chat');
  // Stand in for boundary-dependent counts: each new system join exceeds the last measured overhead.
  const count = (text: string) => text.startsWith('fixed\n\n') ? 211 : text === 'fixed' ? 1 : 10;
  try {
    expect(fitChat(template, messages.map((message) => ({ message })), [], count, fitFor('anthropic-messages', 195))).toEqual({ kind: 'too-long', tokens: 211, budget: 195 });
    expect(builds).toHaveBeenCalledTimes(4);
  } finally {
    builds.mockRestore();
  }
});

it('fits a PDF로 보내기 request by what it sends, role tags and instruction included', () => {
  const fit: ProviderFit = { ...fitFor('gemini', 2000), settings: { pdf: { keep: 'recent', recent: 20 } } };
  const messages = Array.from({ length: 400 }, (_, at) => ({ message: { role: at % 2 ? 'assistant' as const : 'user' as const, content: `${at} the tide came in` } }));
  const result = fitChat([{ range: { from: 0, to: null }, from: chat }], messages, [], countTokens, fit);
  if ('kind' in result) throw new Error('expected a fitting request');
  const sent = prepareChat(requestRoute(fit.route), { model: fit.model, settings: fit.settings, messages: cachePoints(result.parts).map(({ message }) => message) });
  expect(sent.pdf).toBe(true);
  expect(sent.wire.segments.reduce((total, { text }) => total + countTokens(text), 0)).toBeLessThanOrEqual(2000);
});
