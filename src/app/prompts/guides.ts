import type { GuideId } from '../common/code/cbsCommands';

// inMessage: the example runs as a chat message's own text (tryExample).
export type Example = { written: string; result: string; inMessage?: true };
export type Guide = { title: string; steps: readonly { text: string; example?: Example }[] };

export const GUIDES: Record<GuideId, Guide> = {
  basics: {
    title: '명령어 기본',
    steps: [
      {
        text: '{{ }}로 감싼 텍스트는 명령어예요. 모델에게 보내기 직전에 값으로 바뀌어요.',
        example: { written: '{{user}}와 {{char}}의 이야기', result: '나와 미라의 이야기' },
      },
      { text: '값을 넣는 명령어는 이름 뒤에 ::를 붙이고 값을 써요. 값이 여러 개면 ::로 구분해요.', example: { written: '{{replace::사과 두 개::사과::배}}', result: '배 두 개' } },
      { text: '명령어 안에 다른 명령어를 넣을 수 있어요. 가장 안쪽부터 계산해요.', example: { written: '{{char}}의 이름은 {{length::{{char}}}}글자예요.', result: '미라의 이름은 2글자예요.' } },
      { text: '참은 1, 거짓은 0이에요. 비교 명령어는 결과를 1이나 0으로 반환하지만, 조건문은 1과 true를 모두 참으로 인식해요.', example: { written: '{{greater::{{getvar::호감도}}::20}}', result: '1' } },
      {
        text: '명령어 이름은 대소문자, 띄어쓰기, _와 -를 구분하지 않아요. 없는 이름이거나 필요한 값이 부족하면 적은 그대로 보내요.',
        example: { written: '{{Get_Var::호감도}} {{없는명령어}}', result: '30 {{없는명령어}}' },
      },
    ],
  },
  when: {
    title: '조건',
    steps: [
      {
        text: '#when은 조건이 참이면 안쪽 텍스트를, 거짓이면 {{:else}} 뒤의 텍스트를 넣어요. 값은 is, isnot, >, <, >=, <=로 비교해요.',
        example: { written: '{{#when::{{getvar::호감도}}::>::20}}미라는 나를 믿어요.{{:else}}미라는 나를 경계해요.{{/when}}', result: '미라는 나를 믿어요.' },
      },
      {
        text: '토글 값은 toggle 뒤에 키를 적어서 읽어요. 조건 삽입을 누르면 이 형식으로 들어가요.',
        example: { written: '{{#when::toggle::존댓말}}존댓말로 말해요.{{:else}}반말로 말해요.{{/when}}', result: '존댓말로 말해요.' },
      },
      { text: '채팅 변수가 특정 값과 같은지는 vis로, 다른지는 visnot으로 확인해요.', example: { written: '{{#when::날씨::vis::비}}우산을 챙겨요.{{/when}}', result: '우산을 챙겨요.' } },
      {
        text: 'not은 결과를 반대로 뒤집고, and와 or는 두 조건을 묶어요. 조건이 복잡하면 비교 명령어로 1이나 0을 먼저 만들어서 넣어요.',
        example: { written: '{{#when::{{greater::{{getvar::호감도}}::20}}::and::{{getglobalvar::toggle_존댓말}}}}믿고 존대해요.{{/when}}', result: '믿고 존대해요.' },
      },
    ],
  },
  vars: {
    title: '변수',
    steps: [
      { text: '채팅 변수는 채팅마다 따로 저장되는 값이에요. 봇 메시지나 정규식에서 저장하고, 프롬프트에서는 getvar로 읽어요.', example: { written: '호감도: {{getvar::호감도}}', result: '호감도: 30' } },
      {
        text: '변수 값을 바꾸는 setvar와 addvar는 채팅 메시지 안에서만 작동해요. 이 예시도 메시지 안에서 계산한 결과예요.',
        example: { written: '{{addvar::호감도::5}}지금 호감도: {{getvar::호감도}}', result: '지금 호감도: 35', inMessage: true },
      },
      {
        text: '만들지 않은 변수를 읽으면 빈 텍스트가 나와요. 기본값은 setdefaultvar로 정하고, 이 명령어도 메시지 안에서만 작동해요.',
        example: { written: '{{setdefaultvar::기분::평온}}{{setdefaultvar::호감도::0}}{{getvar::기분}}, {{getvar::호감도}}', result: '평온, 30', inMessage: true },
      },
      { text: '한 텍스트 안에서만 잠깐 쓸 값은 임시 변수에 담아요. 임시 변수는 프롬프트에서도 작동해요.', example: { written: '{{settempvar::말투::다정하게}}미라는 {{tempvar::말투}} 말해요.', result: '미라는 다정하게 말해요.' } },
      { text: '수식을 계산할 때는 변수 이름 앞에 $를 붙여서 값을 읽어요.', example: { written: '{{? $호감도 * 2}}', result: '60' } },
    ],
  },
  lists: {
    title: '배열과 반복',
    steps: [
      { text: '배열은 ["가","나"]처럼 값 여러 개를 JSON 형식으로 묶은 거예요. makearray 명령어로도 만들 수 있어요.', example: { written: '{{makearray::사과::배}}', result: '["사과","배"]' } },
      {
        text: '#each는 배열의 항목을 하나씩 꺼내 안쪽 텍스트를 반복해서 넣어요. as 뒤에 붙인 이름을 {{slot::이름}}에 넣어 항목 값을 읽어요.',
        example: { written: '{{#each {{getvar::가방}} as 물건}}- {{slot::물건}}{{br}}{{/each}}', result: '- 나침반\n- 지도\n' },
      },
      { text: '배열의 항목 개수는 arraylength로, n번째 항목은 arrayelement로 읽어요. 순서는 0번부터 세요.', example: { written: '{{arraylength::{{getvar::가방}}}}개 중 첫째: {{arrayelement::{{getvar::가방}}::0}}', result: '2개 중 첫째: 나침반' } },
      { text: '사전은 키와 값을 짝지어 놓은 JSON이에요. dictelement로 원하는 키의 값을 읽어요.', example: { written: '{{dictelement::{{makedict::이름=미라::나이=20}}::나이}}', result: '20' } },
      {
        text: '배열을 수정하는 명령어는 변경된 새 배열을 반환해요. 변경 사항을 저장하려면 메시지 안에서 setvar로 변수에 다시 저장해야 해요.',
        example: { written: '{{setvar::가방::{{arraypush::{{getvar::가방}}::칼}}}}{{getvar::가방}}', result: '["나침반","지도","칼"]', inMessage: true },
      },
    ],
  },
  func: {
    title: '함수',
    steps: [
      {
        text: '자주 쓰는 텍스트는 #func로 이름을 붙여 두고 {{call}}로 불러와요. 함수를 만든 자리에는 아무 텍스트도 남지 않아요.',
        example: { written: '{{#func 인사}}미라가 손을 흔들어요.{{/func}}{{call::인사}} {{call::인사}}', result: '미라가 손을 흔들어요. 미라가 손을 흔들어요.' },
      },
      { text: 'call 뒤에 값을 함께 넘기면, 함수 안에서 {{arg::1}}, {{arg::2}}처럼 순서대로 읽을 수 있어요.', example: { written: '{{#func 소개}}이름: {{arg::1}}, 나이: {{arg::2}}{{/func}}{{call::소개::미라::20}}', result: '이름: 미라, 나이: 20' } },
      {
        text: '{{return}}을 만나면 함수가 즉시 종료되고 지정한 값을 반환해요. 조건문과 함께 쓰면 상황에 따라 다른 값을 반환할 수 있어요.',
        example: { written: '{{#func 관계}}{{#when::{{arg::1}}::>::50}}{{return::친구}}{{/when}}{{return::지인}}{{/func}}{{call::관계::{{getvar::호감도}}}}', result: '지인' },
      },
    ],
  },
  random: {
    title: '무작위',
    steps: [
      {
        text: 'random은 메시지를 보낼 때마다 값 중 하나를 무작위로 선택해요. 이 예시에서는 결과가 하나로 고정되어 보여요.',
        example: { written: '오늘 날씨: {{random::맑음::흐림::비}}', result: '오늘 날씨: 비' },
      },
      { text: 'pick도 값 중 하나를 무작위로 선택하지만, 같은 채팅에서 메시지 수가 그대로면 다시 보내도 같은 값이 나와요.', example: { written: '{{pick::맑음::흐림::비}}', result: '흐림' } },
      { text: 'randint는 두 수 사이의 정수를, dice와 roll은 주사위를 굴려 나온 눈의 합을 내놓아요. 2d6은 6면체 주사위 두 개예요.', example: { written: '{{randint::1::100}} / {{roll::2d6}}', result: '67 / 7' } },
      { text: 'hash는 같은 텍스트를 넣으면 항상 똑같은 7자리 숫자를 내놓아요.', example: { written: '{{hash::미라}}', result: '2690090' } },
    ],
  },
  literal: {
    title: '글자 그대로',
    steps: [
      { text: '{{ }}를 명령어로 계산하지 않고 글자 그대로 보내려면 #pure로 감싸요. 안쪽 명령어는 바뀌지 않아요.', example: { written: '{{#pure}}{{char}}는 캐릭터 이름 자리예요.{{/pure}}', result: '{{char}}는 캐릭터 이름 자리예요.' } },
      { text: '나중에 실행되는 봇 정규식에서도 명령어가 작동하지 않게 하려면 #escape를 써요. 끝까지 글자 그대로 남아요.', example: { written: '{{#escape}}{{user}}{{/escape}}', result: '{{user}}' } },
      { text: '한두 군데만 글자 그대로 쓰려면 {{bo}}와 {{bc}}로 중괄호 두 개를, {{:}}로 콜론을 넣어요.', example: { written: '{{bo}}char{{bc}}', result: '{{char}}' } },
      { text: '반대로 \\n 같은 기호를 실제 줄바꿈으로 바꾸려면 #code로 감싸요. 이때 직접 엔터로 넣은 줄바꿈과 탭은 삭제돼요.', example: { written: '{{#code}}첫 줄\\n둘째 줄{{/code}}', result: '첫 줄\n둘째 줄' } },
    ],
  },
};
