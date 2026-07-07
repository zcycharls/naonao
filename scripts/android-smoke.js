'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const repo = path.resolve(__dirname, '..');
const browserCandidates = [
  process.env.NAONAO_BROWSER,
  process.env.CHROME_BIN,
  process.env.EDGE_BIN,
  ...(process.platform === 'win32' ? [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ]),
].filter(Boolean);
const assetsDir = path.join(repo, 'android', 'src', 'main', 'assets');
const html = path.join(assetsDir, 'index.html');
const profile = path.join(repo, '.tmp', `android-smoke-browser-${Date.now()}`);
const shot = path.join(repo, 'deliverables', 'android', 'android-smoke.png');
const screensDir = path.join(repo, 'deliverables', 'android', 'screens');
const report = path.join(repo, 'deliverables', 'android', 'android-smoke-report.json');
const measuredDir = path.join(repo, '.tmp', `android-smoke-measure-${Date.now()}`);
const measuredHtml = path.join(measuredDir, 'index.html');
const viewport = { width: 390, height: 844 };
const simulatedSafeArea = { top: 12, right: 0, bottom: 24, left: 0 };
const storageKey = 'naonao_android_state_v1';

function sampleState() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const keyFor = (offset) => new Date(now + offset * dayMs).toISOString().slice(0, 10);
  return {
    tasks: [
      {
        id: 'task_focus',
        title: '写完项目发布说明并检查下载链接',
        done: false,
        createdAt: now - 600000,
        subtasks: [
          { id: 'sub_1', text: '打开 README 对照功能清单', done: true },
          { id: 'sub_2', text: '确认 APK 哈希和安装说明都写对', done: false },
          { id: 'sub_3', text: '给自己留 5 分钟复盘，不临时加需求', done: false },
        ],
      },
      {
        id: 'task_later',
        title: '整理下周复诊要问的问题',
        done: false,
        createdAt: now - 1800000,
        subtasks: [],
      },
    ],
    activeId: 'task_focus',
    freezer: [
      { id: 'fridge_1', text: '突然想到要买降噪耳塞和替换笔芯', createdAt: now - 900000 },
      { id: 'fridge_2', text: '想查一下安卓通知权限为什么有时候默认关闭', createdAt: now - 1200000 },
    ],
    stats: {
      days: {
        [keyFor(-13)]: { pomos: 1, minutes: 25 },
        [keyFor(-10)]: { pomos: 2, minutes: 50 },
        [keyFor(-8)]: { pomos: 1, minutes: 25 },
        [keyFor(-5)]: { pomos: 3, minutes: 75 },
        [keyFor(-3)]: { pomos: 2, minutes: 50 },
        [keyFor(-1)]: { pomos: 1, minutes: 25 },
        [keyFor(0)]: { pomos: 2, minutes: 50 },
      },
    },
    moods: [
      { at: now - 7200000, mood: '有点乱', task: '写完项目发布说明并检查下载链接' },
      { at: now - 3600000, mood: '稳住了', task: '整理下周复诊要问的问题' },
    ],
    chat: [
      { role: 'pet', text: '我在。写一个任务锚，我们从小步开始。', at: now - 1200000 },
      { role: 'user', text: '我现在有点想同时改很多东西。', at: now - 900000 },
      { role: 'pet', text: '先只保留 APK 验证这一件事，其他想法放进冰箱。', at: now - 850000 },
    ],
    bodyDouble: true,
    timer: {
      running: false,
      mode: 'focus',
      startedAt: 0,
      durationMs: 25 * 60 * 1000,
      remainingMs: 13 * 60 * 1000 + 25 * 1000,
      completed: 4,
      intent: '确认 APK 哈希和安装说明都写对',
    },
    longTasks: [
      {
        id: 'long_release',
        title: '把孬孬 Android 发布流程稳定下来',
        goal: '每次发布前都要有包体验证、截图验收和安装验收记录。',
        interval: 1440,
        enabled: true,
        hasWebhook: true,
        createdAt: now - 86400000,
        nextDueAt: now + 3600000,
        lastSentAt: now - 7200000,
      },
    ],
    lastActivityAt: now - 60000,
  };
}

function fail(message, child) {
  if (child && !child.killed) child.kill();
  console.error(message);
  process.exit(1);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(800, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }
  throw new Error('Edge DevTools target did not start');
}

function connectCdp(webSocketDebuggerUrl) {
  if (typeof WebSocket !== 'function') {
    throw new Error('This Node.js runtime does not expose WebSocket');
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((done, failSend) => {
            pending.set(id, { done, failSend });
          });
        },
        waitFor(method) {
          return new Promise((done) => {
            const listener = (event) => {
              const msg = JSON.parse(event.data);
              if (msg.method !== method) return;
              ws.removeEventListener('message', listener);
              done(msg.params || {});
            };
            ws.addEventListener('message', listener);
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { done, failSend } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) failSend(new Error(msg.error.message || JSON.stringify(msg.error)));
      else done(msg.result || {});
    });
    ws.addEventListener('error', reject);
  });
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Invalid PNG screenshot');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function measurementExpression() {
  return `
    (() => {
      const rectFor = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
      };
      const overflow = Array.from(document.querySelectorAll('*')).map((el) => {
        const r = el.getBoundingClientRect();
        return { tag:el.tagName, id:el.id, cls:String(el.className), text:el.textContent.trim().slice(0,20), left:r.left, right:r.right, width:r.width };
      }).filter((x) => x.width > 0 && (x.right > innerWidth + 1 || x.left < -1)).slice(0, 30);
      const navButtons = Array.from(document.querySelectorAll('.bottom-nav button')).map((btn) => {
        const r = btn.getBoundingClientRect();
        return { label:btn.textContent.trim(), target:btn.dataset.target || '', left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
      });
      const rootStyle = getComputedStyle(document.documentElement);
      const topbarStyle = getComputedStyle(document.querySelector('.topbar'));
      const viewStyle = getComputedStyle(document.querySelector('.view.active'));
      const navStyle = getComputedStyle(document.querySelector('.bottom-nav'));
      const activeView = document.querySelector('.view.active') && document.querySelector('.view.active').dataset.view;
      const viewRect = activeView ? rectFor('#view-' + activeView) : null;
      const firstPanel = activeView ? rectFor('#view-' + activeView + ' .panel, #view-' + activeView + ' .focus-panel') : null;
      const keySelectors = {
        home: ['#android-pet', '#android-pet .pet-img', '#pet-hat', '#active-task-title', '#quick-task-input', '#chat-input'],
        tasks: ['#task-input', '#task-list'],
        focus: ['#timer-ring', '#timer-start', '#focus-intent-input'],
        freezer: ['#freezer-input', '#freezer-list'],
        stats: ['#stat-today', '#trend-bars', '#mood-list'],
        settings: ['#provider-segment', '#save-model-settings', '#save-hermes-settings', '#save-feishu', '#long-title-input', '#clear-data']
      };
      const keyPresence = Object.fromEntries(Object.entries(keySelectors).map(([view, selectors]) => [
        view,
        selectors.every(selector => !!document.querySelector(selector))
      ]));
      const taskTitleRects = Array.from(document.querySelectorAll('.task-title-main strong')).map((node) => {
        const r = node.getBoundingClientRect();
        return { text:node.textContent.trim().slice(0,30), width:r.width, height:r.height };
      });
      const pet = document.querySelector('#android-pet');
      const petImg = document.querySelector('#android-pet .pet-img');
      const petHat = document.querySelector('#pet-hat');
      const petHatStyle = petHat ? getComputedStyle(petHat) : null;
      return {
        innerWidth,
        innerHeight,
        devicePixelRatio,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        appInitialized: !!window.NAONAO,
        activeView,
        timerText: document.getElementById('timer-time') && document.getElementById('timer-time').textContent,
        bottomNavPosition: getComputedStyle(document.querySelector('.bottom-nav')).position,
        safeArea: {
          top: rootStyle.getPropertyValue('--safe-top').trim(),
          right: rootStyle.getPropertyValue('--safe-right').trim(),
          bottom: rootStyle.getPropertyValue('--safe-bottom').trim(),
          left: rootStyle.getPropertyValue('--safe-left').trim(),
          topbarMinHeight: topbarStyle.minHeight,
          topbarPaddingTop: topbarStyle.paddingTop,
          viewPaddingLeft: viewStyle.paddingLeft,
          viewPaddingRight: viewStyle.paddingRight,
          navPaddingBottom: navStyle.paddingBottom
        },
        navButtons,
        keyPresence,
        viewRect,
        firstPanel,
        heroRect: rectFor('.hero'),
        currentPanelRect: rectFor('.current-panel'),
        chatPanelRect: rectFor('.chat-panel'),
        taskTitleRects,
        petState: {
          brandMarkCount: document.querySelectorAll('.brand-mark').length,
          petPresent: !!pet,
          petHasHatClass: !!pet && pet.classList.contains('has-hat'),
          petBopClass: !!pet && pet.classList.contains('pet-bop'),
          imageSrc: petImg ? petImg.getAttribute('src') : '',
          imageLoaded: !!petImg && petImg.complete && petImg.naturalWidth > 0 && petImg.naturalHeight > 0,
          imageNaturalWidth: petImg ? petImg.naturalWidth : 0,
          imageNaturalHeight: petImg ? petImg.naturalHeight : 0,
          imageRect: rectFor('#android-pet .pet-img'),
          hatSrc: petHat ? petHat.getAttribute('src') : '',
          hatVisible: !!petHatStyle && petHatStyle.display !== 'none' && petHatStyle.visibility !== 'hidden',
          hatRect: rectFor('#pet-hat'),
          badgeText: document.getElementById('focus-badge') ? document.getElementById('focus-badge').textContent.trim() : ''
        },
        overflowing: overflow
      };
    })()
  `;
}

async function evaluateValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

async function capturePng(cdp, outputPath) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const buffer = Buffer.from(screenshot.data, 'base64');
  fs.writeFileSync(outputPath, buffer);
  return {
    path: outputPath,
    bytes: buffer.length,
    ...pngSize(buffer),
  };
}

function analyzeLayout(value, expectedView, screenshotSize) {
  const navButtons = Array.isArray(value.navButtons) ? value.navButtons : [];
  const visibleNavButtons = navButtons.filter(btn =>
    btn.left >= -1 &&
    btn.right <= value.innerWidth + 1 &&
    btn.bottom <= viewport.height + 1 &&
    btn.width > 0 &&
    btn.height > 0
  ).length;
  const failures = [];
  if (screenshotSize && (screenshotSize.width !== viewport.width || screenshotSize.height !== viewport.height)) failures.push('screenshot size mismatch');
  if (value.innerWidth !== viewport.width) failures.push('CSS viewport width mismatch');
  if (!value.appInitialized) failures.push('app did not initialize');
  if (value.activeView !== expectedView) failures.push(`expected active view ${expectedView}, got ${value.activeView || 'none'}`);
  if (value.bottomNavPosition !== 'fixed') failures.push('bottom nav CSS did not apply');
  if (!value.safeArea || value.safeArea.top !== `${simulatedSafeArea.top}px`) failures.push('safe top variable missing');
  if (!value.safeArea || value.safeArea.bottom !== `${simulatedSafeArea.bottom}px`) failures.push('safe bottom variable missing');
  if (!value.safeArea || parseFloat(value.safeArea.topbarPaddingTop) < simulatedSafeArea.top) failures.push('topbar does not reserve safe top');
  if (!value.safeArea || parseFloat(value.safeArea.topbarMinHeight) < simulatedSafeArea.top + 60) failures.push('topbar min-height ignores safe top');
  if (!value.safeArea || parseFloat(value.safeArea.navPaddingBottom) < simulatedSafeArea.bottom + 8) failures.push('bottom nav does not reserve safe bottom');
  if (navButtons.length !== 5 || visibleNavButtons !== 5) failures.push('bottom nav is clipped');
  if (value.docScrollWidth > value.innerWidth + 1 || value.bodyScrollWidth > value.innerWidth + 1 || (Array.isArray(value.overflowing) && value.overflowing.length > 0)) {
    failures.push('layout overflow detected');
  }
  if (value.keyPresence && value.keyPresence[expectedView] === false) failures.push(`${expectedView} key controls missing`);
  if (expectedView === 'home') {
    const pet = value.petState || {};
    if (pet.brandMarkCount !== 0) failures.push('redundant brand mark still rendered');
    if (!pet.petPresent) failures.push('desktop pet button missing');
    if (pet.imageSrc !== 'pet.png' || !pet.imageLoaded) failures.push('desktop pet image did not load');
    if (!pet.imageRect || pet.imageRect.width < 60 || pet.imageRect.height < 80) failures.push('desktop pet image is not visibly sized');
    if (pet.hatSrc !== 'hat.png' || !pet.petHasHatClass || !pet.hatVisible) failures.push('body-double hat is not visible on pet');
  }
  if (expectedView === 'tasks' && Array.isArray(value.taskTitleRects)) {
    const verticalTitle = value.taskTitleRects.find(rect => rect.width > 0 && rect.height / rect.width > 1.8);
    if (verticalTitle) failures.push(`task title appears vertically squeezed: ${verticalTitle.text}`);
  }
  for (const [name, rect] of Object.entries({
    view: value.viewRect,
    firstPanel: value.firstPanel,
    hero: expectedView === 'home' ? value.heroRect : null,
    currentPanel: expectedView === 'home' ? value.currentPanelRect : null,
    chatPanel: expectedView === 'home' ? value.chatPanelRect : null,
  })) {
    if (!rect) continue;
    if (rect.left < -1 || rect.right > value.innerWidth + 1) failures.push(`${name} clipped`);
  }
  return {
    view: expectedView,
    activeView: value.activeView || '',
    innerWidth: value.innerWidth,
    docScrollWidth: value.docScrollWidth,
    bodyScrollWidth: value.bodyScrollWidth,
    overflowingCount: Array.isArray(value.overflowing) ? value.overflowing.length : -1,
    overflowing: Array.isArray(value.overflowing) ? value.overflowing.slice(0, 8) : [],
    visibleNavButtons,
    safeArea: value.safeArea || null,
    keyControlsPresent: !value.keyPresence || value.keyPresence[expectedView] !== false,
    failures,
  };
}

async function main() {
  const browser = browserCandidates.find(candidate => fs.existsSync(candidate));
  if (!browser) {
    fail(`Headless browser executable not found. Checked: ${browserCandidates.join(', ')}`);
  }
  if (!fs.existsSync(html)) {
    fail('missing Android asset HTML');
  }
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.mkdirSync(screensDir, { recursive: true });
  fs.mkdirSync(measuredDir, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  fs.copyFileSync(path.join(assetsDir, 'styles.css'), path.join(measuredDir, 'styles.css'));
  fs.copyFileSync(path.join(assetsDir, 'app.js'), path.join(measuredDir, 'app.js'));
  fs.copyFileSync(path.join(assetsDir, 'pet.png'), path.join(measuredDir, 'pet.png'));
  fs.copyFileSync(path.join(assetsDir, 'hat.png'), path.join(measuredDir, 'hat.png'));
  fs.copyFileSync(html, measuredHtml);

  const port = 9300 + Math.floor(Math.random() * 400);
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-application-cache',
    '--disk-cache-size=1',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  try {
    const target = await waitForTarget(port);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(sampleState()))});`,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const loaded = cdp.waitFor('Page.loadEventFired');
    await cdp.send('Page.navigate', {
      url: `file:///${measuredHtml.replace(/\\/g, '/')}`,
    });
    await loaded;
    await new Promise(resolve => setTimeout(resolve, 300));
    await evaluateValue(cdp, `
      document.documentElement.style.setProperty('--safe-top', '${simulatedSafeArea.top}px');
      document.documentElement.style.setProperty('--safe-right', '${simulatedSafeArea.right}px');
      document.documentElement.style.setProperty('--safe-bottom', '${simulatedSafeArea.bottom}px');
      document.documentElement.style.setProperty('--safe-left', '${simulatedSafeArea.left}px');
      true
    `);
    const bodyDoubleClickWorked = await evaluateValue(cdp, `
      (() => {
        const btn = document.getElementById('body-double-toggle');
        const pet = document.getElementById('android-pet');
        const hat = document.getElementById('pet-hat');
        if (!btn || !pet || !hat) return { hidden:false, shown:false };
        if (pet.classList.contains('has-hat')) btn.click();
        const hidden = !pet.classList.contains('has-hat') && getComputedStyle(hat).display === 'none';
        btn.click();
        const shown = pet.classList.contains('has-hat') && btn.getAttribute('aria-pressed') === 'true' && getComputedStyle(hat).display !== 'none';
        return { hidden, shown };
      })()
    `);
    if (!bodyDoubleClickWorked.hidden || !bodyDoubleClickWorked.shown) {
      throw new Error('body-double click did not toggle the pet hat');
    }
    const petClickWorked = await evaluateValue(cdp, `
      document.getElementById('android-pet').click();
      document.getElementById('android-pet').classList.contains('pet-bop')
    `);
    if (!petClickWorked) {
      throw new Error('pet click animation class was not applied');
    }
    const viewResults = [];
    const screenshots = [];
    const views = ['home', 'tasks', 'focus', 'freezer', 'stats', 'settings'];
    for (const view of views) {
      if (view === 'settings') {
        await evaluateValue(cdp, `document.getElementById('settings-shortcut').click(); true`);
      } else {
        await evaluateValue(cdp, `document.querySelector('.bottom-nav button[data-target="${view}"]').click(); true`);
      }
      await new Promise(resolve => setTimeout(resolve, 120));
      const layout = await evaluateValue(cdp, measurementExpression());
      const viewShot = await capturePng(cdp, path.join(screensDir, `${view}.png`));
      screenshots.push({ view, file: path.relative(repo, viewShot.path).replace(/\\/g, '/'), bytes: viewShot.bytes, width: viewShot.width, height: viewShot.height });
      viewResults.push(analyzeLayout(layout, view, viewShot));
    }
    await evaluateValue(cdp, `document.querySelector('.bottom-nav button[data-target="home"]').click(); true`);
    await new Promise(resolve => setTimeout(resolve, 120));
    const homeShot = await capturePng(cdp, shot);
    const homeLayout = await evaluateValue(cdp, measurementExpression());
    cdp.close();
    child.kill();

    if (homeShot.bytes < 1000) fail('smoke screenshot is unexpectedly small');
    const finalHomeResult = analyzeLayout(homeLayout, 'home', homeShot);
    screenshots.push({ view: 'home-final', file: path.relative(repo, shot).replace(/\\/g, '/'), bytes: homeShot.bytes, width: homeShot.width, height: homeShot.height });
    viewResults.push(finalHomeResult);
    const hardFailures = viewResults.flatMap(result => result.failures.map(failure => `${result.view}: ${failure}`));
    const reportData = {
      screenshotBytes: homeShot.bytes,
      screenshotWidth: homeShot.width,
      screenshotHeight: homeShot.height,
      expectedWidth: viewport.width,
      expectedHeight: viewport.height,
      innerWidth: homeLayout.innerWidth,
      innerHeight: homeLayout.innerHeight,
      devicePixelRatio: homeLayout.devicePixelRatio,
      docScrollWidth: homeLayout.docScrollWidth,
      bodyScrollWidth: homeLayout.bodyScrollWidth,
      overflowingCount: finalHomeResult.overflowingCount,
      petState: homeLayout.petState,
      hasBottomNav: finalHomeResult.visibleNavButtons === 5,
      visibleNavButtons: finalHomeResult.visibleNavButtons,
      appInitialized: homeLayout.appInitialized === true,
      activeView: homeLayout.activeView || '',
      timerText: homeLayout.timerText || '',
      bottomNavPosition: homeLayout.bottomNavPosition || '',
      checkedViews: views,
      viewResults,
      screenshots,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(report, JSON.stringify(reportData, null, 2));
    if (hardFailures.length) {
      console.error(`${hardFailures.join('; ')}: ${JSON.stringify(reportData)}`);
      process.exit(1);
    }
    console.log(`Android smoke screenshot: ${shot} (${homeShot.bytes} bytes)`);
  } catch (e) {
    fail(`${e.message}\n${stderr}`.trim(), child);
  }
}

main();
