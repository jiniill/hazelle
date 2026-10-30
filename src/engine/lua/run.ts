import type { PackOwner } from '../../model/library';
import { LuaFactory, type LuaEngine } from 'wasmoon';
import { runBlocks, type Blocks } from './blocks';
import { ranked } from './similar';
import { chatLorebook } from '../import/convert';
import { asRisuLore } from '../cbs/tags';
import JSON_LUA from './json.lua?raw';
import PRELUDE from './prelude.lua?raw';
import { add, cbs, read, text, working, write, type Acting, type Run, type Snapshot, type Working } from './state';
import { listens, UNSET, type Host, type ModelMessage, type Event, type Outcome, type ScriptError, type Failure, type EditStage, type ScriptUnit } from '../script-api';

// name is for error messages only.
export type Script = Pick<Extract<ScriptUnit, { kind: 'lua' }>, 'kind' | 'name' | 'code' | 'owner'>;

// variables: the writes since the item before it, over the snapshot's.
export type DisplayItem = { index: number; text: string; variables: [string, string][] };
// listening: false for a script whose engine holds no editDisplay listener, which has no part in any pass.
export type Displayed = { texts: string[]; listening: boolean[]; errors: ScriptError[]; missing: string[]; trace?: HookTrace };
export type DisplayBatch = Displayed & { from: number; remaining: number };
type DisplaySession = { revision: number; scripts: Script[]; snapshot: Snapshot; items: DisplayItem[]; variables: Map<string, string>; undo: [string, string | undefined][][]; remaining: number; messages: Working[]; globals: Map<string, string> };

// Only idle worksets count toward this budget. Splitting an active script set loses globals and thrashes every pass.
const IDLE_ENGINES = 8;
// Passed where Risu passes a run's access key. Bots hand it back as each call's first argument and never read it.
const KEY = 'lua';

const DEAF = Symbol('no listener');
const TRIGGER_DEPTH = 10;

// Risu's functions this app lacks: a call records the name in the run's missing list (and the code editor marks it).
export const UNSUPPORTED = [
  'setChatRole', 'request', 'generateImage', 'getCharacterImage', 'getCharacterImageMain',
  'getPersonaImage', 'getPersonaImageMain', 'setName', 'setDescription', 'setCharacterFirstMessage',
];
// Async in Risu, so bots write them with :await(), which a bare nil turns into an error before the bot's own nil check.
const AWAITED = new Set(['request', 'generateImage', 'getCharacterImageMain', 'getPersonaImageMain']);

type Engine = { loaded: HookLog | null; log: HookLog | null; lua: LuaEngine; own: Set<string>; run: Run | null; queue: Promise<unknown>; failed: string | null };
type Lane = RunLane | 'display';
// preview: the 점검 panel's rehearsal of a send, whose engines never share a Lua global with the events' (or the
// reverse), so a rehearsal neither sees nor leaves state a real turn reads.
export type RunLane = 'event' | 'preview';
export type SyntaxProblem = { line: number | null; message: string };
type Workset = { engines: Map<string, Promise<Engine>>; codes: Set<string>; held: number; retired: boolean };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
const failure = (run: Run, error: unknown): Failure => (run.ranAway ? { runaway: true } : { message: describe(error) });
const roleOf = (value: unknown): Working['role'] => (value === 'user' ? 'user' : 'char');
const view = ({ role, data, time }: Working) => ({ role, data, time });

const AX_MODES = new Set(['emotion', 'memory', 'otherAx', 'submodel', 'translate']);

// What a script passes as options, json-encoded by the prelude; anything but an object reads as none, as in Risu.
function luaOptions(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const MODEL_ROLES: Record<string, ModelMessage['role']> = { system: 'system', sys: 'system', user: 'user', assistant: 'assistant', bot: 'assistant', char: 'assistant' };

// owner isolates globals per chat; lane separates display, events and preview engines so an event's question
// cannot block display evaluation.
export class Lua {
  private readonly worksets = new Map<string, Workset>();
  private readonly displays = new Map<string, DisplaySession>();
  private readonly active = new Map<Lane, Workset>();
  private checker: Promise<LuaEngine> | null = null;

  private constructor(
    private readonly factory: LuaFactory,
    private readonly sliceMs: number,
  ) {}

  // wasm: where the browser loads the VM from; node finds its own. sliceMs: a stretch of a script that neither ends
  // nor yields within it is stopped with an error.
  static async create({ wasm, sliceMs = 5000 }: { wasm?: string; sliceMs?: number } = {}): Promise<Lua> {
    const factory = new LuaFactory(wasm);
    await factory.mountFile('json.lua', JSON_LUA);
    return new Lua(factory, sliceMs);
  }

  // The triggers in the packs' order, as Risu walks them: each Lua one called for the event, each block one run when
  // the event is its own.
  async run(owner: string, triggers: (Script | Blocks)[], snapshot: Snapshot, event: Event, host: Host, lane: RunLane, signal?: AbortSignal): Promise<Outcome & { trace: HookTrace }> {
    const workset = this.hold(owner, lane, triggers.filter((trigger): trigger is Script => trigger.kind === 'lua'));
    try {
      const trace: HookTrace = { entries: [], omitted: 0 };
      let active: HookLog | null = null;
      const run: Run & { host: Host } = { owner: null, chat: owner, lore: new Map(), quiet: false, snapshot, variables: new Map(snapshot.variables), globals: new Map(snapshot.globals), written: new ObservedWrites((name, value) => { if (active) boundedItem(active, active.writes, [clipped(active, name), clipped(active, value)]); }), messages: working(snapshot), host, signal, stop: false, reload: false, missing: new ObservedMissing((name) => { if (active && !active.missing.includes(name)) boundedItem(active, active.missing, clipped(active, name)); }), ranAway: false, triggerId: event.kind === 'call' ? event.id : '' };
      const errors: ScriptError[] = [];
      let value = event.kind === 'edit' ? event.value : undefined;
      let handled = false;
      // depth: how many run trigger effects led here; Risu stops at ten, and a deeper one here is the bot's error.
      const failed = (script: Script | Blocks, error: Failure) => {
        const item = { from: script.owner, script: script.name || (script.kind === 'blocks' ? script.on : 'Lua'), ...error };
        errors.push(item);
        if (active) boundedItem(active, active.errors, clippedError(active, item));
      };
      const fire = async (event: Event, depth: number) => {
        for (const script of triggers) {
          if (!listens(script, event)) continue;
          const outer = active;
          const entry = hookLog(event.kind === 'edit' ? event.stage : event.kind === 'call' ? event.name : event.kind === 'button' ? 'button' : `on${event.kind[0]!.toUpperCase()}${event.kind.slice(1)}`, script.owner, script.name);
          const began = performance.now();
          const before = event.kind === 'edit' ? JSON.stringify(value) : undefined;
          const stopped = run.stop;
          active = entry;
          run.owner = script.owner;
          try {
            if (script.kind === 'blocks') {
              handled = entry.handled = true;
              // The triggers it runs speak for their own packs, and the rest of this one for its own.
              const call = async (name: string) => {
                if (depth >= TRIGGER_DEPTH) throw new Error(`triggers ran each other more than ${TRIGGER_DEPTH} deep`);
                await fire({ kind: 'call', name, id: run.triggerId }, depth + 1);
                run.owner = script.owner;
              };
              await runBlocks(script, run as Acting, call).catch((error: unknown) => failed(script, failure(run, error)));
              continue;
            }
            const engine = await this.engine(workset, script);
            await this.exclusive(engine, async () => {
              if (engine.loaded) { keepTrace(trace, engine.loaded); engine.loaded = null; }
              if (engine.failed !== null) return void failed(script, { message: engine.failed });
              engine.run = run;
              engine.log = entry;
              try {
                if (event.kind === 'edit') {
                  const edited = await this.listeners(engine, event.stage, value, event.meta);
                  if (edited === DEAF) return;
                  value = edited ?? value;
                  handled = entry.handled = true;
                  return;
                }
                const name = event.kind === 'call' ? event.name : event.kind === 'button' ? 'onButtonClick' : `on${event.kind[0]!.toUpperCase()}${event.kind.slice(1)}`;
                if (event.kind === 'call' && !engine.own.has(name)) return;
                if (typeof engine.lua.global.get(name) !== 'function') return;
                handled = entry.handled = true;
                if ((await this.call(engine, name, KEY, ...(event.kind === 'button' ? [event.data] : []))) === false) run.stop = true;
              } catch (error) {
                failed(script, failure(run, error));
              } finally {
                engine.run = null;
                engine.log = null;
              }
            });
          } finally {
            entry.duration = performance.now() - began;
            entry.stopped = !stopped && run.stop;
            entry.changed = event.kind === 'edit' && before !== JSON.stringify(value);
            if (entry.handled || entry.errors.length) {
              keepTrace(trace, entry);
            }
            active = outer;
          }
        }
      };
      await fire(event, 0);
      const kept = run.messages.filter((message) => message.origin !== null);
      const origins = new Set(kept.map((message) => message.origin));
      return {
        trace,
        value,
        stop: run.stop,
        handled,
        writes: [...run.written],
        edits: kept.filter((message) => message.data !== message.first).map((message) => ({ index: message.origin!, text: message.data })),
        removed: snapshot.messages.flatMap((_, index) => (origins.has(index) ? [] : [index])),
        added: run.messages.flatMap(({ origin, role, data }, at) => origin === null ? [{ role, text: data, before: run.messages.slice(at + 1).find((next) => next.origin !== null)?.origin ?? null }] : []),
        reload: run.reload,
        lore: [...run.lore.values()],
        errors,
        missing: [...run.missing],
      };
    } finally {
      this.release(workset);
    }
  }

  async installDisplay(owner: string, revision: number, scripts: Script[], snapshot: Snapshot, items: DisplayItem[]): Promise<void> {
    const variables = new Map(snapshot.variables);
    const undo = items.map((item) => item.variables.map(([name, value]): [string, string | undefined] => {
      const previous = variables.get(name);
      variables.set(name, value);
      return [name, previous];
    }));
    this.displays.set(owner, { revision, scripts, snapshot, items, variables, undo, remaining: items.length, messages: working(snapshot), globals: new Map(snapshot.globals) });
  }

  forgetDisplay(owner: string, revision: number) {
    if (this.displays.get(owner)?.revision === revision) this.displays.delete(owner);
  }

  // Each item's text after every script's editDisplay listeners, in order; an item a script fails on keeps the text
  // it had. Stretches start newest-first, but each stretch threads its input variable deltas oldest-first.
  async display(owner: string, revision: number, size: number): Promise<DisplayBatch> {
    const session = this.displays.get(owner);
    if (!session || session.revision !== revision) throw new Error('Display session expired');
    const { scripts, snapshot, messages, globals } = session;
    const from = Math.max(0, session.remaining - size);
    const items = session.items.slice(from, session.remaining);
    while (session.remaining > from) {
      const changes = session.undo[--session.remaining]!;
      for (let at = changes.length - 1; at >= 0; at--) {
        const [name, previous] = changes[at]!;
        if (previous === undefined) session.variables.delete(name);
        else session.variables.set(name, previous);
      }
    }
    const workset = this.hold(owner, 'display', scripts);
    try {
      const errors: ScriptError[] = [];
      const trace: HookTrace = { entries: [], omitted: 0 };
      const missing = new Set<string>();
      const texts = items.map((item) => item.text);
      const listening = scripts.map(() => true);
      for (const [place, script] of scripts.entries()) {
        const engine = await this.engine(workset, script);
        await this.exclusive(engine, async () => {
          if (engine.loaded) { keepTrace(trace, engine.loaded); engine.loaded = null; }
          if (engine.failed !== null) return void errors.push({ from: script.owner, script: script.name, message: engine.failed });
          const variables = new Map(session.variables);
          for (const [at, item] of items.entries()) {
            for (const [name, value] of item.variables) variables.set(name, value);
            const entry = hookLog('editDisplay', script.owner, script.name);
            const began = performance.now();
            const before = texts[at];
            const run: Run = { owner: script.owner, chat: owner, lore: new Map(), quiet: true, snapshot, variables, globals, written: new ObservedWrites((name, value) => boundedItem(entry, entry.writes, [clipped(entry, name), clipped(entry, value)])), messages, host: null, stop: false, reload: false, missing: new ObservedMissing((name) => { missing.add(name); if (!entry.missing.includes(name)) boundedItem(entry, entry.missing, clipped(entry, name)); }), ranAway: false, triggerId: '' };
            engine.run = run;
            engine.log = entry;
            try {
              const edited = await this.listeners(engine, 'editDisplay', texts[at], { index: item.index });
              if (edited === DEAF) return void (listening[place] = false);
              entry.handled = true;
              if (typeof edited === 'string') texts[at] = edited;
            } catch (error) {
              const item = { from: script.owner, script: script.name, ...failure(run, error) };
              if (!errors.some((known) => known.script === script.name)) errors.push(item);
              boundedItem(entry, entry.errors, clippedError(entry, item));
            } finally {
              entry.duration = performance.now() - began;
              entry.changed = texts[at] !== before;
              // A display pass runs once per shown message; a quiet run kept here would push the turn's hooks out of
              // the page log's bound.
              if (entry.logs.length || entry.errors.length) keepTrace(trace, entry);
              engine.run = null;
              engine.log = null;
            }
          }
        });
      }
      if (from === 0 && this.displays.get(owner) === session) this.displays.delete(owner);
      return { texts, listening, errors, missing: [...missing], trace, from, remaining: from };
    } finally {
      this.release(workset);
    }
  }

  // Ends every engine, and with them their Lua globals. A run after it starts its engines anew.
  close() {
    this.displays.clear();
    for (const workset of this.worksets.values()) {
      workset.retired = true;
      if (!workset.held) this.dispose(workset);
    }
    this.worksets.clear();
    this.active.clear();
    void this.checker?.then((engine) => engine.global.close());
    this.checker = null;
  }

  // The value after the engine's listeners for the stage, or DEAF when it holds none.
  private async listeners(engine: Engine, stage: EditStage | 'editDisplay', value: unknown, meta: Record<string, unknown>): Promise<unknown> {
    const answer = await this.call(engine, 'callListenMain', stage, KEY, JSON.stringify(value), JSON.stringify(meta));
    return typeof answer === 'string' ? (JSON.parse(answer) as unknown) : DEAF;
  }

  private call(engine: Engine, name: string, ...args: unknown[]): Promise<unknown> {
    const called = engine.lua.global.get(name) as (...args: unknown[]) => unknown;
    return Promise.resolve(called(...args));
  }

  private exclusive(engine: Engine, task: () => Promise<void>): Promise<void> {
    const next = engine.queue.then(task);
    engine.queue = next.catch(() => {});
    return next;
  }

  private hold(owner: string, lane: Lane, scripts: Script[]): Workset {
    const key = JSON.stringify([owner, lane]);
    const workset = this.worksets.get(key) ?? { engines: new Map(), codes: new Set(), held: 0, retired: false };
    workset.codes = new Set(scripts.map(({ code }) => code));
    workset.held++;
    this.worksets.delete(key);
    this.worksets.set(key, workset);
    this.active.set(lane, workset);
    this.trim();
    return workset;
  }

  private release(workset: Workset) {
    workset.held--;
    // A run awaiting its host at close may still create later scripts' engines. Its retired generation owns those
    // until the last run ends; a new run after close belongs to a separate workset and must remain alive.
    if (workset.retired && !workset.held) this.dispose(workset);
    this.trim();
  }

  private dispose(workset: Workset) {
    for (const engine of workset.engines.values()) end(engine);
    workset.engines.clear();
  }

  private trim() {
    const active = new Set(this.active.values());
    let idle = 0;
    for (const [key, workset] of this.worksets) {
      if (workset.held > 0) continue;
      for (const [code, engine] of workset.engines) {
        if (workset.codes.has(code)) continue;
        workset.engines.delete(code);
        end(engine);
      }
      if (!active.has(workset)) {
        idle += workset.engines.size;
        if (workset.engines.size === 0) this.worksets.delete(key);
      }
    }
    // The latest owner of each lane survives between stretches. A host call still awaiting an answer also pins its
    // whole workset, even if another owner runs meanwhile; no not-yet-visited script may disappear during that run.
    for (const [key, workset] of this.worksets) {
      if (idle <= IDLE_ENGINES) break;
      if (workset.held > 0 || active.has(workset)) continue;
      this.worksets.delete(key);
      idle -= workset.engines.size;
      this.dispose(workset);
    }
  }

  private engine(workset: Workset, script: Script): Promise<Engine> {
    let engine = workset.engines.get(script.code);
    if (!engine) {
      engine = this.start(script);
      workset.engines.set(script.code, engine);
    }
    return engine;
  }

  // A draft's first syntax error, or null; nothing in it runs, so one engine serves every check.
  async check(code: string): Promise<SyntaxProblem | null> {
    const { global } = await (this.checker ??= this.factory.createEngine());
    const top = global.getTop();
    try {
      global.loadString(code, '=code');
      return null;
    } catch (error) {
      const found = /^code:(\d+): (.*)$/s.exec(describe(error));
      return found ? { line: Number(found[1]), message: found[2]! } : { line: null, message: describe(error) };
    } finally {
      global.setTop(top);
    }
  }

  private async start(script: Script): Promise<Engine> {
    // enableProxy off: an object handed to Lua becomes a table, never a live JS object a script could walk.
    const lua = await this.factory.createEngine({ injectObjects: true, enableProxy: false, functionTimeout: this.sliceMs });
    const loaded = hookLog('load', script.owner, script.name, true);
    const began = performance.now();
    const engine: Engine = { loaded: null, log: loaded, lua, own: new Set(), run: null, queue: Promise.resolve(), failed: null };
    this.declare(engine);
    await lua.doString(PRELUDE);
    const before = new Set(globals(lua));
    try {
      const thread = lua.global.newThread();
      const index = lua.global.getTop();
      try {
        thread.loadString(script.code, `=${script.name}`);
        await thread.run(0, { timeout: this.sliceMs });
      } finally {
        lua.global.remove(index);
      }
    } catch (error) {
      engine.failed = describe(error);
    }
    engine.own = new Set(globals(lua).filter((name) => !before.has(name)));
    loaded.duration = performance.now() - began;
    engine.loaded = loaded.logs.length ? loaded : null;
    engine.log = null;
    return engine;
  }

  private declare(engine: Engine) {
    const bind = (name: string, api: (...args: never[]) => unknown) => engine.lua.global.set(name, (...args: never[]) => {
      engine.run?.signal?.throwIfAborted();
      return api(...args);
    });
    const set = (name: string, api: (run: Run, ...args: never[]) => unknown) => bind(name, (_key: unknown, ...args: never[]) => (engine.run ? api(engine.run, ...args) : undefined));
    // What a run does outside itself, which an editDisplay pass and a script outliving its run do not.
    const act = (name: string, api: (run: Acting, ...args: never[]) => unknown, refused: () => unknown = () => undefined) => set(name, (run, ...args) => (run.quiet || !run.host || !run.owner ? refused() : api(run as Acting, ...args)));
    // Async in Risu: refused too, a call answers a promise of nil, for :await() to read.
    const awaited = (name: string, api: (run: Acting, ...args: never[]) => unknown) => act(name, api, () => Promise.resolve());
    const last = (run: Run, role: Working['role']) => run.messages.findLast((message) => message.role === role)?.data;
    const model = (role: 'main' | 'aux') => (run: Acting, prompt: string) => {
      const messages = (JSON.parse(prompt) as { role?: unknown; content?: unknown }[]).map((message) => ({ role: MODEL_ROLES[text(message.role)] ?? 'assistant', content: text(message.content) }));
      return run.host.model(role, messages, run.owner).then((answer) => JSON.stringify(answer));
    };

    set('getChatVar', (run, name: string) => read(run, name));
    set('setChatVar', (run, name: string, value: unknown) => void write(run, name, value));
    set('setChatVarChanged', (run, name: string, value: unknown) => (write(run, name, value) ? true : undefined));
    set('getGlobalVar', (run, name: string) => run.globals.get(name) ?? UNSET);

    set('getChatMain', (run, index: number) => JSON.stringify(run.messages.at(index) ? view(run.messages.at(index)!) : null));
    set('getChatData', (run, index: number) => run.messages.at(index)?.data ?? '');
    set('getChatRole', (run, index: number) => run.messages.at(index)?.role ?? '');
    set('getChatLength', (run) => run.messages.length);
    set('getFullChatMain', (run) => JSON.stringify(run.messages.map(view)));
    set('getRecentChatsMain', (run, count: number) => JSON.stringify(run.messages.slice(Math.max(0, run.messages.length - Math.max(0, Math.floor(count || 0)))).map(view)));
    set('getCharacterLastMessage', (run) => last(run, 'char') ?? run.snapshot.character.firstMessage);
    set('getUserLastMessage', (run) => last(run, 'user') ?? '');

    set('getName', (run) => run.snapshot.character.name);
    set('getDescription', (run) => run.snapshot.character.description);
    set('getCharacterFirstMessage', (run) => run.snapshot.character.firstMessage);
    set('getPersonaName', (run) => run.snapshot.persona.name);
    // Risu evaluates the persona's CBS here and not the character description's.
    set('getPersonaDescription', (run) => cbs(run, run.snapshot.persona.description));
    set('getAuthorsNote', (run) => run.snapshot.note);

    act('setChat', (run, index: number, value: unknown) => {
      const message = run.messages.at(index);
      if (message) message.data = text(value);
    });
    act('removeChat', (run, index: number) => void run.messages.splice(index, 1));
    act('cutChat', (run, start: number, end: number) => void (run.messages = run.messages.slice(start, end)));
    act('addChat', (run, role: unknown, value: unknown) => add(run, roleOf(role), text(value)));
    act('insertChat', (run, index: number, role: unknown, value: unknown) => void run.messages.splice(index, 0, { origin: null, role: roleOf(role), data: text(value), time: Date.now(), first: '' }));

    // The messages given take the chat's place. One at the place of a message of its role is that message, edited;
    // any other is new, and a message no longer at its place is removed.
    act('setFullChatMain', (run, value: string) => {
      const given = (JSON.parse(value) as { role?: unknown; data?: unknown }[]).map((message) => ({ role: roleOf(message.role), data: text(message.data) }));
      const had = run.messages;
      run.messages = given.map(({ role, data }, index) => {
        const at = had[index];
        return at && at.origin !== null && at.role === role ? { ...at, data } : { origin: null, role, data, time: Date.now(), first: '' };
      });
    });

    // Risu's cbs takes no id before its text.
    bind('cbs', (value: unknown) => (engine.run ? cbs(engine.run, text(value)) : undefined));
    // Risu order differs from the prompt: chat-local entries precede modules, with CBS evaluated.
    // This run's same-name write replaces the local entries.
    set('getLoreBooksMain', (run, search: unknown) => {
      const name = text(search);
      const named = run.snapshot.scope.lore.filter(({ value }) => value.name === name);
      const written = run.lore.get(name);
      const own = written ? [written] : named.filter(({ parent }) => parent === run.chat).map(({ value }) => value);
      return JSON.stringify(
        [...own, ...named.filter(({ parent }) => parent !== run.chat).map(({ value }) => value)]
          .map((value) => asRisuLore(value, cbs(run, value.content))),
      );
    });
    // Preserve Risu's omitted-option defaults: order 100, no keys, off.
    act('upsertLocalLoreBook', (run, name: unknown, content: unknown, options: unknown) => {
      const { alwaysActive, insertOrder, key, regex, secondKey } = (options ?? {}) as Record<string, unknown>;
      const entry = chatLorebook([{ comment: text(name), content: text(content), insertorder: insertOrder, mode: 'normal', key, secondkey: secondKey, alwaysActive, selective: !!secondKey, useRegex: regex }]).lore[0]!;
      run.lore.set(entry.name, entry);
    });
    awaited('loadLoreBooksMain', (run, reserve: unknown) =>
      run.host.lore(typeof reserve === 'number' ? reserve : null).then((entries) => JSON.stringify((entries ?? []).map(({ role, text: data }) => ({ data, role: role === 'assistant' ? 'char' : role })))),
    );

    act('stopChat', (run) => void (run.stop = true));
    act('alertNormal', (run, value: unknown) => run.host.say('normal', text(value), run.owner));
    act('alertError', (run, value: unknown) => run.host.say('error', text(value), run.owner));
    act('alertInput', (run, value: unknown) => run.host.ask({ kind: 'input', text: text(value) }, run.owner).then((answer) => answer ?? ''));
    act('alertConfirm', (run, value: unknown) => run.host.ask({ kind: 'confirm', text: text(value) }, run.owner).then((answer) => answer !== null));
    act('alertSelect', (run, options: unknown) => run.host.ask({ kind: 'select', options: Object.values((options ?? {}) as Record<string, unknown>).map(text) }, run.owner).then((answer) => answer ?? ''));
    act('reloadDisplay', (run) => void (run.reload = true));
    act('reloadChat', (run) => void (run.reload = true));
    awaited('getTokens', (run, value: unknown) => run.host.tokens(text(value)));
    act('sleep', (_run, time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time)));
    // Risu's backgroundHTML is the character's, never a module's.
    set('getBackgroundEmbedding', (run) => run.background ?? run.snapshot.scope.card?.background ?? '');
    act('setBackgroundEmbeddingMain', (run, html: unknown) => {
      if (typeof html !== 'string') return Promise.resolve(false);
      return run.host.background(html, run.owner).then((saved) => {
        if (saved) run.background = html;
        return saved;
      });
    });
    awaited('LLMMain', model('main'));
    // Every mode goes to the 보조 모델; an unknown one is refused before any call, as Risu refuses it. useMultimodal is
    // Risu's third argument: no picture goes with a script's call.
    awaited('axLLMMain', (run, prompt: string, _multimodal: unknown, options: unknown) => {
      const mode = text(luaOptions(options).mode ?? 'otherAx');
      if (!AX_MODES.has(mode)) return Promise.resolve(JSON.stringify({ success: false, result: `Error: Invalid axLLM mode: ${mode}` }));
      return model('aux')(run, prompt);
    });
    // nil when a call is refused or fails, as Risu answers a script it does not let call.
    awaited('similarity', (run, source: unknown, values: unknown) => ranked(run, text(source), Object.values((values ?? {}) as Record<string, unknown>).map(text)));

    set('hash', async (_run, value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text(value))))].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    bind('logMain', (value: string) => {
      if (engine.log) boundedItem(engine.log, engine.log.logs, clipped(engine.log, value));
    });
    for (const name of UNSUPPORTED) {
      set(name, (run) => {
        run.missing.add(name);
        return AWAITED.has(name) ? Promise.resolve() : undefined;
      });
    }
  }
}

// Closed once what it is running has ended.
const end = (engine: Promise<Engine>) => void engine.then(({ lua, queue }) => queue.then(() => lua.global.close()));

function globals(lua: LuaEngine): string[] {
  const names: string[] = [];
  lua.global.set('__name', (name: unknown) => void (typeof name === 'string' && names.push(name)));
  lua.doStringSync('for name, value in pairs(_G) do if type(value) == "function" then __name(name) end end __name = nil');
  return names;
}

export type HookLog = {
  stage: string;
  pack: PackOwner | null;
  script: string;
  at: number;
  duration: number;
  logs: string[];
  writes: [string, string][];
  errors: (Failure & { from: PackOwner | null; script: string })[];
  missing: string[];
  stopped: boolean;
  changed: boolean;
  handled: boolean;
  truncated: boolean;
};

// Both sides of the worker boundary are bounded. Scripts separately bounds the page's retained log by serialized size.
export const HOOK_TRACE_LIMITS = { entries: 100, items: 16, text: 1024 } as const;
export type HookTrace = { entries: HookLog[]; omitted: number };

function clipped(entry: HookLog, text: string): string {
  if (text.length > HOOK_TRACE_LIMITS.text) entry.truncated = true;
  return text.slice(0, HOOK_TRACE_LIMITS.text);
}

function hookLog(stage: string, pack: PackOwner | null, script: string, handled = false): HookLog {
  const entry: HookLog = { stage, pack, script, at: Date.now(), duration: 0, logs: [], writes: [], errors: [], missing: [], stopped: false, changed: false, handled, truncated: false };
  entry.stage = clipped(entry, stage);
  entry.script = clipped(entry, script);
  return entry;
}

function clippedError(entry: HookLog, item: HookLog['errors'][number]): HookLog['errors'][number] {
  return 'message' in item ? { ...item, script: clipped(entry, item.script), message: clipped(entry, item.message) } : { ...item, script: clipped(entry, item.script) };
}

function boundedItem<T>(entry: HookLog, items: T[], item: T) {
  if (items.length === HOOK_TRACE_LIMITS.items) { items.shift(); entry.truncated = true; }
  items.push(item);
}

class ObservedWrites extends Map<string, string> {
  constructor(private readonly wrote: (name: string, value: string) => void) { super(); }
  override set(name: string, value: string) { this.wrote(name, value); return super.set(name, value); }
}

class ObservedMissing extends Set<string> {
  constructor(private readonly missed: (name: string) => void) { super(); }
  override add(name: string) { this.missed(name); return super.add(name); }
}

function keepTrace(trace: HookTrace, entry: HookLog) {
  trace.entries.push(entry);
  if (trace.entries.length > HOOK_TRACE_LIMITS.entries) { trace.entries.shift(); trace.omitted++; }
}
