import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { blankStatus, fromType, STATUS_TYPES } from '../../model/statusTypes';
import { StatusEditor } from './StatusEditor';
import { STATUS_BLOCK, STATUS_PROBLEM, STATUS_WORDS } from './statusWords';

// Static markup opens no menu and no ⓘ: what they hold is left out.
vi.mock('../ui/overlays/Menu', async (original) => ({ ...(await original<typeof import('../ui/overlays/Menu')>()), Menu: () => null }));
vi.mock('../ui/overlays/Hint', () => ({ Hint: () => null }));
vi.mock('../display', () => ({ useDisplay: () => ({ display: { theme: 'dark' } }) }));
vi.mock('../toast', () => ({ useToast: () => ({ error: () => {} }) }));

const shown = (definition?: Parameters<typeof StatusEditor>[0]['definition']) => renderToStaticMarkup(<StatusEditor definition={definition} onChange={() => {}} onType={() => {}} />);

it('offers every 유형 and a blank start where nothing is declared', () => {
  const html = shown();
  for (const { name, description } of STATUS_TYPES) expect(html).toMatch(new RegExp(`>${name}<[^]*>${description}<`));
  expect(html).toContain(STATUS_WORDS.blank);
  expect(html).not.toContain(STATUS_WORDS.preview);
});

it.each(STATUS_TYPES)("lists $name's fields, 묶음 and 기록 by name and previews each of its views", (type) => {
  const definition = fromType(type, 'made');
  const html = shown(definition);
  for (const { name } of [...definition.fields, ...definition.groups, ...definition.logs, ...definition.groups.flatMap(({ fields }) => fields), ...definition.logs.flatMap(({ fields }) => fields)]) expect(html).toContain(name);
  // A view that is an app stands on the 휴대폰's home; the others are drawn as a 상태창 each.
  for (const { name, app } of definition.views!) expect(html).toMatch(new RegExp(app ? `<span class="[^"]*label[^"]*">${name}</span>` : `<section[^>]*aria-label="${name}"[^>]*data-mood`));
});

it("lists a view's blocks in order, a tab's set in under it, each saying what it shows and how", () => {
  const html = shown(fromType(STATUS_TYPES.find(({ id }) => id === 'rpg')!, 'made'));
  const order = [STATUS_BLOCK.head, 'HP', 'MP', STATUS_BLOCK.tabs, '지금', '퀘스트', '동료', '전투 기록'].map((word) => html.indexOf(`>${word}<`, html.indexOf(STATUS_WORDS.frame)));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order[0]).toBeGreaterThan(-1);
  expect(html).toContain(`${STATUS_WORDS.log} · ${STATUS_WORDS.all}`);
});

it('says a definition needs a name, and shows a blank one whole with nothing to list', () => {
  const html = shown(blankStatus('made', ' '));
  expect(html).toContain(STATUS_PROBLEM.name);
  for (const none of [STATUS_WORDS.noFields, STATUS_WORDS.noGroups, STATUS_WORDS.noLogs, STATUS_WORDS.noViews]) expect(html).toContain(none);
});
