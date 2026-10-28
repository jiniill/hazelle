import { entryName } from '../../connectors/types';
import type { ReactNode } from 'react';
import type { TranslateSwitches } from '../../model/chat';
import type { TranslateSetup } from '../../runtime/characters';
import { translationPrompt } from '../../runtime/prompts';
import type { translatorOf } from '../../runtime/translate';
import { useSession } from '../session';
import { SettingGroup, SettingRow, Switch } from '../ui';
import { DetailFold } from './DetailFold';
import { describeTranslateFailure } from './failure';
import { IntoLanguage } from './IntoLanguage';
import { appliesTo, TaskModelRow, TaskPromptMenu, type PromptDoor } from './TaskPrompt';

type Props = {
  translate: TranslateSetup;
  translation: ReturnType<typeof translatorOf>;
  card: { name: string } | null;
  // The chat's 번역가의 노트 row. 설정 › 채팅's 번역 page edits the 전역 note under these rows instead.
  note?: ReactNode;
  opens: 'up' | 'down';
  onChange: (change: Partial<TranslateSwitches>) => void;
  onEditPrompt: (door: PromptDoor) => void;
  // Rows that belong with the switches, such as the chat's 캐릭터별 설정.
  children?: ReactNode;
};

// Shared by chat dialog and global settings; fold uncommon settings and count explicit values.
export function TranslateRows({ translate, translation, card, note, opens, onChange, onEditPrompt, children }: Props) {
  const { store } = useSession();
  const prompt = translationPrompt(store, translate.prompt);
  const set = [translate.original, translate.reverse, translate.prompt !== undefined].filter(Boolean).length;
  return (
    <>
      <SettingGroup label="번역">
        <SettingRow
          label="응답 번역"
          sentence={<IntoLanguage before="응답을" after="번역해서 보기" label="응답 번역 언어" value={translate.replyLanguage} opens={opens} onPick={(replyLanguage) => onChange({ replyLanguage })} />}
          control={<Switch label="응답 번역" checked={translate.replies} onChange={(replies) => onChange({ replies })} />}
        />
        <SettingRow
          label="내 메시지 번역"
          sentence={<IntoLanguage before="내 메시지를" after="번역해서 보내기" label="내 메시지 번역 언어" value={translate.inputLanguage} opens={opens} onPick={(inputLanguage) => onChange({ inputLanguage })} />}
          sub={translate.reverse ? '반전 모드에서는 원문으로 보내요' : undefined}
          control={<Switch label="내 메시지 번역" checked={translate.input} disabled={translate.reverse} onChange={(input) => onChange({ input })} />}
        />
        {children}
      </SettingGroup>
      <DetailFold set={set}>
        <SettingRow
          label="원문 함께 보기"
          help="번역된 문단마다 아래에 원문을 작게 함께 표시해요."
          control={<Switch label="원문 함께 보기" checked={translate.original} onChange={(original) => onChange({ original })} />}
        />
        <SettingRow
          label="반전 모드"
          help="모델에게도 화면에 보이는 내용 그대로 보내요."
          control={<Switch label="반전 모드" checked={translate.reverse} onChange={(reverse) => onChange({ reverse })} />}
        />
        {note}
        <SettingRow
          label="번역 프롬프트"
          control={<TaskPromptMenu task="translate" chosen={translate.prompt} heading={appliesTo(card, translate.own)} opens={opens} onPick={(prompt) => onChange({ prompt })} onEdit={onEditPrompt} />}
        />
        <TaskModelRow label="번역 모델" noun="번역" choice={prompt} model={translation.ok ? entryName(translation.route.model) : describeTranslateFailure(translation.failure)} onEdit={onEditPrompt} />
      </DetailFold>
    </>
  );
}
