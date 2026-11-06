import { Fragment, lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { CONNECTION_TYPES, detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { OPEN_APP, START_AGAIN, START_PAGE } from '../../contracts/start';
import { countFirstPage } from '../../runtime/first-page';
import { LegalNotice } from '../common/LegalNotice';
import { Beat, Brand, Button, Callout, ChoiceGroup, ExampleTalk, Hero, Indoors, KeyPlaces, Link, NightScene, PanelBody, Progress, Promises, Row, Said, SayChoices, Stack, TextField, Text, TrialSteps, Upcoming, WalkOnHint } from '../ui';
import { EXAMPLE, type ExampleLine, type ExampleStrand } from './example';

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

const BEATS_COUNTED = { example: 'read', trial: 'door' } as const;

// doors: a first visit, counted and with the live trial; null: START_AGAIN.
export function StartPage({ doors }: { doors: { onOpen: () => void; onSignIn: () => void } | null }) {
  const { heading, line, example, keys, trial, features, move, finish } = START_PAGE;
  const [step, setStep] = useState(0);
  const [entered, setEntered] = useState<{ type: ConnectionType; secret: string } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [talking, setTalking] = useState(false);
  const [replied, setReplied] = useState(false);
  const [inside, setInside] = useState(false);
  const enter = () => {
    if (!doors) return location.assign('/');
    countFirstPage('entered');
    doors.onOpen();
  };

  useEffect(() => {
    if (!doors) return;
    countFirstPage('shown');
    const reached = new IntersectionObserver((entries, watching) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting) continue;
        countFirstPage(BEATS_COUNTED[target.id as keyof typeof BEATS_COUNTED]);
        watching.unobserve(target);
      }
    });
    for (const id of Object.keys(BEATS_COUNTED)) reached.observe(document.getElementById(id)!);
    return () => reached.disconnect();
  }, []);

  return (
    <div data-theme="dark">
      <NightScene glow={replied ? 3 : step} talking={talking} inside={inside} />
      <Hero
        title={heading}
        line={line}
        top={
          <>
            <Brand />
            {doors ? (
              <Row kind="actions">
                <Button variant="ghost" size="sm" onClick={doors.onSignIn}>로그인</Button>
                <Button size="sm" onClick={enter}>가입 없이 열기</Button>
              </Row>
            ) : (
              <Button variant="ghost" size="sm" onClick={enter}>{START_AGAIN.back}</Button>
            )}
          </>
        }
      />
      <main>
        <Beat id="example" title={example.title} line={example.line} kind="talk">
          <ExampleChat onTalking={setTalking} />
        </Beat>
        <Beat title={keys.title} line={keys.line} kind="lanterns">
          <KeyPlaces places={PLACES} />
        </Beat>
        <Indoors id="trial" title={trial.title} line={doors ? trial.line : START_AGAIN.line} inside={inside} talking={step === 2} onInside={setInside}>
          <TrialSteps steps={trial.steps} at={step} />
          <PanelBody>
            {entered ? (
              <Suspense fallback={<Progress title="불러오는 중" steps={[{ label: '연결 준비' }]} />}>
                <Trial
                  type={entered.type}
                  secret={entered.secret}
                  kept={doors !== null}
                  onStep={setStep}
                  onReplied={() => setReplied(true)}
                  onRefused={(message) => {
                    setEntered(null);
                    setRefused(message);
                  }}
                />
              </Suspense>
            ) : (
              <KeyForm refused={refused} privacy={doors ? trial.privacy : START_AGAIN.privacy} onSkip={doors ? enter : undefined} onEnter={(type, secret) => { if (doors) countFirstPage('keyed'); setRefused(null); setEntered({ type, secret }); }} />
            )}
          </PanelBody>
        </Indoors>
        <Beat title={features.title} kind="points">
          <Stack>
            <Promises points={features.points} />
            <Link href={move.path}>{move.label}</Link>
          </Stack>
        </Beat>
        <Beat title={finish.title} kind="finish" foot={<LegalNotice />}>
          <Button size="xl" onClick={enter}>{OPEN_APP}</Button>
        </Beat>
      </main>
    </div>
  );
}

// onSkip: a first visit's way into the app without a key; the key is never the only way on.
function KeyForm({ refused, privacy, onSkip, onEnter }: { refused: string | null; privacy: string; onSkip?: () => void; onEnter: (type: ConnectionType, secret: string) => void }) {
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
        <TextField label={`${type.label} API 키`} kind="key" value={key} onChange={setKey} placeholder={type.keyForm?.placeholder} help={privacy} />
        {refused && <Callout tone="warn" alert>{refused}</Callout>}
        <Row kind="actions">
          <Button type="submit" disabled={!secret}>모델 선택</Button>
          {onSkip && <Button variant="ghost" onClick={onSkip}>{START_PAGE.trial.skip}</Button>}
        </Row>
        <WalkOnHint>{START_PAGE.trial.walkOn}</WalkOnHint>
      </Stack>
    </form>
  );
}

const TYPED_EVERY = 24;

function ExampleChat({ onTalking }: { onTalking: (talking: boolean) => void }) {
  const [strand, setStrand] = useState<ExampleStrand | null>(null);
  const [later, setLater] = useState<readonly ExampleLine[]>([]);
  const [typed, setTyped] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const said = strand ? [strand, ...later] : [];
  const last = said.at(-1);
  const done = !last || typed >= last.reply.length;
  const offered = strand ? strand.then[later.length] : EXAMPLE.choices;

  useEffect(() => {
    if (!last) return;
    timer.current = setInterval(() => setTyped((count) => count + 1), TYPED_EVERY);
    return () => clearInterval(timer.current);
  }, [last]);
  useEffect(() => {
    if (done) clearInterval(timer.current);
    onTalking(!done);
  }, [done]);

  function pick(say: string) {
    const chosen = <Line extends ExampleLine>(choices: readonly Line[]) => choices.find((choice) => choice.say === say)!;
    setTyped(0);
    if (strand) setLater([...later, chosen(strand.then[later.length]!)]);
    else setStrand(chosen(EXAMPLE.choices));
  }

  return (
    <ExampleTalk
      foot={
        <>
          <Upcoming shown={done}>
            {offered ? <SayChoices choices={offered.map(({ say }) => say)} onPick={pick} /> : <WalkOnHint>{EXAMPLE.walkOn}</WalkOnHint>}
          </Upcoming>
          <Text variant="note">{EXAMPLE.about}</Text>
        </>
      }
    >
      <Said by="them" name={EXAMPLE.name}>{EXAMPLE.greeting}</Said>
      {said.map((line) => (
        <Fragment key={line.say}>
          <Said by="me">{line.say}</Said>
          <Said by="them" name={EXAMPLE.name} typing={line === last && !done}>{line === last ? line.reply.slice(0, typed) : line.reply}</Said>
        </Fragment>
      ))}
    </ExampleTalk>
  );
}
