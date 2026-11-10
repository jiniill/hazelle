// A token as the number scripts work with, read where it may be set again (a frame's own --*): a size in px, a time in ms.
// The build writes a token's 250ms as .25s.
const milliseconds = (time: string) => parseFloat(time) * (time.trim().endsWith('ms') ? 1 : 1000);

export const tokenMs = (name: string, from: Element = document.documentElement) => milliseconds(getComputedStyle(from).getPropertyValue(name));

// A motion role (--motion-*) as a script's animation takes it: its time, then its curve.
export function tokenMotion(name: string, from: Element = document.documentElement) {
  const [time, ...curve] = getComputedStyle(from).getPropertyValue(name).trim().split(/\s+/);
  return { duration: milliseconds(time!), easing: curve.join(' ') };
}

export const tokenPx = (name: string, from: Element = document.documentElement) => parseFloat(getComputedStyle(from).getPropertyValue(name));
