/**
 * @file tools/unit/data-backup.test.mjs
 * 文件职责：固化备份的导出白名单与导入规则（data-backup.mjs），以及真 background.js 上导出 → 导入的往返。
 * 主要内容：① 纯模块：设置白名单覆盖 DEFAULT_SETTINGS 的每一项、导出永不含模型服务与密钥；
 *   备份解析认新旧两种文件、拒绝更新版本与非备份文件、认不出的词跳过；词档案合并取最近活动更晚的一份、
 *   覆盖删掉备份里没有的词、内容没变的词沿用本机对象；设置合并只补列表、覆盖逐项恢复、备份缺的项不动、超上限不可选；
 *   ② 真 background.js：只预览不写入；覆盖导入到全新配置后词档案、术语、网站规则、自动开启网站、偏好与解构样式都回来，
 *   本机的 API 服务与密钥不受影响；合并保留本机较新的词；网页上下文不能导入。
 * 模块边界：只 mock 浏览器边界（chrome.* 与存储），不 mock 被测扩展模块。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS, normalizeSettings} from '../../roamcat-0.0.1/extension/shared.js';
import {
  BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_SETTING_KEYS, BACKUP_EXCLUDED_SETTING_KEYS, MAX_IMPORT_WORDS,
  backupSettings, backupContents, parseBackup, planWordImport, planSettingsImport,
} from '../../roamcat-0.0.1/extension/data-backup.mjs';
import {parseReadingDataImport} from '../../roamcat-0.0.1/extension/message-protocol.js';

const sense = (key, at = 1000) => ({key, label: 'meaning', opportunityDays: 1, lastOpportunityAt: at, lastHelpAt: at, quietUntil: 0, quietCycles: 0, quietOpportunityDays: 0, hintPreference: null, assistedPageKey: '', definition: {hint: 'a short hint', translation: '释义'}});
const word = (term, at = 1000, extra = {}) => ({id: `tech:${term}`, term, domain: 'tech', kind: 'word', revision: 1, helpCount: 1, requestedAt: at, knownAt: 0, lastSeen: at, hintPreference: null, senses: [sense(`${term}#1`, at)], ...extra});
const backupText = (overrides = {}) => JSON.stringify({
  format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: '2026-11-19T08:00:00.000Z', extensionVersion: '0.10.1',
  schemaVersion: 6, productSchemaVersion: 1, records: [], settings: backupSettings({}), ...overrides,
});
const SECRETS = ['sk-SECRET-1', 'sk-SECRET-2', 'DEEPL-SECRET', 'DETECT-SECRET', 'JEV-SECRET'];
const secretSettings = () => ({
  providerKind: 'api',
  apiServices: [{id: 'svc', name: 'Svc', providerId: 'openai', baseUrl: '', model: 'gpt-x', apiKey: 'sk-SECRET-1', apiKeys: ['sk-SECRET-1', 'sk-SECRET-2']}],
  activeApiServiceId: 'svc',
  mtServices: [{providerId: 'deepl', credentials: {apiKey: 'DEEPL-SECRET'}}],
  domainDetection: {...DEFAULT_SETTINGS.domainDetection, mode: 'api', apiModel: 'gpt-x', api: {baseUrl: 'https://api.openai.com/v1', apiKey: 'DETECT-SECRET'}, jevApiKey: 'JEV-SECRET'},
  customTerms: [{term: 'commit', translation: '提交', domain: 'tech'}],
  lookupKey: 'F',
});

test('设置白名单与排除清单恰好覆盖 DEFAULT_SETTINGS 的每一项', () => {
  const listed = [...BACKUP_SETTING_KEYS, ...BACKUP_EXCLUDED_SETTING_KEYS];
  assert.equal(new Set(listed).size, listed.length, '同一项不能既导出又排除');
  assert.deepEqual([...listed].sort(), Object.keys(DEFAULT_SETTINGS).sort(), '新增设置项必须决定是否随备份带走');
});

test('导出的设置不含模型服务、任何密钥与被排除的键', () => {
  const settings = normalizeSettings(secretSettings());
  assert.equal(settings.apiServices[0].apiKey, 'sk-SECRET-1', '前提：规范化后服务与密钥都还在');
  assert.equal(settings.mtServices[0].credentials.apiKey, 'DEEPL-SECRET');
  const exported = backupSettings(settings);
  const json = JSON.stringify(exported);
  for (const secret of SECRETS) assert.ok(!json.includes(secret), `备份里出现了密钥 ${secret}`);
  for (const key of BACKUP_EXCLUDED_SETTING_KEYS) assert.ok(!Object.hasOwn(exported, key), `备份里出现了 ${key}`);
  assert.equal(exported.lookupKey, 'F');
  assert.deepEqual(exported.customTerms, [{term: 'commit', translation: '提交', domain: 'tech'}]);
  exported.customTerms.push({term: 'x', translation: 'y', domain: 'tech'});
  assert.equal(settings.customTerms.length, 1, '导出的是深拷贝');
});

test('parseBackup 认新格式与旧版导出的词档案，规范化词档案并跳过认不出的记录', () => {
  const parsed = parseBackup(backupText({records: [word('latency'), {nope: true}, word('latency'), {...word('cache'), kind: 'sentence'}, {...word('queue'), domain: undefined}]}));
  assert.deepEqual(parsed.words.map(item => item.id), ['tech:latency', 'tech:queue']);
  assert.equal(parsed.words[1].domain, 'tech', '缺领域时按编号前缀补上');
  assert.equal(parsed.skippedWords, 3, '坏记录、重复编号与整句记录都跳过');
  assert.equal(parsed.meta.formatVersion, 1);
  assert.equal(parsed.meta.extensionVersion, '0.10.1');
  assert.equal(parsed.meta.hasSettings, true);

  const legacy = parseBackup(JSON.stringify({schemaVersion: 6, productSchemaVersion: 1, records: [word('latency')], legacyRecords: [], supportUsage: [], onDemandSuggestionShownAt: 0, modelUsage: {}}));
  assert.equal(legacy.meta.formatVersion, 0, '没有 format 的是 0.10 及更早版本导出的文件');
  assert.equal(legacy.settings, null);
  assert.equal(legacy.words.length, 1);

  const old = parseBackup(JSON.stringify({schemaVersion: 3, records: [{...word('latency'), extra: 'x'}]}));
  assert.deepEqual(old.words[0].senses, [], 'schema 4 之前的义项按迁移规则不保留');
  assert.ok(!Object.hasOwn(old.words[0], 'extra'), '未知字段不进词档案');
});

test('v5/v6 词档案按当前字段核对、不截断内容：查词卡最长 1200 字的说明原样保留，后台不读的旧字段不带进来', () => {
  const long = '说'.repeat(1200);
  const record = {...word('latency'), senses: [{...sense('latency#1'), stage: 'hint', locked: false, definition: {hint: 'a short hint', translation: long}}]};
  const [imported] = parseBackup(backupText({records: [record]})).words;
  assert.equal(imported.senses[0].definition.translation, long);
  const {stage: _stage, locked: _locked, ...expectedSense} = record.senses[0];
  assert.deepEqual(imported, {...record, senses: [expectedSense]});
  const [legacy] = parseBackup(JSON.stringify({schemaVersion: 4, records: [record]})).words;
  assert.equal(legacy.senses[0].definition.translation.length, 160, 'schema 4 的备份按本机升级同一套迁移处理');
});

test('parseBackup 拒绝非备份、坏 JSON 与更新版本的备份', () => {
  assert.throws(() => parseBackup(''), /备份文件是空的/u);
  assert.throws(() => parseBackup('{not json'), /不是有效的 JSON/u);
  assert.throws(() => parseBackup('[]'), /不是 RoamCat 导出的备份/u);
  assert.throws(() => parseBackup(JSON.stringify({format: 'other', formatVersion: 1, schemaVersion: 6, records: []})), /不是 RoamCat 导出的备份/u);
  assert.throws(() => parseBackup(JSON.stringify({schemaVersion: 6})), /不是 RoamCat 导出的备份/u);
  assert.throws(() => parseBackup(JSON.stringify({config: {enabled: true}, events: [], personalization: {}})), /阅读记录文件，目前不能导入/u);
  assert.throws(() => parseBackup(backupText({formatVersion: BACKUP_FORMAT_VERSION + 1})), /更新版本/u);
  assert.throws(() => parseBackup(backupText({schemaVersion: 7})), /更新版本/u);
  assert.throws(() => parseBackup(backupText({productSchemaVersion: 2})), /更新版本/u);
});

test('合并：补上本机没有的词，同一个词取最近活动更晚的一份，内容没变的词不重写', () => {
  const localSame = word('same', 2000), localNewer = word('newer', 9000), localOlder = word('older', 1000), localOnly = word('only', 1000);
  const incoming = parseBackup(backupText({records: [word('same', 2000, {revision: 7}), word('newer', 5000), word('older', 5000, {revision: 3}), word('fresh', 4000)]})).words;
  const {words, stats} = planWordImport([localSame, localNewer, localOlder, localOnly], incoming, 'merge');
  assert.deepEqual(words.map(item => item.id), ['tech:same', 'tech:newer', 'tech:older', 'tech:only', 'tech:fresh']);
  assert.equal(words[0], localSame, '内容相同（只差 revision）沿用本机对象');
  assert.equal(words[1], localNewer, '本机更新的保留本机');
  assert.equal(words[2].lastSeen, 5000, '备份更新的换成备份里的');
  assert.equal(words[2].revision, 4, 'revision 取两边较大值加一');
  assert.equal(words[3], localOnly, '备份里没有的本机词保留');
  assert.deepEqual(stats, {incoming: 4, added: 1, updated: 1, unchanged: 1, keptLocal: 1, removed: 0, local: 4, total: 5});
});

test('覆盖：结果就是备份里的词，备份里没有的本机词删掉；超过上限这种方式不可用', () => {
  const localSame = word('same'), localOnly = word('only');
  const incoming = parseBackup(backupText({records: [word('same'), word('fresh')]})).words;
  const {words, stats} = planWordImport([localSame, localOnly], incoming, 'replace');
  assert.deepEqual(words.map(item => item.id), ['tech:same', 'tech:fresh']);
  assert.equal(words[0], localSame);
  assert.equal(stats.removed, 1);
  assert.equal(stats.added, 1);

  const many = Array.from({length: MAX_IMPORT_WORDS}, (_, index) => word(`w${index}`));
  assert.doesNotThrow(() => planWordImport([], many, 'replace'));
  assert.throws(() => planWordImport([word('extra')], many, 'merge'), error => error.importLimit === true && /上限/u.test(error.message));
  assert.throws(() => planWordImport([], [], 'append'), /不支持的导入方式/u);
});

test('设置合并：术语、网站规则与自动开启网站只补新条目，本机条目优先，其余设置不动', () => {
  const current = normalizeSettings({
    lookupKey: 'F',
    customTerms: [{term: 'commit', translation: '提交（本机）', domain: 'tech'}],
    domainRules: [{host: 'example.com', pathPrefix: '/', includeSubdomains: false, domain: 'tech'}],
    automation: {allSites: false, sentenceGroupsAllSites: false, videoSites: false, sites: [{origin: 'https://a.example', enabled: true}]},
  });
  const raw = backupSettings({
    lookupKey: 'G',
    customTerms: [{term: 'commit', translation: '提交（备份）', domain: 'tech'}, {term: 'merge', translation: '合并', domain: 'tech'}, {term: '', translation: 'x', domain: 'tech'}],
    domainRules: [{host: 'docs.example.com', pathPrefix: '/', includeSubdomains: true, domain: 'data'}],
    automation: {allSites: true, sentenceGroupsAllSites: false, videoSites: true, sites: [{origin: 'https://a.example', enabled: false}, {origin: 'https://b.example', enabled: true}, {origin: 'not a url', enabled: true}]},
  });
  const plan = planSettingsImport(current, raw, 'merge');
  assert.deepEqual(plan.patch.customTerms.map(row => row.translation), ['提交（本机）', '合并']);
  assert.deepEqual(plan.stats.terms, {incoming: 2, added: 1, removed: 0, skipped: 1, total: 2});
  assert.deepEqual(plan.patch.domainRules.map(rule => rule.host), ['example.com', 'docs.example.com']);
  assert.deepEqual(plan.automation.sites, [{origin: 'https://a.example', enabled: true}, {origin: 'https://b.example', enabled: true}]);
  assert.equal(plan.automation.allSites, false, '合并不改自动开启开关');
  assert.equal(plan.stats.sites.skipped, 1);
  assert.ok(!Object.hasOwn(plan.patch, 'lookupKey'), '合并不改阅读偏好');
  assert.equal(plan.video, null);
  assert.equal(plan.stats.preferences, null);
});

test('设置覆盖：逐项恢复偏好与视频设置，备份里缺的项保持本机原样，认不出的项跳过', () => {
  const current = normalizeSettings({lookupKey: 'F', pdfReader: false, customTerms: [{term: 'commit', translation: '提交', domain: 'tech'}], video: {...DEFAULT_SETTINGS.video, fontSize: 24}});
  const raw = {...backupSettings({lookupKey: 'G', helpLanguage: 'en', video: {...DEFAULT_SETTINGS.video, fontSize: 28, theme: 'dark'}, customTerms: []}), domain: 'nonsense'};
  delete raw.pdfReader;
  raw.video.translationColor = 'purple';
  const plan = planSettingsImport(current, raw, 'replace');
  assert.equal(plan.patch.lookupKey, 'G');
  assert.equal(plan.patch.helpLanguage, 'en');
  assert.deepEqual(plan.patch.customTerms, [], '覆盖时列表换成备份里的（这里是空的）');
  assert.equal(plan.stats.terms.removed, 1);
  assert.ok(!Object.hasOwn(plan.patch, 'pdfReader'), '备份里缺的项不动');
  assert.ok(!Object.hasOwn(plan.patch, 'domain'), '认不出的领域跳过');
  assert.equal(plan.video.fontSize, 28);
  assert.equal(plan.video.theme, 'dark');
  assert.equal(plan.video.translationColor, current.video.translationColor, '认不出的字幕颜色跳过、保持本机');
  assert.deepEqual(plan.stats.preferences.skipped.sort(), ['domain', 'video.translationColor']);
  assert.ok(plan.stats.preferences.changed >= 4);
});

test('设置超出上限时这种方式不可用（预览时按方式分别提示）', () => {
  const terms = Array.from({length: 1000}, (_, index) => ({term: `term${index}`, translation: '译', domain: 'tech'}));
  const current = normalizeSettings({customTerms: [{term: 'local', translation: '本机', domain: 'tech'}]});
  assert.doesNotThrow(() => planSettingsImport(current, {customTerms: terms}, 'replace'));
  assert.throws(() => planSettingsImport(current, {customTerms: terms}, 'merge'), error => error.importLimit === true && /1000/u.test(error.message));
});

test('READING_DATA_IMPORT 载荷：正文必填且限长，正式导入必须选方式', () => {
  assert.deepEqual(parseReadingDataImport({text: '{}', dryRun: true}), {text: '{}', dryRun: true, mode: null});
  assert.deepEqual(parseReadingDataImport({text: '{}', mode: 'replace'}), {text: '{}', dryRun: false, mode: 'replace'});
  assert.throws(() => parseReadingDataImport({text: '{}'}), /合并或覆盖/u);
  assert.throws(() => parseReadingDataImport({text: '', dryRun: true}), /为空或太大/u);
  assert.throws(() => parseReadingDataImport({text: '{}', dryRun: 'yes'}), /无效的导入请求/u);
});

test('backupContents 给预览用的条目数', () => {
  const contents = backupContents(parseBackup(backupText({records: [word('a'), {bad: 1}], settings: backupSettings({customTerms: [{term: 'commit', translation: '提交', domain: 'tech'}]})})));
  assert.deepEqual(contents, {words: 1, skippedWords: 1, terms: 1, rules: 0, sites: 0, hasSettings: true});
});

function backgroundChrome(local, {contentSender = false} = {}) {
  const listeners = {};
  const read = (map, keys) => {
    if (keys == null) return Object.fromEntries(map);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))]));
  };
  const writes = [];
  const area = (map, log) => ({
    get: async keys => read(map, keys),
    set: async value => { log?.push(Object.keys(value || {})); for (const [key, item] of Object.entries(value || {})) map.set(key, structuredClone(item)); },
    remove: async keys => { for (const key of [].concat(keys)) map.delete(key); },
    getBytesInUse: async () => 0,
    QUOTA_BYTES: 10 * 1024 * 1024,
  });
  const runtime = {
    id: 'testextensionid1234567890abcdef', lastError: null,
    getURL: path => `chrome-extension://${runtime.id}/${String(path).replace(/^\/+/u, '')}`,
    getManifest: () => ({version: '0.10.1'}),
    onConnect: {addListener() {}}, onMessage: {addListener(fn) { listeners.message = fn; }},
    onInstalled: {addListener() {}}, onStartup: {addListener() {}},
    sendMessage: async () => undefined, openOptionsPage: async () => {},
    connectNative: () => { throw new Error('mock: 未安装本机连接器'); }, getContexts: async () => [],
  };
  const chrome = {
    runtime, i18n: {getUILanguage: () => 'zh-CN'},
    storage: {local: area(local, writes), session: area(new Map())},
    tabs: {query: async () => [], get: async id => ({id, url: 'https://example.com/'}), sendMessage: async () => undefined,
      create: async () => ({id: 99, windowId: 1}), remove: async () => {}, update: async () => {},
      onRemoved: {addListener() {}}, onUpdated: {addListener() {}}, onActivated: {addListener() {}}},
    scripting: {executeScript: async () => [], getRegisteredContentScripts: async () => [], registerContentScripts: async () => [], unregisterContentScripts: async () => {}},
    contextMenus: {removeAll: async () => {}, create: (_o, done) => done?.(), onClicked: {addListener() {}}},
    commands: {onCommand: {addListener() {}}},
    permissions: {contains: async () => true, remove: async () => false, onAdded: {addListener() {}}, onRemoved: {addListener() {}}},
    tts: {}, offscreen: {hasDocument: async () => false, createDocument: async () => {}},
    webNavigation: {getFrame: async () => null, onHistoryStateUpdated: {addListener() {}}, onBeforeNavigate: {addListener() {}}, onCommitted: {addListener() {}}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    windows: {getAll: async () => [], update: async () => {}},
  };
  const sender = contentSender
    ? {id: runtime.id, url: 'https://example.com/', tab: {id: 3, url: 'https://example.com/'}, frameId: 0}
    : {id: runtime.id, url: runtime.getURL('ui/options.html')};
  return {chrome, writes, ask: message => new Promise(resolve => listeners.message(message, sender, resolve))};
}
let boot = 0;
async function bootBackground(local, options) {
  const mock = backgroundChrome(local, options);
  globalThis.chrome = mock.chrome;
  await import(`../../roamcat-0.0.1/extension/background.js?data-backup=${++boot}`);
  return mock;
}
const v6 = (words, extra = {}) => new Map([
  ['wordSchemaVersion', 6], ['productSchemaVersion', 1], ['wordIds', words.map(item => item.id)],
  ...words.map(item => [`word:${item.id}`, item]), ...Object.entries(extra),
]);

test('真 background.js：导出 → 预览 → 覆盖导入到全新配置，合并保留本机较新的词', async t => {
  const originalError = console.error, originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  t.after(() => { console.error = originalError; console.warn = originalWarn; });

  const source = v6([word('latency', 5000), word('cache', 6000)], {
    settings: normalizeSettings({
      ...secretSettings(),
      domainRules: [{host: 'docs.example.com', pathPrefix: '/guide', includeSubdomains: true, domain: 'data'}],
      automation: {allSites: false, sentenceGroupsAllSites: false, videoSites: true, sites: [{origin: 'https://news.example', enabled: true}]},
      video: {...DEFAULT_SETTINGS.video, fontSize: 28},
    }),
    sentenceGroupsDensity: 'fine', sentenceGroupsLineStyle: 'wavy',
  });
  let backup;
  await t.test('导出：带格式标记、词档案与白名单设置，不含任何密钥', async () => {
    const mock = await bootBackground(source);
    const exported = await mock.ask({type: 'READING_DATA_EXPORT'});
    assert.equal(exported.ok, true, exported.error);
    backup = JSON.stringify(exported.data);
    assert.equal(exported.data.format, BACKUP_FORMAT);
    assert.equal(exported.data.extensionVersion, '0.10.1');
    assert.deepEqual(exported.data.records.map(item => item.id), ['tech:latency', 'tech:cache']);
    assert.deepEqual(exported.data.sentenceGroups, {density: 'fine', lineStyle: 'wavy'});
    for (const secret of SECRETS) assert.ok(!backup.includes(secret), `导出里出现了密钥 ${secret}`);
    assert.ok(!Object.hasOwn(exported.data.settings, 'apiServices'));
  });

  await t.test('预览：两种方式都算出来，不写入任何东西', async () => {
    const target = v6([word('latency', 9000), word('mine', 1000)]);
    const mock = await bootBackground(target);
    const before = structuredClone(Object.fromEntries(target));
    await mock.ask({type: 'STATE_GET'});
    mock.writes.length = 0;
    const preview = await mock.ask({type: 'READING_DATA_IMPORT', text: backup, dryRun: true});
    assert.equal(preview.ok, true, preview.error);
    assert.equal(preview.data.dryRun, true);
    assert.deepEqual(preview.data.contents, {words: 2, skippedWords: 0, terms: 1, rules: 1, sites: 1, hasSettings: true});
    assert.deepEqual({added: preview.data.merge.words.added, keptLocal: preview.data.merge.words.keptLocal}, {added: 1, keptLocal: 1});
    assert.deepEqual({total: preview.data.replace.words.total, removed: preview.data.replace.words.removed, local: preview.data.replace.words.local}, {total: 2, removed: 1, local: 2});
    assert.deepEqual(mock.writes, [], '只预览不写');
    assert.deepEqual(Object.fromEntries(target), before);
  });

  await t.test('覆盖导入到全新配置：词档案、设置与解构样式都回来，本机服务与密钥不动', async () => {
    const localService = {id: 'local', name: 'Local', providerId: 'openai', baseUrl: '', model: 'gpt-local', apiKey: 'sk-LOCAL', apiKeys: ['sk-LOCAL']};
    const target = v6([word('stale', 1000)], {settings: normalizeSettings({providerKind: 'api', apiServices: [localService], activeApiServiceId: 'local'})});
    const mock = await bootBackground(target);
    const result = await mock.ask({type: 'READING_DATA_IMPORT', text: backup, mode: 'replace'});
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.imported, true);
    assert.deepEqual(target.get('wordIds'), ['tech:latency', 'tech:cache']);
    assert.equal(target.has('word:tech:stale'), false, '备份里没有的词删掉');
    const settings = target.get('settings');
    assert.equal(settings.lookupKey, 'F');
    assert.deepEqual(settings.customTerms, [{term: 'commit', translation: '提交', domain: 'tech'}]);
    assert.deepEqual(settings.domainRules.map(rule => rule.host), ['docs.example.com']);
    assert.deepEqual(settings.automation.sites, [{origin: 'https://news.example', enabled: true}]);
    assert.equal(settings.automation.videoSites, true);
    assert.equal(settings.video.fontSize, 28);
    assert.equal(settings.providerKind, 'api', '模型服务不随备份改');
    assert.deepEqual(settings.apiServices.map(service => [service.id, service.apiKey]), [['local', 'sk-LOCAL']]);
    assert.equal(settings.domainDetection.jevApiKey, '', '备份里的密钥不会被写进来');
    assert.equal(target.get('sentenceGroupsDensity'), 'fine');
    assert.equal(target.get('sentenceGroupsLineStyle'), 'wavy');
    const again = await mock.ask({type: 'READING_DATA_EXPORT'});
    assert.deepEqual(again.data.records.map(item => item.id), ['tech:latency', 'tech:cache']);
  });

  await t.test('合并：保留本机较新的词与本机设置，只补新条目', async () => {
    const localNewer = word('latency', 9000, {helpCount: 5});
    const target = v6([localNewer], {settings: normalizeSettings({lookupKey: 'K', customTerms: [{term: 'commit', translation: '本机译法', domain: 'tech'}]})});
    const mock = await bootBackground(target);
    const result = await mock.ask({type: 'READING_DATA_IMPORT', text: backup, mode: 'merge'});
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(target.get('wordIds'), ['tech:latency', 'tech:cache']);
    assert.equal(target.get('word:tech:latency').helpCount, 5, '本机更新的词保留');
    const settings = target.get('settings');
    assert.equal(settings.lookupKey, 'K', '合并不改阅读偏好');
    assert.deepEqual(settings.customTerms.map(row => row.translation), ['本机译法']);
    assert.deepEqual(settings.automation.sites, [{origin: 'https://news.example', enabled: true}]);
    assert.equal(target.has('sentenceGroupsDensity'), false, '合并不改解构样式');
  });

  await t.test('更新版本的备份与网页上下文都被拒绝', async () => {
    const target = v6([word('mine')]);
    const mock = await bootBackground(target);
    const future = await mock.ask({type: 'READING_DATA_IMPORT', text: JSON.stringify({...JSON.parse(backup), schemaVersion: 7}), mode: 'replace'});
    assert.equal(future.ok, false);
    assert.match(future.error, /更新版本/u);
    assert.deepEqual(target.get('wordIds'), ['tech:mine']);
    const page = await bootBackground(v6([word('mine')]), {contentSender: true});
    const blocked = await page.ask({type: 'READING_DATA_IMPORT', text: backup, mode: 'replace'});
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /不能从网页执行/u);
  });
});
