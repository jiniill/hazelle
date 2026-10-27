import MarkdownIt, { type Token } from 'markdown-it';
import { createElement, type ReactNode } from 'react';
import { Link } from '../controls/Link';
import styles from './Written.module.css';

// Never enable HTML/images/tables: authored posts cannot inject markup or external pictures. Preserve single line breaks.
const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false }).disable(['image', 'table']);
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

const WEB = /^https?:\/\//i;
// The screen's title is the page's heading, so a writer's headings sit under it.
const HEADINGS: Record<string, string> = { h1: 'h3', h2: 'h3' };

type Open = { tag: string | null; href?: string; start?: string; children: ReactNode[] };

function render(tokens: Token[]): ReactNode[] {
  let key = 0;
  const root: Open = { tag: null, children: [] };
  const stack = [root];
  const add = (node: ReactNode) => stack.at(-1)!.children.push(node);
  const walk = (list: Token[]) => {
    for (const token of list) {
      if (token.nesting === 1) {
        // A tight list's paragraphs are hidden: its items hold their text directly.
        const tag = token.hidden ? null : token.type === 'heading_open' ? (HEADINGS[token.tag] ?? 'h4') : token.tag;
        stack.push({ tag, href: token.attrGet('href')?.toString(), start: token.attrGet('start')?.toString(), children: [] });
      } else if (token.nesting === -1) {
        const { tag, href, start, children } = stack.pop()!;
        if (tag === null || (tag === 'a' && !WEB.test(href ?? ''))) children.forEach(add);
        else if (tag === 'a') add(<Link key={key++} href={href!}>{children}</Link>);
        else add(createElement(tag, { key: key++, start }, ...children));
      } else if (token.type === 'inline') walk(token.children ?? []);
      else if (token.type === 'text') add(token.content);
      else if (token.type === 'softbreak' || token.type === 'hardbreak') add(<br key={key++} />);
      else if (token.type === 'code_inline') add(<code key={key++}>{token.content}</code>);
      else if (token.type === 'fence' || token.type === 'code_block') add(<pre key={key++}><code>{token.content}</code></pre>);
      else if (token.type === 'hr') add(<hr key={key++} />);
    }
  };
  walk(tokens);
  return root.children;
}

export function Written({ text }: { text: string }) {
  return <div className={styles.written}>{render(md.parse(text, {}))}</div>;
}

export function plainText(text: string): string {
  return md.parse(text, {}).filter((token) => token.type === 'inline').map((token) => token.children!.filter((child) => child.type === 'text' || child.type === 'code_inline').map((child) => child.content).join('')).join(' ');
}
