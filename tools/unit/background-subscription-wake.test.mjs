/**
 * @file tools/unit/background-subscription-wake.test.mjs
 * 文件职责：固化 Service Worker 被回收后订阅的重连行为——走本机常驻服务时后台空闲约 30 秒就被回收，
 *   每次唤醒都要重连；重连既不能被「上次成功」的节流挡住，也不能被当成账户变化去清缓存、撤整页译文。
 * 主要内容：用可共享的 chrome mock（storage.session 在多次「唤醒」间沿用）把 background.js 带查询串重复导入，
 *   每次唤醒前断开上一轮的端口（模拟回收）；假的 chrome.runtime.connectNative 端口给不出配对令牌（于是不连常驻服务）、status 一问就答「已连接、已登录」：
 *   ① 一分钟前刚成功连过，唤醒后第一条 STATE_GET 就重连并回答已就绪；
 *   ② 登录状态没有翻转的重连保留整页翻译授权与释义/解构缓存，也不向标签页广播 SS_REFRESH；
 *   ③ 上次失败仍按退避节流，不反复拉起连接器。
 * 模块边界：只 mock 浏览器边界，不 mock 任何被测扩展模块；「不会发生」的断言保留一小段观察窗口（OBSERVE_MS）。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const OBSERVE_MS = 200;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createWake({session}) {
  const local = new Map([
    ['wordSchemaVersion', 5], ['productSchemaVersion', 1], ['wordMaintenanceVersion', 1], ['words', []],
    ['settings', {providerKind: 'chatgpt', subscriptionModel: 'gpt-test'}], ['subscriptionLinked', true],
  ]);
  const counts = {connectNative: 0, status: 0, refresh: 0};
  const listeners = {};
  const read = (map, keys) => {
    if (keys === null || keys === undefined) return Object.fromEntries(map);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, map.get(key)]));
  };
  const area = map => ({
    get: async keys => structuredClone(read(map, keys)),
    set: async value => { for (const [key, item] of Object.entries(value || {})) map.set(key, structuredClone(item)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); },
    getBytesInUse: async () => 0,
    QUOTA_BYTES: 10 * 1024 * 1024,
  });
  const tabs = [{id: 1, url: 'https://example.com/a', active: true}];
  const runtime = {
    id: 'testextensionid1234567890abcdef',
    lastError: null,
    getURL: path => `chrome-extension://${runtime.id}/${String(path).replace(/^\/+/u, '')}`,
    onConnect: {addListener() {}},
    onMessage: {addListener(fn) { listeners.message = fn; }},
    onInstalled: {addListener() {}},
    onStartup: {addListener() {}},
    sendMessage: async () => undefined,
    openOptionsPage: async () => {},
    connectNative: () => {
      if (blocked) throw new Error('mock: 回收期间不接受连接');
      counts.connectNative++;
      const onMessage = [], onDisconnect = [];
      openPorts.push(() => { for (const fn of onDisconnect) fn(); });
      return {
        onMessage: {addListener: fn => onMessage.push(fn)},
        onDisconnect: {addListener: fn => onDisconnect.push(fn)},
        disconnect() {},
        postMessage(message) {
          queueMicrotask(() => {
            if (message.type === 'pairingToken') { for (const fn of onMessage) fn({id: message.id, ok: false, error: 'no token'}); return; }
            if (message.type === 'status') counts.status++;
            for (const fn of onMessage) fn({id: message.id, ok: true, data: message.type === 'status' ? {connected: true, authenticated: true, email: 'reader@example.com', plan: 'plus'} : {}});
          });
        },
      };
    },
    getContexts: async () => [],
  };
  const chrome = {
    runtime,
    i18n: {getUILanguage: () => 'zh-CN'},
    storage: {local: area(local), session: area(session)},
    tabs: {
      query: async () => tabs.map(tab => ({...tab})),
      get: async tabId => ({...tabs.find(tab => tab.id === tabId), id: tabId}),
      sendMessage: async (_tabId, message) => { if (message?.type === 'SS_REFRESH') counts.refresh++; return undefined; },
      create: async () => ({id: 99, windowId: 1}),
      remove: async () => {}, update: async () => {},
      onRemoved: {addListener() {}}, onUpdated: {addListener() {}}, onActivated: {addListener() {}},
    },
    scripting: {executeScript: async () => [], getRegisteredContentScripts: async () => [], registerContentScripts: async () => [], unregisterContentScripts: async () => {}},
    contextMenus: {removeAll: async () => {}, create: (_options, done) => done?.(), onClicked: {addListener() {}}},
    commands: {onCommand: {addListener() {}}},
    permissions: {contains: async () => true, remove: async () => false, onAdded: {addListener() {}}, onRemoved: {addListener() {}}},
    tts: {},
    offscreen: {hasDocument: async () => false, createDocument: async () => {}},
    webNavigation: {getFrame: async () => null, onHistoryStateUpdated: {addListener() {}}, onBeforeNavigate: {addListener() {}}, onCommitted: {addListener() {}}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    windows: {getAll: async () => [], update: async () => {}},
  };
  return {chrome, counts, listeners};
}

// subscription.js 在同一进程里只加载一次，端口状态会带到下一次「唤醒」；真实的回收会连端口一起丢掉，
// 所以每次唤醒前先把上一轮的端口断开，让订阅状态回到「未连接」。
// 上一轮导入的 background.js 实例还留在进程里，端口一断它会自己重连；断开期间让连接器拒绝连接，
// 这样下一次唤醒面对的才是真正「未连接」的订阅。
const openPorts = [];
let blocked = false;
async function dropConnections() {
  blocked = true;
  for (const drop of openPorts.splice(0)) drop();
  await sleep(80);
  blocked = false;
}
let boot = 0;
async function wake(session) {
  await dropConnections();
  const mock = createWake({session});
  globalThis.chrome = mock.chrome;
  // 带查询串重复导入 = 一次新的 Service Worker 启动。
  await import(`../../roamcat-0.0.1/extension/background.js?subscription-wake=${++boot}`);
  const sender = {id: mock.chrome.runtime.id, url: 'https://example.com/a', frameId: 0, tab: {id: 1, url: 'https://example.com/a'}};
  mock.ask = message => new Promise(resolve => mock.listeners.message(message, sender, resolve));
  return mock;
}
const armed = {token: 'tok', url: 'https://example.com/a', generation: 0, provider: 'x', cancelledThrough: 0};
const cached = () => [['supportCache', {['a'.repeat(64)]: {at: Date.now(), policy: 'x', decision: null}}], ['sentenceGroupCache', {['b'.repeat(64)]: {groups: [], at: Date.now()}}]];

test('后台被回收后订阅立即重连，登录状态没变就不清缓存、不撤整页译文', async t => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  // 这一项放最前：进程里还没有上一轮的 background.js 实例，广播计数只来自被测的这一次唤醒。
  await t.test('登录状态没有翻转的重连：保留整页翻译授权与缓存，不广播', async () => {
    const session = new Map([['automationSynced', Date.now()], ['autoConnect:chatgpt', {at: Date.now() - 11 * 60_000, failures: 0}], ['subscriptionAuth:chatgpt', true], ['emergencySession:1', armed], ...cached()]);
    const mock = await wake(session);
    const state = await mock.ask({type: 'STATE_GET'});
    assert.equal(state.data.providerConfigured, true);
    assert.equal(state.data.emergencyActive, true);
    await sleep(OBSERVE_MS); // 断言「不会发生」：留一段观察窗口。
    assert.ok(session.has('emergencySession:1'), '整页翻译授权不能因为重连被清掉');
    assert.ok(session.has('supportCache') && session.has('sentenceGroupCache'), '释义与解构缓存不能因为重连被清掉');
    assert.equal(mock.counts.refresh, 0, '页面拿到的结论没变，不需要广播');
  });

  await t.test('一分钟前刚成功连过：唤醒后第一条 STATE_GET 就重连并回答已就绪', async () => {
    const session = new Map([['automationSynced', Date.now()], ['autoConnect:chatgpt', {at: Date.now() - 60_000, failures: 0}], ['subscriptionAuth:chatgpt', true]]);
    const mock = await wake(session);
    const state = await mock.ask({type: 'STATE_GET'});
    assert.equal(state.ok, true, state.error);
    assert.equal(state.data.providerConfigured, true, '回收后的 10 分钟内也必须重连');
    assert.equal(mock.counts.status, 1, '这次唤醒自己向连接器问了一次状态');
  });

  await t.test('上次连接失败：仍按退避节流，不反复拉起连接器', async () => {
    const session = new Map([['automationSynced', Date.now()], ['autoConnect:chatgpt', {at: Date.now() - 5_000, failures: 1}]]);
    const mock = await wake(session);
    const state = await mock.ask({type: 'STATE_GET'});
    await sleep(OBSERVE_MS);
    assert.equal(state.data.providerConfigured, false);
    assert.equal(mock.counts.connectNative, 0, '退避窗口内不连连接器');
  });
});
