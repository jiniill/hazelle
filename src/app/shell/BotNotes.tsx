import { useEffect } from 'react';
import { live } from '../../model/library';
import { scriptVoice } from '../common/script-voice';
import { RUNAWAY_FIX } from '../common/failure';
import { BOT_STUCK, MODEL_ROLES, TOOL_DISABLED, TOOL_LATE, TOOL_STALE, TOOL_STUCK } from '../common/words';
import { useScripts, useSession } from '../session';
import { useToast } from '../toast';

// What the bots' scripts say, each shown once as a notice. It stands in the shell, not in the chat screen: a script
// may speak for a chat that is not the one open.
export function BotNotes() {
  const { store, scriptInteractions } = useSession();
  const { notes } = useScripts();
  const toast = useToast();

  useEffect(() => {
    for (const note of notes) {
      scriptInteractions.seen(note.id);
      const from = scriptVoice(store, note.from);
      switch (note.kind) {
        case 'said': {
          // Its chat or speaker was deleted while the script ran, and its words go with it.
          if (!live(store.get('chat', note.chat)) || !from) break;
          toast.said(from, note.text, note.tone === 'error' ? 'warn' : 'plain');
          break;
        }
        case 'failed':
          toast.error(`${from?.name ?? '봇'} 스크립트가 오류로 멈췄어요`, { detail: note.message });
          break;
        case 'missing':
          toast.show(`${from?.name ?? '봇'} · 지원하지 않는 기능을 썼어요`, { detail: note.names.join(', ') });
          break;
        case 'stuck':
          toast.error(note.disabled ? TOOL_DISABLED : note.from?.kind === 'module' ? TOOL_STUCK : BOT_STUCK, { detail: from?.name });
          break;
        case 'runaway':
          toast.error('봇 명령어가 텍스트를 너무 많이 만들어서 멈췄어요', { detail: RUNAWAY_FIX });
          break;
        case 'no-model':
          toast.error(`호출할 ${MODEL_ROLES[note.role]}이 없어요`, { detail: from?.name });
          break;
        case 'late':
          toast.show(TOOL_LATE, { detail: from?.name });
          break;
        case 'memory-held':
          toast.show(`장기 기억은 ${note.by} 플러그인이 맡고 있어요`, { detail: from?.name });
          break;
        case 'stale-reply':
          toast.show(TOOL_STALE, { detail: from?.name });
          break;
        case 'flood':
          toast.error('요청이 너무 잦아서 잠시 막았어요', { detail: from?.name });
          break;
        case 'unsaved':
          toast.failed(note.failure, '봇이 바꾼 내용을 저장하지 못했어요');
          break;
        case 'answer-unsaved':
          toast.failed(note.failure, '허용 여부를 저장하지 못했어요');
          break;
        case 'input-stop':
          toast.show('봇 스크립트가 응답 요청을 취소했어요', { detail: '보낸 메시지는 저장했어요' });
          break;
      }
    }
  }, [notes]);

  return null;
}
