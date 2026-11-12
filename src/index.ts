/**
 * `dsh-coc-kp` — a pure-backend CoC 7th edition Keeper (KP) tool plugin.
 *
 * Every tool's `execute` returns only the JSON object declared by its output
 * schema; narration stays with the calling AI. Database failures, missing
 * characters and unparseable expressions are caught and returned as
 * `{ "error": "..." }`, never as a thrown error or Markdown text.
 *
 * The database lives in `data.db` next to this package (override with
 * `DSH_COC_KP_DB`). Rule details come from the task book and the user-supplied
 * 表.txt; see README.md for the documented assumptions.
 *
 * @module dsh-coc-kp
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  MADNESS_TABLES,
  rollFear,
  rollMadness,
  rollMania,
} from './data/madness.js'
import type { FumbleRule } from './rules.js'
import {
  damageBonusForAttributes,
  healthStatus,
  parseArmorText,
  rollDiceNotation,
  rollDie,
  rollExpression,
  resolveCheck,
  resolvePushRoll,
  resolveSkillGrowth,
} from './rules.js'
import {
  createCharacter,
  createNpcInstance,
  createNpcTemplate,
  deleteCharacter,
  getActiveCharacterName,
  getCharacter,
  getNpcInstance,
  getNpcTemplate,
  getSpell,
  getWeapon,
  listGroupCharacters,
  listWeapons,
  searchNpcTemplates,
  searchSpells,
  searchWeapons,
  setActiveCharacter,
  setCharacterHp,
  setCharacterSan,
  setCharacterSkill,
  setCharacterTags,
  updateCharacter,
  updateNpcInstanceHp,
} from './db.js'
import type { CharacterPatch, NpcTemplateRecord, SpellRecord, WeaponRecord } from './db.js'
import { loadLocalKpConfig } from './config.js'
import type { LocalKpConfig } from './config.js'

/** Plugin name shown in logs. */
export const name = 'dsh-coc-kp'

/** The plugin only needs the tool registry. */
export const inject = ['tools']

/**
 * Runtime configuration. `fumble_rule` makes the 大失败 threshold configurable:
 * the CoC 7e default is skill >= 50 → only 100 fumbles, below 50 → 96-100.
 */
export const Config = Schema.object({
  fumble_rule: Schema.union([
    Schema.const('auto').description('官方规则：技能≥50 时只有 100 大失败，<50 时 96-100 大失败'),
    Schema.const('96-100').description('无论技能值，96-100 都是大失败'),
    Schema.const('only-100').description('无论技能值，只有 100 是大失败'),
  ])
    .default('auto')
    .description('大失败判定规则'),
  kp_qq_id: Schema.string()
    .default('')
    .description('KP 的 QQ 号（推荐写在本地 kp.config.json，此处留空即可）'),
  kp_nickname: Schema.string()
    .default('')
    .description('KP 的群昵称（推荐写在本地 kp.config.json 的 kp_nickname）'),
})

/** Inferred shape of {@link Config}. */
export interface PluginConfig {
  fumble_rule: FumbleRule
  kp_qq_id: string
  kp_nickname: string
}

/** Turn any thrown value into a readable message for the `{ error }` result. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Wrap a possibly-throwing handler so every tool returns JSON instead of throwing. */
function guard<T>(handler: () => T): T | { error: string } {
  try {
    return handler()
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

/**
 * Cast a value that is already lossless JSON (it came from `JSON.parse` or a
 * tool argument validated against the `json` schema node) to the schema's
 * inferred output type. TypeScript cannot express `JsonValue` here without a
 * dependency on the host's util package, so the cast is explicit and local.
 */
function jsonValue(value: unknown): never {
  return value as never
}

/** The render function shared by every tool: canonical JSON as text. */
const renderJson = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [
  { type: 'text', text: JSON.stringify(value) },
]

/** The `{ error: string }` output branch shared by every tool. */
const ERROR_FIELDS = {
  error: { type: 'string', required: true, description: '错误信息' },
} as const

/**
 * Models sometimes send a JSON value as a string (`"{\"闪避\": 25}"`). Decode
 * those before shape validation so a wrong-but-parseable argument yields a
 * readable `{ error }` instead of a pipeline `INVALID_ARGS` rejection.
 */
function decodeJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

/** Validate that a tool argument is a JSON object and return it as a plain record. */
function plainRecord(value: unknown, label: string): Record<string, unknown> {
  const decoded = decodeJsonString(value)
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error(`${label} 必须是 JSON 对象（例如 {"侦查": 60}）`)
  }
  return decoded as Record<string, unknown>
}

/** Validate that a tool argument is a `{ name: number }` map. */
function numberRecord(value: unknown, label: string): Record<string, number> {
  const record = plainRecord(value, label)
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(record)) {
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (!Number.isFinite(number)) throw new Error(`${label}.${key} 必须是数字（收到: ${JSON.stringify(raw)}）`)
    result[key] = number
  }
  return result
}

/** Coerce a number argument that may arrive as a numeric string (`"10"`). */
function toNumber(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`${label} 必须是数字（收到: ${JSON.stringify(value)}）`)
}

/** Optional variant of {@link toNumber}. */
function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return toNumber(value, label)
}

/** Accept an array of tags, or a comma/space separated string. */
function stringList(value: unknown, label: string): string[] {
  const decoded = decodeJsonString(value)
  const items = Array.isArray(decoded)
    ? decoded
    : typeof decoded === 'string'
      ? decoded.split(/[,，、;；\s]+/)
      : null
  if (items === null) throw new Error(`${label} 必须是字符串数组（收到: ${JSON.stringify(value)}）`)
  return items.map((item) => String(item).trim()).filter((item) => item.length > 0)
}

/** Validate a non-empty string argument. */
function requireText(value: string | undefined, label: string): string {
  const text = (value ?? '').trim()
  if (text.length === 0) throw new Error(`${label} 不能为空`)
  return text
}

/**
 * The effective KP QQ id. Precedence: local `kp.config.json` → plugin config →
 * `KP_QQ_ID` environment variable. The local file keeps a personal QQ number out
 * of the repository.
 */
function kpQqId(config: PluginConfig, local: LocalKpConfig): string {
  const fromLocal = (local.kp_qq_id ?? '').trim()
  if (fromLocal.length > 0) return fromLocal
  const fromConfig = (config.kp_qq_id ?? '').trim()
  if (fromConfig.length > 0) return fromConfig
  return (process.env.KP_QQ_ID ?? '').trim()
}

/** The keeper's in-group nickname, local file first, plugin config second. */
function kpNickname(config: PluginConfig, local: LocalKpConfig): string {
  const fromLocal = (local.kp_nickname ?? '').trim()
  if (fromLocal.length > 0) return fromLocal
  return (config.kp_nickname ?? '').trim()
}

/** Register every tool on the calling context. */
export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const pluginConfig: PluginConfig = {
    fumble_rule: config?.fumble_rule ?? 'auto',
    kp_qq_id: config?.kp_qq_id ?? '',
    kp_nickname: config?.kp_nickname ?? '',
  }
  const localKp = loadLocalKpConfig()
  const keeperQqId = kpQqId(pluginConfig, localKp)
  const keeperNickname = kpNickname(pluginConfig, localKp)
  const keeperHint = keeperNickname.length > 0 ? `（群内 KP：${keeperNickname}）` : ''

  // 1. roll_check — CoC 7e skill/attribute check with bonus/penalty dice.
  ctx.tools.register(
    defineTool({
      name: 'roll_check',
      description:
        'CoC 7版技能/属性判定。投 1 个骰子作为个位、1+N 个骰子作为十位（奖励骰取最低十位，惩罚骰取最高十位）。' +
        '返回纯 JSON：tens_rolls(十位骰面值数组)、ones_roll(个位)、final_result(1-100)、success_level(大成功/极难/困难/成功/失败/大失败)、is_success。',
      parameters: {
        target: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          required: true,
          description: '技能或属性值（非负整数，可传 "60" 这类数字字符串）',
        },
        bonus_dice: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '奖励骰数量，默认 0' },
        penalty_dice: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '惩罚骰数量，默认 0' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                tens_rolls: {
                  type: 'array',
                  required: true,
                  items: { type: 'integer' },
                  description: '掷出的十位骰面值（0,10,...,90）',
                },
                ones_roll: { type: 'integer', required: true, description: '个位骰面值（0-9）' },
                final_result: { type: 'integer', required: true, description: '最终 D100 结果（1-100）' },
                success_level: {
                  type: 'string',
                  required: true,
                  enum: ['大成功', '极难', '困难', '成功', '失败', '大失败'],
                  description: '成功等级',
                },
                is_success: { type: 'boolean', required: true, description: '是否成功' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() =>
          resolveCheck(
            toNumber(args.target, 'target'),
            args.bonus_dice === undefined ? 0 : toNumber(args.bonus_dice, 'bonus_dice'),
            args.penalty_dice === undefined ? 0 : toNumber(args.penalty_dice, 'penalty_dice'),
            pluginConfig.fumble_rule,
          ),
        )
      },
    }),
  )

  // 2. roll_dice — general dice notation (CoC damage, multi-term, DB substitution).
  ctx.tools.register(
    defineTool({
      name: 'roll_dice',
      description:
        '通用骰子表达式解析（CoC 伤害/任意骰点）：支持 NdM 与多项相加（如 1D6+1D10+2、2D6-1），支持 DB 伤害加值代入——' +
        '表达式写 DB，并传 db="1D4"；或传 char_name 让插件按角色 STR+SIZ 计算 DB。' +
        '返回纯 JSON：{ expression, resolved_expression, db, total, rolls }，rolls 含每个骰子的点数明细。',
      parameters: {
        expression: { type: 'string', required: true, description: '骰子表达式，如 1D6+1D10+2、1D10+DB、2D6-1' },
        db: { type: 'string', description: 'DB 伤害加值表达式，如 "1D4"、"+2"、"-1"；表达式含 DB 时使用' },
        char_name: { type: 'string', description: '可选：按该角色的 STR+SIZ 自动计算 DB（未传 db 时生效）' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                expression: { type: 'string', required: true, description: '原始表达式' },
                resolved_expression: { type: 'string', required: true, description: '代入 DB 后的表达式' },
                db: { type: 'string', required: true, description: '代入的 DB 表达式；未使用 DB 时为空字符串' },
                total: { type: 'integer', required: true, description: '总点数' },
                rolls: {
                  type: 'array',
                  required: true,
                  description: '每一项骰子/常量的明细',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      term: { type: 'string', required: true, description: '项表达式，如 1D6' },
                      values: { type: 'array', required: true, items: { type: 'integer' }, description: '每个骰子的点数' },
                      subtotal: { type: 'integer', required: true, description: '该项带符号小计' },
                    },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const expression = requireText(args.expression, 'expression')
          const dbParam = (args.db ?? '').trim()
          const needsDb = /(^|[+\-])DB([+\-]|$)/i.test(expression.replace(/\s+/g, ''))
          let dbExpression = dbParam
          if (needsDb && dbExpression.length === 0) {
            const charName = (args.char_name ?? '').trim()
            if (charName.length === 0) {
              throw new Error('表达式包含 DB，需要 db 参数（如 "1D4"）或 char_name（按角色 STR+SIZ 计算）')
            }
            const character = getCharacter(charName)
            if (character === null) throw new Error(`角色不存在: ${charName}`)
            const computed = damageBonusForAttributes(character.attributes)
            if (computed === null) throw new Error(`角色 ${charName} 缺少 STR/SIZ，无法计算 DB`)
            dbExpression = computed
          }
          const result = rollDiceNotation(expression, { db: dbExpression.length > 0 ? dbExpression : undefined })
          return {
            expression: result.expression,
            resolved_expression: result.resolved_expression,
            db: result.db ?? '',
            total: result.total,
            rolls: result.rolls,
          }
        })
      },
    }),
  )

  // 3. push_roll — house rule "孤注一掷".
  ctx.tools.register(
    defineTool({
      name: 'push_roll',
      description:
        '村规·孤注一掷：target = min(技能值, 50)，投 1D100，≤target 为大成功，否则大失败。' +
        '返回纯 JSON：{ roll, target, result }。',
      parameters: {
        skill_value: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          required: true,
          description: '技能值（非负整数，可传数字字符串）',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                roll: { type: 'integer', required: true, description: 'D100 结果（1-100）' },
                target: { type: 'integer', required: true, description: 'min(技能值, 50)' },
                result: { type: 'string', required: true, enum: ['大成功', '大失败'], description: '判定结果' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => resolvePushRoll(toNumber(args.skill_value, 'skill_value')))
      },
    }),
  )

  // 4. sanity_check — SAN check, applies and persists the loss.
  ctx.tools.register(
    defineTool({
      name: 'sanity_check',
      description:
        '理智检定：读取角色 SAN，投 1D100，≤SAN 为成功。成功扣 success_loss、失败扣 fail_loss（支持 1d6、2d10、1d6+1、纯数字如 0/3），' +
        '更新数据库并返回纯 JSON：{ roll, is_success, san_loss, current_san }。',
      parameters: {
        char_name: { type: 'string', required: true, description: '角色名' },
        success_loss: { type: 'string', required: true, description: '成功时的理智损失表达式，如 0 或 1d6' },
        fail_loss: { type: 'string', required: true, description: '失败时的理智损失表达式，如 1d6 或 1d10' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                roll: { type: 'integer', required: true, description: 'D100 结果' },
                is_success: { type: 'boolean', required: true, description: '是否通过理智检定' },
                san_loss: { type: 'integer', required: true, description: '实际扣除的 SAN 值' },
                current_san: { type: 'integer', required: true, description: '扣除后的 SAN' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const character = getCharacter(args.char_name)
          if (character === null) throw new Error(`角色不存在: ${args.char_name}`)
          const roll = rollDie(100)
          const isSuccess = roll <= character.san
          const expression = isSuccess ? args.success_loss : args.fail_loss
          const rolledLoss = rollExpression(expression)
          const sanLoss = Math.min(rolledLoss, character.san)
          const updated = setCharacterSan(character.char_name, character.san - sanLoss)
          return {
            roll,
            is_success: isSuccess,
            san_loss: sanLoss,
            current_san: updated.san,
          }
        })
      },
    }),
  )

  // 5. roll_madness — draw a symptom from the built-in madness dictionary.
  ctx.tools.register(
    defineTool({
      name: 'roll_madness',
      description:
        '疯狂表查表：table_type 为 ti（临时性疯狂·即时症状 1D10）或 li（长期性疯狂·总结症状 1D10）。' +
        '抽到恐惧或躁狂条目时，会按表内说明用内置 1D100 恐惧/躁狂表补抽具体症状并附在 symptom 中。' +
        '返回纯 JSON：{ roll, symptom }。',
      parameters: {
        table_type: {
          type: 'string',
          required: true,
          enum: ['ti', 'li'],
          description: 'ti = 临时性疯狂；li = 长期性疯狂',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                roll: { type: 'integer', required: true, description: '表内骰值（1-10）' },
                symptom: { type: 'string', required: true, description: '症状文本（含自动补抽的恐惧/躁狂结果）' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          if (!(args.table_type in MADNESS_TABLES)) throw new Error(`未知的疯狂表: ${args.table_type}`)
          const draw = rollMadness(args.table_type)
          let symptom = draw.symptom
          // The table itself says which 1D100 table resolves a 恐惧 / 躁狂 row.
          if (symptom.startsWith('恐惧')) {
            const fear = rollFear()
            symptom += `（恐惧症状 1D100=${fear.roll}：${fear.symptom}）`
          } else if (symptom.startsWith('躁狂')) {
            const mania = rollMania()
            symptom += `（躁狂症状 1D100=${mania.roll}：${mania.symptom}）`
          }
          return { roll: draw.roll, symptom }
        })
      },
    }),
  )

  // 6. skill_growth — official CoC 7e skill improvement.
  ctx.tools.register(
    defineTool({
      name: 'skill_growth',
      description:
        '官方技能成长：读取角色指定技能值，投 1D100；大于当前值则加 1D10 并写回数据库。' +
        '返回纯 JSON：{ success, growth, new_value }。',
      parameters: {
        char_name: { type: 'string', required: true, description: '角色名' },
        skill_name: { type: 'string', required: true, description: '技能名，如 侦查、图书馆使用' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                success: { type: 'boolean', required: true, description: '是否成长' },
                growth: { type: 'integer', required: true, description: '本次成长值（未成长为 0）' },
                new_value: { type: 'integer', required: true, description: '成长后的技能值' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const character = getCharacter(args.char_name)
          if (character === null) throw new Error(`角色不存在: ${args.char_name}`)
          const current = character.skills[args.skill_name]
          if (current === undefined) throw new Error(`角色 ${args.char_name} 没有技能: ${args.skill_name}`)
          const result = resolveSkillGrowth(current)
          if (result.success) setCharacterSkill(character.char_name, args.skill_name, result.new_value)
          return result
        })
      },
    }),
  )

  // 7. manage_tags — add/remove a "death flag" tag.
  ctx.tools.register(
    defineTool({
      name: 'manage_tags',
      description:
        '代死标签管理：为角色添加或移除标签并写回数据库。' +
        '返回纯 JSON：{ updated_tags: string[] }。',
      parameters: {
        char_name: { type: 'string', required: true, description: '角色名' },
        action: { type: 'string', required: true, enum: ['add', 'remove'], description: 'add 添加、remove 移除' },
        tag_name: { type: 'string', required: true, description: '标签名' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                updated_tags: {
                  type: 'array',
                  required: true,
                  items: { type: 'string' },
                  description: '更新后的完整标签列表',
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const character = getCharacter(args.char_name)
          if (character === null) throw new Error(`角色不存在: ${args.char_name}`)
          const tagName = requireText(args.tag_name, '标签名')
          const tags = new Set(character.tags)
          if (args.action === 'add') tags.add(tagName)
          else tags.delete(tagName)
          const updated = setCharacterTags(character.char_name, [...tags])
          return { updated_tags: updated }
        })
      },
    }),
  )

  // 8. get_snapshot — party snapshot for the current group.
  ctx.tools.register(
    defineTool({
      name: 'get_snapshot',
      description:
        '全员状态快照：查询指定群内所有角色的名字、HP、SAN 与标签。group_id 传空字符串时返回全部角色。' +
        '返回纯 JSON：{ characters: [{ char_name, hp, san, tags }] }。',
      parameters: {
        group_id: { type: 'string', required: true, description: 'QQ 群号；空字符串表示不限群' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                characters: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      char_name: { type: 'string', required: true },
                      hp: { type: 'integer', required: true },
                      san: { type: 'integer', required: true },
                      tags: { type: 'array', required: true, items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const characters = listGroupCharacters((args.group_id ?? '').trim()).map((character) => ({
            char_name: character.char_name,
            hp: character.hp,
            san: character.san,
            tags: character.tags,
          }))
          return { characters }
        })
      },
    }),
  )

  // 9. switch_character — activate a character and return the fresh sheet.
  ctx.tools.register(
    defineTool({
      name: 'switch_character',
      description:
        '切换当前激活角色卡：校验后写入 SQLite，并立即返回该角色最新的完整角色卡 JSON（HP/MP/SAN/属性/技能/标签）。' +
        '切换后请用 get_skill_value 读取实时技能值，禁止沿用旧数据或默认值。返回纯 JSON。',
      parameters: {
        char_name: { type: 'string', required: true, description: '要切换到激活状态的角色名' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                char_name: { type: 'string', required: true },
                owner_qq: { type: 'string', required: true },
                group_id: { type: 'string', required: true },
                hpmax: { type: 'integer', required: true },
                hp: { type: 'integer', required: true },
                mpmax: { type: 'integer', required: true },
                mp: { type: 'integer', required: true },
                sanmax: { type: 'integer', required: true },
                san: { type: 'integer', required: true },
                attributes: { type: 'json', required: true },
                skills: { type: 'json', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                active: { type: 'boolean', required: true, description: '固定为 true' },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const charName = requireText(args.char_name, 'char_name')
          const character = setActiveCharacter(charName)
          return { ...characterOutput(character), active: true as const }
        })
      },
    }),
  )

  // 10. get_skill_value — live skill lookup, the mandatory pre-check source.
  ctx.tools.register(
    defineTool({
      name: 'get_skill_value',
      description:
        '【强制】在执行任何判定或掷骰前，必须先调用本工具获取当前角色的实时技能值。本工具每次调用都直接查询 SQLite，不使用上下文缓存；' +
        '如果返回值包含 error，必须中断当前判定并向用户说明原因，禁止自行估算（例如用 DEX/2 代替技能值）。' +
        '默认读取当前激活角色（switch_character 设置），也可传 char_name。返回纯 JSON：{ char_name, skill_name, value, source }。',
      parameters: {
        skill_name: { type: 'string', required: true, description: '技能名（如 射击(冲锋枪)、侦查）；也可查属性名' },
        char_name: { type: 'string', description: '可选：指定角色；省略时使用当前激活角色' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                char_name: { type: 'string', required: true },
                skill_name: { type: 'string', required: true },
                value: { type: 'integer', required: true, description: '实时技能/属性值' },
                source: {
                  type: 'string',
                  required: true,
                  enum: ['skills', 'attributes'],
                  description: '该值来自技能表还是属性表',
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const skillName = requireText(args.skill_name, 'skill_name')
          const explicitName = (args.char_name ?? '').trim()
          const charName = explicitName.length > 0 ? explicitName : getActiveCharacterName()
          if (charName === null) throw new Error('没有激活角色：请先调用 switch_character 切换角色卡')
          const character = getCharacter(charName)
          if (character === null) throw new Error(`角色不存在: ${charName}`)
          const skill = character.skills[skillName]
          if (skill !== undefined) {
            return { char_name: charName, skill_name: skillName, value: Math.trunc(skill), source: 'skills' as const }
          }
          const rawAttribute = character.attributes[skillName]
          const attributeValue =
            typeof rawAttribute === 'number'
              ? rawAttribute
              : typeof rawAttribute === 'string'
                ? Number(rawAttribute)
                : Number.NaN
          if (Number.isFinite(attributeValue)) {
            return {
              char_name: charName,
              skill_name: skillName,
              value: Math.trunc(attributeValue),
              source: 'attributes' as const,
            }
          }
          throw new Error(`角色 ${charName} 没有技能或属性: ${skillName}`)
        })
      },
    }),
  )

  // 11. lookup_weapon — built-in weapon library lookup.
  ctx.tools.register(
    defineTool({
      name: 'lookup_weapon',
      description:
        '武器库查询（内置 26 件武器）：按武器名精确或模糊查询，返回使用技能、伤害、是否贯穿、基础射程、每轮次数、装弹量与故障值。' +
        '只传 category 可列出某一类武器（如 手枪、近战武器）。返回纯 JSON。',
      parameters: {
        weapon_name: { type: 'string', description: '武器名，可只写一部分（如 手枪、霰弹枪）' },
        category: { type: 'string', description: '武器分类过滤：近战武器 / 手枪 / 步枪与霰弹枪 / 冲锋枪与机枪 / 爆炸物与重武器' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                weapon_name: { type: 'string', required: true, description: '武器名' },
                category: { type: 'string', required: true, description: '武器分类' },
                skill: { type: 'string', required: true, description: '使用技能' },
                damage: { type: 'string', required: true, description: '伤害表达式' },
                impale: { type: 'boolean', required: true, description: '是否贯穿' },
                base_range: { type: 'string', required: true, description: '基础射程' },
                attacks_per_round: { type: 'string', required: true, description: '每轮攻击次数' },
                ammo: { type: 'string', required: true, description: '装弹量' },
                malfunction: { type: 'integer', required: true, description: '故障值' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                matches: {
                  type: 'array',
                  required: true,
                  description: '同名/模糊匹配的武器候选',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      weapon_name: { type: 'string', required: true },
                      category: { type: 'string', required: true },
                      skill: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const query = (args.weapon_name ?? '').trim()
          const category = (args.category ?? '').trim()
          if (query.length === 0) {
            return { matches: listWeapons(category).map(weaponSummary) }
          }
          const exact = getWeapon(query)
          if (exact !== null) return weaponOutput(exact)
          const found = searchWeapons(query, category)
          if (found.length === 1) return weaponOutput(found[0])
          return { matches: found.map(weaponSummary) }
        })
      },
    }),
  )

  // 12. lookup_spell — built-in spell catalogue lookup.
  ctx.tools.register(
    defineTool({
      name: 'lookup_spell',
      description:
        '法术查询（内置 545 条纯机制法术数据）：传入法术名，返回消耗（MP/SAN/POW）、施法时间、效果机制与判定机制；' +
        '若该法术被标记 manual_review_needed 也会一并返回。名字不精确时返回候选列表。返回纯 JSON。',
      parameters: {
        spell_name: { type: 'string', required: true, description: '法术名（可只写一部分，返回候选列表）' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                spell_name: { type: 'string', required: true, description: '法术名' },
                category: { type: 'string', required: true, description: '法术分类' },
                cost: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    mp: { type: 'string', required: true, description: 'MP 消耗' },
                    san: { type: 'string', required: true, description: 'SAN 消耗' },
                    pow: { type: 'string', required: true, description: 'POW 消耗' },
                  },
                },
                casting_time: { type: 'string', required: true, description: '施法时间' },
                roll_mechanics: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    caster_check: { type: 'string', required: true, description: '施法者检定' },
                    opposed: { type: 'string', required: true, description: '对抗判定' },
                  },
                },
                effect_mechanics: {
                  type: 'array',
                  required: true,
                  description: '效果机制条目',
                  items: { type: 'string' },
                },
                manual_review_needed: {
                  type: 'boolean',
                  required: true,
                  description: '该法术是否需要人工复核（true 时效果可能不完整）',
                },
                raw_text: { type: 'string', description: '抽取时保留的原文片段（仅部分条目有）' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                matches: {
                  type: 'array',
                  required: true,
                  description: '模糊匹配的法术候选',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      spell_name: { type: 'string', required: true },
                      category: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const query = requireText(args.spell_name, 'spell_name')
          const exact = getSpell(query)
          if (exact !== null) return spellOutput(exact)
          const found = searchSpells(query)
          if (found.length === 1) return spellOutput(found[0])
          return { matches: found.map(spellSummary) }
        })
      },
    }),
  )

  // 13. lookup_npc — built-in bestiary lookup.
  ctx.tools.register(
    defineTool({
      name: 'lookup_npc',
      description:
        '怪物图鉴查询（内置 253 种，来自 表.txt 与 新怪物.json）：按名称或分类（外神/旧日支配者/下级仆从种族/化身/唯一存在等）查询，' +
        '返回 HP/MP/DB/Build、技能百分比与完整图鉴资料（属性/衍生/战斗/护甲/咒文/理智损失）。返回纯 JSON。',
      parameters: {
        npc_name: { type: 'string', description: '怪物名，可只写一部分（如 深潜、修）' },
        category: { type: 'string', description: '分类过滤，如 外神、旧日支配者、下级仆从种族、化身、唯一存在' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                npc_name: { type: 'string', required: true, description: '怪物名' },
                category: { type: 'string', required: true, description: '分类（如 下级仆从种族）' },
                hp: { type: 'integer', required: true, description: 'HP' },
                mp: { type: 'integer', required: true, description: 'MP' },
                db: { type: 'string', required: true, description: '伤害加值表达式' },
                build: { type: 'integer', required: true, description: 'Build' },
                skills: { type: 'json', required: true, description: '战斗技能百分比' },
                attributes: { type: 'json', required: true, description: '完整图鉴资料（属性/衍生/战斗/护甲/咒文/理智损失等）' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                matches: {
                  type: 'array',
                  required: true,
                  description: '模糊匹配的怪物候选',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      npc_name: { type: 'string', required: true },
                      category: { type: 'string', required: true },
                      hp: { type: 'integer', required: true },
                    },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const query = (args.npc_name ?? '').trim()
          const category = (args.category ?? '').trim()
          if (query.length === 0) {
            return { matches: searchNpcTemplates('', category).map(npcSummary) }
          }
          const exact = getNpcTemplate(query)
          if (exact !== null) return npcOutput(exact)
          const found = searchNpcTemplates(query, category)
          if (found.length === 1) return npcOutput(found[0])
          return { matches: found.map(npcSummary) }
        })
      },
    }),
  )

  // 14. manage_npc — bestiary templates and instances.
  ctx.tools.register(
    defineTool({
      name: 'manage_npc',
      description:
        `怪物图鉴与实例化。action=create_template 需 KP 权限${keeperHint}（qq_id 必须等于 KP QQ），自定义模板数据放 template_data；` +
        'create_instance 按模板名生成实例；update_hp 用 hp_change 变化量调整实例 HP（负数扣血、正数回血，HP 归零状态为 dead）。' +
        '返回纯 JSON。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['create_template', 'create_instance', 'update_hp'],
          description: '要执行的操作',
        },
        qq_id: { type: 'string', description: '操作者 QQ 号；create_template 时必须是 KP' },
        npc_name: { type: 'string', description: 'create_template 的模板名 / create_instance 要实例化的模板名' },
        instance_id: { type: 'string', description: '实例 ID；create_instance 省略时自动生成' },
        hp_change: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description: 'update_hp 的 HP 变化量（负数扣血、正数回血；可传数字字符串）',
        },
        template_data: { type: 'json', description: '自定义模板数据：{ hp?, mp?, db?, build?, skills? }' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                action: { type: 'string', required: true, const: 'create_template' },
                template: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    npc_name: { type: 'string', required: true },
                    hp: { type: 'integer', required: true },
                    mp: { type: 'integer', required: true },
                    db: { type: 'string', required: true },
                    build: { type: 'integer', required: true },
                    skills: { type: 'json', required: true },
                    attributes: { type: 'json', required: true },
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                action: {
                  type: 'string',
                  required: true,
                  enum: ['create_instance', 'update_hp'],
                  description: '实例操作类型',
                },
                instance: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    instance_id: { type: 'string', required: true },
                    template_name: { type: 'string', required: true },
                    current_hp: { type: 'integer', required: true },
                    current_mp: { type: 'integer', required: true },
                    status: { type: 'string', required: true },
                  },
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const action = args.action
          if (action === 'create_template') {
            const expectedKp = keeperQqId
            if (expectedKp.length === 0 || (args.qq_id ?? '').trim() !== expectedKp) {
              throw new Error('权限不足，只有 KP 可以创建模板')
            }
            const npcName = requireText(args.npc_name, 'npc_name')
            const data =
              args.template_data === undefined
                ? {}
                : plainRecord(args.template_data, 'template_data')
            const template = createNpcTemplate(npcName, {
              hp: numberField(data['hp'], 'template_data.hp'),
              mp: numberField(data['mp'], 'template_data.mp'),
              db: stringField(data['db'], 'template_data.db'),
              build: numberField(data['build'], 'template_data.build'),
              skills: data['skills'] === undefined ? undefined : numberRecord(data['skills'], 'template_data.skills'),
              attributes:
                data['attributes'] === undefined
                  ? undefined
                  : plainRecord(data['attributes'], 'template_data.attributes'),
            })
            return { action: 'create_template' as const, template: templateOutput(template) }
          }
          if (action === 'create_instance') {
            const templateName = requireText(args.npc_name, 'npc_name')
            const instance = createNpcInstance(templateName, args.instance_id)
            return { action: 'create_instance' as const, instance }
          }
          const instanceId = requireText(args.instance_id, 'instance_id')
          if (args.hp_change === undefined) throw new Error('update_hp 需要 hp_change 参数')
          const instance = updateNpcInstanceHp(instanceId, toNumber(args.hp_change, 'hp_change'))
          return { action: 'update_hp' as const, instance }
        })
      },
    }),
  )

  // 15. apply_damage — combat damage with armor, immunity and health states.
  ctx.tools.register(
    defineTool({
      name: 'apply_damage',
      description:
        '战斗伤害结算：对 NPC 实例（instance_id）或角色（char_name）结算物理伤害。按 CoC 规则读取怪物模板的「护甲」/免疫属性，' +
        '实际扣血 = max(0, raw_damage - armor)；物理免疫时扣 0。更新数据库 HP 后返回：' +
        '{ target_id, target_type, raw_damage, armor_value, immune, actual_damage, remaining_hp, max_hp, status }，' +
        'status 为 正常/重伤/濒死/死亡。返回纯 JSON。',
      parameters: {
        target_id: { type: 'string', required: true, description: '目标：NPC 实例 ID（instance_id）或角色名' },
        raw_damage: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          required: true,
          description: '原始伤害值（已算好骰点与 DB，非负；可传数字字符串）',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                target_id: { type: 'string', required: true, description: '目标 ID/角色名' },
                target_type: {
                  type: 'string',
                  required: true,
                  enum: ['npc', 'character'],
                  description: '目标是 NPC 实例还是角色',
                },
                raw_damage: { type: 'integer', required: true, description: '原始伤害' },
                armor_value: { type: 'integer', required: true, description: '护甲减伤点数' },
                immune: { type: 'boolean', required: true, description: '是否物理免疫' },
                actual_damage: { type: 'integer', required: true, description: '实际扣除的 HP' },
                remaining_hp: { type: 'integer', required: true, description: '结算后的 HP（可为负）' },
                max_hp: { type: 'integer', required: true, description: '目标 HP 上限' },
                status: {
                  type: 'string',
                  required: true,
                  enum: ['正常', '重伤', '濒死', '死亡'],
                  description: '结算后的健康状态',
                },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const targetId = requireText(args.target_id, 'target_id')
          const rawDamage = Math.max(0, Math.trunc(toNumber(args.raw_damage, 'raw_damage')))
          const npc = getNpcInstance(targetId)
          if (npc !== null) {
            const template = getNpcTemplate(npc.template_name)
            const armorText = template?.attributes['护甲']
            const armor = parseArmorText(typeof armorText === 'string' ? armorText : undefined)
            const actualDamage = armor.immunePhysical ? 0 : Math.max(0, rawDamage - armor.armor)
            const updated = updateNpcInstanceHp(npc.instance_id, -actualDamage)
            const maxHp = Math.max(1, template?.hp ?? updated.current_hp)
            return {
              target_id: npc.instance_id,
              target_type: 'npc' as const,
              raw_damage: rawDamage,
              armor_value: armor.armor,
              immune: armor.immunePhysical,
              actual_damage: actualDamage,
              remaining_hp: updated.current_hp,
              max_hp: maxHp,
              status: healthStatus(updated.current_hp, maxHp),
            }
          }
          const character = getCharacter(targetId)
          if (character === null) throw new Error(`目标不存在: ${targetId}`)
          const updated = setCharacterHp(character.char_name, character.hp - rawDamage)
          return {
            target_id: character.char_name,
            target_type: 'character' as const,
            raw_damage: rawDamage,
            armor_value: 0,
            immune: false,
            actual_damage: rawDamage,
            remaining_hp: updated.hp,
            max_hp: updated.hpmax,
            status: healthStatus(updated.hp, updated.hpmax),
          }
        })
      },
    }),
  )

  // 16. manage_character — character sheet lifecycle (documented extension).
  ctx.tools.register(
    defineTool({
      name: 'manage_character',
      description:
        '角色卡管理（任务书未包含、按需要补充）：create 建档、get 查看、update 修改、delete 删除。' +
        'attributes/skills 用 JSON 对象传入；update 时 attributes/skills 按「合并」写入（只覆盖传入的键，不会清空其它技能）。' +
        '建档时若给出 POW 会自动把初始 SAN 设为 POW（CoC 7版 SAN=POW）。返回纯 JSON。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['create', 'get', 'update', 'delete'],
          description: '要执行的操作',
        },
        char_name: { type: 'string', required: true, description: '角色名（主键）' },
        owner_qq: { oneOf: [{ type: 'string' }, { type: 'number' }], description: '拥有者 QQ 号' },
        group_id: { oneOf: [{ type: 'string' }, { type: 'number' }], description: '所属 QQ 群号' },
        hpmax: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'HP 上限（数字）' },
        hp: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '当前 HP（数字；技能请放 skills，别放 hp）' },
        mpmax: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'MP 上限（数字）' },
        mp: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '当前 MP（数字）' },
        sanmax: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'SAN 上限（数字）' },
        san: { oneOf: [{ type: 'number' }, { type: 'string' }], description: '当前 SAN（数字）' },
        attributes: { type: 'json', description: '属性 JSON，如 { STR: 60, DEX: 50, POW: 55 }（也接受 JSON 字符串）' },
        skills: { type: 'json', description: '技能 JSON，如 { 侦查: 60, 聆听: 45 }（也接受 JSON 字符串）' },
        tags: {
          oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
          description: '标签列表（字符串数组，或逗号分隔的字符串）',
        },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                char_name: { type: 'string', required: true },
                owner_qq: { type: 'string', required: true },
                group_id: { type: 'string', required: true },
                hpmax: { type: 'integer', required: true },
                hp: { type: 'integer', required: true },
                mpmax: { type: 'integer', required: true },
                mp: { type: 'integer', required: true },
                sanmax: { type: 'integer', required: true },
                san: { type: 'integer', required: true },
                attributes: { type: 'json', required: true },
                skills: { type: 'json', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                char_name: { type: 'string', required: true },
                deleted: { type: 'boolean', required: true, const: true },
              },
            },
            { type: 'object', additionalProperties: false, properties: ERROR_FIELDS },
          ],
        },
        render: renderJson,
      },
      async execute(args) {
        return guard(() => {
          const action = args.action
          const charName = requireText(args.char_name, 'char_name')
          const patch: CharacterPatch = {
            owner_qq: args.owner_qq === undefined ? undefined : String(args.owner_qq),
            group_id: args.group_id === undefined ? undefined : String(args.group_id),
            hpmax: optionalNumber(args.hpmax, 'hpmax'),
            hp: optionalNumber(args.hp, 'hp'),
            mpmax: optionalNumber(args.mpmax, 'mpmax'),
            mp: optionalNumber(args.mp, 'mp'),
            sanmax: optionalNumber(args.sanmax, 'sanmax'),
            san: optionalNumber(args.san, 'san'),
            attributes: args.attributes === undefined ? undefined : plainRecord(args.attributes, 'attributes'),
            skills: args.skills === undefined ? undefined : numberRecord(args.skills, 'skills'),
            tags: args.tags === undefined ? undefined : stringList(args.tags, 'tags'),
          }
          if (action === 'create') {
            return characterOutput(createCharacter({ ...patch, char_name: charName }))
          }
          if (action === 'get') {
            const character = getCharacter(charName)
            if (character === null) throw new Error(`角色不存在: ${charName}`)
            return characterOutput(character)
          }
          if (action === 'update') {
            const current = getCharacter(charName)
            if (current === null) throw new Error(`角色不存在: ${charName}`)
            const merged: CharacterPatch = {
              ...patch,
              attributes:
                patch.attributes === undefined ? undefined : { ...current.attributes, ...patch.attributes },
              skills: patch.skills === undefined ? undefined : { ...current.skills, ...patch.skills },
            }
            return characterOutput(updateCharacter(charName, merged))
          }
          deleteCharacter(charName)
          return { char_name: charName, deleted: true as const }
        })
      },
    }),
  )
}

/** Read an optional numeric field out of `template_data`; numeric strings accepted. */
function numberField(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return toNumber(value, label)
}

/** Read an optional string field out of `template_data`; numbers are stringified. */
function stringField(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new Error(`${label} 必须是字符串`)
}

/** Project a stored template into the JSON tool result. */
function templateOutput(template: NpcTemplateRecord) {
  return {
    npc_name: template.npc_name,
    hp: template.hp,
    mp: template.mp,
    db: template.db,
    build: template.build,
    skills: jsonValue(template.skills),
    attributes: jsonValue(template.attributes),
  }
}

/** Project a stored character sheet into the JSON tool result. */
function characterOutput(character: ReturnType<typeof getCharacter> & object) {
  return {
    char_name: character.char_name,
    owner_qq: character.owner_qq,
    group_id: character.group_id,
    hpmax: character.hpmax,
    hp: character.hp,
    mpmax: character.mpmax,
    mp: character.mp,
    sanmax: character.sanmax,
    san: character.san,
    attributes: jsonValue(character.attributes),
    skills: jsonValue(character.skills),
    tags: character.tags,
  }
}

/** Short weapon row used when the query matches several weapons. */
function weaponSummary(weapon: WeaponRecord) {
  return {
    weapon_name: weapon.weapon_name,
    category: weapon.category,
    skill: weapon.skill,
  }
}/** Full weapon JSON returned for an exact (or single fuzzy) match. */
function weaponOutput(weapon: WeaponRecord) {
  return {
    weapon_name: weapon.weapon_name,
    category: weapon.category,
    skill: weapon.skill,
    damage: weapon.damage,
    impale: weapon.impale,
    base_range: weapon.base_range,
    attacks_per_round: weapon.attacks_per_round,
    ammo: weapon.ammo,
    malfunction: weapon.malfunction,
  }
}

/** Short spell row used when the query matches several spells. */
function spellSummary(spell: SpellRecord) {
  return { spell_name: spell.spell_name, category: spell.category }
}

/** Full spell JSON returned for an exact (or single fuzzy) match. */
function spellOutput(spell: SpellRecord) {
  const output = {
    spell_name: spell.spell_name,
    category: spell.category,
    cost: spell.cost,
    casting_time: spell.casting_time,
    roll_mechanics: spell.roll_mechanics,
    effect_mechanics: spell.effect_mechanics,
    manual_review_needed: spell.manual_review_needed,
  }
  if (spell.raw_text !== undefined) return { ...output, raw_text: spell.raw_text }
  return output
}

/** 分类 of a bestiary template, read from its stored JSON attributes. */
function npcCategory(template: NpcTemplateRecord): string {
  const raw = template.attributes['分类']
  return typeof raw === 'string' ? raw : ''
}

/** Short bestiary row used when the query matches several creatures. */
function npcSummary(template: NpcTemplateRecord) {
  return {
    npc_name: template.npc_name,
    category: npcCategory(template),
    hp: template.hp,
  }
}

/** Full bestiary JSON returned for an exact (or single fuzzy) match. */
function npcOutput(template: NpcTemplateRecord) {
  return {
    npc_name: template.npc_name,
    category: npcCategory(template),
    hp: template.hp,
    mp: template.mp,
    db: template.db,
    build: template.build,
    skills: jsonValue(template.skills),
    attributes: jsonValue(template.attributes),
  }
}
