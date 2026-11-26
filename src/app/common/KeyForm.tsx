import type { FormEvent, ReactNode } from 'react';
import { CONNECTION_TYPES, detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { START_PAGE } from '../../contracts/start';
import type { Granting } from '../../runtime/account/grant';
import { Button, Callout, ChoiceGroup, Row, Stack, TextField } from '../ui';
import { KeyGrant } from './KeyGrant';
import { PICK_MODEL } from './words';

export const KEY_OFFERED = [
  { id: 'openai', name: 'GPT' },
  { id: 'anthropic', name: 'Claude' },
  { id: 'google', name: 'Gemini' },
] as const;
export const keyTypeOf = (id: string) => CONNECTION_TYPES.find((type) => type.id === id)!;

// The one way in that needs no key made by hand, and whose free models need no payment.
const GRANTING = CONNECTION_TYPES.find((type): type is Granting => type.id === 'openrouter')!;

// What is typed into the form, held by its owner: the form is gone while a key is tried and comes back as it was.
export type TypedKey = { picked: string; key: string };
export const NO_KEY: TypedKey = { picked: KEY_OFFERED[0].id, key: '' };

// A first key, where nothing is connected yet: the provider's sign-in, or a key pasted for a provider it names itself.
// grant: whether the sign-in is offered, which leaves a key at the provider, so only where the key is kept.
// onGrant: the sign-in's two steps, for a count.
export function KeyForm({ typed, onType, refused, privacy, grant, onGrant, more, foot, onEnter }: { typed: TypedKey; onType: (typed: TypedKey) => void; refused: string | null; privacy: string; grant: boolean; onGrant?: (step: 'asked' | 'granted') => void; more?: ReactNode; foot?: ReactNode; onEnter: (type: ConnectionType, secret: string) => void }) {
  const secret = typed.key.trim();
  const known = detect(secret);
  const type = known?.kind === 'key' ? known.type : keyTypeOf(typed.picked);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (secret) onEnter(type, secret);
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        {grant && <KeyGrant type={GRANTING} label={START_PAGE.trial.grant} onStart={() => onGrant?.('asked')} onKey={(granted) => { onGrant?.('granted'); onEnter(GRANTING, granted); }} />}
        <ChoiceGroup label="제공자" options={KEY_OFFERED.map(({ id, name }) => ({ value: id, label: name }))} value={KEY_OFFERED.some(({ id }) => id === type.id) ? type.id : null} empty={type.label} onChange={(picked) => onType({ ...typed, picked })} />
        <TextField label={`${type.label} API 키`} kind="key" value={typed.key} onChange={(key) => onType({ ...typed, key })} placeholder={type.keyForm?.placeholder} help={privacy} focus={refused !== null} />
        {refused && <Callout tone="warn" alert>{refused}</Callout>}
        <Row kind="actions">
          <Button type="submit" disabled={!secret}>{PICK_MODEL}</Button>
          {more}
        </Row>
        {foot}
      </Stack>
    </form>
  );
}
