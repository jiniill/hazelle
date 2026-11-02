// A scripted conversation for someone with no key yet. Nothing here reaches a model.
export const EXAMPLE = {
  name: '아린',
  about: '밤의 개암나무 숲지기 · 예시',
  greeting: '등불을 들어 당신을 살폈어요. "이 숲에 손님은 오랜만이네요. 길을 잃으셨어요?"',
  choices: [
    { say: '네, 길을 잃은 것 같아요', reply: '아린이 작게 웃으며 등불을 앞으로 내밀었어요. "그럼 잘 오셨어요. 이 불빛만 따라오면 오두막까지 금방이에요. 따뜻한 차도 있고요."' },
    { say: '당신은 누구예요?', reply: '"저는 아린이에요. 이 숲이 잠들 때 깨어 있는 사람이죠." 아린은 어깨에 앉은 반딧불이를 손끝으로 쓸어 주었어요. "이제 당신 이름을 들려줄 차례예요."' },
    { say: '이 숲엔 뭐가 살아요?', reply: '"밤마다 자리를 옮기는 나무, 이름을 물어보는 여우, 그리고 저요." 아린이 장난스럽게 눈을 찡긋했어요. "여우한테는 진짜 이름을 말하면 안 돼요."' },
  ],
} as const;
