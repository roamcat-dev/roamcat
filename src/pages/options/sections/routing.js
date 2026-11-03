/**
 * @file src/pages/options/sections/routing.js
 * 文件职责：设置页「模型服务 · 任务分配」分区模板：各场景用哪个翻译引擎、各大模型任务交给哪个自备 API 服务。
 * 主要内容：无绑定静态模板——翻译引擎下拉由 options-mt.js 填充并保存（translationEngines、mtFallback），
 *   大模型任务下拉由 options-controller.js 的 optionsRenderRouting 填充（apiRouting）；分配是全局设置，不随所选服务变化。
 *   原先挂在服务目录最下方，现单独成一个标签页；旧锚点 #task-assignment 重定向到这里。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {row, selectControl, switchRow} from './parts.js';

const routeRow = (id, labelKey) => row({label: t(labelKey), labelFor: id, cls: 'route-row', control: selectControl(id)});

export const routingSection = html`
<section id="routing" class="settings-section" aria-labelledby="routing-heading" hidden="">
<h2 id="routing-heading" class="sr-only">${t('opt.tab.routing')}</h2>
<div id="task-assignment" class="task-assignment">
<div id="translation-engines" class="opt-group" role="group" aria-labelledby="translation-engines-title">
<div class="opt-group-head"><h2 id="translation-engines-title">${t('sec.svc.mt.engines')}</h2></div>
<div class="opt-card">
<p class="opt-card-note">${t('sec.svc.mt.enginesNote')}</p>
${routeRow('engine-page', 'sec.svc.mt.scenePage')}
${routeRow('engine-passage', 'sec.svc.mt.scenePassage')}
${routeRow('engine-video', 'sec.svc.mt.sceneVideo')}
${routeRow('engine-liveChat', 'sec.svc.mt.sceneLiveChat')}
${routeRow('engine-reader', 'sec.svc.mt.sceneReader')}
${switchRow('mt-fallback', t('sec.svc.mt.fallback'), t('sec.svc.mt.fallbackNote'))}
</div>
</div>
<div id="api-routing" class="opt-group" role="group" aria-labelledby="api-routing-title">
<div class="opt-group-head"><h2 id="api-routing-title">${t('sec.svc.routing')}</h2></div>
<div class="opt-card">
<p class="opt-card-note">${t('sec.svc.routingNote')}</p>
<p id="api-routing-empty" class="opt-card-note task-routing-empty" hidden="">${t('sec.svc.routingEmpty')}</p>
${routeRow('route-assist', 'sec.svc.routeAssist')}
${routeRow('route-support', 'sec.svc.routeSupport')}
${routeRow('route-groups', 'sec.svc.routeGroups')}
${routeRow('route-summary', 'sec.svc.routeSummary')}
${routeRow('route-translate', 'sec.svc.routeTranslate')}
</div>
</div>
</div>
</section>
`;
