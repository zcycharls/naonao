const assert = require('assert')
const Engine = require('../app/js/steam-game-engine.js')

const dayOne = new Date('2026-07-13T09:00:00+08:00')
const dayTwo = new Date('2026-07-14T09:00:00+08:00')
const dayThree = new Date('2026-07-15T09:00:00+08:00')

let state = Engine.createDefaultState(dayOne)
assert.strictEqual(state.profile.level, 1)
assert.strictEqual(state.daily.date, '2026-07-13')
assert.deepStrictEqual(state.unlocks, ['classic'])

const normalizedDefault = Engine.normalizeState(null, dayOne)
assert.strictEqual(normalizedDefault.profile.energy, 50)
assert.strictEqual(normalizedDefault.settings.focusMinutes, 25)
assert.strictEqual(normalizedDefault.run.durationMinutes, 25)
assert.strictEqual(normalizedDefault.run.remainingSeconds, 25 * 60)

const emptyTask = Engine.addTask(state, '   ', dayOne)
assert.strictEqual(emptyTask.error, '任务不能为空')
assert.strictEqual(state.tasks.length, 0)

const added = Engine.addTask(state, '  写完 Steam 商店介绍  ', dayOne)
assert.ifError(added.error)
assert.strictEqual(added.state.tasks.length, 1)
assert.strictEqual(added.state.tasks[0].text, '写完 Steam 商店介绍')
assert.strictEqual(state.tasks.length, 0, 'engine actions must not mutate the input state')
state = added.state

let directedState = Engine.addTask(Engine.createDefaultState(dayOne), '准备发布材料', dayOne).state
const directedTaskId = directedState.tasks[0].id
const assignedQuest = Engine.assignQuest(directedState, directedTaskId, {
  title: '发布远征',
  briefing: '完成三个可验证步骤。',
  steps: [
    { id: 'step_1', text: '核对文案', done: false },
    { id: 'step_2', text: '整理截图', done: false },
    { id: 'step_3', text: '检查构建', done: false },
  ],
  coachLine: '一次只做一步。',
  rewardName: '发行徽章',
  source: 'hermes',
  generatedAt: dayOne.toISOString(),
}, dayOne)
assert.ifError(assignedQuest.error)
assert.strictEqual(assignedQuest.state.tasks[0].quest.steps.length, 3)
assert.strictEqual(directedState.tasks[0].quest, null, 'assignQuest must not mutate the input state')
directedState = assignedQuest.state

const firstStep = Engine.completeQuestStep(directedState, directedTaskId, 'step_1', dayOne)
assert.ifError(firstStep.error)
assert.deepStrictEqual(firstStep.reward, { xp: 5, leaves: 1 })
assert.strictEqual(firstStep.state.tasks[0].done, false)
assert.strictEqual(firstStep.state.tasks[0].quest.steps[0].done, true)
const firstStepTwice = Engine.completeQuestStep(firstStep.state, directedTaskId, 'step_1', dayOne)
assert.strictEqual(firstStepTwice.error, '关卡已经完成')
assert.strictEqual(firstStepTwice.state.profile.leaves, firstStep.state.profile.leaves)

const twoStepsBeforeRegeneration = Engine.completeQuestStep(firstStep.state, directedTaskId, 'step_2', dayOne)
assert.ifError(twoStepsBeforeRegeneration.error)
const regeneratedQuest = Engine.assignQuest(twoStepsBeforeRegeneration.state, directedTaskId, {
  title: '发布远征再规划',
  briefing: '保留已经完成的关卡进度。',
  steps: [
    { id: 'new_step_1', text: '复核已有材料', done: false },
    { id: 'new_step_2', text: '补齐商店截图', done: false },
    { id: 'new_step_3', text: '完成提交检查', done: false },
  ],
  coachLine: '保留进度，再继续前进。',
  rewardName: '再规划徽章',
  source: 'hermes',
  generatedAt: dayOne.toISOString(),
}, dayOne)
assert.ifError(regeneratedQuest.error)
assert.strictEqual(regeneratedQuest.state.tasks[0].quest.steps[0].done, true)
assert.strictEqual(regeneratedQuest.state.tasks[0].quest.steps[1].done, true)
assert.strictEqual(regeneratedQuest.state.tasks[0].quest.steps[2].done, false)
assert.strictEqual(regeneratedQuest.state.profile.leaves, twoStepsBeforeRegeneration.state.profile.leaves)
const regeneratedStepTwice = Engine.completeQuestStep(
  regeneratedQuest.state,
  directedTaskId,
  'new_step_1',
  dayOne,
)
assert.strictEqual(regeneratedStepTwice.error, '关卡已经完成')
assert.strictEqual(regeneratedStepTwice.state.profile.leaves, twoStepsBeforeRegeneration.state.profile.leaves)
const regeneratedFinalStep = Engine.completeQuestStep(
  regeneratedQuest.state,
  directedTaskId,
  'new_step_3',
  dayOne,
)
assert.strictEqual(regeneratedFinalStep.taskCompleted, true)
assert.strictEqual(regeneratedFinalStep.state.profile.leaves, 6)

const secondStep = Engine.completeQuestStep(firstStep.state, directedTaskId, 'step_2', dayOne)
const finalStep = Engine.completeQuestStep(secondStep.state, directedTaskId, 'step_3', dayOne)
assert.ifError(finalStep.error)
assert.strictEqual(finalStep.taskCompleted, true)
assert.strictEqual(finalStep.state.tasks[0].done, true)
assert.strictEqual(finalStep.state.profile.totalTasks, 1)
assert.strictEqual(finalStep.state.profile.leaves, 6)

const taskId = state.tasks[0].id
const taskDone = Engine.completeTask(state, taskId, dayOne)
assert.ifError(taskDone.error)
assert.deepStrictEqual(taskDone.reward, { xp: 15, leaves: 3 })
assert.strictEqual(taskDone.state.profile.totalTasks, 1)
assert.strictEqual(taskDone.state.daily.quests.find(item => item.type === 'tasks').progress, 1)

const taskDoneTwice = Engine.completeTask(taskDone.state, taskId, dayOne)
assert.strictEqual(taskDoneTwice.error, '任务已经完成')
assert.strictEqual(taskDoneTwice.state.profile.totalTasks, 1)
assert.strictEqual(taskDoneTwice.state.profile.leaves, 3)
state = taskDone.state

const started = Engine.startRun(state, { durationMinutes: 25, taskId }, dayOne)
assert.ifError(started.error)
assert.strictEqual(started.state.run.status, 'running')
assert.strictEqual(Engine.runRemainingSeconds(started.state, dayOne), 1500)

const pausedAt = new Date(dayOne.getTime() + 5 * 60 * 1000)
const paused = Engine.pauseRun(started.state, pausedAt)
assert.ifError(paused.error)
assert.strictEqual(paused.completed, false)
assert.strictEqual(paused.state.run.status, 'paused')
assert.strictEqual(paused.state.run.remainingSeconds, 1200)

const resumedAt = new Date(pausedAt.getTime() + 10 * 60 * 1000)
const resumed = Engine.resumeRun(paused.state, resumedAt)
assert.ifError(resumed.error)
assert.strictEqual(resumed.state.run.status, 'running')
assert.strictEqual(Engine.runRemainingSeconds(resumed.state, resumedAt), 1200)

const notFinished = Engine.settleRun(resumed.state, new Date(resumedAt.getTime() + 1199 * 1000))
assert.strictEqual(notFinished.completed, false)

const finished = Engine.settleRun(resumed.state, new Date(resumedAt.getTime() + 1200 * 1000))
assert.strictEqual(finished.completed, true)
assert.strictEqual(finished.state.run.status, 'idle')
assert.strictEqual(finished.state.profile.totalSessions, 1)
assert.strictEqual(finished.state.profile.totalFocusMinutes, 25)
assert.strictEqual(finished.state.profile.streak, 1)
assert.strictEqual(finished.state.journey.totalSteps, 1)
assert.strictEqual(finished.state.daily.quests.find(item => item.type === 'sessions').progress, 1)
assert.strictEqual(finished.state.daily.quests.find(item => item.type === 'minutes').progress, 25)
assert.ok(finished.achievements.includes('first-light'))
state = finished.state

const pauseExpiredStart = Engine.startRun(Engine.createDefaultState(dayOne), { durationMinutes: 10 }, dayOne)
const pauseExpired = Engine.pauseRun(pauseExpiredStart.state, new Date(dayOne.getTime() + 10 * 60 * 1000))
assert.strictEqual(pauseExpired.completed, true)
assert.strictEqual(pauseExpired.state.run.status, 'idle')
assert.strictEqual(pauseExpired.state.profile.totalSessions, 1)
assert.strictEqual(pauseExpired.state.profile.totalFocusMinutes, 10)

const cancelExpiredStart = Engine.startRun(Engine.createDefaultState(dayOne), { durationMinutes: 10 }, dayOne)
const cancelExpired = Engine.cancelRun(cancelExpiredStart.state, new Date(dayOne.getTime() + 10 * 60 * 1000))
assert.strictEqual(cancelExpired.completed, true)
assert.strictEqual(cancelExpired.state.run.status, 'idle')
assert.strictEqual(cancelExpired.state.profile.totalSessions, 1)
assert.strictEqual(cancelExpired.state.profile.totalFocusMinutes, 10)
const settleAfterCancelCompletion = Engine.settleRun(cancelExpired.state, new Date(dayOne.getTime() + 11 * 60 * 1000))
assert.strictEqual(settleAfterCancelCompletion.completed, false)
assert.strictEqual(settleAfterCancelCompletion.state.profile.totalSessions, 1)

const cancelActiveStart = Engine.startRun(Engine.createDefaultState(dayOne), { durationMinutes: 10 }, dayOne)
const cancelActive = Engine.cancelRun(cancelActiveStart.state, new Date(dayOne.getTime() + 5 * 60 * 1000))
assert.strictEqual(cancelActive.completed, false)
assert.strictEqual(cancelActive.state.run.status, 'idle')
assert.strictEqual(cancelActive.state.profile.totalSessions, 0)

const focusQuest = state.daily.quests.find(item => item.id === 'focus_once')
assert.strictEqual(focusQuest.claimed, false)
const claimed = Engine.claimDailyQuest(state, focusQuest.id, dayOne)
assert.ifError(claimed.error)
assert.strictEqual(claimed.state.daily.quests.find(item => item.id === focusQuest.id).claimed, true)
const leavesAfterClaim = claimed.state.profile.leaves
const claimAgain = Engine.claimDailyQuest(claimed.state, focusQuest.id, dayOne)
assert.strictEqual(claimAgain.error, '奖励已经领取')
assert.strictEqual(claimAgain.state.profile.leaves, leavesAfterClaim)
state = claimed.state

const dayTwoFocus = Engine.startRun(state, { durationMinutes: 10 }, dayTwo)
const dayTwoFinished = Engine.settleRun(dayTwoFocus.state, new Date(dayTwo.getTime() + 10 * 60 * 1000))
assert.strictEqual(dayTwoFinished.completed, true)
assert.strictEqual(dayTwoFinished.state.profile.streak, 2)
assert.strictEqual(dayTwoFinished.state.daily.date, '2026-07-14')
assert.strictEqual(dayTwoFinished.state.daily.quests.find(item => item.type === 'sessions').progress, 1)
state = dayTwoFinished.state

const dayThreeFocus = Engine.startRun(state, { durationMinutes: 45 }, dayThree)
const dayThreeFinished = Engine.settleRun(dayThreeFocus.state, new Date(dayThree.getTime() + 45 * 60 * 1000))
assert.strictEqual(dayThreeFinished.state.profile.streak, 3)
assert.ok(dayThreeFinished.achievements.includes('steady-company'))

let levelState = Engine.createDefaultState(dayOne)
for (let i = 0; i < 4; i += 1) {
  levelState = Engine.startRun(levelState, { durationMinutes: 45 }, new Date(dayOne.getTime() + i * 60 * 60 * 1000)).state
  levelState = Engine.settleRun(levelState, new Date(dayOne.getTime() + i * 60 * 60 * 1000 + 45 * 60 * 1000)).state
}
assert.ok(levelState.profile.level >= 3)
assert.ok(levelState.unlocks.includes('fern-badge'))
assert.ok(levelState.unlocks.includes('amber-radio'))

const corrupt = Engine.normalizeState({
  profile: { level: -9, xp: 'bad', energy: 999 },
  tasks: [{ id: '', text: '<b>保留为纯文本</b>', done: false }],
  run: { status: 'running', durationMinutes: 999, endsAt: null },
  unlocks: ['not-real'],
}, dayOne)
assert.strictEqual(corrupt.profile.level, 1)
assert.strictEqual(corrupt.profile.xp, 0)
assert.strictEqual(corrupt.profile.energy, 100)
assert.strictEqual(corrupt.run.status, 'paused')
assert.strictEqual(corrupt.run.durationMinutes, 90)
assert.deepStrictEqual(corrupt.unlocks, ['classic'])
assert.strictEqual(corrupt.tasks[0].text, '<b>保留为纯文本</b>')
assert.strictEqual(corrupt.tasks[0].quest, null)

const normalizedInvariants = Engine.normalizeState({
  achievements: {
    'first-light': { unsafe: true },
    'task-tamer': '2026-07-12T01:00:00.000Z',
    'not-real': '2026-07-12T01:00:00.000Z',
  },
  tasks: [{
    id: 'task_with_duplicate_steps',
    text: '检查归一化不变量',
    quest: {
      title: '归一化检查',
      briefing: '重复步骤 ID 必须被修复。',
      steps: [
        { id: 'duplicate', text: '第一步', done: false },
        { id: 'duplicate', text: '第二步', done: false },
        { id: 'duplicate_2', text: '第三步', done: false },
      ],
      source: 'offline',
      generatedAt: dayOne.toISOString(),
    },
  }],
}, dayOne)
assert.deepStrictEqual(normalizedInvariants.achievements, {
  'task-tamer': '2026-07-12T01:00:00.000Z',
})
const normalizedStepIds = normalizedInvariants.tasks[0].quest.steps.map(step => step.id)
assert.strictEqual(new Set(normalizedStepIds).size, normalizedStepIds.length)
assert.ok(normalizedStepIds.every(id => id.length > 0 && id.length <= 40))

console.log('steam game engine tests passed')
