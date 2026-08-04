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

// i18n/C3. What the switch calls each locale — and deliberately NOT a message
// key. A language picker names every language in that language, because the
// person who most needs it is the one who cannot read the language currently
// showing: translating these would render the Japanese option as "Japanese" to
// exactly the reader looking for 日本語.
//
// Typed over `Locale`, so a third locale is a compile error here rather than an
// option the control renders as `undefined`.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
};

// Keys read as `<area>.<thing>`, and the area matches the file that renders it.
// An area shared by several files (`table`, `action`, `field`) is one whose
// members appear on more than one surface — a second key for the same word is
// how two screens end up disagreeing about what a column is called.
//
// Flat rather than nested: a nested shape needs a path type to stay checkable,
// and the check is the only reason this is TypeScript.
//
// `{name}` placeholders are substituted by `translate`. Copy is never assembled
// from fragments — see that function for why the second locale makes that the
// difference between translatable and not.
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

  // Column headings shared by the accounts list and the identity detail table.
  'table.select': 'Select',
  'table.selectAccount': 'Select {account}',
  'linkStatus.matched': 'Matched',
  'linkStatus.orphan': 'Orphan',
  'linkStatus.ghost': 'Ghost',
  'linkStatus.ambiguous': 'Ambiguous',
  'identityStatus.active': 'Active',
  'identityStatus.left': 'Left',
  'accountStatus.active': 'Active',
  'accountStatus.suspended': 'Suspended',
  'accountStatus.archived': 'Archived',
  'table.app': 'App',
  'table.email': 'Email',
  'table.name': 'Name',
  'table.accountStatus': 'Account status',
  'table.admin': 'Admin',
  'table.lastActivity': 'Last activity',
  'table.link': 'Link',
  'table.identity': 'Identity',
  'table.confidence': 'Confidence',
  'table.evidence': 'Evidence',
  'table.label': 'Label',
  'table.application': 'Application',

  'value.admin': 'admin',

  'action.loadMore': 'Load more',
  'action.upload': 'Upload',
  'action.uploading': 'Uploading…',
  'action.cancel': 'Cancel',
  'action.retry': 'Retry',
  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.clear': 'Clear',
  'action.delete': 'Delete',
  'action.deleting': 'Deleting…',
  'action.register': 'Register',
  'action.registering': 'Registering...',
  'action.replace': 'Replace',
  'action.replacing': 'Replacing…',
  'action.signIn': 'Sign in',
  'action.signingIn': 'Signing in...',
  'action.apply': 'Apply to selected',
  'action.applying': 'Applying…',

  'field.displayName': 'Display name',
  'field.key': 'Key',
  'field.note': 'Note (optional)',
  'field.adminEmail': 'Admin email to impersonate',
  'field.serviceAccountJson': 'Service account JSON',

  'issue.errors': 'Errors',
  'issue.warnings': 'Warnings',
  'issue.row': 'Row',
  'issue.message': 'Message',
  'issue.rowMessage': 'Row {row}: {message}',

  'error.network': 'Could not reach the server. Please try again.',
  'error.unknown': 'Something went wrong. Please try again.',

  // The upload vocabulary is shared by the HR import and the contract import.
  // The two routes carry DIFFERENT row caps, which is why the cap arrives as a
  // parameter rather than being written into the copy (SCL15): a figure typed
  // out here would be wrong for one of the two callers the day either moves.
  'upload.imported': '{imported} imported, {skipped} skipped',
  'upload.failed': 'Upload failed. Please try again.',
  'upload.fileRequired': 'Please choose a CSV file to upload.',
  'upload.notUtf8': 'This file is not UTF-8 encoded. Save it as UTF-8 and try again.',
  'upload.malformedCsv': 'This file could not be parsed as CSV.',
  'upload.tooManyRows': 'This file has too many rows (max {max}).',
  'upload.tooLarge': 'This file is too large (max {max}).',

  'accounts.title': 'Accounts',
  'accounts.empty': 'No accounts in this filter.',
  'accounts.dataAsOf': 'Data as of {at}',
  'accounts.noSyncData': 'No sync data yet',

  'apps.title': 'SaaS apps',
  'apps.manage': 'Manage',
  'apps.empty': 'No apps registered yet.',

  'discovery.title': 'Discovered applications',
  'discovery.intro':
    'Third-party applications your people have granted access to. This is evidence of a grant, not an application the product manages — nothing here has been registered.',
  'discovery.noAudit': 'No token audit has completed yet.',
  'discovery.unauditable.none': '{app} cannot be audited: this connector reports no third-party application grants.',
  'discovery.unauditable.workspaceApps': '{app} cannot be audited per user: this connector reports installed applications without saying who granted them.',
  'discovery.users': 'Users',
  'discovery.registered': 'Registered',
  'discovery.scopes': 'Scopes',
  'discovery.unnamed': 'unnamed',
  'discovery.unknown': 'unknown',
  'discovery.no': 'no',
  'discovery.yes': 'yes',
  'discovery.empty': 'No third-party grants found.',
  // Two whole sentences rather than one plus an appended clause. A partial run
  // must say so, and a fragment joined onto the end is the shape that cannot
  // move to where the second locale needs it.
  'discovery.scanned': '{scanned} accounts read',
  'discovery.scannedWithFailures': '{scanned} accounts read, {failed} could not be read',

  'events.title': 'Discovery events',
  'events.source': 'Source',
  'events.kind': 'Kind',
  'events.counts': 'Counts',
  'events.labelChange': 'Label change',
  'events.actor': 'Actor',
  'events.createdAt': 'Created at',
  'events.empty': 'No events yet.',

  'identity.status': 'Status',
  'identity.leftAt': 'Left at',
  'identity.secondaryEmails': 'Secondary emails',
  'identity.attributedAccounts': 'Attributed accounts',
  'identity.empty': 'No accounts attributed to this identity.',
  'identity.truncated': 'Showing the first {count} accounts attributed to this identity.',

  'import.title': 'Import HR data',
  'import.uploadCsv': 'Upload CSV',
  'import.result': 'Import result',
  'import.matching': 'Matching',
  'import.runMatching': 'Run matching',
  'import.matchingDone': 'Matching completed.',
  'import.viewAccounts': 'View accounts',
  'import.matchTimedOut': 'Matching is taking longer than expected — check Events or retry',
  'import.matchFailed': 'Matching failed. Please try again.',

  'progress.matching': 'Matching…',

  'licenses.title': 'Licences',
  'licenses.plan': 'Plan',
  'licenses.purchased': 'Purchased',
  'licenses.assigned': 'Assigned',
  'licenses.unassigned': 'Unassigned',
  'licenses.reclaimable': 'Reclaimable',
  'licenses.needsReview': 'Needs review',
  'licenses.unitPrice': 'Unit price',
  'licenses.reclaimableValue': 'Reclaimable value',
  'licenses.matching': 'Matching',
  'licenses.noConnector': '(no connector)',
  'licenses.empty': 'No applications yet.',
  'licenses.overAllocated': '{value} (over-allocated)',
  'licenses.reclaimableBreakdown': '({ghost} left, {unknown} unknown)',
  'licenses.matchState.noAccounts': 'No accounts',
  'licenses.matchState.notMatched': 'Not matched',
  'licenses.matchState.partiallyMatched': 'Partly matched',
  'licenses.matchState.matched': 'Matched',

  'login.title': 'Sign in to open-smp',
  'login.tenant': 'Tenant',
  'login.password': 'Password',
  'login.tooManyAttempts': 'Too many attempts. Please try again later.',
  'login.invalidCredentials': 'Invalid tenant, email, or password.',
  'login.failed': 'Login failed. Please try again.',

  'label.add': 'Label',
  'label.selected': '{count} selected',
  // English pluralises and Japanese does not, so the count picks the message
  // rather than a suffix being glued to a noun. One key per form is the only
  // shape that lets a locale ignore the distinction.
  'label.applied.one': 'Labeled {count} account.',
  'label.applied.other': 'Labeled {count} accounts.',
  'label.tooMany': 'Select at most {max} accounts.',
  'label.stale': 'Some selected accounts no longer exist — refresh the page.',
  'label.invalid': 'That label could not be applied. Check the note and try again.',
  'label.bulkKind': 'Bulk label kind',
  'label.bulkNote': 'Bulk label note',
  'label.accountGone': 'Account no longer exists — refresh the page',

  // The label vocabulary. These are read through `LABEL_KIND_KEYS`, which is
  // keyed by the domain — so a fourth kind is a compile error there rather than
  // a chip that renders as nothing.
  'labelKind.known_shared': 'Known shared',
  'labelKind.service_account': 'Service account',
  'labelKind.external_collaborator': 'External collaborator',
  'labelKind.withNote': '{kind} ({note})',
  'labelKind.none': 'none',
  // NOT 'none'. The API withholds a snapshot whose kind is outside the domain,
  // and rendering that as "none" puts back the forgery it refused to emit.
  'labelKind.unavailable': 'unavailable',

  'labelFilter.all': 'All',
  'labelFilter.none': 'Unlabeled',
  'labelFilter.any': 'Any label',

  'sourceFilter.all': 'All',
  'sourceFilter.labelAudit': 'Label audit',
  'sourceFilter.matching': 'Matching',

  'saasapp.register': 'Register a SaaS app',
  'saasapp.customerId': 'Customer ID (optional)',
  'saasapp.botToken': 'Bot token',
  'saasapp.invalidToken': 'That does not look like a bot token. Check for stray spaces or line breaks.',
  'saasapp.invalidEmail': 'That does not look like an email address.',
  'saasapp.newBotToken': 'New bot token',
  'saasapp.rename': 'Rename',
  'saasapp.replaceCredentials': 'Replace credentials',
  'saasapp.newServiceAccountJson': 'New service account JSON',
  'saasapp.confirmDelete': 'Delete {name}? This cannot be undone.',
  'saasapp.hasAccounts': 'Cannot delete — accounts are still attributed to this app.',
  'saasapp.hasAccounts.one': 'Cannot delete — {count} account still attributed to this app.',
  'saasapp.hasAccounts.other': 'Cannot delete — {count} accounts still attributed to this app.',
  'saasapp.notFound': 'This app no longer exists — refresh the page.',
  'saasapp.invalidJson': 'That does not look like valid JSON.',
  'saasapp.missingFields': 'Service account JSON must include client_email and private_key.',
  'saasapp.invalidBodyRegister': 'Please fill in all required fields.',
  'saasapp.invalidBodyUpdate': 'Please provide a value to update.',
  'saasapp.duplicate': 'This app is already registered for your tenant.',
  'saasapp.registerFailed': 'Registration failed. Please try again.',
  'saasapp.catalogFull': 'This tenant has reached its application limit. Delete an application you no longer use, then register this one.',

  'contracts.upload': 'Upload contracts',
  'contracts.columnsHint':
    'One row per application. Columns: {columns}. An application named here is created if it does not exist.',
  'contracts.csvLabel': 'Contract CSV',
  'contracts.createdApps': 'Applications created: {apps}',

  'sync.title': 'Sync',
  'sync.syncApp': 'Sync {app}',
  'sync.byId': 'Sync by ID',
  'sync.syncing': 'Syncing…',
  'sync.done': 'Sync and match completed.',
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

  'table.select': '選択',
  'table.selectAccount': '{account} を選択',
  'linkStatus.matched': '一致',
  'linkStatus.orphan': '孤立',
  'linkStatus.ghost': 'ゴースト',
  'linkStatus.ambiguous': '曖昧',
  'identityStatus.active': '在籍',
  'identityStatus.left': '退職',
  'accountStatus.active': '有効',
  'accountStatus.suspended': '停止中',
  'accountStatus.archived': 'アーカイブ済み',
  'table.app': 'アプリ',
  'table.email': 'メールアドレス',
  'table.name': '氏名',
  'table.accountStatus': 'アカウント状態',
  'table.admin': '管理者',
  'table.lastActivity': '最終アクティビティ',
  'table.link': '紐付け',
  'table.identity': '人物',
  'table.confidence': '確度',
  'table.evidence': '根拠',
  'table.label': 'ラベル',
  'table.application': 'アプリケーション',

  'value.admin': '管理者',

  'action.loadMore': 'さらに読み込む',
  'action.upload': 'アップロード',
  'action.uploading': 'アップロード中…',
  'action.cancel': 'キャンセル',
  'action.retry': '再試行',
  'action.save': '保存',
  'action.saving': '保存中…',
  'action.clear': 'クリア',
  'action.delete': '削除',
  'action.deleting': '削除中…',
  'action.register': '登録',
  'action.registering': '登録中...',
  'action.replace': '差し替え',
  'action.replacing': '差し替え中…',
  'action.signIn': 'サインイン',
  'action.signingIn': 'サインイン中...',
  'action.apply': '選択したアカウントに適用',
  'action.applying': '適用中…',

  'field.displayName': '表示名',
  'field.key': 'キー',
  'field.note': 'メモ（任意）',
  'field.adminEmail': '代理実行する管理者のメールアドレス',
  'field.serviceAccountJson': 'サービスアカウント JSON',

  'issue.errors': 'エラー',
  'issue.warnings': '警告',
  'issue.row': '行',
  'issue.message': 'メッセージ',
  'issue.rowMessage': '{row} 行目: {message}',

  'error.network': 'サーバーに接続できませんでした。もう一度お試しください。',
  'error.unknown': '問題が発生しました。もう一度お試しください。',

  'upload.imported': '取り込み {imported} 件、スキップ {skipped} 件',
  'upload.failed': 'アップロードに失敗しました。もう一度お試しください。',
  'upload.fileRequired': 'アップロードする CSV ファイルを選択してください。',
  'upload.notUtf8': 'このファイルは UTF-8 ではありません。UTF-8 で保存し直してください。',
  'upload.malformedCsv': 'このファイルは CSV として解釈できませんでした。',
  'upload.tooManyRows': 'このファイルは行数が多すぎます（上限 {max} 行）。',
  'upload.tooLarge': 'このファイルは大きすぎます（上限 {max}）。',

  'accounts.title': 'アカウント',
  'accounts.empty': 'この絞り込みに該当するアカウントはありません。',
  'accounts.dataAsOf': '{at} 時点のデータ',
  'accounts.noSyncData': '同期データがまだありません',

  'apps.title': 'SaaS アプリ',
  'apps.manage': '管理',
  'apps.empty': '登録済みのアプリはまだありません。',

  'discovery.title': '検出されたアプリケーション',
  'discovery.intro':
    '組織のメンバーがアクセスを許可したサードパーティ製アプリケーションです。これは許可が行われた証跡であり、本製品が管理しているアプリケーションではありません — ここにあるものは登録されていません。',
  'discovery.noAudit': '完了したトークン監査がまだありません。',
  'discovery.unauditable.none': '{app} は監査できません: このコネクタはサードパーティへの許可を報告しません。',
  'discovery.unauditable.workspaceApps': '{app} はユーザー単位では監査できません: このコネクタはインストール済みアプリケーションを、誰が許可したかを示さずに報告します。',
  'discovery.users': 'ユーザー数',
  'discovery.registered': '登録済み',
  'discovery.scopes': 'スコープ',
  'discovery.unnamed': '名称なし',
  'discovery.unknown': '不明',
  'discovery.no': 'いいえ',
  'discovery.yes': 'はい',
  'discovery.empty': 'サードパーティへの許可は見つかりませんでした。',
  'discovery.scanned': 'アカウント {scanned} 件を読み取り',
  'discovery.scannedWithFailures': 'アカウント {scanned} 件を読み取り、{failed} 件は読み取れませんでした',

  'events.title': 'ディスカバリイベント',
  'events.source': 'ソース',
  'events.kind': '種別',
  'events.counts': '件数',
  'events.labelChange': 'ラベルの変更',
  'events.actor': '実行者',
  'events.createdAt': '発生日時',
  'events.empty': 'イベントはまだありません。',

  'identity.status': '在籍状態',
  'identity.leftAt': '退職日',
  'identity.secondaryEmails': '副メールアドレス',
  'identity.attributedAccounts': '紐付いたアカウント',
  'identity.empty': 'この人物に紐付いたアカウントはありません。',
  'identity.truncated': 'この人物に紐付いたアカウントのうち先頭 {count} 件を表示しています。',

  'import.title': '人事データのインポート',
  'import.uploadCsv': 'CSV をアップロード',
  'import.result': 'インポート結果',
  'import.matching': '突合',
  'import.runMatching': '突合を実行',
  'import.matchingDone': '突合が完了しました。',
  'import.viewAccounts': 'アカウントを見る',
  'import.matchTimedOut': '突合に想定より時間がかかっています — イベントを確認するか再試行してください',
  'import.matchFailed': '突合に失敗しました。もう一度お試しください。',

  'progress.matching': '突合中…',

  'licenses.title': 'ライセンス',
  'licenses.plan': 'プラン',
  'licenses.purchased': '購入数',
  'licenses.assigned': '割当済み',
  'licenses.unassigned': '未割当',
  'licenses.reclaimable': '回収可能',
  'licenses.needsReview': '要確認',
  'licenses.unitPrice': '単価',
  'licenses.reclaimableValue': '回収可能額',
  'licenses.matching': '突合状況',
  'licenses.noConnector': '（コネクタなし）',
  'licenses.empty': 'アプリケーションはまだありません。',
  'licenses.overAllocated': '{value}（超過割当）',
  'licenses.reclaimableBreakdown': '（退職 {ghost} 件、不明 {unknown} 件）',
  'licenses.matchState.noAccounts': 'アカウントなし',
  'licenses.matchState.notMatched': '未突合',
  'licenses.matchState.partiallyMatched': '一部突合',
  'licenses.matchState.matched': '突合済み',

  'login.title': 'open-smp にサインイン',
  'login.tenant': 'テナント',
  'login.password': 'パスワード',
  'login.tooManyAttempts': '試行回数が多すぎます。しばらくしてからお試しください。',
  'login.invalidCredentials': 'テナント、メールアドレス、またはパスワードが正しくありません。',
  'login.failed': 'サインインに失敗しました。もう一度お試しください。',

  'label.add': 'ラベルを付ける',
  'label.selected': '{count} 件を選択中',
  'label.applied.one': '{count} 件のアカウントにラベルを付けました。',
  'label.applied.other': '{count} 件のアカウントにラベルを付けました。',
  'label.tooMany': '選択できるアカウントは最大 {max} 件です。',
  'label.stale': '選択したアカウントの一部が存在しません — ページを再読み込みしてください。',
  'label.invalid': 'ラベルを適用できませんでした。メモを確認してもう一度お試しください。',
  'label.bulkKind': '一括ラベルの種別',
  'label.bulkNote': '一括ラベルのメモ',
  'label.accountGone': 'このアカウントは存在しません — ページを再読み込みしてください',

  'labelKind.known_shared': '共有アカウント（把握済み）',
  'labelKind.service_account': 'サービスアカウント',
  'labelKind.external_collaborator': '社外協力者',
  'labelKind.withNote': '{kind}（{note}）',
  'labelKind.none': 'なし',
  'labelKind.unavailable': '取得不可',

  'labelFilter.all': 'すべて',
  'labelFilter.none': 'ラベルなし',
  'labelFilter.any': 'ラベルあり',

  'sourceFilter.all': 'すべて',
  'sourceFilter.labelAudit': 'ラベル監査',
  'sourceFilter.matching': '突合',

  'saasapp.register': 'SaaS アプリを登録',
  'saasapp.customerId': 'カスタマー ID（任意）',
  'saasapp.botToken': 'ボットトークン',
  'saasapp.invalidToken': 'ボットトークンではないようです。前後の空白や改行が混ざっていないか確認してください。',
  'saasapp.invalidEmail': 'メールアドレスの形式ではないようです。',
  'saasapp.newBotToken': '新しいボットトークン',
  'saasapp.rename': '名称変更',
  'saasapp.replaceCredentials': '認証情報を差し替え',
  'saasapp.newServiceAccountJson': '新しいサービスアカウント JSON',
  'saasapp.confirmDelete': '{name} を削除しますか？この操作は取り消せません。',
  'saasapp.hasAccounts': '削除できません — このアプリにはまだアカウントが紐付いています。',
  'saasapp.hasAccounts.one': '削除できません — このアプリにはまだ {count} 件のアカウントが紐付いています。',
  'saasapp.hasAccounts.other': '削除できません — このアプリにはまだ {count} 件のアカウントが紐付いています。',
  'saasapp.notFound': 'このアプリは存在しません — ページを再読み込みしてください。',
  'saasapp.invalidJson': '有効な JSON ではないようです。',
  'saasapp.missingFields': 'サービスアカウント JSON には client_email と private_key が必要です。',
  'saasapp.invalidBodyRegister': '必須項目をすべて入力してください。',
  'saasapp.invalidBodyUpdate': '更新する値を入力してください。',
  'saasapp.duplicate': 'このアプリはこのテナントに登録済みです。',
  'saasapp.registerFailed': '登録に失敗しました。もう一度お試しください。',
  'saasapp.catalogFull': 'このテナントは登録できるアプリケーション数の上限に達しています。使っていないアプリケーションを削除してから登録してください。',

  'contracts.upload': '契約をアップロード',
  'contracts.columnsHint':
    'アプリケーションごとに1行です。列: {columns}。ここで指定したアプリケーションが未登録の場合は作成されます。',
  'contracts.csvLabel': '契約 CSV',
  'contracts.createdApps': '作成されたアプリケーション: {apps}',

  'sync.title': '同期',
  'sync.syncApp': '{app} を同期',
  'sync.byId': 'ID を指定して同期',
  'sync.syncing': '同期中…',
  'sync.done': '同期と突合が完了しました。',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, ja };
