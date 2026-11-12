import type { ComponentProps } from 'react';
import { ACTS } from './acts';
import { TextDialog } from './TextDialog';
import { REPORT_REASON } from './words';

// A report of something to the operator, sent with its reason: a post, a comment, a share link.
export function ReportDialog(props: Omit<ComponentProps<typeof TextDialog>, 'label' | 'confirm'>) {
  return <TextDialog {...props} label={REPORT_REASON} confirm={ACTS.report} />;
}
