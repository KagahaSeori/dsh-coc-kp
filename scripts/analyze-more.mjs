import { readFileSync } from 'node:fs'

/** Extract balanced top-level `{...}` blocks from a file that concatenates JSON objects. */
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

const raw = readFileSync('新怪物.json', 'utf8')
const blocks = jsonBlocks(raw)
console.log('blocks:', blocks.length)
const failures = []
const merged = new Map()
for (const block of blocks) {
  let parsed
  try {
    parsed = JSON.parse(block.text)
  } catch (error) {
    failures.push({ line: block.line, error: String(error).slice(0, 100) })
    continue
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== 'object') continue
    if (merged.has(name)) console.log('DUPLICATE within file:', name)
    merged.set(name, value)
  }
}
console.log('parse failures:', failures.length)
for (const failure of failures) console.log('  FAIL line', failure.line, failure.error)
console.log('creatures:', merged.size)

const fields = new Map()
for (const value of merged.values()) {
  for (const key of Object.keys(value)) fields.set(key, (fields.get(key) ?? 0) + 1)
}
console.log('field frequency:', JSON.stringify([...fields.entries()].sort((a, b) => b[1] - a[1])))

const categories = new Map()
for (const value of merged.values()) {
  const category = value?.['分类'] ?? '(none)'
  categories.set(category, (categories.get(category) ?? 0) + 1)
}
console.log('categories:', categories.size)
for (const [category, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${category}: ${count}`)

const existing = new Set()
const bestiary = readFileSync('src/data/bestiary.ts', 'utf8')
for (const match of bestiary.matchAll(/"npc_name":"((?:[^"\\]|\\.)*)"/g)) existing.add(JSON.parse(`"${match[1]}"`))
const duplicateNames = [...merged.keys()].filter((name) => existing.has(name))
const fresh = [...merged.keys()].filter((name) => !existing.has(name))
console.log('existing bestiary:', existing.size, '| duplicates with existing:', duplicateNames.length, duplicateNames.join('、'))
console.log('new creatures:', fresh.length)

const problems = []
for (const [name, value] of merged) {
  for (const field of ['分类', '属性', '衍生', '战斗', '护甲', '理智损失']) {
    if (!(field in value)) problems.push(`${name}: missing ${field}`)
  }
  if (value['战斗'] && (typeof value['战斗'] !== 'object' || Array.isArray(value['战斗']))) {
    problems.push(`${name}: 战斗 is not an object`)
  }
}
console.log('structural problems:', problems.length)
for (const problem of problems.slice(0, 30)) console.log('  -', problem)

console.log('\nfirst fresh entry:', JSON.stringify({ [fresh[0]]: merged.get(fresh[0]) }, null, 1).slice(0, 900))
