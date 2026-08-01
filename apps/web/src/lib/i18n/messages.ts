// i18n/C1. The key space and the dictionaries.
//
// `en` is the SOURCE of the key space and `ja` is typed as a Record over it, so
// a key added to one and not the other is a typecheck error rather than a
// string that renders as its own key in production. That is the whole reason
// this file is two literals and not two JSON files: JSON would move the check
// to runtime, where the failure is a Japanese page showing `nav.accounts`.

export const LOCALES = ['en', 'ja'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

// Keys read as `<area>.<thing>`, and the area matches the file that renders it.
// Flat rather than nested: a nested shape needs a path type to stay checkable,
// and the check is the only reason this is TypeScript.
const en = {
  'nav.brand': 'open-smp',
  'nav.accounts': 'Accounts',
  'nav.licenses': 'Licences',
  'nav.import': 'Import',
  'nav.apps': 'Apps',
  'nav.discovery': 'Discovery',
  'nav.events': 'Events',
  'nav.language': 'Language',

  'filter.label': 'Label:',
  'filter.source': 'Source:',

  'export.csv': 'Export CSV',

  'evidence.rule': 'rule:',
  'evidence.candidates': 'candidates:',
  'evidence.matched': 'matched:',
} as const;

export type MessageKey = keyof typeof en;

// Record<MessageKey, string>, so this fails to compile when `en` gains a key
// this does not have — and, because it is an object literal, when it carries
// one `en` does not.
const ja: Record<MessageKey, string> = {
  'nav.brand': 'open-smp',
  'nav.accounts': 'アカウント',
  'nav.licenses': 'ライセンス',
  'nav.import': 'インポート',
  'nav.apps': 'アプリ',
  'nav.discovery': 'ディスカバリ',
  'nav.events': 'イベント',
  'nav.language': '言語',

  'filter.label': 'ラベル:',
  'filter.source': 'ソース:',

  'export.csv': 'CSV エクスポート',

  'evidence.rule': 'ルール:',
  'evidence.candidates': '候補:',
  'evidence.matched': '一致:',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, ja };
