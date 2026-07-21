(function initNaonaoGameEngine(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.NaonaoGameEngine = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNaonaoGameEngine() {
  'use strict'

  const STATE_VERSION = 1
  const ROUTE_LENGTH = 6
  const MAX_TASKS = 120
  const MAX_SESSIONS = 400

  const QUEST_DEFS = Object.freeze([
    { id: 'focus_once', type: 'sessions', target: 1, title: '点亮第一盏灯', reward: { xp: 25, leaves: 8 } },
    { id: 'focus_minutes', type: 'minutes', target: 45, title: '沿小径前进 45 分钟', reward: { xp: 40, leaves: 12 } },
    { id: 'finish_tasks', type: 'tasks', target: 2, title: '收好两件现实任务', reward: { xp: 30, leaves: 10 } },
  ])

  const UNLOCKS = Object.freeze([
    { id: 'classic', level: 1, name: '原野徽章' },
    { id: 'fern-badge', level: 2, name: '蕨叶别针' },
    { id: 'amber-radio', level: 3, name: '琥珀收音机' },
    { id: 'stargazer', level: 4, name: '观星镜' },
    { id: 'copper-hat', level: 5, name: '铜色工作帽' },
  ])

  const ACHIEVEMENTS = Object.freeze([
    { id: 'first-light', name: '第一盏灯', test: state => state.profile.totalSessions >= 1 },
    { id: 'deep-roots', name: '深根', test: state => state.profile.totalFocusMinutes >= 120 },
    { id: 'task-tamer', name: '任务驯养员', test: state => state.profile.totalTasks >= 10 },
    { id: 'trail-keeper', name: '小径守望者', test: state => state.journey.totalSteps >= ROUTE_LENGTH },
    { id: 'steady-company', name: '稳定的陪伴', test: state => state.profile.streak >= 3 },
    { id: 'level-five', name: '孬孬的老朋友', test: state => state.profile.level >= 5 },
  ])

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function clamp(value, min, max) {
    const number = Number(value)
    if (!Number.isFinite(number)) return min
    return Math.min(max, Math.max(min, number))
  }

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value == null ? Date.now() : value)
    return Number.isNaN(date.getTime()) ? new Date() : date
  }

  function dayKey(value) {
    const date = validDate(value)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function previousDayKey(value) {
    const date = validDate(value)
    date.setDate(date.getDate() - 1)
    return dayKey(date)
  }

  function makeId(prefix, value) {
    const stamp = validDate(value).getTime().toString(36)
    return `${prefix}_${stamp}_${Math.random().toString(36).slice(2, 8)}`
  }

  function levelThreshold(level) {
    return 80 + Math.max(0, Number(level) - 1) * 40
  }

  function freshDaily(value) {
    return {
      date: dayKey(value),
      quests: QUEST_DEFS.map(def => ({
        id: def.id,
        type: def.type,
        title: def.title,
        target: def.target,
        progress: 0,
        reward: clone(def.reward),
        claimed: false,
      })),
    }
  }

  function createDefaultState(value) {
    const now = validDate(value)
    return {
      version: STATE_VERSION,
      profile: {
        level: 1,
        xp: 0,
        leaves: 0,
        bond: 0,
        energy: 50,
        streak: 0,
        lastFocusDate: '',
        totalFocusMinutes: 0,
        totalSessions: 0,
        totalTasks: 0,
        createdAt: now.toISOString(),
      },
      journey: { chapter: 1, step: 0, totalSteps: 0 },
      daily: freshDaily(now),
      tasks: [],
      sessions: [],
      run: {
        status: 'idle',
        durationMinutes: 25,
        remainingSeconds: 25 * 60,
        startedAt: null,
        endsAt: null,
        taskId: null,
      },
      unlocks: ['classic'],
      achievements: {},
      settings: {
        focusMinutes: 25,
        sound: true,
        companion: false,
      },
    }
  }

  function normalizeQuest(quest, def) {
    return {
      id: def.id,
      type: def.type,
      title: def.title,
      target: def.target,
      progress: Math.floor(clamp(quest?.progress, 0, def.target)),
      reward: clone(def.reward),
      claimed: quest?.claimed === true,
    }
  }

  function normalizeTaskQuest(quest, value) {
    if (!quest || typeof quest !== 'object' || !Array.isArray(quest.steps)) return null
    const usedStepIds = new Set()
    const steps = []
    quest.steps.slice(0, 5).forEach((step, index) => {
      const text = String(step?.text || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      if (!text) return
      const baseId = String(step?.id || `step_${index + 1}`).trim().slice(0, 40) || `step_${index + 1}`
      let id = baseId
      let duplicate = 2
      while (usedStepIds.has(id)) {
        const suffix = `_${duplicate}`
        id = `${baseId.slice(0, 40 - suffix.length)}${suffix}`
        duplicate += 1
      }
      usedStepIds.add(id)
      steps.push({ id, text, done: step?.done === true })
    })
    if (steps.length < 3) return null
    return {
      title: String(quest.title || '').trim().replace(/\s+/g, ' ').slice(0, 36),
      briefing: String(quest.briefing || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      steps,
      coachLine: String(quest.coachLine || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      rewardName: String(quest.rewardName || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      source: ['openai', 'hermes', 'offline'].includes(quest.source) ? quest.source : 'offline',
      generatedAt: validDate(quest.generatedAt || value).toISOString(),
    }
  }

  function normalizeAchievements(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const normalized = {}
    ACHIEVEMENTS.forEach(achievement => {
      const achievedAt = value[achievement.id]
      if (typeof achievedAt !== 'string') return
      const date = new Date(achievedAt)
      if (!Number.isNaN(date.getTime())) normalized[achievement.id] = date.toISOString()
    })
    return normalized
  }

  function normalizeState(input, value) {
    const base = createDefaultState(value)
    const source = input && typeof input === 'object' ? input : {}
    const profile = source.profile && typeof source.profile === 'object' ? source.profile : {}
    const journey = source.journey && typeof source.journey === 'object' ? source.journey : {}
    const settings = source.settings && typeof source.settings === 'object' ? source.settings : {}
    const state = {
      ...base,
      profile: {
        ...base.profile,
        level: Math.floor(clamp(profile.level ?? base.profile.level, 1, 999)),
        xp: Math.floor(clamp(profile.xp ?? base.profile.xp, 0, 10000000)),
        leaves: Math.floor(clamp(profile.leaves ?? base.profile.leaves, 0, 10000000)),
        bond: Math.floor(clamp(profile.bond ?? base.profile.bond, 0, 10000000)),
        energy: Math.floor(clamp(profile.energy ?? base.profile.energy, 0, 100)),
        streak: Math.floor(clamp(profile.streak ?? base.profile.streak, 0, 100000)),
        lastFocusDate: /^\d{4}-\d{2}-\d{2}$/.test(profile.lastFocusDate || '') ? profile.lastFocusDate : '',
        totalFocusMinutes: Math.floor(clamp(profile.totalFocusMinutes ?? base.profile.totalFocusMinutes, 0, 100000000)),
        totalSessions: Math.floor(clamp(profile.totalSessions ?? base.profile.totalSessions, 0, 10000000)),
        totalTasks: Math.floor(clamp(profile.totalTasks ?? base.profile.totalTasks, 0, 10000000)),
        createdAt: validDate(profile.createdAt || base.profile.createdAt).toISOString(),
      },
      journey: {
        chapter: Math.floor(clamp(journey.chapter ?? base.journey.chapter, 1, 100000)),
        step: Math.floor(clamp(journey.step ?? base.journey.step, 0, ROUTE_LENGTH - 1)),
        totalSteps: Math.floor(clamp(journey.totalSteps ?? base.journey.totalSteps, 0, 10000000)),
      },
      tasks: Array.isArray(source.tasks) ? source.tasks.slice(0, MAX_TASKS).map(task => ({
        id: String(task?.id || makeId('task', value)).slice(0, 80),
        text: String(task?.text || '').trim().slice(0, 80),
        done: task?.done === true,
        rewarded: task?.rewarded === true,
        createdAt: validDate(task?.createdAt || value).toISOString(),
        completedAt: task?.completedAt ? validDate(task.completedAt).toISOString() : null,
        quest: normalizeTaskQuest(task?.quest, value),
      })).filter(task => task.text) : [],
      sessions: Array.isArray(source.sessions) ? source.sessions.slice(-MAX_SESSIONS).map(session => ({
        id: String(session?.id || makeId('session', value)).slice(0, 80),
        durationMinutes: Math.floor(clamp(session?.durationMinutes, 1, 180)),
        taskId: session?.taskId ? String(session.taskId).slice(0, 80) : null,
        completedAt: validDate(session?.completedAt || value).toISOString(),
      })) : [],
      unlocks: Array.isArray(source.unlocks)
        ? [...new Set(source.unlocks.map(String).filter(id => UNLOCKS.some(item => item.id === id)))]
        : ['classic'],
      achievements: normalizeAchievements(source.achievements),
      settings: {
        focusMinutes: Math.floor(clamp(settings.focusMinutes ?? base.settings.focusMinutes, 10, 90)),
        sound: settings.sound !== false,
        companion: settings.companion === true,
      },
    }

    if (!state.unlocks.includes('classic')) state.unlocks.unshift('classic')

    const run = source.run && typeof source.run === 'object' ? source.run : {}
    const runStatus = ['idle', 'running', 'paused'].includes(run.status) ? run.status : 'idle'
    const durationMinutes = Math.floor(clamp(run.durationMinutes ?? state.settings.focusMinutes, 10, 90))
    state.run = {
      status: runStatus,
      durationMinutes,
      remainingSeconds: Math.floor(clamp(run.remainingSeconds ?? durationMinutes * 60, 0, durationMinutes * 60)),
      startedAt: run.startedAt ? validDate(run.startedAt).toISOString() : null,
      endsAt: run.endsAt ? validDate(run.endsAt).toISOString() : null,
      taskId: run.taskId ? String(run.taskId).slice(0, 80) : null,
    }
    if (state.run.status === 'running' && !state.run.endsAt) state.run.status = 'paused'

    const daily = source.daily && typeof source.daily === 'object' && source.daily.date === dayKey(value)
      ? source.daily
      : freshDaily(value)
    state.daily = {
      date: dayKey(value),
      quests: QUEST_DEFS.map(def => normalizeQuest(
        Array.isArray(daily.quests) ? daily.quests.find(quest => quest?.id === def.id) : null,
        def,
      )),
    }

    return applyUnlocksAndAchievements(state, value).state
  }

  function ensureDaily(state, value) {
    const next = normalizeState(state, value)
    if (next.daily.date !== dayKey(value)) next.daily = freshDaily(value)
    return next
  }

  function addRewards(state, reward) {
    const next = clone(state)
    next.profile.xp += Math.max(0, Math.floor(Number(reward?.xp) || 0))
    next.profile.leaves += Math.max(0, Math.floor(Number(reward?.leaves) || 0))
    const levelUps = []
    while (next.profile.xp >= levelThreshold(next.profile.level)) {
      next.profile.xp -= levelThreshold(next.profile.level)
      next.profile.level += 1
      levelUps.push(next.profile.level)
    }
    return { state: next, levelUps }
  }

  function applyUnlocksAndAchievements(state, value) {
    const next = clone(state)
    const unlocked = []
    const achievements = []
    UNLOCKS.forEach(item => {
      if (next.profile.level >= item.level && !next.unlocks.includes(item.id)) {
        next.unlocks.push(item.id)
        unlocked.push(item.id)
      }
    })
    ACHIEVEMENTS.forEach(item => {
      if (!next.achievements[item.id] && item.test(next)) {
        next.achievements[item.id] = validDate(value).toISOString()
        achievements.push(item.id)
      }
    })
    return { state: next, unlocked, achievements }
  }

  function updateQuestProgress(state, type, amount) {
    const next = clone(state)
    next.daily.quests.forEach(quest => {
      if (quest.type !== type || quest.claimed) return
      quest.progress = Math.min(quest.target, quest.progress + amount)
    })
    return next
  }

  function addTask(state, text, value) {
    const next = ensureDaily(state, value)
    const cleanText = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!cleanText) return { state: next, error: '任务不能为空' }
    if (next.tasks.filter(task => !task.done).length >= 20) return { state: next, error: '未完成任务最多保留 20 个' }
    next.tasks.unshift({
      id: makeId('task', value),
      text: cleanText,
      done: false,
      rewarded: false,
      createdAt: validDate(value).toISOString(),
      completedAt: null,
      quest: null,
    })
    next.tasks = next.tasks.slice(0, MAX_TASKS)
    return { state: next }
  }

  function completeTask(state, taskId, value) {
    let next = ensureDaily(state, value)
    const task = next.tasks.find(item => item.id === taskId)
    if (!task) return { state: next, error: '任务不存在' }
    if (task.done) return { state: next, error: '任务已经完成' }
    task.done = true
    task.rewarded = true
    task.completedAt = validDate(value).toISOString()
    next.profile.totalTasks += 1
    next = updateQuestProgress(next, 'tasks', 1)
    const rewardResult = addRewards(next, { xp: 15, leaves: 3 })
    const milestoneResult = applyUnlocksAndAchievements(rewardResult.state, value)
    return {
      state: milestoneResult.state,
      reward: { xp: 15, leaves: 3 },
      levelUps: rewardResult.levelUps,
      unlocked: milestoneResult.unlocked,
      achievements: milestoneResult.achievements,
    }
  }

  function removeTask(state, taskId, value) {
    const next = ensureDaily(state, value)
    next.tasks = next.tasks.filter(task => task.id !== taskId)
    if (next.run.taskId === taskId) next.run.taskId = null
    return { state: next }
  }

  function assignQuest(state, taskId, quest, value) {
    const next = ensureDaily(state, value)
    const task = next.tasks.find(item => item.id === taskId)
    if (!task) return { state: next, error: '任务不存在' }
    if (task.done) return { state: next, error: '已完成任务不能绑定新关卡' }
    const normalizedQuest = normalizeTaskQuest(quest, value)
    if (!normalizedQuest) return { state: next, error: '任务导演返回的关卡格式不正确' }
    const completedSteps = task.quest?.steps.filter(step => step.done).length || 0
    if (completedSteps >= normalizedQuest.steps.length) {
      return { state: next, error: '新关卡必须保留至少一个未完成步骤' }
    }
    normalizedQuest.steps.forEach((step, index) => {
      step.done = index < completedSteps
    })
    task.quest = normalizedQuest
    return { state: next, quest: clone(normalizedQuest) }
  }

  function mergeUnique(...groups) {
    return [...new Set(groups.flat().filter(Boolean))]
  }

  function completeQuestStep(state, taskId, stepId, value) {
    let next = ensureDaily(state, value)
    const task = next.tasks.find(item => item.id === taskId)
    if (!task) return { state: next, error: '任务不存在' }
    if (task.done) return { state: next, error: '任务已经完成' }
    if (!task.quest) return { state: next, error: '任务还没有导演关卡' }
    const step = task.quest.steps.find(item => item.id === stepId)
    if (!step) return { state: next, error: '关卡不存在' }
    if (step.done) return { state: next, error: '关卡已经完成' }
    step.done = true

    const stepReward = { xp: 5, leaves: 1 }
    const rewardResult = addRewards(next, stepReward)
    const milestoneResult = applyUnlocksAndAchievements(rewardResult.state, value)
    next = milestoneResult.state
    if (!next.tasks.find(item => item.id === taskId).quest.steps.every(item => item.done)) {
      return {
        state: next,
        reward: stepReward,
        taskCompleted: false,
        levelUps: rewardResult.levelUps,
        unlocked: milestoneResult.unlocked,
        achievements: milestoneResult.achievements,
      }
    }

    const taskResult = completeTask(next, taskId, value)
    return {
      state: taskResult.state,
      reward: {
        xp: stepReward.xp + (taskResult.reward?.xp || 0),
        leaves: stepReward.leaves + (taskResult.reward?.leaves || 0),
      },
      taskCompleted: true,
      levelUps: mergeUnique(rewardResult.levelUps, taskResult.levelUps),
      unlocked: mergeUnique(milestoneResult.unlocked, taskResult.unlocked),
      achievements: mergeUnique(milestoneResult.achievements, taskResult.achievements),
    }
  }

  function startRun(state, options, value) {
    const next = ensureDaily(state, value)
    if (next.run.status !== 'idle') return { state: next, error: '已有专注旅程正在进行' }
    const durationMinutes = Math.floor(clamp(options?.durationMinutes || next.settings.focusMinutes, 10, 90))
    const now = validDate(value)
    next.settings.focusMinutes = durationMinutes
    next.run = {
      status: 'running',
      durationMinutes,
      remainingSeconds: durationMinutes * 60,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + durationMinutes * 60 * 1000).toISOString(),
      taskId: options?.taskId ? String(options.taskId).slice(0, 80) : null,
    }
    return { state: next }
  }

  function pauseRun(state, value) {
    const next = ensureDaily(state, value)
    if (next.run.status !== 'running') return { state: next, completed: false, error: '当前没有运行中的专注旅程' }
    const now = validDate(value)
    const endsAt = validDate(next.run.endsAt)
    if (endsAt.getTime() <= now.getTime()) return settleRun(next, now)
    next.run.remainingSeconds = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000))
    next.run.status = 'paused'
    next.run.endsAt = null
    return { state: next, completed: false }
  }

  function resumeRun(state, value) {
    const next = ensureDaily(state, value)
    if (next.run.status !== 'paused') return { state: next, error: '当前没有暂停中的专注旅程' }
    const now = validDate(value)
    next.run.status = 'running'
    next.run.endsAt = new Date(now.getTime() + next.run.remainingSeconds * 1000).toISOString()
    return { state: next }
  }

  function resetRun(state) {
    const next = clone(state)
    next.run = {
      status: 'idle',
      durationMinutes: next.settings.focusMinutes,
      remainingSeconds: next.settings.focusMinutes * 60,
      startedAt: null,
      endsAt: null,
      taskId: null,
    }
    return next
  }

  function cancelRun(state, value) {
    const next = ensureDaily(state, value)
    const now = validDate(value)
    if (
      next.run.status === 'running' &&
      next.run.endsAt &&
      validDate(next.run.endsAt).getTime() <= now.getTime()
    ) {
      return settleRun(next, now)
    }
    return { state: resetRun(next), completed: false }
  }

  function completeFocus(state, durationMinutes, taskId, value) {
    let next = ensureDaily(state, value)
    const minutes = Math.floor(clamp(durationMinutes, 1, 180))
    const today = dayKey(value)
    if (next.profile.lastFocusDate !== today) {
      next.profile.streak = next.profile.lastFocusDate === previousDayKey(value)
        ? next.profile.streak + 1
        : 1
      next.profile.lastFocusDate = today
    }
    next.profile.totalFocusMinutes += minutes
    next.profile.totalSessions += 1
    next.profile.bond += Math.max(1, Math.ceil(minutes / 10))
    next.profile.energy = Math.min(100, next.profile.energy + Math.max(2, Math.ceil(minutes / 5)))
    next.journey.totalSteps += 1
    next.journey.step += 1
    if (next.journey.step >= ROUTE_LENGTH) {
      next.journey.step = 0
      next.journey.chapter += 1
    }
    next.sessions.push({
      id: makeId('session', value),
      durationMinutes: minutes,
      taskId: taskId || null,
      completedAt: validDate(value).toISOString(),
    })
    next.sessions = next.sessions.slice(-MAX_SESSIONS)
    next = updateQuestProgress(next, 'sessions', 1)
    next = updateQuestProgress(next, 'minutes', minutes)

    const reward = {
      xp: 10 + minutes * 2,
      leaves: Math.max(4, Math.ceil(minutes / 5) * 2),
    }
    const rewardResult = addRewards(next, reward)
    const milestoneResult = applyUnlocksAndAchievements(rewardResult.state, value)
    return {
      state: milestoneResult.state,
      reward,
      levelUps: rewardResult.levelUps,
      unlocked: milestoneResult.unlocked,
      achievements: milestoneResult.achievements,
    }
  }

  function settleRun(state, value) {
    const next = ensureDaily(state, value)
    if (next.run.status !== 'running' || !next.run.endsAt) return { state: next, completed: false }
    const now = validDate(value)
    if (validDate(next.run.endsAt).getTime() > now.getTime()) return { state: next, completed: false }
    const durationMinutes = next.run.durationMinutes
    const taskId = next.run.taskId
    const completed = completeFocus(next, durationMinutes, taskId, now)
    return { ...completed, state: resetRun(completed.state), completed: true }
  }

  function claimDailyQuest(state, questId, value) {
    let next = ensureDaily(state, value)
    const quest = next.daily.quests.find(item => item.id === questId)
    if (!quest) return { state: next, error: '每日任务不存在' }
    if (quest.claimed) return { state: next, error: '奖励已经领取' }
    if (quest.progress < quest.target) return { state: next, error: '每日任务尚未完成' }
    quest.claimed = true
    const rewardResult = addRewards(next, quest.reward)
    const milestoneResult = applyUnlocksAndAchievements(rewardResult.state, value)
    return {
      state: milestoneResult.state,
      reward: clone(quest.reward),
      levelUps: rewardResult.levelUps,
      unlocked: milestoneResult.unlocked,
      achievements: milestoneResult.achievements,
    }
  }

  function updateSettings(state, settings, value) {
    const next = ensureDaily(state, value)
    if (settings && Object.prototype.hasOwnProperty.call(settings, 'focusMinutes')) {
      next.settings.focusMinutes = Math.floor(clamp(settings.focusMinutes, 10, 90))
      if (next.run.status === 'idle') {
        next.run.durationMinutes = next.settings.focusMinutes
        next.run.remainingSeconds = next.settings.focusMinutes * 60
      }
    }
    if (settings && Object.prototype.hasOwnProperty.call(settings, 'sound')) next.settings.sound = settings.sound !== false
    if (settings && Object.prototype.hasOwnProperty.call(settings, 'companion')) next.settings.companion = settings.companion === true
    return { state: next }
  }

  function runRemainingSeconds(state, value) {
    if (state?.run?.status === 'paused') return Math.max(0, Math.floor(state.run.remainingSeconds || 0))
    if (state?.run?.status !== 'running' || !state.run.endsAt) return Math.max(0, Math.floor(state?.run?.remainingSeconds || 0))
    return Math.max(0, Math.ceil((validDate(state.run.endsAt).getTime() - validDate(value).getTime()) / 1000))
  }

  return Object.freeze({
    STATE_VERSION,
    ROUTE_LENGTH,
    QUEST_DEFS,
    UNLOCKS,
    ACHIEVEMENTS,
    levelThreshold,
    dayKey,
    createDefaultState,
    normalizeState,
    addTask,
    completeTask,
    removeTask,
    assignQuest,
    completeQuestStep,
    startRun,
    pauseRun,
    resumeRun,
    cancelRun,
    settleRun,
    claimDailyQuest,
    updateSettings,
    runRemainingSeconds,
  })
})
