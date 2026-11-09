import { expect, it } from 'vitest';
import tokens from '../foundation/tokens.css?raw';
import frame from './EditorFrame.module.css?raw';

const px = (name: string) => Number(new RegExp(`--${name}: (\\d+)px;`).exec(tokens)![1]);

it("splits only where the open part keeps a phone's width inside its padding, beside the outline", () => {
  const [, least, share, most] = /width: clamp\(var\(--([\w-]+)\), (\d+)%, var\(--([\w-]+)\)\);/.exec(frame)!;
  const outline = (width: number) => Math.min(Math.max(px(least!), (Number(share) / 100) * width), px(most!));
  const [, inset] = /\.page \{[^}]*padding: var\(--[\w-]+\) var\(--([\w-]+)\)/.exec(frame)!;
  const part = (width: number) => width - outline(width) - 2 * px(inset!);
  const split = px('editor-split');
  expect(part(split)).toBeGreaterThanOrEqual(358);
  for (let width = split; width < split + 1000; width += 10) expect(part(width)).toBeGreaterThanOrEqual(part(split));
});
