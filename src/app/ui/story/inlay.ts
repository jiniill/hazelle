// Use the one retained picture mark, standalone or inside bot HTML; missing/duplicated marks fall back to message end,
// never an unrelated paragraph.
export function inlaid(html: string, mark: string, inlay: string): string {
  const alone = `<p>${mark}</p>`;
  if (html.split(mark).length === 2) return html.includes(alone) ? html.replace(alone, () => `<p>${inlay}</p>`) : html.replace(mark, () => inlay);
  return `${html.replaceAll(alone, '').replaceAll(mark, '')}<p>${inlay}</p>`;
}
