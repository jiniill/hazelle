import { useEffect, useLayoutEffect, useState } from 'react';
import type { Shown } from '../../runtime/chat/talk';
import type { ToolMenu } from '../../runtime/tools/facade';
import { useToolFrames } from '../session';
import { usePanelsBeside } from '../ui';
import { pickStarted } from './infoReply';
import { inspectShown, NO_PANELS, opened, takeCarried, type InfoTab, type InspectTab, type Panel, type Panels } from './panels';

type Dialog = 'rename' | 'reading' | 'persona' | 'prompt' | 'export' | 'onboarding';

// onboarding: the chat opens with that dialog. replyTarget: the message a reply is being written into.
export function useChatPanels(chatId: string, id: string | null, tools: ToolMenu[], onboarding: boolean, memory: boolean, messages: Shown[], replyTarget: string | null) {
  const [dialog, setDialog] = useState<Dialog | null>(() => (onboarding ? 'onboarding' : null));
  const pairs = usePanelsBeside();
  const frames = useToolFrames();
  const [panels, setPanels] = useState<Panels>(NO_PANELS);
  useLayoutEffect(() => {
    const carried = takeCarried(chatId);
    if (carried) setPanels(opened(NO_PANELS, carried, pairs));
  }, []);
  // 장기 기억 turned off closes its panel; nothing opens it while off.
  if (!memory && panels.panel?.kind === 'memory') setPanels({ ...panels, panel: null });
  const { panel } = panels;
  // null follows the latest.
  const [infoPick, setInfoPick] = useState<string | null>(null);
  const open = (next: Panel) => setPanels((current) => opened(current, next, pairs));
  const openInfo = (reply: string, tab: InfoTab) => {
    setInfoPick(reply);
    open({ kind: 'info', tab });
  };
  const askingTool = id === null ? undefined : tools.find(({ module }) => {
    const frame = frames.get(module);
    return frame?.asking && frame.chat === id;
  })?.module;
  useEffect(() => { if (askingTool) setPanels((current) => opened(current, { kind: 'tool', module: askingTool }, pairs)); }, [askingTool, pairs]);
  const flipPanel = (next: Panel, same: (current: Panel) => boolean) => setPanels((current) => (current.panel && same(current.panel) ? { ...current, panel: null } : opened(current, next, pairs)));
  const flipKind = (kind: 'bookmarks' | 'lineage' | 'lore' | 'autopilot' | 'toggles' | 'state') => flipPanel({ kind }, (current) => current.kind === kind);

  useEffect(() => {
    if (replyTarget && panel?.kind === 'info') setInfoPick(pickStarted(messages, replyTarget));
  }, [replyTarget]);

  return {
    panel,
    inspect: inspectShown(panels, pairs),
    infoPick,
    dialog,
    openInfo,
    flipTool: (module: string) => flipPanel({ kind: 'tool', module }, (current) => current.kind === 'tool' && current.module === module),
    actions: {
      bookmarks: () => flipKind('bookmarks'),
      lineage: () => flipKind('lineage'),
      lore: () => flipKind('lore'),
      autopilot: () => flipKind('autopilot'),
      stateDetail: () => flipKind('state'),
      info: (reply: string) => openInfo(reply, panel?.kind === 'info' ? panel.tab : 'reply'),
      pickInfo: setInfoPick,
      switchInfoTab: (tab: InfoTab) => setPanels((current) => (current.panel?.kind === 'info' ? { ...current, panel: { kind: 'info', tab } } : current)),
      flipToggles: () => flipKind('toggles'),
      memory: (record: string | null) => open({ kind: 'memory', record }),
      openInspect: (tab: InspectTab) => open({ kind: 'inspect', tab }),
      switchInspectTab: (tab: InspectTab) => setPanels((current) => current.inspect ? { ...current, inspect: { kind: 'inspect', tab } } : current),
      closeInspect: () => setPanels((current) => ({ ...current, inspect: null })),
      side: (panel: Panel) => open(panel),
      closePanel: () => setPanels((current) => ({ ...current, panel: null })),
      openDialog: (which: Dialog) => setDialog(which),
      closeDialog: () => setDialog(null),
    },
  };
}
