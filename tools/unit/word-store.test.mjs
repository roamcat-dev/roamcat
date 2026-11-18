/**
 * @file tools/unit/word-store.test.mjs
 * 文件职责：固化词档案拆分存储（word-store.mjs）与 schema v5 → v6 迁移的行为。
 * 主要内容：① 纯模块：按引用比出写入/删除/清单变化，先删后写，清单里有、键已不在的读取时跳过；
 *   分批迁移每批一次 set、存储里始终只有一份、任意一批之后崩溃都能接着搬完，修复函数逐条生效、重复 ID 只留一条；
 *   ② 真 background.js：v5 的 `words` 数组冷启动后变成每词一个键（schema v6）、导出完整，
 *   未来 schema（v7）拒绝运行而不是当空库覆盖。
 * 模块边界：只 mock 浏览器边界（chrome.storage 等），不 mock 被测扩展模块。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  WORD_SCHEMA_VERSION, WORD_INDEX_KEY, wordKey, readWords, diffWords, hasWordChanges, writeWordDiff, clearWords, migrateWordArray,
} from '../../roamcat-0.0.1/extension/word-store.mjs';

function memoryStorage(initial = {}, {failAfterSets = Infinity} = {}) {
  const map = new Map(Object.entries(structuredClone(initial)));
  const log = [];
  let sets = 0, peak = 0;
  const size = () => [...map.values()].reduce((sum, value) => sum + JSON.stringify(value).length, 0);
  const pick = keys => {
    if (keys == null) return Object.fromEntries(map);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))]));
  };
  return {
    map, log, peak: () => peak,
    get: async keys => pick(keys),
    set: async value => {
      if (sets++ >= failAfterSets) throw new Error('mock: 写到一半崩溃');
      log.push(['set', Object.keys(value)]);
      for (const [key, item] of Object.entries(value)) map.set(key, structuredClone(item));
      peak = Math.max(peak, size());
    },
    remove: async keys => { log.push(['remove', [].concat(keys)]); for (const key of [].concat(keys)) map.delete(key); },
  };
}
const word = (id, extra = {}) => ({id, term: id, revision: 0, knownAt: 0, senses: [], ...extra});

test('diffWords 只写引用变了的词，删掉消失的词，成员或顺序变了才重写清单', () => {
  const a = word('a'), b = word('b'), c = word('c');
  assert.deepEqual(diffWords([a, b], [a, b]), {set: {}, remove: [], index: null});
  assert.equal(hasWordChanges(diffWords([a, b], [a, b])), false);
  const b2 = {...b, revision: 1};
  assert.deepEqual(diffWords([a, b], [a, b2]), {set: {[wordKey('b')]: b2}, remove: [], index: null});
  assert.deepEqual(diffWords([a, b], [a, b, c]), {set: {[wordKey('c')]: c}, remove: [], index: ['a', 'b', 'c']});
  assert.deepEqual(diffWords([a, b, c], [a, c]), {set: {}, remove: [wordKey('b')], index: ['a', 'c']});
  const dup = diffWords([], [a, {...a, revision: 9}]);
  assert.deepEqual(dup.index, ['a'], '重复 ID 只留第一次出现的');
  assert.equal(dup.set[wordKey('a')], a);
});

test('writeWordDiff 先删后写，其他键与词一起一次写入；读取跳过已删的键', async () => {
  const storage = memoryStorage({[WORD_INDEX_KEY]: ['a', 'b'], [wordKey('a')]: word('a'), [wordKey('b')]: word('b')});
  const a2 = word('a', {revision: 2});
  await writeWordDiff(storage, diffWords([word('a'), word('b')].map((w, i) => i ? w : w), [a2]), {settings: {x: 1}});
  assert.deepEqual(storage.log, [['remove', [wordKey('b')]], ['set', ['settings', wordKey('a'), WORD_INDEX_KEY]]]);
  assert.deepEqual(await readWords(storage), [a2]);
  // 清单里还在、键已不在（删到一半崩溃）：读取时跳过。
  storage.map.set(WORD_INDEX_KEY, ['a', 'ghost']);
  assert.deepEqual((await readWords(storage)).map(w => w.id), ['a']);
  assert.deepEqual(await readWords(memoryStorage()), [], '没有清单就是空库');
});

test('clearWords 删掉全部词键并清空清单', async () => {
  const storage = memoryStorage({[WORD_INDEX_KEY]: ['a', 'b'], [wordKey('a')]: word('a'), [wordKey('b')]: word('b'), other: 1});
  await clearWords(storage);
  assert.deepEqual(Object.fromEntries(storage.map), {[WORD_INDEX_KEY]: [], other: 1});
});

test('迁移分批搬运：每批一次 set，存储里始终只有一份，搬完写 v6 并删掉旧数组', async () => {
  const words = Array.from({length: 1234}, (_, i) => word(`w${i}`, {knownAt: i === 0 ? '1' : 0, pad: 'x'.repeat(200)}));
  const storage = memoryStorage({wordSchemaVersion: 5, words});
  const single = JSON.stringify(words).length;
  const count = await migrateWordArray(storage, {repair: w => ({...w, knownAt: Number(w.knownAt) || 0}), extra: {wordMaintenanceVersion: 1}, batch: 500});
  assert.equal(count, 1234);
  assert.equal(storage.map.get('wordSchemaVersion'), WORD_SCHEMA_VERSION);
  assert.equal(storage.map.get('wordMaintenanceVersion'), 1);
  assert.equal(storage.map.has('words'), false);
  const migrated = await readWords(storage);
  assert.deepEqual(migrated.map(w => w.id), words.map(w => w.id), '保持原顺序');
  assert.equal(migrated[0].knownAt, 1, '修复函数逐条生效');
  // 拆分后每条多了键名与清单；新旧两份并存时会接近 2 倍。
  assert.ok(storage.peak() < single * 1.3, `峰值 ${storage.peak()} 应接近单份 ${single}`);
});

test('迁移任意一批之后崩溃，下次启动接着搬完，不丢不重', async () => {
  const words = Array.from({length: 1100}, (_, i) => word(`w${i}`));
  // 1100 词 = 3 批 + 最后写版本号，共 4 次 set；逐一让第 1–4 次写入崩溃。
  for (let failAfter = 0; failAfter < 4; failAfter++) {
    const storage = memoryStorage({wordSchemaVersion: 5, words}, {failAfterSets: failAfter});
    await assert.rejects(migrateWordArray(storage, {batch: 500}));
    const resumed = memoryStorage(Object.fromEntries(storage.map));
    // 崩溃后的中间状态：拆分键 + 剩下的数组，两边合起来正好是全部词。
    const partial = [...await readWords(resumed), ...(resumed.map.get('words') || [])].map(w => w.id);
    assert.deepEqual(partial, words.map(w => w.id), `第 ${failAfter} 次写入崩溃后数据完整`);
    if (resumed.map.get('wordSchemaVersion') === WORD_SCHEMA_VERSION) continue; // 最后一步之前就已写完版本号
    await migrateWordArray(resumed, {batch: 500});
    assert.deepEqual((await readWords(resumed)).map(w => w.id), words.map(w => w.id), `第 ${failAfter} 次写入崩溃后续搬完整`);
  }
});

function backgroundChrome(local) {
  const listeners = {};
  const read = (map, keys) => {
    if (keys == null) return Object.fromEntries(map);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))]));
  };
  const area = map => ({
    get: async keys => read(map, keys),
    set: async value => { for (const [key, item] of Object.entries(value || {})) map.set(key, structuredClone(item)); },
    remove: async keys => { for (const key of [].concat(keys)) map.delete(key); },
    getBytesInUse: async () => 0,
    QUOTA_BYTES: 10 * 1024 * 1024,
  });
  const runtime = {
    id: 'testextensionid1234567890abcdef', lastError: null,
    getURL: path => `chrome-extension://${runtime.id}/${String(path).replace(/^\/+/u, '')}`,
    onConnect: {addListener() {}}, onMessage: {addListener(fn) { listeners.message = fn; }},
    onInstalled: {addListener() {}}, onStartup: {addListener() {}},
    sendMessage: async () => undefined, openOptionsPage: async () => {},
    connectNative: () => { throw new Error('mock: 未安装本机连接器'); }, getContexts: async () => [],
  };
  const chrome = {
    runtime, i18n: {getUILanguage: () => 'zh-CN'},
    storage: {local: area(local), session: area(new Map())},
    tabs: {query: async () => [], get: async id => ({id, url: 'https://example.com/'}), sendMessage: async () => undefined,
      create: async () => ({id: 99, windowId: 1}), remove: async () => {}, update: async () => {},
      onRemoved: {addListener() {}}, onUpdated: {addListener() {}}, onActivated: {addListener() {}}},
    scripting: {executeScript: async () => [], getRegisteredContentScripts: async () => [], registerContentScripts: async () => [], unregisterContentScripts: async () => {}},
    contextMenus: {removeAll: async () => {}, create: (_o, done) => done?.(), onClicked: {addListener() {}}},
    commands: {onCommand: {addListener() {}}},
    permissions: {contains: async () => false, remove: async () => false, onAdded: {addListener() {}}, onRemoved: {addListener() {}}},
    tts: {}, offscreen: {hasDocument: async () => false, createDocument: async () => {}},
    webNavigation: {getFrame: async () => null, onHistoryStateUpdated: {addListener() {}}, onBeforeNavigate: {addListener() {}}, onCommitted: {addListener() {}}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    windows: {getAll: async () => [], update: async () => {}},
  };
  const sender = {id: runtime.id, url: runtime.getURL('ui/options.html')};
  return {chrome, ask: message => new Promise(resolve => listeners.message(message, sender, resolve))};
}
let boot = 0;
async function bootBackground(local) {
  const mock = backgroundChrome(local);
  globalThis.chrome = mock.chrome;
  await import(`../../roamcat-0.0.1/extension/background.js?word-store=${++boot}`);
  return mock;
}

test('真 background.js：v5 词库冷启动迁成拆分键，导出完整', async t => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  await t.test('v5 → v6 迁移与导出', async () => {
    const words = [word('alpha', {knownAt: '1700000000000'}), word('beta')];
    const local = new Map([['wordSchemaVersion', 5], ['productSchemaVersion', 1], ['words', words]]);
    const mock = await bootBackground(local);
    const exported = await mock.ask({type: 'READING_DATA_EXPORT'});
    assert.equal(exported.ok, true, exported.error);
    assert.equal(local.get('wordSchemaVersion'), 6);
    assert.equal(local.has('words'), false);
    assert.deepEqual(local.get('wordIds'), ['alpha', 'beta']);
    assert.equal(local.get('word:alpha').knownAt, 1700000000000, 'v5 的 knownAt 修复在迁移时补上');
    assert.equal(exported.data.schemaVersion, 6);
    assert.deepEqual(exported.data.records.map(w => w.id), ['alpha', 'beta']);
    // 清空记录还要清 IndexedDB 里的阅读记录，Node 里没有 IndexedDB：由上面的 clearWords 纯测试与浏览器门禁覆盖。
  });

  await t.test('未来 schema 拒绝运行，不把词库当空库覆盖', async () => {
    const local = new Map([['wordSchemaVersion', 7], ['productSchemaVersion', 1], ['wordIds', ['a']], ['word:a', word('a')]]);
    const mock = await bootBackground(local);
    const state = await mock.ask({type: 'STATE_GET'});
    assert.match(state.data?.dataProblem || state.error || '', /不支持的数据版本/u);
    assert.deepEqual(local.get('wordIds'), ['a']);
    assert.ok(local.has('word:a'));
  });
});
