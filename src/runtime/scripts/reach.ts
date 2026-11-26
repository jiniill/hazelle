import type { ModelRef } from '../../connectors/assignment';
import type { ChatMessage, Cost, DecideQuestion, EmbedPurpose, InputPicture } from '../../connectors/types';
import { toBase64 } from '../../base64';
import { imageSize } from '../../engine/import/card';
import { sentPicture } from '../files/picture';
import { seesPicturesNow } from '../models/connections';
import type { Catalogs } from '../models/catalog';
import type { HttpRequest } from '../../contracts/http';
import type { ChatScope } from '../../engine/render';
import { plainPicture } from '../../engine/illustrate';
import type { DecideResult, DrawResult, EmbedResult, FetchResult, Host, ModelMessage, ModelRefusal, ModelResult, ToolReach } from '../../engine/script-api';
import type { Receipt } from '../../model/chat';
import { live, type PackOwner } from '../../model/library';
import { chatModel, decideModel, embedModel, sharedModel, taskModel, type Route } from '../models/assignment';
import { setBackground } from '../library/pack';
import { illustrationPrompt } from '../library/prompts';
import { chatIllustrate } from '../tasks/features';
import { drawPicture, imageRoute } from '../tasks/illustrate';
import { keepCall } from '../chat/chat-log';
import type { Costs } from '../models/cost';
import type { Credentials } from '../models/credential';
import { decide } from '../models/decide';
import { countTexts, embedTexts } from '../models/embed';
import { gather, receiptOf } from '../models/generate';
import { writerOf, type Writer } from '../models/profiles';
import { relayRaw } from '../models/relay';
import type { ReadModels } from '../store/read-model';
import type { RequestLog } from '../models/request-log';
import type { ScriptInteractions } from './interactions';
import { noteStep } from '../diagnostics/auto-diagnosis';
import type { ObjectStore } from '../store/store';
import { callOf, generateOnce, pageCall, taskCall } from '../models/streams';
import type { Tokens } from '../models/token-calibration';
import { keepRow } from '../models/usage';

export class ScriptReach {
  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; log: RequestLog; costs: Costs; tokens: Tokens; catalogs: Catalogs },
    private readonly interactions: ScriptInteractions,
    private readonly closing: AbortSignal,
  ) {}

  // deadline: the run is under a tool deadline (TOOL_DEADLINE_MS), which would dismiss a card before anyone read it.
  // progress: who waits on the run and shows what it says it is doing; nobody does off a turn's stages.
  host(chat: string, scope: ChatScope, signal?: AbortSignal, deadline = false, progress: ToolReach['progress'] = () => {}): ToolReach {
    const either = (callSignal?: AbortSignal) => (callSignal ? AbortSignal.any([...(signal ? [signal] : []), callSignal]) : signal);
    return {
      ...this.reads(chat, scope, () => this.interactions.tell(chat, 'runaway', { kind: 'runaway' })),
      say: (tone, text, from) => { if (!signal?.aborted) this.interactions.note(chat, { kind: 'said', tone, text }, from); },
      ask: (question, from, callSignal) => this.interactions.ask(chat, question, from, either(callSignal)),
      model: (role, messages, from, callSignal) => this.model(chat, role, messages, from, deadline, either(callSignal)),
      embed: (texts, as, from, callSignal) => this.embed(chat, texts, as, from, deadline, either(callSignal)),
      decide: (input, questions, from, callSignal) => this.decide(chat, input, questions, from, deadline, either(callSignal)),
      draw: (picture, from, callSignal) => this.draw(chat, picture, from, deadline, either(callSignal)),
      background: (html, from, callSignal) => this.background(chat, html, from, deadline, either(callSignal)),
      fetch: (request, module, callSignal) => this.fetch(chat, request, module, deadline, either(callSignal)),
      progress: (text) => { if (!signal?.aborted) progress(text); },
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
  private async model(chat: string, role: string, messages: Hazelle.AskedMessage[], from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<ModelResult> {
    const { store } = this.session;
    const refused = (reason: ModelRefusal | 'no-vision', why: string): ModelResult => ({ success: false, reason, result: `Error: ${why}` });
    if (signal?.aborted || this.closing.aborted) return refused('failed', 'stopped');
    const stored = live(store.get('chat', chat));
    if (!stored || !live(store.get(from.kind, from.id))) return refused('failed', 'the chat or spender is gone');
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return refused('not-allowed', 'the user has not allowed this script to call models');
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return refused('failed', 'stopped');

    // A module's own model serves its 보조 calls alone: a call for the 대화 모델 is one for the chat's. One of its
    // plugin's own models (//@model) is a 보조 call on the model picked for it.
    const asked = role === 'main' ? 'main' : 'aux';
    const module = asked === 'aux' && from.kind === 'module' ? store.get('module', from.id)!.value : undefined;
    const own = module?.models?.[role] ?? module?.model;
    const route = own ? taskModel(store, stored.value, own) : chatModel(store, stored.value, asked);
    const writer = 'kind' in route ? route : writerOf(store, route);
    if ('kind' in writer) {
      this.interactions.tell(chat, `no-model:${role}`, { kind: 'no-model', role: asked, ...(own && { own: true }) }, from);
      return refused('no-model', 'no model is set');
    }
    const sent = await this.pictured(writer, messages);
    if (sent === 'no-vision') return refused('no-vision', 'the model reads no pictures');
    if (sent === 'unread') return refused('failed', 'a picture could not be read');
    const text = gather();
    const answer = await generateOnce(this.session, writer, { messages: sent, ...(await this.called(writer, chat, signal)), onText: text });
    if (answer.error?.kind === 'app' && answer.error.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return refused('flood', 'too many model calls in a minute');
    }
    // Kept in the chat, whose Costs settles a pending cost.
    await keepCall(this.session, chat, 'script', receiptOf(callOf(writer.route), answer));
    return answer.state === 'failed' ? refused('failed', answer.error?.kind ?? 'failed') : { success: true, result: text.value() };
  }

  // A studio test's model call, on the model its 테스트 picked (else the 보조 모델) whichever role the plugin asked for.
  // Turning 모델 부르기 on is the user's answer, so no plugin consent is asked; its receipt is kept outside any chat.
  async tried(picked: ModelRef | null, messages: Hazelle.AskedMessage[], signal: AbortSignal): Promise<{ result: ModelResult; cost: Cost | null }> {
    const refused = (reason: ModelRefusal | 'no-vision', why: string) => ({ result: { success: false, reason, result: `Error: ${why}` } as ModelResult, cost: null });
    const route = sharedModel(this.session.store, 'aux', picked);
    const writer = 'kind' in route ? route : writerOf(this.session.store, route);
    if ('kind' in writer) return refused('no-model', 'no model is set');
    const sent = await this.pictured(writer, messages);
    if (sent === 'no-vision') return refused('no-vision', 'the model reads no pictures');
    if (sent === 'unread') return refused('failed', 'a picture could not be read');
    const text = gather();
    const { answer, receipt } = await taskCall(this.session, writer, { messages: sent, ...(await this.called(writer, null, signal)), onText: text });
    await keepRow(this.session.store, 'script', receipt, Date.now(), { chat: null, character: null });
    return answer.state === 'failed' ? { ...refused('failed', answer.error?.kind ?? 'failed'), cost: receipt.cost } : { result: { success: true, result: text.value() }, cost: receipt.cost };
  }

  // A call's messages as a codec takes them, each picture drawn within every codec's reach. no-vision: the model reads
  // none, known before anything is sent. unread: the browser draws one of them not.
  private async pictured({ route }: Writer, messages: Hazelle.AskedMessage[]): Promise<ChatMessage[] | 'no-vision' | 'unread'> {
    if (!messages.some(({ pictures }) => pictures)) return messages as ModelMessage[];
    if (!(await seesPicturesNow(this.session, route))) {
      noteStep('script-model:no-vision');
      return 'no-vision';
    }
    const encoded = async (bytes: Uint8Array): Promise<InputPicture> => {
      const sent = await sentPicture({ bytes: new Uint8Array(bytes), type: imageSize(bytes)!.type });
      return { type: sent.type, data: toBase64(sent.bytes) };
    };
    try {
      return await Promise.all(messages.map(async ({ pictures, ...message }) => (pictures ? { ...message, pictures: await Promise.all(pictures.map(encoded)) } : message)));
    } catch {
      noteStep('script-model:picture-unread');
      return 'unread';
    }
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
    return (await setBackground(store, { kind: 'character', id: character }, html)).ok;
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

  // Why a spender's call is not made, under the spender's one answer for model calls; null where it may be.
  private async unadmitted(chat: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<'failed' | 'not-allowed' | null> {
    const { store } = this.session;
    if (signal?.aborted || this.closing.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id))) return 'failed';
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return 'not-allowed';
    return signal?.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id)) ? 'failed' : null;
  }

  // An account role's model for a spender's call; why not, where there is none to call.
  private async accountModel(chat: string, role: 'embed' | 'decide', from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<Route | 'failed' | 'not-allowed' | 'no-model'> {
    const { store } = this.session;
    const refused = await this.unadmitted(chat, from, deadline, signal);
    if (refused) return refused;
    const route = role === 'embed' ? embedModel(store) : decideModel(store);
    if (!('kind' in route)) return route;
    this.interactions.tell(chat, `no-model:${role}`, { kind: 'no-model', role }, from);
    noteStep(`script-${role}:no-model`);
    return 'no-model';
  }

  // Kept in the chat, whose Costs settles a pending cost.
  private async spent<T extends { ok: boolean; reason?: string }>(chat: string, role: 'embed' | 'decide', { answer, receipt }: { answer: T; receipt: Receipt | null }, from: PackOwner): Promise<T> {
    if (receipt) await keepCall(this.session, chat, role === 'embed' ? 'embedding' : 'script', receipt);
    if (answer.reason === 'flood') this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
    noteStep(`script-${role}:${answer.reason ?? 'done'}`, receipt?.totalMs ?? null);
    return answer;
  }

  private async embed(chat: string, texts: string[], as: EmbedPurpose | null, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<EmbedResult> {
    const { store, credentials, log } = this.session;
    const route = await this.accountModel(chat, 'embed', from, deadline, signal);
    if (typeof route === 'string') return { ok: false, reason: route };
    return this.spent(chat, 'embed', await embedTexts({ credentials, log, count: countTexts(store) }, route, texts, as, chat, true, signal ? AbortSignal.any([this.closing, signal]) : this.closing), from);
  }

  // A picture from the chat's image model, sized and tuned as its 삽화 prompt says. One not known to cost nothing is
  // drawn only where the chat's 삽화 spends unasked. Image calls report no cost, so it leaves no receipt.
  private async draw(chat: string, asked: Hazelle.DrawRequest, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<DrawResult> {
    const { store, credentials } = this.session;
    const began = performance.now();
    const ended = <T extends DrawResult>(answer: T): T => {
      noteStep(`script-draw:${answer.ok ? 'done' : answer.reason}`, Math.round(performance.now() - began));
      return answer;
    };
    const refused = await this.unadmitted(chat, from, deadline, signal);
    if (refused) return { ok: false, reason: refused };
    const setup = chatIllustrate(store, store.get('chat', chat)!.value);
    const route = imageRoute(store, setup.model);
    if ('kind' in route) {
      this.interactions.tell(chat, 'no-model:image', { kind: 'no-model', role: 'image', ...(route.kind === 'image-model-gone' && { own: true }) }, from);
      return ended({ ok: false, reason: 'no-model' });
    }
    const prompt = illustrationPrompt(store, setup.prompt);
    const picture = plainPicture(route.model, asked, prompt.kind === 'missing' ? undefined : prompt.prompt.value.picture, crypto.getRandomValues(new Uint32Array(1))[0]!);
    const drawn = await drawPicture(credentials, route, picture, { spend: setup.spend, chat }, signal ? AbortSignal.any([this.closing, signal]) : this.closing);
    if (!('kind' in drawn)) return ended({ ok: true, type: drawn.type, bytes: drawn.bytes });
    if (drawn.kind === 'costs') {
      this.interactions.tell(chat, 'unpaid', { kind: 'unpaid', why: drawn.why }, from);
      return ended({ ok: false, reason: 'costs' });
    }
    if (drawn.kind === 'undrawn' && drawn.error.kind === 'app' && drawn.error.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return ended({ ok: false, reason: 'flood' });
    }
    return ended({ ok: false, reason: 'failed' });
  }

  private async decide(chat: string, input: string, questions: Record<string, DecideQuestion>, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<DecideResult> {
    const route = await this.accountModel(chat, 'decide', from, deadline, signal);
    if (typeof route === 'string') return { ok: false, reason: route };
    return this.spent(chat, 'decide', await decide(this.session, route, input, questions, chat, signal ? AbortSignal.any([this.closing, signal]) : this.closing), from);
  }
}
