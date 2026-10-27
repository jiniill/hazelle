import { ChangeSignal } from '../change-signal';
import { refOf, sameModelRef, type ModelRef } from '../connectors/assignment';
import { resolveConnection } from '../connectors/registry';
import { ConnectorError, type Costs, type Draws, type HttpRequest, type Picture, type PictureRequest } from '../connectors/types';
import { imageSize } from '../engine/import/card';
import { asPov, parseScenes, pictureRequest, toldProfiles, type Earlier, type SceneInvalid } from '../engine/illustrate';
import { namesOf } from '../engine/likeness';
import type { IllustrationInput, RanAway } from '../engine/pipeline';
import { fold, shown, standing, type Chat, type Receipt } from '../model/chat';
import { without } from '../model/fields';
import { paragraphsOf, pictureCount, type Attached, type Illustration, type Scene } from '../model/illustration';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import { likenessId, type Portrait } from '../model/likeness';
import type { IllustratePrompt } from '../model/prompt';
import type { ApiFailure, ApiResult } from './api';
import type { Route, RouteFailure } from './assignment';
import { chatIllustrate } from './features';
import { pinned, scopeOf } from './chat-context';
import { chatPersona } from './personas';
import { evaluatingTask } from './evaluation';
import type { ReplyError } from './generate';
import { taskWriter } from './profiles';
import { illustrationPrompt } from './prompts';
import { callLabel } from './pulse';
import { relayBytes, relayJson } from './relay';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { chatPlace, receiptRow } from './usage';

// One scene call per message/run, then sequential image calls. Owns illustration writes, including tool pictures,
// except backup restores and chat copies (design §6.6).

export type ImageRoute = Route & { draws: Draws };

// 삭제: the picture goes at once, and 되돌리기 writes it back under its id.
export const removeIllustration = (store: ObjectStore, id: string) => store.take('illustration', id);
export const restoreIllustration = (store: ObjectStore, removed: Stored<'illustration'>) => store.restore(removed);

// Replace only this tool's prior picture on the version, anchored after its last paragraph; user deletion still applies.
export async function attachIllustration(
  { store, files }: Pick<Deps, 'store' | 'files'>, chat: string, tool: Attached['tool'], at: { message: string; version: string }, bytes: Uint8Array<ArrayBuffer>, caption: string | null,
): Promise<ApiResult<null>> {
  const picture = imageSize(bytes);
  if (!picture) return { ok: false, error: 'not-a-picture' };
  const lease = store.retainChat(chat);
  try {
    const failure = await lease.ready;
    if (failure) return failure;
    const messages = fold(store.children('entry', chat));
    const version = messages.find(({ id }) => id === at.message)?.versions.find(({ id }) => id === at.version);
    if (!live(store.get('chat', chat)) || !version) return { ok: false, error: 'gone' };
    const versions = standing(messages);
    const held = store.children('illustration', chat).find(({ value }) => 'tool' in value && value.tool.module === tool.module && versions.get(value.version) === at.version);
    const saved = await files.save([bytes]);
    if (!saved.ok) return saved;
    const [file] = saved.data;
    if (!file) return { ok: false, error: 'picture-refused' };
    const value: Attached = {
      message: at.message, version: at.version, file, type: picture.type, size: bytes.byteLength, at: Date.now(),
      paragraph: Math.max(0, paragraphsOf(version.text).length - 1), line: paragraphsOf(version.text).at(-1), width: picture.width, height: picture.height, tool, ...(caption !== null && { caption }),
    };
    const written = held ? await store.update('illustration', held.id, () => value) : await store.create('illustration', value, { parent: chat });
    return written.ok ? { ok: true, data: null } : written;
  } finally {
    lease.release();
  }
}

// The added models that draw: their output holds an image and their connection's type fills draws. The first is the
// image model of a chat whose switches name none.
export const drawingModels = (connections: readonly Stored<'connection'>[]): ImageRoute[] =>
  connections.flatMap((connection) => {
    const draws = resolveConnection(connection.value)?.type?.draws;
    return draws ? connection.value.starred.filter(({ output }) => output?.includes('image')).map((model) => ({ connection, model, draws })) : [];
  });

// invalid means malformed scene, undrawn a refused/failed image call, file-refused an upload size/block/cap failure.
// Keep missing selected models distinct from having no model; gone/empty refer to the target version.
export type IllustrateFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: SceneInvalid }
  | { kind: 'no-image-model' }
  | { kind: 'image-model-gone' }
  | { kind: 'undrawn'; error: Exclude<ReplyError, { kind: 'stopped' }> }
  | { kind: 'not-a-picture' }
  // Not known to cost nothing: drawn only on the user's press, with spend. why: the connector's answer.
  | { kind: 'costs'; why: Costs }
  | { kind: 'file-refused' }
  | { kind: 'gone' }
  | { kind: 'empty' }
  | { kind: 'unsaved'; failure: ApiFailure };

// A scene being drawn, or one whose picture failed, which a retry draws again without another scene call.
type Sketch = { scene: Scene; failure: IllustrateFailure | null };
// One run per message. Run-level failures have no scene and appear at message end;
// sketches retain pending/failed scenes until saved pictures replace them.
export type Drawing = { chat: string; version: string; writing: boolean; failure: IllustrateFailure | null; sketches: readonly Sketch[] };
export type Illustrating = ReadonlyMap<string, Drawing>;

export const runs = (drawing: Drawing) => drawing.writing || drawing.sketches.some(({ failure }) => failure === null);

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'tokens' | 'store' | 'credentials' | 'log' | 'files' | 'likenesses'>;

export function sceneWriterOf(store: Deps['store'], chat: Chat): ReturnType<typeof taskWriter> | { kind: 'prompt-missing'; own: boolean } {
  const prompt = illustrationPrompt(store, chatIllustrate(store, chat).prompt);
  return prompt.kind === 'missing' ? { kind: 'prompt-missing', own: prompt.own } : taskWriter(store, chat, prompt.prompt.value.model);
}

export const sendsIllustrateNote = (prompt: IllustratePrompt) => prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'illustrateNote');

function imageRoute(store: Deps['store'], ref: ModelRef | undefined): ImageRoute | { kind: 'no-image-model' } | { kind: 'image-model-gone' } {
  const routes = drawingModels(store.list('connection'));
  if (!ref) return routes[0] ?? { kind: 'no-image-model' };
  return routes.find(({ connection, model }) => sameModelRef(refOf(connection.id, model), ref)) ?? { kind: 'image-model-gone' };
}

// Several messages draw at once, each going on when its chat is left. A failure is kept for the session and never
// tried again on its own.
export class Illustrator {
  private closed = false;
  private state: Illustrating = new Map();
  private readonly aborts = new Map<string, AbortController>();
  private readonly changes = new ChangeSignal();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(message: string, drawing: Drawing | null) {
    const next = new Map(this.state);
    if (drawing && (drawing.writing || drawing.failure || drawing.sketches.length)) next.set(message, drawing);
    else next.delete(message);
    this.state = next;
    this.changes.notify();
  }

  private update(message: string, change: (drawing: Drawing) => Drawing) {
    const drawing = this.state.get(message);
    if (drawing) this.change(message, change(drawing));
  }

  private sketch(message: string, scene: Scene, failure: IllustrateFailure | null | 'drawn') {
    this.update(message, (drawing) => ({ ...drawing, sketches: failure === 'drawn' ? drawing.sketches.filter((each) => each.scene !== scene) : drawing.sketches.map((each) => (each.scene === scene ? { scene, failure } : each)) }));
  }

  // Retry edited/failed scenes without another scene call, retaining other failed scenes.
  // Auto uses the passive stuck gate; manual redraw keeps earlier pictures. spend records explicit cost consent.
  draw(chat: string, message: string, version: string, { scene = null, auto = false, spend = false }: { scene?: Scene | null; auto?: boolean; spend?: boolean } = {}) {
    if (this.closed || this.aborts.has(message)) return;
    const abort = new AbortController();
    this.aborts.set(message, abort);
    const previous = this.state.get(message);
    const kept = scene && previous?.version === version ? previous.sketches.filter((each) => each.scene !== scene) : [];
    this.change(message, { chat, version, writing: !scene, failure: null, sketches: [...kept, ...(scene ? [{ scene, failure: null }] : [])] });
    const lease = this.deps.store.retainChat(chat);
    void lease.ready
      .then(async (failure) => (failure ? { kind: 'unsaved' as const, failure } : this.run(chat, message, version, scene, auto, spend, abort.signal)))
      .then(
        (outcome) => {
          if (outcome?.kind === 'stopped') return this.change(message, null);
          // A failure before any picture is drawn is every waiting scene's, or the run's when it has none.
          this.update(message, (drawing) => {
            const waiting = drawing.sketches.some((each) => each.failure === null);
            const sketches = outcome && waiting ? drawing.sketches.map((each) => (each.failure === null ? { ...each, failure: outcome } : each)) : drawing.sketches;
            return { ...drawing, writing: false, failure: outcome && !waiting ? outcome : null, sketches };
          });
        },
        (error: unknown) => {
          this.change(message, null);
          throw error;
        },
      )
      .finally(() => {
        this.aborts.delete(message);
        lease.release();
      });
  }

  // 닫기 on a failure: the run's, or one scene's. A run under way has none to close.
  dismiss(message: string, scene: Scene | null = null) {
    const drawing = this.state.get(message);
    if (!drawing || runs(drawing)) return;
    if (scene) this.sketch(message, scene, 'drawn');
    else this.change(message, { ...drawing, failure: null });
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }

  // null once every scene is drawn or failed on its own; a failure returned came before any picture.
  private async run(chat: string, message: string, version: string, given: Scene | null, auto: boolean, spend: boolean, signal: AbortSignal): Promise<IllustrateFailure | Stopped | null> {
    const { store } = this.deps;
    const stored = live(store.get('chat', chat));
    const messages = fold(store.children('entry', chat));
    const index = messages.findIndex(({ id }) => id === message);
    const selected = messages[index]?.versions.findIndex(({ id }) => id === version) ?? -1;
    if (!stored || selected === -1) return { kind: 'gone' };
    const text = messages[index]!.versions[selected]!.text;
    const switches = chatIllustrate(store, stored.value);
    const route = imageRoute(store, switches.model);
    if ('kind' in route) return route;
    // A given scene draws with the tags and settings of the prompt chosen now, as a written one does.
    const prompt = illustrationPrompt(store, switches.prompt);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing', own: prompt.own };
    // Before the scene call, which is told their names; a pack whose build fails is drawn without its portraits.
    const portraits = await this.deps.likenesses.portraits(stored.value, prompt.prompt.value, signal);
    const persona = switches.pov ? chatPersona(store, stored.value) : null;
    const viewer = persona?.kind === 'persona' ? persona.persona : null;
    let scenes = given ? [given] : [];
    let receipt: Receipt | null = null;
    if (!given) {
      const paragraphs = paragraphsOf(text);
      if (!paragraphs.length) return { kind: 'empty' };
      const history = [...messages.slice(0, index), { ...messages[index]!, selected }];
      const looks = { pov: viewer?.value.name ?? null, comic: switches.comic };
      const written = await this.scenes(chat, stored.value, history, paragraphs, pictureCount(switches.ladder, text), portraits, looks, prompt.prompt.value, auto, signal);
      if ('kind' in written) return written;
      ({ scenes, receipt } = written);
      // A scene the user changed is drawn as given, the persona in it too.
      if (viewer) {
        const names = [viewer.value.name, ...(store.get('likeness', likenessId(viewer.id))?.value.portraits ?? []).flatMap(namesOf)];
        scenes = scenes.map((scene) => asPov(scene, names));
      }
      this.update(message, (drawing) => ({ ...drawing, writing: false, sketches: scenes.map((scene) => ({ scene, failure: null })) }));
    }
    const drawn = { chat, message, version, text, route, prompt: prompt.prompt.value, portraits, spend: spend || switches.spend, signal };
    // The scene call's row goes into the ledger once, with the first picture saved.
    let logged = false;
    // In turn: an image connection draws one picture at a time.
    for (const scene of scenes) {
      const outcome = await this.drawScene(drawn, scene, receipt, !logged);
      if (outcome?.kind === 'stopped') return outcome;
      this.sketch(message, scene, outcome ?? 'drawn');
      logged ||= !outcome;
    }
    return null;
  }

  // null once the illustration is saved. Each picture of the run keeps the receipt of the call that wrote its scene.
  private async drawScene(
    { chat, message, version, text, route, prompt, portraits, spend, signal }: { chat: string; message: string; version: string; text: string; route: ImageRoute; prompt: IllustratePrompt; portraits: Portrait[]; spend: boolean; signal: AbortSignal },
    scene: Scene,
    receipt: Receipt | null,
    log: boolean,
  ): Promise<IllustrateFailure | Stopped | null> {
    const { store, files } = this.deps;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const request = pictureRequest(scene, prompt, route.model, seed, portraits);
    const drawn = await this.picture(route, request, spend, signal);
    if ('kind' in drawn) return drawn;
    const saved = await files.save([drawn.bytes], { signal });
    if (!saved.ok) return saved.error === 'stopped' ? { kind: 'stopped' } : { kind: 'unsaved', failure: saved };
    const file = saved.data[0];
    if (!file) return { kind: 'file-refused' };
    const illustration: Illustration = { message, version, line: paragraphsOf(text)[scene.paragraph], scene, receipt, model: refOf(route.connection.id, route.model), sent: without(request, 'model'), file, type: drawn.type, size: drawn.bytes.byteLength, at: Date.now() };
    const created = await store.batch([
      { type: 'create', kind: 'illustration', id: crypto.randomUUID(), parent: chat, value: illustration },
      ...(receipt && log ? [receiptRow(receipt, illustration.at, chatPlace(store, chat))] : []),
    ]);
    return created.ok ? null : { kind: 'unsaved', failure: created };
  }

  private async scenes(
    chat: string, value: Stored<'chat'>['value'], history: ReturnType<typeof fold>, paragraphs: string[], count: number, portraits: Portrait[], looks: Pick<IllustrationInput, 'pov' | 'comic'>, prompt: IllustratePrompt, auto: boolean, signal: AbortSignal,
  ): Promise<{ scenes: Scene[]; receipt: Receipt } | IllustrateFailure | Stopped> {
    const { store } = this.deps;
    const writer = taskWriter(store, value, prompt.model);
    if ('kind' in writer) return writer;
    const lane = { asker: auto ? ('auto-illustration' as const) : ('illustration' as const), chat };
    const scope = scopeOf({ store }, chat, value, history);
    const drawn = this.drawnBefore(store, chat, history);
    const assembled = await evaluatingTask(
      store.evaluation.illustration(lane, { scope, take: pinned({ store }, value), prompt, index: history.length - 1, paragraphs, count, portraits: toldProfiles(portraits, drawn), note: value.illustrateNote ?? '', last: drawn.at(-1) ?? null, ...looks, seed: crypto.randomUUID() }, signal),
    );
    if ('kind' in assembled) return assembled;
    const answer = await pageAnswer(this.deps, writer, 'illustration', chat, assembled.messages, signal);
    if ('kind' in answer) return answer;
    const { receipt } = answer;
    const parsed = parseScenes(answer.text, paragraphs.length, count);
    return parsed.ok ? { scenes: parsed.scenes, receipt } : { kind: 'invalid', receipt, reason: parsed.reason };
  }

  // Use selected-version scenes through the target, in message/paragraph/time order.
  // Distances drive toldProfiles continuity; the latest scene drives lastScene.
  private drawnBefore(store: ObjectStore, chat: string, history: ReturnType<typeof fold>): Earlier[] {
    const order = new Map(history.map((message, index) => [shown(message).id, index]));
    const versions = standing(history);
    return store
      .children('illustration', chat)
      .flatMap(({ value }) => {
        const version = versions.get(value.version);
        const at = version === undefined ? undefined : order.get(version);
        return at === undefined || 'tool' in value ? [] : [{ at, value }];
      })
      .sort((a, b) => a.at - b.at || a.value.scene.paragraph - b.value.scene.paragraph || a.value.at - b.value.at)
      .map(({ at, value }) => ({ scene: value.scene, ago: history.length - 1 - at }));
  }

  private async picture({ connection, draws }: ImageRoute, picture: PictureRequest, spend: boolean, signal: AbortSignal): Promise<Picture | IllustrateFailure | Stopped> {
    const { credentials } = this.deps;
    let request: HttpRequest;
    try {
      request = draws.request(picture);
    } catch (error) {
      if (error instanceof ConnectorError) return { kind: 'undrawn', error: { kind: 'refused', code: error.code } };
      throw error;
    }
    const picked = await credentials.pool.pick(connection.value);
    if (!picked.ok) return { kind: 'undrawn', error: picked.failure };
    const failed = (error: Exclude<ReplyError, { kind: 'pool' }>): IllustrateFailure | Stopped => {
      if (error.kind === 'stopped') return { kind: 'stopped' };
      credentials.pool.stale(connection.value, picked.account);
      return { kind: 'undrawn', error };
    };
    const resolved = resolveConnection(connection.value)!;
    const credential = await credentials.get(resolved, picked.account.secret, signal);
    if (!credential.ok) return failed(credential.failure);
    if (!spend) {
      if (!draws.free) return { kind: 'costs', why: 'unknown' };
      const asked = await relayJson(draws.free.request(credential.credential), signal, undefined, undefined, resolved.type);
      if (!asked.ok) return failed(asked.failure);
      const why = draws.free.costs(asked.data, picture);
      if (why) return { kind: 'costs', why };
    }
    const answer = await relayBytes({ ...request, headers: { ...request.headers, ...draws.authHeaders(credential.credential) } }, signal, callLabel('image', connection.value, picture.model.id), resolved.type);
    if (!answer.ok) return failed(answer.failure);
    return (await draws.parse(answer.bytes, answer.type)) ?? { kind: 'not-a-picture' };
  }
}
