import type { ComponentProps } from 'react';
import { ACTS } from './acts';
import { TextDialog } from './TextDialog';

// A report of something to the operator, sent with its reason: a post, a comment, a share link.
export function ReportDialog(props: Omit<ComponentProps<typeof TextDialog>, 'label' | 'confirm'>) {
  return <TextDialog {...props} label="신고 이유" confirm={ACTS.report} />;
}
