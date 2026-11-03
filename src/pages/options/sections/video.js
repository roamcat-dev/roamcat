/**
 * @file src/pages/options/sections/video.js
 * 文件职责：设置页「视频与直播」分区静态模板——YouTube 播放器入口与双语字幕、字幕样式（含仿播放画面的预览）、
 *   云端听写说明与当前订阅状态、Twitch 直播聊天翻译，集中在一处。
 * 主要内容：无绑定静态模板；控件值、预览与听写状态由 options-controller.js 的 optionsRenderVideo 填充，
 *   字幕样式与播放器「字幕设置」菜单读写同一份 settings.video（VIDEO_SETTINGS_PATCH），入口开关走 AUTOMATION_PATCH。
 *   单句循环、每句暂停、影院模式只对当前视频生效，仍只在播放器菜单里。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {row, segmentRow, selectControl, switchRow} from './parts.js';

export const videoSection = html`
<section id="video" class="settings-section" aria-labelledby="video-heading" hidden="">
<h2 id="video-heading" class="sr-only">${t('sec.video.title')}</h2>
<div class="opt-group">
<div class="opt-group-head"><h2>${t('sec.video.gYoutube')}</h2></div>
<div class="opt-card">
${switchRow('automation-video-sites', t('sec.video.entry'), t('sec.video.entryDesc'))}
${switchRow('video-bilingual', t('sec.video.bilingual'), t('sec.video.bilingualDesc'))}
</div>
</div>
<div class="opt-group">
<div class="opt-group-head"><h2>${t('sec.video.gStyle')}</h2></div>
<div class="opt-card">
<div class="opt-row is-block video-preview-row">
<div id="video-caption-preview" class="video-caption-preview" aria-label=${t('sec.video.preview')} role="img">
<div class="vcp-stack">
<p class="vcp-line vcp-translation"><span>${t('sec.video.sampleTranslation')}</span></p>
<p class="vcp-line vcp-original"><span><b data-said>A</b> <b data-said>little</b> <b data-now>help</b> <b>can</b> <b>make</b> <b>a</b> <b class="vcp-hard">difficult</b> <b>sentence</b> <b>clear.</b></span></p>
</div>
</div>
<p class="opt-row-desc video-preview-note">${t('sec.video.previewNote')}</p>
</div>
${segmentRow('video-display', t('sec.video.display'), '', [['bilingual', t('vid.mBilingual')], ['original', t('vid.mOriginal')], ['translation', t('vid.mTranslation')]])}
${segmentRow('video-translation-first', t('sec.video.order'), '', [['true', t('vid.mAbove')], ['false', t('vid.mBelow')]])}
${segmentRow('video-translation-color', t('sec.video.color'), '', [['white', t('vid.mWhite'), {color: 'white'}], ['yellow', t('vid.mYellow'), {color: 'yellow'}], ['cyan', t('vid.mCyan'), {color: 'cyan'}]])}
${segmentRow('video-font-size', t('sec.video.size'), t('sec.video.sizeDesc'), [['16', t('vid.mSizeS')], ['20', t('vid.mSizeM')], ['24', t('vid.mSizeL')], ['28', t('vid.mSizeXL')]])}
${switchRow('video-karaoke', t('vid.mKaraoke'), t('sec.video.karaokeDesc'))}
${switchRow('video-blur', t('vid.mBlur'), t('sec.video.blurDesc'))}
${row({label: t('sec.video.theme'), desc: t('sec.video.themeDesc'), labelFor: 'video-theme', control: selectControl('video-theme', [['auto', t('opt.themeAuto')], ['light', t('opt.themeLight')], ['dark', t('opt.themeDark')]], {narrow: true})})}
${row({label: t('sec.video.offset'), desc: t('sec.video.offsetDesc'), id: 'video-offset-row', hidden: true, control: html`<button id="video-reset-offset" class="secondary-button" type="button">${t('vid.mResetPosition')}</button>`})}
</div>
</div>
<div class="opt-group">
<div class="opt-group-head"><h2>${t('sec.video.gDictation')}</h2></div>
<div class="opt-card">
${row({label: t('sec.video.dictationService'), desc: ' ', descId: 'video-dictation-status', control: html`<a class="text-link-button" href="#service">${t('sec.video.toService')}</a>`})}
${row({label: t('sec.video.dictationHow'), desc: t('sec.video.dictationHowDesc')})}
${row({label: t('sec.video.dictationData'), desc: t('sec.video.dictationDataDesc')})}
</div>
</div>
<div class="opt-group">
<div class="opt-group-head"><h2>${t('sec.video.gLive')}</h2></div>
<div class="opt-card">
${switchRow('video-live-chat', t('sec.video.liveChat'), t('sec.video.liveChatDesc'))}
${row({label: t('sec.video.liveLimits'), desc: t('sec.video.liveLimitsDesc')})}
</div>
</div>
</section>
`;
