(function(){
'use strict';

const i18n=window.nonoI18n;
const tr=(key,values)=>i18n?.t(key,values)||key;
const resultError=(result,fallbackKey='common.unknownError')=>{
  if(result?.errorKey) return tr(result.errorKey,result.errorValues);
  return String(result?.error||'').trim()||tr(fallbackKey);
};
const storedErrorText=value=>{
  if(value?.lastErrorKey) return tr(value.lastErrorKey,value.lastErrorValues);
  return String(value?.lastError||'').trim();
};

/* ════════ localStorage key migration (one-time) ════════ */
(function(){
  var _m={
    'apk':'nono_config',
    'naonao_bodydouble':'nono_bd',
    'naonao_freezer':'nono_freezer',
    'naonao_mood':'nono_mood',
    'zt_task':'nono_task',
    'zt_lastActivity':'nono_last_activity',
    'petQuiet':'nono_pet_quiet',
    'zt_tasks_v1':'nono_tasks',
    'naonao_stats':'nono_stats',
    'naonao_onboarding_done':'nono_onboarding_done',
  };
  var _done=localStorage.getItem('nono_migrated_v1');
  if(!_done){
    try{
      Object.keys(_m).forEach(function(oldK){
        var newK=_m[oldK];
        var v=localStorage.getItem(oldK);
        if(v!==null&&localStorage.getItem(newK)===null){
          localStorage.setItem(newK,v);
        }
      });
      localStorage.setItem('nono_migrated_v1','1');
    }catch(e){console.error('key migration failed:',e)}
  }
})();


/* ── sparkles ── */
[[10,12],[85,8],[5,55],[92,40],[15,80],[78,85],[50,5],[35,92],[68,15],[22,68]]
.forEach(([x,y])=>{
  const s=document.createElement('div');s.className='sp';
  s.style.cssText=`left:${x}%;top:${y}%;--d:${2.4+Math.random()*2.6}s;--dl:${Math.random()*3}s`;
  document.getElementById('sparkles').appendChild(s);
});


/* ════════ STATE ════════ */
const IS_ELECTRON = !!window.petBridge;
const _urlMode = new URLSearchParams(window.location.search).get('mode');
const IS_PET_WIN  = IS_ELECTRON && !_urlMode;
const IS_CHAT_WIN = IS_ELECTRON && _urlMode === 'chat';
const IS_SET_WIN  = IS_ELECTRON && _urlMode === 'settings';
const IS_LONG_TASKS_WIN = IS_ELECTRON && _urlMode === 'long-tasks';

const LONG_TASK_MAX=8;
const LONG_TASK_TITLE_MAX=60;
const LONG_TASK_GOAL_MAX=220;
const LONG_TASK_INTERVAL_MIN=1;
const LONG_TASK_INTERVAL_MAX=10080;

function makeLongTaskId(){
  return 'lt_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}

function normalizeLongTaskInterval(value){
  return Math.min(LONG_TASK_INTERVAL_MAX,Math.max(LONG_TASK_INTERVAL_MIN,Math.round(Number(value)||1440)));
}

function normalizeLongTaskId(value){
  const id=String(value||'').trim();
  return /^[A-Za-z0-9_-]{3,48}$/.test(id)?id:makeLongTaskId();
}

function normalizeLongTasks(value){
  const list=Array.isArray(value)?value:[];
  const seen=new Set();
  return list.map(item=>{
    const id=normalizeLongTaskId(item?.id);
    if(seen.has(id)) return null;
    seen.add(id);
    const title=String(item?.title||'').trim().slice(0,LONG_TASK_TITLE_MAX);
    const goal=String(item?.goal||'').trim().slice(0,LONG_TASK_GOAL_MAX);
    const usesDefaultTitle=item?.usesDefaultTitle===true;
    if(!title&&!goal&&!usesDefaultTitle) return null;
    return {
      id,
      title,
      usesDefaultTitle,
      goal,
      interval:normalizeLongTaskInterval(item?.interval),
      enabled:!!item?.enabled,
      createdAt:Number(item?.createdAt)||Date.now(),
      lastSentAt:Number(item?.lastSentAt)||Date.now(),
      nextDueAt:Number(item?.nextDueAt)||0,
      retryCount:Math.max(0,Math.min(3,Number(item?.retryCount)||0)),
      lastError:String(item?.lastError||'').slice(0,240),
      lastErrorKey:String(item?.lastErrorKey||'').slice(0,120),
      lastErrorValues:item?.lastErrorValues&&typeof item.lastErrorValues==='object'&&!Array.isArray(item.lastErrorValues)
        ? {...item.lastErrorValues}
        : null,
    };
  }).filter(Boolean).slice(0,LONG_TASK_MAX);
}

function longTaskTitle(task){
  if(task?.usesDefaultTitle) return tr('longTasks.newTitle');
  return String(task?.title||'').trim()||tr('longTasks.untitled');
}

function applyTheme(){
  document.documentElement.dataset.theme='koala';
  document.body.dataset.theme='koala';
  return 'koala';
}

let cfg=load();
i18n?.init(document,cfg.locale);
cfg.theme=applyTheme(cfg.theme);
cfg.proxy=false;
let history=[];
let busy=false;

const PRIVATE_CONTENT_KEYS=new Set([
  'nono_hermes_memory_v1',
  'nono_tasks',
  'nono_task',
  'nono_stats',
  'nono_freezer',
  'nono_mood',
  'nono_last_activity',
]);
const privateCache=new Map();

function initPrivateStore(){
  if(!IS_ELECTRON||!window.petBridge?.privateStoreGetSync) return;
  const legacySources={
    nono_freezer:['nono_fz','naonao_freezer'],
    nono_mood:['naonao_mood'],
    nono_task:['zt_task'],
    nono_last_activity:['zt_lastActivity'],
    nono_tasks:['zt_tasks_v1'],
    nono_stats:['naonao_stats'],
  };
  [...PRIVATE_CONTENT_KEYS].forEach(key=>{
    let fallback=null;
    try{fallback=localStorage.getItem(key);}catch{}
    if(fallback===null){
      for(const legacyKey of legacySources[key]||[]){
        try{
          fallback=localStorage.getItem(legacyKey);
          if(fallback!==null) break;
        }catch{}
      }
    }
    try{
      const value=window.petBridge.privateStoreGetSync(key,null);
      if(value!==null&&value!==undefined){
        privateCache.set(key,String(value));
      }else if(fallback!==null&&window.petBridge?.privateStoreSet){
        window.petBridge.privateStoreSet(key,fallback).then(saved=>{
          if(!saved) return;
          try{localStorage.removeItem(key);}catch{}
          for(const legacyKey of legacySources[key]||[]){
            try{localStorage.removeItem(legacyKey);}catch{}
          }
        }).catch(e=>console.error('private store migrate:',key,e));
        privateCache.set(key,String(fallback));
        return;
      }
      if(fallback!==null) localStorage.removeItem(key);
      for(const legacyKey of legacySources[key]||[]){
        try{localStorage.removeItem(legacyKey);}catch{}
      }
    }catch(e){console.error('private store init:',key,e)}
  });
}

function privateGet(key,fallback=''){
  if(IS_ELECTRON&&PRIVATE_CONTENT_KEYS.has(key)) return privateCache.has(key)?privateCache.get(key):fallback;
  try{const value=localStorage.getItem(key);return value===null?fallback:value;}catch{return fallback;}
}

function privateSet(key,value){
  const normalized=String(value);
  if(IS_ELECTRON&&PRIVATE_CONTENT_KEYS.has(key)){
    privateCache.set(key,normalized);
    window.petBridge?.privateStoreSet?.(key,normalized).catch(e=>console.error('private store set:',key,e));
    try{localStorage.removeItem(key);}catch{}
    return;
  }
  localStorage.setItem(key,normalized);
}

function privateRemove(key){
  if(IS_ELECTRON&&PRIVATE_CONTENT_KEYS.has(key)){
    privateCache.delete(key);
    window.petBridge?.privateStoreRemove?.(key).catch(e=>console.error('private store remove:',key,e));
    try{localStorage.removeItem(key);}catch{}
    return;
  }
  localStorage.removeItem(key);
}

initPrivateStore();

function load(){
  try{const s=JSON.parse(localStorage.getItem('nono_config')||'{}');
    return{
      p:s.p||'anthropic',k:s.k||'',hasApiKey:!!s.hasApiKey,m:s.m||'',b:s.b||'',proxy:!!s.proxy,freq:s.freq||'mid',
      locale:i18n?.normalizeLocale(s.locale)||'zh-CN',
      confirmedOpenAIBaseUrl:s.confirmedOpenAIBaseUrl||'',
      feishuEnabled:!!s.feishuEnabled,
      feishuInterval:normalizeFeishuInterval(s.feishuInterval),
      feishuAppEnabled:!!s.feishuAppEnabled,
      feishuAppId:s.feishuAppId||'',
      feishuAppChatId:s.feishuAppChatId||'',
      hermesAgentEnabled:!!s.hermesAgentEnabled,
      hermesAgentBaseUrl:s.hermesAgentBaseUrl||'http://127.0.0.1:8642/v1',
      confirmedHermesBaseUrl:s.confirmedHermesBaseUrl||'',
      hermesAgentModel:s.hermesAgentModel||'',
      hermesEnabled:s.hermesEnabled!==false,
      longTasks:normalizeLongTasks(s.longTasks),
    };}
  catch{return{p:'anthropic',k:'',hasApiKey:false,m:'',b:'',proxy:false,freq:'mid',locale:'zh-CN',confirmedOpenAIBaseUrl:'',feishuEnabled:false,feishuInterval:30,feishuAppEnabled:false,feishuAppId:'',feishuAppChatId:'',hermesAgentEnabled:false,hermesAgentBaseUrl:'http://127.0.0.1:8642/v1',confirmedHermesBaseUrl:'',hermesAgentModel:'',hermesEnabled:true,longTasks:[]};}
}
function save(){
  // Desktop-only product: never persist API keys to localStorage.
  if(IS_ELECTRON){
    const {k, ...rest}=cfg;
    localStorage.setItem('nono_config',JSON.stringify(rest));
    window.petBridge.notifyConfigChanged?.();
  } else {
    const {k, ...rest}=cfg;
    localStorage.setItem('nono_config',JSON.stringify(rest));
  }
}
function hasKey(){return!!(cfg.k||cfg.hasApiKey);}

async function refreshProviderKeyState(fallback){
  if(!IS_ELECTRON||!window.petBridge?.hasSecret) return !!cfg.k;
  try{return !!(await window.petBridge.hasSecret());}
  catch(e){console.error('hasSecret failed:',e);return !!fallback;}
}

async function saveProviderApiKeyIfNeeded(value){
  const key=String(value||'').trim();
  if(!IS_ELECTRON){
    cfg.k='';
    cfg.hasApiKey=false;
    return false;
  }
  if(!key) return true;
  if(!window.petBridge?.setSecret) return false;
  const saved=await window.petBridge.setSecret(key);
  if(saved){
    cfg.k='';
    cfg.hasApiKey=true;
  }
  return !!saved;
}

function syncApiKeyField(){
  if(!fKey) return;
  if(IS_ELECTRON){
    fKey.value='';
    fKey.placeholder=hasKey()?tr('settings.model.savedApiKeyPlaceholder'):tr('settings.model.apiKeyPlaceholder');
  } else {
    fKey.value=cfg.k;
    fKey.placeholder=tr('settings.model.apiKeyPlaceholder');
  }
}

// Desktop: pull the key from OS-encrypted storage on boot, and migrate any legacy
// plaintext key out of localStorage.
if(IS_ELECTRON){
  (async()=>{
    try{
      const stored='';
      cfg.hasApiKey=await refreshProviderKeyState(cfg.hasApiKey);
      if(stored){
        cfg.k=stored;
      } else if(cfg.k){
        // legacy plaintext → safeStorage, then scrub localStorage
        try{ await window.petBridge.setSecret(cfg.k); }catch(e){console.error('legacy migrate setSecret:',e)}
      }
      // Always strip the key from the JSON blob now that it lives in safeStorage
      try{
        const raw=JSON.parse(localStorage.getItem('nono_config')||'{}');
        if('k' in raw){ delete raw.k; localStorage.setItem('nono_config',JSON.stringify(raw)); }
      }catch(e){console.error('key scrub failed:',e)}
      cfg.k='';
      cfg.hasApiKey=await refreshProviderKeyState(cfg.hasApiKey);
      save();
      // Refresh UI bits that depend on hasKey()
      try{ if(typeof updateStatus==='function') updateStatus(); }catch(e){console.error('updateStatus:',e)}
      try{ if(typeof renderTasks==='function') renderTasks(); }catch(e){console.error('renderTasks:',e)}
    }catch(e){console.error('onBoot key init:',e)}
  })();
}

/* ════════ SETTINGS UI ════════ */
const overlay=document.getElementById('s-overlay');
const panel=document.getElementById('s-panel');
const fKey=document.getElementById('f-key');
const fModel=document.getElementById('f-model');
const fBase=document.getElementById('f-base');
const fProxy=document.getElementById('f-proxy');
const frBase=document.getElementById('fr-base');
const stRow=document.getElementById('st-row');
const mHint=document.getElementById('model-hint');
const segBtns=document.querySelectorAll('.seg-b[data-p]');
const feishuEnabledEl=document.getElementById('feishu-enabled');
const feishuWebhookEl=document.getElementById('feishu-webhook');
const feishuIntervalEl=document.getElementById('feishu-interval');
const feishuStatusEl=document.getElementById('feishu-status');
const feishuAppEnabledEl=document.getElementById('feishu-app-enabled');
const feishuAppIdEl=document.getElementById('feishu-app-id');
const feishuAppSecretEl=document.getElementById('feishu-app-secret');
const feishuChatIdEl=document.getElementById('feishu-chat-id');
const feishuConnectBtn=document.getElementById('feishu-connect-btn');
const feishuAppStatusEl=document.getElementById('feishu-app-status');
const longTaskListEl=document.getElementById('long-task-list');
const longTaskAddBtn=document.getElementById('long-task-add-btn');
const longTaskStatusEl=document.getElementById('long-task-status');
const longTaskSaveBtn=document.getElementById('long-task-save-btn');
const hermesAgentEnabledEl=document.getElementById('hermes-agent-enabled');
const hermesAgentBaseEl=document.getElementById('hermes-agent-base');
const hermesAgentKeyEl=document.getElementById('hermes-agent-key');
const hermesAgentModelEl=document.getElementById('hermes-agent-model');
const hermesAgentTestBtn=document.getElementById('hermes-agent-test-btn');
const hermesAgentStatusEl=document.getElementById('hermes-agent-status');
const hermesEnabledEl=document.getElementById('hermes-enabled');
const hermesStatusEl=document.getElementById('hermes-status');
const hermesReviewBtn=document.getElementById('hermes-review-btn');
const hermesClearBtn=document.getElementById('hermes-clear-btn');
const languageSelect=document.getElementById('language-select');
const longTaskWebhookDrafts={};
const longTaskWebhookSaved={};
const removedLongTaskIds=new Set();
let curP=cfg.p;

function syncSettingsWindowTitle(target){
  const title=document.getElementById('settings-window-title');
  if(!title) return;
  const active=[...document.querySelectorAll('.settings-tab')]
    .find(btn=>btn.dataset.settingsTab===target)
    ?.querySelector('span:last-child');
  title.textContent=active?.textContent?.trim()||tr('settings.title');
}

function selectSettingsTab(tab){
  const name=String(tab||'model');
  const tabs=[...document.querySelectorAll('.settings-tab')];
  const sections=[...document.querySelectorAll('.settings-section')];
  const hasTarget=sections.some(section=>section.dataset.settingsSection===name);
  const target=hasTarget?name:'model';
  tabs.forEach(btn=>btn.classList.toggle('active',btn.dataset.settingsTab===target));
  sections.forEach(section=>{
    section.hidden=section.dataset.settingsSection!==target;
  });
  syncSettingsWindowTitle(target);
}

document.querySelectorAll('[data-settings-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    selectSettingsTab(btn.dataset.settingsTab);
  });
});

document.querySelectorAll('[data-settings-open="long-tasks"]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    window.petBridge?.openLongTasks?.();
  });
});

function isValidFeishuWebhook(value){
  try{
    const url=new URL(String(value||'').trim());
    return url.protocol==='https:' &&
      (url.hostname==='open.feishu.cn'||url.hostname==='open.larksuite.com') &&
      /^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname);
  }catch{return false;}
}

function isValidFeishuAppId(value){
  return /^cli_[A-Za-z0-9]+$/.test(String(value||'').trim());
}

function escapeHTML(value){
  return String(value||'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

const HERMES_MEMORY_KEY='nono_hermes_memory_v1';
const HERMES_MAX_ITEMS=18;
const HERMES_SENSITIVE_RE=/(api[_ -]?key|token|secret|password|passwd|webhook|open-apis\/bot|Authorization|Bearer|ghp_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-)/i;

function normalizeFeishuInterval(value){
  return Math.min(240,Math.max(1,Math.round(Number(value)||30)));
}

function normalizeHermesAgentBaseUrl(value){
  const raw=String(value||'').trim()||'http://127.0.0.1:8642/v1';
  let url;
  try{url=new URL(raw)}catch{throw new Error(tr('error.hermesBase'))}
  if(url.protocol!=='http:'&&url.protocol!=='https:') throw new Error(tr('error.hermesBase'));
  url.hash='';
  url.search='';
  url.pathname=(url.pathname||'/v1').replace(/\/+$/,'')||'/v1';
  return url.toString().replace(/\/+$/,'');
}

function isLoopbackHost(hostname){
  return ['localhost','127.0.0.1','::1','[::1]'].includes(String(hostname||'').toLowerCase());
}

function normalizeOpenAICompatibleBaseUrl(value){
  const raw=String(value||'').trim()||'https://api.openai.com/v1';
  let url;
  try{url=new URL(raw)}catch{throw new Error(tr('error.openaiBase'))}
  const localHttp=url.protocol==='http:'&&isLoopbackHost(url.hostname);
  if(url.protocol!=='https:'&&!localHttp) throw new Error(tr('error.openaiBase'));
  url.username='';
  url.password='';
  url.hash='';
  url.search='';
  url.pathname=(url.pathname||'/v1').replace(/\/+$/,'')||'/v1';
  return url.toString().replace(/\/+$/,'');
}

function needsOpenAIBaseUrlConsent(value){
  const url=new URL(normalizeOpenAICompatibleBaseUrl(value));
  return url.hostname!=='api.openai.com'&&!isLoopbackHost(url.hostname);
}

function needsHermesBaseUrlConsent(value){
  const url=new URL(normalizeHermesAgentBaseUrl(value));
  if(isLoopbackHost(url.hostname)) return false;
  return url.protocol!=='https:'||!/(^|\.)hermes\.help$/i.test(url.hostname);
}

function isConfirmedOpenAIBaseUrl(value){
  try{
    const normalized=normalizeOpenAICompatibleBaseUrl(value);
    return !needsOpenAIBaseUrlConsent(normalized)||cfg.confirmedOpenAIBaseUrl===normalized;
  }catch{return false;}
}

function isConfirmedHermesBaseUrl(value){
  try{
    const normalized=normalizeHermesAgentBaseUrl(value);
    return !needsHermesBaseUrlConsent(normalized)||cfg.confirmedHermesBaseUrl===normalized;
  }catch{return false;}
}

async function confirmThirdPartyBaseUrl(kind,url){
  return petDialog.confirm(tr('dialog.thirdPartyMessage',{kind,url}),{title:tr('dialog.thirdPartyTitle')});
}

function hermesAgentModelName(){
  return String(cfg.hermesAgentModel||'').trim()||'hermes-agent';
}

function updateHermesAgentStatus(text){
  if(!hermesAgentStatusEl) return;
  hermesAgentStatusEl.textContent=text||(
    cfg.hermesAgentEnabled
      ? tr('status.hermesEnabled',{url:cfg.hermesAgentBaseUrl||'http://127.0.0.1:8642/v1'})
      : tr('status.hermesDisconnected')
  );
}

async function testHermesAgentConnection(){
  if(!hermesAgentStatusEl) return false;
  try{
    cfg.hermesAgentBaseUrl=normalizeHermesAgentBaseUrl(hermesAgentBaseEl?.value||cfg.hermesAgentBaseUrl);
    if(needsHermesBaseUrlConsent(cfg.hermesAgentBaseUrl)){
      if(cfg.confirmedHermesBaseUrl!==cfg.hermesAgentBaseUrl){
        const ok=await confirmThirdPartyBaseUrl('Hermes Agent',cfg.hermesAgentBaseUrl);
        if(!ok) return false;
      }
      cfg.confirmedHermesBaseUrl=cfg.hermesAgentBaseUrl;
    }else{
      cfg.confirmedHermesBaseUrl='';
    }
  }catch(e){
    updateHermesAgentStatus(e.message||tr('error.hermesBase'));
    return false;
  }
  updateHermesAgentStatus(tr('status.hermesTesting'));
  try{
    if(window.petBridge?.testHermesAgent){
      const result=await window.petBridge.testHermesAgent({baseUrl:cfg.hermesAgentBaseUrl,allowThirdPartyBaseUrl:isConfirmedHermesBaseUrl(cfg.hermesAgentBaseUrl)});
      if(!result?.success) throw new Error(resultError(result));
      updateHermesAgentStatus(tr('status.hermesConnected'));
      save();
      return true;
    }
    throw new Error(tr('error.hermesChannel'));
  }catch(e){
    updateHermesAgentStatus(tr('status.hermesFailed',{error:e.message||tr('common.unknownError')}));
    return false;
  }
}

function createHermesMemory(){
  return {version:1,profile:[],workPatterns:[],reflections:[],events:[],updatedAt:new Date().toISOString()};
}

function readHermesMemory(){
  try{
    const data=JSON.parse(privateGet(HERMES_MEMORY_KEY,'null'));
    if(data&&data.version===1) return {...createHermesMemory(),...data};
  }catch(e){console.error('readHermesMemory:',e)}
  return createHermesMemory();
}

function writeHermesMemory(memory){
  memory.updatedAt=new Date().toISOString();
  privateSet(HERMES_MEMORY_KEY,JSON.stringify(memory));
  updateHermesStatus();
}

function sanitizeHermesText(text){
  return String(text||'').replace(/\s+/g,' ').trim().slice(0,180);
}

function isSafeHermesMemory(text){
  const clean=sanitizeHermesText(text);
  return clean.length>=6&&!HERMES_SENSITIVE_RE.test(clean);
}

function hermesBucket(type){
  if(type==='profile') return 'profile';
  if(type==='reflection') return 'reflections';
  if(type==='event') return 'events';
  return 'workPatterns';
}

function addHermesMemory(type,text,source='chat',confidence=.6){
  if(!cfg.hermesEnabled) return false;
  const clean=sanitizeHermesText(text);
  if(!isSafeHermesMemory(clean)) return false;
  const memory=readHermesMemory();
  const key=hermesBucket(type);
  const exists=memory[key].some(item=>item.text===clean);
  if(exists) return false;
  memory[key].unshift({text:clean,source,confidence,ts:new Date().toISOString()});
  memory[key]=memory[key].slice(0,HERMES_MAX_ITEMS);
  writeHermesMemory(memory);
  addLog(`Hermes 记忆已更新：${clean}`);
  return true;
}

function learnHermesFromText(text,source='chat'){
  if(!cfg.hermesEnabled) return;
  const clean=sanitizeHermesText(text);
  if(!isSafeHermesMemory(clean)) return;
  if(/(请记住|记住|以后|我希望|我喜欢|我不喜欢|我需要|不要|别再|我习惯|我容易|对我来说)/.test(clean)){
    addHermesMemory('profile',clean,source,.8);
    return;
  }
  if(/(我在做|我刚才|下一步|卡住|分心|拖延|专注|汇报|完成|开始)/.test(clean)){
    addHermesMemory('workPattern',clean,source,.65);
  }
}

function summarizeHermesMemory(memory=readHermesMemory()){
  const lines=[];
  const take=(title,items,limit)=>{
    const selected=items.slice(0,limit);
    if(selected.length) lines.push(`${title}：${selected.map(x=>x.text).join('；')}`);
  };
  take(tr('memory.profile'),memory.profile,5);
  take(tr('memory.workPatterns'),memory.workPatterns,5);
  take(tr('memory.reflections'),memory.reflections,3);
  return lines.join('\n');
}

function buildHermesSystemPrompt(){
  const base=`${SYS}\n\nAlways reply in ${i18n?.getPromptLanguage()||'Simplified Chinese'}.`;
  if(!cfg.hermesEnabled) return base;
  const summary=summarizeHermesMemory();
  if(!summary) return base;
  return `${base}\n\nLocal long-term memory (use only as supporting context; do not repeat verbatim):\n${summary}\n\nPrefer the user's current message whenever it conflicts with memory.`;
}

function buildHermesLocalPrompt(userText){
  if(!cfg.hermesEnabled) return userText;
  const summary=summarizeHermesMemory();
  if(!summary) return userText;
  return tr('memory.summaryPrefix',{summary,message:userText});
}

function updateHermesStatus(){
  if(!hermesStatusEl) return;
  const memory=readHermesMemory();
  const count=memory.profile.length+memory.workPatterns.length+memory.reflections.length+memory.events.length;
  hermesStatusEl.textContent=cfg.hermesEnabled?tr('status.hermesMemoryOn',{count}):tr('status.hermesMemoryOff');
}

function updateFeishuSupervisorStatus(pending=false){
  if(!feishuStatusEl) return;
  const minutes=normalizeFeishuInterval(feishuIntervalEl?.value||cfg.feishuInterval);
  const enabled=feishuEnabledEl ? !!feishuEnabledEl.checked : !!cfg.feishuEnabled;
  if(enabled){
    feishuStatusEl.textContent=tr('status.feishuOn',{minutes,pending:pending?tr('status.feishuPending'):''});
  }else{
    feishuStatusEl.textContent=tr('status.feishuOff',{minutes});
  }
}

function longTaskStatusText(task){
  if(!task.enabled) return tr('status.disabled');
  const error=storedErrorText(task);
  if(error) return tr('status.retrying',{error});
  const last=Number(task.lastSentAt)||0;
  const next=Number(task.nextDueAt)||last+normalizeLongTaskInterval(task.interval)*60*1000;
  if(!last) return tr('status.enabledEvery',{minutes:task.interval});
  const remain=Math.max(0,Math.ceil((next-Date.now())/60000));
  return remain>0?tr('status.enabledRemaining',{minutes:remain}):tr('status.waitingNext');
}
function createLongTaskDraft(){
  const now=Date.now();
  return {
    id:makeLongTaskId(),
    title:'',
    usesDefaultTitle:true,
    goal:'',
    interval:1440,
    enabled:false,
    createdAt:now,
    lastSentAt:now,
  };
}

async function refreshLongTaskWebhooks(){
  if(!IS_ELECTRON||!window.petBridge?.hasLongTaskWebhook||!longTaskListEl) return;
  await Promise.all((cfg.longTasks||[]).map(async task=>{
    try{
      const saved=!!(await window.petBridge.hasLongTaskWebhook(task.id));
      longTaskWebhookSaved[task.id]=saved;
      const input=longTaskListEl.querySelector(`[data-long-task-id="${task.id}"] [data-field="webhook"]`);
      if(input&&!input.matches(':focus')){
        input.value=longTaskWebhookDrafts[task.id]||'';
        input.placeholder=saved?tr('longTasks.savedWebhookPlaceholder'):'https://open.feishu.cn/open-apis/bot/v2/hook/...';
      }
    }catch(e){console.error('hasLongTaskWebhook:',e)}
  }));
}

function renderLongTaskSettings(){
  if(!longTaskListEl) return;
  cfg.longTasks=normalizeLongTasks(cfg.longTasks);
  if(!cfg.longTasks.length){
    longTaskListEl.innerHTML=`<div class="long-task-empty">${tr('longTasks.empty')}</div>`;
    if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.emptyHint');
    return;
  }
  longTaskListEl.innerHTML=cfg.longTasks.map(task=>{
    const title=longTaskTitle(task);
    return `
    <div class="lt-card" data-long-task-id="${escapeHTML(task.id)}">
      <div class="lt-card-head">
        <label class="lt-title-line">
          <input type="checkbox" data-field="enabled" ${task.enabled?'checked':''}>
          <span>${escapeHTML(title)}</span>
        </label>
        <div class="lt-actions">
          <button class="lt-action" type="button" data-act="test">${tr('common.test')}</button>
          <button class="lt-action danger" type="button" data-act="delete">${tr('common.delete')}</button>
        </div>
      </div>
      <div class="frow">
        <label>${tr('longTasks.taskName')}</label>
        <input type="text" data-field="title" maxlength="${LONG_TASK_TITLE_MAX}" value="${escapeHTML(title)}" placeholder="${tr('longTasks.taskPlaceholder')}">
      </div>
      <div class="frow">
        <label>${tr('longTasks.goal')}</label>
        <textarea data-field="goal" maxlength="${LONG_TASK_GOAL_MAX}" placeholder="${tr('longTasks.goalPlaceholder')}">${escapeHTML(task.goal)}</textarea>
      </div>
      <div class="lt-grid">
        <div class="frow">
          <label>${tr('longTasks.interval')}</label>
          <input type="number" data-field="interval" min="${LONG_TASK_INTERVAL_MIN}" max="${LONG_TASK_INTERVAL_MAX}" step="1" value="${task.interval}" inputmode="numeric">
        </div>
        <div class="frow">
          <label>${tr('longTasks.webhook')}</label>
          <input type="password" data-field="webhook" placeholder="${longTaskWebhookSaved[task.id]?tr('longTasks.savedWebhookPlaceholder'):'https://open.feishu.cn/open-apis/bot/v2/hook/...'}" autocomplete="off" spellcheck="false" value="${escapeHTML(longTaskWebhookDrafts[task.id]||'')}">
        </div>
      </div>
      <span class="lt-status">${escapeHTML(longTaskStatusText(task))}</span>
    </div>
  `}).join('');
  if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.count',{count:cfg.longTasks.length,max:LONG_TASK_MAX});
  refreshLongTaskWebhooks();
}

function collectLongTasksFromUI(){
  if(!longTaskListEl) return normalizeLongTasks(cfg.longTasks);
  const now=Date.now();
  const next=[];
  longTaskListEl.querySelectorAll('.lt-card').forEach(card=>{
    const id=card.dataset.longTaskId||makeLongTaskId();
    const prev=(cfg.longTasks||[]).find(task=>task.id===id);
    const title=card.querySelector('[data-field="title"]')?.value.trim()||'';
    const goal=card.querySelector('[data-field="goal"]')?.value.trim()||'';
    const usesDefaultTitle=!!prev?.usesDefaultTitle&&card.dataset.titleEdited!=='1'&&title===longTaskTitle(prev);
    if(!title&&!goal&&!usesDefaultTitle) return;
    const enabled=!!card.querySelector('[data-field="enabled"]')?.checked;
    const interval=normalizeLongTaskInterval(card.querySelector('[data-field="interval"]')?.value);
    longTaskWebhookDrafts[id]=card.querySelector('[data-field="webhook"]')?.value.trim()||'';
    next.push({
      id,
      title:usesDefaultTitle?'':title.slice(0,LONG_TASK_TITLE_MAX),
      usesDefaultTitle,
      goal:goal.slice(0,LONG_TASK_GOAL_MAX),
      interval,
      enabled,
      createdAt:prev?.createdAt||now,
      lastSentAt:enabled&&prev?.enabled ? (Number(prev.lastSentAt)||now) : now,
      nextDueAt:enabled&&prev?.enabled ? (Number(prev.nextDueAt)||0) : 0,
      retryCount:enabled&&prev?.enabled ? (Number(prev.retryCount)||0) : 0,
      lastError:enabled&&prev?.enabled ? (prev.lastError||'') : '',
      lastErrorKey:enabled&&prev?.enabled ? (prev.lastErrorKey||'') : '',
      lastErrorValues:enabled&&prev?.enabled ? (prev.lastErrorValues||null) : null,
    });
  });
  return normalizeLongTasks(next);
}

async function saveLongTaskWebhooks(){
  if(!IS_ELECTRON||!window.petBridge?.setLongTaskWebhook) return true;
  const ids=new Set((cfg.longTasks||[]).map(task=>task.id));
  for(const id of removedLongTaskIds){
    await window.petBridge.setLongTaskWebhook(id,'');
  }
  removedLongTaskIds.clear();
  for(const task of cfg.longTasks||[]){
    const webhook=String(longTaskWebhookDrafts[task.id]||'').trim();
    const hasSaved=!!longTaskWebhookSaved[task.id];
    if(task.enabled&&!webhook&&!hasSaved){
      if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.enableNeedsWebhook',{title:longTaskTitle(task)});
      return false;
    }
    if(webhook&&!isValidFeishuWebhook(webhook)){
      if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.invalidTaskWebhook',{title:longTaskTitle(task)});
      return false;
    }
    if(webhook){
      const saved=await window.petBridge.setLongTaskWebhook(task.id, webhook);
      if(!saved){
        if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.taskWebhookSaveFailed',{title:longTaskTitle(task)});
        return false;
      }
      longTaskWebhookSaved[task.id]=true;
      longTaskWebhookDrafts[task.id]='';
    }
    ids.delete(task.id);
  }
  return true;
}

async function saveLongTaskSettings(){
  cfg.longTasks=normalizeLongTasks(collectLongTasksFromUI());
  const saved=await saveLongTaskWebhooks();
  if(!saved) return false;
  save();
  renderLongTaskSettings();
  restartLongTaskSupervisor();
  if(longTaskStatusEl) longTaskStatusEl.textContent=tr('longTasks.savedCount',{count:cfg.longTasks.length,max:LONG_TASK_MAX});
  return true;
}

async function syncFeishuSettingsFields(){
  if(feishuEnabledEl) feishuEnabledEl.checked=!!cfg.feishuEnabled;
  if(feishuIntervalEl) feishuIntervalEl.value=String(cfg.feishuInterval||30);
  updateFeishuSupervisorStatus(false);
  if(feishuAppEnabledEl) feishuAppEnabledEl.checked=!!cfg.feishuAppEnabled;
  if(feishuAppIdEl) feishuAppIdEl.value=cfg.feishuAppId||'';
  if(feishuChatIdEl) feishuChatIdEl.value=cfg.feishuAppChatId||'';
  if(feishuAppStatusEl) feishuAppStatusEl.textContent=cfg.feishuAppEnabled?tr('status.feishuAppOn'):tr('status.feishuAppOff');
  if(hermesAgentEnabledEl) hermesAgentEnabledEl.checked=!!cfg.hermesAgentEnabled;
  if(hermesAgentBaseEl) hermesAgentBaseEl.value=cfg.hermesAgentBaseUrl||'http://127.0.0.1:8642/v1';
  if(hermesAgentModelEl) hermesAgentModelEl.value=cfg.hermesAgentModel||'';
  updateHermesAgentStatus();
  if(hermesEnabledEl) hermesEnabledEl.checked=!!cfg.hermesEnabled;
  updateHermesStatus();
  if(feishuWebhookEl && window.petBridge?.hasFeishuWebhook){
    try{
      const saved=!!(await window.petBridge.hasFeishuWebhook());
      feishuWebhookEl.value='';
      feishuWebhookEl.dataset.saved=saved?'1':'0';
      feishuWebhookEl.placeholder=saved?tr('longTasks.savedWebhookPlaceholder'):'https://open.feishu.cn/open-apis/bot/v2/hook/...';
    }catch(e){console.error('hasFeishuWebhook failed:',e);feishuWebhookEl.value='';feishuWebhookEl.dataset.saved='0';}
  }
  if(feishuAppSecretEl && window.petBridge?.hasFeishuAppSecret){
    try{
      const saved=!!(await window.petBridge.hasFeishuAppSecret());
      feishuAppSecretEl.value='';
      feishuAppSecretEl.dataset.saved=saved?'1':'0';
      feishuAppSecretEl.placeholder=saved?tr('settings.providers.savedSecretPlaceholder'):'App Secret';
    }catch(e){console.error('hasFeishuAppSecret failed:',e);feishuAppSecretEl.value='';feishuAppSecretEl.dataset.saved='0';}
  }
  if(hermesAgentKeyEl && window.petBridge?.hasHermesApiKey){
    try{
      const saved=!!(await window.petBridge.hasHermesApiKey());
      hermesAgentKeyEl.value='';
      hermesAgentKeyEl.dataset.saved=saved?'1':'0';
      hermesAgentKeyEl.placeholder=saved?tr('settings.model.savedApiKeyPlaceholder'):'Bearer Token / API Key';
    }catch(e){console.error('hasHermesApiKey failed:',e);hermesAgentKeyEl.value='';hermesAgentKeyEl.dataset.saved='0';}
  }
}

feishuIntervalEl?.addEventListener('input',()=>{
  if(feishuIntervalEl) feishuIntervalEl.value=String(normalizeFeishuInterval(feishuIntervalEl.value));
  updateFeishuSupervisorStatus(true);
});
feishuEnabledEl?.addEventListener('change',()=>updateFeishuSupervisorStatus(true));

async function applyExternalConfigUpdate(){
  const apiKey=cfg.k;
  const hadApiKey=cfg.hasApiKey;
  cfg=load();
  i18n?.setLocale(cfg.locale);
  if(IS_ELECTRON){
    cfg.k='';
    cfg.hasApiKey=await refreshProviderKeyState(hadApiKey);
    cfg.proxy=false;
  } else {
    cfg.k=apiKey;
  }
  curP=cfg.p;
  syncSeg();
  syncFreq();
  syncPetMode();
  syncLanguage();
  if(IS_SET_WIN||overlay.classList.contains('open')){
    syncApiKeyField();
    fModel.value=cfg.m;
    fBase.value=cfg.b;
    if(fProxy) fProxy.checked=false;
    await syncFeishuSettingsFields();
  }
  if(IS_LONG_TASKS_WIN) renderLongTaskSettings();
  updateHermesAgentStatus();
  updateHermesStatus();
  restartFeishuAppConnection();
  restartFeishuSupervisor();
  if(typeof restartLongTaskSupervisor==='function') restartLongTaskSupervisor();
  updateStatus();
}

window.petBridge?.onConfigChanged?.(()=>applyExternalConfigUpdate());
window.addEventListener('storage',e=>{
  if(e.key==='nono_config') applyExternalConfigUpdate();
});

hermesEnabledEl?.addEventListener('change',()=>{
  cfg.hermesEnabled=!!hermesEnabledEl.checked;
  updateHermesStatus();
});

hermesReviewBtn?.addEventListener('click',async ()=>{
  const summary=summarizeHermesMemory();
  await petDialog.alert(summary||tr('dialog.memoryEmpty'),{title:tr('dialog.memoryTitle')});
});

hermesClearBtn?.addEventListener('click',async ()=>{
  const ok=await petDialog.confirm(tr('dialog.clearMemoryMessage'),{title:tr('dialog.clearMemoryTitle')});
  if(!ok) return;
  privateRemove(HERMES_MEMORY_KEY);
  updateHermesStatus();
  addLog(tr('memory.cleared'));
});

hermesAgentTestBtn?.addEventListener('click',async ()=>{
  const key=hermesAgentKeyEl?.value.trim()||'';
  if(key&&window.petBridge?.setHermesApiKey){
    const saved=await window.petBridge.setHermesApiKey(key);
    if(!saved){
      updateHermesAgentStatus(tr('error.hermesKeySave'));
      return;
    }
    hermesAgentKeyEl.dataset.saved='1';
    hermesAgentKeyEl.value='';
  }
  await testHermesAgentConnection();
});

longTaskAddBtn?.addEventListener('click',()=>{
  cfg.longTasks=normalizeLongTasks([createLongTaskDraft(),...(cfg.longTasks||[])]);
  renderLongTaskSettings();
});

longTaskListEl?.addEventListener('input',e=>{
  const card=e.target.closest('.lt-card');
  if(!card) return;
  if(e.target.dataset.field==='webhook'){
    longTaskWebhookDrafts[card.dataset.longTaskId]=e.target.value.trim();
  }
  if(e.target.dataset.field==='title'){
    card.dataset.titleEdited='1';
    const label=card.querySelector('.lt-title-line span');
    if(label) label.textContent=e.target.value.trim()||tr('longTasks.untitled');
  }
});

longTaskListEl?.addEventListener('change',e=>{
  if(e.target.dataset.field==='interval'){
    e.target.value=String(normalizeLongTaskInterval(e.target.value));
  }
});

longTaskListEl?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-act]');
  if(!btn) return;
  const card=btn.closest('.lt-card');
  if(!card) return;
  const id=card.dataset.longTaskId;
  if(btn.dataset.act==='delete'){
    removedLongTaskIds.add(id);
    cfg.longTasks=normalizeLongTasks(collectLongTasksFromUI().filter(task=>task.id!==id));
    delete longTaskWebhookDrafts[id];
    delete longTaskWebhookSaved[id];
    renderLongTaskSettings();
    return;
  }
  if(btn.dataset.act==='test'){
    const tasks=collectLongTasksFromUI();
    const task=tasks.find(item=>item.id===id);
    const status=card.querySelector('.lt-status');
    const webhook=card.querySelector('[data-field="webhook"]')?.value.trim()||'';
    longTaskWebhookDrafts[id]=webhook;
    const hasSaved=!!longTaskWebhookSaved[id];
    if(!task){
      if(status) status.textContent=tr('longTasks.needName');
      return;
    }
    if(!webhook&&!hasSaved){
      if(status) status.textContent=tr('longTasks.needWebhook');
      return;
    }
    if(webhook&&!isValidFeishuWebhook(webhook)){
      if(status) status.textContent=tr('longTasks.invalidWebhook');
      return;
    }
    if(!window.petBridge?.setLongTaskWebhook||!window.petBridge?.sendLongTaskFeishu){
      if(status) status.textContent=tr('longTasks.unsupported');
      return;
    }
    if(status) status.textContent=tr('longTasks.sendingTest');
    if(webhook){
      const saved=await window.petBridge.setLongTaskWebhook(task.id, webhook);
      if(!saved){
        if(status) status.textContent=tr('longTasks.webhookSaveFailed');
        return;
      }
      longTaskWebhookSaved[task.id]=true;
      longTaskWebhookDrafts[task.id]='';
    }
    const result=await sendLongTaskCheckin(task,true);
    if(status) status.textContent=result?.success?tr('longTasks.testSent'):tr('longTasks.sendFailed',{error:resultError(result)});
  }
});

longTaskSaveBtn?.addEventListener('click',async ()=>{
  await saveLongTaskSettings();
});

async function openSettings(){
  cfg.hasApiKey=await refreshProviderKeyState(cfg.hasApiKey);
  syncApiKeyField();fModel.value=cfg.m;fBase.value=cfg.b;
  if(fProxy) fProxy.checked=false;
  await syncFeishuSettingsFields();
  curP=cfg.p;syncSeg();syncFreq();syncPetMode();syncLanguage();applyTheme();updateStatus();
  overlay.classList.add('open');panel.classList.add('open');
}
function closeSettings(){overlay.classList.remove('open');panel.classList.remove('open');}
function syncFreq(){
  document.querySelectorAll('#freq-seg .seg-b').forEach(b=>{
    b.classList.toggle('on', b.dataset.freq===(cfg.freq||'mid'));
  });
}
document.querySelectorAll('#freq-seg .seg-b').forEach(b=>{
  b.addEventListener('click',()=>{
    cfg.freq=b.dataset.freq;
    document.querySelectorAll('#freq-seg .seg-b').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
  });
});
function syncPetMode(){
  const q = (typeof window.isQuietPet === 'function') ? window.isQuietPet() : false;
  document.querySelectorAll('#pet-mode-seg .seg-b').forEach(b=>{
    const isThis = (q && b.dataset.pet==='quiet') || (!q && b.dataset.pet==='lively');
    b.classList.toggle('on', isThis);
  });
}
document.querySelectorAll('#pet-mode-seg .seg-b').forEach(b=>{
  b.addEventListener('click',()=>{
    const quiet = b.dataset.pet === 'quiet';
    if (typeof window.setQuietPet === 'function') window.setQuietPet(quiet);
    document.querySelectorAll('#pet-mode-seg .seg-b').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
  });
});
function syncLanguage(){
  if(languageSelect) languageSelect.value=i18n?.normalizeLocale(cfg.locale)||'zh-CN';
}
languageSelect?.addEventListener('change',()=>{
  cfg.locale=i18n?.normalizeLocale(languageSelect.value)||'zh-CN';
  i18n?.setLocale(cfg.locale);
  save();
});
syncPetMode();
syncLanguage();
applyTheme();
function syncSeg(){
  segBtns.forEach(b=>b.classList.toggle('on',b.dataset.p===curP));
  frBase.style.display=curP==='openai'?'flex':'none';
  mHint.textContent=DEFAULT_MODEL[curP]?`${tr('settings.model.namePlaceholder')}: ${DEFAULT_MODEL[curP]}`:'';
}
async function updateStatus(){
  await refreshLocalModelStatus();
  stRow.innerHTML=`<span class="st-badge ${hasKey()?'ok':'no'}">
    <span class="dot"></span>${hasKey()?tr('status.apiConfigured'):tr('status.apiLocal')}
  </span>`;
  const modelStatus = document.getElementById('local-model-status');
  const downloadProgress = document.getElementById('download-progress');
  
  if (modelStatus) {
    modelStatus.textContent = tr('model.localPrefix',{status:getLocalModelStatus()});
  }
  const modelBtn = document.getElementById('local-model-btn');
  if (modelBtn) {
    if (localModelLoading) {
      modelBtn.disabled = true;
      modelBtn.textContent = tr('model.loading');
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else if (localModelReady) {
      modelBtn.disabled = true;
      modelBtn.textContent = tr('model.ready');
      modelBtn.style.opacity = '0.6';
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else if (localModelHasFiles) {
      modelBtn.disabled = false;
      modelBtn.textContent = tr('model.load');
      modelBtn.style.opacity = '1';
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else {
      // 模型未下载
      modelBtn.disabled = false;
      modelBtn.textContent = tr('model.download');
      modelBtn.style.opacity = '1';
      if (downloadProgress) downloadProgress.style.display = 'none';
    }
  }
  // 删除按钮：只在模型已下载或已就绪时显示
  const deleteBtn = document.getElementById('local-model-delete-btn');
  if (deleteBtn) {
    deleteBtn.style.display = (localModelHasFiles || localModelReady) ? 'block' : 'none';
  }
}

/* 本地模型加载/下载按钮 */
let downloadCancelled=false;

document.getElementById('download-cancel')?.addEventListener('click',async ()=>{
  downloadCancelled=true;
  await window.petBridge.localModelCancel();
  const btn=document.getElementById('local-model-btn');
  const dp=document.getElementById('download-progress');
  if(btn){btn.disabled=false;btn.textContent=tr('model.download');btn.style.opacity='1'}
  if(dp)dp.style.display='none';
  addLog('⏹ 下载已取消');
});

document.getElementById('local-model-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('local-model-btn');
  const status = document.getElementById('local-model-status');
  const downloadProgress = document.getElementById('download-progress');
  const downloadStatus = document.getElementById('download-status');
  const downloadPct = document.getElementById('download-pct');
  const downloadBar = document.getElementById('download-bar');
  
  // 如果模型已经就绪，不需要操作
  if (localModelReady) {
    return;
  }
  
  // 如果模型文件已存在，直接加载
  if (localModelHasFiles && !localModelLoading) {
    btn.disabled = true;
    btn.textContent = tr('model.loading');
    if (status) status.textContent = tr('model.localPrefix',{status:tr('model.loading')});
    const ok = await loadLocalModel((pct, msg) => {
      if (status) status.textContent = tr('model.localPrefix',{status:msg||tr('model.loading')});
      if (btn && pct !== null && pct >= 0) btn.textContent = pct + '%';
    });
    if (ok) {
      addLog('本地 AI 模型加载完成');
      updateStatus();
    } else {
      btn.disabled = false;
      btn.textContent = tr('model.load');
      addLog('模型加载失败。详情请看日志或开发者工具控制台');
      if (status) status.textContent = tr('model.localPrefix',{status:tr('model.loadFailed')});
    }
    return;
  }
  
  // 模型文件不存在，需要下载
  downloadCancelled=false;
  btn.disabled = true;
  btn.textContent = tr('model.downloading');
  if (status) status.textContent = tr('model.localPrefix',{status:tr('model.preparing')});
  if (downloadProgress) downloadProgress.style.display = 'block';
  if (downloadStatus) downloadStatus.textContent = tr('model.connecting');
  if (downloadBar) downloadBar.style.width = '0%';
  if (downloadPct) downloadPct.textContent = '0%';
  
  addLog('开始下载本地 AI 模型…');
  
  try {
    const result = await window.petBridge.localModelDownload(cfg.locale);
    if(downloadCancelled) return;
    if (result && result.success) {
      // 直接设置前端状态，不依赖 IPC 回查避免时序问题
      localModelReady = true;
      localModelHasFiles = true;
      localModelLoading = false;
      addLog('本地 AI 模型下载并加载完成');
      if (downloadProgress) downloadProgress.style.display = 'none';
      updateStatus();
    } else {
      btn.disabled = false;
      btn.textContent = tr('model.download');
      if (status) status.textContent = tr('model.localPrefix',{status:tr('model.downloadFailed')});
      if (downloadProgress) downloadProgress.style.display = 'none';
      addLog('模型下载失败。请检查网络连接后重试。');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = tr('model.download');
    if (status) status.textContent = tr('model.localPrefix',{status:tr('model.downloadError')});
    if (downloadProgress) downloadProgress.style.display = 'none';
    addLog('模型下载异常: ' + (e?.message || e));
  }
});
// 删除本地模型按钮
document.getElementById('local-model-delete-btn')?.addEventListener('click', async () => {
  const ok = await petDialog.confirm(tr('dialog.deleteModelMessage'), { title:tr('dialog.deleteModelTitle') });
  if (!ok) return;
  const btn = document.getElementById('local-model-delete-btn');
  const status = document.getElementById('local-model-status');
  if (btn) { btn.disabled = true; btn.textContent = tr('model.deleting'); }
  const result = await window.petBridge.localModelDelete();
  if (result.success) {
    localModelReady = false;
    localModelHasFiles = false;
    localModelLoading = false;
    addLog('本地模型已删除');
    updateStatus();
    if (status) status.textContent = tr('model.localPrefix',{status:tr('model.deleted')});
    // 恢复删除按钮
    if (btn) { btn.disabled = false; btn.textContent = tr('common.delete'); }
  } else {
    addLog(`${tr('model.deleteFailed')}: ${resultError(result)}`);
    if (btn) { btn.disabled = false; btn.textContent = tr('common.delete'); }
  }
});
segBtns.forEach(b=>b.addEventListener('click',()=>{if(!b.dataset.p)return;curP=b.dataset.p;syncSeg();}));
document.getElementById('settings-btn').addEventListener('click',openSettings);
document.getElementById('s-close').addEventListener('click',closeSettings);
// s-minimize: in settings-only window minimize the OS window; otherwise just collapse the panel
document.getElementById('s-minimize').addEventListener('click',(e)=>{
  e.stopPropagation();
  if(IS_SET_WIN) window.petBridge.minimizeSelf();
  else closeSettings();
});
// dlg-minimize: in chat-only window minimize the OS window; otherwise collapse the dialog
document.getElementById('dlg-minimize').addEventListener('click',()=>{
  if(IS_CHAT_WIN){
    window.petBridge.minimizeSelf();
  } else {
    document.getElementById('chat-dialog').classList.remove('visible');
    document.getElementById('hint').classList.remove('hidden');
  }
});
overlay.addEventListener('click',closeSettings);
// Reset onboarding button
document.getElementById('reset-onboarding-btn')?.addEventListener('click',()=>{
  localStorage.removeItem('nono_onboarding_done');
  appendMsg('pet',tr('status.onboardingReset'));
  setTimeout(()=>{location.reload();},1200);
});
let _logs = [];
function addLog(msg){
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
  _logs.push(`[${timeStr}] ${msg}`);
  if(_logs.length > 100) _logs.shift();
  const logContainer = document.getElementById('log-container');
  if(logContainer){
    logContainer.textContent = _logs.join('\n');
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}
document.getElementById('log-copy').addEventListener('click',()=>{
  const logContainer = document.getElementById('log-container');
  if(logContainer){
    navigator.clipboard.writeText(logContainer.textContent).then(()=>{
      addLog(tr('logs.copied'));
    }).catch(e=>{
      addLog(tr('logs.copyFailed',{error:e.message}));
    });
  }
});
document.getElementById('log-clear').addEventListener('click',()=>{
  _logs = [];
  const logContainer = document.getElementById('log-container');
  if(logContainer) logContainer.textContent = tr('settings.advanced.noLogs');
  addLog(tr('logs.cleared'));
});

addLog(tr('logs.started'));

// 接收主进程诊断日志
if (window.petBridge && window.petBridge.onMainLog) {
  window.petBridge.onMainLog((msg) => addLog('[主进程] ' + msg));
}

// 接收模型下载进度
if (window.petBridge && window.petBridge.onLocalModelProgress) {
  window.petBridge.onLocalModelProgress((data) => {
    if(downloadCancelled) return;
    const downloadProgress = document.getElementById('download-progress');
    const downloadStatus = document.getElementById('download-status');
    const downloadPct = document.getElementById('download-pct');
    const downloadBar = document.getElementById('download-bar');
    
    const progressMessage=data.status==='downloading'
      ? `${tr('model.downloading')} ${data.pct||0}%${data.name?` · ${data.name}`:''}`
      : tr('model.preparing');
    if (downloadProgress) downloadProgress.style.display = 'block';
    if (downloadStatus) downloadStatus.textContent = progressMessage;
    if (downloadPct && data.pct !== undefined) downloadPct.textContent = data.pct + '%';
    if (downloadBar && data.pct !== undefined) downloadBar.style.width = data.pct + '%';
    
    addLog(progressMessage);
  });
}

function summarizeFeishuReport(text){
  const clean=String(text||'').replace(/\s+/g,' ').trim().slice(0,120);
  return clean ? tr('report.received',{text:clean}) : tr('report.receivedEmpty');
}

async function restartFeishuAppConnection(){
  if(!IS_ELECTRON||!window.petBridge?.startFeishuApp) return;
  if(!cfg.feishuAppEnabled){
    await window.petBridge.stopFeishuApp?.();
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.feishuAppOff');
    return;
  }
  if(!isValidFeishuAppId(cfg.feishuAppId)){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.invalidAppId');
    return;
  }
  if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.feishuConnecting');
  const result=await window.petBridge.startFeishuApp({appId:cfg.feishuAppId});
  if(feishuAppStatusEl) feishuAppStatusEl.textContent=result?.success?tr('status.feishuConnectedHint'):tr('status.sendFailed',{error:resultError(result)});
}

feishuConnectBtn?.addEventListener('click',async ()=>{
  const appId=feishuAppIdEl?.value.trim()||'';
  const secret=feishuAppSecretEl?.value.trim()||'';
  if(!isValidFeishuAppId(appId)){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.invalidAppId');
    return;
  }
  if(!secret){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.needAppSecret');
    return;
  }
  if(window.petBridge?.setFeishuAppSecret){
    const saved=await window.petBridge.setFeishuAppSecret(secret);
    if(!saved){
      if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.secretSaveFailed');
      return;
    }
  }
  cfg.feishuAppId=appId;
  cfg.feishuAppEnabled=true;
  if(feishuAppEnabledEl) feishuAppEnabledEl.checked=true;
  save();
  await restartFeishuAppConnection();
});

if(window.petBridge?.onFeishuMessage){
  window.petBridge.onFeishuMessage(async msg=>{
    if(!msg?.text) return;
    cfg.feishuAppChatId=msg.chatId||cfg.feishuAppChatId||'';
    save();
    scheduleFeishuSupervisorSync();
    if(feishuChatIdEl) feishuChatIdEl.value=cfg.feishuAppChatId;
    learnHermesFromText(msg.text,'feishu');
    appendMsg('user',tr('report.feishuPrefix',{text:msg.text}));
    let reply=summarizeFeishuReport(msg.text);
    if(cfg.hermesAgentEnabled){
      try{
        reply=await requestHermesAgentReply(msg.text,'feishu');
      }catch(e){
        addLog(`Hermes Agent 飞书回复失败：${e.message||e}`);
      }
    }
    appendMsg('pet',reply);
    if(msg.chatId&&window.petBridge?.sendFeishuApp){
      await window.petBridge.sendFeishuApp(msg.chatId, reply);
    }
  });
}

if(window.petBridge?.onFeishuStatus){
  window.petBridge.onFeishuStatus(status=>{
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=status.connected?tr('status.feishuConnected'):tr('status.feishuDisconnected');
  });
}

if(window.petBridge?.onFeishuSupervisorStatus){
  window.petBridge.onFeishuSupervisorStatus(status=>{
    if(!feishuStatusEl||!status) return;
    const minutes=normalizeFeishuInterval(status.interval||cfg.feishuInterval);
    if(!status.enabled){
      feishuStatusEl.textContent=tr('status.feishuOff',{minutes});
      return;
    }
    const next=Number(status.nextDueAt)||0;
    const remain=next?Math.max(0,Math.ceil((next-Date.now())/60000)):minutes;
    const error=storedErrorText(status);
    feishuStatusEl.textContent=error
      ? tr('status.feishuRetry',{error})
      : tr('status.feishuRunning',{minutes:remain});
  });
}

if(window.petBridge?.onLongTaskSupervisorStatus){
  window.petBridge.onLongTaskSupervisorStatus(status=>{
    applyLongTaskSupervisorState(status);
  });
}

document.getElementById('feishu-test-btn')?.addEventListener('click',async ()=>{
  const webhook=feishuWebhookEl?.value.trim()||'';
  const hasSavedWebhook=feishuWebhookEl?.dataset.saved==='1';
  if(!window.petBridge?.setFeishuWebhook||!window.petBridge?.testFeishuSupervisor){
    if(feishuStatusEl) feishuStatusEl.textContent=tr('status.sendUnsupported');
    return;
  }
  if(!feishuAppEnabledEl?.checked&&!webhook&&!hasSavedWebhook){
    if(feishuStatusEl) feishuStatusEl.textContent=tr('status.needWebhook');
    return;
  }
  if(webhook&&!isValidFeishuWebhook(webhook)){
    if(feishuStatusEl) feishuStatusEl.textContent=tr('status.invalidWebhook');
    return;
  }
  if(feishuStatusEl) feishuStatusEl.textContent=tr('status.testSending');
  if(webhook){
    const saved=await window.petBridge.setFeishuWebhook(webhook);
    if(!saved){
      if(feishuStatusEl) feishuStatusEl.textContent=tr('status.webhookSaveFailed');
      return;
    }
    feishuWebhookEl.dataset.saved='1';
    feishuWebhookEl.value='';
  }
  const result=await sendFeishuSupervisorCheckin(true);
  if(feishuStatusEl) feishuStatusEl.textContent=result?.success?tr('status.testSent'):tr('status.sendFailed',{error:resultError(result)});
});

document.getElementById('save-btn').addEventListener('click',async ()=>{
  addLog('保存配置');
  const feishuWebhook=feishuWebhookEl?.value.trim()||'';
  const feishuEnabled=!!feishuEnabledEl?.checked;
  const feishuAppEnabled=!!feishuAppEnabledEl?.checked;
  const feishuAppId=feishuAppIdEl?.value.trim()||'';
  const feishuAppSecret=feishuAppSecretEl?.value.trim()||'';
  const feishuAppChatId=feishuChatIdEl?.value.trim()||'';
  const hermesAgentEnabled=!!hermesAgentEnabledEl?.checked;
  let hermesAgentBaseUrl=hermesAgentBaseEl?.value.trim()||'http://127.0.0.1:8642/v1';
  const hermesAgentKey=hermesAgentKeyEl?.value.trim()||'';
  const hermesAgentModel=hermesAgentModelEl?.value.trim()||'';
  const hermesEnabled=!!hermesEnabledEl?.checked;
  const longTasks=normalizeLongTasks(cfg.longTasks);
  const providerApiKey=fKey.value.trim();
  let providerBaseUrl=fBase.value.trim().replace(/\/+$/,'');
  const hasSavedWebhook=feishuWebhookEl?.dataset.saved==='1';
  const hasSavedAppSecret=feishuAppSecretEl?.dataset.saved==='1';
  if(feishuEnabled&&!feishuAppEnabled&&!feishuWebhook&&!hasSavedWebhook){
    if(feishuStatusEl) feishuStatusEl.textContent=tr('status.needWebhook');
    return;
  }
  if(feishuWebhook&&!isValidFeishuWebhook(feishuWebhook)){
    if(feishuStatusEl) feishuStatusEl.textContent=tr('status.invalidWebhook');
    return;
  }
  if(feishuAppEnabled&&(!isValidFeishuAppId(feishuAppId)||(!feishuAppSecret&&!hasSavedAppSecret))){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.needAppSecret');
    return;
  }
  if(hermesAgentEnabled){
    try{
      hermesAgentBaseUrl=normalizeHermesAgentBaseUrl(hermesAgentBaseUrl);
      if(needsHermesBaseUrlConsent(hermesAgentBaseUrl)){
        if(cfg.confirmedHermesBaseUrl!==hermesAgentBaseUrl){
          const ok=await confirmThirdPartyBaseUrl('Hermes Agent',hermesAgentBaseUrl);
          if(!ok) return;
        }
      }else{
        cfg.confirmedHermesBaseUrl='';
      }
    }catch(e){
      updateHermesAgentStatus(e.message||tr('error.hermesBase'));
      return;
    }
  }
  if(curP==='openai'&&providerBaseUrl){
    try{
      providerBaseUrl=normalizeOpenAICompatibleBaseUrl(providerBaseUrl);
      if(needsOpenAIBaseUrlConsent(providerBaseUrl)){
        if(cfg.confirmedOpenAIBaseUrl!==providerBaseUrl){
          const ok=await confirmThirdPartyBaseUrl(tr('settings.model.openaiCompatible'),providerBaseUrl);
          if(!ok) return;
        }
      }else{
        cfg.confirmedOpenAIBaseUrl='';
      }
    }catch(e){
      appendErrorMsg(e.message||tr('error.openaiBase'));
      return;
    }
  }
  if(feishuWebhook&&window.petBridge?.setFeishuWebhook){
    const saved=await window.petBridge.setFeishuWebhook(feishuWebhook);
    if(!saved){
      if(feishuStatusEl) feishuStatusEl.textContent=tr('status.webhookSaveFailed');
      return;
    }
    feishuWebhookEl.dataset.saved='1';
  }
  if(feishuAppSecret&&window.petBridge?.setFeishuAppSecret){
    const saved=await window.petBridge.setFeishuAppSecret(feishuAppSecret);
    if(!saved){
      if(feishuAppStatusEl) feishuAppStatusEl.textContent=tr('status.secretSaveFailed');
      return;
    }
    feishuAppSecretEl.dataset.saved='1';
  }
  if(hermesAgentKey&&window.petBridge?.setHermesApiKey){
    const saved=await window.petBridge.setHermesApiKey(hermesAgentKey);
    if(!saved){
      updateHermesAgentStatus(tr('error.hermesKeySave'));
      return;
    }
    hermesAgentKeyEl.dataset.saved='1';
  }
  const providerKeySaved=await saveProviderApiKeyIfNeeded(providerApiKey);
  if(!providerKeySaved){
    appendErrorMsg(tr('error.apiKeySave'));
    return;
  }
  const hasProviderKey=IS_ELECTRON?await refreshProviderKeyState(cfg.hasApiKey):!!providerApiKey;
  const confirmedOpenAIBaseUrl=curP==='openai'&&providerBaseUrl&&needsOpenAIBaseUrlConsent(providerBaseUrl)?providerBaseUrl:'';
  const confirmedHermesBaseUrl=hermesAgentEnabled&&needsHermesBaseUrlConsent(hermesAgentBaseUrl)?hermesAgentBaseUrl:'';
  cfg={p:curP,k:IS_ELECTRON?'':providerApiKey,hasApiKey:hasProviderKey,m:fModel.value.trim(),
    b:providerBaseUrl,proxy:false,freq:cfg.freq||'mid',locale:i18n?.normalizeLocale(cfg.locale)||'zh-CN',confirmedOpenAIBaseUrl,
    feishuEnabled,
    feishuInterval:normalizeFeishuInterval(feishuIntervalEl?.value),
    feishuAppEnabled,
    feishuAppId,
    feishuAppChatId,
    hermesAgentEnabled,
    hermesAgentBaseUrl,
    confirmedHermesBaseUrl,
    hermesAgentModel,
    hermesEnabled,
    longTasks};
  save();history=[];closeSettings();
  appendMsg('pet',hasKey()?tr('status.settingsSaved'):tr('status.readyHere'));
  restartFeishuAppConnection();
  restartFeishuSupervisor();
  restartLongTaskSupervisor();
  updateStatus();
});
syncSeg();updateStatus();
restartFeishuAppConnection();

/* ════════ CHAT DIALOG ════════ */
const dlg=document.getElementById('chat-dialog');
const dlgMsgs=document.getElementById('dlg-msgs');

// adjust dialog bottom when pet is dragged / window resized — keeps it just above chat bar
const BAR_H=116;
function dlgBottom(){
  dlg.style.bottom=BAR_H+'px';
}
dlgBottom();

function showDialog(){
  if(!dlg.classList.contains('visible')){
    dlg.classList.add('visible');
    document.getElementById('hint').classList.add('hidden');
  }
}

function scrollToBottom(){
  requestAnimationFrame(()=>dlgMsgs.scrollTo({top:dlgMsgs.scrollHeight,behavior:'smooth'}));
}

function fmtTime(d){
  return d.toLocaleTimeString(i18n?.getIntlLocale()||'zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
}

function escHtml(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

let thinkingEl=null;

function appendMsg(role,text,img){
  showDialog();
  // remove thinking indicator if present
  if(thinkingEl){thinkingEl.remove();thinkingEl=null;}

  const row=document.createElement('div');
  row.className=`dlg-row ${role}`;

  const timeStr=escHtml(fmtTime(new Date()));
  if(role==='pet'){
    row.innerHTML=`
      <div class="dlg-avatar">孬</div>
      <div class="dlg-msg-wrap">
        <div class="dlg-bubble"></div>
        <div class="dlg-time">${timeStr}</div>
      </div>`;
  } else {
    row.innerHTML=`
      <div class="dlg-msg-wrap">
        <div class="dlg-bubble"></div>
        <div class="dlg-time">${timeStr}</div>
      </div>`;
  }
  const bubble=row.querySelector('.dlg-bubble');
  if(img && typeof img==='string' && /^data:image\/(png|jpe?g|webp|gif);/i.test(img)){
    const im=document.createElement('img');
    im.src=img; im.alt='';
    im.style.cssText='display:block;max-width:200px;max-height:200px;border-radius:10px;margin-bottom:6px;border:1px solid rgba(74,69,57,.22)';
    bubble.appendChild(im);
  }
  if(text){
    bubble.insertAdjacentHTML('beforeend', escHtml(text));
  }
  dlgMsgs.appendChild(row);
  scrollToBottom();
}

function showThinkingIndicator(){
  if(thinkingEl) return;
  showDialog();
  thinkingEl=document.createElement('div');
  thinkingEl.className='dlg-row pet thinking-row';
  thinkingEl.innerHTML=`
    <div class="dlg-avatar">孬</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble">
        <div class="tdots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  dlgMsgs.appendChild(thinkingEl);
  scrollToBottom();
}

function removeThinking(){
  if(thinkingEl){thinkingEl.remove();thinkingEl=null;}
}

document.getElementById('dlg-clear').addEventListener('click',()=>{
  dlgMsgs.innerHTML='';
  history=[];
  dlg.classList.remove('visible');
  document.getElementById('hint').classList.remove('hidden');
});

/* ════════ API — STREAMING ════════ */
function hermesAgentMessages(userText, source='chat'){
  const label=source==='feishu'?'Feishu supervision report':'desktop chat';
  return [
    {role:'system',content:`${buildHermesSystemPrompt()}\n\nYou are connected through Nono. Keep replies short, direct, and actionable for a user with ADHD. For a Feishu report, acknowledge it and ask for one concrete action for the next 5-15 minutes.`},
    ...history.filter(item=>typeof item.content==='string').slice(-8),
    {role:'user',content:`Source: ${label}\nUser message: ${userText||''}`},
  ];
}

async function requestHermesAgentReply(userText, source='chat'){
  const messages=hermesAgentMessages(userText,source);
  if(window.petBridge?.chatHermesAgent){
    const result=await window.petBridge.chatHermesAgent({
      baseUrl:cfg.hermesAgentBaseUrl,
      allowThirdPartyBaseUrl:isConfirmedHermesBaseUrl(cfg.hermesAgentBaseUrl),
      model:hermesAgentModelName(),
      messages,
      maxTokens:220,
    });
    if(!result?.success) throw new Error(resultError(result,'error.requestFailed'));
    return String(result.text||'').trim()||summarizeFeishuReport(userText);
  }
  throw new Error(tr('error.hermesChannel'));
}

async function streamHermesAgent(msg){
  const messages=hermesAgentMessages(msg,'chat');
  history.push({role:'user',content:msg});
  if(history.length>20) history=history.slice(-20);
  if(window.petBridge?.chatHermesAgent){
    const result=await window.petBridge.chatHermesAgent({
      baseUrl:cfg.hermesAgentBaseUrl,
      allowThirdPartyBaseUrl:isConfirmedHermesBaseUrl(cfg.hermesAgentBaseUrl),
      model:hermesAgentModelName(),
      messages,
      maxTokens:240,
    });
    if(!result?.success) throw new Error(resultError(result,'error.requestFailed'));
    const full=String(result.text||'').trim()||'…';
    const fn=window._streamPatch||onStreamChunk;
    for(const chunk of full.match(/.{1,16}/gs)||[full]) fn(chunk);
    history.push({role:'assistant',content:full});
    if(full&&/(下次|以后|适合你|你可以|建议你|next|later|suggest|advice)/i.test(full)){
      addHermesMemory('reflection',`Hermes Agent 建议：${full.slice(0,120)}`,'chat',.45);
    }
    return;
  }
  throw new Error(tr('error.hermesChannel'));
}

/* ── streaming bubble state ── */
let streamBubbleEl=null;   // the <div class="dlg-bubble"> being written into
let streamAccum='';        // accumulated plain text so far

function onStreamChunk(chunk){
  if(!streamBubbleEl) return;
  streamAccum+=chunk;
  streamBubbleEl.innerHTML=escHtml(streamAccum);
  scrollToBottom();
}

function startStreamBubble(){
  /* swap out the thinking dots row for a real pet row with empty bubble */
  removeThinking();
  showDialog();
  const row=document.createElement('div');
  row.className='dlg-row pet';
  row.innerHTML=`
    <div class="dlg-avatar">孬</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble stream-bubble"></div>
      <div class="dlg-time stream-time">${fmtTime(new Date())}</div>
    </div>`;
  dlgMsgs.appendChild(row);
  streamBubbleEl=row.querySelector('.dlg-bubble');
  streamAccum='';
  scrollToBottom();
}

function finalizeStreamBubble(){
  if(streamBubbleEl) streamBubbleEl.classList.add('done');
  streamBubbleEl=null;
}

/* ════════ SEND ════════ */
const chatInput=document.getElementById('chat-input');
const sendBtn=document.getElementById('send-btn');
const pw=document.getElementById('pw');

async function send(){
  if(busy) return;
  const msg=chatInput.value.trim();
  const img=attachedImage;
  if(!msg && !img) return;
  chatInput.value='';chatInput.style.height='';
  setHappy(true);spawnHeart(px+55,py+35);
  appendMsg('user',msg,img);
  learnHermesFromText(msg,'chat');
  clearAttachment();
  privateSet('nono_last_activity', Date.now());

  if(!hasKey() && !(cfg.hermesAgentEnabled&&!img)){
    // 没有 API key，确保本地模型已加载
    if (!localModelReady) {
      const loaded = await loadLocalModel((pct, msg) => {
        updateStatus(msg || tr('model.loading'));
      });
      if (!loaded) {
        setTimeout(()=>{
          appendMsg('pet',tr('model.fallbackMessage'));
        }, 300);
        return;
      }
    }
    // 本地模型已就绪，进行推理
    busy=true;sendBtn.disabled=true;
    pw.classList.add('thinking');
    showThinkingIndicator();
    startStreamBubble();
    try {
      const response = await localInference(buildHermesLocalPrompt(msg));
      if (response) {
        onStreamChunk(response);
      } else {
        onStreamChunk(smartFallback(msg));
      }
      pw.classList.remove('thinking');
      finalizeStreamBubble();
    } catch(e) {
      pw.classList.remove('thinking');
      removeThinking();
      finalizeStreamBubble();
      appendMsg('pet', smartFallback(msg));
    } finally {
      busy=false;sendBtn.disabled=false;
    }
    return;
  }

  busy=true;sendBtn.disabled=true;
  pw.classList.add('thinking');
  showThinkingIndicator();

  /* swap to stream bubble on first chunk */
  let firstChunk=true;
  const origOnStreamChunk=onStreamChunk;
  // patch: intercept first chunk to create bubble
  const _patch=chunk=>{
    if(firstChunk){firstChunk=false;startStreamBubble();}
    origOnStreamChunk(chunk);
  };
  // temporarily override
  window._streamPatch=_patch;

  try{
    await streamAPIPatched(msg,img);
    pw.classList.remove('thinking');
    finalizeStreamBubble();
  }catch(e){
    pw.classList.remove('thinking');
    removeThinking();
    finalizeStreamBubble();
    const txt=(e&&e.message)?e.message:String(e||tr('common.unknownError'));
    appendErrorMsg(txt);
    if(history.at(-1)?.role==='user') history.pop();
    console.error('[孬孬]',e);
  }finally{busy=false;sendBtn.disabled=false;window._streamPatch=null;}
}

/* Patched wrapper that uses _streamPatch for first-chunk detection */
async function streamAPIPatched(msg,img){
  if(cfg.hermesAgentEnabled&&!img){
    await streamHermesAgent(msg);
    return;
  }
  if(!IS_ELECTRON){
    throw new Error(tr('error.desktopOnly'));
  }
  const isAnthropic=cfg.p==='anthropic';
  let userContent;
  if(img){
    if(isAnthropic){
      const m = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      const mediaType = m ? m[1] : 'image/png';
      const data = m ? m[2] : '';
      userContent = [
        { type:'image', source:{ type:'base64', media_type:mediaType, data } },
        { type:'text', text: msg || tr('error.image') }
      ];
    } else {
      userContent = [
        { type:'text', text: msg || tr('error.image') },
        { type:'image_url', image_url:{ url: img } }
      ];
    }
  } else {
    userContent = msg;
  }
  history.push({role:'user',content:userContent});
  if(history.length>20) history=history.slice(-20);
  const model=cfg.m||(isAnthropic?DEFAULT_MODEL.anthropic:DEFAULT_MODEL.openai);
  const systemPrompt=buildHermesSystemPrompt();
  if(IS_ELECTRON&&window.petBridge?.chatProvider){
    const result=await window.petBridge.chatProvider({
      provider:cfg.p,
      baseUrl:cfg.b,
      allowThirdPartyBaseUrl:cfg.p==='openai'&&!!cfg.b&&isConfirmedOpenAIBaseUrl(cfg.b),
      model,
      system:systemPrompt,
      messages:isAnthropic?history:[{role:'system',content:systemPrompt},...history],
      maxTokens:200,
    });
    if(!result?.success) throw new Error(resultError(result,'error.requestFailed'));
    const full=String(result.text||'').trim()||'…';
    const chunks=full.match(/[\s\S]{1,18}/g)||[full];
    for(const chunk of chunks){
      const fn=window._streamPatch||onStreamChunk;
      fn(chunk);
    }
    history.push({role:'assistant',content:full});
    if(full&&/(下次|以后|适合你|你可以|建议你|next|later|suggest|advice)/i.test(full)){
      addHermesMemory('reflection',`Nono suggestion: ${full.slice(0,120)}`,'chat',.45);
    }
    return;
  }
  throw new Error(tr('error.aiChannel'));
}

function appendErrorMsg(txt){
  showDialog();
  const row=document.createElement('div');
  row.className='dlg-row pet';
  row.innerHTML=`
    <div class="dlg-avatar">孬</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble" style="background:#fff0f0;border-color:#d8aaa2;color:#8f3f38;font-size:12px">${escHtml(txt)}</div>
      <div class="dlg-time">${fmtTime(new Date())}</div>
    </div>`;
  dlgMsgs.appendChild(row);
  scrollToBottom();
}

/* ════════ NON-STREAMING JSON REQUEST (for AI 拆解) ════════ */
async function requestJSON(userPrompt, systemPrompt, opt={}){
  if(!IS_ELECTRON){
    throw new Error(tr('error.desktopOnly'));
  }
  const isAnthropic=cfg.p==='anthropic';
  const model=cfg.m||(isAnthropic?DEFAULT_MODEL.anthropic:DEFAULT_MODEL.openai);
  const body=isAnthropic
    ? {model,max_tokens:800,system:systemPrompt,messages:[{role:'user',content:userPrompt}]}
    : {model,messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:userPrompt}
      ],max_tokens:800,stream:false};

  if(IS_ELECTRON&&window.petBridge?.chatProvider){
    const result=await window.petBridge.chatProvider({
      provider:cfg.p,
      baseUrl:cfg.b,
      allowThirdPartyBaseUrl:cfg.p==='openai'&&!!cfg.b&&isConfirmedOpenAIBaseUrl(cfg.b),
      model,
      system:systemPrompt,
      messages:body.messages,
      maxTokens:800,
    });
    if(!result?.success) throw new Error(resultError(result,'error.requestFailed'));
    return String(result.text||'');
  }
  throw new Error(tr('error.aiChannel'));
}

function parseStepsLoose(s){
  if(!s) return [];
  let txt=String(s).trim();
  // 剥代码围栏
  txt=txt.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  // 1) 直接 JSON.parse
  try{
    const obj=JSON.parse(txt);
    if(Array.isArray(obj?.steps)) return obj.steps.map(x=>String(x)).map(t=>t.trim()).filter(Boolean).slice(0,5);
    if(Array.isArray(obj)) return obj.map(x=>String(x)).map(t=>t.trim()).filter(Boolean).slice(0,5);
  }catch(_){}
  // 2) 抓首个 { ... }
  const m=txt.match(/\{[\s\S]*\}/);
  if(m){
    try{
      const obj=JSON.parse(m[0]);
      if(Array.isArray(obj?.steps)) return obj.steps.map(x=>String(x)).map(t=>t.trim()).filter(Boolean).slice(0,5);
    }catch(_){}
  }
  // 3) 按行切，剥 markdown 标记
  const lines=txt.split(/\r?\n/).map(l=>{
    return l.replace(/^[\s\-\*•·]+/,'').replace(/^\d+[\.\)、]\s*/,'').replace(/^["「『]/,'').replace(/["」』]$/,'').trim();
  }).filter(Boolean);
  return lines.slice(0,5);
}

const BREAKDOWN_SYS = `You break a task into 3-5 concrete, sequential, actionable steps.
Output ONLY JSON, no prose, no code fences:
{"steps":["step1","step2","step3"]}
Each step: imperative and concise (at most 40 characters),
specific enough to start in <2 minutes. Match the language of the input.`;

async function requestBreakdown(taskId, confirmReplace){
  const t=TaskStore.state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  if(!hasKey()){
    _toastByTaskId[taskId]=tr('task.needApiKey');
    renderTasks();return;
  }
  // 已有子步骤 → 弹框确认替换
  if(!confirmReplace && t.subtasks.length>0){
    const ok = await petDialog.confirm(
      tr('dialog.replaceStepsMessage',{title:t.title,count:t.subtasks.length}),
      { title:tr('dialog.replaceStepsTitle'), okText:tr('dialog.replace'), cancelText:tr('dialog.keep') });
    if(!ok) return;
  }
  _aiBusyTaskId=taskId;
  delete _toastByTaskId[taskId];
  renderTasks();
  addLog(`开始拆解任务: ${t.title}`);
  try{
    const raw=await requestJSON(t.title, BREAKDOWN_SYS, {timeoutMs:120000});
    addLog(`拆解结果: ${raw.substring(0,100)}${raw.length>100?'...':''}`);
    const steps=parseStepsLoose(raw);
    if(!steps.length){
      _toastByTaskId[taskId]=tr('task.invalidAiResult');
      addLog('AI 没返回有效结果');
    } else {
      TaskStore.setSubtasks(taskId, steps);
      addLog(`拆解成功，得到 ${steps.length} 个步骤`);
    }
  }catch(e){
    _toastByTaskId[taskId]=tr('task.breakdownFailed',{error:e.message||tr('common.unknownError')});
    addLog('拆解失败: '+e.message);
  }finally{
    _aiBusyTaskId=null;
    renderTasks();
  }
}

sendBtn.addEventListener('click',send);
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
chatInput.addEventListener('input',()=>{chatInput.style.height='auto';chatInput.style.height=Math.min(chatInput.scrollHeight,110)+'px';});
chatInput.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
chatInput.addEventListener('mousedown',e=>e.stopPropagation());

/* ════════ PHOTO UPLOAD ════════ */
let attachedImage = null;
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const imgPreviewArea = document.getElementById('img-preview-area');
const imgPreviewThumb = document.getElementById('img-preview-thumb');
const imgPreviewRemove = document.getElementById('img-preview-remove');

function clearAttachment(){
  attachedImage = null;
  if(fileInput) fileInput.value = '';
  if(imgPreviewArea) imgPreviewArea.classList.remove('visible');
  if(imgPreviewThumb) imgPreviewThumb.src = '';
  if(attachBtn) attachBtn.classList.remove('has-img');
}
if(attachBtn && fileInput){
  attachBtn.addEventListener('click', ()=>fileInput.click());
  fileInput.addEventListener('change', ()=>{
    const f = fileInput.files && fileInput.files[0];
    if(!f) return;
    const ALLOWED = ['image/png','image/jpeg','image/webp','image/gif'];
    if(!ALLOWED.includes(f.type)){ petDialog.alert(tr('dialog.imageTypeMessage'), { title:tr('dialog.imageTypeTitle') }); fileInput.value=''; return; }
    if(f.size > 4*1024*1024){ petDialog.alert(tr('dialog.imageLargeMessage'), { title:tr('dialog.imageLargeTitle') }); fileInput.value=''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const url = e.target.result;
      // Belt-and-suspenders: confirm the data URL prefix matches what we accepted
      if(typeof url !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);/i.test(url)){
        petDialog.alert(tr('dialog.imageReadMessage'), { title:tr('dialog.imageReadTitle') }); fileInput.value=''; return;
      }
      attachedImage = url;
      imgPreviewThumb.src = attachedImage;
      imgPreviewArea.classList.add('visible');
      attachBtn.classList.add('has-img');
    };
    reader.readAsDataURL(f);
  });
}
if(imgPreviewRemove){
  imgPreviewRemove.addEventListener('click', clearAttachment);
}

/* ════════ TASK STORE ════════ */
const TASKS_KEY='nono_tasks';
const MAX_TASKS=20, MAX_SUBS=8, MAX_TITLE=60;

const TaskStore = (()=>{
  let state={version:1,activeId:null,tasks:[]};
  const subs=[];
  let saveTimer=null;

  function genId(p){return p+'_'+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3);}
  function notify(){subs.forEach(fn=>{try{fn(state);}catch(e){console.error(e);}});}
  function scheduleSave(){
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      try{privateSet(TASKS_KEY,JSON.stringify(state));}catch(e){console.error(e);}
      // 镜像写回 zt_task：active 任务的 title（兼容已发布的气泡逻辑）
      const a=getActive();
      privateSet('nono_task', a?a.title:'');
    },200);
  }
  function getActive(){return state.tasks.find(t=>t.id===state.activeId)||null;}
  function load(){
    try{
      const raw=privateGet(TASKS_KEY,'');
      if(raw){state=JSON.parse(raw); if(!state.tasks)state.tasks=[]; return;}
    }catch(e){console.warn('TaskStore load failed',e);}
    // 迁移：旧 zt_task 字符串 → 第一条任务
    const old=(privateGet('nono_task','')||'').trim();
    if(old){
      const t={id:genId('t'),title:old.slice(0,MAX_TITLE),subtasks:[],createdAt:Date.now(),done:false};
      state={version:1,activeId:t.id,tasks:[t]};
      scheduleSave();
    }
  }

  function addTask(title){
    title=(title||'').trim().slice(0,MAX_TITLE);
    if(!title) return null;
    if(state.tasks.length>=MAX_TASKS) return null;
    const t={id:genId('t'),title,subtasks:[],createdAt:Date.now(),done:false};
    state.tasks.unshift(t);
    state.activeId=t.id;
    scheduleSave();notify();
    return t;
  }
  function removeTask(id){
    const i=state.tasks.findIndex(t=>t.id===id);
    if(i<0) return;
    state.tasks.splice(i,1);
    if(state.activeId===id){
      state.activeId=state.tasks[0]?state.tasks[0].id:null;
    }
    scheduleSave();notify();
  }
  function renameTask(id,title){
    const t=state.tasks.find(x=>x.id===id);if(!t) return;
    t.title=(title||'').trim().slice(0,MAX_TITLE);
    scheduleSave();notify();
  }
  function setActive(id){
    if(state.activeId===id) return;
    state.activeId=id;
    scheduleSave();notify();
  }
  function setTaskDone(id,done){
    const t=state.tasks.find(x=>x.id===id);if(!t) return;
    t.done=!!done;
    scheduleSave();notify();
  }
  function setSubtasks(id,arr){
    const t=state.tasks.find(x=>x.id===id);if(!t) return;
    t.subtasks=arr.slice(0,MAX_SUBS).map(text=>({
      id:genId('s'),text:String(text||'').trim().slice(0,80),done:false
    })).filter(s=>s.text);
    scheduleSave();notify();
  }
  function addSub(id,text){
    const t=state.tasks.find(x=>x.id===id);if(!t) return;
    if(t.subtasks.length>=MAX_SUBS) return;
    text=(text||'').trim().slice(0,80);
    if(!text) return;
    t.subtasks.push({id:genId('s'),text,done:false});
    scheduleSave();notify();
  }
  function renameSub(taskId,subId,text){
    const t=state.tasks.find(x=>x.id===taskId);if(!t) return;
    const s=t.subtasks.find(x=>x.id===subId);if(!s) return;
    s.text=(text||'').trim().slice(0,80);
    scheduleSave();notify();
  }
  function toggleSub(taskId,subId){
    const t=state.tasks.find(x=>x.id===taskId);if(!t) return;
    const s=t.subtasks.find(x=>x.id===subId);if(!s) return;
    s.done=!s.done;
    scheduleSave();notify();
  }
  function removeSub(taskId,subId){
    const t=state.tasks.find(x=>x.id===taskId);if(!t) return;
    t.subtasks=t.subtasks.filter(x=>x.id!==subId);
    scheduleSave();notify();
  }
  function nextUnchecked(taskId){
    const t=state.tasks.find(x=>x.id===taskId);if(!t) return null;
    return t.subtasks.find(s=>!s.done)||null;
  }
  function onChange(fn){subs.push(fn);return ()=>{const i=subs.indexOf(fn);if(i>=0)subs.splice(i,1);};}

  load();
  return {get state(){return state;}, getActive, addTask, removeTask, renameTask,
    setActive, setTaskDone, setSubtasks, addSub, renameSub, toggleSub, removeSub,
    nextUnchecked, onChange};
})();

// `currentTask` 是只读的兼容引用：任何旧代码读它，都能拿到 active 任务的标题
Object.defineProperty(window,'currentTask',{
  get(){return TaskStore.getActive()?.title || '';}
});

/* ════════ TASK LIST UI ════════ */
const taskListEl=document.getElementById('task-list');
const taskRowsEl=document.getElementById('task-rows');
const taskAddInput=document.getElementById('task-add-input');

if(taskAddInput){
  taskAddInput.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
  taskAddInput.addEventListener('mousedown',e=>e.stopPropagation());
  taskAddInput.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      const v=taskAddInput.value.trim();
      if(!v) return;
      const t=TaskStore.addTask(v);
      if(!t){
        taskAddInput.placeholder=tr('chat.taskLimit',{max:MAX_TASKS});
        setTimeout(()=>{taskAddInput.placeholder=tr('chat.taskPlaceholder');},2000);
        return;
      }
      taskAddInput.value='';
      privateSet('nono_last_activity', Date.now());
    }
  });
}

let _expandedTaskId=null; // 仅 active 默认展开；用户可单独展开其他任务
function isExpanded(taskId, isActive){
  return _expandedTaskId===taskId || (isActive && _expandedTaskId===null);
}

let _aiBusyTaskId=null;
let _toastByTaskId={}; // {taskId: 'msg'}

function escAttr(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function renderTasks(){
  if(!taskRowsEl) return;
  const {tasks,activeId}=TaskStore.state;
  if(!tasks.length){
    taskRowsEl.innerHTML=`<div id="task-empty">${tr('task.empty')}</div>`;
    return;
  }
  // 排序：active 置顶，然后按 createdAt 倒序
  const ordered=[...tasks].sort((a,b)=>{
    if(a.id===activeId) return -1;
    if(b.id===activeId) return 1;
    return b.createdAt-a.createdAt;
  });
  taskRowsEl.innerHTML='';
  ordered.forEach(t=>{
    const isAct=t.id===activeId;
    const exp=isExpanded(t.id, isAct);
    const total=t.subtasks.length;
    const done=t.subtasks.filter(s=>s.done).length;
    const row=document.createElement('div');
    row.className='tl-row'+(isAct?' active':'')+(t.done?' done':'')+(exp?' expanded':'');
    row.dataset.id=t.id;

    const progress = total>0 ? `<span class="tl-progress">${done}/${total}</span>` : '';
    row.innerHTML = `
      <div class="tl-head" data-act="activate">
        <span class="tl-dot"></span>
        <span class="tl-title" data-act="title">${escHtml(t.title)}</span>
        ${progress}
        <button class="tl-menu-btn" data-act="menu" aria-label="${tr('task.menu')}">⋯</button>
      </div>
      <div class="tl-subs">
        ${t.subtasks.map(s=>`
          <div class="tl-sub${s.done?' done':''}" data-sub-id="${escAttr(s.id)}">
            <div class="tl-check${s.done?' on':''}" data-act="toggle"></div>
            <span class="tl-sub-text" data-act="sub-text">${escHtml(s.text)}</span>
            <button class="tl-sub-del" data-act="sub-del" aria-label="${tr('task.deleteSubtask')}">✕</button>
          </div>
        `).join('')}
        ${_aiBusyTaskId===t.id ? `
          <div class="tl-shimmer">
            <div class="tl-shimmer-row" style="width:80%"></div>
            <div class="tl-shimmer-row" style="width:60%"></div>
            <div class="tl-shimmer-row" style="width:72%"></div>
            <div class="tl-shimmer-tip">${tr('task.aiWorking')}</div>
          </div>
        ` : ''}
        ${_toastByTaskId[t.id] ? `
          <div class="tl-toast">
            <span>${escHtml(_toastByTaskId[t.id])}</span>
            <button data-act="retry">${tr('common.retry')}</button>
            <button data-act="toast-close">${tr('common.dismiss')}</button>
          </div>
        ` : ''}
        <div class="tl-actions">
          ${(hasKey() && _aiBusyTaskId!==t.id) ? `<button class="tl-btn primary" data-act="ai">${tr('task.aiBreakdown')}</button>`:''}
          ${t.subtasks.length<MAX_SUBS ? `<button class="tl-btn" data-act="add-sub">${tr('task.addSubtask')}</button>`:''}
        </div>
      </div>
    `;
    taskRowsEl.appendChild(row);
  });
}

// 委托点击
if(taskRowsEl){
  taskRowsEl.addEventListener('click',e=>{
    const row=e.target.closest('.tl-row');
    if(!row) return;
    const taskId=row.dataset.id;
    const act=e.target.closest('[data-act]')?.dataset.act;

    if(act==='menu'){ e.stopPropagation(); openTaskMenu(e.currentTarget, e.target.closest('.tl-menu-btn'), taskId); return; }
    if(act==='toggle'){
      const subId=e.target.closest('.tl-sub')?.dataset.subId;
      if(subId) TaskStore.toggleSub(taskId,subId);
      privateSet('nono_last_activity', Date.now());
      return;
    }
    if(act==='sub-del'){
      const subId=e.target.closest('.tl-sub')?.dataset.subId;
      if(subId) TaskStore.removeSub(taskId,subId);
      return;
    }
    if(act==='sub-text'){
      e.stopPropagation();
      const subId=e.target.closest('.tl-sub')?.dataset.subId;
      makeEditable(e.target, txt=>TaskStore.renameSub(taskId,subId,txt));
      return;
    }
    if(act==='title'){
      e.stopPropagation();
      makeEditable(e.target, txt=>TaskStore.renameTask(taskId,txt));
      return;
    }
    if(act==='ai'){
      e.stopPropagation();
      requestBreakdown(taskId, /*confirmReplace=*/false);
      return;
    }
    if(act==='retry'){
      e.stopPropagation();
      delete _toastByTaskId[taskId];
      requestBreakdown(taskId, false);
      return;
    }
    if(act==='toast-close'){
      e.stopPropagation();
      delete _toastByTaskId[taskId];
      renderTasks();
      return;
    }
    if(act==='add-sub'){
      e.stopPropagation();
      petDialog.prompt(tr('dialog.addSubtaskMessage'),
        { title:tr('dialog.addSubtaskTitle'), placeholder:tr('dialog.addSubtaskPlaceholder'), okText:tr('common.add').replace(/^\+\s*/, '') })
        .then(text=>{ if(text) TaskStore.addSub(taskId, text); });
      return;
    }
    if(act==='activate'){
      // 切换 active；若已是 active，则切换展开
      if(TaskStore.state.activeId===taskId){
        _expandedTaskId = (_expandedTaskId===taskId) ? '__none__' : taskId;
        renderTasks();
      } else {
        _expandedTaskId=null; // 让新 active 默认展开
        TaskStore.setActive(taskId);
        privateSet('nono_last_activity', Date.now());
      }
    }
  });
}

function makeEditable(span, onCommit){
  if(span.getAttribute('contenteditable')==='true') return;
  const orig=span.textContent;
  span.setAttribute('contenteditable','true');
  span.focus();
  // 选中全部
  const sel=window.getSelection(); const r=document.createRange();
  r.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(r);
  function commit(){
    span.removeAttribute('contenteditable');
    const v=span.textContent.trim();
    span.textContent=v || orig;
    if(v && v!==orig) onCommit(v);
    span.removeEventListener('blur',commit);
    span.removeEventListener('keydown',onKey);
  }
  function onKey(e){
    if(e.key==='Enter'){e.preventDefault(); span.blur();}
    if(e.key==='Escape'){span.textContent=orig; span.blur();}
  }
  span.addEventListener('blur',commit);
  span.addEventListener('keydown',onKey);
}

let _menuPop=null;
function closeMenu(){if(_menuPop){_menuPop.remove();_menuPop=null;}}
document.addEventListener('click',closeMenu);

function openTaskMenu(container, btn, taskId){
  closeMenu();
  const t=TaskStore.state.tasks.find(x=>x.id===taskId);if(!t) return;
  _menuPop=document.createElement('div');
  _menuPop.className='tl-menu-pop';
  _menuPop.innerHTML=`
    <button data-m="rename">${tr('task.rename')}</button>
    <button data-m="toggle-done">${t.done?tr('task.restore'):tr('task.markDone')}</button>
    <button data-m="delete" class="danger">${tr('task.delete')}</button>
  `;
  document.body.appendChild(_menuPop);
  const r=btn.getBoundingClientRect();
  _menuPop.style.top=(r.bottom+4)+'px';
  _menuPop.style.left=Math.max(8, r.right-_menuPop.offsetWidth)+'px';
  _menuPop.addEventListener('click', async e=>{
    e.stopPropagation();
    const m=e.target.dataset.m;
    if(m==='rename'){
      const titleEl=container.querySelector(`.tl-row[data-id="${taskId}"] .tl-title`);
      if(titleEl) makeEditable(titleEl, txt=>TaskStore.renameTask(taskId,txt));
      closeMenu();
    } else if(m==='toggle-done'){
      TaskStore.setTaskDone(taskId, !t.done);
      closeMenu();
    } else if(m==='delete'){
      closeMenu();
      const ok = await petDialog.confirm(tr('dialog.deleteTaskMessage',{title:t.title}),
        { title:tr('dialog.deleteTaskTitle'), danger:true, okText:tr('common.delete'), cancelText:tr('dialog.thinkAgain') });
      if(ok) TaskStore.removeTask(taskId);
    } else {
      closeMenu();
    }
  });
}

TaskStore.onChange(()=>{
  renderTasks();
  scheduleFeishuSupervisorSync();
});
renderTasks();

/* ════════ POMODORO ════════ */
const POMO_WORK=25*60, POMO_BREAK=5*60;
let pomoMode='work';   // 'work' | 'break'
let pomoLeft=POMO_WORK;
let pomoTotal=POMO_WORK;
let pomoRunning=false;
let pomoCount=0;
let pomoTick=null;
let pomoEndAt=null;

const pomoWidget=document.getElementById('pomo-widget');
const pomoToggle=document.getElementById('pomo-toggle');
const pomoTimeEl=document.getElementById('pomo-time');
const pomoFill=document.getElementById('pomo-fill');
const pomoModeEl=document.getElementById('pomo-mode');
const pomoCountEl=document.getElementById('pomo-count');
const pomoStartBtn=document.getElementById('pomo-start');
const pomoResetBtn=document.getElementById('pomo-reset');

function fmtPomo(s){
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function renderPomo(){
  pomoTimeEl.textContent=fmtPomo(pomoLeft);
  const pct=100*(1-pomoLeft/pomoTotal);
  pomoFill.style.width=pct+'%';
  pomoModeEl.textContent=pomoMode==='work'?tr('pomo.focus'):tr('pomo.break');
  pomoCountEl.textContent=`● × ${pomoCount}`;
  pomoWidget.classList.toggle('break-mode',pomoMode==='break');
  pomoStartBtn.textContent=pomoRunning?tr('common.pause'):tr('common.start');
  pomoStartBtn.classList.toggle('running',pomoRunning);
}

function pomoComplete(){
  clearInterval(pomoTick);pomoTick=null;pomoRunning=false;pomoEndAt=null;
  if(window.setKoalaFocusing) window.setKoalaFocusing(false);
  pw.classList.remove('bd-pomo-lock');
  if(pomoMode==='work'){
    pomoCount++;
    StatsStore.recordPomo(POMO_WORK);
    pomoMode='break';pomoLeft=POMO_BREAK;pomoTotal=POMO_BREAK;
    spawnHeart(px+55,py+35);
    const act=TaskStore.getActive();
    const head=act?tr('pomo.taskComplete',{title:act.title}):tr('pomo.focusComplete');
    const next=act?TaskStore.nextUnchecked(act.id):null;
    if(next){
      appendPomoNext(head, act.id, next.id, next.text);
    } else {
      appendMsg('pet',tr('pomo.takeBreak',{head}));
      setTimeout(()=>promptMood(),800);
    }
  } else {
    pomoMode='work';pomoLeft=POMO_WORK;pomoTotal=POMO_WORK;
    appendMsg('pet',tr('pomo.breakOver'));
  }
  renderPomo();
}

/* ════════ STATS STORE ════════ */
const STATS_KEY='nono_stats';const STATS_VERSION=1;
function localDateKey(date=new Date()){
  const d=new Date(date);
  d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}
const StatsStore={
  read(){try{let d=JSON.parse(privateGet(STATS_KEY,'null'));return d&&d.version===STATS_VERSION?d:null}catch(e){return null}},
  write(data){data.version=STATS_VERSION;privateSet(STATS_KEY,JSON.stringify(data))},
  init(){const d=this.read();if(d)return d;const n={version:STATS_VERSION,pomodoro:{records:[]},fridge:{frozen:0,retrieved:0,records:[]}};this.write(n);return n},
  recordPomo(durationSeconds=POMO_WORK){const d=this.init();const now=new Date();d.pomodoro.records.push({date:localDateKey(now),duration:durationSeconds,completedAt:now.toISOString()});this.write(d)},
  todayPomos(){const d=this.init();const td=localDateKey();return d.pomodoro.records.filter(r=>r.date===td).length},
  weekPomos(){const d=this.init();const now=new Date();const day=now.getDay()||7;now.setHours(0,0,0,0);const mon=new Date(now);mon.setDate(now.getDate()-day+1);const ms=localDateKey(mon);return d.pomodoro.records.filter(r=>r.date>=ms).length},
  totalFocusMin(){const d=this.init();return Math.round(d.pomodoro.records.reduce((s,r)=>s+r.duration,0)/60)},
  streakDays(){const d=this.init();if(!d.pomodoro.records.length)return 0;const dates=[...new Set(d.pomodoro.records.map(r=>r.date))];const today=localDateKey();let streak=0;let check=new Date();while(true){const ds=localDateKey(check);if(dates.includes(ds)){streak++;check.setDate(check.getDate()-1)}else{if(ds===today){check.setDate(check.getDate()-1);continue}break}}return streak},
  dailyMap(days){const d=this.init();const m={};for(let i=0;i<days;i++){const dt=new Date();dt.setDate(dt.getDate()-i);m[localDateKey(dt)]=0}d.pomodoro.records.forEach(r=>{if(m[r.date]!==undefined)m[r.date]++});return m},
  calendarWeeks(){const today=new Date();const todayKey=localDateKey(today);const day=today.getDay()||7;const mon=new Date(today);mon.setHours(0,0,0,0);mon.setDate(today.getDate()-day+1);const start=new Date(mon);start.setDate(start.getDate()-21);const m=this.dailyMap(30);const weeks=[];const cursor=new Date(start);for(let w=0;w<4;w++){const row=[];for(let d=0;d<7;d++){const ds=localDateKey(cursor);row.push({date:ds,count:m[ds]||0,today:ds===todayKey,future:cursor>today});cursor.setDate(cursor.getDate()+1)}weeks.push(row)}return weeks}
};

/* ════════ STATS RENDERER ════════ */
const StatsRenderer={
  renderAll(){
    this.renderPomoCard();
    this.renderCalendar();
    this.renderFridgeCard();
    this.renderTrend();
  },
  renderPomoCard(){
    const el=document.getElementById('stats-pomo-card');
    const today=StatsStore.todayPomos();
    const week=StatsStore.weekPomos();
    const total=StatsStore.totalFocusMin();
    const streak=StatsStore.streakDays();
    el.innerHTML=today===0 && week===0
      ?`<div class="stat-empty">${escHtml(tr('stats.noPomodoro'))}</div>`
      :`<div class="stat-numbers"><div class="stat-big">◉ ${streak}</div><div class="stat-label">${tr('stats.streak')}</div></div>
         <div class="stat-row"><span>${tr('stats.today')}</span><strong>${tr('stats.times',{count:today})}</strong><span>${tr('stats.week')}</span><strong>${tr('stats.times',{count:week})}</strong></div>
         <div class="stat-row">${tr('stats.totalFocus',{minutes:`<strong>${total}</strong>`})}</div>`;
  },
  renderCalendar(){
    const el=document.getElementById('stats-cal');
    const weeks=StatsStore.calendarWeeks();
    let h='<div class="cal-grid">';
    const labels=Array.from({length:7},(_,index)=>new Intl.DateTimeFormat(i18n?.getIntlLocale(),{weekday:'narrow'}).format(new Date(2024,0,index+1)));
    h+='<div class="cal-row cal-hdr">'+labels.map(l=>`<div class="cal-cell cal-label">${l}</div>`).join('')+'</div>';
    weeks.forEach(w=>{
      h+='<div class="cal-row">'+w.map(d=>{
        let cls='cal-cell';
        if(d.future) cls+=' cal-future';
        else if(d.count>0) cls+=' cal-done';
        else cls+=' cal-empty';
        if(d.today) cls+=' cal-today';
        return `<div class="${cls}" title="${d.date}: ${tr('stats.times',{count:d.count})}">${d.count>0?'●':''}</div>`;
      }).join('')+'</div>';
    });
    h+='</div>';
    el.innerHTML=h;
  },
  renderFridgeCard(){
    const el=document.getElementById('stats-fridge-card');
    const total=freezerItems.length;
    el.innerHTML=total===0
      ?`<div class="stat-empty">${escHtml(tr('stats.noIdeas'))}<br><small>${tr('stats.noIdeasHint')}</small></div>`
      :`<div class="stat-numbers"><div class="stat-big">◇ ${total}</div><div class="stat-label">${tr('stats.frozenIdeas')}</div></div>
         <div class="stat-row">${tr('stats.latest')}<strong>${escHtml((freezerItems[0]?.text||'').slice(0,20))}</strong></div>`;
  },
  renderTrend(){
    const el=document.getElementById('stats-trend');
    const m=StatsStore.dailyMap(this.trendDays);
    const days=Object.keys(m).sort();
    const max=Math.max(...Object.values(m),1);
    let h=`<div class="trend-header">${tr('stats.trendDays',{days:this.trendDays})} <button class="trend-switch">${tr('stats.switchDays',{days:this.trendDays===7?30:7})}</button></div>
           <div class="trend-bars">`;
    days.forEach(d=>{
      const v=m[d];const pct=(v/max*100).toFixed(0);
      const label=d.slice(5);
      h+=`<div class="trend-bar-wrap"><div class="trend-bar" style="height:${pct}%" title="${d}: ${tr('stats.times',{count:v})}"></div><span class="trend-label">${label}</span></div>`;
    });
    h+='</div>';
    const mm=getMoodTrend(this.trendDays);
    const me={3:tr('stats.stable'),2:tr('stats.medium'),1:tr('stats.low')};
    h+='<div class="mood-row">'+days.map(d=>`<span class="mood-dot">${mm[d]?me[mm[d]]:''}</span>`).join('')+'</div>';
    el.innerHTML=h;
    setTimeout(()=>{const btn=document.querySelector('#stats-trend .trend-switch');if(btn)btn.addEventListener('click',()=>StatsRenderer.switchTrend(StatsRenderer.trendDays===7?30:7));},0);
  },
  trendDays:7,
  switchTrend(days){this.trendDays=days;this.renderTrend();}
};

/* ════════ STATS DRAWER EVENTS ════════ */
function toggleStatsDrawer(forceOpen){
  const d=document.getElementById('stats-drawer');
  const o=document.getElementById('stats-overlay');
  if(!d||!o) return;
  const open=d.classList.contains('open');
  const nextOpen=typeof forceOpen==='boolean'?forceOpen:!open;
  if(!nextOpen){d.classList.remove('open');o.style.display='none'}
  else{StatsRenderer.renderAll();d.classList.add('open');o.style.display='block'}
}
document.getElementById('stats-toggle')?.addEventListener('click',()=>{
  toggleStatsDrawer();
});
taskListEl?.addEventListener('click',e=>{
  if(e.target.closest('#task-add-row,.tl-row,button,input,textarea,a,[contenteditable="true"]')) return;
  toggleStatsDrawer(true);
});
document.getElementById('stats-overlay').addEventListener('click',()=>{
  toggleStatsDrawer(false);
});
document.getElementById('stats-close').addEventListener('click',()=>{
  toggleStatsDrawer(false);
});

/* ════════ BODY DOUBLE ════════ */
let bdOn=localStorage.getItem('nono_bd')==='1';
const bdBtn=document.getElementById('body-double-btn');
const bdBadge=document.getElementById('bd-badge');

const updateBD=(persist=true)=>{
  bdBtn?.classList.toggle('on',bdOn);
  bdBadge?.classList.toggle('show',bdOn);
  pw?.classList.toggle('bodydouble',bdOn);
  const _h=document.getElementById('bd-hat');if(_h)_h.classList.toggle('show',bdOn);
  if(persist)localStorage.setItem('nono_bd',bdOn?'1':'0');
  if(bdOn&&pomoRunning&&pomoMode==='work'){pw.classList.add('bd-pomo-lock')}
  else if(!bdOn||!pomoRunning){pw.classList.remove('bd-pomo-lock')}
};
bdBtn.addEventListener('click',()=>{
  bdOn=!bdOn;updateBD();
  if(bdOn)appendMsg('pet',tr('bodyDouble.active'));
});
window.addEventListener('storage',e=>{
  if(e.key==='nono_bd'){
    bdOn=e.newValue==='1';
    updateBD(false);
  }
});
updateBD();

/* ════════ FREEZER ════════ */
let freezerItems=JSON.parse(privateGet('nono_freezer','[]'));
const fzDrawer=document.getElementById('freezer-drawer');
const fzOverlay=document.getElementById('freezer-overlay');
const fzList=document.getElementById('freezer-list');
const fzEmpty=document.getElementById('freezer-empty');
const fzInput=document.getElementById('freezer-input');
const fzBtn=document.getElementById('freezer-btn');

const updateFreezer=()=>{privateSet('nono_freezer',JSON.stringify(freezerItems));fzBtn.setAttribute('data-count',freezerItems.length);renderFreezerList()};
const freezeIdea=(text)=>{if(!text.trim())return;freezerItems.unshift({id:'fz_'+Date.now(),text:text.trim(),frozenAt:new Date().toISOString()});updateFreezer();fzInput.value=''};
const thawIdea=(id)=>{freezerItems=freezerItems.filter(i=>i.id!==id);updateFreezer()};
const useIdea=(id)=>{const item=freezerItems.find(i=>i.id===id);if(!item)return;const taskInput=document.getElementById('task-add-input');if(taskInput){taskInput.value=item.text;taskInput.focus();taskInput.dispatchEvent(new Event('input',{bubbles:true}))}thawIdea(id);closeFreezer()};
const renderFreezerList=()=>{fzList.innerHTML='';if(freezerItems.length===0){fzEmpty.style.display='block';fzList.style.display='none'}else{fzEmpty.style.display='none';fzList.style.display='flex';freezerItems.forEach(item=>{const el=document.createElement('div');el.className='fz-item';el.innerHTML=`<span class="fz-text"></span><button class="fz-use" title="${tr('freezer.use')}">⌖</button><button class="fz-thaw" title="${tr('freezer.thaw')}">✕</button>`;el.querySelector('.fz-text').textContent=item.text;el.querySelector('.fz-use').addEventListener('click',()=>useIdea(item.id));el.querySelector('.fz-thaw').addEventListener('click',()=>thawIdea(item.id));fzList.appendChild(el)})}};
const openFreezer=()=>{renderFreezerList();fzDrawer.classList.add('open');fzOverlay.style.display='block';fzBtn.classList.add('active')};
const closeFreezer=()=>{fzDrawer.classList.remove('open');fzOverlay.style.display='none';fzBtn.classList.remove('active')};

fzBtn.addEventListener('click',()=>{fzDrawer.classList.contains('open')?closeFreezer():openFreezer()});
fzOverlay.addEventListener('click',closeFreezer);
document.getElementById('freezer-close').addEventListener('click',closeFreezer);
document.getElementById('freezer-add').addEventListener('click',()=>freezeIdea(fzInput.value));
fzInput.addEventListener('keydown',e=>{if(e.key==='Enter'){freezeIdea(fzInput.value);e.preventDefault()}});
updateFreezer();

/* ════════ MOOD JOURNAL ════════ */
const MOOD_KEY='nono_mood';
let moodJournal=JSON.parse(privateGet(MOOD_KEY,'[]'));
const saveMood=()=>privateSet(MOOD_KEY,JSON.stringify(moodJournal));
const promptMood=()=>{
  const row=document.createElement('div');row.className='mood-prompt';
  row.innerHTML=`<span>${tr('mood.question')}</span><button data-m="great">${tr('stats.stable')}</button><button data-m="ok">${tr('stats.medium')}</button><button data-m="low">${tr('stats.low')}</button>`;
  row.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    moodJournal.push({mood:b.dataset.m,date:localDateKey(),ts:Date.now()});
    saveMood();
    row.innerHTML=`<span style="opacity:.7">${tr('mood.recorded',{mood:b.textContent})}</span>`;
  }));
  dlgMsgs.appendChild(row);dlgMsgs.scrollTop=dlgMsgs.scrollHeight;
};
const getMoodTrend=(days=7)=>{
  const m={};for(let i=0;i<days;i++){const d=new Date();d.setDate(d.getDate()-i);m[localDateKey(d)]=null}
  moodJournal.forEach(r=>{if(m[r.date]!==undefined){const v=r.mood==='great'?3:r.mood==='ok'?2:1;m[r.date]=v}});
  return m;
};

// 原有 pomodoro 事件监听
function appendPomoNext(head, taskId, subId, subText){
  showDialog();
  const row=document.createElement('div');
  row.className='dlg-row pet';
  row.innerHTML=`
    <div class="dlg-avatar">●</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble"></div>
      <div class="dlg-time">${fmtTime(new Date())}</div>
    </div>`;
  dlgMsgs.appendChild(row);
  const bubble=row.querySelector('.dlg-bubble');
  const doneList=[]; // 已经在这条消息里勾掉的子步骤文本

  function render(currentSub){
    const checks=doneList.map(t=>`<div style="color:var(--green)">✓ ${escHtml(t)}</div>`).join('');
    if(currentSub){
      bubble.innerHTML=`${escHtml(head)}${checks}<br>${tr('pomo.next')}<b>${escHtml(currentSub.text)}</b>
        <div class="pomo-next-act">
          <button class="pomo-next-do">${tr('pomo.completeStep')}</button>
          <button class="pomo-next-skip">${tr('pomo.skip')}</button>
        </div>`;
      bubble.querySelector('.pomo-next-do').addEventListener('click',()=>{
        TaskStore.toggleSub(taskId,currentSub.id);
        doneList.push(currentSub.text);
        const nxt=TaskStore.nextUnchecked(taskId);
        render(nxt);
      });
      bubble.querySelector('.pomo-next-skip').addEventListener('click',()=>{
        bubble.querySelector('.pomo-next-act')?.remove();
      });
    } else {
      bubble.innerHTML=`${escHtml(head)}${checks}<br>${tr('pomo.allDone')}`;
    }
  }
  render({id:subId, text:subText});
  scrollToBottom();
}

// ── Intention capture: gentle ADHD scaffolding before pomodoro starts ──
const pomoIntent      = document.getElementById('pomo-intent');
const pomoIntentInput = document.getElementById('pomo-intent-input');
const pomoIntentSkip  = document.getElementById('pomo-intent-skip');
const pomoIntentGo    = document.getElementById('pomo-intent-go');

function showIntentPrompt(){
  pomoIntent.hidden = false;
  pomoIntentInput.value = '';
  // micro-delay so the rise animation finishes before focus jump
  setTimeout(()=>pomoIntentInput.focus(), 60);
}
function hideIntentPrompt(){ pomoIntent.hidden = true; }

function startPomoNow(){
  pomoRunning = true;
  pomoEndAt = Date.now() + pomoLeft * 1000;
  if(window.setKoalaFocusing && pomoMode==='work') window.setKoalaFocusing(true);
  if(bdOn&&pomoMode==='work') pw.classList.add('bd-pomo-lock');
  // 给 active 任务行加 1s 紫色脉冲，让用户确认目标
  const activeId = TaskStore.state.activeId;
  if(activeId){
    const r = document.querySelector(`.tl-row[data-id="${activeId}"]`);
    if(r){
      r.classList.remove('pulse'); void r.offsetWidth; r.classList.add('pulse');
      setTimeout(()=>r.classList.remove('pulse'), 1100);
    }
  }
  pomoTick = setInterval(updatePomoFromClock, 1000);
  renderPomo();
}

function updatePomoFromClock(){
  if(!pomoRunning || !pomoEndAt) return;
  pomoLeft = Math.max(0, Math.ceil((pomoEndAt - Date.now()) / 1000));
  if(pomoLeft<=0) pomoComplete();
  else renderPomo();
}

function commitIntentAndStart(){
  const txt = pomoIntentInput.value.trim();
  if(txt){
    // creates task AND sets it active (TaskStore.addTask side effect)
    TaskStore.addTask(txt);
  }
  hideIntentPrompt();
  startPomoNow();
}

pomoIntentGo.addEventListener('click', commitIntentAndStart);
pomoIntentSkip.addEventListener('click', ()=>{
  hideIntentPrompt();
  startPomoNow();
});
pomoIntentInput.addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); commitIntentAndStart(); }
  else if(e.key === 'Escape'){ e.preventDefault(); hideIntentPrompt(); }
});

pomoStartBtn.addEventListener('click',()=>{
  if(pomoRunning){
    updatePomoFromClock();
    if(!pomoRunning) return;
    clearInterval(pomoTick); pomoTick=null; pomoRunning=false;pomoEndAt=null;
    if(window.setKoalaFocusing) window.setKoalaFocusing(false);
    pw.classList.remove('bd-pomo-lock');
    hideIntentPrompt(); // hide if user opened it then hit pause somehow
    renderPomo();
  } else {
    // First start of a work session with no active task → ask once.
    // If user already picked an active task, that IS their intention — don't ask twice.
    // Break sessions never prompt.
    if(pomoMode === 'work' && !TaskStore.getActive()){
      showIntentPrompt();
      return;
    }
    startPomoNow();
  }
});

pomoResetBtn.addEventListener('click',()=>{
  clearInterval(pomoTick);pomoTick=null;pomoRunning=false;
  pomoEndAt=null;
  if(window.setKoalaFocusing) window.setKoalaFocusing(false);
  pw.classList.remove('bd-pomo-lock');
  hideIntentPrompt();
  pomoLeft=pomoMode==='work'?POMO_WORK:POMO_BREAK;
  pomoTotal=pomoLeft;renderPomo();
});

pomoToggle.addEventListener('click',()=>{
  const open=pomoWidget.classList.toggle('open');
  pomoToggle.classList.toggle('on',open);
  if(open&&!dlg.classList.contains('visible')) showDialog();
});

renderPomo();

/* ════════ SMART CHECK-IN (每 20 分钟) ════════ */
const CHECK_INTERVAL=8*60*1000;
const IDLE_INTERVAL=15000+Math.random()*15000; // first idle message sooner

function checkinMsg(){
  const now=new Date();
  const hm=now.toLocaleTimeString(i18n?.getIntlLocale()||'zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const act = TaskStore.getActive();
  if(act){
    const next = TaskStore.nextUnchecked(act.id);
    if(next){
      return `${hm}\n${tr('reminder.nextStep',{step:next.text})}`;
    }
    return `${tr('reminder.whatDoing',{time:hm})}\n${tr('reminder.currentTask',{title:act.title})}`;
  }
  return tr('reminder.whatDoing',{time:hm});
}

let feishuSupervisorSyncTimer=null;
let feishuSending=false;

function getFeishuSupervisorTaskSnapshot(){
  if(typeof TaskStore==='undefined'||!TaskStore.getActive) return null;
  const act=TaskStore.getActive();
  if(!act) return null;
  const next=TaskStore.nextUnchecked(act.id);
  return {
    title:act.title||'',
    nextStep:next?.text||'',
  };
}

function buildFeishuSupervisorConfig(opt={}){
  const fromFields=!!opt.fromFields;
  return {
    enabled: opt.enabled ?? (fromFields ? !!feishuEnabledEl?.checked : !!cfg.feishuEnabled),
    interval: normalizeFeishuInterval(fromFields ? feishuIntervalEl?.value : cfg.feishuInterval),
    appEnabled: fromFields ? !!feishuAppEnabledEl?.checked : !!cfg.feishuAppEnabled,
    appId: fromFields ? (feishuAppIdEl?.value.trim()||'') : (cfg.feishuAppId||''),
    chatId: fromFields ? (feishuChatIdEl?.value.trim()||'') : (cfg.feishuAppChatId||''),
    locale: cfg.locale,
    task: getFeishuSupervisorTaskSnapshot(),
  };
}

function buildFeishuCheckinText(isTest=false){
  const now=new Date();
  const hm=now.toLocaleTimeString(i18n?.getIntlLocale()||'zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const act=TaskStore.getActive();
  const lines=[
    tr(isTest?'reminder.checkinTest':'reminder.checkin'),
    tr('reminder.whatDoing',{time:hm}),
  ];
  if(act){
    const next=TaskStore.nextUnchecked(act.id);
    lines.push(tr('reminder.currentTask',{title:act.title}));
    if(next) lines.push(tr('reminder.nextStep',{step:next.text}));
  }
  lines.push(tr('reminder.replyOneLine'));
  return lines.join('\n');
}

async function sendFeishuSupervisorCheckin(isTest=false){
  if(!IS_ELECTRON||feishuSending) return {success:false,errorKey:'status.sendUnsupported'};
  feishuSending=true;
  try{
    const config=buildFeishuSupervisorConfig({fromFields:isTest, enabled:isTest?true:undefined});
    const result=window.petBridge?.testFeishuSupervisor
      ? await window.petBridge.testFeishuSupervisor(config)
      : {success:false,errorKey:'status.sendUnsupported'};
    if(result?.success){
      addLog(isTest?'飞书测试提醒已发送':'飞书监督提醒已发送');
    }else{
      addLog('Feishu supervisor configure failed: '+resultError(result));
    }
    return result;
  }finally{
    feishuSending=false;
  }
}
function restartFeishuSupervisor(){
  if(!IS_ELECTRON||!window.petBridge?.configureFeishuSupervisor) return;
  const config=buildFeishuSupervisorConfig();
  window.petBridge.configureFeishuSupervisor(config).then(result=>{
    if(result?.success){
      const minutes=normalizeFeishuInterval(config.interval);
      addLog(config.enabled?('Feishu supervisor moved to main: every '+minutes+' minutes'):'Feishu supervisor disabled in main');
    }else{
      addLog('Feishu supervisor configure failed: '+resultError(result));
    }
  }).catch(e=>addLog('Feishu supervisor configure failed: '+(e.message||e)));
}

function scheduleFeishuSupervisorSync(){
  if(!IS_ELECTRON||!window.petBridge?.configureFeishuSupervisor) return;
  if(feishuSupervisorSyncTimer) clearTimeout(feishuSupervisorSyncTimer);
  feishuSupervisorSyncTimer=setTimeout(()=>{
    feishuSupervisorSyncTimer=null;
    restartFeishuSupervisor();
  },500);
}
let longTaskSupervisorSyncTimer=null;
const longTaskSendingIds=new Set();

function buildLongTaskSupervisorConfig(){
  return {
    locale:cfg.locale,
    tasks:normalizeLongTasks(cfg.longTasks).map(task=>({
      id:task.id,
      title:longTaskTitle(task),
      goal:task.goal,
      interval:task.interval,
      enabled:task.enabled,
      createdAt:task.createdAt,
      lastSentAt:task.lastSentAt,
      nextDueAt:task.nextDueAt,
      retryCount:task.retryCount,
      lastError:task.lastError,
      lastErrorKey:task.lastErrorKey,
      lastErrorValues:task.lastErrorValues,
    })),
  };
}

function applyLongTaskSupervisorState(state){
  const tasks=Array.isArray(state?.tasks)?state.tasks:[];
  if(!tasks.length) return;
  let changed=false;
  cfg.longTasks=normalizeLongTasks(cfg.longTasks).map(task=>{
    const fresh=tasks.find(item=>item.id===task.id);
    if(!fresh) return task;
    const next={
      ...task,
      lastSentAt:Number(fresh.lastSentAt)||task.lastSentAt,
      nextDueAt:Number(fresh.nextDueAt)||0,
      retryCount:Number(fresh.retryCount)||0,
      lastError:String(fresh.lastError||''),
      lastErrorKey:String(fresh.lastErrorKey||''),
      lastErrorValues:fresh.lastErrorValues&&typeof fresh.lastErrorValues==='object'&&!Array.isArray(fresh.lastErrorValues)
        ? {...fresh.lastErrorValues}
        : null,
    };
    const taskChanged=next.lastSentAt!==task.lastSentAt
      ||next.nextDueAt!==task.nextDueAt
      ||next.retryCount!==task.retryCount
      ||next.lastError!==task.lastError
      ||next.lastErrorKey!==task.lastErrorKey
      ||JSON.stringify(next.lastErrorValues)!==JSON.stringify(task.lastErrorValues);
    if(taskChanged) changed=true;
    return taskChanged?next:task;
  });
  if(changed){
    save();
    renderLongTaskSettings();
  }
}

function buildLongTaskCheckinText(task,isTest=false){
  const hm=new Date().toLocaleTimeString(i18n?.getIntlLocale()||'zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const lines=[
    tr(isTest?'reminder.longTaskTest':'reminder.longTask'),
    tr('reminder.longTaskProgress',{time:hm,title:longTaskTitle(task)}),
  ];
  if(task.goal) lines.push(tr('reminder.goal',{goal:task.goal}));
  lines.push(tr('reminder.interval',{minutes:normalizeLongTaskInterval(task.interval)}));
  lines.push(tr('reminder.replyThreeLines'));
  return lines.join('\n');
}

async function sendLongTaskCheckin(task,isTest=false){
  if(!IS_ELECTRON||!task?.id||longTaskSendingIds.has(task.id)) return {success:false,errorKey:'longTasks.unsupported'};
  longTaskSendingIds.add(task.id);
  try{
    const result=window.petBridge?.testLongTaskSupervisor
      ? await window.petBridge.testLongTaskSupervisor({...task,locale:cfg.locale})
      : window.petBridge?.sendLongTaskFeishu
        ? await window.petBridge.sendLongTaskFeishu(task.id, buildLongTaskCheckinText(task,isTest))
        : {success:false,errorKey:'longTasks.unsupported'};
    const title=longTaskTitle(task);
    addLog(result?.success?`Long task reminder sent: ${title}`:`Long task reminder failed: ${title} - ${resultError(result)}`);
    return result;
  }finally{
    longTaskSendingIds.delete(task.id);
  }
}

function restartLongTaskSupervisor(){
  if(!IS_ELECTRON||!window.petBridge?.configureLongTaskSupervisor) return;
  const config=buildLongTaskSupervisorConfig();
  window.petBridge.configureLongTaskSupervisor(config).then(result=>{
    if(result?.success){
      const active=config.tasks.filter(task=>task.enabled).length;
      addLog(active?`Long task supervisor moved to main: ${active} active task(s)`:'Long task supervisor disabled in main');
      applyLongTaskSupervisorState(result.state);
    }else{
      addLog('Long task supervisor configure failed: '+resultError(result));
    }
  }).catch(e=>addLog('Long task supervisor configure failed: '+(e.message||e)));
}

function scheduleLongTaskSupervisorSync(){
  if(!IS_ELECTRON||!window.petBridge?.configureLongTaskSupervisor) return;
  if(longTaskSupervisorSyncTimer) clearTimeout(longTaskSupervisorSyncTimer);
  longTaskSupervisorSyncTimer=setTimeout(()=>{
    longTaskSupervisorSyncTimer=null;
    restartLongTaskSupervisor();
  },500);
}
const _isPetWin = !IS_ELECTRON || IS_PET_WIN;
// 占位函数，pet-mode 块加载后会被替换为真实的 showMini 调用
let _bubblePush = ()=>{};

if(_isPetWin){
  let _checkinTimer=null;
  function startCheckin(){
    _checkinTimer=setInterval(()=>{
      if(!busy && (cfg.freq||'mid')!=='off') _bubblePush(checkinMsg());
    },CHECK_INTERVAL);
  }

  // 闲置提示：频率受 cfg.freq 控制
  const FREQ_MS={off:null, low:4*60*1000, mid:2.5*60*1000, high:90*1000};
  const FREQ_JITTER={off:0, low:2*60*1000, mid:60*1000, high:60*1000};
  function scheduleIdle(first){
    const base = first ? 30*1000 : FREQ_MS[cfg.freq||'mid'];
    if(base===null){setTimeout(scheduleIdle,30*1000);return;}
    const jitter = first ? 5000 : FREQ_JITTER[cfg.freq||'mid'];
    setTimeout(()=>{
      // 即使 freq=off，第一次也弹一下，让用户知道有提醒
      if(!busy && (first || (cfg.freq||'mid')!=='off')){
        const msg = currentTask
          ? checkinMsg()
          : (Math.random()<0.4?localizedAdhdTip():smartFallback(''));
        _bubblePush(msg);
      }
      scheduleIdle(false);
    }, base + Math.random()*jitter);
  }
  function startGreetings(){
    if(!_checkinTimer) startCheckin();
    scheduleIdle(true);
  }
}
restartFeishuSupervisor();
restartLongTaskSupervisor();



/* ════════ HELPERS ════════ */
function rand(a){return a[Math.floor(Math.random()*a.length)];}
function spawnHeart(cx,cy){
  const pool=['•','◦','◇','◉','◎'];
  const el=document.createElement('div');el.className='heart';
  el.textContent=rand(pool);
  const top=Math.max(50,cy-11);
  el.style.left=(cx-11)+'px';el.style.top=top+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),1300);
}
let happyT=null;
function setHappy(on){
  pw.classList.toggle('happy',on);
  if(on){if(happyT)clearTimeout(happyT);happyT=setTimeout(()=>pw.classList.remove('happy'),1200);}
}
function petReact(){
  pw.classList.remove('jumping','blinking');
  void pw.offsetWidth;
  pw.classList.add('jumping');
  setTimeout(()=>pw.classList.remove('jumping'),600);
  // any deliberate poke wakes the koala up
  wakeKoala();
}

/* ════════ PET LIVENESS — ADHD-aware ════════
   Design rules:
     1. Stillness is default. No ambient animation.
     2. Koala "comes alive" only when the user's cursor is in this window
        in the last few seconds (= they are looking at it).
     3. Focusing during a pomodoro → koala goes still (one barely visible
        long breath). The focus marker becomes a tiny static badge.
     4. Blinks are event-driven (typing, clicking), never random.
     5. Sleeping after 5 min idle is a static state, not motion.
     6. A "quiet mode" body class disables everything for users who
        want zero animation. Persisted in localStorage.
*/
(function petLiveness(){
  const SLEEP_AFTER = 5 * 60 * 1000;
  const ALIVE_FADE_MS = 3500;
  let sleepTimer = null;
  let aliveTimer = null;
  let typeBlinkLock = false;

  // restore quiet mode preference before any motion has a chance to start
  try {
    if (localStorage.getItem('nono_pet_quiet') === '1') {
      document.body.classList.add('quiet-pet');
    }
  } catch(e) { console.error('petQuiet init:', e) }

  function setAlive(){
    if(pw.classList.contains('focusing')) return;  // don't wake the koala mid-pomodoro
    if(!pw.classList.contains('alive')) pw.classList.add('alive');
    if(aliveTimer) clearTimeout(aliveTimer);
    aliveTimer = setTimeout(()=>{
      pw.classList.remove('alive');
    }, ALIVE_FADE_MS);
  }

  function blinkOnce(){
    if(pw.classList.contains('jumping') || pw.classList.contains('sleeping')) return;
    if(document.body.classList.contains('quiet-pet')) return;
    pw.classList.remove('blinking');
    void pw.offsetWidth;
    pw.classList.add('blinking');
    setTimeout(()=>pw.classList.remove('blinking'), 260);
  }
  window.petBlink = blinkOnce;

  // single combined activity handler: wakes from sleep + marks alive
  function onUserActivity(){
    if(pw.classList.contains('sleeping')) pw.classList.remove('sleeping');
    if(sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(()=>{
      if(!pw.classList.contains('focusing')) pw.classList.add('sleeping');
    }, SLEEP_AFTER);
    setAlive();
  }
  ['mousemove','keydown','mousedown','touchstart','wheel'].forEach(e=>{
    window.addEventListener(e, onUserActivity, {passive:true});
  });
  window.wakeKoala = onUserActivity;
  onUserActivity();

  // typing in chat → blink gently, max once every 1.2s
  // (predictable, synchronous with user's own keystrokes = not distracting)
  const ci = document.getElementById('chat-input');
  if (ci) {
    ci.addEventListener('input', ()=>{
      if(typeBlinkLock) return;
      typeBlinkLock = true;
      blinkOnce();
      setTimeout(()=>{ typeBlinkLock = false; }, 1200);
    });
  }

  window.setKoalaFocusing = function(on){
    pw.classList.toggle('focusing', !!on);
    if(on){
      // entering focus: stop being "alive", stop the idle countdown
      pw.classList.remove('sleeping','alive');
      if(sleepTimer){ clearTimeout(sleepTimer); sleepTimer = null; }
      if(aliveTimer){ clearTimeout(aliveTimer); aliveTimer = null; }
    } else {
      onUserActivity();
    }
  };

  window.setQuietPet = function(quiet){
    document.body.classList.toggle('quiet-pet', !!quiet);
    try { localStorage.setItem('nono_pet_quiet', quiet ? '1' : '0'); } catch(e){ console.error('setQuietPet:', e) }
  };
  window.isQuietPet = function(){
    return document.body.classList.contains('quiet-pet');
  };
})();

/* ════════ PET MOOD (SVG mouth) ════════ */
const petMouth=document.getElementById('pet-mouth'); // null for photo pet
function setMouthNormal(){if(petMouth)petMouth.setAttribute('d','M71 94 Q80 100 89 94');}
function setMouthHappy(){if(petMouth)petMouth.setAttribute('d','M68 93 Q80 102 92 93');}
function setMouthThinking(){if(petMouth)petMouth.setAttribute('d','M73 96 Q80 96 87 96');}

const _origAddHappy=pw.classList.add.bind(pw.classList);
// Watch class changes to sync mouth
const _moodObs=new MutationObserver(()=>{
  if(pw.classList.contains('thinking')) setMouthThinking();
  else if(pw.classList.contains('happy')) setMouthHappy();
  else setMouthNormal();
});
_moodObs.observe(pw,{attributes:true,attributeFilter:['class']});
const PHRASE_KEYS=[
  ['quick.distractedLabel','quick.distractedText'],
  ['quick.tiredLabel','quick.tiredText'],
  ['quick.overwhelmedLabel','quick.overwhelmedText'],
  ['quick.focusLabel','quick.focusText'],
  ['quick.encourageLabel','quick.encourageText'],
  ['quick.stuckLabel','quick.stuckText'],
];

const quickBar=document.getElementById('quick-bar');
function renderQuickBar(){
  quickBar.innerHTML='';
  PHRASE_KEYS.forEach(([labelKey,textKey])=>{
    const btn=document.createElement('button');
    btn.className='qp'; btn.textContent=tr(labelKey);
    btn.addEventListener('click',()=>{
      if(busy) return;
      btn.classList.add('sent');
      setTimeout(()=>btn.classList.remove('sent'),600);
      chatInput.value=tr(textKey);
      send();
    });
    quickBar.appendChild(btn);
  });
}
renderQuickBar();


const BAR_H_PET=110;
let px=Math.max(20,Math.round(window.innerWidth*0.28));
let py=Math.min(window.innerHeight/2-80,window.innerHeight-BAR_H_PET-160);
function applyPos(){
  if(IS_ELECTRON&&IS_PET_WIN){
    pw.style.left='0px';
    pw.style.top='0px';
    pw.style.right='0px';
    pw.style.bottom='0px';
    return;
  }
  pw.style.left=px+'px';pw.style.top=py+'px';
}
applyPos();

let drag=false,sx,sy,spx,spy,moved=false;
function ptr(e){return e.touches?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY};}
function onStart(e){
  if(e.target.closest('#settings-btn,#chat-bar,#chat-dialog,#s-overlay,#s-panel')) return;
  drag=true;moved=false;
  const p=ptr(e);sx=p.x;sy=p.y;spx=px;spy=py;
  pw.style.transition='none';
}
function onMove(e){
  if(!drag) return;e.preventDefault();
  const p=ptr(e);
  const dx=p.x-sx,dy=p.y-sy;
  if(Math.abs(dx)>4||Math.abs(dy)>4) moved=true;
  const maxY=window.innerHeight-BAR_H_PET-130;
  px=Math.max(0,Math.min(window.innerWidth-110,spx+dx));
  py=Math.max(0,Math.min(maxY,spy+dy));
  applyPos();
}
function onEnd(){
  if(!drag) return;drag=false;
  pw.style.transition='filter .2s';
  if(!moved){
    petReact();
    setHappy(true);spawnHeart(px+55,py+40);
    appendMsg('pet',hasKey()?tr('greeting.here'):smartFallback(''));
  }
}
// Browser preview and desktop pet mode both move the pet inside the page.
// The Electron pet window stays as a transparent work-area overlay.
if(!IS_ELECTRON){
  pw.addEventListener('touchstart',onStart,{passive:false});
  pw.addEventListener('touchmove',onMove,{passive:false});
  pw.addEventListener('touchend',onEnd);
  document.addEventListener('mousedown',onStart);
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onEnd);
  document.body.addEventListener('touchmove',e=>{
    if(!e.target.closest('#chat-input,#s-panel,#dlg-msgs'))e.preventDefault();
  },{passive:false});
  window.addEventListener('resize',()=>{
    px=Math.min(px,window.innerWidth-110);
    py=Math.min(py,window.innerHeight-BAR_H_PET-130);
    applyPos();dlgBottom();
  });
}

/* ════════ ENTRANCE ════════ */
pw.style.opacity='0';
pw.style.transition='opacity .6s ease';
requestAnimationFrame(()=>requestAnimationFrame(()=>{pw.style.opacity='1';}));
setTimeout(()=>{pw.style.transition='filter .2s';},700);


/* ════════ ONBOARDING ════════ */
(function(){
  // Only show onboarding in pet window (no mode parameter).
  // IS_PET_WIN is defined earlier: IS_ELECTRON && !_urlMode
  const isPetWin = !IS_ELECTRON || (typeof IS_PET_WIN !== 'undefined' && IS_PET_WIN);
  if(!isPetWin) return;
  if(localStorage.getItem('nono_onboarding_done')==='true') {
    if(typeof startGreetings==='function') startGreetings();
    return;
  }

  const overlay=document.getElementById('onboard-overlay');
  window.petBridge?.setIgnoreMouse?.(false);
  const steps=overlay.querySelectorAll('.onboard-step');
  let currentStep=0;

  function showStep(n){
    steps.forEach(s=>s.classList.remove('active'));
    if(steps[n]) steps[n].classList.add('active');
    currentStep=n;
  }

  function finish(){
    localStorage.setItem('nono_onboarding_done','true');
    overlay.classList.remove('show');
    window.petBridge?.setIgnoreMouse?.(false);
    setTimeout(()=>{overlay.style.display='none'; window.petBridge?.setIgnoreMouse?.(false); window.syncPetAnchors?.();},400);
    // happy reaction from koala after onboarding
    if(typeof setHappy==='function') setHappy(true);
    if(typeof spawnHeart==='function') spawnHeart(px+55,py+40);
    // Start greetings now that onboarding is done
    if(typeof startGreetings==='function') startGreetings();
    // 引导完成后显示问候气泡
    setTimeout(()=>{if(typeof showMini==='function') showMini(tr('greeting.hello'));},800);
  }

  // Provider segment toggle in onboarding
  const obSegBtns=document.querySelectorAll('#ob-seg .onboard-seg-b');
  const obBaseRow=document.getElementById('ob-base-row');
  let obProvider='anthropic';
    obSegBtns.forEach(b=>b.addEventListener('click',()=>{
      obSegBtns.forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      obProvider=b.dataset.p;
    }));

  // Delegate click events
  overlay.addEventListener('click',async function(e){
    const action=e.target.dataset.action;
    if(!action) return;

    if(action==='skip'){
      if(currentStep===1){
        // skip API key, go directly to task setup
        showStep(2);
        setTimeout(()=>{const el=document.getElementById('onboard-task');if(el)el.focus();},400);
      } else {
        // skip entire onboarding
        finish();
      }
    }else if(action==='next'){
      showStep(1);
    }else if(action==='save'){
      const key=document.getElementById('onboard-apikey').value.trim();
      const base=document.getElementById('onboard-base').value.trim().replace(/\/+$/,'');
      const model=document.getElementById('onboard-model').value.trim();
      cfg.p=obProvider;
      if(key){
        const saved=await saveProviderApiKeyIfNeeded(key);
        if(!saved) return;
      }
      if(base) cfg.b=base;
      if(model) cfg.m=model;
      save();
      if(typeof updateStatus==='function') updateStatus();
      showStep(2);
      setTimeout(()=>{const el=document.getElementById('onboard-task');if(el)el.focus();},400);
    }else if(action==='done'){
      const task=document.getElementById('onboard-task').value.trim();
      if(task){
        // Use TaskStore if available, fallback to the private task key.
        if(typeof TaskStore !== 'undefined' && TaskStore.addTask){
          TaskStore.addTask(task);
        } else {
          privateSet('nono_task', task);
        }
        privateSet('nono_last_activity', Date.now());
      }
      finish();
    }
  });

  // Enter key support for inputs
  const apiKeyInput=document.getElementById('onboard-apikey');
  const taskInputOb=document.getElementById('onboard-task');
  const obModel=document.getElementById('onboard-model');
  const obBase=document.getElementById('onboard-base');
  if(apiKeyInput){
    apiKeyInput.addEventListener('keydown',async function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        const key=this.value.trim();
        const base=(obBase?obBase.value:'').trim().replace(/\/+$/,'');
        const model=obModel?obModel.value.trim():'';
        cfg.p=obProvider;
        if(key){
          const saved=await saveProviderApiKeyIfNeeded(key);
          if(!saved) return;
        }
        if(base) cfg.b=base;
        if(model) cfg.m=model;
        save();
        if(typeof updateStatus==='function') updateStatus();
        showStep(2);
        setTimeout(()=>{if(taskInputOb)taskInputOb.focus();},400);
      }
    });
  }
  if(taskInputOb){
    taskInputOb.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        const task=this.value.trim();
        if(task){
          if(typeof TaskStore !== 'undefined' && TaskStore.addTask){
            TaskStore.addTask(task);
          } else {
            privateSet('nono_task', task);
          }
          privateSet('nono_last_activity', Date.now());
        }
        finish();
      }
    });
  }

  // Show overlay with a gentle delay for the koala entrance to finish
  setTimeout(()=>{overlay.classList.add('show');},900);
})();


/* ════════ DESKTOP PET MODE ════════ */
let petExpanded = false;
const PET_SIZE_KEY='nono_pet_size';
const PET_POS_KEY='nono_pet_pos';
const PET_SIZE_MIN=.35;
const PET_SIZE_OLD_MIN=.7;
const PET_SIZE_MAX=1.4;
const PET_SIZE_STEP=.1;
let petSize=readPetSize();
let petPos=readPetPosition();

function normalizePetSize(value){
  const scale=Number(value);
  if(!Number.isFinite(scale)) return 1;
  return Math.max(PET_SIZE_MIN,Math.min(PET_SIZE_MAX,Math.round(scale*100)/100));
}

function readPetSize(){
  try{
    const raw=localStorage.getItem(PET_SIZE_KEY);
    if(raw===null) return 1;
    const saved=Number(raw);
    if(Number.isFinite(saved)&&Math.abs(saved-PET_SIZE_OLD_MIN)<.001){
      localStorage.setItem(PET_SIZE_KEY,String(PET_SIZE_MIN));
      return PET_SIZE_MIN;
    }
    return normalizePetSize(saved);
  }
  catch{return 1;}
}

function updatePetSizeButtons(){
  const handle=document.getElementById('pet-size-handle');
  if(handle) handle.title=tr('pet.resizeCurrent',{percent:Math.round(petSize*100)});
}

function defaultPetPosition(){
  return {
    x:Math.round(window.innerWidth*.6),
    y:Math.round(window.innerHeight*.5),
  };
}

function readPetPosition(){
  try{
    const saved=JSON.parse(localStorage.getItem(PET_POS_KEY)||'null');
    if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)) return saved;
  }catch(e){console.error('read pet position:',e)}
  return defaultPetPosition();
}

function clampPetPosition(pos){
  const height=320*petSize;
  return {
    x:Math.max(-40,Math.min(window.innerWidth-56,pos.x)),
    y:Math.max(-40,Math.min(window.innerHeight-Math.min(56,height),pos.y)),
  };
}

function applyPetPosition(nextPos,opt={}){
  petPos=clampPetPosition(nextPos||petPos);
  document.documentElement.style.setProperty('--pet-left', `${Math.round(petPos.x)}px`);
  document.documentElement.style.setProperty('--pet-top', `${Math.round(petPos.y)}px`);
  if(opt.persist!==false){
    try{localStorage.setItem(PET_POS_KEY,JSON.stringify(petPos));}
    catch(e){console.error('save pet position:',e)}
  }
  if(typeof window.syncPetAnchors==='function'){
    requestAnimationFrame(()=>window.syncPetAnchors());
  }
}

function syncPetPositionFromCss(){
  const style=getComputedStyle(document.documentElement);
  const x=parseFloat(style.getPropertyValue('--pet-left'));
  const y=parseFloat(style.getPropertyValue('--pet-top'));
  if(Number.isFinite(x)&&Number.isFinite(y)){
    petPos=clampPetPosition({x,y});
  }
}

function applyPetSize(nextSize, opt={}){
  petSize=normalizePetSize(nextSize);
  document.documentElement.style.setProperty('--pet-size-scale', petSize.toFixed(2));
  if(opt.persist!==false){
    try{localStorage.setItem(PET_SIZE_KEY,String(petSize));}
    catch(e){console.error('save pet size:',e)}
  }
  updatePetSizeButtons();
  applyPetPosition(petPos,{persist:false});
  if(typeof window.syncPetAnchors==='function'){
    requestAnimationFrame(()=>window.syncPetAnchors());
  }
  if(opt.resize!==false&&IS_ELECTRON&&IS_PET_WIN&&window.petBridge?.setPetSize){
    window.petBridge.setPetSize(petSize)
      .then(()=>requestAnimationFrame(()=>window.syncPetAnchors?.()))
      .catch(e=>console.error('setPetSize:',e));
  }
}

applyPetSize(petSize,{persist:false,resize:IS_PET_WIN});

if(IS_CHAT_WIN){
  document.documentElement.classList.add('chat-only-html');
  document.body.classList.add('chat-only-mode');
  showDialog();
  // Close button (top-left)
  // Hide settings btn in chat window to avoid overlap
  document.getElementById('settings-btn').style.display = 'none';
  // Add close button to dialog header — uses shared button system (#dlg-close in CSS)
  const hdrBtns = document.getElementById('dlg-header-btns');
  if(hdrBtns){
    const closeBtn = document.createElement('button');
    closeBtn.id = 'dlg-close';
    closeBtn.className = 'danger';
    closeBtn.setAttribute('aria-label', tr('common.close'));
    closeBtn.title = tr('common.close');
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => window.petBridge.closeSelf();
    hdrBtns.appendChild(closeBtn);
  }
  // Drag the chat window by its header (excluding buttons)
  const dlgHeader = document.getElementById('dlg-header');
  if(dlgHeader && window.petBridge){
    dlgHeader.style.webkitAppRegion='drag';
  }
} else if(IS_SET_WIN){
  document.documentElement.classList.add('settings-only-html');
  document.body.classList.add('settings-only-mode');
  // Show settings panel directly
  openSettings();
  // Replace close button with window close
  document.getElementById('s-close').onclick = () => window.petBridge.closeSelf();
  // Drag the settings window by its header (same IPC pattern as chat window — -webkit-app-region:drag
  // is unreliable on transparent + sandboxed BrowserWindows in Electron 28)
  const sHeader = document.getElementById('s-header-drag');
  if(sHeader && window.petBridge){
    sHeader.style.webkitAppRegion = 'drag';
    sHeader.style.cursor = 'default';
  }
} else if(IS_LONG_TASKS_WIN){
  document.documentElement.classList.add('long-tasks-only-html');
  document.body.classList.add('long-tasks-only-mode');
  renderLongTaskSettings();
  document.getElementById('lt-close').onclick = () => window.petBridge.closeSelf();
  document.getElementById('lt-minimize').onclick = () => window.petBridge.minimizeSelf();
  const ltHeader = document.getElementById('lt-header-drag');
  if(ltHeader && window.petBridge){
    ltHeader.style.webkitAppRegion = 'drag';
    ltHeader.style.cursor = 'default';
  }
} else if(IS_PET_WIN){
  document.documentElement.classList.add('pet-mode-html');
  document.body.classList.add('pet-mode');
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.setProperty('--bg','transparent');
  document.documentElement.style.setProperty('--bar-bg','transparent');
  document.body.style.background = 'transparent';
  document.body.style.backgroundColor = 'transparent';

  const petWrap = document.querySelector('.pet-img-wrap');
  const petTray = document.getElementById('pet-tray');
  const petSizeHandle = document.getElementById('pet-size-handle');
  const miniBubbleNode = document.getElementById('mini-bubble');
  if(petWrap&&petTray&&petTray.parentElement!==petWrap) petWrap.appendChild(petTray);
  if(pw&&petSizeHandle&&petSizeHandle.parentElement!==pw) pw.appendChild(petSizeHandle);
  if(petWrap&&miniBubbleNode&&miniBubbleNode.parentElement!==petWrap) petWrap.appendChild(miniBubbleNode);

  // Tray buttons
  // Chat button: always opens (or focuses if already open) the chat window. Never toggles icon.
  document.getElementById('tray-expand').addEventListener('click', ()=>{
    window.petBridge.expand();
    petExpanded = true;
  });

  document.getElementById('tray-settings').addEventListener('click', ()=>{
    window.petBridge.openSettings();
  });

  document.getElementById('tray-long-tasks').addEventListener('click', ()=>{
    window.petBridge.openLongTasks();
  });

  document.getElementById('tray-hide').addEventListener('click', ()=>{
    window.petBridge.hideApp();
  });

  document.getElementById('tray-close').addEventListener('click', ()=>{
    window.petBridge.closeApp();
  });

  // In pet mode, clicking pet does NOT expand — handled by mouseup above

  /* ── Mini bubble ── */
  const miniBubble = document.getElementById('mini-bubble');
  let miniTimer = null;
  function showMini(msg){
    if(!miniBubble){console.warn('mini-bubble element missing');return;}
    // 引导完成前不显示气泡，避免遮挡 Onboarding
    if(localStorage.getItem('nono_onboarding_done')!=='true') return;
    if(miniTimer) clearTimeout(miniTimer);
    miniBubble.textContent = msg;
    miniBubble.classList.add('show');
    requestAnimationFrame(()=>window.syncPetAnchors?.());
    miniTimer = setTimeout(()=>{
      miniBubble.classList.remove('show');
      requestAnimationFrame(()=>window.syncPetAnchors?.());
    }, 10000);
  }
  // 让自动提醒走头顶气泡，超长文本截断
  _bubblePush = (msg)=>{
    if(!msg) return;
    showMini(String(msg));
    privateSet('nono_last_activity', Date.now());
  };
  // 上线问候——让用户立刻确认气泡能弹出
  setTimeout(()=>showMini(tr('greeting.hello')), 4000);

  /* ── Pixel-perfect click-through ── */
  const petImg = document.getElementById('pet-img');
  const alphaCanvas = document.createElement('canvas');
  const alphaCtx = alphaCanvas.getContext('2d');
  let alphaBounds = null;
  function computeAlphaBounds(){
    if(!alphaCanvas.width||!alphaCanvas.height) return null;
    try{
      const data=alphaCtx.getImageData(0,0,alphaCanvas.width,alphaCanvas.height).data;
      let minX=alphaCanvas.width,minY=alphaCanvas.height,maxX=0,maxY=0,found=false;
      for(let y=0;y<alphaCanvas.height;y+=2){
        for(let x=0;x<alphaCanvas.width;x+=2){
          if(data[(y*alphaCanvas.width+x)*4+3]<=30) continue;
          found=true;
          if(x<minX) minX=x;
          if(y<minY) minY=y;
          if(x>maxX) maxX=x;
          if(y>maxY) maxY=y;
        }
      }
      alphaBounds=found?{minX,minY,maxX,maxY,width:alphaCanvas.width,height:alphaCanvas.height}:null;
    }catch(e){
      console.error('computeAlphaBounds:',e);
      alphaBounds=null;
    }
    return alphaBounds;
  }
  function getVisibleKoalaRect(){
    const rect=petImg.getBoundingClientRect();
    if(!alphaBounds) return rect;
    const sx=rect.width/alphaBounds.width;
    const sy=rect.height/alphaBounds.height;
    const left=rect.left+alphaBounds.minX*sx;
    const top=rect.top+alphaBounds.minY*sy;
    const right=rect.left+alphaBounds.maxX*sx;
    const bottom=rect.top+alphaBounds.maxY*sy;
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }
  function getPetEffectPoint(){
    const body=getVisibleKoalaRect();
    return {
      x:body.left+body.width*.5,
      y:body.top+body.height*.24,
    };
  }
  let petShapeFrame=0;
  let dragging=false, startX=0, startY=0, dragMoved=false, dragStartPos={x:0,y:0};
  let resizingPet=false, resizeStartX=0, resizeStartY=0, resizeStartSize=1, resizeMoved=false;
  function cyclePetSize(){
    const presets=[PET_SIZE_MIN,1,1.2,PET_SIZE_MAX];
    const next=presets.find(size=>size>petSize+.01)||presets[0];
    applyPetSize(next);
  }
  function toShapeRect(rect,pad){
    const left=Math.max(0,Math.floor(rect.left-pad));
    const top=Math.max(0,Math.floor(rect.top-pad));
    const right=Math.ceil(rect.right+pad);
    const bottom=Math.ceil(rect.bottom+pad);
    return {x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  }
  function requestPetShapeSync(){
    if(!window.petBridge?.setPetShape) return;
    if(dragging) return;
    if(resizingPet) return;
    if(petShapeFrame) return;
    petShapeFrame=requestAnimationFrame(()=>{
      petShapeFrame=0;
      const rects=[toShapeRect(getVisibleKoalaRect(),4)];
      if(petTray&&getComputedStyle(petTray).display!=='none'){
        rects.push(toShapeRect(petTray.getBoundingClientRect(),3));
      }
      if(petSizeHandle&&getComputedStyle(petSizeHandle).display!=='none'){
        rects.push(toShapeRect(petSizeHandle.getBoundingClientRect(),3));
      }
      if(miniBubbleNode&&miniBubbleNode.classList.contains('show')){
        rects.push(toShapeRect(miniBubbleNode.getBoundingClientRect(),4));
      }
      window.petBridge.setPetShape(rects);
    });
  }
  function syncPetAnchors(){
    if(dragging) return;
    const body=getVisibleKoalaRect();
    const wrapRect=(petWrap||petImg).getBoundingClientRect();
    const scale=petSize||1;
    const compact=scale<.55;
    const trayLeft=body.right-wrapRect.left+(compact?18:10)*scale;
    const trayTop=body.top-wrapRect.top+body.height*.56;
    const handleSize=petSizeHandle?.offsetWidth||24;
    let sizeLeft=body.right-6*scale;
    let sizeTop=body.bottom-handleSize-4*scale;
    const bubbleWidth=178;
    const trayWidth=petTray?.offsetWidth||24;
    const trayHeight=petTray?.offsetHeight||152;
    const trayViewport={
      left:wrapRect.left+trayLeft,
      right:wrapRect.left+trayLeft+trayWidth,
      top:wrapRect.top+trayTop-trayHeight/2,
      bottom:wrapRect.top+trayTop+trayHeight/2,
    };
    const bubbleGap=Math.max(8, Math.round(10*scale));
    let bubbleLeft=compact
      ? trayViewport.right-wrapRect.left+bubbleGap
      : body.right-wrapRect.left-Math.round(22*scale);
    let bubbleSide='right';
    if(wrapRect.left+bubbleLeft+bubbleWidth>window.innerWidth-8){
      bubbleLeft=Math.max(8-wrapRect.left,body.left-wrapRect.left-bubbleWidth+(compact?0:Math.round(22*scale)));
      bubbleSide='left';
    }
    if(miniBubbleNode) miniBubbleNode.classList.toggle('left-side', bubbleSide==='left');
    if(petSizeHandle&&petTray){
      const handleRect={
        left:sizeLeft,
        right:sizeLeft+handleSize,
        top:sizeTop,
        bottom:sizeTop+handleSize,
      };
      const overlaps=handleRect.left<trayViewport.right&&handleRect.right>trayViewport.left&&
        handleRect.top<trayViewport.bottom&&handleRect.bottom>trayViewport.top;
      if(overlaps){
        sizeLeft=body.left+body.width*.43-handleSize/2;
        sizeTop=body.bottom-handleSize-8*scale;
      }
    }
    document.documentElement.style.setProperty('--pet-tray-left', `${Math.round(trayLeft)}px`);
    document.documentElement.style.setProperty('--pet-tray-top', `${Math.round(trayTop)}px`);
    document.documentElement.style.setProperty('--pet-size-left', `${Math.round(sizeLeft)}px`);
    document.documentElement.style.setProperty('--pet-size-top', `${Math.round(sizeTop)}px`);
    document.documentElement.style.setProperty('--pet-bubble-left', `${Math.round(bubbleLeft)}px`);
    const bubbleTop=compact
      ? Math.max(4-wrapRect.top,body.top-wrapRect.top-Math.round(34*scale))
      : body.top-wrapRect.top-Math.round(8*scale);
    document.documentElement.style.setProperty('--pet-bubble-top', `${Math.max(4,Math.round(bubbleTop))}px`);
    requestPetShapeSync();
  }
  window.syncPetAnchors=syncPetAnchors;
  window.__nonoPetVisibleRect=()=>getVisibleKoalaRect();
  window.__nonoPetEffectPoint=()=>getPetEffectPoint();
  function setupAlpha(){
    alphaCanvas.width = petImg.naturalWidth;
    alphaCanvas.height = petImg.naturalHeight;
    alphaCtx.drawImage(petImg, 0, 0);
    computeAlphaBounds();
    syncPetAnchors();
  }
  if(petImg.complete && petImg.naturalWidth) setupAlpha();
  else petImg.addEventListener('load', setupAlpha);
  window.addEventListener('resize',()=>requestAnimationFrame(syncPetAnchors));

  function isOnboardingActive(){
    const overlay = document.getElementById('onboard-overlay');
    return !!(overlay && overlay.classList.contains('show') && overlay.style.display !== 'none');
  }
  function isOverKoala(cx, cy){
    // While onboarding is visible, the pet window must accept mouse events over
    // the whole overlay/card. Otherwise the transparent pet window can be put
    // into click-through mode before the user presses the onboarding buttons.
    if(isOnboardingActive()) return true;
    // Always respond over tray buttons
    const tray = document.getElementById('pet-tray');
    if(tray){
      const tr = tray.getBoundingClientRect();
      if(cx>=tr.left&&cx<=tr.right&&cy>=tr.top&&cy<=tr.bottom) return true;
    }
    if(petSizeHandle){
      const hr = petSizeHandle.getBoundingClientRect();
      if(cx>=hr.left&&cx<=hr.right&&cy>=hr.top&&cy<=hr.bottom) return true;
    }
    if(miniBubbleNode&&miniBubbleNode.classList.contains('show')){
      const br = miniBubbleNode.getBoundingClientRect();
      if(cx>=br.left&&cx<=br.right&&cy>=br.top&&cy<=br.bottom) return true;
    }
    // Keep a small transparent halo around the koala inside the pet window.
    // Otherwise Electron passes that area through to the app underneath, and
    // the underlying app's cursor (often a grab cursor) can leak through.
    const body = getVisibleKoalaRect();
    const hoverPad = Math.max(12, Math.round(18 * (petSize || 1)));
    if(cx>=body.left-hoverPad&&cx<=body.right+hoverPad&&
       cy>=body.top-hoverPad&&cy<=body.bottom+hoverPad) return true;
    // Check pixel alpha on koala image
    const rect = petImg.getBoundingClientRect();
    if(cx<rect.left||cx>rect.right||cy<rect.top||cy>rect.bottom) return false;
    const sx = Math.round((cx-rect.left)/rect.width*alphaCanvas.width);
    const sy = Math.round((cy-rect.top)/rect.height*alphaCanvas.height);
    try{ return alphaCtx.getImageData(sx,sy,1,1).data[3] > 30; }
    catch(e){ return true; }
  }

  /* ── Drag + click ── */
  petSizeHandle?.addEventListener('mousedown', e=>{
    resizingPet=true;
    resizeMoved=false;
    resizeStartX=e.clientX;
    resizeStartY=e.clientY;
    resizeStartSize=petSize;
    window.petBridge.setIgnoreMouse(false);
    e.stopPropagation();
    e.preventDefault();
  });

  window.addEventListener('mousemove', e=>{
    if(resizingPet){
      const dx=e.clientX-resizeStartX;
      const dy=e.clientY-resizeStartY;
      const delta=(dx+dy)/2;
      if(Math.abs(dx)>2||Math.abs(dy)>2) resizeMoved=true;
      applyPetSize(resizeStartSize+delta/260,{persist:false});
      return;
    }
    if(dragging){
      if(e.buttons===0) return;
      const dx=e.clientX-startX, dy=e.clientY-startY;
      if(Math.abs(dx)>1||Math.abs(dy)>1) dragMoved=true;
      applyPetPosition({x:dragStartPos.x+dx,y:dragStartPos.y+dy},{persist:false});
      return;
    }
    window.petBridge.setIgnoreMouse(!isOverKoala(e.clientX,e.clientY));
  });

  let pausedPetAnimations=[];
  let frozenPetTransforms=[];
  function capturePetTransforms(){
    const root=petWrap||pw;
    return [petWrap,root.querySelector('.pet-sway-wrap'),petImg,root.querySelector('.pet-zzz'),root.querySelector('.pet-focus-mark')]
      .filter(Boolean)
      .map(el=>({el,transform:el.style.transform,computed:getComputedStyle(el).transform}));
  }
  function pausePetAnimations(snapshot){
    const root=petWrap||pw;
    frozenPetTransforms=snapshot||capturePetTransforms();
    pausedPetAnimations=root.getAnimations({subtree:true}).filter(anim=>anim.playState==='running'||anim.playState==='pending');
    pausedPetAnimations.forEach(anim=>anim.pause());
    frozenPetTransforms.forEach(item=>{
      item.el.style.transform=item.computed&&item.computed!=='none'?item.computed:item.transform;
    });
  }
  function resumePetAnimations(){
    const list=pausedPetAnimations;
    const frozen=frozenPetTransforms;
    pausedPetAnimations=[];
    frozenPetTransforms=[];
    frozen.forEach(item=>{item.el.style.transform=item.transform;});
    list.forEach(anim=>{
      try{anim.play();}catch(e){console.error('resume pet animation:',e)}
    });
  }

  window.addEventListener('mousedown', e=>{
    if(e.target.closest('#pet-size-handle')) return;
    const pressTransforms=capturePetTransforms();
    if(!isOverKoala(e.clientX,e.clientY)) return;
    if(e.target.closest('.tray-btn')) return;
    if(e.target.setPointerCapture&&typeof e.pointerId==='number'){
      try{e.target.setPointerCapture(e.pointerId);}catch{}
    }
    window.petBridge.setIgnoreMouse(false);
    dragging=true; dragMoved=false;
    syncPetPositionFromCss();
    dragStartPos={...petPos};
    pausePetAnimations(pressTransforms);
    pw.classList.add('dragging');
    startX=e.clientX; startY=e.clientY;
    e.preventDefault();
  });

  window.addEventListener('mouseup', ()=>{
    if(resizingPet){
      resizingPet=false;
      window.petBridge.setIgnoreMouse(false);
      if(resizeMoved){
        applyPetSize(petSize,{persist:true});
      }else{
        cyclePetSize();
      }
      requestAnimationFrame(syncPetAnchors);
      return;
    }
    if(!dragging) return;
    dragging=false;
    window.petBridge.setIgnoreMouse(false);
    pw.classList.remove('dragging');
    applyPetPosition(petPos,{persist:true});
    resumePetAnimations();
    requestAnimationFrame(syncPetAnchors);
    if(!dragMoved){
      petReact();
      setHappy(true);
      const p=getPetEffectPoint();
      spawnHeart(p.x,p.y);
      const msg = Math.random()<0.35 ? localizedAdhdTip() : smartFallback('');
      showMini(msg);
    }
  });

  /* ── Patch appendMsg: show mini bubble when collapsed ── */
  const _origAppendMsg = appendMsg;
  appendMsg = function(role, text, img){
    _origAppendMsg(role, text, img);
    if(role==='pet' && !petExpanded && text){
      showMini(text.length>55 ? text.slice(0,53)+'…' : text);
    }
  };

  /* ── 主动冒泡提醒：闲置超时后提醒当前任务 ── */
  // 各频率对应的闲置阈值（毫秒）
  const IDLE_THRESHOLDS = { off: null, low: 20*60*1000, mid: 10*60*1000, high: 5*60*1000 };
  // 初始化活跃时间（冷启动时不立刻提醒）
  if(!privateGet('nono_last_activity','')){
    privateSet('nono_last_activity', Date.now());
  }

  // 启动时：自动检测并加载内置本地模型
  (async () => {
    const status = await refreshLocalModelStatus();
    if (status.hasModel && !status.ready && !status.loading) {
      if (typeof addLog === 'function') addLog('[模型] 检测到内置模型，后台加载中…');
      const ok = await loadLocalModel();
      if (ok && typeof addLog === 'function') addLog('[模型] 后台加载完成');
      updateStatus();
    }
  })();
  // 点击宠物也算活跃
  const _origShowMini = showMini;
  showMini = function(msg){
    privateSet('nono_last_activity', Date.now());
    _origShowMini(msg);
  };

  setInterval(()=>{
    const freq = cfg.freq || 'mid';
    const threshold = IDLE_THRESHOLDS[freq];
    if(threshold === null) return; // 关闭提醒
    const act = TaskStore.getActive();
    if(!act) return; // 没有设置任务
    const lastAct = parseInt(privateGet('nono_last_activity','0') || '0');
    const idle = Date.now() - lastAct;
    if(idle >= threshold){
      const next = TaskStore.nextUnchecked(act.id);
      let msg;
      if(next){
        msg = tr('reminder.nextStep',{step:next.text});
      } else {
        msg = `${tr('reminder.currentTask',{title:act.title})}\n${smartFallback('')}`;
      }
      showMini(msg);
      privateSet('nono_last_activity', Date.now());
    }
  }, 60*1000);
}

window.addEventListener('nono:locale-changed',()=>{
  cfg.locale=i18n?.getLocale()||'zh-CN';
  syncLanguage();
  const activeTab=document.querySelector('.settings-tab.active')?.dataset.settingsTab||'model';
  syncSettingsWindowTitle(activeTab);
  syncApiKeyField();
  syncSeg();
  updateHermesAgentStatus();
  updateHermesStatus();
  updateFeishuSupervisorStatus(false);
  updateStatus();
  renderLongTaskSettings();
  renderTasks();
  renderPomo();
  StatsRenderer.renderAll();
  renderFreezerList();
  renderQuickBar();
  updatePetSizeButtons();
});

})();
