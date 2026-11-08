/**
 * @file src/pages/welcome/welcome-app.js
 * 文件职责：首次安装引导 Lit 应用——功能导览、三形态交互沙盒、快捷触发键选择、
 *   模型服务连接检测、偏好初始化保存。
 * 主要内容：逻辑移植自 extension/ui/welcome.js（STATE_PATCH 优先、storage.local
 *   兜底、closeWelcomeGuide、speechSynthesis 试读保持不变）；light DOM 渲染保留
 *   既有 id 级测试钩子；滚动入场动画由 welcome.css 的 view() 时间线提供；沙盒解构
 *   下划线经 RoamCatDesign.structureColor 按页面明暗取色，与真实网页一致；服务一步
 *   经 STATE_GET / SUBSCRIPTION_STATUS 只读检测，接入一律跳设置页，不在这里填密钥。
 * 模块边界：扩展页受信上下文；偏好写入仅经 request()/chrome.storage.local。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {LitElement, html, svg} from 'lit';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';
import {request, closeWelcomeGuide} from '@ext/shared.js';
import {CATALOG_TEMPLATES} from '@ext/ui/options-service-catalog.js';
import {heroArt} from '../../components/hero-art.js';
import {icon} from '../../components/icons.js';
import {t, onUiLangChange} from '../../i18n-runtime.js';

const SANDBOX_WORDS = {
  compare: {word: 'compare', pos: 'v.', def: () => t('wel.v.compare.def'), context: () => t('wel.v.compare.context'), rubyHint: () => t('wel.v.compare.hint')},
  conclusion: {word: 'conclusion', pos: 'n.', def: () => t('wel.v.conclusion.def'), context: () => t('wel.v.conclusion.context'), rubyHint: () => t('wel.v.conclusion.hint')},
  latency: {word: 'latency', pos: t('wel.v.latency.pos'), def: () => t('wel.v.latency.def'), context: () => t('wel.v.latency.context'), rubyHint: () => t('wel.v.latency.hint')},
  congestion: {word: 'congestion', pos: 'n.', def: () => t('wel.v.congestion.def'), context: () => t('wel.v.congestion.context'), rubyHint: () => t('wel.v.congestion.hint')},
};

const SAVED_BUTTON_TEXT = () => t('wel.savedBtn');

const THEMES = ['auto', 'dark', 'light'];
const THEME_LABELS = {auto: 'opt.themeAuto', dark: 'opt.themeDark', light: 'opt.themeLight'};
const THEME_ICONS = {
  auto: svg`<rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>`,
  dark: svg`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`,
  light: svg`<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`,
};

// 沙盒演示用到的解构成分；颜色与线宽跟真实网页一致（content.js：谓语 2px、定语/状语 1.25px、其余 1.5px）。
const STRUCTURE_ROLES = ['subject', 'predicate', 'object', 'attributive', 'adverbial'];

const SUBSCRIPTION_KINDS = ['chatgpt', 'grok', 'antigravity'];
// 订阅三家的名称与图标取服务目录，和设置页、弹窗同名；说明是引导页自己的一句话门槛。
const SERVICE_ROUTES = [
  {id: 'chatgpt', desc: 'wel.svcChatgptD'},
  {id: 'grok', desc: 'wel.svcGrokD'},
  {id: 'antigravity', desc: 'wel.svcGoogleD'},
];
const providerIconUrl = name => chrome.runtime.getURL(`icons/providers/${/^[a-z0-9-]+$/u.test(name || '') ? name : 'custom-api'}.svg`);

/** 当前选中的模型服务：名称、模型与图标，取法与弹窗的服务切换一致；不读任何密钥字段。 */
function currentService(settings) {
  if (!settings) return null;
  if (settings.providerKind === 'api') {
    const service = settings.apiServices?.find(value => value.id === settings.activeApiServiceId);
    if (!service) return null;
    const template = CATALOG_TEMPLATES.find(value => value.id === service.providerId);
    return {name: service.name, model: service.model || '', icon: template?.icon || 'custom-api'};
  }
  const template = CATALOG_TEMPLATES.find(value => value.id === settings.providerKind);
  return template ? {name: template.name, model: settings.subscriptionModel || '', icon: template.icon} : null;
}

class RoamcatWelcome extends LitElement {
  createRenderRoot() { return this; }

  #key = 'D';
  #assistanceMode = 'ambient';
  #lookupDisplay = 'card';
  #sandboxMode = 'card';
  #selectedWord = 'latency';
  #known = false;
  #sentenceTransOpen = false;
  #theme = 'auto';
  #saving = false;
  #saveButtonText = '';
  #toastVisible = false;
  #toastMessage = '';
  #keyPulse = false;
  #pulseTimer = 0;
  #offLang = null;
  // 服务检测：checking → ready / missing；settings 留着渲染时再取服务名，切换界面语言后名称跟着变。
  #serviceState = 'checking';
  #serviceSettings = null;
  #serviceSeq = 0;
  #darkQuery = matchMedia('(prefers-color-scheme: dark)');

  #onSchemeChange = () => { if (this.#theme === 'auto') this.requestUpdate(); };
  // 用户多半在设置页签里接好服务再切回来：回到本页、设置变化或订阅状态变化时重新检测。
  #onVisible = () => { if (document.visibilityState === 'visible') void this.#checkService({probe: true}); };
  #onStorageChanged = (changes, area) => { if (area === 'local' && changes.settings) void this.#checkService({probe: true}); };
  // 订阅状态变化由后台广播；这里只重读快照不再探测，避免探测→广播→再探测打转。
  #onRuntimeMessage = message => { if (message?.type === 'SUBSCRIPTION_UPDATED') void this.#checkService({probe: false}); };

  #onKeydown = event => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key?.toUpperCase();
    if (key && /^[A-Z]$/u.test(key)) this.#setLookupKey(key);
  };

  connectedCallback() {
    super.connectedCallback();
    this.#theme = localStorage.getItem('roamcat_ui_theme') || 'auto';
    this.#applyTheme(this.#theme);
    document.title = t('rd.welcomeTitle');
    // 在别的扩展页切换语言：按新语言重渲染，不重载，保留尚未保存的偏好选择。
    this.#offLang = onUiLangChange(() => { document.title = t('rd.welcomeTitle'); this.requestUpdate(); });
    window.addEventListener('keydown', this.#onKeydown);
    this.#darkQuery.addEventListener('change', this.#onSchemeChange);
    document.addEventListener('visibilitychange', this.#onVisible);
    chrome.storage?.onChanged?.addListener(this.#onStorageChanged);
    chrome.runtime?.onMessage?.addListener(this.#onRuntimeMessage);
    void this.#loadInitialSettings();
    void this.#checkService({probe: true});
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.#onKeydown);
    this.#darkQuery.removeEventListener('change', this.#onSchemeChange);
    document.removeEventListener('visibilitychange', this.#onVisible);
    chrome.storage?.onChanged?.removeListener(this.#onStorageChanged);
    chrome.runtime?.onMessage?.removeListener(this.#onRuntimeMessage);
    this.#offLang?.();
    clearTimeout(this.#pulseTimer);
    super.disconnectedCallback();
  }

  #applyTheme(theme) {
    this.#theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('roamcat_ui_theme', theme);
    this.requestUpdate();
  }

  #cycleTheme() {
    const next = THEMES[(THEMES.indexOf(this.#theme) + 1) % THEMES.length];
    this.#applyTheme(next);
  }

  #langName() {
    const pref = globalThis.RoamCatI18n?.pref?.() || 'auto';
    return t(`common.lang${pref === 'auto' ? 'Auto' : pref === 'zh' ? 'Zh' : 'En'}`);
  }

  #cycleUiLang() {
    const i18n = globalThis.RoamCatI18n;
    if (!i18n) return;
    const order = ['auto', 'zh', 'en'];
    i18n.setPref(order[(order.indexOf(i18n.pref()) + 1) % order.length]);
    document.title = t('rd.welcomeTitle');
    this.requestUpdate();
  }

  #selectWord(word) {
    if (!SANDBOX_WORDS[word]) return;
    this.#selectedWord = word;
    this.#known = false;
    this.#sentenceTransOpen = false;
    this.requestUpdate();
  }

  #setSandboxMode(mode) {
    this.#sandboxMode = mode;
    if (mode === 'card') this.#selectedWord = 'latency';
    this.#known = false;
    this.#sentenceTransOpen = false;
    this.requestUpdate();
  }

  #speakWord() {
    const word = SANDBOX_WORDS[this.#selectedWord]?.word || 'latency';
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  }

  #setLookupKey(key) {
    if (!key || typeof key !== 'string') return;
    this.#key = key.toUpperCase().slice(0, 1);
    this.#keyPulse = true;
    clearTimeout(this.#pulseTimer);
    this.#pulseTimer = setTimeout(() => { this.#keyPulse = false; this.requestUpdate(); }, 140);
    this.requestUpdate();
  }

  async #loadInitialSettings() {
    try {
      if (!window.chrome?.storage?.local) return;
      const res = await chrome.storage.local.get(['settings']);
      const s = res?.settings;
      if (!s) return;
      if (s.lookupKey) this.#key = String(s.lookupKey).toUpperCase().slice(0, 1);
      if (s.assistanceMode) this.#assistanceMode = s.assistanceMode;
      if (s.lookupDisplay) this.#lookupDisplay = s.lookupDisplay;
      this.requestUpdate();
    } catch {
      // 读取失败时静默采用默认初始配置。
    }
  }

  async #savePreferences() {
    this.#saving = true;
    this.#saveButtonText = t('wel.saving');
    this.requestUpdate();
    const patch = {lookupKey: this.#key, assistanceMode: this.#assistanceMode, lookupDisplay: this.#lookupDisplay};
    try {
      try {
        await request('STATE_PATCH', {patch});
      } catch {
        if (window.chrome?.storage?.local) {
          const res = await chrome.storage.local.get(['settings']);
          const settings = {...(res?.settings || {}), ...patch};
          await chrome.storage.local.set({settings});
        }
      }
      this.#toastMessage = t('wel.toast',{key:this.#key,mode:this.#assistanceMode==='ambient'?t('wel.modeAmbient'):t('wel.modeQuiet')});
      this.#toastVisible = true;
      this.#saveButtonText = SAVED_BUTTON_TEXT();
      // 保存成功后稍停让用户看到「已保存」，再关闭引导：底部只有「保存并关闭」与「跳过」两个出口，不再需要第三个按钮。
      setTimeout(() => { this.#saving = false; this.requestUpdate(); this.#closeWelcome(); }, 1200);
    } catch (error) {
      console.error('保存失败:', error);
      this.#saveButtonText = t('wel.saveFail');
      this.#saving = false;
    }
    this.requestUpdate();
  }

  #closeWelcome() {
    void closeWelcomeGuide().catch(error => console.error('关闭新手引导失败', error));
  }

  /** 页面实际明暗：跟随系统时看系统配色。 */
  #pageTheme() {
    if (this.#theme === 'dark' || this.#theme === 'light') return this.#theme;
    return this.#darkQuery.matches ? 'dark' : 'light';
  }

  /** 解构成分颜色变量：和真实网页同一个取色函数，按沙盒正文所在底色的明暗取。 */
  #structureVars() {
    const color = globalThis.RoamCatDesign?.structureColor;
    if (!color) return {};
    const theme = this.#pageTheme();
    return Object.fromEntries(STRUCTURE_ROLES.map(role => [`--sb-${role}`, color(role, theme)]));
  }

  /**
   * 检测当前模型服务是否可用。STATE_GET 的 providerConfigured 对订阅只是内存快照（后台刚醒时
   * 还没连），所以订阅未就绪时再用 SUBSCRIPTION_STATUS 探测一次；失败一律按未就绪处理、不报错。
   */
  async #checkService({probe}) {
    const seq = ++this.#serviceSeq;
    let ready = false;
    let settings = null;
    try {
      const state = await request('STATE_GET');
      settings = state?.settings || null;
      ready = Boolean(state?.providerConfigured);
      if (!ready && probe && SUBSCRIPTION_KINDS.includes(settings?.providerKind)) {
        const status = await request('SUBSCRIPTION_STATUS', {kind: settings.providerKind, probe: true});
        ready = Boolean(status?.authenticated);
      }
    } catch {
      ready = false;
    }
    if (seq !== this.#serviceSeq) return;
    this.#serviceState = ready && currentService(settings) ? 'ready' : 'missing';
    this.#serviceSettings = settings;
    this.requestUpdate();
  }

  #openServiceOptions() {
    // 后台整理设置页签失败时退回浏览器自己的打开方式，至少保证设置页能出来。
    request('OPEN_OPTIONS', {section: 'service'}).catch(() => chrome.runtime.openOptionsPage());
  }

  #renderServiceStep() {
    const state = this.#serviceState;
    const current = state === 'ready' ? currentService(this.#serviceSettings) : null;
    const statusIcon = state === 'ready' ? 'check' : state === 'checking' ? 'refresh' : 'alert';
    const title = state === 'ready' ? t('wel.svcReady', {name: current.name})
      : state === 'checking' ? t('wel.svcChecking') : t('wel.svcMissing');
    const detail = state === 'ready' ? t('wel.svcReadyD', {model: current.model || t('pop.defaultModel')})
      : state === 'missing' ? t('wel.svcMissingD') : '';
    return html`
    <section class="welcome-step-card" id="step-service" data-state=${state} aria-labelledby="service-heading">
      <div class="step-card-header">
        <div class="step-badge-row">
          <span class="step-num-badge">${t('wel.stepN',{n:3})}</span>
        </div>
        <h2 id="service-heading" class="step-title">${t('wel.svcTitle')}</h2>
        <p class="step-desc">${t('wel.svcDesc')}</p>
      </div>

      <div class="service-status" role="status" aria-live="polite">
        <span class="service-status-icon">${icon(statusIcon, {size: 18})}</span>
        ${current ? html`<img class="provider-logo" src=${providerIconUrl(current.icon)} width="24" height="24" alt="" aria-hidden="true">` : ''}
        <div class="service-status-text">
          <strong id="service-status-title">${title}</strong>
          ${detail ? html`<span>${detail}</span>` : ''}
        </div>
        <button type="button" id="service-open-btn" class=${classMap({'service-open-btn': true, primary: state !== 'ready'})}
          ?disabled=${state === 'checking'} @click=${() => this.#openServiceOptions()}>
          ${icon('settings', {size: 14})}
          <span>${state === 'ready' ? t('wel.svcManage') : t('wel.svcConnect')}</span>
        </button>
      </div>

      ${state === 'missing' ? html`
      <ul class="service-route-grid" aria-label=${t('wel.svcRoutes')}>
        ${SERVICE_ROUTES.map(route => {
          const template = CATALOG_TEMPLATES.find(value => value.id === route.id);
          return html`<li class="service-route" data-route=${route.id}>
            <img class="provider-logo" src=${providerIconUrl(template?.icon)} width="24" height="24" alt="" aria-hidden="true">
            <div class="service-route-body">
              <span class="service-route-name">${template?.name || route.id}</span>
              <span class="service-route-desc">${t(route.desc)}</span>
            </div>
            <span class="service-route-tag">${t('wel.svcViaConnector')}</span>
          </li>`;
        })}
        <li class="service-route" data-route="api">
          <img class="provider-logo" src=${providerIconUrl('custom-api')} width="24" height="24" alt="" aria-hidden="true">
          <div class="service-route-body">
            <span class="service-route-name">${t('wel.svcApiT')}</span>
            <span class="service-route-desc">${t('wel.svcApiD')}</span>
          </div>
          <span class="service-route-tag">${t('wel.svcViaKey')}</span>
        </li>
      </ul>
      <p class="service-note">${icon('shield', {size: 14})}<span>${t('wel.svcNote')}</span></p>` : ''}
    </section>`;
  }

  #renderSandboxParagraph() {
    const token = (word, hint) => html`<span class=${classMap({'sb-token': true, 'active-target': this.#selectedWord === word})} data-word=${word}
      @click=${() => this.#selectWord(word)}>${word}</span>`;
    if (this.#sandboxMode === 'ruby') {
      const ruby = (word, hint) => html`<ruby class=${classMap({'sb-token': true, 'active-target': this.#selectedWord === word})} data-word=${word}
        @click=${() => this.#selectWord(word)}>${word}<rt>${hint}</rt></ruby>`;
      return html`Careful readers ${ruby('compare', SANDBOX_WORDS.compare.rubyHint())} the evidence that each explanation provides before they reach a ${ruby('conclusion', SANDBOX_WORDS.conclusion.rubyHint())}. The cache reduces ${ruby('latency', SANDBOX_WORDS.latency.rubyHint())} significantly when network ${ruby('congestion', SANDBOX_WORDS.congestion.rubyHint())} spikes.`;
    }
    if (this.#sandboxMode === 'structure') {
      return html`<span class="syntax-subj" title=${t('wel.subj')}>Careful readers</span> <span class="syntax-pred" title=${t('wel.pred')}>compare</span> <span class="syntax-obj" title=${t('wel.obj')}>the evidence <span class="syntax-attr" title=${t('wel.attr')}>that each explanation provides</span></span> <span class="syntax-adv" title=${t('wel.advTime')}>before they reach a conclusion</span>. <span class="syntax-subj" title=${t('wel.subj')}>The cache</span> <span class="syntax-pred" title=${t('wel.pred')}>reduces</span> <span class="syntax-obj" title=${t('wel.obj')}>latency</span> significantly <span class="syntax-adv" title=${t('wel.advCond')}>when network congestion spikes</span>.`;
    }
    return html`Careful readers ${token('compare')} the evidence that each explanation provides before they reach a ${token('conclusion')}. The cache reduces ${token('latency')} significantly when network ${token('congestion')} spikes.`;
  }

  #renderModeButton(mode, selectedLabel) {
    const icons = {
      card: svg`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>`,
      ruby: svg`<path d="M4 7V4h16v3M9 20h6M12 4v16"/>`,
      structure: svg`<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
    };
    return html`<button type="button" class=${classMap({'sandbox-mode-btn': true, active: this.#sandboxMode === mode})}
      data-mode=${mode} role="tab" aria-selected=${this.#sandboxMode === mode ? 'true' : 'false'}
      @click=${() => this.#setSandboxMode(mode)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">${icons[mode]}</svg>
      <span>${selectedLabel}</span>
    </button>`;
  }

  #renderChoiceCard(group, value, title, badge, badgeClass, text) {
    const isAssistance = group === 'assistance';
    const checked = isAssistance ? this.#assistanceMode === value : this.#lookupDisplay === value;
    const body = html`<input type="radio" name=${isAssistance ? 'welcome-assistance-mode' : 'welcome-lookup-display'} value=${value} .checked=${checked}
        @change=${() => { if (isAssistance) this.#assistanceMode = value; else this.#lookupDisplay = value; this.requestUpdate(); }}>
      <div class="choice-card-body">
        <div class="choice-card-head">
          <span class="choice-title">${title}</span>
          <span class="choice-badge ${badgeClass}">${badge}</span>
        </div>
        <p class="choice-text">${text}</p>
      </div>`;
    const classes = classMap({'welcome-choice-card': true, 'is-selected': checked});
    return isAssistance
      ? html`<label class=${classes} data-mode=${value}>${body}</label>`
      : html`<label class=${classes} data-display=${value}>${body}</label>`;
  }

  render() {
    const word = SANDBOX_WORDS[this.#selectedWord];
    const hudHidden = this.#sandboxMode !== 'card';
    return html`
  <header class="welcome-header">
    <div class="welcome-header-inner">
      <div class="welcome-brand">
        <div class="brand-icon-box">
          <img class="rc-logo-light" src=${chrome.runtime.getURL('icons/roamcat-light.svg')} width="26" height="26" alt="RoamCat"><img class="rc-logo-dark" src=${chrome.runtime.getURL('icons/roamcat.svg')} width="26" height="26" alt="RoamCat">
        </div>
        <div class="brand-meta">
          <div class="brand-name-row">
            <span class="brand-name">ROAMCAT</span>
            <span class="brand-version-pill">v${chrome.runtime.getManifest?.().version ?? '0.0.1'}</span>
          </div>
          <span class="brand-sub">${t('pop.brand')}</span>
        </div>
      </div>
      <div class="welcome-header-actions">
        <div class="theme-switch-wrap">
          <button type="button" id="theme-toggle-btn" class="theme-switch-btn" title=${t('wel.themeTitle',{label:t(THEME_LABELS[this.#theme])||THEME_LABELS[this.#theme]})} @click=${() => this.#cycleTheme()}>
            <svg id="theme-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">${THEME_ICONS[this.#theme]}</svg>
            <span id="theme-toggle-label">${t('opt.themeBtnLabel',{label:t(THEME_LABELS[this.#theme])||THEME_LABELS[this.#theme]})}</span>
          </button>
        </div>
        <div class="theme-switch-wrap">
          <button type="button" id="lang-toggle-btn" class="theme-switch-btn" title=${t('opt.langToggleTitle',{lang:this.#langName()})} @click=${() => this.#cycleUiLang()}>
            ${icon('globe', {size: 14})}
            <span id="lang-toggle-label">${t('opt.langBtnLabel',{label:this.#langName()})}</span>
          </button>
        </div>
        <button type="button" id="close-welcome-btn" class="welcome-options-link" @click=${() => this.#closeWelcome()}>${t('wel.closeGuide')}</button>
        <a href="options.html" class="welcome-options-link" title=${t('wel.toOptions')}>
          ${icon('settings', {size: 14})}
          <span>${t('pop.options')}</span>
        </a>
      </div>
    </div>
  </header>

  <main class="welcome-container">
    <section class="welcome-hero-card" aria-labelledby="welcome-hero-title">
      <div class="welcome-hero-main">
        <div class="welcome-tag-row">
          <span class="welcome-code-tag">${t('wel.codeTag')}</span>
        </div>
        <h1 id="welcome-hero-title" class="welcome-hero-title">
          <span class="hero-title-pixel">ROAMCAT</span>
          <span class="hero-title-serif">${t('wel.heroTitle')}</span>
        </h1>
        <p class="welcome-hero-desc">
          ${t('wel.heroDesc')}
        </p>
        <div class="welcome-hero-cta">
          <a href="#step-sandbox" class="hero-cta-primary">${t('wel.ctaStart')}</a>
          <a href="#step-preferences" class="hero-cta-ghost">${t('wel.ctaConfig')} <span aria-hidden="true">→</span></a>
        </div>
        <div class="welcome-feature-pills">
          <div class="feature-pill">
            <span class="pill-icon">${icon('zap', {size: 18})}</span>
            <div class="pill-text"><strong>${t('wel.pill1T')}</strong><span>${t('wel.pill1D')}</span></div>
          </div>
          <div class="feature-pill">
            <span class="pill-icon">${icon('paw', {size: 18})}</span>
            <div class="pill-text"><strong>${t('wel.pill2T')}</strong><span>${t('wel.pill2D')}</span></div>
          </div>
          <div class="feature-pill">
            <span class="pill-icon">${icon('shield', {size: 18})}</span>
            <div class="pill-text"><strong>${t('wel.pill3T')}</strong><span>${t('wel.pill3D')}</span></div>
          </div>
        </div>
      </div>
      <div class="welcome-hero-art" aria-hidden="true">
        ${heroArt()}
        <div class="hero-art-caption">${t('wel.heroArtCaption')}</div>
      </div>
    </section>

    <section class="welcome-step-card" id="step-sandbox" aria-labelledby="sandbox-heading">
      <div class="step-card-header">
        <div class="step-badge-row">
          <span class="step-num-badge">${t('wel.stepN',{n:1})}</span>
        </div>
        <h2 id="sandbox-heading" class="step-title">${t('wel.sandboxTitle')}</h2>
        <p class="step-desc">${t('wel.sandboxDescA')}<code class="code-word">latency</code>${t('wel.sandboxDescB')}</p>
      </div>

      <div class="sandbox-toolbar">
        <div class="sandbox-mode-selector" role="tablist" aria-label=${t('wel.modeAria')}>
          ${this.#renderModeButton('card', t('wel.modeCard'))}
          ${this.#renderModeButton('ruby', t('wel.modeRuby'))}
          ${this.#renderModeButton('structure', t('wel.modeStruct'))}
        </div>
        <div class="sandbox-badge-info">
          <span class="live-pill">${t('wel.livePill')}</span>
        </div>
      </div>

      <div class="sandbox-browser-mockup">
        <div class="browser-address-bar">
          <div class="browser-dots" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div class="browser-url-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span title="https://developer.mozilla.org/en-US/docs/Web/Performance/Fundamentals">https://developer.mozilla.org/en-US/docs/Web/Performance/Fundamentals</span>
          </div>
          <div class="browser-status-pill">${t('wel.englishBody')}</div>
        </div>

        <div class="browser-reading-area" style=${styleMap(this.#sandboxMode === 'structure' ? this.#structureVars() : {})}>
          <p class="sandbox-paragraph" id="sandbox-text">${this.#renderSandboxParagraph()}</p>
          ${this.#sandboxMode === 'structure' ? html`<ul class="sandbox-structure-legend" aria-label=${t('wel.legendAria')}>
            ${STRUCTURE_ROLES.map(role => html`<li data-role=${role}><span class="legend-line" aria-hidden="true"></span>${t(`design.role.${role}`)}</li>`)}
          </ul>` : ''}

          <div class="sandbox-hud-card" id="sandbox-hud" ?hidden=${hudHidden}>
            <!-- 与真实解释卡片同构：词头旁是朗读按钮，下面是加粗的「词性 + 释义」、灰色语境句，再是操作按钮。真实卡片不显示音标。 -->
            <div class="hud-card-header">
              <div class="hud-term-group">
                <span class="hud-term" id="hud-term-text" lang="en">${word.word}</span>
                <button type="button" class="hud-audio-btn" id="hud-audio-btn" title=${t('c.speakWord')} aria-label=${t('c.speakWord')} @click=${() => this.#speakWord()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </button>
              </div>
            </div>
            <div class="hud-card-body">
              <p class="hud-definition" id="hud-def-text"><span class="hud-pos">${word.pos}</span> ${word.def()}</p>
              <p class="hud-context" id="hud-context-text">${word.context()}</p>
            </div>
            <div class="hud-card-footer">
              <div class="hud-actions-left">
                <button type="button" class=${classMap({'hud-action-btn': true, 'known-active': this.#known})} id="hud-known-btn"
                  @click=${() => { this.#known = !this.#known; this.requestUpdate(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
                  <span id="hud-known-text">${this.#known ? t('wel.knownOn') : t('wel.known')}</span>
                </button>
                <button type="button" class="hud-action-btn" id="hud-sentence-btn"
                  @click=${() => { this.#sentenceTransOpen = !this.#sentenceTransOpen; this.requestUpdate(); }}>${this.#sentenceTransOpen ? t('wel.sTransClose') : t('wel.sTransOpen')}</button>
              </div>
            </div>
            <div class="hud-sentence-translation" id="hud-sentence-trans" ?hidden=${!this.#sentenceTransOpen}>
              <p>${t('wel.demoTrans')}</p>
            </div>
          </div>
        </div>

        <div class="sandbox-footer-tip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>${t('wel.tipA')}<kbd class="inline-kbd" data-lookup-key>${this.#key}</kbd>${t('wel.tipB')}</span>
        </div>
      </div>
    </section>

    <section class="welcome-step-card" id="step-preferences" aria-labelledby="preferences-heading">
      <div class="step-card-header">
        <div class="step-badge-row">
          <span class="step-num-badge">${t('wel.stepN',{n:2})}</span>
        </div>
        <h2 id="preferences-heading" class="step-title">${t('wel.prefTitle')}</h2>
        <p class="step-desc">${t('wel.prefDesc')}</p>
      </div>

      <div class="quick-config-grid">
        <div class="config-block">
          <div class="config-block-header">
            <span class="config-num">01</span>
            <div>
              <h3 class="config-title">${t('wel.keyTitle')}</h3>
              <p class="config-desc">${t('wel.keyDesc')}</p>
            </div>
          </div>
          <div class="hotkey-setup-box">
            <div class="keycap-preview-area">
              <div class=${classMap({'welcome-keycap-box': true, 'keycap-pressed': this.#keyPulse})} id="welcome-keycap-display" title=${t('wel.keyTest')}
                @click=${() => this.#setLookupKey(this.#key)}>
                <span id="welcome-keycap-char">${this.#key}</span>
              </div>
              <div class="keycap-instruction">
                <span class="keycap-state-label">${t('wel.keyNowA')}<kbd id="keycap-label-name">${this.#key}</kbd>${t('wel.keyNowB')}</span>
                <span class="keycap-state-sub">${t('wel.keyNoInterfere')}</span>
              </div>
            </div>
            <div class="hotkey-options-row" id="hotkey-selector-group">
              ${['D', 'F', 'S', 'A', 'E'].map(k => html`<button type="button" class=${classMap({'hotkey-choice-btn': true, active: this.#key === k})} data-key=${k}
                @click=${() => this.#setLookupKey(k)}>${k === 'D' ? t('wel.keyDef',{k}) : t('wel.keyBtn',{k})}</button>`)}
            </div>
          </div>
        </div>

        <div class="config-block">
          <div class="config-block-header">
            <span class="config-num">02</span>
            <div>
              <h3 class="config-title">${t('wel.assistTitle')}</h3>
              <p class="config-desc">${t('wel.assistDesc')}</p>
            </div>
          </div>
          <div class="choice-cards-container">
            ${this.#renderChoiceCard('assistance', 'ambient', t('wel.cardAmbientT'), t('wel.cardAmbientB'), 'recommended', t('wel.cardAmbientD'))}
            ${this.#renderChoiceCard('assistance', 'on-demand', t('wel.cardQuietT'), t('wel.cardQuietB'), 'quiet', t('wel.cardQuietD'))}
          </div>
        </div>

        <div class="config-block">
          <div class="config-block-header">
            <span class="config-num">03</span>
            <div>
              <h3 class="config-title">${t('wel.dispTitle')}</h3>
              <p class="config-desc">${t('wel.dispDesc')}</p>
            </div>
          </div>
          <div class="choice-cards-container">
            ${this.#renderChoiceCard('display', 'card', t('wel.cardCardT'), t('wel.cardCardB'), 'popup', t('wel.cardCardD'))}
            ${this.#renderChoiceCard('display', 'annotation', t('wel.cardRubyT'), t('wel.cardRubyB'), 'ruby', t('wel.cardRubyD'))}
          </div>
        </div>
      </div>
    </section>

    ${this.#renderServiceStep()}

    <section class="welcome-step-card" id="step-cheatsheet" aria-labelledby="cheatsheet-heading">
      <div class="step-card-header">
        <div class="step-badge-row">
          <span class="step-num-badge">${t('wel.stepN',{n:4})}</span>
        </div>
        <h2 id="cheatsheet-heading" class="step-title">${t('wel.csTitle')}</h2>
        <p class="step-desc">${t('wel.csDesc')}</p>
      </div>

      <div class="cheatsheet-grid">
        <div class="cheatsheet-card">
          <div class="cheatsheet-keycaps">
            <kbd class="cs-kbd" data-lookup-key>${this.#key}</kbd>
            <span class="cs-plus">+</span>
            <span class="cs-mouse">${t('wel.csClick')}</span>
          </div>
          <div class="cheatsheet-info">
            <h4 class="cs-title">${t('wel.cs1T')}</h4>
            <p class="cs-desc">${t('wel.cs1D')}</p>
          </div>
        </div>

        <div class="cheatsheet-card">
          <div class="cheatsheet-keycaps">
            <kbd class="cs-kbd">Alt</kbd>
            <span class="cs-plus">+</span>
            <kbd class="cs-kbd">Shift</kbd>
            <span class="cs-plus">+</span>
            <kbd class="cs-kbd">S</kbd>
          </div>
          <div class="cheatsheet-info">
            <h4 class="cs-title">${t('wel.cs2T')}</h4>
            <p class="cs-desc">${t('wel.cs2D')}</p>
          </div>
        </div>

        <div class="cheatsheet-card">
          <div class="cheatsheet-keycaps">
            <kbd class="cs-kbd">Alt</kbd>
            <span class="cs-plus">+</span>
            <kbd class="cs-kbd">Shift</kbd>
            <span class="cs-plus">+</span>
            <kbd class="cs-kbd">T</kbd>
          </div>
          <div class="cheatsheet-info">
            <h4 class="cs-title">${t('wel.cs3T')}</h4>
            <p class="cs-desc">${t('wel.cs3D')}</p>
          </div>
        </div>

        <div class="cheatsheet-card">
          <div class="cheatsheet-keycaps">
            <span class="cs-mouse">${t('wel.cs4M')}</span>
          </div>
          <div class="cheatsheet-info">
            <h4 class="cs-title">${t('wel.cs4T')}</h4>
            <p class="cs-desc">${t('wel.cs4D')}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="welcome-step-card launch-card" id="step-launch" aria-labelledby="launch-heading">
      <div class="launch-inner">
        <div class="launch-icon-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h2 id="launch-heading" class="launch-title">${t('wel.launchTitle')}</h2>
        <p class="launch-desc">${t('wel.launchDesc')}</p>

        <div class="launch-actions-wrap">
          <button type="button" id="save-and-launch-btn" class="launch-primary-btn" .disabled=${this.#saving} @click=${() => void this.#savePreferences()}>
            ${icon('check', {size: 18})}
            <span id="save-btn-text">${this.#saveButtonText || t('wel.launchBtn')}</span>
          </button>
          <button type="button" id="finish-welcome-btn" class="launch-secondary-btn" @click=${() => this.#closeWelcome()}>${t('wel.finish')}</button>
        </div>

        <div id="save-status-toast" class="launch-toast" ?hidden=${!this.#toastVisible} role="status" aria-live="polite">
          <span class="toast-check">${icon('check', {size: 14})}</span>
          <span id="toast-message">${this.#toastMessage}</span>
        </div>
      </div>
    </section>
  </main>

  <footer class="welcome-footer">
    <div class="footer-left">
      <span class="footer-brand">RoamCat</span>
      <span class="footer-sep">·</span>
      <span>${t('wel.footerLocal')}</span>
    </div>
    <div class="footer-right">
      <a href="options.html#guide" class="footer-link">${t('wel.manual')}</a>
      <span class="footer-sep">|</span>
      <a href="options.html#service" class="footer-link">${t('wel.modelLink')}</a>
      <span class="footer-sep">|</span>
      <a href="options.html#privacy" class="footer-link">${t('wel.privacyLink')}</a>
    </div>
  </footer>`;
  }
}

customElements.define('roamcat-welcome', RoamcatWelcome);
