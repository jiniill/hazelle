import type { ReactNode } from 'react';
import { Disclosure, Section, SettingGroup, Stack } from '../ui';
import { DETAIL, detailLabel } from './words';

type Rows = { children: ReactNode; sections?: never } | { sections: { title: string; rows: ReactNode }[]; children?: never };

// Keep this a quiet line, never a row/box header (user ruling). set counts configured rows across sections.
export function DetailFold({ set, children, sections }: { set: number } & Rows) {
  return (
    <Disclosure label={detailLabel(set)}>
      {sections ? (
        <Stack gap="section">
          {sections.map(({ title, rows }) => (
            <Section key={title} level={3} title={title}>
              <SettingGroup label={title}>{rows}</SettingGroup>
            </Section>
          ))}
        </Stack>
      ) : (
        <SettingGroup label={DETAIL}>{children}</SettingGroup>
      )}
    </Disclosure>
  );
}
