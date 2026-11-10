// A token as the number scripts work with, read where it may be set again (a frame's own --*): a size in px, a time in ms.
export const tokenMs = (name: string, from: Element = document.documentElement) => {
  const time = getComputedStyle(from).getPropertyValue(name);
  return parseFloat(time) * (time.trim().endsWith('ms') ? 1 : 1000);
};

export const tokenPx = (name: string, from: Element = document.documentElement) => parseFloat(getComputedStyle(from).getPropertyValue(name));
