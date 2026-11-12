// The moments a reply makes, each told with its chat by what makes it: Talk, receiveReply and Translator. 설정 › 소리
// rings for the Cues (design §6.18); a failed reply rings nothing, and is told for the shell's notice of a reply that
// ended in a chat not open (Arrivals).
export type Cue = 'reply-started' | 'reply-received' | 'translated';
export type Moment = Cue | 'reply-failed';

type Listener = (moment: Moment, chat: string) => void;

export class Cues {
  private readonly listeners = new Set<Listener>();

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  emit(moment: Moment, chat: string) {
    for (const listener of this.listeners) listener(moment, chat);
  }
}
