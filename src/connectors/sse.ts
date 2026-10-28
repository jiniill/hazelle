const MAX_EVENT_CHARS = 1024 * 1024;

// Comment lines and other fields are dropped: providers send keep-alive comments such as ": OPENROUTER PROCESSING",
// and every codec reads its event type from the JSON data, not from the event field.
export class SseParser {
  private buffer = '';
  private scanned = 0;
  private readonly boundary = /\r?\n\r?\n/g;

  push(text: string): string[] {
    const events: string[] = [];
    for (let at = 0; at < text.length;) {
      const take = Math.min(text.length - at, MAX_EVENT_CHARS + 4 - this.buffer.length);
      this.buffer += text.slice(at, at + take);
      at += take;
      this.boundary.lastIndex = this.scanned;
      let boundary = this.boundary.exec(this.buffer);
      let consumed = 0;
      while (boundary) {
        if (boundary.index - consumed > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
        events.push(...data(this.buffer.slice(consumed, boundary.index)));
        consumed = this.boundary.lastIndex;
        boundary = this.boundary.exec(this.buffer);
      }
      this.buffer = this.buffer.slice(consumed);
      const partialBoundary = /\r?\n\r?$|\r$/.exec(this.buffer.slice(-3))?.[0].length ?? 0;
      if (this.buffer.length - partialBoundary > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
      // A CRLF boundary can straddle chunks; only its last three characters need another scan.
      this.scanned = Math.max(0, this.buffer.length - 3);
    }
    return events;
  }

  // A stream may end without the blank line after its last event.
  end(): string[] {
    if (this.buffer.length > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
    const events = data(this.buffer);
    this.buffer = '';
    this.scanned = 0;
    return events;
  }
}

function data(frame: string): string[] {
  const lines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return lines.length ? [lines.join('\n')] : [];
}
