/**
 * @file src/pages/options/options-app.js
 * 文件职责：设置页 Lit 应用壳——七个分组、15 个分区的 hash 路由（组内用标签切换；旧 #advanced、#task-assignment 重定向）（含 view transitions）、
 *   侧栏折叠（中等宽度自动收为图标栏）与设置搜索、主题切换、宣言弹层、密码可见性切换。
 * 主要内容：渲染 shell.js + 15 个静态分区模板（light DOM 保留全部 id 契约）；侧栏导航由 GROUPS 生成；
 *   首帧渲染完成后动态加载 options-controller.js 与 history.js，二者沿用原
 *   imperative DOM 契约填充动态内容；optionsSectionEnter 负责分区进入钩子。
 * 模块边界：扩展页受信上下文；路由与外壳状态唯一来源为本组件。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {LitElement, html, svg} from 'lit';
import {t, onUiLangChange} from '../../i18n-runtime.js';
import {VIDEO_SUPPORT_ENABLED} from '@ext/activation.js';
import {shellTop, mainToolbar, heroBlock, nowStatus, shellDialog} from './shell.js';
import {
  assistanceSection, appearanceSection, translationSection, petSection, sitesSection, videoSection,
  termsSection, personalizationSection, historySection, privacySection,
  serviceSection, routingSection, diagnosticsSection, guideSection, shortcutsSection,
} from './sections/index.js';

// 侧栏七个分组；组内有几个分区时，页头下方用标签切换。hash 是分区名（#terms、#diagnostics …），
// 拆分前的旧分区名都还在（#assistance 仍是阅读组首页、#appearance 是解构、#service 是服务与连接），弹窗、伴读猫和文档里的旧链接不用改。
const GROUPS = [
  {id: 'reading', label: 'opt.group5.reading', desc: 'opt.group5.readingDesc', sections: ['assistance', 'appearance', 'translation', 'pet']},
  {id: 'sites', label: 'opt.group5.sites', desc: 'opt.group5.sitesDesc', sections: ['sites']},
  {id: 'video', label: 'opt.group5.video', desc: 'opt.group5.videoDesc', sections: ['video'], videoFeature: true},
  {id: 'service', label: 'opt.group5.service', desc: 'opt.group5.serviceDesc', sections: ['service', 'routing']},
  {id: 'vocab', label: 'opt.group5.vocab', desc: 'opt.group5.vocabDesc', sections: ['terms', 'personalization', 'history']},
  {id: 'privacy', label: 'opt.group5.privacy', desc: 'opt.group5.privacyDesc', sections: ['privacy']},
  {id: 'help', label: 'opt.group5.help', desc: 'opt.group5.helpDesc', sections: ['guide', 'shortcuts', 'diagnostics']},
];
const SECTIONS = GROUPS.flatMap(group => group.sections);
// 已并入其他分区的旧锚点：hash → [分区, 分区内滚动目标]
const SECTION_ALIASES = {advanced: ['sites', 'domain-detection'], 'task-assignment': ['routing']};
const SECTION_TEMPLATES = {
  assistance: assistanceSection, appearance: appearanceSection, translation: translationSection, pet: petSection,
  sites: sitesSection, video: videoSection, service: serviceSection, routing: routingSection,
  terms: termsSection, personalization: personalizationSection, history: historySection,
  privacy: privacySection, guide: guideSection, shortcuts: shortcutsSection, diagnostics: diagnosticsSection,
};
// 组内标签名（单分区分组不显示标签，面包屑只写分组名）。
const LABELS = {
  assistance: 'opt.tab.lookup', appearance: 'opt.tab.structure', translation: 'opt.tab.translation', pet: 'opt.tab.pet',
  sites: 'opt.nav.sites', video: 'opt.nav.video', service: 'opt.tab.service', routing: 'opt.tab.routing',
  terms: 'opt.nav.terms', personalization: 'opt.nav.personalization', history: 'opt.nav.history',
  privacy: 'opt.nav.privacy', guide: 'opt.nav.guide', shortcuts: 'opt.nav.shortcuts', diagnostics: 'opt.nav.diagnostics',
};
const SECTION_GROUP = Object.fromEntries(GROUPS.flatMap(group => group.sections.map(section => [section, group])));
const NAV_ICONS = {
  reading: svg`<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"></path><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"></path>`,
  sites: svg`<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>`,
  video: svg`<rect x="3" y="5" width="18" height="14" rx="2.5"></rect><path d="M10 9.5v5l4.5-2.5z"></path>`,
  service: svg`<rect x="5" y="5" width="14" height="14" rx="3"></rect><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"></path>`,
  vocab: svg`<path d="M4 6h16M4 12h10M4 18h7"></path>`,
  privacy: svg`<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"></path><path d="M9.5 12l1.8 1.8 3.2-3.6"></path>`,
  help: svg`<circle cx="12" cy="12" r="9"></circle><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7"></path><path d="M12 17.2h.01"></path>`,
};
const sidebarNav = html`<nav class="sidebar-nav-menu" aria-label=${t('opt.settingsNav')} data-purpose="nav-menu">
  <div class="nav-group">
    ${GROUPS.map(group => html`<a href="#${group.sections[0]}" data-group=${group.id} class="cyber-nav-item" data-tooltip=${t(group.label)} ?hidden=${Boolean(group.videoFeature) && !VIDEO_SUPPORT_ENABLED}>
      <div class="nav-item-left"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[group.id]}</svg></span><span class="nav-text">${t(group.label)}</span></div>
    </a>`)}
  </div>
</nav>`;
const groupTabs = html`<nav class="group-tabs" aria-label=${t('opt.settingsNav')}>
  ${GROUPS.filter(group => group.sections.length > 1).flatMap(group => group.sections.map(section => html`<a href="#${section}" class="group-tab" data-section=${section} data-tab-group=${group.id}>${t(LABELS[section])}</a>`))}
</nav>`;
const SEARCH_LIMIT = 8;
const THEMES = ['auto', 'dark', 'light'];
const THEME_LABELS = {auto: 'opt.themeAuto', dark: 'opt.themeDark', light: 'opt.themeLight'};
const THEME_ICONS = {
  auto: '<rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>',
  dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>',
  light: '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>',
};

const $ = id => document.getElementById(id);
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

class RoamcatOptions extends LitElement {
  createRenderRoot() { return this; }

  #section = '';
  #controller = null;
  #collapsed = localStorage.getItem('roamcat_sidebar_collapsed') === 'true';
  // 中等宽度（761–1100px）自动收成图标栏；此时手动展开只在本次窄屏内有效，不改写保存的偏好。
  #narrowQuery = matchMedia('(min-width: 761px) and (max-width: 1100px)');
  #offLang = null;
  #narrowExpanded = false;
  #onNarrowChange = () => { this.#narrowExpanded = false; this.#applyCollapsed(); };
  #theme = localStorage.getItem('roamcat_ui_theme') || 'auto';

  #onHashChange = () => this.#applyRoute();
  #onClick = event => {
    const hit = event.target.closest('.sidebar-search-hit');
    if (hit) { event.preventDefault(); this.#openSearchHit(Number(hit.dataset.hit)); return; }
    const collapseBtn = event.target.closest('#sidebar-collapse-btn');
    if (collapseBtn) { this.#setCollapsed(!this.#isCollapsed()); return; }
    if (event.target.closest('#sidebar-brand-logo')) {
      if (this.#isCollapsed()) this.#setCollapsed(false);
      return;
    }
    if (event.target.closest('#theme-toggle-btn')) { this.#cycleTheme(); return; }
    if (event.target.closest('#lang-toggle-btn')) { this.#cycleUiLang(); return; }
    const pwBtn = event.target.closest('.toggle-password-btn');
    if (pwBtn) { this.#togglePassword(pwBtn); return; }
    const stampCard = event.target.closest('#sidebar-stamp-card');
    if (stampCard) { event.preventDefault(); this.#openStampModal(); return; }
    const modal = $('stamp-manifesto-modal');
    if (modal) {
      if (event.target.closest?.('#stamp-modal-close') || event.target.closest?.('#stamp-modal-confirm') || event.target.id === 'stamp-modal-backdrop' || event.target === modal) {
        this.#closeStampModal();
        return;
      }
      if (event.target.closest('#stamp-modal-goto-pet')) {
        this.#closeStampModal();
        this.#reveal('pet', $('setting-block-floating-pet'));
      }
    }
  };
  #onKeydown = event => {
    if (event.target?.id === 'sidebar-search' && event.key === 'Enter' && this.#searchHits.length) {
      event.preventDefault();
      this.#openSearchHit(0);
      return;
    }
    if (event.target?.id === 'sidebar-search' && event.key === 'Escape' && event.target.value) {
      event.target.value = '';
      this.#search('');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      const field = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if (field && field.id !== 'sidebar-search') return;
      event.preventDefault();
      if (this.#isCollapsed()) this.#setCollapsed(false);
      const search = $('sidebar-search');
      search?.focus();
      search?.select();
      return;
    }
    const stampCard = event.target.closest('#sidebar-stamp-card');
    if (stampCard && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.#openStampModal();
    }
  };
  #onInput = event => {
    if (event.target?.id === 'sidebar-search') this.#search(event.target.value);
  };
  #searchIndex = null;
  #searchHits = [];
  // 搜索索引：每个分区的标签名，加上分区里每一组的标题和每一行设置的名称；首次输入时才建。
  #buildSearchIndex() {
    const entries = [];
    for (const section of SECTIONS) {
      const root = $(section);
      if (!root) continue;
      const group = SECTION_GROUP[section];
      const where = group.sections.length > 1 ? `${t(group.label)} · ${t(LABELS[section])}` : t(group.label);
      entries.push({text: t(LABELS[section]), where, section, target: null});
      for (const label of root.querySelectorAll('.opt-group-head h2, .opt-row-label')) {
        const text = label.textContent.trim();
        const target = label.closest('.opt-row, .opt-group');
        if (text && target) entries.push({text, where, section, target});
      }
    }
    return entries;
  }
  // 侧栏分组按组名或组内有设置命中来保留；命中的设置列在搜索框下方，点击（或回车选第一条）跳过去。
  #search(raw) {
    const query = raw.trim().toLowerCase();
    const found = query ? (this.#searchIndex ||= this.#buildSearchIndex()).filter(entry => entry.text.toLowerCase().includes(query)) : [];
    const hitGroups = new Set(found.map(entry => SECTION_GROUP[entry.section].id));
    let groupMatches = 0;
    document.querySelectorAll('.sidebar-nav-menu .cyber-nav-item').forEach(item => {
      if (!VIDEO_SUPPORT_ENABLED && GROUPS.find(entry => entry.id === item.dataset.group)?.videoFeature) return;
      const text = item.querySelector('.nav-text')?.textContent || '';
      const show = !query || text.toLowerCase().includes(query) || hitGroups.has(item.dataset.group);
      item.hidden = !show;
      if (show) groupMatches += 1;
    });
    const seen = new Set();
    this.#searchHits = found.filter(entry => {
      const key = `${entry.section}|${entry.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, SEARCH_LIMIT);
    const results = $('sidebar-search-results');
    if (results) {
      results.replaceChildren(...this.#searchHits.map((entry, index) => {
        const link = document.createElement('a');
        link.href = `#${entry.section}`;
        link.className = 'sidebar-search-hit';
        link.dataset.hit = String(index);
        const name = document.createElement('span');
        name.textContent = entry.text;
        const where = document.createElement('small');
        where.textContent = entry.where;
        link.append(name, where);
        const item = document.createElement('li');
        item.append(link);
        return item;
      }));
      results.hidden = !this.#searchHits.length;
    }
    const empty = $('sidebar-search-empty');
    if (empty) empty.hidden = !query || groupMatches > 0 || this.#searchHits.length > 0;
  }
  #openSearchHit(index) {
    const entry = this.#searchHits[index];
    if (!entry) return;
    const search = $('sidebar-search');
    if (search) search.value = '';
    this.#search('');
    this.#reveal(entry.section, entry.target);
  }
  // 跳到分区并把目标滚到视野中央、短暂高亮（搜索结果与宣言弹层的「去设置伴读猫」共用）。
  #reveal(section, target) {
    if (location.hash !== `#${section}`) location.hash = `#${section}`;
    if (!target) return;
    setTimeout(() => {
      target.scrollIntoView({behavior: 'smooth', block: 'center'});
      target.classList.remove('setting-highlight');
      void target.offsetWidth;
      target.classList.add('setting-highlight');
    }, 150);
  }

  render() {
    // <main> 与 .main-canvas-content 的开合标签必须位于同一模板内（lit 模板
    // 独立解析，未闭合标签会在片段末尾被自动闭合），故在此显式书写。
    return html`${shellTop(sidebarNav)}
    <main class="main-panel" data-purpose="settings-main-canvas">
      ${mainToolbar}
      <div class="main-canvas-content">
        ${heroBlock}
        ${groupTabs}
        ${nowStatus}
        ${SECTIONS.map(name => SECTION_TEMPLATES[name])}
      </div>
    </main>
    ${shellDialog}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#applyTheme(this.#theme);
    this.#applyCollapsed();
    this.#narrowQuery.addEventListener('change', this.#onNarrowChange);
    window.addEventListener('hashchange', this.#onHashChange);
    document.addEventListener('click', this.#onClick);
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('input', this.#onInput);
    // 外壳与各分区模板在模块加载时就取好了文案，别的扩展页切换语言后只能整页重载，否则会中英混杂。
    this.#offLang = onUiLangChange(() => location.reload());
    const kbd = document.querySelector('.sidebar-search-kbd');
    if (kbd) kbd.textContent = /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl+K';
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this.#onHashChange);
    this.#narrowQuery.removeEventListener('change', this.#onNarrowChange);
    document.removeEventListener('click', this.#onClick);
    document.removeEventListener('keydown', this.#onKeydown);
    document.removeEventListener('input', this.#onInput);
    this.#offLang?.();
    super.disconnectedCallback();
  }

  async firstUpdated() {
    const version = chrome.runtime.getManifest?.().version;
    const tag = document.querySelector('.brand-pro-tag');
    if (tag && version) tag.textContent = `v${version}`;
    this.#syncUiLangChoice();
    this.#applyRoute({initial: true});
    // 控制器与阅读记录模块在顶层执行 querySelector 契约绑定，必须在首帧渲染后加载。
    const [{optionsInit, optionsSectionEnter}] = await Promise.all([
      import('./options-controller.js'),
      import('@ext/ui/history.js'),
    ]);
    this.#controller = {optionsSectionEnter};
    await optionsInit(this.#section);
    optionsSectionEnter(this.#section, '');
  }

  #requestedSection() {
    const raw = location.hash.replace('#', '');
    if (SECTION_ALIASES[raw]) return SECTION_ALIASES[raw][0];
    return SECTIONS.includes(raw) ? raw : 'assistance';
  }

  #applyRoute({initial = false} = {}) {
    const requested = location.hash.replace('#', '');
    const section = this.#requestedSection();
    if (requested !== section) history.replaceState(null, '', `#${section}`);
    const anchor = SECTION_ALIASES[requested]?.[1];
    if (anchor) setTimeout(() => $(anchor)?.scrollIntoView({block: 'start'}), 150);
    const previous = this.#section;
    if (section === previous && !initial) return;
    // 先同步记下目标分区：视图过渡的回调是异步的，连续切换时只渲染最后一次的目标。
    this.#section = section;
    const mutate = () => {
      const current = this.#section;
      for (const name of SECTIONS) { const el = $(name); if (el) el.hidden = name !== current; }
      this.#syncChrome(current);
      this.#resetScroll();
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!initial && typeof document.startViewTransition === 'function' && !reduced) {
      document.startViewTransition(mutate);
      // 过渡回调要等下一帧；后台或被遮挡的窗口可能迟迟不出帧，到点仍未切换就直接切（mutate 可重复执行）。
      setTimeout(() => { if ($(this.#section)?.hidden) mutate(); }, 120);
    } else {
      mutate();
    }
    if (!initial && previous) $('section-title')?.focus({preventScroll: true});
    this.#controller?.optionsSectionEnter(section, previous);
  }

  #syncChrome(section) {
    const group = SECTION_GROUP[section] || GROUPS[0];
    const tabLabel = t(LABELS[section]);
    // 页头写分组名和一行说明；面包屑是「分组 / 当前标签」，单分区分组只写分组名。
    setText('section-title', t(group.label));
    setText('hero-desc', t(group.desc));
    setText('toolbar-category-title', t(group.label));
    setText('toolbar-breadcrumb-title', group.sections.length > 1 ? tabLabel : t(group.label));
    document.querySelector('.toolbar-breadcrumb')?.toggleAttribute('data-single', group.sections.length < 2);
    document.body.dataset.group = group.id;
    document.title = `${t('common.brand')} · ${group.sections.length > 1 ? `${t(group.label)} · ${tabLabel}` : t(group.label)}`;
    document.querySelectorAll('[data-tab-group]').forEach(tab => { tab.hidden = tab.dataset.tabGroup !== group.id; });
    document.querySelectorAll('[data-section]').forEach(link => {
      const active = link.dataset.section === section;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-group]').forEach(link => {
      const active = link.dataset.group === group.id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  #resetScroll() {
    const mainPanel = document.querySelector('.main-panel');
    if (mainPanel?.scrollTo) mainPanel.scrollTo({top: 0, behavior: 'instant'});
    else if (mainPanel) mainPanel.scrollTop = 0;
    window.scrollTo({top: 0, behavior: 'instant'});
  }

  #applyTheme(theme) {
    this.#theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('roamcat_ui_theme', theme);
    const i18n = globalThis.RoamCatI18n;
    const themeLabel = i18n ? i18n.t(THEME_LABELS[theme] || 'opt.themeAuto') : theme;
    setText('theme-toggle-label', i18n ? i18n.t('opt.themeBtnLabel', {label: themeLabel}) : themeLabel);
    const svgEl = $('theme-icon-svg');
    if (svgEl && THEME_ICONS[theme]) svgEl.innerHTML = THEME_ICONS[theme];
    const btn = $('theme-toggle-btn');
    if (btn) btn.title = i18n ? i18n.t('opt.themeToggleTitle', { theme: themeLabel }) : themeLabel;
  }

  #cycleTheme() {
    this.#applyTheme(THEMES[(THEMES.indexOf(this.#theme) + 1) % THEMES.length]);
  }

  #syncUiLangChoice() {
    const i18n = globalThis.RoamCatI18n;
    const pref = i18n?.pref?.() || 'auto';
    const label = $('lang-toggle-label');
    const langName = i18n?.t(`common.lang${pref === 'auto' ? 'Auto' : pref === 'zh' ? 'Zh' : 'En'}`);
    if (label && i18n) label.textContent = i18n.t('opt.langBtnLabel', {label: langName});
    const langBtn = $('lang-toggle-btn');
    if (langBtn && i18n) langBtn.title = i18n.t('opt.langToggleTitle', { lang: langName || pref });
  }

  #cycleUiLang() {
    const i18n = globalThis.RoamCatI18n;
    if (!i18n) return;
    const order = ['auto', 'zh', 'en'];
    const next = order[(order.indexOf(i18n.pref()) + 1) % order.length];
    this.#setUiLang(next);
  }

  #setUiLang(value) {
    const i18n = globalThis.RoamCatI18n;
    if (!i18n || i18n.pref() === value) return;
    i18n.setPref(value);
    // 等 chrome.storage.local 异步写入落地后再刷新，保证其他界面同步到
    setTimeout(() => location.reload(), 120);
  }

  #isCollapsed() {
    return this.#narrowQuery.matches ? !this.#narrowExpanded : this.#collapsed;
  }

  #setCollapsed(collapsed) {
    if (this.#narrowQuery.matches) this.#narrowExpanded = !collapsed;
    else {
      this.#collapsed = collapsed;
      localStorage.setItem('roamcat_sidebar_collapsed', String(collapsed));
    }
    this.#applyCollapsed();
  }

  #applyCollapsed() {
    const collapsed = this.#isCollapsed();
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const btn = $('sidebar-collapse-btn');
    if (btn) {
      const title = collapsed ? t('opt.expandSidebar') : t('opt.collapseSidebar');
      btn.title = title;
      btn.setAttribute('aria-label', title);
    }
  }

  #togglePassword(btn) {
    const targetId = btn.dataset.toggleTarget;
    const input = targetId ? $(targetId) : btn.parentElement?.querySelector('input,textarea');
    if (!input) return;
    let revealed;
    if (input.tagName === 'TEXTAREA') {
      // textarea 没有 type=password，用 -webkit-text-security 类遮罩。
      revealed = input.classList.toggle('key-pool-revealed');
    } else {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      revealed = isPassword;
    }
    const show = btn.querySelector('.eye-show');
    const hide = btn.querySelector('.eye-hide');
    if (show) show.hidden = revealed;
    if (hide) hide.hidden = !revealed;
    btn.title = revealed ? t('opt.hideKey') : t('opt.showKey');
    btn.setAttribute('aria-label', btn.title);
  }

  #openStampModal() {
    const modal = $('stamp-manifesto-modal');
    if (!modal) return;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  }

  #closeStampModal() {
    const modal = $('stamp-manifesto-modal');
    if (!modal) return;
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }
}

customElements.define('roamcat-options', RoamcatOptions);
