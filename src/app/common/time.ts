const clock = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const weekday = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
// A day of another year names its year: among chats years old, 12월 20일 alone reads as this year's.
const yearDate = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const yearWeekday = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const sameYear = (at: number, now: number) => new Date(at).getFullYear() === new Date(now).getFullYear();

const daysBetween = (at: number, now: number) => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);

export const timeOfDay = (at: number) => clock.format(at);

export const monthDay = (at: number) => date.format(at);

export const moment = (at: number, now = Date.now()) => `${(sameYear(at, now) ? date : yearDate).format(at)} ${timeOfDay(at)}`;

export function ago(at: number, now = Date.now()): string {
  if (now - at < 60_000) return '방금';
  const days = daysBetween(at, now);
  if (days === 0) return clock.format(at);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return (sameYear(at, now) ? date : yearDate).format(at);
}

export function day(at: number, now = Date.now()): string {
  const days = daysBetween(at, now);
  return days === 0 ? '오늘' : days === 1 ? '어제' : (sameYear(at, now) ? weekday : yearWeekday).format(at);
}
