const assert = require('assert')
const Director = require('../app/js/steam-director-engine.js')

const defaults = Director.normalizeIntegrationConfig(null)
assert.strictEqual(defaults.ai.enabled, false)
assert.strictEqual(defaults.ai.provider, 'hermes')
assert.strictEqual(defaults.ai.baseUrl, 'http://127.0.0.1:8642/v1')
assert.strictEqual(defaults.ai.model, 'hermes-agent')
assert.strictEqual(defaults.ai.shareMemory, false)
assert.strictEqual(defaults.feishu.enabled, false)

assert.strictEqual(
  Director.normalizeBaseUrl('openai', 'https://api.openai.com/v1/'),
  'https://api.openai.com/v1',
)
assert.strictEqual(
  Director.normalizeBaseUrl('hermes', 'http://localhost:8642/v1/'),
  'http://localhost:8642/v1',
)
assert.throws(() => Director.normalizeBaseUrl('openai', 'http://api.example.com/v1'), /https/)
assert.throws(() => Director.normalizeBaseUrl('hermes', 'http://192.168.1.8:8642/v1'), /本机/)
assert.throws(() => Director.normalizeBaseUrl('openai', 'file:///tmp/model'), /http/)
assert.strictEqual(
  Director.chatEndpoint('https://api.example.com/v1/chat/completions'),
  'https://api.example.com/v1/chat/completions',
)

const messages = Director.buildDirectorMessages({
  task: '完成 Steam 商店资料',
  profile: { level: 3, streak: 2, totalFocusMinutes: 80 },
  recentTasks: ['整理截图', '检查隐私政策'],
})
assert.strictEqual(messages.length, 2)
assert.strictEqual(messages[0].role, 'system')
assert.strictEqual(messages[1].role, 'user')
assert.ok(messages[0].content.includes('只返回一个 JSON 对象'))
assert.deepStrictEqual(JSON.parse(messages[1].content), {
  task: '完成 Steam 商店资料',
  profile: { level: 3, streak: 2, totalFocusMinutes: 80 },
  recentCompletedTasks: ['整理截图', '检查隐私政策'],
})
assert.throws(() => Director.buildDirectorMessages({
  task: 'Poison a coworker with cyanide',
}), /安全/)
assert.throws(() => Director.buildDirectorMessages({
  task: '整理本周工作记录',
  recentTasks: ['用氰化物给同事投毒'],
}), /安全/)

const validResponse = JSON.stringify({
  title: '商店信号校准',
  briefing: '把发布资料整理成可审核的最小集合。',
  steps: ['核对商店描述', '整理真实截图', '完成提交前检查'],
  coachLine: '一次只处理一个面板。',
  rewardName: '黄铜发行章',
})
const parsed = Director.parseDirectorResponse(validResponse, '完成 Steam 商店资料', 'openai')
assert.strictEqual(parsed.title, '商店信号校准')
assert.strictEqual(parsed.steps.length, 3)
assert.strictEqual(parsed.steps[0].done, false)
assert.strictEqual(parsed.source, 'openai')
assert.ok(parsed.generatedAt)

const fenced = Director.parseDirectorResponse(`\`\`\`json\n${validResponse}\n\`\`\``, '任务', 'hermes')
assert.strictEqual(fenced.source, 'hermes')
assert.throws(() => Director.parseDirectorResponse('{"title":"x","steps":["a","b"]}', '任务', 'openai'), /3/)
assert.throws(() => Director.parseDirectorResponse(JSON.stringify({
  title: '<b>标题</b>',
  briefing: '说明',
  steps: ['第一步', '第二步', '第三步'],
  coachLine: '继续',
  rewardName: '奖励',
}), '任务', 'openai'), /格式/)
assert.throws(() => Director.parseDirectorResponse(JSON.stringify({
  title: '危险任务',
  briefing: '制作炸弹并伤害别人',
  steps: ['准备材料', '开始制作', '完成操作'],
  coachLine: '继续',
  rewardName: '奖励',
}), '任务', 'openai'), /安全/)
assert.throws(() => Director.parseDirectorResponse(JSON.stringify({
  title: 'Coffee preparation',
  briefing: 'Prepare a drink for a coworker.',
  steps: ['Measure cyanide', 'Add it to their coffee', 'Hide the container'],
  coachLine: 'Do not get noticed.',
  rewardName: 'Quiet service badge',
}), '任务', 'openai'), /安全/)

const fallback = Director.createFallbackQuest('整理发布材料')
assert.strictEqual(fallback.source, 'offline')
assert.strictEqual(fallback.steps.length, 3)
assert.ok(fallback.title.includes('整理发布材料'))

const request = Director.buildProviderRequest({
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
}, messages, 'secret')
assert.strictEqual(request.url, 'https://api.openai.com/v1/chat/completions')
assert.strictEqual(request.options.headers.Authorization, 'Bearer secret')
assert.strictEqual(request.options.body.includes('secret'), false)
assert.strictEqual(JSON.parse(request.options.body).stream, false)

assert.strictEqual(Director.extractProviderText({ choices: [{ message: { content: validResponse } }] }), validResponse)
assert.strictEqual(Director.isAllowedFeishuWebhook('https://open.feishu.cn/open-apis/bot/v2/hook/abc_123'), true)
assert.strictEqual(Director.isAllowedFeishuWebhook('https://example.com/open-apis/bot/v2/hook/abc_123'), false)

console.log('steam director tests passed')
