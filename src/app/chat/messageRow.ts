import { shown } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { foldTerm } from '../../model/search';
import { rowPart, sameFields, sameItems } from './rowPart';
import type { OpenChat } from './useChat';

const NO_PICTURES: Stored<'illustration'>[] = [];
const NO_BADGES: string[] = [];

export type MessageRow = ReturnType<typeof messageRow>;

export function messageRow(chat: OpenChat, index: number) {
  const { names } = chat;
  const message = chat.messages[index]!;
  const version = shown(message).id;
  const drawing = chat.illustrating.get(message.id);
  const remark = (chat.features.mascot && chat.remarks.get(version)) || null;
  return {
    story: rowPart({
      message,
      // Editing starts from the stored text.
      text: chat.texts[index]!,
      decor: chat.decor,
      // The greeting of a chat not started yet: its versions are the other greetings, and it has nothing
      // to regenerate, edit or delete.
      opening: message === chat.opening,
      // The chat's last message: deleting any other asks whether the ones after it go too.
      last: index === chat.messages.length - 1,
      busy: chat.busy,
      branching: chat.branching,
      // 사용량 표시: each reply's usage on a line under it.
      usageShown: chat.usageShown,
    }, { message: Object.is, decor: sameFields }),
    translation: rowPart({
      translatingText: chat.translating.live.get(version) ?? null,
      untranslated: chat.translating.failed.get(version) ?? null,
      // 번역's and 삽화's 기능: off, the message offers neither.
      canTranslate: chat.features.translate,
      awaited: chat.awaited(version),
      flipped: chat.flipped.has(version),
      showOriginal: chat.translate.original,
      shownTranslation: chat.shownTranslation,
    }, { untranslated: Object.is, shownTranslation: Object.is }),
    illustration: rowPart({
      // text with its 삽화's marks as the display left them, null for none (runtime/read-model ChatScreen).
      placed: chat.placed.get(index) ?? null,
      // The shown version's pictures, oldest first, and its 삽화 run, if any.
      pictures: chat.pictures.get(version) ?? NO_PICTURES,
      drawing: drawing?.version === version ? drawing : null,
      canIllustrate: chat.features.illustrate,
      pictureSizes: chat.pictureSizes,
    }, { pictures: sameItems(Object.is), drawing: Object.is, pictureSizes: Object.is }),
    mascot: rowPart({
      // The shown version's 마스코트 line, null with none or with the 기능 off; fresh until opened once on this page.
      remark,
      fresh: remark !== null && chat.fresh(remark),
    }, { remark: Object.is }),
    tools: rowPart({
      // What the chat's tools put on the shown version, and the actions they offer on a message.
      badges: chat.badges.get(version) ?? NO_BADGES,
      toolActions: chat.messageTools,
    }, { badges: sameItems(Object.is), toolActions: Object.is }),
    status: rowPart({ hosted: chat.hosted(index), offered: chat.offered(index) }, { hosted: sameItems(sameFields), offered: sameItems(sameFields) }),
    agents: rowPart({
      // The post agent rewriting the reply shown now (runtime/agents Polisher), null while none is.
      polishing: chat.polishing.get(message.id) ?? null,
      // Whether the chat runs agents of each stage now: 다시 다듬기 and 노트 새로 만들어 다시 생성 are offered by them.
      agents: chat.agents,
    }, { polishing: Object.is, agents: sameFields }),
    speakers: rowPart({
      // Who replies: the chat's character, or with none, the model named on each reply.
      character: names.character,
      // Who the user plays: the chat's persona, which {{user}} names in the prompt, so the row shows the same name the
      // model reads; null for a deleted persona, shown as missing rather than as the account.
      me: names.me,
      modelName: names.modelName,
    }, { character: sameFields, me: sameFields }),
    edit: rowPart({ editing: chat.editing?.id === message.id ? chat.editing : null, replyNext: message.role === 'user' && chat.messages[index + 1]?.role === 'assistant' }, { editing: Object.is }),
    bookmark: rowPart({ bookmarked: chat.bookmarked.has(message.id) }, {}),
    search: rowPart({
      // One of the messages a memory record was made from, marked as StoryMessage's found; the collection seeks the first.
      found: chat.found?.ids.has(message.id) ? chat.found.at : 0,
      // The search bar's current hit, marked until the bar moves on or closes.
      marked: chat.search?.at === message.id,
      // The search term as foldTerm makes it, lit in the text; '' while the bar is closed.
      term: chat.search ? foldTerm(chat.search.term) : '',
    }, {}),
  };
}
