import { useCallback, type RefObject } from 'react';
import type { ScriptQuestion } from '../../runtime/scripts/interactions';
import type { ToolFrames, ToolLayer } from '../../runtime/tools/facade';
import { useDisplay } from '../display';
import { useScripts, useSession, useToolFrames } from '../session';
import { FrameLayer } from '../ui';
import { isConsent } from './ask';

type Scroll = RefObject<HTMLElement | null>;

function ChatToolLayer({ module, chat, scrollRef }: { module: string; chat: string; scrollRef: Scroll }) {
  const { tools } = useSession();
  const { display: { mode } } = useDisplay();
  const mount = useCallback((layer: Pick<ToolLayer, 'draw' | 'missed'>) => tools.layer(module, { chat, theme: mode, ...layer }), [tools, module, chat, mode]);
  return <FrameLayer scrollRef={scrollRef} onMount={mount} />;
}

// The frame tools whose layers lie over chat (design §6.10). Not one whose consent the chat is asking for: a box of its layer that only
// shows could be drawn over that card, and a press on it would still be the card's.
export function layered(frames: ToolFrames, questions: ScriptQuestion[], chat: string): string[] {
  const asking = (module: string) => questions.some((asked) => asked.chat === chat && asked.from.kind === 'module' && asked.from.id === module && isConsent(asked.question));
  return [...frames].filter(([module, frame]) => frame.chat === chat && !asking(module)).map(([module]) => module);
}

export function ChatToolLayers({ chat, scrollRef }: { chat: string; scrollRef: Scroll }) {
  const modules = layered(useToolFrames(), useScripts().questions, chat);
  return <>{modules.map((module) => <ChatToolLayer key={module} module={module} chat={chat} scrollRef={scrollRef} />)}</>;
}
