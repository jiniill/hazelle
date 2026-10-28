import { UNSUPPORTED } from '../../../engine/lua/run';

// Keep completion names equal to engine/lua/run and prelude.lua functions (luaApi.test).
export type LuaFunction = {
  name: string;
  // The call as written, Korean argument names in the parentheses: completion makes each a tab stop.
  form: string;
  text: string;
  // Returns a promise, which the call waits on with :await() inside async(…).
  waits?: true;
};

const fn = (form: string, text: string, waits?: true): LuaFunction => ({ name: form.slice(0, form.indexOf('(')), form, text, ...(waits && { waits }) });

export const LUA_API: readonly LuaFunction[] = [
  fn('getChatVar(id, 이름)', '채팅 변수를 읽어요. 없으면 기본 변수 값을 반환하고, 기본 변수도 없으면 문자열 "null"을 반환해요.'),
  fn('setChatVar(id, 이름, 값)', '채팅 변수에 저장해요. nil을 넣으면 기본 변수 값으로 돌아가요.'),
  fn('setChatVarChanged(id, 이름, 값)', '값이 달라질 때만 저장하고, 저장했으면 true예요.'),
  fn('getGlobalVar(id, 이름)', '채팅의 토글 값을 읽어요.'),
  fn('getState(id, 이름)', 'setState로 저장한 테이블이나 숫자를 읽어요.'),
  fn('setState(id, 이름, 값)', '테이블이나 숫자를 JSON으로 채팅 변수에 저장해요.'),
  fn('setStateChanged(id, 이름, 값)', 'setState와 같지만 값이 달라질 때만 저장하고, 저장했으면 true예요.'),

  fn('getChat(id, 번호)', '해당 번호의 메시지를 { role, data, time } 테이블로 가져와요. 번호는 0부터 시작하며 -1은 마지막 메시지예요.'),
  fn('getChatData(id, 번호)', '해당 메시지의 텍스트예요.'),
  fn('getChatRole(id, 번호)', '해당 메시지를 보낸 역할이에요. user 또는 char예요.'),
  fn('getChatLength(id)', '메시지 개수예요. 첫인사는 세지 않아요.'),
  fn('getFullChat(id)', '모든 메시지를 { role, data, time } 배열로 가져와요.'),
  fn('getRecentChats(id, 개수)', '마지막 메시지들을 개수만큼 읽어요.'),
  fn('getCharacterLastMessage(id)', '캐릭터의 마지막 메시지예요. 없으면 첫인사예요.'),
  fn('getUserLastMessage(id)', '내가 보낸 마지막 메시지예요.'),
  fn('setChat(id, 번호, 글)', '해당 메시지의 텍스트를 수정해요.'),
  fn('addChat(id, 역할, 글)', '마지막에 새 메시지를 추가해요. 역할은 user 또는 char예요.'),
  fn('insertChat(id, 번호, 역할, 글)', '지정한 위치에 메시지를 삽입해요.'),
  fn('removeChat(id, 번호)', '해당 번호의 메시지를 삭제해요.'),
  fn('cutChat(id, 시작, 끝)', '시작 번호부터 끝 번호 직전까지의 메시지만 남겨요.'),
  fn('setFullChat(id, 메시지들)', '채팅 전체 메시지를 { role, data } 배열로 교체해요.'),

  fn('getName(id)', '캐릭터 이름이에요.'),
  fn('getDescription(id)', '캐릭터 설명이에요.'),
  fn('getCharacterFirstMessage(id)', '첫인사예요.'),
  fn('getPersonaName(id)', '페르소나 이름이에요.'),
  fn('getPersonaDescription(id)', '페르소나 설명이에요.'),
  fn('getAuthorsNote(id)', '채팅 노트예요.'),
  fn('getBackgroundEmbedding(id)', '캐릭터의 배경 HTML이에요.'),
  fn('setBackgroundEmbedding(id, html)', '캐릭터의 배경 HTML을 수정해요. 처음 실행할 때는 사용자에게 허용 여부를 물어봐요. async 함수 안에서는 적용 여부를 true/false로, 밖에서는 nil을 반환해요.'),

  fn('getLoreBooks(id, 이름)', '해당 이름의 로어북 항목들을 배열로 가져와요. 내용의 CBS 명령어는 처리된 상태로 들어 있어요.'),
  fn('loadLoreBooks(id, 남길 토큰)', '지금 프롬프트에 들어갈 로어북 항목들이에요.'),
  fn('upsertLocalLoreBook(id, 이름, 내용, 설정)', '이 채팅의 로어북에 항목을 추가하거나 수정해요.'),

  fn('alertNormal(id, 글)', '알림을 띄워요.'),
  fn('alertError(id, 글)', '오류 알림을 띄워요.'),
  fn('alertInput(id, 질문)', '사용자에게 텍스트를 입력받아요. 창을 닫으면 빈 문자열을 반환해요.', true),
  fn('alertConfirm(id, 질문)', '사용자에게 확인 창을 띄워요. 예를 누르면 true를 반환해요.', true),
  fn('alertSelect(id, 선택지들)', '선택지 중 하나를 선택하게 해요. 선택한 번호(0부터 시작)를 문자열로 반환하고, 창을 닫으면 빈 문자열을 반환해요.', true),
  fn('reloadDisplay(id)', '화면을 다시 그려요.'),
  fn('reloadChat(id, 번호)', '화면을 다시 그려요.'),
  fn('stopChat(id)', '이번 응답 요청을 취소해요.'),

  fn('LLM(id, 메시지들)', '대화 모델에 { role, content } 배열을 보내고 { success, result } 테이블을 받아요. async 함수 안에서만 사용할 수 있어요.'),
  fn('axLLM(id, 메시지들, 이미지, 설정)', '보조 모델을 호출해요. 사용법은 LLM과 같아요.'),
  fn('simpleLLM(id, 글)', '대화 모델에 텍스트 프롬프트를 보내고 응답을 받아요.', true),
  fn('getTokens(id, 글)', '텍스트의 토큰 수를 계산해요.', true),
  fn('similarity(id, 글, 후보들)', '기준 텍스트와 의미가 비슷한 순서로 후보 배열을 정렬해요. 실패하면 nil을 반환해요.', true),
  fn('hash(id, 글)', '텍스트의 SHA-256 해시 값을 계산해요.', true),
  fn('sleep(id, 밀리초)', '잠깐 기다려요.', true),
  fn('cbs(글)', '텍스트에 CBS를 적용해요. id를 받지 않아요.'),
  fn('log(값)', '점검의 스크립트 기록에 값을 남겨요.'),

  fn('listenEdit(종류, 함수)', 'editInput, editOutput, editRequest, editDisplay 단계에서 텍스트를 수정할 함수를 등록해요.'),
  fn('async(함수)', '함수 안에서 :await()로 기다릴 수 있게 감싸요.'),
  fn('require(이름)', "require('json')만 사용할 수 있어요."),
];

// The functions the app calls on its own; a script defines them.
export const LUA_EVENTS: readonly LuaFunction[] = [
  fn('onInput(id)', '내 메시지를 보내기 전에 실행돼요.'),
  fn('onStart(id)', '메시지를 보낼 때마다 모델에 요청하기 직전에 실행돼요. false를 반환하면 요청을 보내지 않아요.'),
  fn('onOutput(id)', '응답을 받은 뒤 실행돼요.'),
  fn('onButtonClick(id, 데이터)', '봇이 만든 버튼을 누르면 실행돼요.'),
];

// Set for the prelude's own use, never written by a bot: completion leaves them out.
export const LUA_INTERNAL = ['getChatMain', 'getFullChatMain', 'getRecentChatsMain', 'setFullChatMain', 'getLoreBooksMain', 'loadLoreBooksMain', 'setBackgroundEmbeddingMain', 'LLMMain', 'axLLMMain', 'logMain', 'callListenMain'];

export { UNSUPPORTED as LUA_UNSUPPORTED };
