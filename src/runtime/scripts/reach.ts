import type { ModelRef, Role } from '../../connectors/assignment';
import type { Cost } from '../../connectors/types';
import type { EmbedPurpose } from '../../connectors/types';
import type { HttpRequest } from '../../contracts/http';
import type { ChatScope } from '../../engine/render';
import type { EmbedResult, FetchResult, Host, ModelMessage, ModelRefusal, ModelResult, ToolReach } from '../../engine/script-api';
import { live, type PackOwner } from '../../model/library';
import { chatModel, embedModel, sharedModel } from '../assignment';
import { setBackground } from '../characters';
import { keepCall } from '../chat-log';
import type { Costs } from '../cost';
import type { Credentials } from '../credential';
import { countTexts, embedTexts } from '../embed';
import { gather, receiptOf } from '../generate';
import { writerOf, type Writer } from '../profiles';
import { relayRaw } from '../relay';
import type { ReadModels } from '../read-model';
import type { RequestLog } from '../request-log';
import type { ScriptInteractions } from './interactions';
import type { ObjectStore } from '../store';
import { callOf, generateOnce, pageCall, taskCall } from '../streams';
import type { Tokens } from '../token-calibration';
import { keepRow } from '../usage';

export class ScriptReach {
  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; log: RequestLog; costs: Costs; tokens: Tokens },
    private readonly interactions: ScriptInteractions,
    private readonly closing: AbortSignal,
  ) {}

  // deadline: the run is under a tool deadline (TOOL_DEADLINE_MS), which would dismiss a card before anyone read it.
  host(chat: string, scope: ChatScope, signal?: AbortSignal, deadline = false): ToolReach {
    const either = (callSignal?: AbortSignal) => (callSignal ? AbortSignal.any([...(signal ? [signal] : []), callSignal]) : signal);
    return {
      ...this.reads(chat, scope, () => this.interactions.tell(chat, 'runaway', { kind: 'runaway' })),
      say: (tone, text, from) => { if (!signal?.aborted) this.interactions.note(chat, { kind: 'said', tone, text }, from); },
      ask: (question, from, callSignal) => this.interactions.ask(chat, question, from, either(callSignal)),
      model: (role, messages, from, callSignal) => this.model(chat, role, messages, from, deadline, either(callSignal)),
      embed: (texts, as, from, callSignal) => this.embed(chat, texts, as, from, deadline, either(callSignal)),
      background: (html, from, callSignal) => this.background(chat, html, from, deadline, either(callSignal)),
      fetch: (request, module, callSignal) => this.fetch(chat, request, module, deadline, either(callSignal)),
    };
  }

  // What a script reads of the app, acting on nothing. ranAway: the lorebook's CBS ran away, and the script reads none.
  reads(chat: string, scope: ChatScope, ranAway: () => void): Pick<Host, 'tokens' | 'lore'> {
    return {
      tokens: async (text) => (await countTexts(this.session.store)([text]))[0]!,
      lore: async (reserve) => {
        const context = scope.model?.maxContext ?? null;
        const lore = await this.session.store.evaluation.lore({ asker: 'lore', chat }, scope, crypto.randomUUID(), reserve === null || context === null ? Infinity : context - reserve);
        if (!('kind' in lore)) return lore;
        if (lore.kind === 'tokenizer') throw new Error('tokenizer');
        ranAway();
        return [];
      },
    };
  }

  // Only consented spenders may call the chat's role model. Keep receipts on the last shown message for usage.
  // Keep failure reasons structured for tools; Lua formats them at its binding.
  private async model(chat: string, role: Role, messages: ModelMessage[], from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<ModelResult> {
    const { store } = this.session;
    const refused = (reason: ModelRefusal, why: string): ModelResult => ({ success: false, reason, result: `Error: ${why}` });
    if (signal?.aborted || this.closing.aborted) return refused('failed', 'stopped');
    const stored = live(store.get('chat', chat));
    if (!stored || !live(store.get(from.kind, from.id))) return refused('failed', 'the chat or spender is gone');
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return refused('not-allowed', 'the user has not allowed this script to call models');
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return refused('failed', 'stopped');

    const route = chatModel(store, stored.value, role);
    const writer = 'kind' in route ? route : writerOf(store, route);
    if ('kind' in writer) {
      this.interactions.tell(chat, `no-model:${role}`, { kind: 'no-model', role }, from);
      return refused('no-model', 'no model is set');
    }
    const text = gather();
    const answer = await generateOnce(this.session, writer, { messages, ...(await this.called(writer, chat, signal)), onText: text });
    if (answer.error?.kind === 'app' && answer.error.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return refused('flood', 'too many model calls in a minute');
    }
    // Kept in the chat, whose Costs settles a pending cost.
    await keepCall(this.session, chat, receiptOf(callOf(writer.route), answer));
    return answer.state === 'failed' ? refused('failed', answer.error?.kind ?? 'failed') : { success: true, result: text.value() };
  }

  // A studio test's model call, on the model its 테스트 picked (else the 보조 모델) whichever role the plugin asked for.
  // Turning 모델 부르기 on is the user's answer, so no plugin consent is asked; its receipt is kept outside any chat.
  async tried(picked: ModelRef | null, messages: ModelMessage[], signal: AbortSignal): Promise<{ result: ModelResult; cost: Cost | null }> {
    const refused = (reason: ModelRefusal, why: string) => ({ result: { success: false, reason, result: `Error: ${why}` } as ModelResult, cost: null });
    const route = sharedModel(this.session.store, 'aux', picked);
    const writer = 'kind' in route ? route : writerOf(this.session.store, route);
    if ('kind' in writer) return refused('no-model', 'no model is set');
    const text = gather();
    const { answer, receipt } = await taskCall(this.session, writer, { messages, ...(await this.called(writer, null, signal)), onText: text });
    await keepRow(this.session.store, receipt, Date.now(), { chat: null, character: null });
    return answer.state === 'failed' ? { ...refused('failed', answer.error?.kind ?? 'failed'), cost: receipt.cost } : { result: { success: true, result: text.value() }, cost: receipt.cost };
  }

  private async called({ route }: Writer, chat: string | null, signal?: AbortSignal) {
    return { call: await pageCall(this.session, route, 'script', chat), signal: signal ? AbortSignal.any([this.closing, signal]) : this.closing };
  }

  // The chat's character's card, under that character's one answer (design §6.8).
  private async background(chat: string, html: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this.session;
    const character = live(store.get('chat', chat))?.value.character ?? null;
    if (character === null || signal?.aborted || !(await this.interactions.mayRewrite(chat, character, from, deadline, signal))) return false;
    if (signal?.aborted) return false;
    return (await setBackground(store, character, html)).ok;
  }

  // A tool's own call out (design §6.10), under its module's one answer, counted against the chat's bot calls as a model
  // call is.
  private async fetch(chat: string, request: HttpRequest, module: string, deadline: boolean, signal?: AbortSignal): Promise<FetchResult> {
    const from = { kind: 'module', id: module } as const;
    if (signal?.aborted || this.closing.aborted || !live(this.session.store.get('chat', chat))) return { ok: false, reason: 'stopped' };
    if (!(await this.interactions.mayFetch(chat, module, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted) return { ok: false, reason: 'stopped' };
    const response = await relayRaw(request, signal ? AbortSignal.any([this.closing, signal]) : this.closing, chat);
    if (response instanceof Response) return { ok: true, response };
    if (response.kind === 'app' && response.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return { ok: false, reason: 'flood' };
    }
    if (response.kind === 'relay' || response.kind === 'app') return { ok: false, reason: 'refused', code: response.code };
    return { ok: false, reason: response.kind === 'stopped' ? 'stopped' : 'offline' };
  }

  // With the account's 임베딩 모델, under the spender's one answer for model calls.
  private async embed(chat: string, texts: string[], as: EmbedPurpose | null, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<EmbedResult> {
    const { store, credentials, log } = this.session;
    if (signal?.aborted || this.closing.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    const route = embedModel(store);
    if ('kind' in route) {
      this.interactions.tell(chat, 'no-model:embed', { kind: 'no-model', role: 'embed' }, from);
      return { ok: false, reason: 'no-model' };
    }
    const { answer, receipt } = await embedTexts({ credentials, log, count: countTexts(store) }, route, texts, as, chat, true, signal ? AbortSignal.any([this.closing, signal]) : this.closing);
    if (receipt) await keepCall(this.session, chat, receipt);
    if (!answer.ok && answer.reason === 'flood') this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
    return answer;
  }
}
