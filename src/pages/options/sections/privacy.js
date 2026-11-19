/**
 * @file src/pages/options/sections/privacy.js
 * 文件职责：设置页「数据与隐私」分区模板——词档案与备份 / 阅读与提示数据 / 权限与彻底清理三组。
 * 主要内容：无绑定静态模板（动态内容由 options-controller.js 与 history.js 命令式填充），
 *   每个操作占一行：左侧说明影响范围、右侧按钮；清空类操作由控制器二次确认。
 *   导入备份选好文件后展开预览面板（备份内容 + 合并 / 覆盖分段按钮 + 该方式的影响说明），确认后才写入。
 * 模块边界：纯展示模板。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.

 */
import {html} from 'lit';
import {t} from '../../../i18n-runtime.js';
import {segmentControl} from './parts.js';

export const privacySection = html`
<section id="privacy" class="settings-section data-section" aria-labelledby="privacy-heading" hidden="">
      <div class="section-intro"><h2 id="privacy-heading" class="sr-only">${t('sec.privacy.title')}</h2><p>${t('sec.privacy.desc')}</p></div>
      <p id="data-problem" class="notice error" role="alert" hidden=""></p>
      <div class="opt-group">
        <div class="opt-group-head"><h2>${t('sec.privacy.gProfile')}</h2></div>
        <div class="opt-card">
          <div class="opt-row">
            <div class="opt-row-text"><label for="remember-support" class="opt-row-label">${t('sec.privacy.remember')}</label><p class="opt-row-desc">${t('sec.privacy.rememberDesc')}</p></div>
            <div class="opt-row-control"><label class="switch"><input id="remember-support" type="checkbox"><span aria-hidden="true"></span><span class="sr-only">${t('sec.privacy.remember')}</span></label></div>
          </div>
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.export')}</span><p class="opt-row-desc">${t('sec.privacy.exportDesc')}</p><span id="data-result" class="inline-message" aria-live="polite"></span></div>
            <div class="opt-row-control"><button id="export-data" class="secondary-button" type="button">${t('sec.privacy.exportBtn')}</button></div>
          </div>
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.import')}</span><p class="opt-row-desc">${t('sec.privacy.importDesc')}</p><span id="import-result" class="inline-message" aria-live="polite"></span></div>
            <div class="opt-row-control"><button id="import-data" class="secondary-button" type="button">${t('sec.privacy.importBtn')}</button><input id="import-file" type="file" accept=".json,application/json" hidden></div>
          </div>
          <div id="import-panel" class="opt-row is-block import-panel" hidden>
            <p id="import-summary" class="import-summary"></p>
            <div class="import-mode"><span id="import-mode-label" class="import-mode-title">${t('sec.privacy.importMode')}</span>${segmentControl('import-mode', 'import-mode-label', [['merge', t('sec.privacy.importMerge')], ['replace', t('sec.privacy.importReplace')]])}</div>
            <p id="import-mode-desc" class="opt-row-desc" aria-live="polite"></p>
            <div class="import-actions"><button id="import-confirm" class="primary-action" type="button">${t('sec.privacy.importConfirm')}</button><button id="import-cancel" class="secondary-button" type="button">${t('common.cancel')}</button></div>
          </div>
        </div>
      </div>
      <div class="opt-group history-data-actions">
        <div class="opt-group-head"><h2>${t('sec.privacy.dataTitle')}</h2><p>${t('sec.privacy.dataDesc')}</p></div>
        <div class="opt-card">
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.exportHistory')}</span><p class="opt-row-desc">${t('sec.privacy.exportHistoryDesc')}</p></div>
            <div class="opt-row-control"><button id="history-export" class="secondary-button" type="button">${t('sec.privacy.exportBtn')}</button></div>
          </div>
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.clearHistory')}</span><p class="opt-row-desc">${t('sec.privacy.clearNote')}</p><span id="history-action-result" class="inline-message" aria-live="polite"></span></div>
            <div class="opt-row-control"><button id="history-clear" class="danger-button" type="button">${t('sec.privacy.clearBtn')}</button></div>
          </div>
        </div>
      </div>
      <div class="opt-group">
        <div class="opt-group-head"><h2>${t('sec.privacy.gDanger')}</h2></div>
        <div class="opt-card">
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.reset')}</span><p class="opt-row-desc">${t('sec.privacy.resetDesc')}</p></div>
            <div class="opt-row-control"><button id="reset-config" class="secondary-button" type="button">${t('sec.privacy.resetBtn')}</button></div>
          </div>
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.perms')}</span><p class="opt-row-desc">${t('sec.privacy.permsDesc')}</p></div>
            <div class="opt-row-control"><button id="open-extension-manager" class="secondary-button" type="button">${t('sec.privacy.openMgr')}</button></div>
          </div>
          <div class="opt-row">
            <div class="opt-row-text"><span class="opt-row-label">${t('sec.privacy.clearAll')}</span><p class="opt-row-desc">${t('sec.privacy.clearAllDesc')}</p></div>
            <div class="opt-row-control"><button id="clear-memory" class="danger-button" type="button">${t('sec.privacy.clearAllBtn')}</button></div>
          </div>
        </div>
      </div>
</section>
`;
