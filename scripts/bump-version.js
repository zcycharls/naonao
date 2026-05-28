const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const nowArg = args.find(arg => arg.startsWith('--now='))
const now = nowArg ? new Date(nowArg.slice('--now='.length)) : new Date()

if (Number.isNaN(now.getTime())) {
  console.error('Invalid --now value')
  process.exit(1)
}

function versionFromDate(date) {
  const monthDay = Number(`${date.getMonth() + 1}${String(date.getDate()).padStart(2, '0')}`)
  const hourMinute = Number(`${date.getHours()}${String(date.getMinutes()).padStart(2, '0')}`)
  return `1.${monthDay}.${hourMinute}`
}

function updateJSON(filename, version) {
  const filePath = path.join(process.cwd(), filename)
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  data.version = version
  if (filename === 'package-lock.json' && data.packages && data.packages['']) {
    data.packages[''].version = version
  }
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

const version = versionFromDate(now)

if (!dryRun) {
  updateJSON('package.json', version)
  updateJSON('package-lock.json', version)
}

console.log(`Version ${dryRun ? 'would bump' : 'bumped'} to ${version}`)
