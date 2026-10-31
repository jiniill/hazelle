import { EMPTY_SETTINGS, type Settings } from '../../model/settings';
import type { ObjectStore } from '../../runtime/store';
import { forgetPersisted, readPersisted } from './usePersisted';

const KEYS = { tutorials: 'risu-alpha:tutorials-done', welcome: 'risu-alpha:welcome-seen', tour: 'risu-alpha:tour-seen', opened: 'risu-alpha:opened-version', language: 'risu-alpha:translator-language' } as const;

type Held = Partial<Record<keyof typeof KEYS, string>>;

// The account's value stands, so a device opened later cannot put an older one back.
export function withDeviceValues(settings: Settings, { tutorials, welcome, tour, opened, language }: Held): Settings {
  const { seen = {} } = settings;
  const taken = {
    ...(tutorials && { tutorials: tutorials.split(' ').filter(Boolean) }),
    ...(welcome === '1' && { welcome: true as const }),
    ...(tour && { tour }),
    ...(opened && { opened }),
    ...seen,
  };
  return { ...settings, ...(Object.keys(taken).length > 0 && { seen: taken }), ...(language && !settings.toolLanguage && { toolLanguage: language }) };
}

// These values were kept per device until they moved to the account (tech-spec §5 Where a value is kept). Called before
// the first screen reads them, since a pending write shows at once. A key leaves only once its value has landed.
export function carryDeviceValues(store: Pick<ObjectStore, 'upsert'>) {
  const held: Held = {};
  for (const [name, key] of Object.entries(KEYS) as [keyof typeof KEYS, string][]) {
    const value = readPersisted<string | null>(key, String, null);
    if (value !== null) held[name] = value;
  }
  if (Object.keys(held).length === 0) return;
  void store.upsert('settings', (current = EMPTY_SETTINGS) => withDeviceValues(current, held)).then((result) => {
    if (result.ok) for (const name of Object.keys(held) as (keyof typeof KEYS)[]) forgetPersisted(KEYS[name]);
  });
}
