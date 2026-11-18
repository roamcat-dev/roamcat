/**
 * @file 词档案存储门禁：在真实扩展后台验证每词一键的拆分存储——迁移、续搬、单词写入、两种清理与数据版本保护。
 * 主要内容：经 chrome.storage.local 写入某种存储布局后 chrome.runtime.reload()，让后台按这份布局冷启动，再用
 *   STATE_GET / READING_DATA_EXPORT / HISTORY_RULE_SET / HISTORY_CLEAR / MEMORY_CLEAR 断言：全新配置直接是数据版本 6；
 *   v5 整份数组 3000 词迁成拆分键且存储体积不翻倍；迁到一半的布局接着搬、不重复；改一个词只写这一个键；
 *   清空浏览历史保留词档案；清空阅读记录删净词键、清单与旧数组残留；更高数据版本拒绝运行且不碰词档案。
 * 模块边界：使用 tools/lib/ego.mjs 的独立 ego lite（临时配置里开启开发者模式才能重载扩展），不调用模型、不访问外网；
 *   要求先构建，报告写 preview/gates/storage.json。
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import assert from 'node:assert/strict';
import {openBrowser, extUrl} from './lib/ego.mjs';
import {createGateReport} from './lib/gate-report.mjs';

const gate = createGateReport('storage');
const errors = [];
const OPTIONS = extUrl('ui/options.html');
const WORDS = 3000;
const UNSUPPORTED = /不支持的数据版本|Unsupported data version/u;

const until = async (probe, ok, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    try { value = await probe(); } catch (error) { value = {error: error.message}; }
    if (ok(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}未就绪：${JSON.stringify(value)?.slice(0, 300)}`);
};

const run = await openBrowser();
let control = run.page;
control.on('pageerror', error => errors.push(error.message));

const send = (type, payload = {}) => control.evaluate(message => chrome.runtime.sendMessage(message), {type, ...payload});
const data = reply => { assert.ok(reply?.ok, reply?.error || JSON.stringify(reply)); return reply.data; };
const state = async () => data(await send('STATE_GET'));
const exported = async () => data(await send('READING_DATA_EXPORT')).records.length;
// 只取词档案相关的键：版本号、清单、旧数组，外加按需点名的几个词键与全部词键的个数。
const snapshot = (pick = []) => control.evaluate(async pick => {
  const all = await chrome.storage.local.get(null);
  const ids = Array.isArray(all.wordIds) ? all.wordIds : null;
  return {
    version: all.wordSchemaVersion, maintenance: all.wordMaintenanceVersion, ids: ids?.length ?? null,
    unique: ids ? new Set(ids).size : null, inOrder: ids ? ids.every((id, i) => id === `w-${i}`) : null,
    wordKeys: Object.keys(all).filter(key => key.startsWith('word:')).length, legacy: 'words' in all,
    cleanup: Object.keys(all).filter(key => key === 'readingCleanup'),
    picked: Object.fromEntries(pick.map(id => [id, all['word:' + id] ?? null])),
    bytes: await chrome.storage.local.getBytesInUse(null),
  };
}, pick);

async function openControl() {
  const page = await run.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await until(async () => {
    try { await page.goto(OPTIONS); return true; }
    catch (error) { if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(error.message)) return false; throw error; }
  }, Boolean, '重载后的扩展页');
  return page;
}

/**
 * 把词档案换成指定布局后重载扩展。spec：version 数据版本；split [起, 止) 写成拆分键与清单；legacy [起, 止) 写进旧
 * `words` 数组；duplicate 再往数组头部放一条已在清单里的词；extra 其他键。词 w-7 的 knownAt 故意存成字符串，
 * 迁移时应被修成数字。chrome.storage.session 随重载清空，借它确认接管的是新后台。返回重载前的存储字节数。
 */
async function reloadWith(spec) {
  const before = await control.evaluate(async spec => {
    const word = i => ({id: `w-${i}`, term: `term${i}`, domain: 'general', kind: 'word', revision: 1, helpCount: 0, requestedAt: 0,
      knownAt: i === 7 ? '1700000000000' : 0, lastSeen: 0, hintPreference: null, senses: [{key: 'k', gloss: '释义'.repeat(40), hintPreference: null}]});
    const range = ([from, to] = [0, 0]) => Array.from({length: to - from}, (_, k) => word(from + k));
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(key => key === 'words' || key === 'wordIds' || key.startsWith('word:')));
    const split = range(spec.split), legacy = range(spec.legacy);
    if (spec.duplicate !== undefined) legacy.unshift(word(spec.duplicate));
    const layout = {wordSchemaVersion: spec.version, ...spec.extra};
    if (spec.split) Object.assign(layout, {wordIds: split.map(item => item.id)}, Object.fromEntries(split.map(item => ['word:' + item.id, item])));
    if (spec.legacy) layout.words = legacy;
    await chrome.storage.local.set(layout);
    await chrome.storage.session.set({storageGateMarker: true});
    const bytes = await chrome.storage.local.getBytesInUse(null);
    setTimeout(() => chrome.runtime.reload(), 50);
    return bytes;
  }, spec);
  await until(async () => !(await run.browser.send('Target.getTargets')).targetInfos.some(info => info.type === 'page' && info.url.startsWith(OPTIONS)), Boolean, '旧扩展页关闭');
  control = await openControl();
  await until(() => control.evaluate(async () => !(await chrome.storage.session.get('storageGateMarker')).storageGateMarker), Boolean, '新后台接管');
  return before;
}
const migrated = () => until(() => snapshot(), value => value.version === 6 && !value.legacy, '迁移完成');

try {
  // 命令行加载会绕过首次检查；重载前须开启临时配置的开发者模式，否则重载后扩展会被 ego 的开发版策略停用。
  const manager = await run.newPage();
  await manager.goto('chrome://extensions/');
  await manager.locator('#devMode').waitFor({state: 'visible'});
  if (!await manager.locator('#devMode').isChecked()) await manager.locator('#devMode').click();
  await manager.close();
  await control.goto(OPTIONS);

  await gate.check('全新配置直接初始化为数据版本 6，词清单为空、没有旧数组', async () => {
    await until(() => send('STATE_GET'), reply => reply?.ok, '后台初始化');
    const value = await until(() => snapshot(), item => item.version === 6, '数据版本');
    assert.deepEqual({ids: value.ids, wordKeys: value.wordKeys, legacy: value.legacy}, {ids: 0, wordKeys: 0, legacy: false});
    assert.equal((await state()).dataProblem || '', '');
    return {version: value.version};
  });

  await gate.check(`v5 整份数组 ${WORDS} 词重载后迁成拆分键：顺序不变、旧数组删除、knownAt 修复、体积不翻倍`, async () => {
    const before = await reloadWith({version: 5, legacy: [0, WORDS], extra: {wordMaintenanceVersion: 0}});
    const value = await migrated();
    assert.deepEqual({ids: value.ids, unique: value.unique, inOrder: value.inOrder, wordKeys: value.wordKeys, maintenance: value.maintenance},
      {ids: WORDS, unique: WORDS, inOrder: true, wordKeys: WORDS, maintenance: 1});
    const repaired = (await snapshot(['w-7'])).picked['w-7'];
    assert.equal(repaired?.knownAt, 1700000000000, 'knownAt 字符串时间戳应修成数字');
    assert.equal(await exported(), WORDS);
    assert.equal((await state()).dataProblem || '', '');
    const ratio = value.bytes / before;
    assert.ok(ratio < 1.15, `迁移后存储体积不应明显变大：${before} → ${value.bytes}`);
    return {bytesBefore: before, bytesAfter: value.bytes, ratio: Math.round(ratio * 1000) / 1000};
  });

  await gate.check('迁到一半的布局（已搬 1000、数组剩 2000、混入一条已搬的词）重载后接着搬完且不重复', async () => {
    await reloadWith({version: 5, split: [0, 1000], legacy: [1000, WORDS], duplicate: 5, extra: {wordMaintenanceVersion: 0}});
    const value = await migrated();
    assert.deepEqual({ids: value.ids, unique: value.unique, inOrder: value.inOrder, wordKeys: value.wordKeys},
      {ids: WORDS, unique: WORDS, inOrder: true, wordKeys: WORDS});
    assert.equal(await exported(), WORDS);
    return {ids: value.ids};
  });

  await gate.check('改一个词只写这一个键：清单与其他词键都不重写', async () => {
    await control.evaluate(() => {
      window.storageGateChanges = [];
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') window.storageGateChanges.push(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, JSON.stringify(change.newValue ?? null).length])));
      });
    });
    const before = (await snapshot(['w-41', 'w-42'])).picked;
    data(await send('HISTORY_RULE_SET', {wordId: 'w-42', senseKey: 'k', stage: 'quiet', locked: true}));
    const events = await until(() => control.evaluate(() => window.storageGateChanges), list => list.some(event => 'word:w-42' in event), '词键变更');
    await state(); // 再走一轮消息，让同一事务之后的写入事件都送到
    const all = await control.evaluate(() => window.storageGateChanges);
    const wordKeys = [...new Set(all.flatMap(event => Object.keys(event)).filter(key => key === 'wordIds' || key === 'words' || key.startsWith('word:')))];
    assert.deepEqual(wordKeys, ['word:w-42']);
    const after = (await snapshot(['w-41', 'w-42'])).picked;
    assert.equal(after['w-42'].revision, before['w-42'].revision + 1);
    assert.deepEqual(after['w-41'], before['w-41']);
    const written = events.find(event => 'word:w-42' in event)['word:w-42'];
    assert.ok(written < 2048, `单词写入应只有这一条的大小：${written} 字符`);
    return {keys: wordKeys, chars: written};
  });

  await gate.check('清空浏览历史保留词档案', async () => {
    data(await send('HISTORY_CLEAR'));
    const value = await snapshot(['w-42']);
    assert.deepEqual({ids: value.ids, wordKeys: value.wordKeys, cleanup: value.cleanup}, {ids: WORDS, wordKeys: WORDS, cleanup: []});
    assert.ok(value.picked['w-42']);
    assert.equal(await exported(), WORDS);
    return {ids: value.ids};
  });

  await gate.check('清空阅读记录删净词键、清单与没迁完的旧数组残留，数据版本不变、后台照常可用', async () => {
    await control.evaluate(() => chrome.storage.local.set({words: [{id: 'legacy-1', term: 'legacy', domain: 'general', kind: 'word', revision: 1, senses: []}]}));
    assert.equal(await exported(), WORDS + 1, '导出应合并没迁完的旧数组');
    assert.deepEqual(data(await send('MEMORY_CLEAR')), {cleared: true});
    const value = await snapshot();
    assert.deepEqual({version: value.version, ids: value.ids, wordKeys: value.wordKeys, legacy: value.legacy, cleanup: value.cleanup},
      {version: 6, ids: 0, wordKeys: 0, legacy: false, cleanup: []});
    assert.equal(await exported(), 0);
    assert.equal((await state()).dataProblem || '', '');
    return {bytes: value.bytes};
  });

  await gate.check('更高的数据版本（7）拒绝运行：提示更新扩展，改词与清理都被拒绝，词档案原样不动', async () => {
    await reloadWith({version: 7, split: [0, 200]});
    const status = await until(() => state(), value => Boolean(value?.dataProblem), '数据版本提示');
    assert.match(status.dataProblem, UNSUPPORTED);
    const rule = await send('HISTORY_RULE_SET', {wordId: 'w-1', senseKey: 'k', stage: 'quiet', locked: true});
    assert.equal(rule?.ok, false);
    assert.match(rule.error, UNSUPPORTED);
    const clear = await send('MEMORY_CLEAR');
    assert.equal(clear?.ok, false);
    assert.match(clear.error, UNSUPPORTED);
    const value = await snapshot(['w-1']);
    assert.deepEqual({version: value.version, ids: value.ids, wordKeys: value.wordKeys, legacy: value.legacy}, {version: 7, ids: 200, wordKeys: 200, legacy: false});
    assert.equal(value.picked['w-1'].revision, 1);
    return {dataProblem: status.dataProblem};
  });

  await gate.check('扩展页没有未捕获脚本错误', () => assert.deepEqual(errors, []));
} catch (error) {
  await gate.check('词档案存储门禁启动与运行', () => { throw error; });
} finally {
  await run.close();
  gate.finish({errors});
}
