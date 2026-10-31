import { toolId } from '../model/tool';
import { autoDiagnose } from '../runtime/auto-diagnosis';
import type { ToolFrames, ToolMenu } from '../runtime/tools/facade';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PictureUrl } from '../engine/assets';
import type { ChatScope } from '../engine/render';
import { nest, type Filed } from '../model/folders';
import { binned, live } from '../model/library';
import type { Kind, Stored } from '../model/kinds';
import type { ToolManifest } from '../tool-api/manifest';
import type { AccountFacts, Standing } from '../runtime/account';
import type { Memory } from '../model/memory';
import type { Files } from '../runtime/files';
import type { Illustrating } from '../runtime/illustrate';
import type { Commenting } from '../runtime/mascot';
import type { Polishing } from '../runtime/agents';
import type { Likenesses, LikenessRuns } from '../runtime/likeness';
import type { Remembering } from '../runtime/memory';
import { modulesOf } from '../runtime/modules';
import { draftsOf } from '../runtime/tools/drafts';
import type { Session } from '../runtime/session';
import type { ChatScopeRead, Opening } from '../runtime/read-model';
import type { ScriptsState } from '../runtime/script-interactions';
import type { ObjectStore } from '../runtime/store';
import type { Turn } from '../runtime/talk';
import type { Translating } from '../runtime/translate';
import { Saves } from './common/saveQueue';

// admin/localProviders come from session opening; facts track later server answers.
// Guests have no lock/logout, only signup/sign-in doors; signupOpen follows the operator cap.
export type GuestDoors = { signupOpen: boolean; onSignup: () => void; onSignIn: () => void };
export type Account = { admin: boolean; localProviders: readonly string[]; facts: AccountFacts } & (
  | { guest: null; onLock: () => void; onLogout: () => Promise<string | null> }
  | { guest: GuestDoors }
);

// Allow two slow save round trips, but bound outage waits so leaving cannot hang forever.
const LEAVING_WAIT = 10_000;

// A leave held back by unsaved work, which goes anyway when pressed.
export type HeldLeave = { go: () => Promise<string | null> | void };

const SessionContext = createContext<{ session: Session; account: Account; saves: Saves; held: HeldLeave | null } | null>(null);

export function SessionProvider({ session, account, children }: { session: Session; account: Account; children: ReactNode }) {
  // One session's save queues, closed with it: a queue kept past it would write its change into the next account.
  const saves = useMemo(() => new Saves(window, session.store.unsentWrites), [session]);
  useEffect(() => () => saves.close(), [saves]);
  const [held, setHeld] = useState<HeldLeave | null>(null);
  // Leaving closes the session, which drops what has not been written: it waits for the saves, and when they are not
  // stored by the bound it stays and holds the leave for the user to confirm.
  const leaving = useMemo<Account>(() => {
    const after = (go: HeldLeave['go']) => async () => {
      if (await saves.settled(LEAVING_WAIT)) return (await go()) ?? null;
      setHeld({ go });
      return null;
    };
    const quiet = (go: () => void) => () => void after(go)();
    if (account.guest) return { ...account, guest: { ...account.guest, onSignup: quiet(account.guest.onSignup), onSignIn: quiet(account.guest.onSignIn) } };
    return { ...account, onLock: quiet(account.onLock), onLogout: after(account.onLogout) };
  }, [account, saves]);
  return <SessionContext value={{ session, account: leaving, saves, held }}>{children}</SessionContext>;
}

function useOpen() {
  const open = useContext(SessionContext);
  if (!open) throw new Error('session hook outside SessionProvider');
  return open;
}

export const useSession = (): Session => useOpen().session;
export const useAccount = (): Account => useOpen().account;
// For what only an account has, such as 탈퇴: a guest's screens never render it.
export function useSignedIn(): Extract<Account, { guest: null }> {
  const account = useAccount();
  if (account.guest) throw new Error('account-only part rendered for a guest');
  return account;
}
export const useSaves = (): Saves => useOpen().saves;
export const useHeldLeave = (): HeldLeave | null => useOpen().held;
export const useStore = (): ObjectStore => useSession().store;
export const useFiles = (): Files => useSession().files;

export function useStanding(): Standing {
  const { facts } = useAccount();
  return useSyncExternalStore(facts.subscribe, facts.snapshot);
}
export const useLikenesses = (): Likenesses => useSession().likenesses;

// What this session's open chats of the character asked for by name and found no picture for (runtime/assets).
export function useUnfoundAssets(character: string): ReadonlySet<string> {
  const { unfound } = useSession();
  return useSyncExternalStore(unfound.subscribe, () => unfound.of(character));
}

// The function is a new one when a picture has loaded, so what shows pictures renders again.
export function useAssetUrl(inputs: readonly unknown[]): PictureUrl {
  const { assets } = useSession();
  // Keep the chat-id key stable on first save so mounted picture URLs survive.
  // Inputs must cover every condition that changes this consumer's lookups, including no longer showing a picture.
  const version = useSyncExternalStore(assets.subscribe, assets.snapshot);
  const view = useMemo(() => assets.view(), [assets, version, ...inputs]);
  useLayoutEffect(view.hold, [view]);
  return view.url;
}

// Every snapshot below is held until its own inputs change: fresh selector arrays would make React re-render forever.
export function useChats() {
  const { read } = useSession();
  return useSyncExternalStore(read.chats.subscribe, read.chats.snapshot);
}

export function useChatModel(id: string | null) {
  const { read, store } = useSession();
  const exists = id !== null && live(store.get('chat', id)) !== null;
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (id === null || !exists) return;
    const lease = store.retainChat(id);
    void lease.ready.then((failure) => {
      if (failure) autoDiagnose({ event: 'chat-unopened' });
    });
    return lease.release;
  }, [store, id, attempt, exists]);
  const model = id === null ? null : read.chat(id);
  const value = useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
  const scope = id === null ? null : read.scope(id);
  const { state, error } = useSyncExternalStore(scope?.subscribe ?? subscribeNothing, scope?.snapshot ?? snapshotUnloaded);
  return { model: value, state, error, retry };
}

export function useChatSummary(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.summary(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useSummaries() {
  const summaries = useKind('summary');
  const chats = useChats();
  return useMemo(() => {
    const ids = new Set(chats.map((chat) => chat.id));
    return summaries.filter((summary) => summary.parent !== null && ids.has(summary.parent));
  }, [summaries, chats]);
}

export function useLibrary() {
  const { read } = useSession();
  return useSyncExternalStore(read.library.subscribe, read.library.snapshot);
}

function useKind<K extends Kind>(kind: K) {
  const model = useSession().read.kind(kind);
  return useSyncExternalStore(model.subscribe, model.snapshot);
}

export const useConnections = () => useKind('connection');
// A model's reply received in this account, a deleted chat's too (a version with a receipt, Summary.recent): what stops
// offering the tutorials (design §6.17).
export function useReplied() {
  const summaries = useKind('summary');
  return useMemo(() => summaries.some(({ value }) => value.recent.length > 0), [summaries]);
}
export const useShares = () => useKind('share');
// all is the memo's key only: it is a new array exactly when one changed.
function useLive<K extends 'prompt' | 'persona' | 'profile'>(kind: K) {
  const all = useKind(kind);
  return useMemo(() => all.filter(live), [all]);
}
// The folders of one kind as a tree; characters' come with the library (useLibrary).
export function useFolders(kind: Exclude<Filed, 'character'>) {
  const all = useKind('folder');
  return useMemo(() => nest(all, kind), [all, kind]);
}
export const usePrompts = () => useLive('prompt');
export const usePersonas = () => useLive('persona');
export const useProfiles = () => useLive('profile');
// A deleted one is not among them (runtime/modules modulesOf).
export function useModules() {
  const store = useStore();
  const all = useKind('module');
  return useMemo(() => modulesOf(store), [store, all]);
}
// A plugin is a module that holds a tool. 설정 lists the two on pages of their own; everything else treats both as modules.
export function useModulesAndPlugins() {
  const modules = useModules();
  const tools = useTools();
  return useMemo(() => {
    const manifests = new Map(tools.map(({ id, value }) => [id, value.manifest]));
    const plain: Stored<'module'>[] = [];
    const plugins: { module: Stored<'module'>; manifest: ToolManifest }[] = [];
    for (const module of modules) {
      const manifest = manifests.get(toolId(module.id));
      if (manifest) plugins.push({ module, manifest });
      else plain.push(module);
    }
    return { modules: plain, plugins };
  }, [modules, tools]);
}
// 설정 › 플러그인's 만드는 중: the studio's drafts, last edited first.
export function usePluginDrafts() {
  const store = useStore();
  const all = useKind('tooldraft');
  return useMemo(() => draftsOf(store), [store, all]);
}
export function useBin() {
  const modules = useKind('module');
  const prompts = useKind('prompt');
  const personas = useKind('persona');
  const profiles = useKind('profile');
  return useMemo(() => ({ modules: binned(modules), prompts: binned(prompts), personas: binned(personas), profiles: binned(profiles) }), [modules, prompts, personas, profiles]);
}
// parent null is a chat not saved yet, which has none.
export function useChildren<K extends 'lore' | 'asset' | 'illustration' | 'remark' | 'toolchat' | 'inlay'>(kind: K, parent: string | null): Stored<K>[] {
  const { read } = useSession();
  const model = parent === null ? null : read.children(kind, parent);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNone);
}
// Retain per-parent list identities; key parents by contents, not the caller's fresh array identity.
export function useChildrenOf<K extends 'lore' | 'asset'>(kind: K, parents: readonly string[]): Stored<K>[][] {
  const { read } = useSession();
  const key = parents.join();
  const { subscribe, snapshot } = useMemo(() => {
    const models = parents.map((parent) => read.children(kind, parent));
    let held: Stored<K>[][] = [];
    return {
      subscribe: (listener: () => void) => {
        const stops = models.map((model) => model.subscribe(listener));
        return () => stops.forEach((stop) => stop());
      },
      snapshot: () => {
        const lists = models.map((model) => model.snapshot());
        if (lists.length !== held.length || lists.some((list, index) => list !== held[index])) held = lists;
        return held;
      },
    };
  }, [read, kind, key]);
  return useSyncExternalStore(subscribe, snapshot);
}
export function useSettings() {
  const { read } = useSession();
  return useSyncExternalStore(read.settings.subscribe, read.settings.snapshot);
}
export function useUnreadable() {
  const { read } = useSession();
  return useSyncExternalStore(read.unreadable.subscribe, read.unreadable.snapshot);
}

const subscribeNothing = () => () => {};
const snapshotNull = () => null;
const NONE: never[] = [];
const snapshotNone = () => NONE;
const UNLOADED: ChatScopeRead = { state: 'unloaded', error: null };
const snapshotUnloaded = () => UNLOADED;

export function useCharacter(id: string | null) {
  const { read } = useSession();
  const model = id === null ? null : read.character(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useStored<K extends Kind>(kind: K, id: string | null): Stored<K> | null {
  const { read } = useSession();
  const model = id === null ? null : read.object(kind, id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useChatDisplay(id: string, opening: Opening, screen: ChatScope['screen']) {
  const { read, talk, illustrator, display } = useSession();
  const model = useMemo(() => read.screen(id, talk, illustrator, opening, display), [read, talk, illustrator, display, id]);
  // The first layout installs viewport/greeting inputs before the external-store subscription; evaluation publishes asynchronously.
  useLayoutEffect(() => {
    model.setInputs(opening, screen);
  }, [model, opening.chat, opening.messages, screen?.width, screen?.height]);
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot);
  return useMemo(() => ({ ...snapshot, retry: () => void model.refresh(), retryRegex: () => model.retryRegex() }), [snapshot, model]);
}

export function useTurn(chat: string): Turn | null {
  const { talk } = useSession();
  return useSyncExternalStore(talk.subscribe, () => talk.snapshot(chat));
}

export function useWritingChats(): ReadonlySet<string> {
  const { talk } = useSession();
  return useSyncExternalStore(talk.subscribe, talk.writing);
}

export function useTranslating(): Translating {
  const { translator } = useSession();
  return useSyncExternalStore(translator.subscribe, translator.snapshot);
}

export function useChatMemory(id: string | null): Memory | null {
  const { read } = useSession();
  const model = id === null ? null : read.memory(id);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNull);
}

export function useIllustrating(): Illustrating {
  const { illustrator } = useSession();
  return useSyncExternalStore(illustrator.subscribe, illustrator.snapshot);
}

export function useCommenting(): Commenting {
  const { commentator } = useSession();
  return useSyncExternalStore(commentator.subscribe, commentator.snapshot);
}

export function usePolishing(): Polishing {
  const { polisher } = useSession();
  return useSyncExternalStore(polisher.subscribe, polisher.snapshot);
}

// The profiles themselves: useStored('likeness', likenessId(owner)).
export function useLikenessRuns(): LikenessRuns {
  const likenesses = useLikenesses();
  return useSyncExternalStore(likenesses.subscribe, likenesses.snapshot);
}

export function useScripts(): ScriptsState {
  const { scriptInteractions } = useSession();
  return useSyncExternalStore(scriptInteractions.subscribe, scriptInteractions.snapshot);
}

export function useRemembering(): Remembering {
  const { memory } = useSession();
  return useSyncExternalStore(memory.subscribe, memory.snapshot);
}

export function useTool(module: string | null) {
  const owner = useStored('module', module);
  const tool = useStored('tool', module === null ? null : toolId(module));
  return owner && live(owner) ? tool : null;
}
export const useTools = () => useKind('tool');

export function useToolFrames(): ToolFrames {
  const { tools } = useSession();
  return useSyncExternalStore(tools.subscribe, tools.frames);
}

export function useToolHosts(module: string): ReadonlyMap<string, number> | undefined {
  const { tools } = useSession();
  return useSyncExternalStore(tools.subscribe, tools.hosts).get(module);
}

export function useChatTools(chat: string | null): ToolMenu[] {
  const { read, tools } = useSession();
  const model = chat === null ? null : read.tools(chat, tools);
  return useSyncExternalStore(model?.subscribe ?? subscribeNothing, model?.snapshot ?? snapshotNone);
}
