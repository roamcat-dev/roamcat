/**
 * @file src/pages/options/sections/translation.js
 * 文件职责：设置页「阅读 · 双语翻译」分区模板：整页译文的显示方式与译文样式，以及 PDF / EPUB 阅读器。
 * 主要内容：无绑定静态模板（动态内容由 options-controller.js 命令式填充），分区可见性由 options-app 统一驱动。
 *   「双语 / 仅译文」与弹窗、网页左下角的同名切换写同一项设置（PAGE_TRANSLATION_DISPLAY_SET）；
 *   各场景用哪个翻译引擎在「模型服务 · 任务分配」里选，这里只给入口。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {group, readingLayerRows, readingPreviewRow, row, segmentRow, switchControl} from './parts.js';

export const translationSection = html`
<section id="translation" class="settings-section" aria-labelledby="translation-heading" hidden="">
<h2 id="translation-heading" class="sr-only">${t('opt.tab.translation')}</h2>
${group({title: t('sec.tr.gPage'), body: html`
${segmentRow('page-translation-display', t('sec.tr.display'), t('sec.tr.displayDesc'), [['bilingual', t('sec.tr.bilingual')], ['translation', t('sec.tr.translationOnly')]])}
${row({label: t('sec.tr.engine'), desc: t('sec.tr.engineDesc'), control: html`<a class="text-link-button" href="#routing">${t('sec.tr.toRouting')}</a>`})}
`})}
${group({title: t('sec.tr.gStyle'), body: html`
${readingLayerRows('translation')}
${readingPreviewRow('translation-style-preview', 'translation', 'reset-translation-style', t('sec.ap.resetTranslation'))}
`})}
${group({title: t('sec.tr.gReader'), body: row({label: t('sec.assist.reader'), desc: t('sec.assist.readerDesc'), labelFor: 'pdf-reader-enabled', control: html`<a class="text-link-button" href="reader.html" target="_blank" rel="noopener">${t('sec.assist.readerOpen')}</a>${switchControl('pdf-reader-enabled', t('sec.assist.reader'), {checked: true, title: t('sec.assist.readerSwitch')})}`})})}
</section>
`;
