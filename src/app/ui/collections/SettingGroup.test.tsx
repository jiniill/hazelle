import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Switch } from '../controls/Switch';
import { SettingRow } from './SettingGroup';

const lone = <Switch label="스위치" checked={false} onChange={() => {}} />;

it("points a row's label at its switch, and draws a sentence, which holds its own controls, without one", () => {
  const row = renderToStaticMarkup(<SettingRow label="스위치" control={lone} />);
  const target = /<label[^>]* for="([^"]+)"/.exec(row)![1]!;
  expect(/<input[^>]* id="([^"]+)"/.exec(row)![1]).toBe(target);

  const sentence = renderToStaticMarkup(<SettingRow label="스위치" sentence={<button type="button">언어</button>} control={lone} />);
  expect(sentence).not.toContain('<label');
  expect(/<input[^>]*>/.exec(sentence)![0]).not.toContain(' id=');
});
