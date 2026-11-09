import type { ComponentProps, ReactNode } from 'react';
import { OPEN_APP } from '../../contracts/start';
import { Brand, Button, Row, Screen } from '../ui';
import { LegalNotice } from './LegalNotice';

type Props = Omit<ComponentProps<typeof Screen>, 'top' | 'foot'> & {
  // The page's own path, which its notice leaves out.
  here?: string;
  // What its head offers before 헤이젤 열기, such as 신고.
  acts?: ReactNode;
};

// A page that opens before the account flow (main.tsx), signed in or out: its head is the way into the app.
export function PublicScreen({ here, acts, ...screen }: Props) {
  return (
    <Screen
      {...screen}
      top={
        <>
          <Brand />
          <Row kind="actions">
            {acts}
            <Button variant="link" size="md" onClick={() => location.assign('/')}>
              {OPEN_APP}
            </Button>
          </Row>
        </>
      }
      foot={<LegalNotice here={here} />}
    />
  );
}
