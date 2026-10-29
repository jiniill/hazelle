import type { EmbedPurpose, HttpRequest } from '../connectors/types';
import type { Lore, PackOwner } from '../model/library';
import type { Trigger } from './import/types';

export type ScriptUnit = Trigger & { owner: PackOwner };
export type ModelRefusal = Hazelle.ModelRefusal;
export type ModelResult = { success: true; result: string } | { success: false; result: string; reason: ModelRefusal };

export type EmbedResult = Hazelle.EmbedAnswer;

export type Question = Hazelle.Question;
export type ModelMessage = Hazelle.ModelMessage;

// What a script reaches outside its run, each of which may take as long as the user or a provider does.
export type Host = {
  say(kind: 'normal' | 'error', text: string, from: PackOwner): void;
  // input: the text typed; confirm: 'yes'; select: the option's index. null: dismissed.
  ask(question: Question, from: PackOwner, signal?: AbortSignal): Promise<string | null>;
  model(role: 'main' | 'aux', messages: ModelMessage[], spender: PackOwner, signal?: AbortSignal): Promise<ModelResult>;
  // With the account's 임베딩 모델, under the same answer as model.
  embed(texts: string[], as: EmbedPurpose | null, spender: PackOwner, signal?: AbortSignal): Promise<EmbedResult>;
  tokens(text: string): Promise<number>;
  // The lorebook entries a prompt built now would hold, each as sent, while their tokens fit within the model's
  // context less reserve; all of them when reserve is no number, as Risu's sum then never passes its limit.
  lore(reserve: number | null): Promise<{ role: 'system' | 'user' | 'assistant'; text: string }[]>;
  // Saves html as the chat's character's background (Risu's backgroundHTML), under the character's one answer; false
  // when refused or not saved.
  background(html: string, from: PackOwner, signal?: AbortSignal): Promise<boolean>;
};
// A tool reaches the network too, which Lua never does.
export type ToolReach = Host & {
  // Through the relay, under module's one answer for the network; the upstream's answer whatever its status.
  fetch(request: HttpRequest, module: string, signal?: AbortSignal): Promise<FetchResult>;
};
export type FetchResult = { ok: true; response: Response } | { ok: false; reason: Exclude<Hazelle.FetchRefusal, 'not-declared'>; code?: string };

export type EditStage = 'editInput' | 'editOutput' | 'editRequest';
export type ToolEvent =
  | { kind: 'reply'; reply: Hazelle.At }
  | { kind: 'replying' | 'sending'; text: string }
  | { kind: 'requesting'; messages: Hazelle.RequestMessage[] }
  | { kind: 'showing'; shown: Hazelle.Shown[] }
  | { kind: 'prompt'; turn: Hazelle.Turn }
  | { kind: 'change'; change: Hazelle.Change }
  | { kind: 'branch'; from: Hazelle.Branched }
  | { kind: 'menu'; item: string }
  | { kind: 'action'; item: string; message: Hazelle.At }
  // A //@input item pressed in the composer, not Lua's input, which a send is.
  | { kind: 'input'; item: string; text: string };
export type Event =
  | ToolEvent
  | { kind: 'input' | 'start' | 'output' }
  | { kind: 'button'; data: string }
  // risu-trigger runs Lua globals and block triggers by name regardless of event; id is risu-id or empty.
  | { kind: 'call'; name: string; id: string }
  | { kind: 'edit'; stage: EditStage; value: unknown; meta: Record<string, unknown> };

// Every Lua script hears every event and answers what it holds a function for; a block trigger runs for its own
// event, and for a call by its name whatever its event.
export const listens = (trigger: { kind: 'lua' } | Pick<Extract<ScriptUnit, { kind: 'blocks' }>, 'kind' | 'name' | 'on'>, event: Event) =>
  trigger.kind === 'lua' || (event.kind === 'call' ? trigger.name === event.name : (event.kind === 'start' || event.kind === 'input' || event.kind === 'output') && trigger.on === event.kind);

// runaway: the CBS the script evaluated ran away (cbs/evaluate Runaway), which the app words as its other runaway
// notices; the message is only what the script itself sees.
export type Failure = { message: string } | { runaway: true };
export type ScriptError = { script: string; from: PackOwner } & Failure;

// Snapshot indices identify messages. handled means a listener/trigger existed; missing names unsupported calls.
// lore replaces chat-local entries by name.
export type Outcome = {
  value: unknown;
  stop: boolean;
  handled: boolean;
  writes: [string, string][];
  edits: { index: number; text: string }[];
  removed: number[];
  // before: the snapshot index of the message it goes ahead of (insertChat); null after the last.
  added: { role: 'user' | 'char'; text: string; before: number | null }[];
  reload: boolean;
  lore: Omit<Lore, 'folder'>[];
  errors: ScriptError[];
  missing: string[];
};

export const UNSET = 'null';
