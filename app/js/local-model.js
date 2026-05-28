'use strict';

/* ════════ 本地 AI 模型（按需下载，不内置到安装包）═══ */
// 模型不在安装包中，用户点击按钮后从 HF 镜像下载（约 460MB）
// 推理由 main 进程通过 @xenova/transformers (Node.js) 执行，通过 IPC 通信
let localModelLoading = false;
let localModelReady = false;
let localModelHasFiles = false;

async function refreshLocalModelStatus() {
  try {
    const status = await window.petBridge.localModelStatus();
    localModelHasFiles = status.hasModel;
    localModelReady = status.ready;
    localModelLoading = status.loading;
    return status;
  } catch (e) {
    console.error('[孬孬] 获取模型状态失败:', e);
    return { hasModel: false, ready: false, loading: false };
  }
}

async function loadLocalModel(onProgress) {
  if (localModelLoading) return false;
  localModelLoading = true;
  if (onProgress) onProgress(10, '正在初始化本地模型…');
  try {
    const ok = await window.petBridge.localModelLoad();
    localModelReady = ok;
    localModelLoading = false;
    if (ok && onProgress) onProgress(100, '✅ 模型已就绪');
    return ok;
  } catch (e) {
    console.error('[孬孬] 加载本地模型失败:', e);
    localModelLoading = false;
    return false;
  }
}

async function localInference(text) {
  try {
    if (typeof addLog === 'function') addLog('[模型] 开始推理…');
    const response = await window.petBridge.localModelInference(text);
    if (typeof addLog === 'function') addLog('[模型] 推理结果: ' + (response ? response.slice(0, 80) : 'null'));
    return response;
  } catch (e) {
    console.error('[孬孬] 推理失败:', e);
    if (typeof addLog === 'function') addLog('❌ 推理异常: ' + (e?.message || e).slice(0, 100));
    return null;
  }
}

function hasLocalModel() {
  return localModelReady;
}

function getLocalModelStatus() {
  if (localModelLoading) return '加载中…';
  if (localModelReady) return '✅ 已就绪';
  if (localModelHasFiles) return '⏸️ 已下载，点击加载';
  return '❌ 未下载（约 460MB）';
}

