/**
 * @file extension/data-backup.mjs
 * 文件职责：本机备份的格式与导入计划——导出时只挑出可以带走的设置（白名单，不含模型服务与任何密钥），
 *   导入时校验备份文件、规范化词档案，并按「合并」或「覆盖」算出要写入的词、术语、网站规则与阅读偏好。
 * 主要内容：BACKUP_FORMAT / BACKUP_FORMAT_VERSION、BACKUP_SETTING_KEYS（随备份带走的设置）与
 *   BACKUP_EXCLUDED_SETTING_KEYS（模型服务一层，含密钥，永不进备份）、backupSettings(settings)、
 *   parseBackup(text)（也认 0.10 及更早版本导出的词档案文件）、planWordImport(local, incoming, mode)、
 *   planSettingsImport(current, raw, mode)。合并：本机已有的保留，只补备份里多出来的（同一个词取最近活动更晚的一份）；
 *   覆盖：词档案、术语表、网站规则、自动开启网站与阅读偏好换成备份里的，备份里没有的设置项保持本机原样。
 * 模块边界：领域层纯模块，不触碰 chrome；设置校验复用 message-protocol.js / domain-routing.js / activation.js 的同一套规则，
 *   词档案：schema 1–4 的备份走 reading.js 与本机升级同一套迁移，v5/v6 只按当前字段集合核对类型、不截断内容。
 *   写入、配额、权限与广播由 background.js 编排。
 *   超出上限等「这份备份按这种方式导入不了」的错误带 importLimit 标记，预览时按方式分别提示。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {DEFAULT_SETTINGS, normalizeSettings, wordId} from './shared.js';
import {validatePatch, MAX_BACKUP_TEXT} from './message-protocol.js';
import {normalizeDomainRules} from './domain-routing.js';
import {validateAutomation, validateVideo} from './activation.js';
import {migrateSupportWord, normalizeKnownAt, normalizeSenseLabel} from './reading.js';
import {WORD_SCHEMA_VERSION} from './word-store.mjs';

const M=(zh,en)=>globalThis.RoamCatI18n?.lang?.()==='en'?en:zh;

export const BACKUP_FORMAT = 'roamcat-backup';
export const BACKUP_FORMAT_VERSION = 1;
/** 词档案上限，与 background.js saveRecord 的 5000 条一致。 */
export const MAX_IMPORT_WORDS = 5000;
const MAX_RECORDS_SCANNED = 20000;
export const IMPORT_MODES = Object.freeze(['merge', 'replace']);

/** 随备份带走、导入时可以恢复的设置项。 */
export const BACKUP_SETTING_KEYS = Object.freeze([
  'assistanceMode', 'rememberSupport', 'helpLanguage', 'lookupKey', 'lookupDisplay', 'pageTranslationDisplay',
  'readingStyle', 'domain', 'domainRules', 'customTerms', 'automation', 'video',
  'complexSentenceAssist', 'formulaAssist', 'pdfReader', 'floatingPet',
]);
/** 模型服务一层：带着密钥或指向带密钥的服务，换一台设备也要重新连接，所以永不进备份。 */
export const BACKUP_EXCLUDED_SETTING_KEYS = Object.freeze([
  'providerKind', 'subscriptionModel', 'apiServices', 'activeApiServiceId', 'apiRouting',
  'mtServices', 'translationEngines', 'mtFallback', 'domainDetection',
]);
// 覆盖时逐项恢复的阅读偏好（列表类与自动开启、视频设置另行处理）。
const PREFERENCE_KEYS = Object.freeze([
  'assistanceMode', 'rememberSupport', 'helpLanguage', 'lookupKey', 'lookupDisplay', 'pageTranslationDisplay',
  'readingStyle', 'domain', 'complexSentenceAssist', 'formulaAssist', 'pdfReader', 'floatingPet',
]);
const AUTOMATION_FLAGS = Object.freeze(['allSites', 'sentenceGroupsAllSites', 'videoSites']);
const VIDEO_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS.video));
const SENTENCE_DENSITIES = Object.freeze(['coarse', 'medium', 'fine']);
const SENTENCE_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'wavy']);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0; };
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function invalidBackup() {
  return new Error(M('这不是 RoamCat 导出的备份文件。', 'This is not a backup file exported from RoamCat.'));
}
function futureBackup() {
  return new Error(M('这份备份来自更新版本的 RoamCat，请先更新扩展再导入。', 'This backup comes from a newer version of RoamCat; update the extension before importing it.'));
}
/** 「按这种方式导入不了」：预览时只让这一种方式不可选，另一种方式照常可用。 */
function limitError(message) {
  return Object.assign(new Error(message), {importLimit: true});
}

/** 导出用：只留白名单里的设置，深拷贝，不含模型服务与任何密钥。 */
export function backupSettings(settings) {
  const normalized = normalizeSettings(settings);
  return structuredClone(Object.fromEntries(BACKUP_SETTING_KEYS.map(key => [key, normalized[key]])));
}

function idDomain(id) {
  const split = typeof id === 'string' ? id.indexOf(':') : -1;
  return split > 0 ? id.slice(0, split) : '';
}

const timestamp = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
// 释义上限与写入时的校验一致（gloss.mjs）：短注最长 240（段落短注），译法最长 1200（查词卡的中文说明）。
const definitionText = (value, max) => (typeof value === 'string' && value.length <= max ? value : '');

/** v5/v6 的一个义项：只核对类型、补缺省值，不截断已有内容；没有编号或义项名的丢掉。 */
function currentSense(sense) {
  if (!isObject(sense) || !boundedText(sense.key, 300)) return null;
  const label = normalizeSenseLabel(sense.label);
  if (!label) return null;
  const definition = isObject(sense.definition) ? sense.definition : {};
  return {
    key: sense.key,
    label,
    opportunityDays: count(sense.opportunityDays),
    lastOpportunityAt: timestamp(sense.lastOpportunityAt),
    lastHelpAt: timestamp(sense.lastHelpAt),
    quietUntil: timestamp(sense.quietUntil),
    quietCycles: Math.min(2, count(sense.quietCycles)),
    quietOpportunityDays: count(sense.quietOpportunityDays),
    hintPreference: sense.hintPreference === 'less' ? 'less' : null,
    assistedPageKey: typeof sense.assistedPageKey === 'string' && sense.assistedPageKey.length <= 512 ? sense.assistedPageKey : '',
    definition: {hint: definitionText(definition.hint, 240), translation: definitionText(definition.translation, 1200)},
  };
}

/** v5/v6 的一条词档案：字段集合与后台读写的一致，类型不对的数值归零；义项至多 8 个、编号不重复。 */
function currentWord(record) {
  if (!isObject(record) || record.kind === 'sentence') return null;
  const senses = [], keys = new Set();
  for (const source of Array.isArray(record.senses) ? record.senses : []) {
    const sense = currentSense(source);
    if (!sense || keys.has(sense.key)) continue;
    keys.add(sense.key);
    senses.push(sense);
    if (senses.length === 8) break;
  }
  return {
    id: record.id,
    term: record.term,
    domain: record.domain,
    kind: record.kind === 'phrase' ? 'phrase' : 'word',
    revision: count(record.revision),
    helpCount: count(record.helpCount),
    requestedAt: timestamp(record.requestedAt),
    knownAt: normalizeKnownAt(record.knownAt),
    lastSeen: timestamp(record.lastSeen),
    hintPreference: record.hintPreference === 'less' ? 'less' : null,
    senses,
  };
}

/**
 * 一条导入的词档案。schema 1–4 走与本机升级同一套迁移（reading.js），v5/v6 按当前字段集合核对、不改动内容；
 * 再核对身份字段（缺领域时按编号前缀补上）。认不出的返回 null。
 */
function importedWord(record, schemaVersion) {
  let word;
  try { word = schemaVersion >= 5 ? currentWord(record) : migrateSupportWord(record, schemaVersion); } catch { return null; }
  if (!word) return null;
  const domain = typeof word.domain === 'string' && word.domain ? word.domain : idDomain(word.id) || 'general';
  if (!boundedText(word.id, 300) || !boundedText(word.term, 300) || !boundedText(domain, 40)) return null;
  return {...word, domain};
}

function exportedAt(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  return Number.isFinite(Date.parse(value)) ? value : '';
}

function usageRows(value) {
  if (!Array.isArray(value)) return null;
  const rows = new Map();
  for (const row of value) {
    if (!isObject(row) || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.day) || rows.has(row.day)) continue;
    const pageKeys = Array.isArray(row.pageKeys) ? [...new Set(row.pageKeys.filter(key => typeof key === 'string' && key.length > 0 && key.length <= 128))].slice(0, 50) : [];
    rows.set(row.day, {day: row.day, eligiblePages: count(row.eligiblePages), helpRequests: count(row.helpRequests), hintsShown: count(row.hintsShown), errors: count(row.errors), pageKeys});
  }
  return [...rows.values()].sort((left, right) => left.day.localeCompare(right.day)).slice(-28);
}

function sentenceGroupPreferences(value) {
  if (!isObject(value)) return null;
  const result = {};
  if (SENTENCE_DENSITIES.includes(value.density)) result.density = value.density;
  if (SENTENCE_LINE_STYLES.includes(value.lineStyle)) result.lineStyle = value.lineStyle;
  return Object.keys(result).length ? result : null;
}

/**
 * 解析并校验备份文件正文。新格式带 format/formatVersion；没有 format 的是 0.10 及更早版本「导出词档案」的文件，
 * 只含词档案。词档案版本或格式版本比本扩展新时拒绝（不猜着导入）；单条认不出的词跳过并计数。
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(M('备份文件是空的。', 'The backup file is empty.'));
  if (text.length > MAX_BACKUP_TEXT) throw invalidBackup();
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error(M('文件不是有效的 JSON，请选择 RoamCat 导出的备份文件。', 'This file is not valid JSON; choose a backup exported from RoamCat.')); }
  if (!isObject(raw)) throw invalidBackup();
  // 同一页「导出完整记录」下载的阅读记录文件：{config, events, …}，没有词档案。
  if (!Object.hasOwn(raw, 'records') && isObject(raw.config) && Array.isArray(raw.events)) {
    throw new Error(M('这是「导出完整记录」导出的阅读记录文件，目前不能导入；请选择「导出备份」导出的文件。', 'This is a reading-history file from “Export full records”, which cannot be imported yet; choose a file from “Export backup”.'));
  }
  const tagged = Object.hasOwn(raw, 'format');
  if (tagged && (raw.format !== BACKUP_FORMAT || !Number.isInteger(raw.formatVersion) || raw.formatVersion < 1)) throw invalidBackup();
  const formatVersion = tagged ? raw.formatVersion : 0;
  if (formatVersion > BACKUP_FORMAT_VERSION) throw futureBackup();
  if (!Array.isArray(raw.records) || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) throw invalidBackup();
  if (raw.schemaVersion > WORD_SCHEMA_VERSION) throw futureBackup();
  if (raw.productSchemaVersion !== undefined && raw.productSchemaVersion !== 1) {
    if (Number.isInteger(raw.productSchemaVersion) && raw.productSchemaVersion > 1) throw futureBackup();
    throw invalidBackup();
  }
  if (raw.records.length > MAX_RECORDS_SCANNED) throw invalidBackup();
  const words = [], seen = new Set();
  let skippedWords = 0;
  for (const record of raw.records) {
    const word = importedWord(record, raw.schemaVersion);
    if (!word || seen.has(word.id)) { skippedWords++; continue; }
    seen.add(word.id);
    words.push(word);
  }
  const shownAt = Number(raw.onDemandSuggestionShownAt);
  return {
    meta: {
      formatVersion,
      schemaVersion: raw.schemaVersion,
      exportedAt: tagged ? exportedAt(raw.exportedAt) : '',
      extensionVersion: tagged && typeof raw.extensionVersion === 'string' && /^\d+\.\d+\.\d+$/u.test(raw.extensionVersion) ? raw.extensionVersion : '',
      hasSettings: tagged && isObject(raw.settings),
    },
    words,
    skippedWords,
    settings: tagged && isObject(raw.settings) ? raw.settings : null,
    sentenceGroups: tagged ? sentenceGroupPreferences(raw.sentenceGroups) : null,
    supportUsage: usageRows(raw.supportUsage),
    onDemandSuggestionShownAt: Number.isFinite(shownAt) && shownAt >= 0 ? shownAt : null,
  };
}

/** 最近一次活动：求助、已认识、上次出现，以及各义项的求助与提示机会时间里最晚的一个。 */
function activity(word) {
  let latest = Math.max(count(word?.lastSeen), count(word?.requestedAt), count(word?.knownAt));
  for (const sense of Array.isArray(word?.senses) ? word.senses : []) latest = Math.max(latest, count(sense?.lastHelpAt), count(sense?.lastOpportunityAt));
  return latest;
}

/** 比较内容是否相同：两边都按导入规则规范化，忽略 revision（只是写入计数）。 */
function sameWord(local, incoming) {
  const normalized = importedWord(local, WORD_SCHEMA_VERSION);
  if (!normalized) return false;
  const strip = ({revision: _revision, ...rest}) => JSON.stringify(rest);
  return strip(normalized) === strip(incoming);
}

/**
 * 词档案导入计划。合并：本机顺序不变，备份里多出来的词追加在后面；同一个词两边都有时取最近活动更晚的一份
 * （一样新保留本机的）。覆盖：结果就是备份里的词，备份里没有的本机词会被删掉。内容没变的词沿用本机对象，
 * 不会被重写；换掉的词 revision 取两边较大值加一，让网页上拿着旧版本的操作按「已更新」重来。
 */
export function planWordImport(localWords, incomingWords, mode) {
  if (!IMPORT_MODES.includes(mode)) throw new Error(M('不支持的导入方式。', 'Unsupported import mode.'));
  const local = (Array.isArray(localWords) ? localWords : []).filter(word => typeof word?.id === 'string' && word.id);
  const incoming = Array.isArray(incomingWords) ? incomingWords : [];
  const localById = new Map(local.map(word => [word.id, word]));
  const stats = {incoming: incoming.length, added: 0, updated: 0, unchanged: 0, keptLocal: 0, removed: 0, local: localById.size};
  const replaced = (current, word) => ({...word, revision: Math.max(count(current.revision), count(word.revision)) + 1});
  let words;
  if (mode === 'replace') {
    const incomingIds = new Set(incoming.map(word => word.id));
    words = incoming.map(word => {
      const current = localById.get(word.id);
      if (!current) { stats.added++; return word; }
      if (sameWord(current, word)) { stats.unchanged++; return current; }
      stats.updated++;
      return replaced(current, word);
    });
    stats.removed = [...localById.keys()].filter(id => !incomingIds.has(id)).length;
  } else {
    words = local.slice();
    const position = new Map(words.map((word, index) => [word.id, index]));
    for (const word of incoming) {
      const current = localById.get(word.id);
      if (!current) { position.set(word.id, words.length); words.push(word); stats.added++; continue; }
      if (sameWord(current, word)) { stats.unchanged++; continue; }
      if (activity(word) > activity(current)) { words[position.get(word.id)] = replaced(current, word); stats.updated++; }
      else stats.keptLocal++;
    }
  }
  if (words.length > MAX_IMPORT_WORDS) {
    throw limitError(M(`导入后词档案会有 ${words.length} 个词，超过 ${MAX_IMPORT_WORDS} 个的上限。`, `The word profile would hold ${words.length} words after importing, over the ${MAX_IMPORT_WORDS}-word limit.`));
  }
  return {words, stats: {...stats, total: words.length}};
}

/**
 * 一组列表设置的导入：逐条按保存时的同一套规则校验，认不出的跳过并计数；合并时本机条目在前、只补新条目，
 * 覆盖时结果就是备份里的条目。key 决定「同一条」。
 */
function importList(localItems, rawItems, mode, {normalizeOne, key}) {
  const incoming = [], seen = new Set();
  let skipped = 0;
  for (const item of rawItems) {
    let value;
    try { value = normalizeOne(item); } catch { skipped++; continue; }
    const id = key(value);
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    incoming.push(value);
  }
  const localKeys = new Set(localItems.map(key));
  const added = incoming.filter(item => !localKeys.has(key(item)));
  const items = mode === 'replace' ? incoming : [...localItems, ...added];
  const removed = mode === 'replace' ? localItems.filter(item => !seen.has(key(item))).length : 0;
  return {items, stats: {incoming: incoming.length, added: added.length, removed, skipped, total: items.length}};
}

/** 整组再按保存规则校验一遍（条数上限、重复）；不通过就是这种方式导入不了。 */
function strictList(validate) {
  try { return validate(); } catch (error) { throw limitError(error?.message || M('导入后的设置超出上限。', 'The imported settings exceed a limit.')); }
}

const changed = (left, right) => JSON.stringify(left) !== JSON.stringify(right);

/**
 * 设置导入计划。合并：只补术语表、网站规则与自动开启网站里本机没有的条目，其余设置不动；
 * 覆盖：这三组换成备份里的，阅读偏好、自动开启开关与视频字幕设置也换成备份里的。
 * 备份里没有的设置项（比如旧版本导出的备份缺某一项）保持本机原样；单项认不出就跳过，记进 skipped。
 * 返回 {patch（可直接交给 validatePatch 的键）, automation, video, stats}；automation / video 为 null 表示不改。
 */
export function planSettingsImport(currentSettings, rawSettings, mode) {
  if (!IMPORT_MODES.includes(mode)) throw new Error(M('不支持的导入方式。', 'Unsupported import mode.'));
  const current = normalizeSettings(currentSettings);
  const source = isObject(rawSettings) ? rawSettings : {};
  const present = new Set(BACKUP_SETTING_KEYS.filter(key => Object.hasOwn(source, key)));
  const incoming = normalizeSettings(Object.fromEntries([...present].map(key => [key, source[key]])));
  const patch = {}, skipped = [];
  const stats = {terms: null, rules: null, sites: null, preferences: null};

  if (present.has('customTerms') && Array.isArray(source.customTerms)) {
    const plan = importList(current.customTerms, source.customTerms, mode, {
      normalizeOne: entry => validatePatch({customTerms: [entry]}, current).customTerms[0],
      key: row => wordId(row.term, row.domain),
    });
    const terms = strictList(() => validatePatch({customTerms: plan.items}, current).customTerms);
    if (changed(terms, current.customTerms)) patch.customTerms = terms;
    stats.terms = plan.stats;
  }
  if (present.has('domainRules') && Array.isArray(source.domainRules)) {
    const ruleKey = rule => JSON.stringify([rule.host, rule.pathPrefix, rule.includeSubdomains]);
    const plan = importList(current.domainRules, source.domainRules, mode, {normalizeOne: rule => normalizeDomainRules([rule])[0], key: ruleKey});
    const rules = strictList(() => normalizeDomainRules(plan.items));
    if (changed(rules, current.domainRules)) patch.domainRules = rules;
    stats.rules = plan.stats;
  }

  let automation = null;
  if (present.has('automation') && isObject(source.automation)) {
    const raw = source.automation;
    let next = current.automation;
    if (Array.isArray(raw.sites)) {
      const plan = importList(current.automation.sites, raw.sites, mode, {
        normalizeOne: site => validateAutomation({sites: [site]}, current.automation).sites[0],
        key: site => site.origin,
      });
      next = strictList(() => validateAutomation({sites: plan.items}, next));
      stats.sites = plan.stats;
    }
    if (mode === 'replace') {
      for (const flag of AUTOMATION_FLAGS) {
        if (!Object.hasOwn(raw, flag)) continue;
        try { next = validateAutomation({[flag]: raw[flag]}, next); } catch { skipped.push(`automation.${flag}`); }
      }
    }
    automation = changed(next, current.automation) ? next : null;
  }

  let video = null, preferenceChanges = 0;
  if (mode === 'replace') {
    for (const key of PREFERENCE_KEYS) {
      if (!present.has(key)) continue;
      try {
        const value = validatePatch({[key]: incoming[key]}, current);
        if (changed(value[key], current[key])) { Object.assign(patch, value); preferenceChanges++; }
      } catch { skipped.push(key); }
    }
    if (present.has('video') && isObject(source.video)) {
      let next = current.video;
      for (const key of VIDEO_KEYS) {
        if (!Object.hasOwn(source.video, key)) continue;
        try { next = validateVideo({[key]: source.video[key]}, next); } catch { skipped.push(`video.${key}`); }
      }
      if (changed(next, current.video)) { video = next; preferenceChanges += VIDEO_KEYS.filter(key => changed(next[key], current.video[key])).length; }
    }
    if (automation) preferenceChanges += AUTOMATION_FLAGS.filter(flag => automation[flag] !== current.automation[flag]).length;
    stats.preferences = {changed: preferenceChanges, skipped};
  }
  return {patch, automation, video, stats};
}

/** 预览与结果里用的计数：词档案按备份核对，设置按白名单逐组统计。 */
export function backupContents(backup) {
  const settings = isObject(backup?.settings) ? backup.settings : {};
  const length = value => (Array.isArray(value) ? value.length : 0);
  return {
    words: Array.isArray(backup?.words) ? backup.words.length : 0,
    skippedWords: count(backup?.skippedWords),
    terms: length(settings.customTerms),
    rules: length(settings.domainRules),
    sites: length(settings.automation?.sites),
    hasSettings: Boolean(backup?.meta?.hasSettings),
  };
}
