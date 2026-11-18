/**
 * @file extension/word-store.mjs
 * 文件职责：词档案的拆分存储——每个词一个键 `word:<id>`，另存一份有序的词 ID 清单 `wordIds`。
 *   改一个词只写这一个词，不再把整个词库（最多 5000 条、数 MB）整份写回。
 * 主要内容：readWords(storage) 按清单读出词档案（清单里有、键已不在的跳过）；
 *   diffWords(before, after) 按对象引用比出要写的词、要删的键和新清单；writeWordDiff(storage, diff, extra) 先删后写；
 *   clearWords(storage) 删掉全部词键并清空清单；migrateWordArray(storage, {repair}) 把 schema v5 的 `words` 数组
 *   分批搬进拆分键（每批一次 set：同一次写入里把这批写成独立键、从数组里拿掉，存储里始终只有一份，
 *   不会因为新旧两份并存撑爆 10MB 配额；中途崩溃下次启动从剩下的数组接着搬），搬完写 schema v6、删掉 `words`。
 * 模块边界：领域层纯模块，不触碰 chrome；storage 由调用方注入（chrome.storage.local 或测试替身，
 *   只用 get/set/remove）。词对象一律整体替换，不能原地修改——diffWords 只按引用判断哪些词变了。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export const WORD_SCHEMA_VERSION = 6;
export const WORD_INDEX_KEY = 'wordIds';
export const LEGACY_WORDS_KEY = 'words';
const WORD_KEY_PREFIX = 'word:';
const MIGRATION_BATCH = 500;

export const wordKey = id => WORD_KEY_PREFIX + id;

function validWord(word) {
  return Boolean(word) && typeof word === 'object' && typeof word.id === 'string' && word.id.length > 0;
}

/** 按清单顺序读出全部词档案；清单缺失视为空库，清单里有而键已不在（删到一半崩溃）的跳过。 */
export async function readWords(storage) {
  const ids = (await storage.get(WORD_INDEX_KEY))[WORD_INDEX_KEY];
  if (!Array.isArray(ids) || !ids.length) return [];
  const keys = ids.map(wordKey);
  const data = await storage.get(keys);
  const words = [];
  for (const key of keys) if (validWord(data[key])) words.push(data[key]);
  return words;
}

/**
 * 比较一次写入事务前后的词数组：引用变了（或新增）的词要写，消失的词要删；
 * 成员或顺序变了才重写清单。同一 ID 出现多次时只保留第一次出现的那条。
 */
export function diffWords(before, after) {
  const prior = new Map();
  for (const word of before || []) if (validWord(word) && !prior.has(word.id)) prior.set(word.id, word);
  const set = {}, seen = new Set(), index = [];
  for (const word of after || []) {
    if (!validWord(word) || seen.has(word.id)) continue;
    seen.add(word.id);
    index.push(word.id);
    if (prior.get(word.id) !== word) set[wordKey(word.id)] = word;
  }
  const remove = [...prior.keys()].filter(id => !seen.has(id)).map(wordKey);
  const priorIds = [...prior.keys()];
  const reordered = priorIds.length !== index.length || priorIds.some((id, i) => id !== index[i]);
  return {set, remove, index: reordered ? index : null};
}

export function hasWordChanges(diff) {
  return Boolean(diff) && (diff.remove.length > 0 || diff.index !== null || Object.keys(diff.set).length > 0);
}

/**
 * 先删后写：删到一半崩溃时，清单里还留着的 ID 读取时会被跳过；写入（含清单与 extra 里的其他键）是一次 set。
 */
export async function writeWordDiff(storage, diff, extra = {}) {
  if (diff?.remove.length) await storage.remove(diff.remove);
  const patch = {...extra, ...(diff?.set || {})};
  if (diff?.index) patch[WORD_INDEX_KEY] = diff.index;
  if (Object.keys(patch).length) await storage.set(patch);
}

/** 删掉全部词键并清空清单；先删键再清清单，中途失败时清单里剩下的 ID 读取时会被跳过，重试可以接着删。 */
export async function clearWords(storage) {
  const ids = (await storage.get(WORD_INDEX_KEY))[WORD_INDEX_KEY];
  if (Array.isArray(ids) && ids.length) await storage.remove(ids.map(wordKey));
  await storage.set({[WORD_INDEX_KEY]: []});
}

/**
 * 把 schema v5 的 `words` 数组搬进拆分键。可重入：已经搬进清单的不重复搬，剩下的数组接着分批搬。
 * repair(word) 在搬入时规范化单条记录（返回新对象或 null 丢弃）；extra 是搬完时与 schema 版本一起写入的键。
 */
export async function migrateWordArray(storage, {repair = word => word, extra = {}, batch = MIGRATION_BATCH} = {}) {
  const data = await storage.get([LEGACY_WORDS_KEY, WORD_INDEX_KEY]);
  let remaining = Array.isArray(data[LEGACY_WORDS_KEY]) ? data[LEGACY_WORDS_KEY] : [];
  const index = Array.isArray(data[WORD_INDEX_KEY]) ? [...data[WORD_INDEX_KEY]] : [];
  const known = new Set(index);
  while (remaining.length) {
    const chunk = remaining.slice(0, batch);
    remaining = remaining.slice(batch);
    const patch = {};
    for (const raw of chunk) {
      const word = validWord(raw) ? repair(raw) : null;
      if (!validWord(word) || known.has(word.id)) continue;
      known.add(word.id);
      index.push(word.id);
      patch[wordKey(word.id)] = word;
    }
    // 同一次 set：这批写成独立键、清单加上这批、数组去掉这批。
    await storage.set({...patch, [WORD_INDEX_KEY]: [...index], [LEGACY_WORDS_KEY]: remaining});
  }
  await storage.set({...extra, [WORD_INDEX_KEY]: [...index], wordSchemaVersion: WORD_SCHEMA_VERSION});
  await storage.remove(LEGACY_WORDS_KEY);
  return index.length;
}
