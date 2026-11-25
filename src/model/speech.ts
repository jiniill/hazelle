import type { ModelRef } from '../connectors/assignment';
import type { FileRef } from '../vault/files';

// 음성 (design §6.19). Character.ownSpeech replaces the shared switches; runtime/library/characters speechSwitches
// resolves absent fields. auto and quotes default off. model: the 음성 모델, absent for the first one; model.model is the
// id of one of its type's speech models. voice: the voice picked on a connection, name as the provider named it then.
export type SpeechSwitches = { auto?: boolean; quotes?: boolean; model?: ModelRef; voice?: VoicePick };
export type VoicePick = { connection: string; id: string; name: string };

// A message version read once, in one file: its shown text or its translation. Read again only on 다시 만들기.
export type Speech = { message: string; version: string; of: 'text' | 'translation'; file: FileRef; type: string; size: number; at: number };
