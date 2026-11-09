import { bareModel } from './chat-completions';
import { reasoningOptions } from './settings';
import type { ConnectionType, Model } from './types';
import { count, flag, isRecord, modalities, modelEntries } from './values';

// Friendli turns reasoning off with chat_template_kwargs.enable_thinking, not the reasoning_effort "none" this format
// sends, so no model here offers off. Its budget's min is -1, meaning no limit, which reads as no lower bound.
function reasoningTakes(options: unknown) {
  const takes = reasoningOptions(options);
  return takes && { ...takes, off: false };
}

export const friendli: ConnectionType = {
  browser: false,
  id: 'friendli',
  label: 'Friendli',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Friendli 서버에서 실행해요.',
  keyPage: 'https://friendli.ai/suite/~/setting/keys',
  endpoint: { baseUrl: 'https://api.friendli.ai/serverless/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: /^flp_/, host: 'api.friendli.ai' },
  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => ({
      ...bareModel(raw.id),
      input: modalities(raw.input_modalities),
      output: modalities(raw.output_modalities),
      contextLength: count(raw.context_length),
      maxOutput: count(raw.max_completion_tokens),
      reasoning: flag(raw.reasoning),
      tools: isRecord(raw.functionality) ? flag(raw.functionality.tool_call) : null,
      takes: { settings: null, reasoning: reasoningTakes(raw.reasoning_options) },
    })) ?? null,
  reasoningBudget: (tokens) => ({ reasoning_budget: tokens }),
};
