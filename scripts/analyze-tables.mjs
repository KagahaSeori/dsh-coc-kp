import { readFileSync } from 'node:fs'

const source = readFileSync('表.txt', 'utf8')

function jsonBlocks(text) {
  const blocks = []
  let depth = 0
  let current = ''
  let started = false
  let startLine = 0
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (!started && trimmed === '{') {
      started = true
      depth = 0
      current = ''
      startLine = index + 1
    }
    if (!started) return
    current += `${line}\n`
    for (const char of line) {
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
    }
    if (depth === 0) {
      blocks.push({ text: current, line: startLine })
      started = false
    }
  })
  return blocks
}

const creatures = []
let weaponCount = 0
for (const block of jsonBlocks(source)) {
  let parsed
  try {
    parsed = JSON.parse(block.text)
  } catch {
    continue
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '武器库') {
      for (const entries of Object.values(value)) weaponCount += Object.keys(entries).length
      continue
    }
    if (value !== null && typeof value === 'object' && '分类' in value) {
      creatures.push({ name: key, category: value['分类'] })
    }
  }
}

console.log('creatures:', creatures.length, '| weapons:', weaponCount)
const byCategory = new Map()
for (const creature of creatures) {
  const group = String(creature.category).replace(/（.*$/, '').replace(/\(.*$/, '')
  const list = byCategory.get(group) ?? []
  list.push(creature.name)
  byCategory.set(group, list)
}
for (const [group, names] of byCategory) {
  console.log(`${group} (${names.length}): ${names.join('、')}`)
}
