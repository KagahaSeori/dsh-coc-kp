import { readFileSync } from 'node:fs'

function jsonBlocks(text) {
  const blocks = []
  let depth = 0
  let current = ''
  let started = false
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!started && trimmed === '{') {
      started = true
      depth = 0
      current = ''
    }
    if (!started) return
    current += `${line}\n`
    for (const char of line) {
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
    }
    if (depth === 0) {
      blocks.push(current)
      started = false
    }
  })
  return blocks
}

function load(name) {
  const map = new Map()
  for (const block of jsonBlocks(readFileSync(name, 'utf8'))) {
    let parsed
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object' && '分类' in value) map.set(key, value)
    }
  }
  return map
}

const old = load('表.txt')
const fresh = load('新怪物.json')

/** First integer of a possibly dice-form characteristic. */
function num(value) {
  if (typeof value === 'number') return value
  const match = /-?\d+/.exec(String(value ?? '').replace(/,/g, ''))
  return match === null ? null : Number(match[0])
}

/** Check 7e derived consistency: HP=(CON+SIZ)/10, MP=POW/5, DB/Build from STR+SIZ. */
function audit(entry) {
  const attributes = entry['属性'] ?? {}
  const derived = entry['衍生'] ?? {}
  const con = num(attributes['CON'])
  const siz = num(attributes['SIZ'])
  const pow = num(attributes['POW'])
  const hp = num(derived['HP'])
  const mp = num(derived['MP'])
  const str = num(attributes['STR'])
  const si = num(attributes['SIZ'])
  const lines = []
  if (con !== null && siz !== null && hp !== null) {
    const expected = Math.round((con + siz) / 10)
    lines.push(`HP 期望≈${expected} 实际=${hp} ${Math.abs(expected - hp) <= 1 ? 'OK' : 'MISMATCH'}`)
  }
  if (pow !== null && mp !== null) {
    const expected = Math.round(pow / 5)
    lines.push(`MP 期望≈${expected} 实际=${mp} ${Math.abs(expected - mp) <= 1 ? 'OK' : 'MISMATCH'}`)
  }
  if (str !== null && si !== null) {
    const total = str + si
    const expectedBuild = total <= 64 ? 0 : Math.floor((total - 65) / 80) + 1
    lines.push(`STR+SIZ=${total} → 期望 Build≈${expectedBuild} 实际 DB=${JSON.stringify(derived['DB'])}`)
  }
  return lines.join('；')
}

for (const name of ['加塔诺托亚', '尼约格达', '巴斯特', '诺登斯']) {
  console.log(`\n== ${name}`)
  console.log('  表.txt :', audit(old.get(name)))
  console.log('  新怪物 :', audit(fresh.get(name)))
}
