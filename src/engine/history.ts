// id is the version; message survives switches. seed preserves branch/continuation rolls.
// staged is post-input/output text. Replay before, text, after, then byHand (model/chat Entry/Version).
export type HistoryMessage = { id: string; message: string; seed: string; role: 'user' | 'assistant'; text: string; time: number | null; staged?: true; before?: [string, string][]; after?: [string, string][]; byHand?: [string, string][] };
