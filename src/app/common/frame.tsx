import type { ReactNode } from 'react';
import { EditorFrame, NavBar, Screen, type NavBarProps } from '../ui';

// Caller owns layout; editor/list owns header content. Changing open resets scroll; side renders split-layout parts only.
// tabs: what picks the part shown, under the head.
export type Frame = (parts: { head: NavBarProps; body: ReactNode; side?: ReactNode; tabs?: ReactNode; open?: string }) => ReactNode;

export const framePage: Frame = ({ head, body, side, tabs, open }) =>
  side === undefined ? (
    <Screen width="form" top={<NavBar {...head} />}>
      {tabs}
      {body}
    </Screen>
  ) : (
    <EditorFrame top={<NavBar {...head} />} tabs={tabs} side={side} page={open}>
      {body}
    </EditorFrame>
  );
