/**
 * @file src/pages/options/sections/assistance.js
 * 文件职责：设置页「阅读 · 查词」分区模板：查词的触发与显示方式，以及原词、词注的标注样式。
 * 主要内容：无绑定静态模板（动态内容由 options-controller.js 命令式填充），分区可见性由 options-app 统一驱动。
 *   伴读猫、长难句与公式、PDF 阅读器已分别移到「伴读猫」「解构」「双语翻译」分区；控件 id 不变。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {group, readingLayerRows, readingPreviewRow, row, segmentRow, selectControl} from './parts.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const assistanceSection = html`
<section id="assistance" class="settings-section" aria-labelledby="assistance-heading">
<h2 id="assistance-heading" class="sr-only">${t('opt.tab.lookup')}</h2>
${group({title: t('sec.assist.gLookup'), purpose: 'setting-block-assistance', body: html`
${segmentRow('assistance-mode', t('sec.assist.mode'), t('sec.assist.modeDesc'), [['ambient', t('sec.assist.auto')], ['on-demand', t('sec.assist.manual')]])}
${segmentRow('lookup-display', t('sec.assist.hud'), t('sec.assist.hudDesc'), [['card', t('sec.assist.card')], ['annotation', t('sec.assist.ruby')]])}
${row({label: t('sec.assist.key'), desc: t('sec.assist.keyDesc'), labelFor: 'lookup-key', control: selectControl('lookup-key', LETTERS.map(letter => [letter, letter, letter === 'D']), {narrow: true})})}
${row({label: t('sec.assist.lang'), desc: t('sec.assist.langDesc'), labelFor: 'help-language', control: selectControl('help-language', [['zh', t('sec.assist.langZh')], ['en', t('sec.assist.langEn')]])})}
`})}
${group({title: t('sec.ap.gMarks'), body: html`
${readingLayerRows('original')}
${readingLayerRows('annotation')}
${readingPreviewRow('reading-style-preview', 'original,annotation', 'reset-reading-style', t('sec.ap.resetLookup'))}
`})}
</section>
`;
