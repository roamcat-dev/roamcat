/**
 * @file src/pages/options/sections/pet.js
 * 文件职责：设置页「阅读 · 伴读猫」分区模板：网页悬浮伴读猫的开关、显示模式、哲学语录与停靠位置。
 * 主要内容：无绑定静态模板（开关与下拉由 options-controller.js 按 id 绑定），分区可见性由 options-app 统一驱动。
 *   设置页宣言弹层的「去设置伴读猫」跳到这里（#pet）并高亮这一组。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {group, row, selectControl, switchControl, switchRow} from './parts.js';

export const petSection = html`
<section id="pet" class="settings-section" aria-labelledby="pet-heading" hidden="">
<h2 id="pet-heading" class="sr-only">${t('opt.tab.pet')}</h2>
${group({title: t('sec.assist.pet'), id: 'setting-block-floating-pet', purpose: 'setting-block-floating-pet', body: html`
${switchRow('floating-pet-enabled', t('sec.assist.petEnable'), t('sec.assist.petEnableDesc'), {checked: true, title: t('sec.assist.petSwitch')})}
${row({label: t('sec.assist.petTheme'), desc: t('sec.assist.petThemeDesc'), labelFor: 'floating-pet-theme', control: selectControl('floating-pet-theme', [['auto', t('sec.assist.petAuto')], ['dark', t('sec.assist.petDark')], ['light', t('sec.assist.petLight')]])})}
${row({label: t('sec.assist.petQuotes'), desc: t('sec.assist.petQuotesDesc'), labelFor: 'floating-pet-quotes-enabled', control: html`${selectControl('floating-pet-quotes-interval', [['15', t('sec.assist.pet15')], ['30', t('sec.assist.pet30')], ['60', t('sec.assist.pet60')]], {narrow: true, label: t('sec.assist.petQuotesInterval'), title: t('sec.assist.petQuotesInterval')})}${switchControl('floating-pet-quotes-enabled', t('sec.assist.petQuotes'), {checked: true, title: t('sec.assist.petQuotesSwitch')})}`})}
${row({label: t('sec.assist.petResetLabel'), desc: t('sec.assist.petResetHint'), control: html`<button type="button" id="floating-pet-reset-pos" class="secondary-button">${t('sec.assist.petReset')}</button>`})}
`})}
</section>
`;
