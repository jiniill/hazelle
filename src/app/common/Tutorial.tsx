import { Check, GraduationCap, PartyPopper } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useConnections, useReplied } from '../session';
import { navigate, useRoute } from '../shell/router';
import { Button, Cheer, Coach, Dialog, guideShown, Intro, List, ListItem, Row, Stack, Tag, Text, useGuideTarget } from '../ui';
import { stepAt, TUTORIALS, type Facts, type Tutorial } from './tutorial';
import { usePersisted } from './usePersisted';

export const TUTORIAL = { open: '튜토리얼 보기', icon: GraduationCap, title: '헤이젤이 처음이라면', later: '나중에', stop: '종료', resume: '계속하기', done: '완료' };

// Offer unfinished tutorials only before any reply. welcome respects this device's dismissal;
// listed supplies door labels independently of whether the welcome opens.
type Tutorials = { offered: readonly Tutorial[]; listed: string; open: () => void; welcome: () => boolean };
const TutorialContext = createContext<Tutorials | null>(null);

export function useTutorials(): Tutorials {
  const context = useContext(TutorialContext);
  if (!context) throw new Error('useTutorials outside TutorialProvider');
  return context;
}

function useFacts(): Facts {
  const route = useRoute();
  const connections = useConnections();
  return { route, connection: connections[0]?.id ?? null, added: connections.some(({ value }) => value.starred.length > 0) };
}

// Persist running until stopped/end closed. Mark finished on reaching the end:
// its final chat-screen state is transient and cannot prove completion after reload.
export function TutorialProvider({ children }: { children: ReactNode }) {
  const facts = useFacts();
  const replied = useReplied();
  const [runningId, setRunning] = usePersisted('risu-alpha:tutorial', String, '', String);
  const [finished, setFinished] = usePersisted('risu-alpha:tutorials-done', (stored) => stored.split(' ').filter(Boolean), [], (ids) => ids.join(' '));
  const [welcomed, setWelcomed] = usePersisted('risu-alpha:welcome-seen', (stored) => stored === '1', false, (value) => (value ? '1' : ''));
  const [listing, setListing] = useState(false);
  const offered = replied ? [] : TUTORIALS.filter(({ id }) => !finished.includes(id));
  const running = TUTORIALS.find(({ id }) => id === runningId) ?? null;
  const at = running && stepAt(running, facts);
  const ended = running !== null && (at === null || finished.includes(running.id));
  useEffect(() => {
    if (running && ended && !finished.includes(running.id)) setFinished([...finished, running.id]);
  }, [ended]);

  function close() {
    setListing(false);
    setWelcomed(true);
  }

  // Started where the step's control is on screen (the empty home's 새 연결), else at the step's place.
  function start(tutorial: Tutorial) {
    close();
    setRunning(tutorial.id);
    const first = stepAt(tutorial, facts);
    const step = first === null ? null : tutorial.steps[first]!;
    if (step && !guideShown(step.mark)) navigate(step.at(facts));
  }

  function welcome() {
    if (welcomed) return false;
    setListing(true);
    return true;
  }

  const tutorials: Tutorials = { offered, listed: offered.map(({ title }) => title).join(' · '), open: () => setListing(true), welcome };
  return (
    <TutorialContext.Provider value={tutorials}>
      {children}
      {listing && (
        <Dialog
          title={TUTORIAL.title}
          onClose={close}
          actions={
            <Button variant="secondary" onClick={close}>
              {TUTORIAL.later}
            </Button>
          }
        >
          <List label={TUTORIAL.title} places>
            {offered.map((tutorial) => (
              <ListItem key={tutorial.id} title={tutorial.title} description={tutorial.description} note={`${tutorial.steps.length}단계`} onClick={() => start(tutorial)} />
            ))}
          </List>
        </Dialog>
      )}
      {running && (ended ? <Finish tutorial={running} onClose={() => setRunning('')} /> : <Running tutorial={running} at={at!} facts={facts} onEnd={() => setRunning('')} />)}
    </TutorialContext.Provider>
  );
}

// A step's control can take a moment to come after its screen: the note docks only once it has been missing a while.
const DOCK_AFTER = 400;

function Running({ tutorial, at, facts, onEnd }: { tutorial: Tutorial; at: number; facts: Facts; onEnd: () => void }) {
  const step = tutorial.steps[at]!;
  const target = useGuideTarget(step.mark);
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (target) return setDocked(false);
    const timer = window.setTimeout(() => setDocked(true), DOCK_AFTER);
    return () => window.clearTimeout(timer);
  }, [target]);
  if (!target && !docked) return null;

  // Keyed by the step, so a new step enters as a new note.
  return (
    <Coach key={at} target={target} title={step.label} progress={{ current: at + 1, total: tutorial.steps.length }} above={step.above}>
      {target && <Text>{step.text}</Text>}
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={onEnd}>
          {TUTORIAL.stop}
        </Button>
        {!target ? (
          <Button size="sm" onClick={() => navigate(step.at(facts))}>
            {TUTORIAL.resume}
          </Button>
        ) : (
          step.go && (
            <Button size="sm" onClick={() => navigate(step.go!.route)}>
              {step.go.label}
            </Button>
          )
        )}
      </Row>
    </Coach>
  );
}

function Finish({ tutorial, onClose }: { tutorial: Tutorial; onClose: () => void }) {
  return (
    <Dialog
      title={tutorial.title}
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          {TUTORIAL.done}
        </Button>
      }
    >
      <Stack gap="group">
        <Cheer icon={PartyPopper} />
        <Intro title={tutorial.finish.title}>{tutorial.finish.text}</Intro>
        <Row kind="tags">
          {tutorial.steps.map((step) => (
            <Tag key={step.label} tone="accent" icon={Check}>
              {step.label}
            </Tag>
          ))}
        </Row>
      </Stack>
    </Dialog>
  );
}
