import { useEffect, useMemo, useRef, useState } from 'react';
import { entryName } from '../../connectors/types';
import { resolveAssets, withAttachments } from '../../engine/assets';
import { holdsPersona, unused } from '../../engine/pipeline';
import { calls, keepsPromptOut, shown, type ChatItem, type ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { resetToggles, setToggle } from '../../runtime/characters';
import { chatTranslate, featuresOf } from '../../runtime/features';
import { removeChat, renameChat, restoreChat, restoreRaw } from '../../runtime/chat-log';
import { keepAttachments } from '../../runtime/attachments';
import { branchFrom, pickVersion } from '../../runtime/message-acts';
import { badgesByVersion, toolActions, toolComposer } from './toolMenu';
import type { ScreenAt } from '../../runtime/script-pages';
import { triggersOf } from '../../runtime/script-selection';
import { greetingOf } from '../../runtime/greetings';
import type { Shown } from '../../runtime/talk';
import { blocked, isBlocked, type Target } from '../../runtime/turn-context';
import { packsOf, togglesOf, usageShownOf } from '../../runtime/chat-context';
import { polishAgain, takeTurn, type TurnFailure } from '../../runtime/turn';
import { skippedStep, type Skip, type StepFailure } from '../../runtime/turn-steps';
import { agentsOf } from '../../runtime/agents';
import type { PersonaChoice } from '../../runtime/personas';
import type { PromptChoice } from '../../runtime/prompts';
import { describeTurnFailure } from '../common/failure';
import { NO_PERSONA_SLOT } from '../common/prompt-words';
import { describeUnused } from '../common/unused';
import { useCopy } from '../common/useCopy';
import { BIN_KEEPS, LORE_BUDGET_LABEL } from '../common/words';
import { useAssetUrl, useChatDisplay, useChatMemory, useChatTools, useChildren, useSaves, useSession, useSettings, useStored, useToolFrames, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { storyText, useMenuHandle, usePanelsBeside, useTimePin, useViewport, type BotButton, type Reading } from '../ui';
import { inspectShown, NO_PANELS, opened, type InfoTab, type InspectTab, type Panel, type Panels } from './panels';
import { useSendNotes } from './useSendNotes';
import { displayed } from './exportLog';
import { useDraft } from './useDraft';
import { useToolInput } from './useToolInput';
import { budgetCut, pickStarted } from './infoReply';
import { toggleRows, toggleSaveKey } from './toggles';
import { anchorOf, useFollow } from './useFollow';
import { useStorySteps } from './useStorySteps';
import { useChatSearch } from './useChatSearch';
import { useChatStatus } from './useChatStatus';
import { useMessageEdit } from './useMessageEdit';
import { useNewChat } from './useNewChat';
import { useChatBookmarks } from './useChatBookmarks';
import { useChatIllustrations } from './useChatIllustrations';
import { useChatRemarks } from './useChatRemarks';
import { useChatPolishing } from './useChatPolishing';
import { useChatTranslation } from './useChatTranslation';
import { useChatAttachments } from './useChatAttachments';
import { useChatSettings } from './useChatSettings';
import { joinParts } from './joinParts';

// The chats told this session that a reply's lorebook entries went past the 로어북 최대 분량: each is told once.
const cutTold = new Set<string>();

export type OpenChat = ReturnType<typeof useChat>;

// One actions object flows only between the hubs: ChatScreen, ChatComposer, ChatHeader, ChatLog, ChatMessage and
// ChatMemoryRecord. Leaves receive only the data and callbacks they use; hubs wire those callbacks to action entries.
export type ChatActions = OpenChat['actions'];

// item null is a new chat, saved under chatId with its first message; shelf null is 캐릭터 없이.
export function useChat(chatId: string, item: ChatItem | null, shelf: CharacterShelf<ChatSummary> | null, reply: Reading['reply']) {
  const session = useSession();
  const { store, talk, drafts } = session;
  const saves = useSaves();
  const turn = useTurn(chatId);
  const toast = useToast();
  const copy = useCopy();
  const id = item ? chatId : null;
  const stored = useChatTools(id);
  const { chat, route, prompt, persona, actions: settingActions } = useChatSettings(id, item?.chat ?? null, shelf?.id ?? null);
  const tools = useMemo(() => id === null ? session.tools.menusOf(chat) : stored, [id, chat, stored]);
  useEffect(() => {
    if (!id) return session.tools.draft(chatId, chat);
    void session.tools.warm(id);
    session.scriptInteractions.claims(id);
  }, [id, tools]);
  const toggles = toggleRows(togglesOf(store, chat, prompt));
  const card = shelf?.character.card ?? null;
  const promptOut = keepsPromptOut(card, chat);
  // Any trigger may answer a press: a Lua one by a function of the button's name, a block one by its own name.
  const scripted = triggersOf(packsOf(store, chat)).length > 0;
  // Subscribed for featuresOf, chatTranslate and usageShownOf, which read the settings and the chat's prompt from the store.
  useSettings();
  useStored('prompt', prompt.kind === 'prompt' ? prompt.prompt.id : null);
  const features = featuresOf(store, chat);
  const stages = agentsOf(store, chat);
  const pre = stages.pre.length > 0;
  const post = stages.post.length > 0;
  const agents = useMemo(() => ({ pre, post }), [pre, post]);
  const translate = chatTranslate(store, chat);
  const { unstarted, unsaved, pickGreeting, starting } = useNewChat(chatId, item === null, chat, shelf, translate.replyLanguage);
  const openingMessages = useMemo(() => unstarted ? [unstarted] : [], [unstarted]);
  const [width, height] = useViewport().split('x').map(Number);
  const { messages, display: view, placed, pending: displayPending, error: displayError, retry: retryDisplay, retryRegex, stuck } = useChatDisplay(chatId, { chat, messages: openingMessages }, { width: width!, height: height! });
  const opening = unstarted && messages[0]!;
  // A display that fails after one was shown leaves that one up; one that never showed says so in the log (ChatLog).
  useEffect(() => {
    if (displayError === undefined || displayPending) return;
    toast.error('채팅을 화면에 표시하지 못했어요.', { detail: displayError instanceof Error ? displayError.message : undefined, action: { label: '다시 시도', onClick: retryDisplay } });
  }, [displayError]);
  const { texts, css } = view;
  const bot = shelf?.character.decor !== false;
  const url = useAssetUrl([bot, css]);
  const decor = useMemo(() => ({ bot, css: bot ? resolveAssets(css, url) : '', buttons: scripted ? ('live' as const) : ('inert' as const) }), [bot, css, url, scripted]);
  const names = {
    character: card && { name: card.nickname || card.name, image: shelf!.face },
    me: persona.kind === 'persona' ? { name: persona.persona.value.name, image: persona.persona.value.picture } : null,
    modelName: 'kind' in route ? null : entryName(route.model),
  };
  const { actions: translationActions, ...translation } = useChatTranslation(chatId, chat, messages, texts, translate);
  const { actions: illustrationActions, ...illustration } = useChatIllustrations(chatId, id, chat, messages);
  const { actions: remarkActions, ...remark } = useChatRemarks(chatId, id);
  const polishing = useChatPolishing(chatId);
  const toolData = useChildren('toolchat', id);
  const badges = useMemo(() => badgesByVersion(toolData, tools), [toolData, tools]);
  const frames = useToolFrames();
  const messageTools = useMemo(() => toolActions(tools, session.tools.actions), [tools, frames]);
  const composerTools = useMemo(() => toolComposer(tools), [tools]);
  const busy = turn !== null;
  const last = messages.at(-1);
  const answerable = id !== null && last !== undefined;
  const usageShown = usageShownOf(store);
  // A cost still 확인 중 after a reload is looked up again wherever the usage line shows it, as ChatInfo does for its own.
  useEffect(() => {
    if (!id || !usageShown) return;
    for (const message of messages) {
      const { receipt } = shown(message);
      for (const call of receipt ? calls(receipt) : []) if (call.cost === 'pending') session.costs.settle(id, call);
    }
  }, [id, usageShown, messages]);

  const replyTarget = busy ? (turn.reply.message ?? turn.reply.id) : null;
  const anchor = busy && !turn.reply.continues ? anchorOf(messages, turn.reply.message ?? turn.reply.id) : null;

  const draft = useDraft(id, chat.character);
  const { actions: attachActions, ...attaching } = useChatAttachments(id, draft.key, chat, route);
  const toolInput = useToolInput(chatId, () => (store.get('chat', chatId) ? chatId : draft.key), saved);
  const { follow: toBottom, beforeTurn, seekTo, ...scroll } = useFollow(messages.length, busy, anchor, reply === 'stay');
  const story = useStorySteps(messages, scroll.scrollRef, seekTo, follow);
  const memory = useChatMemory(id);
  const sendNotes = useSendNotes(chatId, unsaved, chat, messages, memory, draft.text, busy || displayPending === true);
  const [dialog, setDialog] = useState<'rename' | 'reading' | 'persona' | 'prompt' | 'export' | null>(null);
  const modelMenu = useMenuHandle();
  const castMenu = useMenuHandle();
  const pairs = usePanelsBeside();
  const [panels, setPanels] = useState<Panels>(NO_PANELS);
  const { panel } = panels;
  const open = (next: Panel) => setPanels((current) => opened(current, next, pairs));
  const openInfo = (reply: string, tab: InfoTab) => {
    setInfoPick(reply);
    open({ kind: 'info', tab });
  };
  const askingTool = id === null ? undefined : tools.find(({ module }) => frames.get(module)?.asking && frames.get(module)?.chat === id)?.module;
  useEffect(() => { if (askingTool) setPanels((current) => opened(current, { kind: 'tool', module: askingTool }, pairs)); }, [askingTool, pairs]);
  const flipPanel = (next: Panel, same: (current: Panel) => boolean) => setPanels((current) => (current.panel && same(current.panel) ? { ...current, panel: null } : opened(current, next, pairs)));
  // null follows the latest.
  const [infoPick, setInfoPick] = useState<string | null>(null);
  const timePin = useTimePin();
  const [branching, setBranching] = useState(false);
  const { found, search, actions: searchActions } = useChatSearch(messages, texts, translation.translating, translation.flipped, seekTo);
  const { bookmarked, actions: bookmarkActions } = useChatBookmarks(id, chat.bookmarks, messages, busy, searchActions.find);
  const { actions: statusActions, ...status } = useChatStatus(chat, shelf?.character ?? null, view, messages);
  const { editing, actions: editActions } = useMessageEdit(id, messages, (message) => ask({ kind: 'regenerate', message: message.id }), translationActions.carryFlip);
  const sending = useRef(false);
  // After a pre-network refusal, derive the current blocker so fixes anywhere clear the composer warning.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;
  // A failed 토큰 절약 call or pre agent, shown on the composer until the next turn, which may ask again without it.
  // skip: what that turn went without, and the failed step.
  const [skippable, setSkippable] = useState<{ failure: StepFailure; target: Target; skip: Skip } | null>(null);

  useEffect(() => {
    if (id) session.memory.check(id);
  }, [id, features.memory]);
  useEffect(() => {
    if (!features.memory) setPanels((current) => (current.panel?.kind === 'memory' ? { ...current, panel: null } : current));
  }, [features.memory]);

  // Only a reply this page asked for has what it sent (runtime/request-log), so it is told the moment that reply lands.
  const lastReply = messages.findLast((message) => message.role === 'assistant');
  const lastCall = lastReply && shown(lastReply).receipt?.id;
  useEffect(() => {
    if (!lastReply || !lastCall || cutTold.has(chatId)) return;
    const cut = budgetCut(session.log.entry(chatId, lastCall)?.prompt?.lore ?? null);
    if (cut === 0) return;
    cutTold.add(chatId);
    toast.show(`켜진 로어북 항목 중 ${cut}개가 빠졌어요`, {
      detail: `${LORE_BUDGET_LABEL}을 넘었어요.`,
      action: { label: '정보 보기', onClick: () => openInfo(lastReply.id, 'lore') },
    });
  }, [lastCall]);

  useEffect(() => {
    if (replyTarget && panel?.kind === 'info') setInfoPick(pickStarted(messages, replyTarget));
  }, [replyTarget]);

  function report(failure: TurnFailure | null, target?: Target, skip: Skip = {}) {
    if (!failure) return;
    if (isBlocked(failure)) return setStopped(true);
    const skipped = target && skippedStep(failure, skip);
    if (skipped) return setSkippable({ ...skipped, target });
    const kept = failure.kind === 'unsaved' ? failure.reply : null;
    toast.error(describeTurnFailure(failure), kept === null ? undefined : { action: { label: '다시 저장', onClick: () => void talk.saveAgain(kept).then(report) } });
  }

  function follow() {
    toBottom();
    timePin.clear();
  }

  function asking() {
    beforeTurn();
    setSkippable(null);
    timePin.clear();
  }

  // The one way a message goes out, typed or one of 오토파일럿's.
  async function say(text: string, skip: Skip = {}) {
    setStopped(false);
    asking();
    const target = { kind: 'send' as const, text };
    const failure = await takeTurn(session, chatId, target, id === null ? starting() : null, skip);
    report(failure, target, skip);
    return failure;
  }

  // Empty sends request a reply. Composer waits for pending pictures; save attachment rows before the turn reads them.
  async function send(skip: Skip = {}) {
    if (busy || sending.current || toolInput.running) return;
    if (!draft.text.trim() && !attaching.attachments.draft.length) {
      if (answerable) ask({ kind: 'answer' }, skip);
      return;
    }
    if (blocked(session, chat)) return setStopped(true);
    sending.current = true;
    try {
      const settled = await Promise.all(drafts.attachments(draft.key).flatMap((each) => (each.kind === 'picture' ? [each.saved] : [])));
      if (settled.some(({ kind }) => kind === 'failed')) {
        toast.show('올리지 못한 이미지가 있어요. 빼고 다시 보내 주세요.');
        return;
      }
      if (talk.snapshot(chatId)) return;
      const taken = drafts.take(draft.key);
      const text = taken.text.trim();
      // Wherever the chat's draft is by now: a new chat may have been saved meanwhile, or not at all.
      const putBack = () => drafts.putBack(store.get('chat', chatId) ? chatId : draft.key, text, taken.attachments);
      const pictures = settled.flatMap((state) => (state.kind === 'saved' ? [state.value] : []));
      const files = taken.attachments.flatMap((each) => (each.kind === 'file' ? [each.value] : []));
      if (pictures.length || files.length) {
        const unstarted = id === null && (await starting().saved);
        const kept = unstarted || (await keepAttachments(store, chatId, pictures, files));
        if (!kept.ok) {
          putBack();
          toast.failed(kept);
          return;
        }
      }
      const failure = await say(withAttachments({ pictures: pictures.map(({ name }) => name), files: files.map(({ name }) => name) }, text), skip);
      // An unsaved reply or a kept failure means the user's message was saved.
      if (failure && failure.kind !== 'unsaved' && !failure.kept) putBack();
      else drafts.release(taken.attachments);
    } finally {
      sending.current = false;
    }
  }

  async function press(button: BotButton | null) {
    const unanswered = () => toast.show('아무 동작도 연결되지 않은 버튼이에요.');
    if (!scripted) return unanswered();
    if (button === null || !(await saved())) return;
    const { waits, answered } = session.scriptCommands.press(chatId, button);
    if (waits) toast.show('앞선 작업이 끝나면 이 버튼이 동작해요.');
    if (!(await answered)) unanswered();
  }

  function ask(target: Target, skip: Skip = {}) {
    if (id && !busy) void asked(id, target, skip);
  }

  async function asked(chat: string, target: Target, skip: Skip = {}) {
    asking();
    const failure = await takeTurn(session, chat, target, null, skip);
    report(failure, target, skip);
    return failure;
  }

  // Read the live turn, not this render's busy value; '' requests 응답 받기 as a typed send does.
  async function sendForTool(chat: string, text: string) {
    if (talk.snapshot(chat)) return 'busy';
    return (text ? await say(text) : await asked(chat, { kind: 'answer' })) ? 'failed' : null;
  }
  // The row as drawn, on the version shown and not under an edit.
  function renderedForTool(at: ScreenAt): Hazelle.Rendered | null {
    const index = at === null ? (greetingOf(messages) ? 0 : -1) : messages.findIndex((each) => each.id === at.id);
    if (index < 0 || (at !== null && shown(messages[index]!).id !== at.version)) return null;
    const { stories, css } = displayed(view, index, bot);
    return { html: stories.join(''), css, text: stories.map(storyText).filter(Boolean).join('\n\n') };
  }
  const toolScreen = useRef({ send: sendForTool, rendered: renderedForTool });
  toolScreen.current = { send: sendForTool, rendered: renderedForTool };
  useEffect(() => id === null ? undefined : session.scriptPages.screen(id, { send: (text) => toolScreen.current.send(id, text), rendered: (at) => toolScreen.current.rendered(at) }), [id]);

  // A send's text went back to the draft, or was kept when its message was saved; either way the composer sends again.
  const sendSkipping = ({ target, skip }: { target: Target; skip: Skip }) => (target.kind === 'send' ? void send(skip) : ask(target, skip));

  function select(message: Shown, index: number) {
    if (!id) return;
    void pickVersion(session, id, message, index).then((saved) => saved.ok || toast.failed(saved));
  }

  // The versions go round: ← on the first lands on the last (user, 2026-10-04). → past a reply's last asks for a new one;
  // a greeting has none to ask for, so it goes round too.
  function swipe(message: Shown, step: -1 | 1) {
    if (busy) return;
    const count = message.versions.length;
    const next = message.selected + step;
    if (message === opening) pickGreeting((next + count) % count);
    else if (next >= count && shown(message).greeting === undefined) ask({ kind: 'regenerate', message: message.id });
    else select(message, (next + count) % count);
  }

  function pick(message: Shown, index: number) {
    if (busy) return;
    if (message === opening) pickGreeting(index);
    else select(message, index);
  }

  async function branch(message: Shown) {
    if (!item || branching) return;
    setBranching(true);
    toast.show('채팅 분기 중…');
    const made = await branchFrom(session, item, message.id);
    setBranching(false);
    if (!made.ok) return toast.failed(made, '채팅을 분기하지 못했어요.');
    navigate({ kind: 'chat', id: made.data });
    toast.show('새 채팅으로 분기했어요.');
  }

  function drop() {
    if (!item) return;
    const { id: dropped, title } = item;
    talk.stop(dropped);
    void removeChat(store, dropped).then((removed) => removed.ok || toast.failed(removed));
    navigate({ kind: 'shelf', character: chat.character });
    toast.undoable(`'${title}' 채팅을 삭제했어요.`, () => {
      const restored = restoreChat(store, dropped);
      navigate({ kind: 'chat', id: dropped });
      return restored;
    }, BIN_KEEPS);
  }

  // A value is the character's, in every chat of it, or shared by every 캐릭터 없이 chat.
  const writeToggle = (key: string, value: string) => setToggle(store, chat.character, key, value);

  function flip(key: string, value: string) {
    void writeToggle(key, value).then((saved) => saved.ok || toast.failed(saved));
  }

  async function reset() {
    // A typed value still waiting would land over the reset.
    await Promise.all(toggles.sections.flatMap(({ rows }) => rows.flatMap(({ toggle }) => (toggle.kind === 'text' ? [saves.flush(toggleSaveKey(chat.character, toggle.key))] : []))));
    void resetToggles(store, chat.character).then((saved) => saved.ok || toast.failed(saved));
    toast.show(`토글 ${toggles.changed}개를 기본값으로 되돌렸어요.`);
  }

  // Scripts/tools require a saved chat, including actions on an unsaved greeting.
  async function saved() {
    const unstarted = id === null && await starting().saved;
    if (unstarted) toast.failed(unstarted);
    return !unstarted;
  }

  function runTool(module: string, run: (chat: string) => Promise<unknown>) {
    void saved().then((ok) => ok && run(chatId)).catch((error: unknown) => session.scriptJournal.report(chatId, error, { kind: 'module', id: module }));
  }

  function rename(name: string) {
    if (!id) return;
    void renameChat(store, id, name).then((saved) => saved.ok || toast.failed(saved));
    setDialog(null);
  }

  return joinParts(status, translation, illustration, remark, attaching, {
    displayPending, displayError, retryDisplay, stuck,
    id,
    item,
    shelf,
    card,
    route,
    prompt,
    persona,
    names,
    note: chat.note,
    illustrateNote: chat.illustrateNote,
    cast: chat.cast ?? [],
    toggles,
    toggleOwner: chat.character,
    notUsed: card && describeUnused(unused(card)),
    promptOut,
    personaNote: personaNote(promptOut, prompt, persona),
    messages,
    texts,
    view,
    decor,
    infoPick,
    features,
    agents,
    translate,
    polishing,
    badges,
    messageTools,
    composerTools,
    toolInput: toolInput.running,
    placed,
    opening,
    last,
    answerable,
    busy,
    sendNotes,
    found,
    search,
    problem,
    skippable,
    editing,
    timePin: timePin.value,
    branching,
    panel,
    inspect: inspectShown(panels, pairs),
    tools,
    bookmarked,
    usageShown,
    dialog,
    modelMenu,
    castMenu,
    draft,
    scroll,
    keys: story.keys,
    stops: story.stops,
    actions: joinParts(story.actions, searchActions, statusActions, editActions, translationActions, illustrationActions, remarkActions, bookmarkActions, settingActions, attachActions, {
      send: () => void send(),
      sendSkipping: () => skippable && sendSkipping(skippable),
      say,
      retryRegex,
      stop: () => talk.stop(chatId),
      regenerate: (message: Shown) => ask({ kind: 'regenerate', message: message.id }),
      regenerateFresh: (message: Shown) => ask({ kind: 'regenerate', message: message.id }, { notes: true }),
      polishAgain: (message: Shown) => void (id && polishAgain(session, id, message.id, shown(message).id)),
      retry: (message: Shown) => ask({ kind: 'retry', message: message.id, version: shown(message).id }),
      continue: (message: Shown) => ask({ kind: 'continue', message: message.id, version: shown(message).id }),
      restoreRaw: (message: Shown) => void (id && restoreRaw(store, id, message).then((saved) => saved.ok || toast.failed(saved))),
      swipe,
      pick,
      copy,
      press: (button: BotButton | null) => void press(button),
      branch,
      bookmarks: () => flipPanel({ kind: 'bookmarks' }, ({ kind }) => kind === 'bookmarks'),
      lore: () => flipPanel({ kind: 'lore' }, ({ kind }) => kind === 'lore'),
      autopilot: () => flipPanel({ kind: 'autopilot' }, ({ kind }) => kind === 'autopilot'),
      follow,
      info: (reply: string) => openInfo(reply, panel?.kind === 'info' ? panel.tab : 'reply'),
      pickInfo: setInfoPick,
      switchInfoTab: (tab: InfoTab) => setPanels((current) => (current.panel?.kind === 'info' ? { ...current, panel: { kind: 'info', tab } } : current)),
      flipToggles: () => flipPanel({ kind: 'toggles' }, ({ kind }) => kind === 'toggles'),
      memory: (record: string | null) => open({ kind: 'memory', record }),
      openInspect: (tab: InspectTab) => open({ kind: 'inspect', tab }),
      switchInspectTab: (tab: InspectTab) => setPanels((current) => current.inspect ? { ...current, inspect: { kind: 'inspect', tab } } : current),
      closeInspect: () => setPanels((current) => ({ ...current, inspect: null })),
      tool: (module: string) => void saved().then((ok) => ok && flipPanel({ kind: 'tool', module }, (current) => current.kind === 'tool' && current.module === module)),
      toolMenu: (module: string, item: string) => runTool(module, (chat) => session.scriptCommands.menu(chat, module, item)),
      toolAction: (module: string, item: string, message: string) => runTool(module, (chat) => session.scriptCommands.action(chat, module, item, message)),
      toolInput: (module: string, item: string) => void toolInput.run(module, item),
      stopToolInput: toolInput.stop,
      side: (panel: Panel) => open(panel),
      closePanel: () => setPanels((current) => ({ ...current, panel: null })),
      openDialog: (which: NonNullable<typeof dialog>) => setDialog(which),
      closeDialog: () => setDialog(null),
      flip,
      writeToggle,
      resetToggles: reset,
      rename,
      drop,
    }),
  });
}

// A missing prompt or persona stops the turn on its own; a request that keeps the prompt out leaves the persona out too.
function personaNote(promptOut: boolean, prompt: PromptChoice, persona: PersonaChoice): string | null {
  if (promptOut || prompt.kind !== 'prompt' || persona.kind !== 'persona') return null;
  if (!holdsPersona(prompt.prompt.value.blocks)) return NO_PERSONA_SLOT;
  return persona.persona.value.description.trim() ? null : '페르소나 설명이 비어 있어요.';
}
