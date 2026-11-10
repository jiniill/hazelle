// The moments 설정 › 소리 can ring for (design §6.18), told by what makes them: Talk, receiveReply and Translator.
export type Cue = 'reply-started' | 'reply-received' | 'translated';

export class Cues {
  private readonly listeners = new Set<(cue: Cue) => void>();

  readonly subscribe = (listener: (cue: Cue) => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  emit(cue: Cue) {
    for (const listener of this.listeners) listener(cue);
  }
}
