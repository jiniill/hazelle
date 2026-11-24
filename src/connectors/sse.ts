// Only a stream that never sends a boundary should hit this: one event may carry a whole base64 picture (a Gemini
// image part, at 4K tens of MB), which the codec ignores but the parser must still pass.
export const MAX_EVENT_CHARS = 64 * 1024 * 1024;

// Comment lines and other fields are dropped: providers send keep-alive comments such as ": OPENROUTER PROCESSING",
// and every codec reads its event type from the JSON data, not from the event field.
export class SseParser {
  // The event not ended yet, as its pieces came. They are joined once, at its boundary: joining or searching the whole
  // at each chunk copies it each time, which for one event of many MB is its length squared.
  private pieces: string[] = [];
  private length = 0;
  // Its last three characters. A CRLF boundary can straddle chunks, so they are searched again with the next piece.
  private tail = '';
  private readonly boundary = /\r?\n\r?\n/g;

  push(text: string): string[] {
    const events: string[] = [];
    for (let at = 0; at < text.length;) {
      const piece = text.slice(at, at + Math.min(text.length - at, MAX_EVENT_CHARS + 4 - this.length));
      at += piece.length;
      this.boundary.lastIndex = 0;
      if (this.boundary.test(this.tail + piece)) {
        const buffer = this.pieces.join('') + piece;
        this.boundary.lastIndex = this.length - this.tail.length;
        let consumed = 0;
        for (let boundary = this.boundary.exec(buffer); boundary; boundary = this.boundary.exec(buffer)) {
          if (boundary.index - consumed > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
          events.push(...data(buffer.slice(consumed, boundary.index)));
          consumed = this.boundary.lastIndex;
        }
        this.hold(buffer.slice(consumed));
      } else {
        this.pieces.push(piece);
        this.length += piece.length;
        this.tail = (this.tail + piece).slice(-3);
      }
      const partialBoundary = /\r?\n\r?$|\r$/.exec(this.tail)?.[0].length ?? 0;
      if (this.length - partialBoundary > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
    }
    return events;
  }

  // A stream may end without the blank line after its last event.
  end(): string[] {
    if (this.length > MAX_EVENT_CHARS) throw new Error('SSE event is too large');
    const events = data(this.pieces.join(''));
    this.hold('');
    return events;
  }

  private hold(rest: string) {
    this.pieces = rest ? [rest] : [];
    this.length = rest.length;
    this.tail = rest.slice(-3);
  }
}

// An event whose data is empty is not dispatched (WHATWG HTML, server-sent events: dispatch the event).
function data(frame: string): string[] {
  const joined = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  return joined ? [joined] : [];
}
