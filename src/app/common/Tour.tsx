import { useState } from 'react';
import { navigate } from '../shell/router';
import { Button, Dialog, Intro, Stack, Steps } from '../ui';
import type { Tour } from './release';
import { tourArt } from './tourArt';

// Device-once headline tour, replayable from its release post (design §6.15).
export const TOUR = { see: '둘러보기', later: '나중에', next: '다음' };

export function TourDialog({ tour, onClose }: { tour: Tour; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const { pages, go } = tour;
  const page = pages[step]!;
  const last = step === pages.length - 1;
  return (
    <Dialog
      title={tour.title}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {TOUR.later}
          </Button>
          {last ? (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                navigate(go.route);
              }}
            >
              {go.label}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              {TOUR.next}
            </Button>
          )}
        </>
      }
    >
      <Stack gap="group">
        {tourArt[page.art]}
        <Intro title={page.title}>{page.text}</Intro>
        <Steps current={step + 1} total={pages.length} />
      </Stack>
    </Dialog>
  );
}
