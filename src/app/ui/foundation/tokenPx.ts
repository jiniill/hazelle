// A size token as the number scripts place things with, read where it may be set again (a frame's own --*).
export const tokenPx = (name: string, from: Element = document.documentElement) => parseFloat(getComputedStyle(from).getPropertyValue(name));
