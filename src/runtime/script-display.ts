import type { LuaRunner } from './script-binding';
import type { Display } from '../engine/display';
import type { DisplayBatch, Displayed, Script } from '../engine/lua/run';
import type { Snapshot } from '../engine/lua/state';
import type { ChatScope, Missed } from '../engine/render';
import type { Chat, Message } from '../model/chat';
import type { UnfoundAssets } from './assets';
import { EvaluationStopped, EvaluationStuck } from './evaluation';

import { luaSnapshot, luaStanding } from './lua/snapshot';
import { scriptsOf } from './script-selection';
import type { ScriptExecution } from './script-execution';
import type { ScriptEffects } from './script-effects';
import type { ToolUnit } from '../model/tool';
import type { ObjectStore } from './store';
import { packsOf, pinned, scopeOf } from './chat-context';

// tools: those that may answer showing, run over each stretch after the Lua (ScriptExecution.showing).
type Pass = { revision: number; generation: number; scripts: Script[]; tools: ToolUnit[]; scope: ChatScope; snapshot: Snapshot; items: Missed[]; remaining: number; installed: boolean; view: Display; signal?: AbortSignal };
// generation: the number its passes are stamped with, new whenever the basis is or reloadDisplay asks, and never used
// twice, so a stretch begun under an older one lands as a last result and never as a fresh one.
type Basis = { parts: string[]; generation: number };
// How long one stretch of a pass may hold the worker, which the chat's other Lua (a send, a button) waits behind. A
// script that reads the whole chat for every message takes a third of a second each on a long chat (measured
// 2026-10-02), so a pass is cut into stretches of about this long, sized by how the last one went.
const STRETCH_MS = 200;
const STRETCH_MOST = 512;

// The open chats' displays with the bot's Lua editDisplay pass laid over them (design §6.8). Pending rows keep their
// last result until a new pass lands; rows with no result wait empty when the bot listens. Completion patches only
// the display stage on that same semantic input revision, never its input/output/CBS history.
export class ScriptDisplay {
  private readonly listeners = new Map<string, Set<(display?: Display) => void | Promise<void>>>();
  private readonly passes = new Map<string, Pass>();
  private readonly running = new Set<string>();
  private readonly bases = new Map<string, Basis>();
  // Each shown chat's character, which its unfound asset names are told under.
  private readonly characters = new Map<string, string | null>();
  private runner: Promise<LuaRunner> | null = null;
  private revisions = 0;
  private generations = 0;
  // Whether each script, by its code, holds an editDisplay listener, as its engine said when a pass asked. Only the
  // engine decides who takes part: a listener may be registered under a computed name, which the source does not show.
  private readonly listens = new Map<string, boolean>();

  private readonly stopReload: () => void;

  constructor(
    private readonly store: ObjectStore,
    private readonly open: () => Promise<LuaRunner>,
    private readonly report: (chat: string, result: Displayed | unknown) => void,
    private readonly unfound: UnfoundAssets,
    private readonly tools: Pick<ScriptExecution, 'showers' | 'showing'>,
    effects: Pick<ScriptEffects, 'subscribeReload'>,
  ) {
    this.stopReload = effects.subscribeReload((chat) => this.stale(chat));
  }

  subscribe(chat: string, listener: (display?: Display) => void | Promise<void>) {
    const listeners = this.listeners.get(chat) ?? new Set();
    this.listeners.set(chat, listeners.add(listener));
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      this.listeners.delete(chat);
      this.release(chat);
    };
  }

  close() {
    this.stopReload();
    for (const chat of this.listeners.keys()) this.release(chat);
    this.listeners.clear();
  }

  private release(chat: string) {
    const pass = this.passes.get(chat);
    if (pass) void this.runner?.then((runner) => runner.forgetDisplay(chat, pass.revision));
    this.passes.delete(chat);
    this.bases.delete(chat);
    this.characters.delete(chat);
    this.store.evaluation.forget({ asker: 'screen', chat });
  }

  async display(id: string, chat: Chat, messages: Message[], screen: ChatScope['screen'], signal?: AbortSignal): Promise<Display> {
    const revision = ++this.revisions;
    this.characters.set(id, chat.character);
    const reader = { store: this.store };
    const scope = { ...scopeOf(reader, id, chat, messages), screen };
    const take = pinned(reader, chat);
    const all = scriptsOf(packsOf(this.store, chat));
    const scripts = all.filter(({ code }) => this.listens.get(code) !== false);
    const tools = this.tools.showers(chat);
    if (!scripts.length && !tools.length) {
      const previous = this.passes.get(id);
      if (previous) void this.runner?.then((runner) => runner.forgetDisplay(id, previous.revision));
      this.passes.delete(id);
      return this.told(id, (await this.store.evaluation.display({ asker: 'screen', chat: id }, scope, take, signal)).display);
    }
    // Until an engine has answered, its script is passed all the same, and the source is only a guess at what to show
    // meanwhile: one that names the hook waits empty as a listening one does, any other shows its text as it is.
    const waits = scripts.some(({ code }) => this.listens.get(code) ?? code.includes('editDisplay'));
    const standing = luaStanding(scope);
    const { character, persona } = standing;
    // Of all the bot's scripts, not only those passed: an engine's answer takes its script out of the passes and must
    // not make the others' results stale.
    const generation = this.generation(id, [String(all.length), ...all.map(({ code }) => code), String(tools.length), ...tools.map(({ module, tool }) => `${module}:${tool.file.id}`), ...standing.globals.flat(), character.name, character.description, character.firstMessage, persona.name, persona.description, standing.note]);
    const { display, work } = await this.store.evaluation.display({ asker: 'screen', chat: id }, scope, take, signal, { waits, generation, revision });
    if (!this.listeners.has(id) || signal?.aborted) return this.told(id, display);
    if (work) {
      this.passes.set(id, { revision, generation, scripts, tools, scope, snapshot: luaSnapshot(scope, standing, work.staged, work.start), items: work.items, remaining: work.items.length, installed: false, view: display, signal });
      this.drain(id);
    } else this.passes.delete(id);
    return this.told(id, display);
  }

  private told(chat: string, shown: Display): Display {
    if (shown.stopped) this.report(chat, shown.stopped);
    const character = this.characters.get(chat);
    if (character) this.unfound.add(character, shown.unfound);
    return shown;
  }

  // reloadDisplay: every pass of the chat is made again, its last result shown until then.
  stale(chat: string) {
    const basis = this.bases.get(chat);
    if (basis) basis.generation = ++this.generations;
    void this.tell(chat);
  }

  private generation(chat: string, parts: string[]): number {
    const had = this.bases.get(chat);
    if (had && had.parts.length === parts.length && had.parts.every((part, at) => part === parts[at])) return had.generation;
    const basis = { parts, generation: ++this.generations };
    this.bases.set(chat, basis);
    return basis.generation;
  }

  // One stretch at a time per chat, of the latest pass landed, which the screen shows (ChatScreenRead asks for one at a
  // time): its newest messages, which are the ones on screen. A stretch of a pass replaced meanwhile is not shown, but
  // its results are held (Evaluator) and shown by the passes after it, so a reply being written shows them as it grows.
  // The installed queue owns remaining work; a completion never redisplays the history to rediscover it.
  private drain(chat: string) {
    if (this.running.has(chat)) return;
    this.running.add(chat);
    void (async () => {
      let size = 8;
      for (;;) {
        const pass = this.passes.get(chat);
        if (!pass || !pass.remaining || pass.signal?.aborted || !this.listeners.has(chat)) break;
        const from = Math.max(0, pass.remaining - size);
        const items = pass.items.slice(from, pass.remaining);
        const began = performance.now();
        let batch: DisplayBatch;
        try {
          if (pass.scripts.every(({ code }) => this.listens.get(code) === false)) batch = { texts: items.map((item) => item.text), listening: pass.scripts.map(() => false), errors: [], missing: [], from, remaining: from };
          else {
            const runner = await (this.runner ??= this.open());
            if (!pass.installed) {
              await runner.installDisplay(chat, pass.revision, pass.scripts, pass.snapshot, pass.items.slice(0, pass.remaining));
              pass.installed = true;
            }
            batch = await runner.display(chat, pass.revision, size);
          }
          this.report(chat, batch);
          batch.listening.forEach((listening, at) => this.listens.set(pass.scripts[at]!.code, listening));
          if (pass.tools.length) {
            const lua = batch;
            batch = { ...lua, texts: await this.tools.showing(chat, pass.tools, pass.scope, pass.items.slice(lua.from, lua.from + lua.texts.length).map((item, at) => ({ version: item.version, text: lua.texts[at]! }))) };
          }
        } catch (error) {
          // A pass that cannot be made shows the texts as they were, rather than nothing.
          this.report(chat, error);
          pass.installed = false;
          batch = { texts: items.map((item) => item.text), listening: [], errors: [], missing: [], from, remaining: from };
        }
        size = Math.min(STRETCH_MOST, Math.max(1, Math.round((STRETCH_MS * items.length) / Math.max(1, performance.now() - began))));
        pass.remaining = batch.remaining;
        const rows = pass.items.slice(batch.from, batch.from + batch.texts.length).map((item, at) => ({ version: item.version, text: item.text, stamp: item.stamp, shown: batch.texts[at]! }));
        try {
          const patch = await this.store.evaluation.patch({ asker: 'screen', chat }, pass.revision, pass.generation, rows);
          if (!patch || pass.signal?.aborted || this.passes.get(chat) !== pass || !this.listeners.has(chat)) continue;
          const texts = pass.view.texts.slice();
          const drawn = pass.view.drawn.slice();
          const boxes = pass.view.boxes.slice();
          for (const row of patch.rows) { texts[row.index] = row.text; drawn[row.index] = row.drawn; boxes[row.index] = row.boxes; }
          pass.view = { texts, drawn, boxes, css: patch.css, pass: patch.pass, unfound: patch.unfound, stopped: patch.stopped };
          await this.tell(chat, this.told(chat, pass.view));
        } catch (error) {
          // A stuck patch whose chat was judged is said by the composer; a chat not saved yet cannot be judged from here.
          if (!(error instanceof EvaluationStopped || (error instanceof EvaluationStuck && this.store.projections.verdict(chat) !== null))) { this.report(chat, error); break; }
        }
        if (!pass.remaining) {
          pass.items = [];
          if (pass.scripts.every(({ code }) => this.listens.get(code) === false)) void this.runner?.then((runner) => runner.forgetDisplay(chat, pass.revision));
        }
      }
    })().finally(() => this.running.delete(chat));
  }

  private async tell(chat: string, display?: Display) {
    await Promise.all([...this.listeners.get(chat) ?? []].map((listener) => listener(display)));
  }
}
