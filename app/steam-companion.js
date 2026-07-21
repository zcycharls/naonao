(function startCompanion() {
  'use strict'

  const game = window.naonaoGame
  const scene = document.querySelector('.companion-scene')
  const speech = document.getElementById('speech')
  const runLabel = document.getElementById('run-label')
  const timer = document.getElementById('timer')
  const runControl = document.getElementById('run-control')
  let state = null
  let busy = false

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0))
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
  }

  function remainingSeconds() {
    if (state.run.status === 'running' && state.run.endsAt) {
      return Math.max(0, Math.ceil((new Date(state.run.endsAt).getTime() - Date.now()) / 1000))
    }
    return state.run.remainingSeconds
  }

  function renderClock() {
    if (!state) return
    timer.textContent = formatTime(remainingSeconds())
    if (state.run.status === 'running') speech.textContent = `还剩 ${timer.textContent}，我陪你。`
  }

  function render() {
    if (!state) return
    const status = state.run.status
    scene.classList.toggle('running', status === 'running')
    runLabel.textContent = status === 'idle' ? '待机' : status === 'running' ? '专注中' : '已暂停'
    runControl.textContent = status === 'idle' ? '开始' : status === 'running' ? '暂停' : '继续'
    runControl.disabled = busy
    speech.textContent = status === 'idle'
      ? '我在这里陪你。'
      : status === 'paused'
        ? '休息一下，再继续。'
        : `还剩 ${formatTime(remainingSeconds())}，我陪你。`
    renderClock()
  }

  runControl.addEventListener('click', async () => {
    if (!state || busy) return
    busy = true
    runControl.disabled = true
    let failure = ''
    try {
      const result = state.run.status === 'idle'
        ? await game.startRun({ durationMinutes: state.settings.focusMinutes })
        : state.run.status === 'running'
          ? await game.pauseRun()
          : await game.resumeRun()
      if (result?.state && !result.error) state = result.state
      else failure = String(result?.error || '操作失败，请重试').slice(0, 120)
    } catch {
      failure = '操作失败，请重试'
    } finally {
      busy = false
      render()
      if (failure) speech.textContent = failure
    }
  })

  document.getElementById('show-main').addEventListener('click', game.showMain)
  document.getElementById('disable-companion').addEventListener('click', game.disableCompanion)
  game.onState(payload => {
    if (!payload?.state) return
    state = payload.state
    render()
  })
  setInterval(renderClock, 250)

  game.getState()
    .then(result => {
      state = result.state
      render()
      document.body.dataset.ready = 'true'
    })
    .catch(() => {
      runControl.disabled = true
      speech.textContent = '本地存档加载失败'
      document.body.dataset.ready = 'error'
    })
})()
