import type { ReactNode } from 'react';
import { EditorFrame, NavBar, Screen, type NavBarProps } from '../ui';

// Caller owns layout; editor/list owns header content. Changing open resets scroll; side renders split-layout parts only.
export type Frame = (parts: { head: NavBarProps; body: ReactNode; side?: ReactNode; open?: string }) => ReactNode;

export const framePage: Frame = ({ head, body, side, open }) =>
  side === undefined ? (
    <Screen width="form" top={<NavBar {...head} />}>{body}</Screen>
  ) : (
    <EditorFrame top={<NavBar {...head} />} side={side} page={open}>
      {body}
    </EditorFrame>
  );
