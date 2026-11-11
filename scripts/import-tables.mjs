/**
 * Data importer for dsh-coc-kp.
 *
 * Converts the user-supplied rule data into typed modules under `src/data/`:
 * - 表.txt          → madness.ts (ti/li + 恐惧/躁狂 1D100), bestiary.ts, weapons.ts
 * - coc_spells.json → spells.ts
 *
 * It performs no rule invention: every entry is copied verbatim from the source
 * files. Run with: node scripts/import-tables.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(root, '表.txt'), 'utf8')

/** JSON.stringify one value as a TypeScript literal. */
const literal = (value) => JSON.stringify(value)

/**
 * Locate one madness table body: the segment after its `### ` heading, cut to
 * the balanced `{...}` object. The user-supplied file is pseudo-JSON (full-width
 * punctuation inside strings, and the last fence is missing), so braces are
 * counted instead of relying on the code fence.
 */
function tableBody(headingPrefix) {
  const segments = source.split(/^###\s+/m).slice(1)
  const segment = segments.find((item) => item.startsWith(headingPrefix))
  if (segment === undefined) throw new Error(`missing section: ${headingPrefix}`)
  const start = segment.indexOf('{')
  if (start < 0) throw new Error(`missing table object in section: ${headingPrefix}`)
  let depth = 0
  for (let index = start; index < segment.length; index += 1) {
    const char = segment[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return segment.slice(start, index + 1)
    }
  }
  throw new Error(`unbalanced table object in section: ${headingPrefix}`)
}

const sections = [
  { key: 'ti', body: tableBody('一、') },
  { key: 'li', body: tableBody('二、') },
  { key: 'fear', body: tableBody('三、') },
  { key: 'mania', body: tableBody('四、') },
]

/** Parse `1 名称：描述。` entries out of one pseudo-JSON table body. */
function parseEntries(body) {
  const entries = []
  const pattern = /(\d+)\s+([^：,，\n]+?)[：:]([\s\S]*?)。(?=\s*[,，\n}]|$)/g
  let match
  while ((match = pattern.exec(body)) !== null) {
    const roll = Number(match[1])
    const symptom = `${match[2].trim()}：${match[3].trim()}`
    entries.push({ roll, symptom })
  }
  const byRoll = new Map()
  for (const entry of entries) byRoll.set(entry.roll, entry)
  return [...byRoll.values()].sort((a, b) => a.roll - b.roll)
}

const tables = Object.fromEntries(sections.map((s) => [s.key, parseEntries(s.body)]))
for (const [key, entries] of Object.entries(tables)) {
  const expected = key === 'ti' || key === 'li' ? 10 : 100
  if (entries.length !== expected) throw new Error(`${key}: expected ${expected} entries, got ${entries.length}`)
  entries.forEach((entry, index) => {
    if (entry.roll !== index + 1) throw new Error(`${key}: roll sequence broken at ${entry.roll}`)
    if (!entry.symptom || entry.symptom.length < 4) throw new Error(`${key}: empty symptom at ${entry.roll}`)
  })
}

const madness = `/** Built-in CoC 7th madness dictionary.
 *
 * Data provenance: every symptom below is copied verbatim from the user-supplied
 * 表.txt (CoC 7e Chinese tables). 恐惧症状表 entries 70-100 are the completed
 * tail the user asked to keep for now; entries 1-69 are the official text.
 * This module only looks symptoms up; it never invents content.
 *
 * @module dsh-coc-kp/data/madness
 */

/** Tables exposed by the \`roll_madness\` tool. \`ti\` = 临时性疯狂, \`li\` = 长期性疯狂. */
export type MadnessTableType = 'ti' | 'li'

/** One row of a madness table. */
export interface MadnessEntry {
  /** 1-based roll value of this row. */
  roll: number
  /** Symptom text exactly as printed in the table. */
  symptom: string
}

/** \`ti\`: 疯狂发作-临时症状（1D10）; \`li\`: 疯狂发作-总结症状（1D10）. */
export const MADNESS_TABLES: Record<MadnessTableType, readonly MadnessEntry[]> = {
  ti: ${literal(tables.ti)},
  li: ${literal(tables.li)},
}

/** 恐惧症状表（1D100）. Used to resolve the fear branches of ti/li rows 8/9/10. */
export const FEAR_TABLE: readonly MadnessEntry[] = ${literal(tables.fear)}

/** 躁狂症状表（1D100）. Used to resolve the mania branches of ti/li rows 8/9/10. */
export const MANIA_TABLE: readonly MadnessEntry[] = ${literal(tables.mania)}

/** Uniform integer roll in 1..size, clamped away from the rng() === 1 edge. */
export function rollIndex(size: number, rng: () => number = Math.random): number {
  if (!Number.isInteger(size) || size < 1) throw new Error(\`无效的表长度: \${size}\`)
  const value = Math.floor(rng() * size) + 1
  return value < 1 ? 1 : value > size ? size : value
}

/** Draw one row from any table, returning the roll and its symptom. */
export function drawEntry(entries: readonly MadnessEntry[], rng: () => number = Math.random): MadnessEntry {
  if (entries.length === 0) throw new Error('疯狂表为空')
  const roll = rollIndex(entries.length, rng)
  const entry = entries.find((item) => item.roll === roll) ?? entries[0]
  return { roll: entry.roll, symptom: entry.symptom }
}

/** Draw one symptom from \`ti\` or \`li\`. */
export function rollMadness(table: MadnessTableType, rng: () => number = Math.random): { roll: number; symptom: string } {
  const entries = MADNESS_TABLES[table]
  if (entries === undefined) throw new Error(\`未知的疯狂表: \${table}\`)
  return drawEntry(entries, rng)
}

/** Draw one 恐惧症状 (1D100). */
export function rollFear(rng: () => number = Math.random): { roll: number; symptom: string } {
  return drawEntry(FEAR_TABLE, rng)
}

/** Draw one 躁狂症状 (1D100). */
export function rollMania(rng: () => number = Math.random): { roll: number; symptom: string } {
  return drawEntry(MANIA_TABLE, rng)
}
`

/** Extract every balanced top-level JSON object block from 表.txt. */
function jsonBlocks(text) {
  const blocks = []
  let depth = 0
  let current = ''
  let started = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!started && trimmed === '{') {
      started = true
      depth = 0
      current = ''
    }
    if (!started) continue
    current += `${line}\n`
    for (const char of line) {
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
    }
    if (depth === 0) {
      blocks.push(current)
      started = false
    }
  }
  return blocks
}

const parsedBlocks = []
for (const block of jsonBlocks(source)) {
  try {
    parsedBlocks.push(JSON.parse(block))
  } catch {
    // The madness tables are pseudo-JSON and are parsed by tableBody instead.
  }
}

const monsters = []
let weaponLibrary = null
for (const parsed of parsedBlocks) {
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '武器库') {
      weaponLibrary = value
      continue
    }
    if (value === null || typeof value !== 'object') continue
    monsters.push({ npc_name: key, data: value })
  }
}
if (monsters.length === 0) throw new Error('no monster blocks parsed from 表.txt')
if (weaponLibrary === null) throw new Error('no 武器库 block parsed from 表.txt')

/**
 * Optional extra bestiary files. Entries are added by name; a name that already
 * exists in 表.txt keeps the 表.txt record (the earlier, 7e-consistent source),
 * so a later export cannot silently overwrite the existing stat blocks.
 */
const EXTRA_BESTIARY_FILES = ['新怪物.json']
const extraMonsters = new Map()
for (const file of EXTRA_BESTIARY_FILES) {
  let text
  try {
    text = readFileSync(resolve(root, file), 'utf8')
  } catch {
    continue
  }
  let parsedBlocks = 0
  for (const block of jsonBlocks(text)) {
    let parsed
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    parsedBlocks += 1
    for (const [name, value] of Object.entries(parsed)) {
      if (value === null || typeof value !== 'object' || !('分类' in value)) continue
      if (!extraMonsters.has(name)) extraMonsters.set(name, value)
    }
  }
  console.log(`${file}: ${parsedBlocks} blocks, ${extraMonsters.size} distinct creatures so far`)
}

const tableMonsters = new Map(monsters.map((monster) => [monster.npc_name, monster]))

/**
 * Verified corrections. For these names the newer export carries broken stat
 * blocks (HP/MP/DB inconsistent with the 7e derived values, and 尼约格达 is a
 * copy of 暗之恶魔), so the 表.txt block — which satisfies HP=(CON+SIZ)/10,
 * MP=POW/5 and the STR+SIZ damage-bonus tier — wins instead. The newer file's
 * extra 咒文 / 特殊能力 note is kept when the 表.txt block has no such field.
 */
const CORRECTED_NAMES = ['加塔诺托亚', '尼约格达', '巴斯特', '诺登斯']
const corrections = new Map()
for (const name of CORRECTED_NAMES) {
  const tableData = tableMonsters.get(name)?.data
  if (tableData === undefined) continue
  const corrected = JSON.parse(JSON.stringify(tableData))
  const extraNote = extraMonsters.get(name)?.['咒文 / 特殊能力']
  if (typeof extraNote === 'string' && extraNote.trim().length > 0 && !('咒文 / 特殊能力' in corrected)) {
    corrected['咒文 / 特殊能力'] = extraNote
  }
  corrections.set(name, corrected)
}

const monsterMap = new Map(tableMonsters)
let extraAdded = 0
let extraReplaced = 0
for (const [name, data] of extraMonsters) {
  if (corrections.has(name)) {
    monsterMap.set(name, { npc_name: name, data: corrections.get(name) })
    extraReplaced += 1
    continue
  }
  if (monsterMap.has(name)) {
    // The newer export wins for duplicate names (user decision).
    monsterMap.set(name, { npc_name: name, data })
    extraReplaced += 1
    continue
  }
  monsterMap.set(name, { npc_name: name, data })
  extraAdded += 1
}
const mergedMonsters = [...monsterMap.values()]
if (extraAdded > 0 || extraReplaced > 0) {
  console.log(
    `extra files: +${extraAdded} new creatures, ${extraReplaced} duplicates replaced by 新怪物.json, ` +
      `${corrections.size} verified corrections kept from 表.txt`,
  )
}

const weapons = []
for (const [category, entries] of Object.entries(weaponLibrary)) {
  if (entries === null || typeof entries !== 'object') continue
  for (const [weaponName, entry] of Object.entries(entries)) {
    if (entry === null || typeof entry !== 'object') continue
    weapons.push({
      weapon_name: weaponName,
      category,
      skill: String(entry['技能'] ?? ''),
      damage: String(entry['伤害'] ?? ''),
      impale: entry['贯穿'] === true,
      base_range: String(entry['基础射程'] ?? ''),
      attacks_per_round: String(entry['每轮次数'] ?? ''),
      ammo: String(entry['装弹量'] ?? ''),
      malfunction: Number(entry['故障值'] ?? 100),
    })
  }
}
if (weapons.length === 0) throw new Error('no weapons parsed from 表.txt')
const weaponNames = new Set()
for (const weapon of weapons) {
  if (weaponNames.has(weapon.weapon_name)) throw new Error(`duplicate weapon name: ${weapon.weapon_name}`)
  weaponNames.add(weapon.weapon_name)
  if (!Number.isInteger(weapon.malfunction)) throw new Error(`bad 故障值: ${weapon.weapon_name}`)
}

const bestiary = `/** Built-in CoC 7th bestiary, copied verbatim from the user-supplied 表.txt.
 *
 * The data is seeded into \`NPC_Templates\` on first database initialization so
 * that \`manage_npc\` can instantiate a known creature by name. The full stat
 * block is preserved in the template's \`attributes\` JSON column; \`hp\`, \`mp\`,
 * \`db\` and \`build\` are extracted from 衍生 when a flat value exists.
 *
 * @module dsh-coc-kp/data/bestiary
 */

/** One bestiary creature: display name plus its complete stat block. */
export interface BestiaryMonster {
  /** Creature name used as the NPC template key. */
  npc_name: string
  /** Complete stat block exactly as supplied (分类/属性/衍生/战斗/护甲/理智损失...). */
  data: Readonly<Record<string, unknown>>
}

/** All built-in creature templates, in source order. */
export const BESTIARY: readonly BestiaryMonster[] = ${literal(mergedMonsters)}
`

const weaponsModule = `/** Built-in CoC 7th weapon library, copied verbatim from the user-supplied 表.txt.
 *
 * Seeded into the \`Weapons\` table on first database initialization and exposed
 * through the \`lookup_weapon\` tool.
 *
 * @module dsh-coc-kp/data/weapons
 */

/** One weapon entry of the 武器库. */
export interface WeaponEntry {
  weapon_name: string
  category: string
  skill: string
  damage: string
  impale: boolean
  base_range: string
  attacks_per_round: string
  ammo: string
  malfunction: number
}

/** All built-in weapons, in source order. */
export const WEAPONS: readonly WeaponEntry[] = ${literal(weapons)}
`

/** Read coc_spells.json (545 mechanically extracted spells) and emit a typed module. */
const spellsSource = JSON.parse(readFileSync(resolve(root, 'coc_spells.json'), 'utf8'))
if (!Array.isArray(spellsSource) || spellsSource.length === 0) throw new Error('coc_spells.json is not a non-empty array')
const spellNames = new Set()
const spells = spellsSource.map((spell) => {
  if (typeof spell.spell_name !== 'string' || spell.spell_name.length === 0) throw new Error('spell without spell_name')
  if (spellNames.has(spell.spell_name)) throw new Error(`duplicate spell name: ${spell.spell_name}`)
  spellNames.add(spell.spell_name)
  const cost = spell.cost ?? {}
  const rollMechanics = spell.roll_mechanics ?? {}
  const normalized = {
    spell_name: spell.spell_name,
    category: String(spell.category ?? ''),
    cost: {
      mp: String(cost.mp ?? ''),
      san: String(cost.san ?? ''),
      pow: String(cost.pow ?? ''),
    },
    casting_time: String(spell.casting_time ?? ''),
    roll_mechanics: {
      caster_check: String(rollMechanics.caster_check ?? ''),
      opposed: String(rollMechanics.opposed ?? ''),
    },
    effect_mechanics: Array.isArray(spell.effect_mechanics) ? spell.effect_mechanics.map(String) : [],
  }
  if (spell.manual_review_needed === true) normalized.manual_review_needed = true
  if (typeof spell.raw_text === 'string' && spell.raw_text.length > 0) normalized.raw_text = spell.raw_text
  return normalized
})

const spellsModule = `/** CoC 7th spell catalogue (545 mechanically extracted spells).
 *
 * Data provenance: generated verbatim from the user-supplied coc_spells.json
 * (mechanism-only extraction). \`manual_review_needed\` marks entries the
 * extractor could not fully resolve; the tool returns the flag with the spell.
 * No spell mechanics are invented here.
 *
 * @module dsh-coc-kp/data/spells
 */

/** Cost block of one spell. */
export interface SpellCost {
  mp: string
  san: string
  pow: string
}

/** Roll mechanics of one spell. */
export interface SpellRollMechanics {
  caster_check: string
  opposed: string
}

/** One spell of the catalogue. */
export interface SpellEntry {
  spell_name: string
  category: string
  cost: SpellCost
  casting_time: string
  roll_mechanics: SpellRollMechanics
  effect_mechanics: readonly string[]
  /** Present only when the extractor flagged a manual review. */
  manual_review_needed?: true
  /** Untranslated / ambiguous source snippet, when supplied. */
  raw_text?: string
}

/** All spells, in source order. */
export const SPELLS: readonly SpellEntry[] = ${literal(spells)}
`

mkdirSync(resolve(root, 'src/data'), { recursive: true })
writeFileSync(resolve(root, 'src/data/madness.ts'), madness, 'utf8')
writeFileSync(resolve(root, 'src/data/bestiary.ts'), bestiary, 'utf8')
writeFileSync(resolve(root, 'src/data/weapons.ts'), weaponsModule, 'utf8')
writeFileSync(resolve(root, 'src/data/spells.ts'), spellsModule, 'utf8')

console.log(`madness.ts: ti=${tables.ti.length} li=${tables.li.length} fear=${tables.fear.length} mania=${tables.mania.length}`)
console.log(`bestiary.ts: ${mergedMonsters.length} creatures (表.txt ${monsters.length} + extra ${extraAdded}; ${extraReplaced} duplicates replaced; ${corrections.size} verified corrections)`)
console.log(`weapons.ts: ${weapons.length} weapons in ${new Set(weapons.map((weapon) => weapon.category)).size} categories`)
console.log(`spells.ts: ${spells.length} spells, ${spells.filter((spell) => spell.manual_review_needed === true).length} flagged for manual review`)
