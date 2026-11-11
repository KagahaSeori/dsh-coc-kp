/**
 * CoC 7th edition core dice rules.
 *
 * Everything here is a pure function with an injectable random source
 * (`rng: () => number` in [0, 1)), so the rules can be unit-tested without
 * database access, a Cordis context, or the model. The plugin's tool layer
 * (`src/index.ts`) only wires these results into JSON and persists state.
 *
 * @module dsh-coc-kp/rules
 */

/** Random source: returns a number in [0, 1). */
export type Rng = () => number

/** CoC 7e success tiers, using the wording of the task book. */
export type SuccessLevel = '大成功' | '极难' | '困难' | '成功' | '失败' | '大失败'

/**
 * How a fumble (大失败) is decided.
 *
 * - `auto`     — CoC 7e as written: skill >= 50 fumbles only on 100, below 50 on 96-100.
 * - `96-100`   — 96-100 is always a fumble.
 * - `only-100` — only 100 is ever a fumble.
 *
 * The default is `auto`; the plugin Config exposes it so a table can house-rule it.
 */
export type FumbleRule = 'auto' | '96-100' | 'only-100'

/** Result of `roll_check`. */
export interface CheckResult {
  /** Every tens die that was rolled, as face values 0, 10, ..., 90. */
  tens_rolls: number[]
  /** The ones die, 0-9. */
  ones_roll: number
  /** Final percentile value, 1-100. */
  final_result: number
  /** CoC 7e success tier. */
  success_level: SuccessLevel
  /** Whether the roll counts as a success (大成功/极难/困难/成功). */
  is_success: boolean
}

/** Result of `push_roll`. */
export interface PushRollResult {
  roll: number
  target: number
  result: '大成功' | '大失败'
}

/** Result of `skill_growth`. */
export interface SkillGrowthResult {
  success: boolean
  growth: number
  new_value: number
}

/** A parsed dice expression such as `1d6`, `2d10+3` or the plain number `0`. */
export interface DiceExpression {
  count: number
  sides: number
  modifier: number
}

/** True when `rng()` returns an unusable value; used to fail loudly instead of silently skewing. */
function draw(rng: Rng): number {
  const value = rng()
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`随机源返回了非法值: ${String(value)}`)
  }
  return value
}

/** Roll one die with `sides` faces (1-based result). */
export function rollDie(sides: number, rng: Rng = Math.random): number {
  if (!Number.isInteger(sides) || sides < 1) throw new Error(`无效的骰子面数: ${sides}`)
  return Math.floor(draw(rng) * sides) + 1
}

/** Roll `count` dice with `sides` faces each. */
export function rollDice(count: number, sides: number, rng: Rng = Math.random): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`无效的骰子数量: ${count}`)
  return Array.from({ length: count }, () => rollDie(sides, rng))
}

/** Roll a percentile die: 1-100, where tens 0 + ones 0 reads as 100. */
export function rollD100(rng: Rng = Math.random): number {
  const tens = (rollDie(10, rng) - 1) * 10
  const ones = rollDie(10, rng) - 1
  return tens + ones === 0 ? 100 : tens + ones
}

/** Validate a non-negative integer option; throws a readable error otherwise. */
function requireNonNegativeInt(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数: ${String(value)}`)
  }
  return value
}

/** Decide whether a roll is a fumble under the configured rule. */
export function isFumble(target: number, roll: number, fumbleRule: FumbleRule = 'auto'): boolean {
  if (fumbleRule === '96-100') return roll >= 96
  if (fumbleRule === 'only-100') return roll === 100
  return target >= 50 ? roll === 100 : roll >= 96
}

/**
 * Classify one percentile roll against a target.
 *
 * Order: 1-5 大成功 → fumble → ≤target/5 极难 → ≤target/2 困难 → ≤target 成功 → 失败.
 */
export function classifyRoll(
  target: number,
  roll: number,
  fumbleRule: FumbleRule = 'auto',
): { success_level: SuccessLevel; is_success: boolean } {
  if (roll >= 1 && roll <= 5) return { success_level: '大成功', is_success: true }
  if (isFumble(target, roll, fumbleRule)) return { success_level: '大失败', is_success: false }
  if (roll <= Math.floor(target / 5)) return { success_level: '极难', is_success: true }
  if (roll <= Math.floor(target / 2)) return { success_level: '困难', is_success: true }
  if (roll <= target) return { success_level: '成功', is_success: true }
  return { success_level: '失败', is_success: false }
}

/**
 * CoC 7e `roll_check`: one ones die plus 1+|bonus−penalty| tens dice; a bonus
 * takes the lowest tens value, a penalty the highest.
 */
export function resolveCheck(
  target: number,
  bonusDice = 0,
  penaltyDice = 0,
  fumbleRule: FumbleRule = 'auto',
  rng: Rng = Math.random,
): CheckResult {
  if (!Number.isFinite(target)) throw new Error(`无效的目标值: ${String(target)}`)
  const skill = Math.trunc(target)
  if (skill < 0) throw new Error(`目标值不能为负数: ${target}`)
  const bonus = requireNonNegativeInt(bonusDice, '奖励骰数量')
  const penalty = requireNonNegativeInt(penaltyDice, '惩罚骰数量')

  const net = bonus - penalty
  const tensFaces = rollDice(1 + Math.abs(net), 10, rng).map((face) => (face - 1) * 10)
  const onesRoll = rollDie(10, rng) - 1
  const selectedTens = net > 0 ? Math.min(...tensFaces) : net < 0 ? Math.max(...tensFaces) : tensFaces[0]
  const sum = selectedTens + onesRoll
  const finalResult = sum === 0 ? 100 : sum
  const { success_level, is_success } = classifyRoll(skill, finalResult, fumbleRule)

  return {
    tens_rolls: tensFaces,
    ones_roll: onesRoll,
    final_result: finalResult,
    success_level,
    is_success,
  }
}

/**
 * House-rule `push_roll` (孤注一掷): target is `min(skill, 50)`, one d100 is
 * rolled, and the result is a binary 大成功 (≤ target) or 大失败.
 */
export function resolvePushRoll(skillValue: number, rng: Rng = Math.random): PushRollResult {
  if (!Number.isFinite(skillValue)) throw new Error(`无效的技能值: ${String(skillValue)}`)
  const target = Math.min(Math.max(0, Math.trunc(skillValue)), 50)
  const roll = rollD100(rng)
  return { roll, target, result: roll <= target ? '大成功' : '大失败' }
}

/**
 * Official skill growth: roll d100; only a roll greater than the current value
 * earns 1d10 growth. Returns the new value for the caller to persist.
 */
export function resolveSkillGrowth(currentValue: number, rng: Rng = Math.random): SkillGrowthResult {
  if (!Number.isFinite(currentValue)) throw new Error(`无效的技能值: ${String(currentValue)}`)
  const current = Math.max(0, Math.trunc(currentValue))
  const roll = rollD100(rng)
  if (roll > current) {
    const growth = rollDie(10, rng)
    return { success: true, growth, new_value: current + growth }
  }
  return { success: false, growth: 0, new_value: current }
}

/**
 * Parse a sanity-loss expression: `1d6`, `1d10`, `2d6`, `1d6+1`, `d6`, or a
 * plain non-negative number such as `0` or `3`. Returns null when unparseable.
 */
export function parseDiceExpression(expression: string): DiceExpression | null {
  const text = String(expression ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (text.length === 0) return null
  if (/^\d+$/.test(text)) return { count: 0, sides: 0, modifier: Number(text) }
  const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(text)
  if (match === null) return null
  const count = match[1] === '' ? 1 : Number(match[1])
  const sides = Number(match[2])
  const modifier = match[3] === undefined ? 0 : Number(match[3])
  if (!Number.isInteger(count) || count < 1 || count > 100) return null
  if (!Number.isInteger(sides) || sides < 1) return null
  return { count, sides, modifier }
}

/**
 * Roll a dice expression such as `1d6` / `1d10+1`; a plain number is returned
 * as-is. The total is clamped at 0. Throws for an unparseable expression.
 */
export function rollExpression(expression: string, rng: Rng = Math.random): number {
  const parsed = parseDiceExpression(expression)
  if (parsed === null) throw new Error(`无法解析骰子表达式: ${String(expression)}`)
  if (parsed.count === 0) return Math.max(0, parsed.modifier)
  const total = rollDice(parsed.count, parsed.sides, rng).reduce((sum, value) => sum + value, 0)
  return Math.max(0, total + parsed.modifier)
}

/** One rolled term of a general dice notation. */
export interface DiceRollDetail {
  /** Notation of this term, e.g. `1D6`, `+2` or a DB-expanded `1D4`. */
  term: string
  /** Individual die faces (empty for a constant term). */
  values: number[]
  /** Signed contribution of this term to the total. */
  subtotal: number
}

/** Result of {@link rollDiceNotation}. */
export interface DiceNotationResult {
  /** Original expression as supplied. */
  expression: string
  /** Expression after `DB` substitution, e.g. `1D6+1D4+2`. */
  resolved_expression: string
  /** The DB expression that was substituted, or null when none was needed. */
  db: string | null
  /** Sum of every term (may be negative when a DB penalty applies). */
  total: number
  /** Per-term detail so the caller can show every die face. */
  rolls: DiceRollDetail[]
}

/** One parsed term of a general dice notation. */
interface ParsedNotationTerm {
  sign: 1 | -1
  label: string
  kind: 'dice' | 'constant' | 'db'
  count: number
  sides: number
  value: number
}

/** First integer inside a characteristic value such as `60` or `5D6 (17-18)`. */
function firstNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string') return null
  const match = /-?\d+/.exec(value.replace(/,/g, ''))
  return match === null ? null : Number(match[0])
}

/** Normalize notation: trim spaces, unify full-width and minus characters. */
function normalizeNotation(expression: string): string {
  return String(expression ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/＋/g, '+')
    .replace(/[−–—]/g, '-')
}

/** Split a notation into signed tokens (`+1D6`, `-2`, `DB`, ...). */
function splitNotationTerms(text: string, original: string): Array<{ sign: 1 | -1; token: string }> {
  if (text.length === 0) throw new Error(`无法解析骰子表达式: ${original}`)
  const terms: Array<{ sign: 1 | -1; token: string }> = []
  let index = 0
  while (index < text.length) {
    let sign: 1 | -1 = 1
    const char = text[index]
    if (char === '+') index += 1
    else if (char === '-') {
      sign = -1
      index += 1
    }
    let end = index
    while (end < text.length && text[end] !== '+' && text[end] !== '-') end += 1
    const token = text.slice(index, end)
    if (token.length === 0) throw new Error(`无法解析骰子表达式: ${original}`)
    terms.push({ sign, token })
    index = end
  }
  return terms
}

/** Parse one token; `DB` stays a placeholder until the caller supplies its expression. */
function parseNotationToken(token: string, sign: 1 | -1, original: string): ParsedNotationTerm {
  const dice = /^(\d*)D(\d+)$/.exec(token)
  if (dice !== null) {
    const count = dice[1] === '' ? 1 : Number(dice[1])
    const sides = Number(dice[2])
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error(`骰子数量越界: ${token}`)
    if (!Number.isInteger(sides) || sides < 2 || sides > 1000) throw new Error(`骰子面数越界: ${token}`)
    return { sign, label: `${count}D${sides}`, kind: 'dice', count, sides, value: 0 }
  }
  if (/^\d+$/.test(token)) {
    return { sign, label: token, kind: 'constant', count: 0, sides: 0, value: Number(token) }
  }
  if (token === 'DB') return { sign, label: 'DB', kind: 'db', count: 0, sides: 0, value: 0 }
  throw new Error(`无法解析骰子项: ${token}（表达式: ${original}）`)
}

/** The CoC 7e damage-bonus tiers for a STR+SIZ total. */
export function damageBonusFor(strPlusSiz: number): string {
  if (!Number.isFinite(strPlusSiz)) throw new Error(`无效的 STR+SIZ: ${String(strPlusSiz)}`)
  const total = Math.trunc(strPlusSiz)
  if (total < 0) throw new Error(`STR+SIZ 不能为负数: ${strPlusSiz}`)
  if (total <= 64) return '-2'
  if (total <= 84) return '-1'
  if (total <= 124) return '0'
  const dice = Math.min(20, Math.floor((total - 125) / 80) + 1)
  return `+${dice}D6`
}

/** Damage bonus derived from a character sheet's STR and SIZ, or null when unknown. */
export function damageBonusForAttributes(attributes: Readonly<Record<string, unknown>>): string | null {
  const str = firstNumericValue(attributes['STR'])
  const siz = firstNumericValue(attributes['SIZ'])
  if (str === null || siz === null) return null
  return damageBonusFor(str + siz)
}

/**
 * Roll a general CoC dice notation: multiple terms (`1D6+1D10+2`), optional
 * `DB` substitution (`1D6+DB` with `db: '1D4'`), and full per-term detail.
 */
export function rollDiceNotation(
  expression: string,
  options: { db?: string; rng?: Rng } = {},
): DiceNotationResult {
  const source = String(expression ?? '').trim()
  if (source.length === 0) throw new Error('骰子表达式不能为空')
  const parsed = splitNotationTerms(normalizeNotation(source), source).map((term) =>
    parseNotationToken(term.token, term.sign, source),
  )
  const dbTerms = parsed.filter((term) => term.kind === 'db')
  if (dbTerms.length > 1) throw new Error('DB 只能出现一次')
  let dbExpression: string | null = null
  let terms = parsed
  if (dbTerms.length === 1) {
    const dbText = String(options.db ?? '').trim()
    if (dbText.length === 0) throw new Error('表达式包含 DB，但未提供 DB 值（db 参数或角色属性）')
    dbExpression = dbText
    const expanded = splitNotationTerms(normalizeNotation(dbText), dbText).map((term) =>
      parseNotationToken(term.token, term.sign, dbText),
    )
    terms = parsed.flatMap((term) =>
      term.kind === 'db'
        ? expanded.map((inner) => ({ ...inner, sign: (term.sign * inner.sign) as 1 | -1 }))
        : [term],
    )
  }

  const rng = options.rng ?? Math.random
  const rolls: DiceRollDetail[] = []
  let total = 0
  for (const term of terms) {
    if (term.kind === 'dice') {
      const values = rollDice(term.count, term.sides, rng)
      const subtotal = term.sign * values.reduce((sum, value) => sum + value, 0)
      total += subtotal
      rolls.push({ term: term.label, values, subtotal })
    } else {
      const subtotal = term.sign * term.value
      total += subtotal
      rolls.push({ term: term.label, values: [], subtotal })
    }
  }

  const resolved = terms
    .map((term, index) => `${index === 0 ? (term.sign === 1 ? '' : '-') : term.sign === 1 ? '+' : '-'}${term.label}`)
    .join('')
  return { expression: source, resolved_expression: resolved, db: dbExpression, total, rolls }
}

/** Parsed armor information of one bestiary template. */
export interface ArmorInfo {
  /** Damage reduction points; 0 when the template has no numeric armor. */
  armor: number
  /** True when the template text says physical attacks do not harm it. */
  immunePhysical: boolean
}

/** Parse a 护甲 string such as `2点(毛发与厚皮)` or `21点，包括...`. */
export function parseArmorText(text: string | null | undefined): ArmorInfo {
  const raw = String(text ?? '').trim()
  if (raw.length === 0) return { armor: 0, immunePhysical: false }
  const immunePhysical = /免疫[^；;。]*物理|物理[^；;。]*(免疫|无效)|无实体/.test(raw)
  const match = /(\d+)/.exec(raw.replace(/,/g, ''))
  const armor = match === null ? 0 : Number(match[1])
  return { armor: immunePhysical ? 0 : armor, immunePhysical }
}

/** CoC health states used by `apply_damage`. */
export type HealthStatus = '正常' | '重伤' | '濒死' | '死亡'

/** CoC health state for one HP pair (0 HP is dying, death at -max HP). */
export function healthStatus(hp: number, maxHp: number): HealthStatus {
  const maximum = Math.max(1, Math.trunc(maxHp))
  if (hp <= -maximum) return '死亡'
  if (hp <= 0) return '濒死'
  if (hp <= Math.floor(maximum / 2)) return '重伤'
  return '正常'
}
