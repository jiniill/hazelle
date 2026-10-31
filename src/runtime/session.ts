import { Tokens } from './token-calibration';
import type { Tools } from './tools/facade';
import { createTools } from './tools/host';
import type { LuaRunner } from './script-binding';
import type { VaultKey } from '../vault/keys';
import { withInside } from '../model/folders';
import { SETTINGS_ID } from '../model/settings';
import { holdAccount, holdPulse, markSeen, type ApiResult } from './api';
import { serverBackend, type Backend } from './backend';
import { AssetUrls, UnfoundAssets } from './assets';
import { Catalogs } from './catalog';
import { seedOrder } from './characters';
import { purgeExpired } from './removal';
import { Costs } from './cost';
import { Credentials } from './credential';
import { Files } from './files';
import { Illustrator } from './illustrate';
import { Likenesses } from './likeness';
import { Commentator } from './mascot';
import { Polisher } from './agents';
import type { Briefs } from './preread';
import { deviceCache } from './device-cache';
import { Drafts } from './drafts';
import type { DeviceCache } from './object-cache';
import { Rememberer } from './memory';
import { RequestLog } from './request-log';
import { addFirstPersona, recordChatPersonas } from './personas';
import { addFirstProfile } from './profiles';
import { addDefaults } from './prompts';
import { holdDiagnosis, sharesDiagnosis } from './auto-diagnosis';
import { sharesPulse } from './pulse';
import { keepSynced, ObjectStore, type PullProgress } from './store';
import { Talk } from './talk';
import { Translator } from './translate';
import { Cues } from './cues';
import { Usage } from './usage';
import { LuaStuck, LuaWorker } from './lua/client';
import { ReadModels } from './read-model';
import { ScriptDisplay } from './script-display';
import { ScriptInteractions } from './script-interactions';
import { ScriptSchedule } from './script-schedule';
import { ScriptJournal } from './script-journal';
import { ScriptEffects } from './script-effects';
import { ScriptReach } from './script-reach';
import { ScriptPages } from './script-pages';
import { ScriptExecution } from './script-execution';
import { ScriptTurns } from './script-turns';
import { ScriptPreview } from './script-preview';
import { ScriptCommands } from './script-commands';
import { Streams } from './streams';
import { backfillSummaries } from './summary';
import { receiveReply, resumeSend } from './turn';
import { saveUpgraded } from './upgrade';
import { accountTransport, countGuest, directTransport, holdTransport, type Transport } from './relay';
import { guestAccount, guestBackend } from './guest-store';

export type Session = {
  transport: Transport;
  username: string;
  store: ObjectStore;
  files: Files;
  assets: AssetUrls;
  unfound: UnfoundAssets;
  talk: Talk;
  log: RequestLog;
  costs: Costs;
  usage: Usage;
  tokens: Tokens;
  translator: Translator;
  cues: Cues;
  memory: Rememberer;
  illustrator: Illustrator;
  likenesses: Likenesses;
  commentator: Commentator;
  polisher: Polisher;
  briefs: Briefs;
  drafts: Drafts;
  streams: Streams;
  scriptInteractions: ScriptInteractions;
  scriptJournal: ScriptJournal;
  scriptPages: ScriptPages;
  scriptTurns: ScriptTurns;
  scriptPreview: ScriptPreview;
  scriptCommands: ScriptCommands;
  tools: Tools;
  credentials: Credentials;
  catalogs: Catalogs;
  read: ReadModels;
  display: ScriptDisplay;
  // Every way out of an open vault (잠그기, 로그아웃) and every restore the store hears end it (app/shell/Workspace).
  close: () => void;
  startBackground: () => void;
};

// Its worker starts, and the VM loads, when a chat's bot first runs Lua, never with the page.
const luaWorker = (): Promise<LuaRunner> => Promise.resolve(new LuaWorker());

// Aborted opens start nothing; cached opens never wait on network. Caller keeps drafts for the unlocked vault.
// Guests use their browser master directly, without a redundant device cache.
export async function openSession(accountId: string, vaultKey: VaultKey, username: string, signal: AbortSignal, progress?: (progress: PullProgress) => void, kept: { backend: Backend; cache?: DeviceCache; transport?: Transport } = { backend: serverBackend(), cache: deviceCache(accountId) }, bindings: { lua?: () => Promise<LuaRunner>; tools?: typeof createTools; drafts?: Drafts } = {}): Promise<ApiResult<Session>> {
  const transport = kept.transport ?? accountTransport;
  const opening = async () => {
    const store = await ObjectStore.open(accountId, vaultKey, kept.backend, kept.cache, signal);
    const pulled = signal.aborted ? { ok: false as const, error: 'stopped' as const } : store.cached ? null : await store.pull({ signal, progress });
    if (!pulled) return { ok: true as const, data: store };
    store.close();
    return pulled;
  };
  let opened = await opening();
  // A store that heard a restore as it opened has ended (ObjectStore.rewind); the next one bootstraps the restored account.
  if (!opened.ok && opened.error === 'timeline-changed') opened = await opening();
  if (!opened.ok) return opened;
  const store = opened.data;
  const files = new Files(kept.backend, store);
  const assets = new AssetUrls(store, files);
  // A new account sees its defaults on the first screen; a cached account fills missing defaults after catch-up.
  const defaults = () => Promise.all([addDefaults(store), addFirstPersona(store, username).then(() => recordChatPersonas(store)), addFirstProfile(store), saveUpgraded(store)]);
  if (!store.cached) await defaults();
  if (signal.aborted) {
    store.close();
    return { ok: false, error: 'stopped' };
  }
  // The opening pull is sent before the switch is read, so the page-load mark rides the next request.
  holdTransport(transport);
  const holdSharing = () => {
    const settings = store.get('settings', SETTINGS_ID)?.value;
    holdPulse(transport.detached && sharesPulse(settings));
    holdDiagnosis(transport.detached && sharesDiagnosis(settings));
  };
  holdSharing();
  markSeen();
  const stopSharing = store.subscribe((changes) => {
    if (changes.some(({ kind }) => kind === 'settings')) holdSharing();
  });

  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  const costs = new Costs(store);
  const usage = new Usage(store);
  const tokens = new Tokens(usage);
  const drafts = bindings.drafts ?? new Drafts();
  const reading = new Set<string>();
  const log = new RequestLog(store);
  const cues = new Cues();
  const translator = new Translator(store, credentials, log, costs, tokens, reading, cues);
  let runner: Promise<LuaRunner> | null = null;
  // Asked for once the session has closed, it makes none: nothing would be left to end it.
  const machine = () => (closing.signal.aborted ? Promise.reject<LuaRunner>(new LuaStuck('closed')) : (runner ??= (bindings.lua ?? luaWorker)()));
  const scriptClosing = new AbortController();
  const scriptInteractions = new ScriptInteractions(store, scriptClosing.signal);
  const scriptSchedule = new ScriptSchedule(store, scriptInteractions, scriptClosing.signal);
  const scriptJournal = new ScriptJournal(store, scriptInteractions, scriptClosing.signal);
  const unfound = new UnfoundAssets();
  const read = new ReadModels(store);
  const scriptReach = new ScriptReach({ tokens, store, read, credentials, log, costs }, scriptInteractions, scriptClosing.signal);
  const likenesses = new Likenesses({ tokens, store, credentials, log, files, catalogs });
  const illustrator = new Illustrator({ tokens, store, credentials, log, files, likenesses });
  const commentator = new Commentator({ tokens, store, credentials, log });
  const polisher = new Polisher({ tokens, store, credentials, log });
  const briefs: Briefs = new Map();
  const scriptEffects = new ScriptEffects({ store, read }, scriptInteractions);
  const scriptPages = new ScriptPages({ store, read }, scriptInteractions, scriptSchedule, scriptReach, scriptEffects, scriptClosing.signal);
  const tools = (bindings.tools ?? createTools)({ store, files }, { pages: scriptPages, journal: scriptJournal });
  const scriptExecution: ScriptExecution = new ScriptExecution({ store, read }, { lua: machine, tools }, scriptSchedule, scriptReach, scriptEffects, scriptJournal, scriptClosing.signal);
  const display = new ScriptDisplay(store, machine, (chat, result) => scriptJournal.report(chat, result), unfound, scriptExecution, scriptEffects);
  const scriptTurns = new ScriptTurns({ store, read }, scriptInteractions, scriptSchedule, scriptExecution, scriptClosing.signal);
  const scriptPreview = new ScriptPreview({ store }, machine, scriptReach, scriptTurns, tools);
  const scriptCommands = new ScriptCommands({ store, read }, tools, scriptSchedule, scriptExecution, scriptClosing.signal);
  const stopScripts = store.subscribe(() => {
    scriptJournal.prune();
    scriptTurns.prune();
  });
  const memory = new Rememberer({ store, read, credentials, log, costs, scriptTurns, tokens }, reading);
  const talk = new Talk(
    store,
    credentials,
    log,
    costs,
    tokens,
    (chat, reply) => scriptTurns.ending(chat, reply),
    // Keep the chat leased past Talk: onOutput can edit the reply, and continuations/translations must read that result.
    (chat, reply) => {
      const lease = store.retainChat(chat);
      // Here, before Talk ends the turn: the reply goes from live to awaited with no render between.
      const settle = translator.expect(chat, reply);
      void scriptTurns.ended(chat, reply).finally(() => {
        void receiveReply(session, chat, reply).finally(() => {
          settle();
          lease.release();
        });
        memory.check(chat);
      });
    },
    reading,
    cues,
  );
  const closing = new AbortController();
  const streams: Streams = new Streams(store, reading, (stream) => {
    const purpose = stream.value.for;
    if (purpose.kind === 'reply') void talk.resume(stream);
    else if (purpose.kind === 'translation') translator.resume(stream, purpose.version);
    else if (purpose.kind === 'memory') memory.resume(stream);
    else void resumeSend({ store, credentials, log, streams }, stream, closing.signal);
  });
  let started = false;
  const stopSync = keepSynced(store, () => { if (started && !closing.signal.aborted) streams.pickUp(); });
  const startBackground = () => {
    if (started || closing.signal.aborted) return;
    started = true;
    void (async () => {
      if (store.cached) {
        const failure = await store.pull();
        if (failure || closing.signal.aborted) return;
        await defaults();
      }
      if (closing.signal.aborted) return;
      streams.pickUp();
      const library = read.library.snapshot();
      void seedOrder(store, [...library.folders.flatMap(withInside), ...library.characters].map(({ id }) => id));
      void backfillSummaries(store, closing.signal);
      // A purge before the ledger's fill took a chat's calls would lose them: the trash empties only once it has.
      void usage.fill(closing.signal).then(() => {
        if (store.get('settings', SETTINGS_ID)?.value.ledger === 'filled') void purgeExpired(store, files, Date.now(), closing.signal);
      });
    })();
  };

  const close = () => {
    closing.abort();
    transport.close();
    stopSharing();
    holdPulse(false);
    holdDiagnosis(false);
    stopSync();
    read.close();
    display.close();
    streams.close();
    talk.close();
    log.close();
    scriptClosing.abort();
    stopScripts();
    scriptTurns.close();
    scriptJournal.close();
    scriptInteractions.close();
    tools.close();
    // One still being made is ended as it is made.
    void runner?.then((made) => made.close());
    translator.close();
    memory.close();
    illustrator.close();
    likenesses.close();
    commentator.close();
    polisher.close();
    costs.close();
    usage.close();
    tokens.clear();
    catalogs.close();
    credentials.close();
    assets.close();
    store.close();
  };
  const session: Session = { transport, tools, username, store, files, assets, unfound, talk, log, costs, usage, tokens, translator, cues, memory, illustrator, likenesses, commentator, polisher, briefs, drafts, streams, scriptInteractions, scriptJournal, scriptTurns, scriptPreview, scriptCommands, scriptPages, credentials, catalogs, read, display, close, startBackground };
  return { ok: true, data: session };
}

export async function openGuestSession(signal: AbortSignal, progress?: (progress: PullProgress) => void, bindings: Parameters<typeof openSession>[6] = {}): Promise<ApiResult<Session>> {
  const { accountId, vaultKey } = await guestAccount();
  if (signal.aborted) return { ok: false, error: 'stopped' };
  holdAccount(null);
  const opened = await openSession(accountId, vaultKey, '손님', signal, progress, { backend: guestBackend(accountId), transport: directTransport(accountId) }, bindings);
  if (opened.ok) countGuest(accountId, 'opened');
  return opened;
}
