/**
 * @file src/pages/options/sections/personalization.js
 * 文件职责：设置页「词汇与记录 · 已认识词」分区模板：已认识的词、可选的个性化分析与调整记录。
 * 主要内容：无绑定静态模板（动态内容由 @ext/ui/history.js 命令式填充），分区可见性由 options-app 统一驱动。
 *   三块依次平铺，不再分内层标签；id 契约不变。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {row, switchRow} from './parts.js';

export const personalizationSection = html`
<section id="personalization" class="settings-section personalization-section" aria-labelledby="personalization-heading" hidden="">
<h2 id="personalization-heading" class="sr-only">${t('opt.nav.personalization')}</h2>
<p id="personalization-problem" class="notice error" role="alert" hidden=""></p>
<span id="personalization-result" class="inline-message" aria-live="polite"></span>
<div id="personalization-known" class="opt-group">
<div class="opt-group-head"><h2>${t('sec.perso.known')}</h2></div>
<div id="history-known-words" class="opt-card known-words-card" tabindex="-1">
<p class="opt-card-note">${t('sec.perso.knownDesc')}</p>
<div id="known-word-list" class="known-word-list" aria-live="polite"></div>
<p id="known-word-empty" class="empty-state">${t('sec.perso.knownEmpty')}</p>
<p id="known-word-result" class="inline-message" aria-live="polite"></p>
</div>
</div>
<div id="personalization-preferences" class="opt-group">
<div class="opt-group-head"><h2>${t('sec.perso.tabPrefs')}</h2></div>
<div class="opt-card">
${switchRow('personalization-enabled', t('sec.perso.enabled'), t('sec.perso.enabledDesc'))}
${switchRow('personalization-auto-apply', t('sec.perso.autoApply'), t('sec.perso.autoApplyDesc'))}
${row({label: t('sec.perso.service'), desc: html`<b id="personalization-service-label">${t('sec.perso.notConnected')}</b>`, cls: 'personalization-service', control: html`<button id="personalization-analyze" class="primary-action" type="button">${t('sec.perso.analyze')}</button><button id="personalization-reset" class="danger-button" type="button">${t('sec.perso.reset')}</button>`})}
<details class="calculation-note opt-card-note"><summary>${t('sec.perso.scope')}</summary><p>${t('sec.perso.scopeDesc')}</p></details>
</div>
<div id="personalization-status" class="paper-card personalization-status"></div>
<div id="personalization-pending" class="paper-card personalization-pending" hidden=""></div>
</div>
<div id="personalization-adjustments" class="opt-group">
<div class="opt-group-head"><h2>${t('sec.perso.tabAdj')}</h2></div>
<div class="opt-card personalization-overrides">
<p class="opt-card-note">${t('sec.perso.overridesDesc')}</p>
<div id="personalization-override-list" class="override-list"></div>
<p id="personalization-overrides-empty" class="empty-state">${t('sec.perso.overridesEmpty')}</p>
</div>
<details class="paper-card settings-disclosure personalization-versions"><summary>${t('sec.perso.versions')}</summary><div><div id="personalization-version-list" class="version-list"></div><p id="personalization-versions-empty" class="empty-state">${t('sec.perso.versionsEmpty')}</p></div></details>
</div>
</section>
`;
