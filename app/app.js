(function(){
'use strict';

/* ════════ localStorage key migration (one-time) ════════ */
(function(){
  var _m={
    'apk':'nono_config',
    'naonao_bodydouble':'nono_bd',
    'naonao_freezer':'nono_fz',
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

let cfg=load();
// Desktop never uses the third-party CORS proxy
if(IS_ELECTRON) cfg.proxy=false;
let history=[];
let busy=false;

function load(){
  try{const s=JSON.parse(localStorage.getItem('nono_config')||'{}');
    return{
      p:s.p||'anthropic',k:s.k||'',m:s.m||'',b:s.b||'',proxy:!!s.proxy,freq:s.freq||'mid',
      feishuEnabled:!!s.feishuEnabled,
      feishuInterval:normalizeFeishuInterval(s.feishuInterval),
      feishuAppEnabled:!!s.feishuAppEnabled,
      feishuAppId:s.feishuAppId||'',
      feishuAppChatId:s.feishuAppChatId||'',
    };}
  catch{return{p:'anthropic',k:'',m:'',b:'',proxy:false,freq:'mid',feishuEnabled:false,feishuInterval:30,feishuAppEnabled:false,feishuAppId:'',feishuAppChatId:''};}
}
function save(){
  // On desktop the API key lives in OS-encrypted storage (DPAPI / Keychain); never persist it
  // to localStorage. On the web we still fall back to localStorage.
  if(IS_ELECTRON){
    const {k, ...rest}=cfg;
    localStorage.setItem('nono_config',JSON.stringify(rest));
    window.petBridge.setSecret(k||'').catch(e=>console.error('setSecret failed:',e));
    window.petBridge.notifyConfigChanged?.();
  } else {
    localStorage.setItem('nono_config',JSON.stringify(cfg));
  }
}
function hasKey(){return!!cfg.k;}

// Desktop: pull the key from OS-encrypted storage on boot, and migrate any legacy
// plaintext key out of localStorage.
if(IS_ELECTRON){
  (async()=>{
    try{
      const stored=await window.petBridge.getSecret();
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
let curP=cfg.p;

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

function normalizeFeishuInterval(value){
  return Math.min(240,Math.max(1,Math.round(Number(value)||30)));
}

function updateFeishuSupervisorStatus(pending=false){
  if(!feishuStatusEl) return;
  const minutes=normalizeFeishuInterval(feishuIntervalEl?.value||cfg.feishuInterval);
  const enabled=feishuEnabledEl ? !!feishuEnabledEl.checked : !!cfg.feishuEnabled;
  if(enabled){
    feishuStatusEl.textContent=`飞书监督已开启：每 ${minutes} 分钟自动提醒一次${pending?'（保存后生效）':''}`;
  }else{
    feishuStatusEl.textContent=`未开启飞书监督；开启后每 ${minutes} 分钟提醒一次`;
  }
}

async function syncFeishuSettingsFields(){
  if(feishuEnabledEl) feishuEnabledEl.checked=!!cfg.feishuEnabled;
  if(feishuIntervalEl) feishuIntervalEl.value=String(cfg.feishuInterval||30);
  updateFeishuSupervisorStatus(false);
  if(feishuAppEnabledEl) feishuAppEnabledEl.checked=!!cfg.feishuAppEnabled;
  if(feishuAppIdEl) feishuAppIdEl.value=cfg.feishuAppId||'';
  if(feishuChatIdEl) feishuChatIdEl.value=cfg.feishuAppChatId||'';
  if(feishuAppStatusEl) feishuAppStatusEl.textContent=cfg.feishuAppEnabled?'飞书应用长连接已启用':'未启用飞书应用长连接';
  if(feishuWebhookEl && window.petBridge?.getFeishuWebhook){
    try{feishuWebhookEl.value=await window.petBridge.getFeishuWebhook();}
    catch(e){console.error('getFeishuWebhook failed:',e);feishuWebhookEl.value='';}
  }
  if(feishuAppSecretEl && window.petBridge?.getFeishuAppSecret){
    try{feishuAppSecretEl.value=await window.petBridge.getFeishuAppSecret();}
    catch(e){console.error('getFeishuAppSecret failed:',e);feishuAppSecretEl.value='';}
  }
}

feishuIntervalEl?.addEventListener('input',()=>{
  if(feishuIntervalEl) feishuIntervalEl.value=String(normalizeFeishuInterval(feishuIntervalEl.value));
  updateFeishuSupervisorStatus(true);
});
feishuEnabledEl?.addEventListener('change',()=>updateFeishuSupervisorStatus(true));

async function applyExternalConfigUpdate(){
  const apiKey=cfg.k;
  cfg=load();
  cfg.k=apiKey;
  if(IS_ELECTRON) cfg.proxy=false;
  curP=cfg.p;
  syncSeg();
  syncFreq();
  syncPetMode();
  if(IS_SET_WIN||overlay.classList.contains('open')){
    fKey.value=cfg.k;
    fModel.value=cfg.m;
    fBase.value=cfg.b;
    fProxy.checked=!!cfg.proxy;
    await syncFeishuSettingsFields();
  }
  restartFeishuAppConnection();
  restartFeishuSupervisor();
  updateStatus();
}

window.petBridge?.onConfigChanged?.(()=>applyExternalConfigUpdate());
window.addEventListener('storage',e=>{
  if(e.key==='nono_config') applyExternalConfigUpdate();
});

async function openSettings(){
  fKey.value=cfg.k;fModel.value=cfg.m;fBase.value=cfg.b;
  fProxy.checked=!!cfg.proxy;
  // Desktop: hide CORS proxy row entirely — Electron doesn't need it and routing keys
  // through corsproxy.io is a security risk.
  if(IS_ELECTRON){
    const fr=document.getElementById('fr-proxy');
    if(fr) fr.style.display='none';
    fProxy.checked=false;
  }
  await syncFeishuSettingsFields();
  curP=cfg.p;syncSeg();syncFreq();syncPetMode();updateStatus();
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
syncPetMode();
function syncSeg(){
  segBtns.forEach(b=>b.classList.toggle('on',b.dataset.p===curP));
  frBase.style.display=curP==='openai'?'flex':'none';
  mHint.textContent=MODEL_HINT[curP]||'';
}
async function updateStatus(){
  await refreshLocalModelStatus();
  stRow.innerHTML=`<span class="st-badge ${hasKey()?'ok':'no'}">
    <span class="dot"></span>${hasKey()?'API Key 已配置':'未配置，使用本地模型'}
  </span>`;
  const modelStatus = document.getElementById('local-model-status');
  const downloadProgress = document.getElementById('download-progress');
  
  if (modelStatus) {
    modelStatus.textContent = '🤖 本地模型：' + getLocalModelStatus();
  }
  const modelBtn = document.getElementById('local-model-btn');
  if (modelBtn) {
    if (localModelLoading) {
      modelBtn.disabled = true;
      modelBtn.textContent = '⏳ 加载中…';
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else if (localModelReady) {
      modelBtn.disabled = true;
      modelBtn.textContent = '✅ 模型已就绪';
      modelBtn.style.opacity = '0.6';
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else if (localModelHasFiles) {
      modelBtn.disabled = false;
      modelBtn.textContent = '🔁 加载本地模型';
      modelBtn.style.opacity = '1';
      if (downloadProgress) downloadProgress.style.display = 'none';
    } else {
      // 模型未下载
      modelBtn.disabled = false;
      modelBtn.textContent = '📥 下载并加载模型';
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
  if(btn){btn.disabled=false;btn.textContent='📥 下载并加载模型';btn.style.opacity='1'}
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
    btn.textContent = '⏳ 加载中…';
    if (status) status.textContent = '🤖 本地模型：加载中…';
    const ok = await loadLocalModel((pct, msg) => {
      if (status) status.textContent = '🤖 本地模型：' + (msg || '加载中…');
      if (btn && pct !== null && pct >= 0) btn.textContent = '⏳ ' + pct + '%';
    });
    if (ok) {
      addLog('本地 AI 模型加载完成 ✅');
      updateStatus();
    } else {
      btn.disabled = false;
      btn.textContent = '🔁 加载本地模型';
      addLog('❌ 模型加载失败。详情请看日志或开发者工具控制台');
      if (status) status.textContent = '🤖 本地模型：加载失败';
    }
    return;
  }
  
  // 模型文件不存在，需要下载
  downloadCancelled=false;
  btn.disabled = true;
  btn.textContent = '⏳ 下载中…';
  if (status) status.textContent = '🤖 本地模型：准备下载…';
  if (downloadProgress) downloadProgress.style.display = 'block';
  if (downloadStatus) downloadStatus.textContent = '正在连接下载服务器…';
  if (downloadBar) downloadBar.style.width = '0%';
  if (downloadPct) downloadPct.textContent = '0%';
  
  addLog('开始下载本地 AI 模型…');
  
  try {
    const result = await window.petBridge.localModelDownload();
    if(downloadCancelled) return;
    if (result && result.success) {
      // 直接设置前端状态，不依赖 IPC 回查避免时序问题
      localModelReady = true;
      localModelHasFiles = true;
      localModelLoading = false;
      addLog('本地 AI 模型下载并加载完成 ✅');
      if (downloadProgress) downloadProgress.style.display = 'none';
      updateStatus();
    } else {
      btn.disabled = false;
      btn.textContent = '📥 下载并加载模型';
      if (status) status.textContent = '🤖 本地模型：下载失败';
      if (downloadProgress) downloadProgress.style.display = 'none';
      addLog('❌ 模型下载失败。请检查网络连接后重试。');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '📥 下载并加载模型';
    if (status) status.textContent = '🤖 本地模型：下载异常';
    if (downloadProgress) downloadProgress.style.display = 'none';
    addLog('❌ 模型下载异常: ' + (e?.message || e));
  }
});
// 删除本地模型按钮
document.getElementById('local-model-delete-btn')?.addEventListener('click', async () => {
  const ok = await petDialog.confirm('确定要删除本地模型吗？\n\n删除后需要重新下载（约 460MB）才能使用离线 AI。', { title:'删除确认' });
  if (!ok) return;
  const btn = document.getElementById('local-model-delete-btn');
  const status = document.getElementById('local-model-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 删除中…'; }
  const result = await window.petBridge.localModelDelete();
  if (result.success) {
    localModelReady = false;
    localModelHasFiles = false;
    localModelLoading = false;
    addLog('🗑 本地模型已删除');
    updateStatus();
    if (status) status.textContent = '🤖 本地模型：已删除';
    // 恢复删除按钮
    if (btn) { btn.disabled = false; btn.textContent = '🗑 删除本地模型'; }
  } else {
    addLog('❌ 删除模型失败: ' + (result.error || '未知错误'));
    if (btn) { btn.disabled = false; btn.textContent = '🗑 删除本地模型'; }
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
  appendMsg('pet','好的，已清除引导标记。正在重新加载…');
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
      addLog('日志已复制到剪贴板');
    }).catch(e=>{
      addLog('复制失败: '+e.message);
    });
  }
});
document.getElementById('log-clear').addEventListener('click',()=>{
  _logs = [];
  const logContainer = document.getElementById('log-container');
  if(logContainer) logContainer.textContent = '暂无日志';
  addLog('日志已清除');
});

addLog('孬孬启动');

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
    
    if (downloadProgress) downloadProgress.style.display = 'block';
    if (downloadStatus && data.msg) downloadStatus.textContent = data.msg;
    if (downloadPct && data.pct !== undefined) downloadPct.textContent = data.pct + '%';
    if (downloadBar && data.pct !== undefined) downloadBar.style.width = data.pct + '%';
    
    addLog('[下载] ' + (data.msg || '进度: ' + data.pct + '%'));
  });
}

function summarizeFeishuReport(text){
  const clean=String(text||'').replace(/\s+/g,' ').trim().slice(0,120);
  return clean ? `收到，你刚才汇报的是：${clean}\n我记下来了。下一步只要说清楚“接下来 5 分钟做什么”就行。` : '收到。我记下来了，下一步先用一句话说清楚要做什么。';
}

async function restartFeishuAppConnection(){
  if(!IS_ELECTRON||!window.petBridge?.startFeishuApp) return;
  if(!cfg.feishuAppEnabled){
    await window.petBridge.stopFeishuApp?.();
    if(feishuAppStatusEl) feishuAppStatusEl.textContent='未启用飞书应用长连接';
    return;
  }
  if(!isValidFeishuAppId(cfg.feishuAppId)){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent='App ID 格式不正确';
    return;
  }
  if(feishuAppStatusEl) feishuAppStatusEl.textContent='正在连接飞书应用…';
  const result=await window.petBridge.startFeishuApp({appId:cfg.feishuAppId});
  if(feishuAppStatusEl) feishuAppStatusEl.textContent=result?.success?'飞书应用已连接，给机器人发消息即可同步到孬孬':'连接失败：'+(result?.error||'未知错误');
}

feishuConnectBtn?.addEventListener('click',async ()=>{
  const appId=feishuAppIdEl?.value.trim()||'';
  const secret=feishuAppSecretEl?.value.trim()||'';
  if(!isValidFeishuAppId(appId)){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent='App ID 格式不正确';
    return;
  }
  if(!secret){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent='请填写 App Secret';
    return;
  }
  if(window.petBridge?.setFeishuAppSecret){
    const saved=await window.petBridge.setFeishuAppSecret(secret);
    if(!saved){
      if(feishuAppStatusEl) feishuAppStatusEl.textContent='App Secret 保存失败';
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
    if(feishuChatIdEl) feishuChatIdEl.value=cfg.feishuAppChatId;
    appendMsg('user',`飞书汇报：${msg.text}`);
    const reply=summarizeFeishuReport(msg.text);
    appendMsg('pet',reply);
    if(msg.chatId&&window.petBridge?.sendFeishuApp){
      await window.petBridge.sendFeishuApp(msg.chatId, reply);
    }
  });
}

if(window.petBridge?.onFeishuStatus){
  window.petBridge.onFeishuStatus(status=>{
    if(feishuAppStatusEl) feishuAppStatusEl.textContent=status.connected?'飞书应用已连接':'飞书应用未连接';
  });
}

document.getElementById('feishu-test-btn')?.addEventListener('click',async ()=>{
  const webhook=feishuWebhookEl?.value.trim()||'';
  if(feishuAppEnabledEl?.checked&&feishuChatIdEl?.value.trim()&&window.petBridge?.sendFeishuApp){
    const result=await window.petBridge.sendFeishuApp(feishuChatIdEl.value.trim(), buildFeishuCheckinText(true));
    if(feishuStatusEl) feishuStatusEl.textContent=result?.success?'应用机器人测试提醒已发送':'发送失败：'+(result?.error||'未知错误');
    return;
  }
  if(!window.petBridge?.setFeishuWebhook||!window.petBridge?.sendFeishu){
    if(feishuStatusEl) feishuStatusEl.textContent='当前环境不支持飞书发送';
    return;
  }
  if(!isValidFeishuWebhook(webhook)){
    if(feishuStatusEl) feishuStatusEl.textContent='Webhook 格式不正确';
    return;
  }
  if(feishuStatusEl) feishuStatusEl.textContent='正在发送测试提醒…';
  const saved=await window.petBridge.setFeishuWebhook(webhook);
  if(!saved){
    if(feishuStatusEl) feishuStatusEl.textContent='Webhook 保存失败';
    return;
  }
  const result=await window.petBridge.sendFeishu(buildFeishuCheckinText(true));
  if(feishuStatusEl) feishuStatusEl.textContent=result?.success?'测试提醒已发送':'发送失败：'+(result?.error||'未知错误');
});

document.getElementById('save-btn').addEventListener('click',async ()=>{
  addLog('保存配置');
  const feishuWebhook=feishuWebhookEl?.value.trim()||'';
  const feishuEnabled=!!feishuEnabledEl?.checked;
  const feishuAppEnabled=!!feishuAppEnabledEl?.checked;
  const feishuAppId=feishuAppIdEl?.value.trim()||'';
  const feishuAppSecret=feishuAppSecretEl?.value.trim()||'';
  const feishuAppChatId=feishuChatIdEl?.value.trim()||'';
  if(feishuEnabled&&!feishuAppEnabled&&!isValidFeishuWebhook(feishuWebhook)){
    if(feishuStatusEl) feishuStatusEl.textContent='开启飞书监督前，请填写 Webhook，或启用飞书应用机器人';
    return;
  }
  if(feishuAppEnabled&&(!isValidFeishuAppId(feishuAppId)||!feishuAppSecret)){
    if(feishuAppStatusEl) feishuAppStatusEl.textContent='启用飞书应用前，请填写 App ID 和 App Secret';
    return;
  }
  if(window.petBridge?.setFeishuWebhook){
    const saved=await window.petBridge.setFeishuWebhook(feishuWebhook);
    if(!saved){
      if(feishuStatusEl) feishuStatusEl.textContent='飞书 Webhook 保存失败';
      return;
    }
  }
  if(window.petBridge?.setFeishuAppSecret){
    const saved=await window.petBridge.setFeishuAppSecret(feishuAppSecret);
    if(!saved){
      if(feishuAppStatusEl) feishuAppStatusEl.textContent='飞书 App Secret 保存失败';
      return;
    }
  }
  cfg={p:curP,k:fKey.value.trim(),m:fModel.value.trim(),
    b:fBase.value.trim().replace(/\/+$/,''),proxy:IS_ELECTRON?false:fProxy.checked,freq:cfg.freq||'mid',
    feishuEnabled,
    feishuInterval:normalizeFeishuInterval(feishuIntervalEl?.value),
    feishuAppEnabled,
    feishuAppId,
    feishuAppChatId};
  save();history=[];closeSettings();
  appendMsg('pet',hasKey()?'设置好了 ✦\n快来跟我聊天吧！':'好的，我在这里呢~ 🌸');
  restartFeishuAppConnection();
  restartFeishuSupervisor();
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
  return d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
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
      <div class="dlg-avatar">🐾</div>
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
    im.style.cssText='display:block;max-width:200px;max-height:200px;border-radius:10px;margin-bottom:6px;border:1.5px solid #e2d8ff';
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
    <div class="dlg-avatar">🐾</div>
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
function proxify(url){
  return cfg.proxy?`https://corsproxy.io/?${encodeURIComponent(url)}`:url;
}
function buildChatURL(base){
  const t=base.replace(/\/+$/,'');
  return /\/v\d+$/.test(t)?`${t}/chat/completions`:`${t}/v1/chat/completions`;
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
    <div class="dlg-avatar">🐾</div>
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
  clearAttachment();
  localStorage.setItem('nono_last_activity', Date.now());

  if(!hasKey()){
    // 没有 API key，确保本地模型已加载
    if (!localModelReady) {
      const loaded = await loadLocalModel((pct, msg) => {
        updateStatus(msg || '加载中…');
      });
      if (!loaded) {
        setTimeout(()=>{
          appendMsg('pet', '⚠️ 本地模型加载失败，当前使用智能话术回复。\n\n你可以：\n1. 检查模型文件是否完整\n2. 设置里填入 Gemini API key 获得更好的体验');
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
      const response = await localInference(msg);
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
    const txt=(e&&e.message)?e.message:String(e||'未知错误');
    appendErrorMsg(txt);
    if(history.at(-1)?.role==='user') history.pop();
    console.error('[孬孬]',e);
  }finally{busy=false;sendBtn.disabled=false;window._streamPatch=null;}
}

/* Patched wrapper that uses _streamPatch for first-chunk detection */
async function streamAPIPatched(msg,img){
  const isAnthropic=cfg.p==='anthropic';
  let userContent;
  if(img){
    if(isAnthropic){
      const m = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      const mediaType = m ? m[1] : 'image/png';
      const data = m ? m[2] : '';
      userContent = [
        { type:'image', source:{ type:'base64', media_type:mediaType, data } },
        { type:'text', text: msg || '(图片)' }
      ];
    } else {
      userContent = [
        { type:'text', text: msg || '(图片)' },
        { type:'image_url', image_url:{ url: img } }
      ];
    }
  } else {
    userContent = msg;
  }
  history.push({role:'user',content:userContent});
  if(history.length>20) history=history.slice(-20);
  const model=cfg.m||(isAnthropic?DEFAULT_MODEL.anthropic:DEFAULT_MODEL.openai);
  const url=isAnthropic
    ?proxify('https://api.anthropic.com/v1/messages')
    :proxify(buildChatURL(cfg.b||'https://api.openai.com'));

  const headers=isAnthropic
    ?{'content-type':'application/json','x-api-key':cfg.k,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'}
    :{'content-type':'application/json','Authorization':`Bearer ${cfg.k}`};

  const body=isAnthropic
    ?JSON.stringify({model,max_tokens:200,stream:true,system:SYS,messages:history})
    :JSON.stringify({model,messages:[{role:'system',content:SYS},...history],max_tokens:200,stream:true});

  let r;
  try{r=await fetch(url,{method:'POST',headers,body});}
  catch(e){throw new Error(`网络连接失败，请在 ⚙️ 设置中勾选"通过 CORS 代理"后重试。`);}
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.error?.message||`HTTP ${r.status}`);}

  const extractChunk=isAnthropic
    ?(d=>d?.delta?.type==='text_delta'?d.delta.text:null)
    :(d=>d?.choices?.[0]?.delta?.content||null);

  const reader=r.body.getReader();
  const dec=new TextDecoder();
  let buf='',full='';
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop();
    for(const line of lines){
      if(!line.startsWith('data:')) continue;
      const raw=line.slice(5).trim();
      if(raw==='[DONE]') break;
      try{
        const chunk=extractChunk(JSON.parse(raw));
        if(chunk){
          full+=chunk;
          const fn=window._streamPatch||onStreamChunk;
          fn(chunk);
        }
      }catch(e){console.error('stream chunk parse:',e)}
    }
  }
  history.push({role:'assistant',content:full||'…'});
}

function appendErrorMsg(txt){
  showDialog();
  const row=document.createElement('div');
  row.className='dlg-row pet';
  row.innerHTML=`
    <div class="dlg-avatar">🐾</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble" style="background:#fff0f0;border-color:#f4c0c0;color:#b54b4b;font-size:12px">⚠️ ${escHtml(txt)}</div>
      <div class="dlg-time">${fmtTime(new Date())}</div>
    </div>`;
  dlgMsgs.appendChild(row);
  scrollToBottom();
}

/* ════════ NON-STREAMING JSON REQUEST (for AI 拆解) ════════ */
async function requestJSON(userPrompt, systemPrompt, opt={}){
  const timeoutMs=opt.timeoutMs||120000;
  const isAnthropic=cfg.p==='anthropic';
  const model=cfg.m||(isAnthropic?DEFAULT_MODEL.anthropic:DEFAULT_MODEL.openai);
  const url=isAnthropic
    ?proxify('https://api.anthropic.com/v1/messages')
    :proxify(buildChatURL(cfg.b||'https://api.openai.com'));
  const headers=isAnthropic
    ?{'content-type':'application/json','x-api-key':cfg.k,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'}
    :{'content-type':'application/json','Authorization':`Bearer ${cfg.k}`};
  const body=isAnthropic
    ? {model,max_tokens:800,system:systemPrompt,messages:[{role:'user',content:userPrompt}]}
    : {model,messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:userPrompt}
      ],max_tokens:800,stream:false};
  
  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),timeoutMs);
  let r;
  
  try{
    r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:ctrl.signal});
  }catch(e){
    clearTimeout(tid);
    if(e.name==='AbortError') throw new Error('请求超时');
    throw new Error('网络连接失败');
  }
  clearTimeout(tid);
  
  if(!r.ok){
    const e=await r.json().catch(()=>({}));
    throw new Error(e?.error?.message||`HTTP ${r.status}`);
  }
  const data=await r.json();
  if(isAnthropic) return data?.content?.[0]?.text || '';
  return data?.choices?.[0]?.message?.content || '';
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
Each step: imperative, <=20 chars (Chinese) or <=40 chars (English),
specific enough to start in <2 minutes. Match the language of the input.`;

async function requestBreakdown(taskId, confirmReplace){
  const t=TaskStore.state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  if(!hasKey()){
    _toastByTaskId[taskId]='请先在设置里配置 API Key';
    renderTasks();return;
  }
  // 已有子步骤 → 弹框确认替换
  if(!confirmReplace && t.subtasks.length>0){
    const ok = await petDialog.confirm(
      `「${t.title}」已经有 ${t.subtasks.length} 个子步骤，要替换成新的拆解结果吗？`,
      { title:'重新拆解', okText:'替换', cancelText:'保留原来的' });
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
      _toastByTaskId[taskId]='AI 没返回有效结果';
      addLog('AI 没返回有效结果');
    } else {
      TaskStore.setSubtasks(taskId, steps);
      addLog(`拆解成功，得到 ${steps.length} 个步骤`);
    }
  }catch(e){
    _toastByTaskId[taskId]='拆解失败：'+(e.message||'未知错误');
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
    if(!ALLOWED.includes(f.type)){ petDialog.alert('只支持 PNG / JPEG / WEBP / GIF 图片', { title:'图片格式不支持' }); fileInput.value=''; return; }
    if(f.size > 4*1024*1024){ petDialog.alert('图片太大啦，请上传 4MB 以内的图片', { title:'图片过大' }); fileInput.value=''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const url = e.target.result;
      // Belt-and-suspenders: confirm the data URL prefix matches what we accepted
      if(typeof url !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);/i.test(url)){
        petDialog.alert('图片格式异常', { title:'图片读取失败' }); fileInput.value=''; return;
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
      try{localStorage.setItem(TASKS_KEY,JSON.stringify(state));}catch(e){console.error(e);}
      // 镜像写回 zt_task：active 任务的 title（兼容已发布的气泡逻辑）
      const a=getActive();
      localStorage.setItem('nono_task', a?a.title:'');
    },200);
  }
  function getActive(){return state.tasks.find(t=>t.id===state.activeId)||null;}
  function load(){
    try{
      const raw=localStorage.getItem(TASKS_KEY);
      if(raw){state=JSON.parse(raw); if(!state.tasks)state.tasks=[]; return;}
    }catch(e){console.warn('TaskStore load failed',e);}
    // 迁移：旧 zt_task 字符串 → 第一条任务
    const old=(localStorage.getItem('nono_task')||'').trim();
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
  // 跨窗口同步：另一个窗口写了 zt_tasks_v1 时，本窗口刷新
  window.addEventListener('storage', e=>{
    if(e.key===TASKS_KEY){
      try{
        const next=e.newValue?JSON.parse(e.newValue):{version:1,activeId:null,tasks:[]};
        if(next && Array.isArray(next.tasks)){state=next; notify();}
      }catch(e){console.error('storage event parse:',e)}
    }
  });
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
        taskAddInput.placeholder=`已达上限 ${MAX_TASKS} 个任务`;
        setTimeout(()=>{taskAddInput.placeholder='加个任务…（回车确认）';},2000);
        return;
      }
      taskAddInput.value='';
      localStorage.setItem('nono_last_activity', Date.now());
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
    taskRowsEl.innerHTML='<div id="task-empty">点 + 加第一个任务，让我陪你专注 🐨</div>';
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
        <button class="tl-menu-btn" data-act="menu" aria-label="任务菜单">⋯</button>
      </div>
      <div class="tl-subs">
        ${t.subtasks.map(s=>`
          <div class="tl-sub${s.done?' done':''}" data-sub-id="${escAttr(s.id)}">
            <div class="tl-check${s.done?' on':''}" data-act="toggle"></div>
            <span class="tl-sub-text" data-act="sub-text">${escHtml(s.text)}</span>
            <button class="tl-sub-del" data-act="sub-del" aria-label="删除">✕</button>
          </div>
        `).join('')}
        ${_aiBusyTaskId===t.id ? `
          <div class="tl-shimmer">
            <div class="tl-shimmer-row" style="width:80%"></div>
            <div class="tl-shimmer-row" style="width:60%"></div>
            <div class="tl-shimmer-row" style="width:72%"></div>
            <div class="tl-shimmer-tip">✦ AI 正在拆解…</div>
          </div>
        ` : ''}
        ${_toastByTaskId[t.id] ? `
          <div class="tl-toast">
            <span>${escHtml(_toastByTaskId[t.id])}</span>
            <button data-act="retry">重试</button>
            <button data-act="toast-close">关</button>
          </div>
        ` : ''}
        <div class="tl-actions">
          ${(hasKey() && _aiBusyTaskId!==t.id) ? `<button class="tl-btn primary" data-act="ai">✦ AI 帮我拆</button>`:''}
          ${t.subtasks.length<MAX_SUBS ? `<button class="tl-btn" data-act="add-sub">+ 子步骤</button>`:''}
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
      localStorage.setItem('nono_last_activity', Date.now());
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
      petDialog.prompt('新的子步骤：',
        { title:'添加子步骤', placeholder:'比如「打开编辑器」', okText:'添加' })
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
        localStorage.setItem('nono_last_activity', Date.now());
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
    <button data-m="rename">重命名</button>
    <button data-m="toggle-done">${t.done?'恢复':'标记完成'}</button>
    <button data-m="delete" class="danger">删除任务</button>
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
      const ok = await petDialog.confirm(`确定要删除任务「${t.title}」吗？这个操作无法撤销。`,
        { title:'删除任务', danger:true, okText:'删除', cancelText:'再想想' });
      if(ok) TaskStore.removeTask(taskId);
    } else {
      closeMenu();
    }
  });
}

TaskStore.onChange(renderTasks);
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
  pomoModeEl.textContent=pomoMode==='work'?'专注中':'休息中';
  pomoCountEl.textContent=`🍅 × ${pomoCount}`;
  pomoWidget.classList.toggle('break-mode',pomoMode==='break');
  pomoStartBtn.textContent=pomoRunning?'暂停':'开始';
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
    const head=act?`「${act.title}」专注完成！🌸`:'专注完成！🌸';
    const next=act?TaskStore.nextUnchecked(act.id):null;
    if(next){
      appendPomoNext(head, act.id, next.id, next.text);
    } else {
      appendMsg('pet',`${head}\n休息 5 分钟，深呼吸～`);
      setTimeout(()=>promptMood(),800);
    }
  } else {
    pomoMode='work';pomoLeft=POMO_WORK;pomoTotal=POMO_WORK;
    appendMsg('pet','休息结束啦 💜\n准备好继续了吗？');
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
  read(){try{let d=JSON.parse(localStorage.getItem(STATS_KEY));return d&&d.version===STATS_VERSION?d:null}catch(e){return null}},
  write(data){data.version=STATS_VERSION;localStorage.setItem(STATS_KEY,JSON.stringify(data))},
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
      ?`<div class="stat-empty">🍅<br>还没有番茄记录<br>开一个试试吧～</div>`
      :`<div class="stat-numbers"><div class="stat-big">🔥 ${streak}</div><div class="stat-label">连续打卡</div></div>
         <div class="stat-row"><span>今日</span><strong>${today} 🍅</strong><span>本周</span><strong>${week} 🍅</strong></div>
         <div class="stat-row">累计专注 <strong>${total} 分钟</strong></div>`;
  },
  renderCalendar(){
    const el=document.getElementById('stats-cal');
    const weeks=StatsStore.calendarWeeks();
    let h='<div class="cal-grid">';
    const labels=['一','二','三','四','五','六','日'];
    h+='<div class="cal-row cal-hdr">'+labels.map(l=>`<div class="cal-cell cal-label">${l}</div>`).join('')+'</div>';
    weeks.forEach(w=>{
      h+='<div class="cal-row">'+w.map(d=>{
        let cls='cal-cell';
        if(d.future) cls+=' cal-future';
        else if(d.count>0) cls+=' cal-done';
        else cls+=' cal-empty';
        if(d.today) cls+=' cal-today';
        return `<div class="${cls}" title="${d.date}: ${d.count}🍅">${d.count>0?'🍅':''}</div>`;
      }).join('')+'</div>';
    });
    h+='</div>';
    el.innerHTML=h;
  },
  renderFridgeCard(){
    const el=document.getElementById('stats-fridge-card');
    const total=freezerItems.length;
    el.innerHTML=total===0
      ?`<div class="stat-empty">🧊<br>还没有冷冻的想法<br><small>点击 💡 把闪现的想法冻起来</small></div>`
      :`<div class="stat-numbers"><div class="stat-big">🧊 ${total}</div><div class="stat-label">已冷冻的想法</div></div>
         <div class="stat-row">最新：<strong>${escHtml((freezerItems[0]?.text||'').slice(0,20))}</strong></div>`;
  },
  renderTrend(){
    const el=document.getElementById('stats-trend');
    const m=StatsStore.dailyMap(this.trendDays);
    const days=Object.keys(m).sort();
    const max=Math.max(...Object.values(m),1);
    let h=`<div class="trend-header">📈 近${this.trendDays}天趋势 <button class="trend-switch">${this.trendDays===7?'30天':'7天'}</button></div>
           <div class="trend-bars">`;
    days.forEach(d=>{
      const v=m[d];const pct=(v/max*100).toFixed(0);
      const label=d.slice(5);
      h+=`<div class="trend-bar-wrap"><div class="trend-bar" style="height:${pct}%" title="${d}: ${v}🍅"></div><span class="trend-label">${label}</span></div>`;
    });
    h+='</div>';
    const mm=getMoodTrend(this.trendDays);
    const me={3:'😊',2:'😐',1:'😣'};
    h+='<div class="mood-row">'+days.map(d=>`<span class="mood-dot">${mm[d]?me[mm[d]]:''}</span>`).join('')+'</div>';
    el.innerHTML=h;
    setTimeout(()=>{const btn=document.querySelector('#stats-trend .trend-switch');if(btn)btn.addEventListener('click',()=>StatsRenderer.switchTrend(StatsRenderer.trendDays===7?30:7));},0);
  },
  trendDays:7,
  switchTrend(days){this.trendDays=days;this.renderTrend();}
};

/* ════════ STATS DRAWER EVENTS ════════ */
document.getElementById('stats-toggle').addEventListener('click',()=>{
  const d=document.getElementById('stats-drawer');
  const o=document.getElementById('stats-overlay');
  const open=d.classList.contains('open');
  if(open){d.classList.remove('open');o.style.display='none'}
  else{StatsRenderer.renderAll();d.classList.add('open');o.style.display='block'}
});
document.getElementById('stats-overlay').addEventListener('click',()=>{
  document.getElementById('stats-drawer').classList.remove('open');
  document.getElementById('stats-overlay').style.display='none';
});
document.getElementById('stats-close').addEventListener('click',()=>{
  document.getElementById('stats-drawer').classList.remove('open');
  document.getElementById('stats-overlay').style.display='none';
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
  if(bdOn)appendMsg('pet','🐨 孬孬也在认真陪你哦～');
});
window.addEventListener('storage',e=>{
  if(e.key==='nono_bd'){
    bdOn=e.newValue==='1';
    updateBD(false);
  }
});
updateBD();

/* ════════ FREEZER ════════ */
let freezerItems=JSON.parse(localStorage.getItem('nono_freezer')||'[]');
const fzDrawer=document.getElementById('freezer-drawer');
const fzOverlay=document.getElementById('freezer-overlay');
const fzList=document.getElementById('freezer-list');
const fzEmpty=document.getElementById('freezer-empty');
const fzInput=document.getElementById('freezer-input');
const fzBtn=document.getElementById('freezer-btn');

const updateFreezer=()=>{localStorage.setItem('nono_freezer',JSON.stringify(freezerItems));fzBtn.setAttribute('data-count',freezerItems.length);renderFreezerList()};
const freezeIdea=(text)=>{if(!text.trim())return;freezerItems.unshift({id:'fz_'+Date.now(),text:text.trim(),frozenAt:new Date().toISOString()});updateFreezer();fzInput.value=''};
const thawIdea=(id)=>{freezerItems=freezerItems.filter(i=>i.id!==id);updateFreezer()};
const useIdea=(id)=>{const item=freezerItems.find(i=>i.id===id);if(!item)return;const taskInput=document.getElementById('task-add-input');if(taskInput){taskInput.value=item.text;taskInput.focus();taskInput.dispatchEvent(new Event('input',{bubbles:true}))}thawIdea(id);closeFreezer()};
const renderFreezerList=()=>{fzList.innerHTML='';if(freezerItems.length===0){fzEmpty.style.display='block';fzList.style.display='none'}else{fzEmpty.style.display='none';fzList.style.display='flex';freezerItems.forEach(item=>{const el=document.createElement('div');el.className='fz-item';el.innerHTML=`<span class="fz-text"></span><button class="fz-use" title="取用为任务锚">📌</button><button class="fz-thaw" title="解冻删除">✕</button>`;el.querySelector('.fz-text').textContent=item.text;el.querySelector('.fz-use').addEventListener('click',()=>useIdea(item.id));el.querySelector('.fz-thaw').addEventListener('click',()=>thawIdea(item.id));fzList.appendChild(el)})}};
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
let moodJournal=JSON.parse(localStorage.getItem(MOOD_KEY)||'[]');
const saveMood=()=>localStorage.setItem(MOOD_KEY,JSON.stringify(moodJournal));
const promptMood=()=>{
  const row=document.createElement('div');row.className='mood-prompt';
  row.innerHTML='<span>刚才感觉怎么样？</span><button data-m="great">😊</button><button data-m="ok">😐</button><button data-m="😣">😣</button>';
  row.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    moodJournal.push({mood:b.dataset.m,date:localDateKey(),ts:Date.now()});
    saveMood();
    row.innerHTML='<span style="opacity:.7">记录啦～ '+b.textContent+'</span>';
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
    <div class="dlg-avatar">🍅</div>
    <div class="dlg-msg-wrap">
      <div class="dlg-bubble"></div>
      <div class="dlg-time">${fmtTime(new Date())}</div>
    </div>`;
  dlgMsgs.appendChild(row);
  const bubble=row.querySelector('.dlg-bubble');
  const doneList=[]; // 已经在这条消息里勾掉的子步骤文本

  function render(currentSub){
    const checks=doneList.map(t=>`<div style="color:#7c5cbf">✓ ${escHtml(t)}</div>`).join('');
    if(currentSub){
      bubble.innerHTML=`${escHtml(head)}${checks}<br>下一步：<b>${escHtml(currentSub.text)}</b>
        <div class="pomo-next-act">
          <button class="pomo-next-do">✓ 完成这步</button>
          <button class="pomo-next-skip">跳过</button>
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
      bubble.innerHTML=`${escHtml(head)}${checks}<br>🎉 全部完成！休息 5 分钟吧 🌸`;
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
  const hm=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const act = TaskStore.getActive();
  if(act){
    const next = TaskStore.nextUnchecked(act.id);
    if(next){
      const msgs=[
        `${hm} ✨\n下一步：${next.text}`,
        `${hm} 了 🌙\n要不要做「${next.text}」？`,
        `${hm} ☁️\n「${act.title}」下一步：${next.text}`,
      ];
      return rand(msgs);
    }
    const msgs=[
      `${hm} ☁️\n你还在做「${act.title}」吗？`,
      `${hm} 了 🌙\n「${act.title}」进展怎么样？`,
      `${hm} ✨\n还好吗，还在做「${act.title}」？`,
    ];
    return rand(msgs);
  } else {
    const msgs=[
      `${hm} 🕐\n你在做什么呢？`,
      `${hm} 了，注意时间哦 🌸`,
      `${hm}，还好吗？ 💜`,
    ];
    return rand(msgs);
  }
}

let feishuSupervisorTimer=null;
let feishuSending=false;

function buildFeishuCheckinText(isTest=false){
  const now=new Date();
  const hm=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  const act=TaskStore.getActive();
  const lines=[
    isTest ? '【孬孬测试提醒】' : '【孬孬监督签到】',
    `${hm} 现在在做什么？`,
  ];
  if(act){
    const next=TaskStore.nextUnchecked(act.id);
    lines.push(`当前任务：${act.title}`);
    if(next) lines.push(`下一步：${next.text}`);
  }
  lines.push('请用一句话回复/记录：我刚才在做什么，下一步做什么。');
  return lines.join('\n');
}

async function sendFeishuSupervisorCheckin(isTest=false){
  if(!IS_ELECTRON||feishuSending) return {success:false,error:'飞书发送不可用'};
  feishuSending=true;
  try{
    const text=buildFeishuCheckinText(isTest);
    const result=(cfg.feishuAppEnabled&&cfg.feishuAppChatId&&window.petBridge?.sendFeishuApp)
      ? await window.petBridge.sendFeishuApp(cfg.feishuAppChatId, text)
      : window.petBridge?.sendFeishu
        ? await window.petBridge.sendFeishu(text)
        : {success:false,error:'飞书发送不可用'};
    if(result?.success){
      addLog(isTest?'飞书测试提醒已发送':'飞书监督提醒已发送');
    }else{
      addLog('飞书提醒发送失败：'+(result?.error||'未知错误'));
    }
    return result;
  }finally{
    feishuSending=false;
  }
}

function restartFeishuSupervisor(){
  if(feishuSupervisorTimer){
    clearTimeout(feishuSupervisorTimer);
    feishuSupervisorTimer=null;
  }
  if(!_isPetWin||!cfg.feishuEnabled) return;
  const minutes=normalizeFeishuInterval(cfg.feishuInterval);
  addLog(`飞书监督计时器已启动：每 ${minutes} 分钟提醒一次`);
  const schedule=()=>{
    feishuSupervisorTimer=setTimeout(async ()=>{
      if(cfg.feishuEnabled) await sendFeishuSupervisorCheckin(false);
      schedule();
    }, minutes*60*1000);
  };
  schedule();
}

// 自动提醒 — 只在宠物窗口触发，且只走头顶气泡（不进聊天对话框、不污染 AI 上下文）
// Web (non-Electron) 也走宠物视图，所以兼容判断
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
          : (Math.random()<0.4?rand(ADHD_TIPS):smartFallback(''));
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



/* ════════ HELPERS ════════ */
function rand(a){return a[Math.floor(Math.random()*a.length)];}
function spawnHeart(cx,cy){
  const pool=['💜','✨','🌸','⭐','💖'];
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
        long breath). The 🍅 becomes a tiny static badge.
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
const PHRASES=[
  {label:'😵 我走神了',text:'我刚才走神了，帮我重新专注一下'},
  {label:'😓 好累',text:'感觉好累，不想动'},
  {label:'🌀 脑子乱',text:'脑子很乱，不知道该做什么'},
  {label:'✨ 帮我专注',text:'帮我专注，我现在要开始做事了'},
  {label:'🌸 鼓励我',text:'给我一句鼓励吧'},
  {label:'😤 做不下去',text:'这件事我做不下去了'},
];

const quickBar=document.getElementById('quick-bar');
PHRASES.forEach(({label,text})=>{
  const btn=document.createElement('button');
  btn.className='qp'; btn.textContent=label;
  btn.addEventListener('click',()=>{
    if(busy) return;
    // brief "sent" flash
    btn.classList.add('sent');
    setTimeout(()=>btn.classList.remove('sent'),600);
    // put text into input then send
    chatInput.value=text;
    send();
  });
  quickBar.appendChild(btn);
});


const BAR_H_PET=110;
let px=Math.max(20,Math.round(window.innerWidth*0.28));
let py=Math.min(window.innerHeight/2-80,window.innerHeight-BAR_H_PET-160);
function applyPos(){pw.style.left=px+'px';pw.style.top=py+'px';}
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
    appendMsg('pet',hasKey()?'在这里呢~ 🌸\n有什么想说的吗？':smartFallback('你好'));
  }
}
// Pet-window-only drag/resize: in chat/settings windows the pet element isn't visible,
// so binding global mouse/touch listeners there just wastes CPU on every pointer event.
if(!IS_ELECTRON || IS_PET_WIN){
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
    setTimeout(()=>{overlay.style.display='none';},400);
    // happy reaction from koala after onboarding
    if(typeof setHappy==='function') setHappy(true);
    if(typeof spawnHeart==='function') spawnHeart(px+55,py+40);
    // Start greetings now that onboarding is done
    if(typeof startGreetings==='function') startGreetings();
    // 引导完成后显示问候气泡
    setTimeout(()=>{if(typeof showMini==='function') showMini('你好呀，我是孬孬');},800);
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
  overlay.addEventListener('click',function(e){
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
      if(key) cfg.k=key;
      if(base) cfg.b=base;
      if(model) cfg.m=model;
      save();
      if(typeof updateStatus==='function') updateStatus();
      showStep(2);
      setTimeout(()=>{const el=document.getElementById('onboard-task');if(el)el.focus();},400);
    }else if(action==='done'){
      const task=document.getElementById('onboard-task').value.trim();
      if(task){
        // Use TaskStore if available, fallback to localStorage
        if(typeof TaskStore !== 'undefined' && TaskStore.addTask){
          TaskStore.addTask(task);
        } else {
          // Fallback: set zt_task directly
          localStorage.setItem('nono_task', task);
        }
        localStorage.setItem('nono_last_activity', Date.now());
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
    apiKeyInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        const key=this.value.trim();
        const base=(obBase?obBase.value:'').trim().replace(/\/+$/,'');
        const model=obModel?obModel.value.trim():'';
        cfg.p=obProvider;
        if(key) cfg.k=key;
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
            localStorage.setItem('nono_task', task);
          }
          localStorage.setItem('nono_last_activity', Date.now());
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
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.title = '关闭';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => window.petBridge.closeSelf();
    hdrBtns.appendChild(closeBtn);
  }
  // Drag the chat window by its header (excluding buttons)
  const dlgHeader = document.getElementById('dlg-header');
  if(dlgHeader && window.petBridge){
    let cDrag=false, cLastX=0, cLastY=0;
    dlgHeader.addEventListener('mousedown', e=>{
      // Allow buttons to be clicked
      if(e.target.closest('button')) return;
      cDrag=true; cLastX=e.screenX; cLastY=e.screenY;
      dlgHeader.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!cDrag) return;
      const dx=e.screenX-cLastX, dy=e.screenY-cLastY;
      window.petBridge.moveWindow(dx,dy);
      cLastX=e.screenX; cLastY=e.screenY;
    });
    window.addEventListener('mouseup', ()=>{
      if(!cDrag) return;
      cDrag=false;
      dlgHeader.classList.remove('dragging');
    });
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
    let sDrag=false, sLastX=0, sLastY=0;
    sHeader.style.webkitAppRegion = 'no-drag';   // turn off the broken native drag
    sHeader.style.cursor = 'grab';
    sHeader.addEventListener('mousedown', e=>{
      if(e.target.closest('button')) return;
      sDrag=true; sLastX=e.screenX; sLastY=e.screenY;
      sHeader.style.cursor='grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!sDrag) return;
      const dx=e.screenX-sLastX, dy=e.screenY-sLastY;
      window.petBridge.moveWindow(dx,dy);
      sLastX=e.screenX; sLastY=e.screenY;
    });
    window.addEventListener('mouseup', ()=>{
      if(!sDrag) return;
      sDrag=false; sHeader.style.cursor='grab';
    });
  }
} else if(IS_PET_WIN){
  document.body.classList.add('pet-mode');
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.setProperty('--bg','transparent');
  document.documentElement.style.setProperty('--bar-bg','transparent');
  document.body.style.background = 'transparent';
  document.body.style.backgroundColor = 'transparent';

  // Tray buttons
  // Chat button: always opens (or focuses if already open) the chat window. Never toggles icon.
  document.getElementById('tray-expand').addEventListener('click', ()=>{
    window.petBridge.expand();
    petExpanded = true;
  });

  document.getElementById('tray-settings').addEventListener('click', ()=>{
    window.petBridge.openSettings();
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
    miniTimer = setTimeout(()=>miniBubble.classList.remove('show'), 10000);
  }
  // 让自动提醒走头顶气泡，超长文本截断
  _bubblePush = (msg)=>{
    if(!msg) return;
    showMini(String(msg));
    localStorage.setItem('nono_last_activity', Date.now());
  };
  // 上线问候——让用户立刻确认气泡能弹出
  setTimeout(()=>showMini('你好呀，我是孬孬'), 4000);

  /* ── Pixel-perfect click-through ── */
  const petImg = document.getElementById('pet-img');
  const alphaCanvas = document.createElement('canvas');
  const alphaCtx = alphaCanvas.getContext('2d');
  function setupAlpha(){
    alphaCanvas.width = petImg.naturalWidth;
    alphaCanvas.height = petImg.naturalHeight;
    alphaCtx.drawImage(petImg, 0, 0);
  }
  if(petImg.complete && petImg.naturalWidth) setupAlpha();
  else petImg.addEventListener('load', setupAlpha);

  function isOverKoala(cx, cy){
    // Always respond over tray buttons
    const tray = document.getElementById('pet-tray');
    if(tray){
      const tr = tray.getBoundingClientRect();
      if(cx>=tr.left&&cx<=tr.right&&cy>=tr.top&&cy<=tr.bottom) return true;
    }
    // Check pixel alpha on koala image
    const rect = petImg.getBoundingClientRect();
    if(cx<rect.left||cx>rect.right||cy<rect.top||cy>rect.bottom) return false;
    const sx = Math.round((cx-rect.left)/rect.width*alphaCanvas.width);
    const sy = Math.round((cy-rect.top)/rect.height*alphaCanvas.height);
    try{ return alphaCtx.getImageData(sx,sy,1,1).data[3] > 30; }
    catch(e){ return true; }
  }

  /* ── Drag + click ── */
  let dragging=false, lastX=0, lastY=0, dragMoved=false;

  window.addEventListener('mousemove', e=>{
    if(dragging){
      const dx=e.screenX-lastX, dy=e.screenY-lastY;
      if(Math.abs(dx)>1||Math.abs(dy)>1) dragMoved=true;
      window.petBridge.moveWindow(dx,dy);
      lastX=e.screenX; lastY=e.screenY;
      return;
    }
    window.petBridge.setIgnoreMouse(!isOverKoala(e.clientX,e.clientY));
  });

  window.addEventListener('mousedown', e=>{
    if(!isOverKoala(e.clientX,e.clientY)) return;
    if(e.target.closest('.tray-btn')) return;
    window.petBridge.setIgnoreMouse(false);
    dragging=true; dragMoved=false;
    lastX=e.screenX; lastY=e.screenY;
    e.preventDefault();
  });

  window.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging=false;
    window.petBridge.setIgnoreMouse(false);
    if(!dragMoved){
      petReact();
      setHappy(true);
      spawnHeart(60,80);
      const msg = Math.random()<0.35 ? rand(ADHD_TIPS) : smartFallback('');
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
  const IDLE_REMIND_MSGS = [
    '你还在做「{t}」吗？ 💜',
    '「{t}」进展怎么样了？',
    '嘿，别忘了「{t}」哦 🌸',
    '「{t}」加油！我在陪着你 ✨',
    '还好吗？「{t}」还等着你呢 🐨',
    '休息够了就继续「{t}」吧～',
  ];
  // 初始化活跃时间（冷启动时不立刻提醒）
  if(!localStorage.getItem('nono_last_activity')){
    localStorage.setItem('nono_last_activity', Date.now());
  }

  // 启动时：自动检测并加载内置本地模型
  (async () => {
    const status = await refreshLocalModelStatus();
    if (status.hasModel && !status.ready && !status.loading) {
      if (typeof addLog === 'function') addLog('[模型] 检测到内置模型，后台加载中…');
      const ok = await loadLocalModel();
      if (ok && typeof addLog === 'function') addLog('[模型] 后台加载完成 ✅');
      updateStatus();
    }
  })();
  // 点击宠物也算活跃
  const _origShowMini = showMini;
  showMini = function(msg){
    localStorage.setItem('nono_last_activity', Date.now());
    _origShowMini(msg);
  };

  setInterval(()=>{
    const freq = cfg.freq || 'mid';
    const threshold = IDLE_THRESHOLDS[freq];
    if(threshold === null) return; // 关闭提醒
    const act = TaskStore.getActive();
    if(!act) return; // 没有设置任务
    const lastAct = parseInt(localStorage.getItem('nono_last_activity') || '0');
    const idle = Date.now() - lastAct;
    if(idle >= threshold){
      const next = TaskStore.nextUnchecked(act.id);
      let msg;
      if(next){
        // 优先提醒下一个具体子步骤
        const tpls = [
          `下一步：${next.text} ✨`,
          `还差「${next.text}」一步～`,
          `「${next.text}」加油 💜`,
        ];
        msg = tpls[Math.floor(Math.random()*tpls.length)];
      } else {
        const tpl = IDLE_REMIND_MSGS[Math.floor(Math.random()*IDLE_REMIND_MSGS.length)];
        msg = tpl.replace('{t}', act.title);
      }
      showMini(msg);
      localStorage.setItem('nono_last_activity', Date.now());
    }
  }, 60*1000);
}

})();
