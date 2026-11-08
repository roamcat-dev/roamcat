/**
 * @file src/pages/reader/reader-app.js
 * 文件职责：PDF/EPUB 阅读器——解包为阅读块流、侧栏目录导航（高亮当前章节）、按批次调用 READER_TRANSLATE
 *   做块级双语翻译；本地文件经文件选择器、远程 PDF 经 ?src= 参数与导航重定向进入。
 * 主要内容：按需 loadPdf（pdfjs worker + 首批正文渐进显示）、loadEpub（独立解析线程）、80 块分页、translationBatches
 *   与后台 normalizeEmergencyItems 契约一致（1–4 项 / ≤12000 字符）。
 * 模块边界：扩展页受信上下文；文档内容只经 request() 交给既有翻译管线，
 *   不自行访问模型、不落盘（翻译结果随页面会话存续）。
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import {LitElement, html, nothing} from 'lit';
import {request} from '@ext/shared.js';
import {loadEpub} from './epub-loader.js';
import {joinTranslationParts, translationBatches} from './pdf-blocks.mjs';
import {heroArt} from '../../components/hero-art.js';
import {icon} from '../../components/icons.js';
import '../../components/rc-switch.js';
import {t, onUiLangChange} from '../../i18n-runtime.js';

const ENGLISH_RE = /[A-Za-z]/u;
const PAGE_BLOCKS=80,MAX_FILE_BYTES=64*1024*1024;
const MAX_FAILED_BATCHES = 3;
const PIN_RELEASE_EVENTS = ['wheel', 'keydown', 'touchstart', 'pointerdown'];
// 鉴权失败、额度用完、服务没连上：换哪一批都一样失败，整本书立即停下，提示检查密钥或登录。
const STOP_CODES = new Set(['AUTH', 'QUOTA', 'NOT_READY', 'SERVICE_AUTH', 'STDERR_AUTH']);
// 只有结果格式、条目对不上这类问题才拆成单条重试（模型偶发漏条、夹杂格式）；限流、超时、网络故障拆开只会多发请求，按批记失败。
const SPLIT_CODES = new Set(['UNKNOWN', 'OUTPUT_INVALID', 'JSON_INVALID', 'BATCH_SHAPE', 'BATCH_COUNT', 'ITEM_FIELDS', 'ITEM_ID', 'ITEM_DUPLICATE', 'TRANSLATION_TYPE', 'TRANSLATION_EMPTY', 'TRANSLATION_WHITESPACE', 'TRANSLATION_LENGTH', 'TRANSLATION_NO_HAN']);
const stopsTranslation = error => STOP_CODES.has(error?.code);
const splitsBatch = error => !error?.code || SPLIT_CODES.has(error.code);

export class RoamcatReader extends LitElement {
  static properties = {
    view: {state: true},
    error: {state: true},
    remoteUrl: {state: true},
    remoteStatus: {state: true},
    title: {state: true},
    kind: {state: true},
    sidebar: {state: true},
    blocks: {state: true},
    translations: {state: true},
    bilingual: {state: true},
    progress: {state: true},
    translating: {state: true},
    parsing: {state: true},
    pageIndex: {state: true},
    currentAnchor: {state: true}
  };
  createRenderRoot() { return this; }
  constructor() {
    super();
    this.view = 'empty';
    this.error = '';
    this.remoteUrl = '';
    this.remoteStatus = null;
    this.title = '';
    this.kind = '';
    this.sidebar = [];
    this.blocks = [];
    this.translations = new Map();
    this._translationParts = new Map();
    this.bilingual = true;
    this.progress = '';
    this.parsing=false;
    this._nextId = 1;
    this.pageIndex=0;this._openId=0;
    this.currentAnchor = '';
  }

  firstUpdated() {
    const src = new URLSearchParams(location.search).get('src');
    if (src) void this.openRemote(src);
  }

  updated(changed) {
    if (changed.has('blocks') || changed.has('pageIndex') || changed.has('view')) this.#syncCurrentSection();
    if (changed.has('currentAnchor')) this.#revealCurrentSection();
  }

  // 目录栏吸顶位置与章节锚点的滚动偏移跟着工具栏实际高度走：窄屏换行、出现翻译报错时工具栏会变高。
  #observeToolbar() {
    const toolbar = this.querySelector('.reader-toolbar');
    if (!toolbar || this._toolbarObserver) return;
    this._toolbarObserver = new ResizeObserver(() => {
      this._toolbarHeight = toolbar.offsetHeight;
      this.style.setProperty('--reader-toolbar-h', this._toolbarHeight + 'px');
    });
    this._toolbarObserver.observe(toolbar);
  }

  #onScroll = () => {
    if (this._scrollFrame) return;
    this._scrollFrame = requestAnimationFrame(() => { this._scrollFrame = 0; this.#syncCurrentSection(); });
  };
  // 从目录跳转后钉住那一章：平滑滚动途中不在经过的章节间闪烁，结尾太短、滚不到阅读线的章节也能高亮。
  // 读者自己滚动（滚轮、按键、触摸、点按）时松开；拖滚动条滚完、那一章已不在视口里时也松开。
  #releasePin = () => { this._pinnedAnchor = ''; };
  #onScrollEnd = () => {
    if (!this._pinnedAnchor) return;
    const top = this.querySelector('#' + CSS.escape(this._pinnedAnchor))?.getBoundingClientRect().top;
    if (top === undefined || top < (this._toolbarHeight || 0) || top >= innerHeight) { this._pinnedAnchor = ''; this.#syncCurrentSection(); }
  };

  // 当前章节 = 工具栏下方阅读线以上的最后一个章节锚点；滚到底时阅读线放到视口底部（取最后露出来的那一章）；
  // 本分页里还没读到锚点时，沿用前面分页最后开始的那一章。
  #syncCurrentSection() {
    if (this.view !== 'ready' || !this.sidebar.length) return;
    const atBottom = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const line = atBottom ? innerHeight : (this._toolbarHeight || 0) + innerHeight * 0.25;
    if (this._pinnedAnchor && !this.querySelector('#' + CSS.escape(this._pinnedAnchor))) this._pinnedAnchor = '';
    let current = this._pinnedAnchor || '';
    if (!current) for (const anchor of this.querySelectorAll('.reader-flow .reader-anchor')) {
      if (anchor.getBoundingClientRect().top >= line) break;
      current = anchor.id;
    }
    for (let index = this.pageIndex * PAGE_BLOCKS - 1; !current && index >= 0; index--) current = this.blocks[index]?.anchor || '';
    current ||= this.sidebar[0].anchor;
    if (current !== this.currentAnchor) this.currentAnchor = current;
  }

  // 目录很长时，让高亮的那一项留在目录栏可见范围内（只滚目录栏，不动正文）。
  #revealCurrentSection() {
    const nav = this.querySelector('.reader-sidebar'), item = nav?.querySelector('[aria-current]');
    if (!item) return;
    if (item.offsetTop < nav.scrollTop) nav.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = item.offsetTop + item.offsetHeight - nav.clientHeight;
  }

  async openRemote(url, {withCredentials = false} = {}) {
    const opening=this.beginOpen();
    this.view = 'loading';
    this.progress = t('rd.downloading');
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(t('rd.unsupported'));
      url = parsed.href;
      this.remoteUrl = url;
      // 默认匿名下载；读者明确选择后才使用原站登录态，带凭据时不跟随重定向。
      const response = await fetch(url, {credentials: withCredentials ? 'include' : 'omit',redirect: withCredentials ? 'error' : 'follow',signal:opening.signal});
      this.remoteStatus = response.status;
      if (!response.ok) throw new Error(t('rd.dlFail',{status:response.status}));
      if(Number(response.headers.get('Content-Length'))>MAX_FILE_BYTES){await response.body?.cancel();throw new Error(t('rd.tooLarge'));}
      const chunks=[];let size=0;const stream=response.body?.getReader();
      if(stream){try{for(;;){const {done,value}=await stream.read();if(done)break;size+=value.length;if(size>MAX_FILE_BYTES){await stream.cancel();throw new Error(t('rd.tooLarge'));}chunks.push(value);}}finally{stream.releaseLock();}}
      else chunks.push(new Uint8Array(await response.arrayBuffer()));
      const data=new Uint8Array(stream?size:chunks[0].length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
      let name = new URL(url).pathname.split('/').at(-1) || 'document.pdf';
      try { name = decodeURIComponent(name); } catch { /* 裸百分号文件名不影响已下载的文档内容。 */ }
      if(opening.id!==this._openId)return;await this.openData(data, name,opening);
    } catch (error) {
      if(opening.id!==this._openId||error?.name==='AbortError')return;
      if (this.remoteStatus === null) this.remoteStatus = 0;
      this.error = t('rd.remoteFail',{err:error?.message || error});
      this.view = 'error';
      this.parsing=false;
      this.progress = '';
    }
  }

  async openFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const opening=this.beginOpen();
    this.view = 'loading';
    this.progress = t('rd.reading');
    try {
      if(file.size>MAX_FILE_BYTES)throw new Error(t('rd.tooLarge'));
      const data=new Uint8Array(await file.arrayBuffer());if(opening.id!==this._openId)return;await this.openData(data, file.name,opening);
    } catch (error) {
      if(opening.id!==this._openId||error?.name==='AbortError')return;
      this.error = t('rd.openFail',{err:error?.message || error});
      this.view = 'error';
      this.parsing=false;
      this.progress = '';
    }
  }

  beginOpen(){this._translationProgressCleanup?.();this._loadController?.abort();this._loadController=new AbortController();this._translationParts.clear();this.translating=false;this.parsing=true;this.pageIndex=0;this.error='';this.remoteUrl='';this.remoteStatus=null;return {id:++this._openId,signal:this._loadController.signal};}
  // 在别的扩展页切换语言：按新语言重渲染，不重载，已打开的文档与译文保留。
  connectedCallback(){
    super.connectedCallback();this._offLang=onUiLangChange(()=>this.requestUpdate());
    addEventListener('scroll',this.#onScroll,{passive:true});addEventListener('scrollend',this.#onScrollEnd);
    for(const type of PIN_RELEASE_EVENTS)addEventListener(type,this.#releasePin,{passive:true,capture:true});
    void this.updateComplete.then(()=>{if(this.isConnected)this.#observeToolbar();});
  }
  disconnectedCallback(){
    this._translationProgressCleanup?.();this._loadController?.abort();this._openId++;this._offLang?.();
    removeEventListener('scroll',this.#onScroll);removeEventListener('scrollend',this.#onScrollEnd);
    for(const type of PIN_RELEASE_EVENTS)removeEventListener(type,this.#releasePin,{capture:true});cancelAnimationFrame(this._scrollFrame);this._scrollFrame=0;
    this._toolbarObserver?.disconnect();this._toolbarObserver=null;
    super.disconnectedCallback();
  }
  async openData(data, name,opening=this.beginOpen()) {
    this.blocks = [];
    this.translations = new Map();
    if (data.length > MAX_FILE_BYTES) throw new Error(t('rd.tooLarge'));
    const isPdf = data.length > 4 && data[0] === 0x25 && data[1] === 0x50; // %PDF
    const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b; // PK
    if (isPdf || /\.pdf$/iu.test(name)) return this.openPdf(data, name,opening);
    if (isZip || /\.epub$/iu.test(name)) return this.openEpub(data, name,opening);
    throw new Error(t('rd.unsupported'));
  }

  async openPdf(data, name,opening) {
    const {loadPdf}=await import('./pdf-loader.js');if(opening.id!==this._openId)return;
    const sidebar = [], blocks = [];let lastPublish=0;
    const pdf = await loadPdf({data, name},undefined,{signal:opening.signal,onPage:(page,total)=>{
      if(opening.id!==this._openId)return;
      const anchor = 'sec-p' + page.number;
      sidebar.push({anchor, label: t('rd.pageN',{n:page.number})});
      for (const [index,block] of page.blocks.entries()) {
        blocks.push({id: 'b' + this._nextId++, anchor: index === 0 ? anchor : '', ...block});
      }
      const now=performance.now();
      if(blocks.length&&(this.view!=='ready'||now-lastPublish>=120||page.number===total)){
        lastPublish=now;this.title=name;this.kind='pdf';this.sidebar=[...sidebar];this.blocks=[...blocks];this.view='ready';this.progress=t('rd.parsingPdf',{done:page.number,total});
      }
    }});
    if(opening.id!==this._openId)return;
    const currentPage=this.pageIndex;
    this.finishLoad(pdf.title, 'pdf', sidebar, blocks);
    this.pageIndex=currentPage;
  }

  async openEpub(data, name,opening) {
    this.progress = t('rd.parsingEpub');
    const book = await loadEpub(data,{signal:opening.signal});
    if(opening.id!==this._openId)return;
    const sidebar = [], blocks = [];
    book.chapters.forEach((chapter, index) => {
      const anchor = 'sec-c' + index;
      sidebar.push({anchor, label: chapter.label});
      chapter.blocks.forEach((block, offset) => {
        blocks.push({id: 'b' + this._nextId++, anchor: offset === 0 ? anchor : '', ...block});
      });
    });
    this.finishLoad(book.title + (book.creator ? ' · ' + book.creator : ''), 'epub', sidebar, blocks);
  }

  finishLoad(title, kind, sidebar, blocks) {
    this.parsing=false;
    this.pageIndex=0;
    this.progress = '';
    if (!blocks.length) { this.error = t('rd.noText'); this.view = 'error'; return; }
    this.title = title;
    this.kind = kind;
    this.sidebar = sidebar;
    this.blocks = blocks;
    this.view = 'ready';
    document.title = title + ' · ' + t('rd.reader');
  }

  async translateAll() {
    if(this.parsing||this.translating)return;
    const opening=this._openId;
    const pending = this.blocks.filter(block => ENGLISH_RE.test(block.text) && !this.translations.has(block.id));
    const planned = translationBatches(pending);
    const groups = new Map(), owners = new Map();
    for (const chunk of planned.flat()) {
      if (!groups.has(chunk.blockId)) groups.set(chunk.blockId, []);
      groups.get(chunk.blockId)[chunk.part] = chunk.id;
      owners.set(chunk.id, chunk.blockId);
    }
    const batches = planned.map(batch => batch.filter(chunk => !this._translationParts.has(chunk.id))).filter(batch => batch.length);
    if (!batches.length) return;
    this.error = '';
    this.translating = true;
    let done = 0;
    const accept=items=>{
      if(opening!==this._openId)return;
      let changed=false;
      for(const item of items){
        const blockId=owners.get(item?.id);
        if(!blockId||this.translations.has(blockId)||typeof item.translation!=='string'||!item.translation.trim())continue;
        if(this._translationParts.get(item.id)===item.translation)continue;
        this._translationParts.set(item.id,item.translation);changed=true;
        const parts=groups.get(blockId);
        if(parts.every(id=>this._translationParts.has(id))){
          this.translations.set(blockId,joinTranslationParts(parts.map(id=>this._translationParts.get(id))));
          for(const id of parts)this._translationParts.delete(id);
        }
      }
      if(changed)this.requestUpdate();
    };
    const flights=new Map();
    const receive=(message,sender)=>{
      if(sender.id!==chrome.runtime.id||sender.tab||message?.type!=='SS_READER_TRANSLATION_PROGRESS'||!Array.isArray(message.items))return;
      const ids=flights.get(message.requestId);
      if(ids)accept(message.items.filter(item=>ids.has(item?.id)));
    };
    chrome.runtime.onMessage.addListener(receive);
    const cleanup=()=>{chrome.runtime.onMessage.removeListener(receive);flights.clear();if(this._translationProgressCleanup===cleanup)this._translationProgressCleanup=null;};
    this._translationProgressCleanup=cleanup;
    const translate=async items=>{
      const requestId='reader-'+crypto.randomUUID();
      flights.set(requestId,new Set(items.map(item=>item.id)));
      try{return await request('READER_TRANSLATE',{requestId,items});}
      finally{flights.delete(requestId);}
    };
    try {
      // 两路并发：与后台每个服务默认的 2 个并发名额对齐，按文档顺序取批。
      // 单批失败继续；连续三批没有得到任何译文时停止，避免服务不可用时整本书反复请求；鉴权/额度类错误一次就停。
      // 结束后再报错，再点一次只补翻没译出的段落。
      let next = 0, failed = null, failuresWithoutProgress = 0, stopped = false;
      this.progress = t('rd.translating',{done,total:batches.length});
      const worker = async () => {
        while (next < batches.length&&opening===this._openId&&!stopped&&failuresWithoutProgress<MAX_FAILED_BATCHES) {
          const batch = batches[next++];
          try {
            // 模型偶发漏条/夹杂格式时整批被校验拒收：拆成单条逐个重试，一条坏数据不拖累同批其余段落。
            const payload = batch.map(({id, text}) => ({id, text}));
            let items;
            try {
              const result = await translate(payload);
              items = result.items || [];
            } catch (error) {
              if (batch.length === 1 || opening !== this._openId || stopped || !splitsBatch(error)) throw error;
              const singles = await Promise.allSettled(payload.map(item => translate([item])));
              const ok = singles.filter(single => single.status === 'fulfilled').flatMap(single => single.value.items || []);
              const rejected = singles.filter(single => single.status === 'rejected').map(single => single.reason);
              const fatal = rejected.find(stopsTranslation);
              if (fatal) { stopped = true; failed = fatal; }
              else if (ok.length < batch.length) failed ??= rejected[0] || error;
              items = ok;
            }
            if(opening!==this._openId)return;
            failuresWithoutProgress = items.length ? 0 : failuresWithoutProgress + 1;
            accept(items);
            done += 1;
            this.progress = t('rd.translating',{done,total:batches.length});
          } catch (error) {
            if (stopsTranslation(error)) { if (!stopped) failed = error; stopped = true; }
            else failed ??= error;
            failuresWithoutProgress++;
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if(opening!==this._openId)return;
      if (failed) throw failed;
      this.progress = t('rd.transDone');
    } catch (error) {
      if(opening!==this._openId)return;
      this.progress = '';
      this.error = t('rd.transFail',{err:error?.message || error});
    } finally {
      cleanup();
      if(opening===this._openId){this.translating = false;
      setTimeout(() => { if (opening===this._openId&&this.progress === t('rd.transDone')) this.progress = ''; }, 2000);}
    }
  }

  async scrollTo(anchor) {
    const index=this.blocks.findIndex(block=>block.anchor===anchor);if(index<0)return;
    this.pageIndex=Math.floor(index/PAGE_BLOCKS);this._pinnedAnchor=anchor;this.currentAnchor=anchor;await this.updateComplete;
    this.querySelector('#' + anchor)?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }
  async changePage(index){this._pinnedAnchor='';this.pageIndex=Math.max(0,Math.min(Math.ceil(this.blocks.length/PAGE_BLOCKS)-1,index));await this.updateComplete;this.querySelector('.reader-flow')?.scrollIntoView({block:'start'});}
  renderPager(){const pages=Math.ceil(this.blocks.length/PAGE_BLOCKS);if(pages<2)return '';return html`<nav class="reader-pager" aria-label=${t('rd.pagination')}><button class="rc-button" ?disabled=${this.pageIndex===0} @click=${()=>this.changePage(this.pageIndex-1)}>${t('rd.previous')}</button><span role="status">${t('rd.pageOf',{current:this.pageIndex+1,total:pages})}</span><button class="rc-button" ?disabled=${this.pageIndex>=pages-1} @click=${()=>this.changePage(this.pageIndex+1)}>${t('rd.next')}</button></nav>`;}

  openFilePicker() {
    this.querySelector('#reader-file')?.click();
  }

  async openOriginal() {
    try { await request('READER_OPEN_ORIGINAL', {url: this.remoteUrl}); }
    catch (error) { this.error = t('rd.remoteFail', {err: error?.message || error}); }
  }

  #langName() {
    const pref = globalThis.RoamCatI18n?.pref?.() || 'auto';
    return t(`common.lang${pref === 'auto' ? 'Auto' : pref === 'zh' ? 'Zh' : 'En'}`);
  }

  #langShort() {
    const pref = globalThis.RoamCatI18n?.pref?.() || 'auto';
    return t(pref === 'auto' ? 'pop.langAuto' : pref === 'zh' ? 'pop.langZh' : 'pop.langEn');
  }

  #cycleUiLang() {
    const i18n = globalThis.RoamCatI18n;
    if (!i18n) return;
    const order = ['auto', 'zh', 'en'];
    i18n.setPref(order[(order.indexOf(i18n.pref()) + 1) % order.length]);
    this.requestUpdate();
  }

  render() {
    // 只有权限错误（401/403）、拿不到状态码的网络错误，或下载成功却解析失败（常见于被重定向到登录页）才可能和登录有关；
    // 404、5xx 这类错误提示链接可能失效，不引导去用登录状态重试。
    const loginLikely = Boolean(this.remoteUrl) && !(this.remoteStatus >= 400 && ![401, 403].includes(this.remoteStatus));
    return html`
      <div class="reader-shell">
        <header class="reader-toolbar">
          <div class="reader-brand">
            <span class="reader-logo">RoamCat</span>
            <span class="reader-title" title=${this.title}>${this.title || t('rd.defTitle')}</span>
          </div>
          <div class="reader-actions">
            ${this.progress ? html`<span class="reader-progress">${this.progress}</span>` : ''}
            ${this.view === 'ready' ? html`
              <span class="reader-bilingual">
                <rc-switch id="reader-bilingual" .checked=${this.bilingual} label=${t('rd.bilingual')} @change=${event => { this.bilingual = event.target.checked; }}></rc-switch>
                <span aria-hidden="true" @click=${() => this.querySelector('#reader-bilingual input')?.click()}>${t('rd.bilingual')}</span>
              </span>
              <button class="rc-button rc-primary" ?disabled=${this.translating||this.parsing} @click=${this.translateAll}>${this.translating ? t('rd.translatingBtn') : t('rd.transAll')}</button>
            ` : ''}
            <button class="rc-button" @click=${this.openFilePicker}>${t('rd.open')}</button>
            <button class="rc-button rc-button-icon" type="button" title=${t('opt.langToggleTitle',{lang:this.#langName()})} aria-label=${t('opt.langToggleTitle',{lang:this.#langName()})} @click=${() => this.#cycleUiLang()}>${icon('globe', {size: 15})}<span>${this.#langShort()}</span></button>
            <button class="rc-button" type="button" @click=${() => { request('OPEN_OPTIONS').catch(() => chrome.runtime.openOptionsPage()); }}>${t('rd.settings')}</button>
          </div>
          ${this.view === 'ready' && this.error ? html`<p class="reader-translation-error" role="alert">${this.error}</p>` : ''}
        </header>
        <input id="reader-file" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden @change=${this.openFile}>
        ${this.view === 'empty' ? this.renderEmpty() : ''}
        ${this.view === 'loading' ? html`<main class="reader-main"><div class="reader-status-card">${this.progress}</div></main>` : ''}
        ${this.view === 'error' ? html`
          <main class="reader-main">
            <div class="reader-status-card reader-error">
              <p role="alert">${this.error}</p>
              <div class="reader-error-actions">
                ${loginLikely ? html`<button class="rc-button rc-primary" data-reader-action="retry-login" @click=${() => this.openRemote(this.remoteUrl, {withCredentials:true})}>${t('rd.retryLogin')}</button>` : ''}
                ${this.remoteUrl ? html`<button class=${loginLikely ? 'rc-button' : 'rc-button rc-primary'} data-reader-action="open-original" @click=${this.openOriginal}>${t('rd.openOriginal')}</button>` : ''}
                <button class="rc-button" @click=${this.openFilePicker}>${t('rd.repick')}</button>
              </div>
              ${this.remoteUrl ? html`<p class="reader-hint">${loginLikely ? t('rd.loginHint') : t('rd.httpHint')}</p>` : ''}
            </div>
          </main>` : ''}
        ${this.view === 'ready' ? this.renderDoc() : ''}
      </div>`;
  }

  renderEmpty() {
    return html`
      <main class="reader-main">
        <div class="reader-status-card">
          <div class="reader-hero-art" aria-hidden="true">${heroArt()}</div>
          <h1>${t('rd.heroTitle')}</h1>
          <p>${t('rd.heroDesc')}</p>
          <div class="reader-format-chips" aria-hidden="true"><span>PDF</span><span>EPUB</span><span>${t('rd.chipBilingual')}</span></div>
          <button class="rc-button rc-primary" @click=${this.openFilePicker}>${t('rd.open')}</button>
          <p class="reader-hint">${t('rd.heroHint')}</p>
        </div>
      </main>`;
  }

  renderDoc() {
    return html`
      <div class="reader-body">
        <nav class="reader-sidebar" aria-label=${t('rd.toc')}>
          ${this.sidebar.map(item => html`
            <button class="reader-nav-item" aria-current=${item.anchor === this.currentAnchor ? 'location' : nothing} @click=${() => this.scrollTo(item.anchor)} title=${item.label}>${item.label}</button>`)}
        </nav>
        <main class="reader-flow">
          ${this.renderPager()}
          ${this.blocks.slice(this.pageIndex*PAGE_BLOCKS,(this.pageIndex+1)*PAGE_BLOCKS).map(block => html`
            ${block.anchor ? html`<span id=${block.anchor} class="reader-anchor"></span>` : ''}
            <p class="reader-block reader-role-${block.role || 'p'}" lang="en">${block.text}</p>
            ${this.bilingual && this.translations.has(block.id) ? html`
              <p class="reader-translation" lang="zh-CN">${this.translations.get(block.id)}</p>` : ''}`)}
          ${this.renderPager()}
        </main>
      </div>`;
  }
}

customElements.define('roamcat-reader', RoamcatReader);
