import type { StatusDefinition, StatusField } from './status';

// 유형 (design §6.1 part 1): definitions with their views, as data, to start a definition from. Everything one fills
// can be changed afterwards; a definition made from one keeps no tie to it. The ids inside are a definition's own, so
// two definitions made from one 유형 share them without meeting: only the definition's id is made anew.
export type StatusType = { id: string; name: string; description: string; definition: Omit<StatusDefinition, 'id'> };

const text = (id: string, name: string, start?: string): StatusField => ({ id, name, kind: 'text', ...(start !== undefined && { start }) });
const meter = (id: string, name: string, start: number, more: Partial<Extract<StatusField, { kind: 'gauge' }>> = {}): StatusField => ({ id, name, kind: 'gauge', min: 0, max: 100, start, change: true, ...more });

export const STATUS_TYPES: StatusType[] = [
  {
    id: 'daily',
    name: '일상',
    description: '날짜와 장소, 기분, 할 일',
    definition: {
      name: '일상',
      writer: 'after',
      fields: [
        text('date', '날짜'),
        text('time', '시간'),
        text('place', '장소'),
        text('weather', '날씨'),
        { id: 'mood', name: '기분', kind: 'stage', labels: ['평온', '들뜸', '우울', '짜증', '불안'], start: '평온', main: true },
        text('thought', '속마음'),
        { id: 'todo', name: '할 일', kind: 'list', checked: true },
      ],
      groups: [],
      logs: [],
      views: [
        {
          id: 'diary',
          name: '일기장',
          frame: 'diary',
          mood: 'paper',
          blocks: [
            { kind: 'head', fields: ['date', 'time', 'place', 'weather'] },
            { kind: 'field', field: 'mood' },
            { kind: 'field', field: 'thought', look: 'thought' },
            { kind: 'field', field: 'todo' },
          ],
        },
      ],
    },
  },
  {
    id: 'romance',
    name: '연애',
    description: '호감도와 신뢰, 관계의 단계, 속마음',
    definition: {
      name: '관계',
      writer: 'after',
      fields: [
        meter('love', '호감도', 30, { main: true, tone: 'warm' }),
        meter('trust', '신뢰', 30),
        { id: 'stage', name: '관계', kind: 'stage', labels: ['낯선 사이', '아는 사이', '친구', '썸', '연인'], start: '낯선 사이' },
        text('place', '장소'),
        text('thought', '속마음'),
      ],
      groups: [],
      logs: [{ id: 'moments', name: '기억에 남은 일', fields: [text('what', '내용')] }],
      views: [
        {
          id: 'card',
          name: '카드',
          frame: 'card',
          mood: 'rose',
          blocks: [
            { kind: 'head', fields: ['place'] },
            { kind: 'field', field: 'love', look: 'hearts' },
            { kind: 'field', field: 'trust' },
            { kind: 'field', field: 'stage', look: 'scale' },
            { kind: 'field', field: 'thought', look: 'thought' },
            { kind: 'log', log: 'moments' },
          ],
        },
      ],
    },
  },
  {
    id: 'rpg',
    name: 'RPG',
    description: 'HP와 MP, 소지품, 퀘스트, 동료',
    definition: {
      name: '모험',
      writer: 'after',
      fields: [
        text('place', '장소'),
        { id: 'level', name: '레벨', kind: 'number', start: 1 },
        meter('hp', 'HP', 100, { main: true, tone: 'warm' }),
        meter('mp', 'MP', 100, { tone: 'cool' }),
        { id: 'gold', name: '소지금', kind: 'number', start: 0, change: true, unit: 'G' },
        { id: 'bag', name: '소지품', kind: 'list' },
        { id: 'quests', name: '퀘스트', kind: 'list', checked: true },
      ],
      groups: [
        {
          id: 'party',
          name: '동료',
          open: true,
          members: [],
          fields: [meter('hp', 'HP', 100, { tone: 'warm' }), { id: 'state', name: '상태', kind: 'stage', labels: ['정상', '부상', '기절'], start: '정상' }],
        },
      ],
      logs: [{ id: 'battles', name: '전투 기록', fields: [text('what', '내용')] }],
      views: [
        {
          id: 'hud',
          name: 'HUD',
          frame: 'hud',
          mood: 'neon',
          blocks: [
            { kind: 'head', fields: ['place'] },
            { kind: 'field', field: 'hp' },
            { kind: 'field', field: 'mp' },
            { kind: 'field', field: 'level' },
            { kind: 'field', field: 'gold' },
            {
              kind: 'tabs',
              tabs: [
                { id: 'now', name: '지금', blocks: [{ kind: 'field', field: 'quests' }, { kind: 'field', field: 'bag' }] },
                { id: 'party', name: '동료', blocks: [{ kind: 'records', group: 'party' }] },
                { id: 'log', name: '기록', blocks: [{ kind: 'log', log: 'battles', all: true }] },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'simulation',
    name: '시뮬레이션',
    description: '자금과 평판, 일정, 인물별 호감도',
    definition: {
      name: '현황',
      writer: 'after',
      fields: [
        text('date', '날짜'),
        { id: 'funds', name: '자금', kind: 'number', start: 0, change: true, main: true },
        meter('fame', '평판', 50),
        meter('stress', '스트레스', 0, { tone: 'warm' }),
        { id: 'plan', name: '일정', kind: 'list', checked: true },
      ],
      groups: [
        {
          id: 'people',
          name: '인물',
          open: true,
          members: [],
          fields: [meter('love', '호감도', 30, { tone: 'warm' }), text('tie', '관계')],
        },
      ],
      logs: [{ id: 'events', name: '사건', fields: [text('what', '내용')] }],
      views: [
        {
          id: 'card',
          name: '카드',
          frame: 'card',
          mood: 'hazelle',
          blocks: [
            { kind: 'head', fields: ['date'] },
            { kind: 'field', field: 'funds' },
            { kind: 'field', field: 'fame' },
            { kind: 'field', field: 'stress' },
            { kind: 'field', field: 'plan' },
            { kind: 'records', group: 'people', look: 'rows' },
            { kind: 'log', log: 'events' },
          ],
        },
      ],
    },
  },
  {
    id: 'survival',
    name: '생존',
    description: '체력과 포만감, 수분, 정신력, 소지품',
    definition: {
      name: '생존',
      writer: 'after',
      fields: [
        text('day', '날짜'),
        text('place', '장소'),
        text('weather', '날씨'),
        meter('health', '체력', 100, { tone: 'warm' }),
        meter('food', '포만감', 100, { tone: 'fresh' }),
        meter('water', '수분', 100, { tone: 'cool' }),
        meter('mind', '정신력', 100),
        { id: 'danger', name: '위험', kind: 'stage', labels: ['안전', '주의', '위험'], start: '안전', main: true },
        { id: 'bag', name: '소지품', kind: 'list' },
      ],
      groups: [],
      logs: [],
      views: [
        {
          id: 'hud',
          name: 'HUD',
          frame: 'hud',
          mood: 'forest',
          blocks: [
            { kind: 'head', fields: ['day', 'place', 'weather'] },
            { kind: 'field', field: 'danger', look: 'scale' },
            { kind: 'radar', fields: ['health', 'food', 'water', 'mind'] },
            { kind: 'field', field: 'health' },
            { kind: 'field', field: 'food' },
            { kind: 'field', field: 'water' },
            { kind: 'field', field: 'mind' },
            { kind: 'field', field: 'bag' },
          ],
        },
      ],
    },
  },
];

// A definition started from a 유형, under an id of its own.
export const fromType = (type: StatusType, id: string): StatusDefinition => ({ ...structuredClone(type.definition), id });

// A definition with nothing in it yet.
export const blankStatus = (id: string, name: string): StatusDefinition => ({ id, name, writer: 'after', fields: [], groups: [], logs: [] });
