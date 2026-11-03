// A reply caught in a loop: one visible character 256 times running, or a pattern of up to 128 characters repeated
// back to back over 2,048. Far past YPM's 64 and 256, since a bot's status panel draws borders and rows of empty
// slots that a lower bar would cut.
const SAME_CHAR = 256;
const LONGEST_PATTERN = 128;
const PATTERN_SPAN = 2048;

export class Repetition {
  private readonly recent: string[] = [];
  // matches[period]: how many characters running equal the one period before them.
  private readonly matches = new Uint32Array(LONGEST_PATTERN + 1);
  private run = 0;
  private previous = '';

  // true once the text so far ends in a loop.
  push(text: string): boolean {
    for (const char of text) {
      this.run = char === this.previous ? this.run + 1 : 1;
      this.previous = char;
      this.recent.push(char);
      if (this.recent.length > LONGEST_PATTERN + 1) this.recent.shift();
      const end = this.recent.length - 1;
      for (let period = 2; period <= LONGEST_PATTERN; period++) this.matches[period] = end >= period && this.recent[end - period] === char ? this.matches[period]! + 1 : 0;
      if (this.run >= SAME_CHAR && /\S/u.test(char)) return true;
      for (let period = 2; period <= LONGEST_PATTERN; period++) {
        if (this.matches[period]! + period < PATTERN_SPAN) continue;
        const pattern = this.recent.slice(-period);
        if (pattern.every((each) => each === pattern[0])) continue;
        if (/\S/u.test(pattern.join(''))) return true;
      }
    }
    return false;
  }
}
