const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

// Building a DateTimeFormat is costly and time tags run on every render, so one is kept per zone.
const FORMATS = new Map<string, Intl.DateTimeFormat>();

// Read through Intl so the engine never depends on the zone of the device it runs on.
function partsOf(ms: number, timeZone: string): Parts {
  let format = FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'long',
    });
    FORMATS.set(timeZone, format);
  }
  const part = new Map(format.formatToParts(ms).map(({ type, value }) => [type, value]));
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(part.get(type));
  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour'),
    minute: number('minute'),
    second: number('second'),
    weekday: DAYS.indexOf(part.get('weekday')!),
  };
}

export function clockTime(ms: number, timeZone: string): string {
  const { hour, minute, second } = partsOf(ms, timeZone);
  return `${hour}:${minute}:${second}`;
}

export function calendarDate(ms: number, timeZone: string): string {
  const { year, month, day } = partsOf(ms, timeZone);
  return `${year}-${month}-${day}`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

// Tokenize once: sequential replacements let later tokens rewrite earlier output (A in August).
export function formatTime(format: string, ms: number, timeZone: string): string {
  const { year, month, day, hour, minute, second, weekday } = partsOf(ms, timeZone);
  const tokens: Record<string, () => string> = {
    YYYY: () => String(year),
    YY: () => pad(year % 100),
    MMMM: () => MONTHS[month - 1]!,
    MMM: () => MONTHS[month - 1]!.slice(0, 3),
    MM: () => pad(month),
    DDDD: () => pad((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000 + 1, 3),
    DD: () => pad(day),
    dddd: () => DAYS[weekday]!,
    ddd: () => DAYS[weekday]!.slice(0, 3),
    HH: () => pad(hour),
    hh: () => pad(hour % 12 || 12),
    mm: () => pad(minute),
    ss: () => pad(second),
    X: () => String(Math.floor(ms / 1000)),
    x: () => String(ms),
    A: () => (hour < 12 ? 'AM' : 'PM'),
  };
  return format.replace(/YYYY|YY|MMMM|MMM|MM|DDDD|DD|dddd|ddd|HH|hh|mm|ss|X|x|A/g, (token) => tokens[token]!());
}

// Negative when the clocks of the devices that wrote the messages disagree.
export function duration(ms: number): string {
  const seconds = Math.floor(Math.abs(ms) / 1000);
  return `${ms < 0 ? '-' : ''}${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
