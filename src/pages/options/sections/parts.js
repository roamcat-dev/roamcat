/**
 * @file src/pages/options/sections/parts.js
 * 文件职责：设置页分区模板的共用零件——组、行、开关、下拉框、分段按钮与密钥显隐按钮。
 * 主要内容：group/row/switchControl/switchRow/selectControl/segmentRow/eyeToggle，统一产出
 *   .opt-group > .opt-group-head h2 + .opt-card > .opt-row 结构；各分区只拼内容，不再各写一套行标记。
 *   分段按钮沿用「label 包住 radio」的写法：选中态由 CSS 的 :has(input:checked) 决定，控制器只改 checked。
 * 模块边界：纯展示模板，不绑定事件（控件由 options-controller.js 按 id / name 绑定）。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html, nothing} from 'lit';
import {t} from '../../../i18n-runtime.js';

export const selectArrow = html`<div class="swiss-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>`;

/** 下拉框：options 为 [[value, label, selected?], …]；选项由控制器动态填充时传空数组。 */
export const selectControl = (id, options = [], {narrow = false, label = '', title = ''} = {}) => html`<div class="swiss-select-wrap${narrow ? ' opt-select-narrow' : ''}"><select id=${id} class="swiss-select" aria-label=${label || nothing} title=${title || nothing}>${options.map(([value, text, selected]) => html`<option value=${value} ?selected=${Boolean(selected)}>${text}</option>`)}</select>${selectArrow}</div>`;

export const switchControl = (id, label, {checked = false, title = ''} = {}) => html`<label class="switch" title=${title || nothing}><input id=${id} type="checkbox" ?checked=${checked}><span aria-hidden="true"></span><span class="sr-only">${label}</span></label>`;

/**
 * 一行设置：左侧名称与说明，右侧控件。labelFor 指向控件 id 时名称是可点的 label；
 * 没有控件的说明行（info）只留文字。
 */
export const row = ({label, desc = '', control = nothing, labelFor = '', labelId = '', descId = '', id = '', cls = '', hidden = false}) => html`<div class="opt-row${cls ? ` ${cls}` : ''}${control === nothing ? ' is-info' : ''}" id=${id || nothing} ?hidden=${hidden}>
<div class="opt-row-text">${labelFor ? html`<label for=${labelFor} class="opt-row-label" id=${labelId || nothing}>${label}</label>` : html`<span class="opt-row-label" id=${labelId || nothing}>${label}</span>`}${desc ? html`<p class="opt-row-desc" id=${descId || nothing}>${desc}</p>` : nothing}</div>
${control === nothing ? nothing : html`<div class="opt-row-control">${control}</div>`}
</div>`;

export const switchRow = (id, label, desc, {checked = false, title = ''} = {}) => row({label, desc, labelFor: id, control: switchControl(id, label, {checked, title})});

// extra.color：选项名前画一个色点（字幕译文颜色）；extra.line：选项名下按该线型画下划线（解构下划线样式）。
const segmentOption = (name, [value, text, extra]) => html`<label class="choice-card-item" style=${extra?.line ? `--sentence-line-style:${extra.line}` : nothing}>
<input type="radio" name=${name} value=${value}>
<div class="choice-card-content"><div class="choice-card-header"><span class="choice-card-title${extra?.line ? ' is-line-sample' : ''}">${extra?.color ? html`<i class="video-color-dot" data-color=${extra.color} aria-hidden="true"></i>` : nothing}${text}</span></div></div>
</label>`;

/** 分段按钮组：options 为 [[value, label, {color, line}?], …]。 */
export const segmentControl = (name, labelledBy, options) => html`<div class="choice-card-grid" role="radiogroup" aria-labelledby=${labelledBy}>${options.map(option => segmentOption(name, option))}</div>`;

export const segmentRow = (name, label, desc, options, {cls = '', id = '', descId = ''} = {}) => row({label, desc, id, descId, cls, labelId: `${name}-label`, control: segmentControl(name, `${name}-label`, options)});

// 原词 / 词注 / 译文三层标注样式：每层两行（样式 + 字号、颜色）。颜色行带 data-reading-layer，控制器把当前色值记在它的 dataset 上。
const LAYER_KEYS = {
  original: {label: 'sec.ap.originalRow', desc: 'sec.ap.originalRowDesc', color: 'sec.ap.originalColor', colorAria: 'sec.ap.origColor', quote: 'sec.ap.optQuote'},
  annotation: {label: 'sec.ap.annotationRow', desc: 'sec.ap.annotationRowDesc', color: 'sec.ap.annotationColor', colorAria: 'sec.ap.annoColor', quote: 'sec.ap.optQuote'},
  translation: {label: 'sec.ap.translationRow', desc: 'sec.ap.translationRowDesc', color: 'sec.ap.translationColor', colorAria: 'sec.ap.transColor', quote: 'sec.ap.optSide'},
};
const LAYER_SIZES = ['80', '100', '115', '130', '150'];
export const readingLayerRows = layer => {
  const keys = LAYER_KEYS[layer];
  const styles = [['default', t('sec.ap.optDefault')], ['plain', t('sec.ap.optPlain')], ['color', t('sec.ap.optColor')], ['dashed', t('sec.ap.optDashed')], ['background', t('sec.ap.optBg')], ['border', t('sec.ap.optBorder')], ['quote', t(keys.quote)]];
  const sizes = LAYER_SIZES.map(size => [size, size === '100' ? t('sec.ap.fsDefault') : `${size}%`]);
  return html`${row({label: t(keys.label), desc: t(keys.desc), labelFor: `reading-${layer}-style`, cls: 'reading-layer-row', control: html`${selectControl(`reading-${layer}-style`, styles, {label: t('sec.ap.style')})}${selectControl(`reading-${layer}-size`, sizes, {narrow: true, label: t('sec.ap.fontSize')})}`})}
<div class="opt-row reading-color-row" data-reading-layer=${layer}>
<div class="opt-row-text"><span class="opt-row-label">${t(keys.color)}</span></div>
<div class="opt-row-control reading-color-field"><div id="reading-${layer}-palette" class="reading-color-presets"></div><label class="reading-custom-color"><span>${t('sec.ap.custom')}</span><input id="reading-${layer}-color" type="color" aria-label=${t(keys.colorAria)}></label></div>
</div>`;
};

/** 标注样式的实时预览与「恢复默认」：iframe 由控制器按 data-layers 写入只含这几层的示例。 */
export const readingPreviewRow = (id, layers, resetId, resetLabel) => html`<div class="opt-row is-block reading-preview-row">
<iframe id=${id} class="reading-style-preview" data-reading-preview data-layers=${layers} title=${t('sec.ap.iframeTitle')} sandbox="allow-same-origin"></iframe>
<div class="reading-preview-foot"><p class="opt-row-desc">${t('sec.ap.previewNote')}</p><button id=${resetId} class="secondary-button" type="button" data-reset-layers=${layers}>${resetLabel}</button></div>
</div>`;

/** 一组设置：组标题 + 一张卡；body 为卡内的若干行。 */
export const group = ({title, body, id = '', cls = '', purpose = ''}) => html`<div class="opt-group${cls ? ` ${cls}` : ''}" id=${id || nothing} data-purpose=${purpose || nothing}>
<div class="opt-group-head"><h2>${title}</h2></div>
<div class="opt-card">${body}</div>
</div>`;

/** 密钥输入框旁的显示/隐藏按钮（点击由 options-app 的 .toggle-password-btn 委托处理）。 */
export const eyeToggle = (target, label) => html`<button type="button" class="toggle-password-btn" data-toggle-target=${target || nothing} title=${label} aria-label=${label}>
<svg class="eye-show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
<svg class="eye-hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" hidden><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
</button>`;
