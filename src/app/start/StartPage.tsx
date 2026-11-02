import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { CONNECTION_TYPES, detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { START_PAGE } from '../../contracts/start';
import { LegalNotice } from '../common/LegalNotice';
import { Beat, Brand, Button, Callout, ChoiceGroup, Hero, KeyPlaces, Lantern, Link, NightScene, Progress, Promises, Said, SayChoices, Stack, TextField, Text, TrialSteps } from '../ui';
import { EXAMPLE } from './example';

const Trial = lazy(() => import('./Trial').then(({ Trial }) => ({ default: Trial })));

const OFFERED = [
  { id: 'openai', name: 'GPT' },
  { id: 'anthropic', name: 'Claude' },
  { id: 'google', name: 'Gemini' },
] as const;
const typeOf = (id: string) => CONNECTION_TYPES.find((type) => type.id === id)!;
const PLACES = OFFERED.map(({ id, name }) => {
  const href = typeOf(id).keyPage!;
  return { name, href, site: new URL(href).host, action: '키 받기' };
});

export function StartPage({ onOpen, onSignIn }: { onOpen: () => void; onSignIn: () => void }) {
  const { heading, line, example, keys, trial, features, move, finish } = START_PAGE;
  const [step, setStep] = useState(0);
  const [entered, setEntered] = useState<{ type: ConnectionType; secret: string } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <>
      <NightScene />
      <Hero
        title={heading}
        line={line}
        top={
          <>
            <Brand />
            <Button variant="ghost" size="sm" onClick={onSignIn}>로그인</Button>
          </>
        }
      >
        <Button onClick={() => document.getElementById('trial')?.scrollIntoView()}>직접 해보기</Button>
        <Button variant="secondary" onClick={onOpen}>가입 없이 열기</Button>
      </Hero>
      <main>
        <Beat title={example.title} line={example.line}>
          <Lantern><ExampleChat /></Lantern>
        </Beat>
        <Beat title={keys.title} line={keys.line} side="end">
          <KeyPlaces places={PLACES} />
        </Beat>
        <Beat id="trial" title={trial.title} line={trial.line} side="whole">
          <Lantern>
            <TrialSteps steps={trial.steps} at={step} />
            {entered ? (
              <Suspense fallback={<Progress title="불러오는 중" steps={[{ label: '연결 준비' }]} />}>
                <Trial
                  type={entered.type}
                  secret={entered.secret}
                  onStep={setStep}
                  onRefused={(message) => {
                    setEntered(null);
                    setRefused(message);
                  }}
                />
              </Suspense>
            ) : (
              <KeyForm refused={refused} onEnter={(type, secret) => { setRefused(null); setEntered({ type, secret }); }} />
            )}
          </Lantern>
        </Beat>
        <Beat title={features.title} side="end">
          <Stack>
            <Promises points={features.points} />
            <Link href={move.path}>{move.label}</Link>
          </Stack>
        </Beat>
        <Beat title={finish.title} line={finish.line} side="whole">
          <Stack>
            <div><Button onClick={onOpen}>헤이젤 열기</Button></div>
            <LegalNotice />
          </Stack>
        </Beat>
      </main>
    </>
  );
}

function KeyForm({ refused, onEnter }: { refused: string | null; onEnter: (type: ConnectionType, secret: string) => void }) {
  const [picked, setPicked] = useState<string>(OFFERED[0].id);
  const [key, setKey] = useState('');
  const secret = key.trim();
  const known = detect(secret);
  const type = known?.kind === 'key' ? known.type : typeOf(picked);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (secret) onEnter(type, secret);
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        <ChoiceGroup label="제공자" options={OFFERED.map(({ id, name }) => ({ value: id, label: name }))} value={OFFERED.some(({ id }) => id === type.id) ? type.id : null} empty={type.label} onChange={setPicked} />
        <TextField label={`${type.label} API 키`} kind="key" value={key} onChange={setKey} placeholder={type.keyForm?.placeholder} help={START_PAGE.trial.privacy} />
        {refused && <Callout tone="warn" alert>{refused}</Callout>}
        <div><Button type="submit" disabled={!secret}>모델 선택</Button></div>
      </Stack>
    </form>
  );
}

const TYPED_EVERY = 24;

function ExampleChat() {
  const [picked, setPicked] = useState<(typeof EXAMPLE.choices)[number] | null>(null);
  const [typed, setTyped] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const done = picked !== null && typed >= picked.reply.length;

  useEffect(() => {
    if (!picked) return;
    timer.current = setInterval(() => setTyped((count) => count + 1), TYPED_EVERY);
    return () => clearInterval(timer.current);
  }, [picked]);
  useEffect(() => {
    if (done) clearInterval(timer.current);
  }, [done]);

  function pick(say: string) {
    setTyped(0);
    setPicked(EXAMPLE.choices.find((choice) => choice.say === say)!);
  }

  return (
    <Stack>
      <Said by="them" name={EXAMPLE.name}>{EXAMPLE.greeting}</Said>
      {picked && <Said by="me">{picked.say}</Said>}
      {picked && <Said by="them" name={EXAMPLE.name}>{picked.reply.slice(0, typed)}</Said>}
      {(!picked || done) && <SayChoices choices={EXAMPLE.choices.filter((choice) => choice !== picked).map(({ say }) => say)} onPick={pick} />}
      <Text variant="note">{EXAMPLE.about}</Text>
    </Stack>
  );
}
