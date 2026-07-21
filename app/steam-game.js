(function startFocusQuest() {
  'use strict'

  const Engine = window.NaonaoGameEngine
  const game = window.naonaoGame
  const elements = Object.fromEntries([
    'habitat-scene', 'pet-speech', 'profile-level', 'profile-xp-label', 'profile-xp-fill',
    'profile-leaves', 'profile-bond', 'profile-streak', 'profile-energy', 'companion-toggle',
    'sound-toggle', 'run-state', 'task-form', 'task-input', 'timer-display', 'timer-caption',
    'run-primary', 'run-cancel', 'task-list', 'task-count', 'daily-date', 'daily-quests',
    'journey-track', 'journey-chapter', 'collection-grid', 'collection-count',
    'achievement-list', 'achievement-count', 'save-status', 'session-total', 'toast',
    'integration-status', 'director-overlay', 'director-task-name', 'director-preview',
    'director-consent', 'director-generate', 'director-offline', 'director-status',
    'ai-enabled', 'ai-provider', 'ai-model', 'ai-base-url', 'ai-key', 'ai-key-state',
    'ai-network-consent', 'ai-share-memory', 'ai-status', 'feishu-enabled',
    'feishu-webhook', 'feishu-webhook-state', 'feishu-notify-focus',
    'feishu-notify-task', 'feishu-status',
  ].map(id => [id, document.getElementById(id)]))

  const unlockIcons = ['●', '✦', '▣', '◎', '▲']
  let state = null
  let selectedTaskId = null
  let selectedDuration = 25
  let busy = false
  let toastTimer = null
  let audioContext = null
  let integrationConfig = null
  let directorBusy = false
  let integrationRefreshVersion = 0

  const integrationDefaults = {
    hermes: { baseUrl: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0))
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
  }

  function remainingSeconds() {
    if (!state) return selectedDuration * 60
    if (state.run.status === 'running' && state.run.endsAt) {
      return Math.max(0, Math.ceil((new Date(state.run.endsAt).getTime() - Date.now()) / 1000))
    }
    return state.run.status === 'idle' ? selectedDuration * 60 : state.run.remainingSeconds
  }

  function showToast(message) {
    clearTimeout(toastTimer)
    elements.toast.textContent = message
    elements.toast.classList.add('show')
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600)
  }

  function rewardMessage(result) {
    const parts = []
    if (result?.reward) parts.push(`+${result.reward.xp || 0} 成长`, `+${result.reward.leaves || 0} 叶片`)
    if (result?.levelUps?.length) parts.push(`升至 ${result.levelUps.at(-1)} 级`)
    if (result?.unlocked?.length) parts.push('获得新收藏')
    if (result?.achievements?.length) parts.push('点亮新勋章')
    return parts.join(' · ')
  }

  function playCompletionTone() {
    if (!state?.settings.sound) return
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    audioContext ||= new AudioContext()
    audioContext.resume()
    const now = audioContext.currentTime
    ;[440, 554, 659].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.frequency.value = frequency
      oscillator.type = 'sine'
      gain.gain.setValueAtTime(0.0001, now + index * 0.12)
      gain.gain.exponentialRampToValueAtTime(0.11, now + index * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.28)
      oscillator.connect(gain).connect(audioContext.destination)
      oscillator.start(now + index * 0.12)
      oscillator.stop(now + index * 0.12 + 0.3)
    })
  }

  function renderProfile() {
    const threshold = Engine.levelThreshold(state.profile.level)
    elements['profile-level'].textContent = state.profile.level
    elements['profile-xp-label'].textContent = `${state.profile.xp} / ${threshold}`
    elements['profile-xp-fill'].style.width = `${Math.min(100, state.profile.xp / threshold * 100)}%`
    elements['profile-leaves'].textContent = state.profile.leaves
    elements['profile-bond'].textContent = state.profile.bond
    elements['profile-streak'].textContent = state.profile.streak
    elements['profile-energy'].textContent = state.profile.energy
    elements['companion-toggle'].setAttribute('aria-pressed', String(state.settings.companion))
    elements['sound-toggle'].setAttribute('aria-pressed', String(state.settings.sound))
    elements['sound-toggle'].textContent = state.settings.sound ? '♪' : '×'
    elements['sound-toggle'].title = state.settings.sound ? '关闭声音' : '开启声音'
  }

  function renderRun() {
    const { status } = state.run
    const isIdle = status === 'idle'
    const isRunning = status === 'running'
    selectedDuration = isIdle ? state.settings.focusMinutes : state.run.durationMinutes
    elements['timer-display'].textContent = formatTime(remainingSeconds())
    elements['run-state'].textContent = isIdle ? '待机' : isRunning ? '专注中' : '已暂停'
    elements['run-state'].className = `run-state ${status}`
    elements['run-primary'].textContent = isIdle ? '开始旅程' : isRunning ? '暂停' : '继续'
    elements['run-cancel'].disabled = isIdle
    elements['habitat-scene'].classList.toggle('running', isRunning)

    const runTask = state.tasks.find(task => task.id === (state.run.taskId || selectedTaskId))
    const activeQuestStep = runTask?.quest?.steps.find(step => !step.done)
    elements['timer-caption'].textContent = activeQuestStep?.text || runTask?.text || (isRunning ? '与孬孬安静前进' : '不绑定任务也可以启程')
    elements['pet-speech'].textContent = isRunning
      ? `我守着这里。还剩 ${formatTime(remainingSeconds())}。`
      : status === 'paused'
        ? '先停一停，准备好再继续。'
        : runTask?.quest?.coachLine
          ? runTask.quest.coachLine
        : state.profile.totalSessions
          ? `已经一起走过 ${state.profile.totalSessions} 段旅程。`
          : '今天也从一小步开始。'

    document.querySelectorAll('[data-duration]').forEach(button => {
      const duration = Number(button.dataset.duration)
      button.classList.toggle('selected', duration === selectedDuration)
      button.disabled = !isIdle
    })
  }

  function makeButton(text, className, title, data) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.textContent = text
    button.title = title
    button.setAttribute('aria-label', title)
    Object.assign(button.dataset, data)
    return button
  }

  function questSourceLabel(source) {
    if (source === 'hermes') return 'HERMES'
    if (source === 'openai') return 'OPENAI'
    return 'OFFLINE'
  }

  function makeQuestSheet(task) {
    const sheet = document.createElement('div')
    sheet.className = 'quest-sheet'
    const head = document.createElement('div')
    head.className = 'quest-sheet-head'
    const title = document.createElement('strong')
    title.textContent = task.quest.title
    const source = document.createElement('span')
    source.className = 'quest-source'
    source.textContent = questSourceLabel(task.quest.source)
    head.append(title, source)
    const briefing = document.createElement('p')
    briefing.className = 'quest-briefing'
    briefing.textContent = task.quest.briefing
    const steps = document.createElement('div')
    steps.className = 'quest-steps'
    task.quest.steps.forEach((step, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `quest-step${step.done ? ' done' : ''}`
      button.dataset.action = 'quest-step'
      button.dataset.stepId = step.id
      button.disabled = step.done || task.done
      button.title = step.done ? '关卡已完成' : '完成这一关'
      const marker = document.createElement('span')
      marker.textContent = step.done ? '✓' : index + 1
      const text = document.createElement('span')
      text.textContent = step.text
      button.append(marker, text)
      steps.append(button)
    })
    const footer = document.createElement('div')
    footer.className = 'quest-footer'
    const coach = document.createElement('span')
    coach.textContent = task.quest.coachLine
    const reward = document.createElement('span')
    reward.textContent = `奖励：${task.quest.rewardName}`
    footer.append(coach, reward)
    sheet.append(head, briefing, steps, footer)
    return sheet
  }

  function renderTasks() {
    const openTasks = state.tasks.filter(task => !task.done)
    const tasks = [...openTasks, ...state.tasks.filter(task => task.done).slice(0, 8)]
    if (selectedTaskId && !openTasks.some(task => task.id === selectedTaskId)) selectedTaskId = null
    if (!selectedTaskId && state.run.status === 'idle' && openTasks.length) selectedTaskId = openTasks[0].id
    if (state.run.status !== 'idle') selectedTaskId = state.run.taskId

    elements['task-list'].replaceChildren(...tasks.map(task => {
      const block = document.createElement('div')
      block.className = 'task-block'
      block.dataset.taskId = task.id
      const row = document.createElement('div')
      row.className = `task-row${task.id === selectedTaskId ? ' selected' : ''}${task.done ? ' done' : ''}`
      const select = makeButton(task.id === selectedTaskId ? '●' : '○', 'task-radio', '选择任务', { action: 'select' })
      select.disabled = task.done || state.run.status !== 'idle'
      select.setAttribute('aria-pressed', String(task.id === selectedTaskId))
      const text = document.createElement('span')
      text.className = 'task-text'
      text.textContent = task.text
      text.title = task.text
      const questStarted = task.quest?.steps.some(step => step.done) === true
      const directTitle = questStarted
        ? '已有完成的关卡，不能重新生成'
        : task.quest
          ? '重新生成关卡'
          : '生成导演关卡'
      const direct = makeButton('✦', 'task-director', directTitle, { action: 'director' })
      direct.disabled = task.done || questStarted
      const complete = makeButton('✓', 'task-done', task.done ? '任务已完成' : '完成任务', { action: 'complete' })
      complete.disabled = task.done
      const remove = makeButton('×', 'task-remove', '删除任务', { action: 'remove' })
      row.append(select, text, direct, complete, remove)
      block.append(row)
      if (task.quest && task.id === selectedTaskId) block.append(makeQuestSheet(task))
      return block
    }))
    elements['task-count'].textContent = `${openTasks.length} OPEN`
  }

  function renderDaily() {
    elements['daily-date'].textContent = state.daily.date.replaceAll('-', '.')
    elements['daily-quests'].replaceChildren(...state.daily.quests.map(quest => {
      const row = document.createElement('div')
      row.className = 'daily-quest'
      const title = document.createElement('span')
      title.className = 'quest-title'
      title.textContent = quest.title
      const meta = document.createElement('span')
      meta.className = 'quest-meta'
      meta.textContent = `${quest.progress} / ${quest.target}`
      const track = document.createElement('div')
      track.className = 'quest-track'
      const fill = document.createElement('div')
      fill.className = 'quest-fill'
      fill.style.width = `${quest.progress / quest.target * 100}%`
      track.append(fill)
      const claim = document.createElement('button')
      claim.type = 'button'
      claim.className = 'quest-claim'
      claim.dataset.questId = quest.id
      claim.textContent = quest.claimed ? '已领取' : `领取 +${quest.reward.leaves}`
      claim.disabled = quest.claimed || quest.progress < quest.target
      row.append(title, meta, track, claim)
      return row
    }))
  }

  function renderJourney() {
    elements['journey-chapter'].textContent = `CH. ${state.journey.chapter}`
    const nodes = Array.from({ length: Engine.ROUTE_LENGTH }, (_, index) => {
      const node = document.createElement('div')
      node.className = `journey-node${index < state.journey.step ? ' reached' : ''}${index === state.journey.step ? ' current' : ''}`
      node.textContent = index + 1
      node.title = index < state.journey.step ? '已抵达' : index === state.journey.step ? '下一站' : '未抵达'
      return node
    })
    elements['journey-track'].replaceChildren(...nodes)
  }

  function renderCollection() {
    const unlocked = new Set(state.unlocks)
    elements['collection-grid'].replaceChildren(...Engine.UNLOCKS.map((item, index) => {
      const tile = document.createElement('div')
      tile.className = `collection-item${unlocked.has(item.id) ? ' unlocked' : ''}`
      tile.title = unlocked.has(item.id) ? item.name : `${item.level} 级解锁`
      const icon = document.createElement('span')
      icon.className = 'collection-icon'
      icon.textContent = unlocked.has(item.id) ? unlockIcons[index] : '?'
      const name = document.createElement('span')
      name.className = 'collection-name'
      name.textContent = unlocked.has(item.id) ? item.name : `LV.${item.level}`
      tile.append(icon, name)
      return tile
    }))
    elements['collection-count'].textContent = `${state.unlocks.length} / ${Engine.UNLOCKS.length}`
  }

  function renderAchievements() {
    elements['achievement-list'].replaceChildren(...Engine.ACHIEVEMENTS.map(item => {
      const earned = Boolean(state.achievements[item.id])
      const row = document.createElement('div')
      row.className = `achievement-item${earned ? ' earned' : ''}`
      row.title = earned ? `达成于 ${state.achievements[item.id].slice(0, 10)}` : '尚未达成'
      const medal = document.createElement('span')
      medal.className = 'achievement-medal'
      medal.textContent = earned ? '★' : '·'
      const name = document.createElement('span')
      name.textContent = item.name
      row.append(medal, name)
      return row
    }))
    elements['achievement-count'].textContent = `${Object.keys(state.achievements).length} / ${Engine.ACHIEVEMENTS.length}`
  }

  function selectedTask() {
    return state?.tasks.find(task => task.id === selectedTaskId) || null
  }

  function questHasProgress(task) {
    return task?.quest?.steps.some(step => step.done) === true
  }

  function renderDirectorPreview() {
    if (!state) return
    const task = selectedTask()
    const questStarted = questHasProgress(task)
    elements['director-task-name'].textContent = task?.text || '尚未选择任务'
    elements['director-preview'].replaceChildren()
    elements['director-generate'].disabled = directorBusy || !task || task.done || questStarted
    elements['director-offline'].disabled = directorBusy || !task || task.done || questStarted
    elements['director-generate'].title = questStarted ? '已有完成的关卡，不能重新生成' : ''
    elements['director-offline'].title = questStarted ? '已有完成的关卡，不能重新生成' : ''
    if (!task?.quest) return
    const head = document.createElement('div')
    head.className = 'preview-title'
    const title = document.createElement('strong')
    title.textContent = task.quest.title
    const source = document.createElement('span')
    source.textContent = questSourceLabel(task.quest.source)
    head.append(title, source)
    const briefing = document.createElement('p')
    briefing.className = 'preview-briefing'
    briefing.textContent = task.quest.briefing
    const steps = document.createElement('ol')
    steps.className = 'preview-steps'
    task.quest.steps.forEach(step => {
      const item = document.createElement('li')
      item.textContent = `${step.done ? '已完成 · ' : ''}${step.text}`
      steps.append(item)
    })
    const reward = document.createElement('div')
    reward.className = 'preview-reward'
    reward.textContent = `${task.quest.coachLine} · ${task.quest.rewardName}`
    elements['director-preview'].append(head, briefing, steps, reward)
  }

  function renderIntegrationStatus() {
    if (!integrationConfig) return
    const ai = integrationConfig.ai
    let localEndpoint = false
    try {
      const hostname = new URL(ai.baseUrl).hostname
      localEndpoint = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.')
    } catch {}
    const ready = ai.enabled && (localEndpoint || (ai.hasKey && ai.networkConsent))
    elements['integration-status'].textContent = ready ? (ai.provider === 'hermes' ? 'HERMES ON' : 'AI ON') : 'AI OFF'
    elements['ai-key-state'].textContent = ai.hasKey ? '密钥已保存' : '无密钥'
    elements['feishu-webhook-state'].textContent = integrationConfig.feishu.hasWebhook ? 'Webhook 已保存' : '未配置'
  }

  function populateIntegrationForm() {
    if (!integrationConfig) return
    const { ai, feishu } = integrationConfig
    elements['ai-enabled'].checked = ai.enabled
    elements['ai-provider'].value = ai.provider
    elements['ai-model'].value = ai.model
    elements['ai-base-url'].value = ai.baseUrl
    elements['ai-key'].value = ''
    elements['ai-network-consent'].checked = ai.networkConsent
    elements['ai-share-memory'].checked = ai.shareMemory
    elements['feishu-enabled'].checked = feishu.enabled
    elements['feishu-webhook'].value = ''
    elements['feishu-notify-focus'].checked = feishu.notifyFocus
    elements['feishu-notify-task'].checked = feishu.notifyTask
    renderIntegrationStatus()
  }

  function setConnectionStatus(element, message, type = '') {
    element.textContent = message
    element.className = `connection-status${type ? ` ${type}` : ''}`
  }

  function errorMessage(error, fallback) {
    return String(error?.message || error || fallback).slice(0, 160)
  }

  async function refreshIntegrationForm() {
    const version = ++integrationRefreshVersion
    const nextConfig = await game.getIntegrationConfig()
    if (!nextConfig?.ai || !nextConfig?.feishu) throw new Error('连接配置读取失败')
    if (version === integrationRefreshVersion) {
      integrationConfig = nextConfig
      populateIntegrationForm()
    }
    return nextConfig
  }

  function switchDirectorTab(tab) {
    document.querySelectorAll('[data-director-tab]').forEach(button => button.classList.toggle('active', button.dataset.directorTab === tab))
    document.querySelectorAll('[data-director-panel]').forEach(panel => { panel.hidden = panel.dataset.directorPanel !== tab })
  }

  function openDirector(tab = 'quest', taskId = null) {
    if (taskId) selectedTaskId = taskId
    elements['director-overlay'].hidden = false
    switchDirectorTab(tab)
    renderTasks()
    renderDirectorPreview()
    if (tab === 'connections') populateIntegrationForm()
  }

  function closeDirector() {
    elements['director-overlay'].hidden = true
    elements['director-consent'].checked = false
  }

  function render() {
    if (!state) return
    renderProfile()
    renderRun()
    renderTasks()
    renderDaily()
    renderJourney()
    renderCollection()
    renderAchievements()
    renderDirectorPreview()
    renderIntegrationStatus()
    elements['session-total'].textContent = `${state.profile.totalSessions} 次旅程 · ${state.profile.totalFocusMinutes} 分钟`
    elements['save-status'].textContent = '本地存档已同步'
  }

  async function act(action, options = {}) {
    if (busy) return { error: '其他操作正在进行' }
    busy = true
    elements['save-status'].textContent = '正在写入本地存档…'
    try {
      const result = await action()
      if (!result || typeof result !== 'object') throw new Error('操作未返回有效结果')
      if (result?.state) state = result.state
      render()
      if (result.error) {
        elements['save-status'].textContent = '操作未完成，本地存档未更改'
        showToast(result.error)
      } else {
        const message = options.message || rewardMessage(result)
        if (message) showToast(message)
      }
      return result
    } catch (error) {
      elements['save-status'].textContent = '本地存档写入失败'
      showToast('操作失败，请重新尝试')
      return { error: errorMessage(error, '操作失败') }
    } finally {
      busy = false
    }
  }

  elements['task-form'].addEventListener('submit', async event => {
    event.preventDefault()
    const text = elements['task-input'].value
    const result = await act(() => game.addTask(text), { message: '任务已加入旅程' })
    if (result?.state && !result.error) {
      elements['task-input'].value = ''
      selectedTaskId = result.state.tasks.find(task => !task.done)?.id || null
      renderTasks()
    }
  })

  elements['task-list'].addEventListener('click', event => {
    const button = event.target.closest('button[data-action]')
    const row = event.target.closest('[data-task-id]')
    if (!button || !row) return
    const taskId = row.dataset.taskId
    if (button.dataset.action === 'select') {
      selectedTaskId = selectedTaskId === taskId ? null : taskId
      renderTasks()
      renderRun()
    }
    if (button.dataset.action === 'complete') act(() => game.completeTask(taskId))
    if (button.dataset.action === 'remove') act(() => game.removeTask(taskId), { message: '任务已移除' })
    if (button.dataset.action === 'director') openDirector('quest', taskId)
    if (button.dataset.action === 'quest-step') act(
      () => game.completeQuestStep(taskId, button.dataset.stepId),
      { message: '关卡完成' },
    )
  })

  document.querySelector('.duration-selector').addEventListener('click', event => {
    const button = event.target.closest('[data-duration]')
    if (!button || state.run.status !== 'idle') return
    selectedDuration = Number(button.dataset.duration)
    act(() => game.updateSettings({ focusMinutes: selectedDuration }))
  })

  elements['run-primary'].addEventListener('click', () => {
    if (state.run.status === 'idle') {
      if (state.settings.sound) {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (AudioContext) {
          audioContext ||= new AudioContext()
          audioContext.resume()
        }
      }
      act(() => game.startRun({ durationMinutes: selectedDuration, taskId: selectedTaskId }), { message: '旅程开始' })
    } else if (state.run.status === 'running') {
      act(() => game.pauseRun(), { message: '旅程已暂停' })
    } else {
      act(() => game.resumeRun(), { message: '继续前进' })
    }
  })

  elements['run-cancel'].addEventListener('click', () => act(() => game.cancelRun(), { message: '本段旅程已放弃' }))
  elements['daily-quests'].addEventListener('click', event => {
    const button = event.target.closest('[data-quest-id]')
    if (button) act(() => game.claimQuest(button.dataset.questId))
  })
  elements['companion-toggle'].addEventListener('click', () => act(
    () => game.updateSettings({ companion: !state.settings.companion }),
    { message: state.settings.companion ? '桌面陪伴已关闭' : '桌面陪伴已开启' },
  ))
  elements['sound-toggle'].addEventListener('click', () => act(
    () => game.updateSettings({ sound: !state.settings.sound }),
    { message: state.settings.sound ? '声音已关闭' : '声音已开启' },
  ))
  document.getElementById('window-minimize').addEventListener('click', game.minimize)
  document.getElementById('window-maximize').addEventListener('click', game.toggleMaximize)
  document.getElementById('window-close').addEventListener('click', game.close)
  document.getElementById('director-open').addEventListener('click', () => {
    if (!selectedTask()) {
      showToast('先在任务舱选择一个现实任务')
      return
    }
    openDirector('quest')
  })
  document.getElementById('integration-open').addEventListener('click', () => openDirector('connections'))
  document.getElementById('director-close').addEventListener('click', closeDirector)
  elements['director-overlay'].addEventListener('click', event => {
    if (event.target === elements['director-overlay']) closeDirector()
  })
  document.querySelector('.drawer-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-director-tab]')
    if (button) switchDirectorTab(button.dataset.directorTab)
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements['director-overlay'].hidden) closeDirector()
  })

  elements['director-generate'].addEventListener('click', async () => {
    const task = selectedTask()
    if (!task || task.done || directorBusy) return
    if (questHasProgress(task)) {
      setConnectionStatus(elements['director-status'], '已有完成的关卡，不能重新生成', 'error')
      return
    }
    if (!integrationConfig?.ai.enabled) {
      setConnectionStatus(elements['director-status'], '请先在连接页开启 AI 任务导演', 'error')
      switchDirectorTab('connections')
      return
    }
    if (!elements['director-consent'].checked) {
      setConnectionStatus(elements['director-status'], '请确认本次任务发送', 'error')
      return
    }
    directorBusy = true
    renderDirectorPreview()
    setConnectionStatus(elements['director-status'], '正在生成关卡…')
    let result
    try {
      result = await act(() => game.generateQuest(task.id, true), { message: '导演关卡已生成' })
    } finally {
      directorBusy = false
      elements['director-consent'].checked = false
      renderDirectorPreview()
    }
    const succeeded = Boolean(result?.state && !result.error)
    setConnectionStatus(
      elements['director-status'],
      succeeded ? '关卡已写入任务舱' : result?.error || '关卡生成失败',
      succeeded ? 'success' : 'error',
    )
  })

  elements['director-offline'].addEventListener('click', async () => {
    const task = selectedTask()
    if (!task || task.done || directorBusy) return
    if (questHasProgress(task)) {
      setConnectionStatus(elements['director-status'], '已有完成的关卡，不能重新生成', 'error')
      return
    }
    directorBusy = true
    renderDirectorPreview()
    let result
    try {
      result = await act(() => game.generateOfflineQuest(task.id), { message: '离线关卡已生成' })
    } finally {
      directorBusy = false
      renderDirectorPreview()
    }
    const succeeded = Boolean(result?.state && !result.error)
    setConnectionStatus(
      elements['director-status'],
      succeeded ? '离线关卡已写入任务舱' : result?.error || '离线关卡生成失败',
      succeeded ? 'success' : 'error',
    )
  })

  elements['ai-provider'].addEventListener('change', () => {
    const defaults = integrationDefaults[elements['ai-provider'].value]
    elements['ai-base-url'].value = defaults.baseUrl
    elements['ai-model'].value = defaults.model
    elements['ai-key'].value = ''
    elements['ai-key-state'].textContent = '保存后读取密钥状态'
  })

  document.getElementById('ai-config-form').addEventListener('submit', async event => {
    event.preventDefault()
    setConnectionStatus(elements['ai-status'], '正在保存…')
    const provider = elements['ai-provider'].value
    const key = elements['ai-key'].value.trim()
    const ai = {
      enabled: elements['ai-enabled'].checked,
      provider,
      baseUrl: elements['ai-base-url'].value,
      model: elements['ai-model'].value,
      networkConsent: elements['ai-network-consent'].checked,
      shareMemory: elements['ai-share-memory'].checked,
    }
    try {
      const configResult = await game.updateIntegrationConfig({ ai })
      if (!configResult?.success) throw new Error(configResult?.error || 'AI 配置保存失败')
      if (key) {
        const keyResult = await game.setAiKey(provider, key)
        if (!keyResult?.success) throw new Error(keyResult?.error || 'API Key 加密保存失败')
      }
      await refreshIntegrationForm()
      setConnectionStatus(elements['ai-status'], 'AI 配置已保存', 'success')
    } catch (error) {
      try { await refreshIntegrationForm() } catch {}
      setConnectionStatus(elements['ai-status'], errorMessage(error, 'AI 配置保存失败'), 'error')
    }
  })

  document.getElementById('ai-clear-key').addEventListener('click', async () => {
    try {
      const result = await game.setAiKey(elements['ai-provider'].value, '')
      if (!result?.success) throw new Error(result?.error || 'API Key 清除失败')
      await refreshIntegrationForm()
      setConnectionStatus(elements['ai-status'], 'API Key 已清除', 'success')
    } catch (error) {
      try { await refreshIntegrationForm() } catch {}
      setConnectionStatus(elements['ai-status'], errorMessage(error, 'API Key 清除失败'), 'error')
    }
  })

  document.getElementById('ai-test').addEventListener('click', async () => {
    setConnectionStatus(elements['ai-status'], '正在测试连接…')
    try {
      const result = await game.testAi()
      if (!result?.success) throw new Error(result?.error || '模型连接失败')
      setConnectionStatus(elements['ai-status'], '模型连接成功', 'success')
    } catch (error) {
      setConnectionStatus(elements['ai-status'], errorMessage(error, '模型连接失败'), 'error')
    }
  })

  document.getElementById('feishu-config-form').addEventListener('submit', async event => {
    event.preventDefault()
    setConnectionStatus(elements['feishu-status'], '正在保存…')
    const webhook = elements['feishu-webhook'].value.trim()
    const feishu = {
      enabled: elements['feishu-enabled'].checked,
      notifyFocus: elements['feishu-notify-focus'].checked,
      notifyTask: elements['feishu-notify-task'].checked,
    }
    try {
      if (webhook) {
        const webhookResult = await game.setFeishuWebhook(webhook)
        if (!webhookResult?.success) throw new Error(webhookResult?.error || 'Webhook 保存失败')
      }
      const configResult = await game.updateIntegrationConfig({ feishu })
      if (!configResult?.success) throw new Error(configResult?.error || '飞书配置保存失败')
      await refreshIntegrationForm()
      setConnectionStatus(elements['feishu-status'], '飞书配置已保存', 'success')
    } catch (error) {
      try { await refreshIntegrationForm() } catch {}
      setConnectionStatus(elements['feishu-status'], errorMessage(error, '飞书配置保存失败'), 'error')
    }
  })

  document.getElementById('feishu-clear-webhook').addEventListener('click', async () => {
    try {
      const result = await game.setFeishuWebhook('')
      if (!result?.success) throw new Error(result?.error || 'Webhook 清除失败')
      await refreshIntegrationForm()
      setConnectionStatus(elements['feishu-status'], 'Webhook 已清除', 'success')
    } catch (error) {
      try { await refreshIntegrationForm() } catch {}
      setConnectionStatus(elements['feishu-status'], errorMessage(error, 'Webhook 清除失败'), 'error')
    }
  })

  document.getElementById('feishu-test').addEventListener('click', async () => {
    setConnectionStatus(elements['feishu-status'], '正在发送测试…')
    try {
      const result = await game.testFeishu()
      if (!result?.success) throw new Error(result?.error || '飞书发送失败')
      setConnectionStatus(elements['feishu-status'], '飞书测试消息已发送', 'success')
    } catch (error) {
      setConnectionStatus(elements['feishu-status'], errorMessage(error, '飞书发送失败'), 'error')
    }
  })

  game.onState(payload => {
    if (!payload?.state) return
    state = payload.state
    if (payload.event?.type === 'run-completed') {
      playCompletionTone()
      showToast(`旅程完成 · ${rewardMessage(payload.event)}`)
    }
    render()
  })

  setInterval(() => {
    if (!state || state.run.status !== 'running') return
    elements['timer-display'].textContent = formatTime(remainingSeconds())
    elements['pet-speech'].textContent = `我守着这里。还剩 ${formatTime(remainingSeconds())}。`
  }, 250)

  async function initialize() {
    const [stateResult, environment, integrations] = await Promise.all([
      game.getState(),
      game.environment(),
      game.getIntegrationConfig(),
    ])
    state = stateResult.state
    integrationConfig = integrations
    selectedDuration = state.settings.focusMinutes
    render()
    document.body.dataset.ready = 'true'
    const debugApi = {
      environment,
      state: () => state,
      snapshot: () => ({
        ready: document.body.dataset.ready,
        timer: elements['timer-display'].textContent,
        tasks: elements['task-list'].children.length,
        quests: elements['daily-quests'].children.length,
        journeyNodes: elements['journey-track'].children.length,
        unlocks: elements['collection-grid'].children.length,
        achievements: elements['achievement-list'].children.length,
        directorDrawer: Boolean(document.getElementById('director-overlay')),
        integrationStatus: elements['integration-status'].textContent,
      }),
      integrations: () => integrationConfig,
    }
    if (environment.testMode && typeof game.testCompleteRun === 'function') {
      debugApi.completeRun = () => game.testCompleteRun()
    }
    window.__naonaoSteamGame = Object.freeze(debugApi)
  }

  initialize().catch(() => {
    elements['save-status'].textContent = '本地存档加载失败'
    showToast('本地存档加载失败')
  })
})()
