/**
 * @file src/pages/options/sections/appearance.js
 * 文件职责：设置页「阅读 · 解构」分区模板：阅读解构的粒度、下划线样式与实时预览，以及本机完成的长难句、公式标注。
 * 主要内容：无绑定静态模板（动态内容由 options-controller.js 命令式填充），分区可见性由 options-app 统一驱动。
 *   分区 id 仍是 appearance（旧的 #appearance 链接直接落到这里）；原词、词注、译文样式已移到「查词」「双语翻译」分区。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {group, segmentRow, switchRow} from './parts.js';

export const appearanceSection = html`
<section id="appearance" class="settings-section" aria-labelledby="appearance-heading" hidden="">
<h2 id="appearance-heading" class="sr-only">${t('opt.tab.structure')}</h2>
${group({title: t('sec.ap.structure'), id: 'sentence-density-settings', body: html`
${segmentRow('sentence-density', t('sec.ap.density'), t('sec.ap.densityDesc'), [['coarse', t('sec.ap.coarse')], ['medium', t('sec.ap.medium')], ['fine', t('sec.ap.fine')]], {descId: 'sentence-density-help'})}
${segmentRow('sentence-line-style', t('sec.ap.lineStyle'), t('sec.ap.lineStyleDesc'), ['solid', 'dashed', 'dotted', 'wavy'].map(line => [line, t(`sec.ap.${line}`), {line}]))}
<div class="opt-row is-block">
<section id="sentence-structure-preview" class="sentence-structure-preview" aria-labelledby="sentence-structure-preview-heading">
<h3 id="sentence-structure-preview-heading" class="opt-row-label">${t('sec.ap.preview')}</h3>
<div class="sentence-preview-page">
<p id="sentence-preview-source" lang="en">Careful readers compare the evidence that each explanation provides before they reach a conclusion.</p>
</div>
<div class="structure-legend-row" aria-label="${t('sec.ap.legendAria')}">
  <span class="structure-legend-item" data-role="subject"><i class="legend-dot"></i>${t('sec.ap.subj')}</span>
  <span class="structure-legend-item" data-role="predicate"><i class="legend-dot"></i>${t('sec.ap.pred')}</span>
  <span class="structure-legend-item" data-role="object"><i class="legend-dot"></i>${t('sec.ap.obj')}</span>
  <span class="structure-legend-item" data-role="attributive"><i class="legend-dot"></i>${t('sec.ap.attr')}</span>
  <span class="structure-legend-item" data-role="adverbial"><i class="legend-dot"></i>${t('sec.ap.adv')}</span>
</div>
<p class="opt-row-desc">${t('sec.ap.previewNote')} ${t('sec.ap.enableHint')}<a href="#sites">${t('opt.nav.sites')}</a>${t('sec.ap.enableHintB')}</p>
</section>
</div>
<p id="sentence-density-result" class="inline-message opt-row-message" role="status" hidden=""></p>
`})}
${group({title: t('sec.ap.gLocal'), purpose: 'setting-block-reading-boost', body: html`
${switchRow('complex-assist-enabled', t('sec.assist.hard'), t('sec.assist.hardDesc'), {checked: true, title: t('sec.assist.hardSwitch')})}
${switchRow('formula-assist-enabled', t('sec.assist.formula'), t('sec.assist.formulaDesc'), {checked: true, title: t('sec.assist.formulaSwitch')})}
`})}
</section>
`;
