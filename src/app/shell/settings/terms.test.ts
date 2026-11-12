import { describe, expect, it } from 'vitest';
import { matches } from '../../common/search';
import { FEATURE_NAMES, PAGES, PICTURE_PLACE, TOOL_PAGES, TOOLS } from '../../common/words';
import { FEATURES } from '../../../model/features';
import { EMPTY_SETTINGS } from '../../../model/settings';
import type { SettingsPage } from '../routes';
import { TOOL_PLACES } from '../tools/ToolsNav';
import { hitsOf, hitTexts, subpages } from './terms';

const PLACES = [
  ...(['models', 'connections', 'chat', 'labs', 'prompts', 'personas', 'modules', 'plugins', 'display', 'controls', 'sounds', 'account', 'admin'] satisfies SettingsPage[]).map((page) => ({ page, label: PAGES[page] })),
  ...FEATURES.map((page) => ({ page, label: FEATURE_NAMES[page] })),
].map((place) => ({ ...place, route: { kind: 'settings' } as const }));
const TOOLS_SOUGHT = TOOL_PLACES.map((place) => ({ ...place, where: TOOLS }));
const hits = hitsOf([...PLACES, ...TOOLS_SOUGHT], subpages({ ...EMPTY_SETTINGS, profile: 'main' }, [{ id: 'main' }]));
const search = (words: string) => hits.filter((hit) => matches(words, ...hitTexts(hit)));

const SHOWN = Object.values(
  import.meta.glob<string>(['/src/app/{settings,models,connections,admin,tools}/*.tsx', '/src/app/common/{TranslateRows,IllustrateRows,MemoryFields,ReadingRows,RetriesRow}.tsx', '!**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);
// The element's own label or title, past attributes before it; an inner control's own label is not it.
const LITERAL = /<(?:SettingRow|CountRow|TaskModelRow|Section|Panel)\s+(?:\w+=(?:\{[^}]*\}|"[^"]*")\s+)*(?:label|title)="([^"]+)"/g;
// Shown, but no one searches by them: the usage page's sections, 장기 기억's on-switch.
const NOT_SOUGHT = new Set(['비용', '요일과 시간', '함께한 캐릭터', '요약', '쓰임', '사용']);

describe('설정 검색', () => {
  it('holds every literal title and row label the settings pages show', () => {
    const held = new Set(hits.map(({ term }) => term));
    const shown = new Set(SHOWN.flatMap((text) => [...text.matchAll(LITERAL)].map((match) => match[1]!)));
    expect(shown.size).toBeGreaterThan(40);
    expect([...shown].filter((label) => !held.has(label) && !NOT_SOUGHT.has(label))).toEqual([]);
  });

  it('finds what people ask for, each hit a label on a page', () => {
    for (const words of ['스트리밍', 'API 키', '온도', 'temperature', 'TEMPERATURE', '최대 토큰', '휴지통', '내보내기', '언어', '캐싱', '폰트', '다크', '라이트', '메모리']) expect(search(words), words).not.toEqual([]);
    expect(search('캐시').map(({ term }) => term)).toEqual(expect.arrayContaining(['캐시', '캐시 보호']));
  });

  it('shows the real label for a hidden word', () => {
    for (const [word, label] of [['캐싱', '캐시'], ['폰트', '글꼴'], ['다크', '테마'], ['메모리', '장기 기억'], ['temperature', '온도'], ['최대 토큰', '응답 최대 길이'], ['API 키', 'API 연결']] as const) expect(search(word).map(({ term }) => term), word).toEqual([label]);
  });

  it('opens the pages of 도구, named by the window that holds them', () => {
    expect(search('계산기').map(({ term, where, to }) => [term, where, to])).toEqual([[TOOL_PAGES.calculator, [TOOLS], { kind: 'calculator' }]]);
    expect(search(TOOL_PAGES.translator).find(({ term }) => term === TOOL_PAGES.translator)).toMatchObject({ where: [TOOLS], to: { kind: 'translator' } });
    expect(search('원문').find(({ where }) => where[0] === TOOL_PAGES.translator)?.to).toEqual({ kind: 'translator' });
  });

  it('finds 이미지 위치 by 삽화 위치, on each page that shows it', () => {
    expect(search('삽화 위치').map(({ term, where }) => [term, where])).toEqual(expect.arrayContaining([[PICTURE_PLACE, [FEATURE_NAMES.illustrate]], [PICTURE_PLACE, [PAGES.display]]]));
  });

  it('opens the default 모델 설정 from one of its rows, and 모델 when there is none', () => {
    expect(search('스트리밍').map(({ to }) => to)).toEqual([{ kind: 'profile', id: 'main' }]);
    const none = hitsOf(PLACES, subpages({ ...EMPTY_SETTINGS, profile: 'gone' }, []));
    expect(none.find(({ term }) => term === '스트리밍')?.to).toEqual({ kind: 'models' });
  });

  it('seeks the row a hit names, and nothing on a hit that names the page itself', () => {
    expect(search('스트리밍')[0]?.seek).toBe('스트리밍');
    expect(search('캐싱')[0]?.seek).toBe('캐시');
    expect(hits.find(({ term, where }) => term === '디스플레이' && where.length === 0)?.seek).toBeUndefined();
  });

  it('leads with the page a search names, before the rows that hold the words', () => {
    expect(search('모델')[0]).toMatchObject({ term: PAGES.models, where: [] });
    expect(search('새 연결')[0]).toMatchObject({ where: [PAGES.connections], to: { kind: 'add-connection' } });
  });

  it('keys each row of a result list apart', () => {
    const keys = hits.map(({ where, term }) => `${where}/${term}`);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });
});
