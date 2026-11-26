import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ConnectionType } from '../../connectors/types';
import { OPEN_APP, START_AGAIN, START_PAGE } from '../../contracts/start';
import { grantReturn } from '../../runtime/account/grant';
import { countFirstPage } from '../../runtime/service/first-page';
import { KEY_OFFERED, KeyForm, keyTypeOf, NO_KEY } from '../common/KeyForm';
import { LegalNotice } from '../common/LegalNotice';
import { Beat, Brand, Button, ExampleTalk, Hero, Indoors, KeyPlaces, Link, NightScene, PanelBody, Progress, Promises, Row, Said, SayChoices, Stack, Text, TrialSteps, Upcoming, WalkOnHint } from '../ui';
import { EXAMPLE, type ExampleLine, type ExampleStrand } from './example';
import { LOADING_TITLE } from '../common/words';

const Trial = lazy(() => import('./Trial').then(({ Trial }) => ({ default: Trial })));

const PLACES = KEY_OFFERED.map(({ id, name }) => {
  const href = keyTypeOf(id).keyPage!;
  return { name, href, site: new URL(href).host, action: '키 받기' };
});

const BEATS_COUNTED = { example: 'read', trial: 'door' } as const;

// doors: a first visit, counted and with the live trial; null: START_AGAIN.
export function StartPage({ doors }: { doors: { onOpen: () => void; onSignIn: () => void } | null }) {
  const { heading, line, example, keys, trial, features, move, finish } = START_PAGE;
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(NO_KEY);
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

  // Back from a provider's sign-in, the visit goes on where it left: at the key form.
  useEffect(() => {
    if (grantReturn()) document.getElementById('trial')!.scrollIntoView();
  }, []);

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
    <div data-mode="dark">
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
              <Suspense fallback={<Progress title={LOADING_TITLE} steps={[{ label: '연결 준비' }]} />}>
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
              <KeyForm typed={typed} onType={setTyped} refused={refused} privacy={doors ? trial.privacy : START_AGAIN.privacy} grant={doors !== null} onGrant={countFirstPage} more={doors && <Button variant="ghost" onClick={enter}>{trial.skip}</Button>} foot={<WalkOnHint>{trial.walkOn}</WalkOnHint>} onEnter={(type, secret) => { if (doors) countFirstPage('keyed'); setRefused(null); setEntered({ type, secret }); }} />
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
