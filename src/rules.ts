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
