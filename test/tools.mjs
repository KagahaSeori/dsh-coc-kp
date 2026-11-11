/**
 * Local end-to-end test of the registered tools.
 *
 * Loads `dist/index.js` exactly as the Harness loader would (the plugin is a
 * normal ESM module), mounts it on a fake Cordis context whose `tools.register`
 * just records definitions, then executes every tool with real arguments and
 * asserts the returned JSON. This exercises `defineTool` wiring, argument
 * parsing inside `execute`, the database, and all error paths without installing
 * the plugin into the live profile.
 *
 * Run: node test/tools.mjs   (after `pnpm build`)
 */
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const testDbFile = join(process.cwd(), '.test-tools.db')
for (const suffix of ['', '-wal', '-shm']) rmSync(testDbFile + suffix, { force: true })
process.env.DSH_COC_KP_DB = testDbFile
process.env.KP_QQ_ID = ''
// Keep the tests independent from the operator's real kp.config.json.
process.env.DSH_COC_KP_CONFIG = join(process.cwd(), '.test-no-kp-config.json')

const plugin = await import('../dist/index.js')
const { Config } = plugin

let checks = 0
function check(label, fn) {
  fn()
  checks += 1
}

const definitions = new Map()
const ctx = {
  tools: {
    register(definition) {
      assert.equal(definitions.has(definition.name), false, `duplicate tool ${definition.name}`)
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  },
}

const config = { fumble_rule: 'auto', kp_qq_id: '999', kp_nickname: '测试KP' }
await plugin.apply(ctx, config)

const call = (toolName, args) => definitions.get(toolName).execute(args, { signal: new AbortController().signal })

const EXPECTED_TOOLS = [
  'roll_check',
  'push_roll',
  'sanity_check',
  'roll_madness',
  'skill_growth',
  'manage_tags',
  'get_snapshot',
  'manage_npc',
  'lookup_weapon',
  'lookup_spell',
  'lookup_npc',
  'manage_character',
]

console.log('plugin: registration')
check('twelve tools registered', () => assert.deepEqual([...definitions.keys()].sort(), [...EXPECTED_TOOLS].sort()))
check('every definition has schema, output.schema and render', () => {
  for (const definition of definitions.values()) {
    assert.ok(definition.description.length > 0, definition.name)
    assert.ok(definition.parameters !== undefined, definition.name)
    assert.ok(definition.output.schema !== undefined, definition.name)
    assert.equal(typeof definition.output.render, 'function', definition.name)
  }
})
check('Config applies defaults through schemastery', () => {
  const parsed = Config({})
  assert.equal(parsed.fumble_rule, 'auto')
  assert.equal(parsed.kp_qq_id, '')
})
check('Config rejects an unknown fumble rule', () => assert.throws(() => Config({ fumble_rule: 'nope' })))

console.log('tool: roll_check')
const checkRoll = await call('roll_check', { target: 60, bonus_dice: 1, penalty_dice: 0 })
check('roll_check shape', () => {
  assert.equal(checkRoll.tens_rolls.length, 2)
  for (const face of checkRoll.tens_rolls) assert.ok(face >= 0 && face <= 90 && face % 10 === 0)
  assert.ok(checkRoll.ones_roll >= 0 && checkRoll.ones_roll <= 9)
  assert.ok(checkRoll.final_result >= 1 && checkRoll.final_result <= 100)
  assert.ok(['大成功', '极难', '困难', '成功', '失败', '大失败'].includes(checkRoll.success_level))
  assert.equal(typeof checkRoll.is_success, 'boolean')
})
const penaltyRoll = await call('roll_check', { target: 40, penalty_dice: 2 })
check('penalty roll has three tens dice', () => assert.equal(penaltyRoll.tens_rolls.length, 3))
const badCheck = await call('roll_check', { target: -1, bonus_dice: 0, penalty_dice: 0 })
check('roll_check error shape', () => {
  assert.ok(typeof badCheck.error === 'string' && badCheck.error.length > 0)
})
const cancelRoll = await call('roll_check', { target: 50, bonus_dice: 2, penalty_dice: 2 })
check('cancel has one tens die', () => assert.equal(cancelRoll.tens_rolls.length, 1))

console.log('tool: push_roll')
const push = await call('push_roll', { skill_value: 80 })
check('push_roll shape', () => {
  assert.equal(push.target, 50)
  assert.ok(push.roll >= 1 && push.roll <= 100)
  assert.ok(['大成功', '大失败'].includes(push.result))
})

console.log('tool: manage_character + sanity_check')
const created = await call('manage_character', {
  action: 'create',
  char_name: '艾琳',
  owner_qq: '123',
  group_id: 'g1',
  attributes: { STR: 55, POW: 60, DEX: 70 },
  skills: { 侦查: 65, 聆听: 40 },
  tags: [],
})
check('character create shape', () => {
  assert.equal(created.char_name, '艾琳')
  assert.equal(created.sanmax, 60)
  assert.equal(created.san, 60)
  assert.equal(created.skills['侦查'], 65)
  assert.deepEqual(created.tags, [])
})
const duplicate = await call('manage_character', { action: 'create', char_name: '艾琳' })
check('duplicate character returns error', () => assert.match(duplicate.error, /角色已存在/))
const got = await call('manage_character', { action: 'get', char_name: '艾琳' })
check('character get round-trips JSON columns', () => {
  assert.deepEqual(got.attributes, { STR: 55, POW: 60, DEX: 70 })
  assert.equal(got.skills['聆听'], 40)
})
const missing = await call('manage_character', { action: 'get', char_name: '不存在' })
check('missing character returns error', () => assert.match(missing.error, /角色不存在/))

const sanBefore = got.san
const sanity = await call('sanity_check', { char_name: '艾琳', success_loss: '0', fail_loss: '1d10' })
check('sanity_check shape and persistence', () => {
  assert.ok(sanity.roll >= 1 && sanity.roll <= 100)
  assert.equal(typeof sanity.is_success, 'boolean')
  assert.ok(sanity.san_loss >= 0 && sanity.san_loss <= 10)
  assert.equal(sanity.current_san, sanBefore - sanity.san_loss)
  if (sanity.is_success) assert.equal(sanity.san_loss, 0)
})
const afterSanity = await call('manage_character', { action: 'get', char_name: '艾琳' })
check('sanity persisted', () => assert.equal(afterSanity.san, sanity.current_san))
const sanityMissing = await call('sanity_check', { char_name: '不存在', success_loss: '0', fail_loss: '1d6' })
check('sanity missing character error', () => assert.match(sanityMissing.error, /角色不存在/))
const sanityBadExpr = await call('sanity_check', { char_name: '艾琳', success_loss: 'bogus', fail_loss: 'also-bogus' })
check('sanity bad expression error', () => assert.match(sanityBadExpr.error, /无法解析骰子表达式/))

console.log('tool: roll_madness')
for (const table of ['ti', 'li']) {
  const draw = await call('roll_madness', { table_type: table })
  check(`roll_madness ${table}`, () => {
    assert.ok(draw.roll >= 1 && draw.roll <= 10)
    assert.equal(typeof draw.symptom, 'string')
    assert.ok(draw.symptom.length > 4)
  })
}
let unknownTableError = null
try {
  await call('roll_madness', { table_type: '7r' })
} catch (error) {
  unknownTableError = error
}
check('roll_madness rejects unknown table at the schema boundary', () =>
  assert.equal(unknownTableError?.code, 'INVALID_ARGS'))

console.log('tool: skill_growth')
const growth = await call('skill_growth', { char_name: '艾琳', skill_name: '侦查' })
check('skill_growth shape', () => {
  assert.equal(typeof growth.success, 'boolean')
  assert.ok(growth.growth >= 0 && growth.growth <= 10)
  assert.equal(growth.new_value, growth.success ? 65 + growth.growth : 65)
})
const growthMissingSkill = await call('skill_growth', { char_name: '艾琳', skill_name: '不存在技能' })
check('skill_growth missing skill error', () => assert.match(growthMissingSkill.error, /没有技能/))

console.log('tool: manage_tags')
const tagged = await call('manage_tags', { char_name: '艾琳', action: 'add', tag_name: '濒死' })
check('tag add', () => assert.deepEqual(tagged.updated_tags, ['濒死']))
const taggedAgain = await call('manage_tags', { char_name: '艾琳', action: 'add', tag_name: '濒死' })
check('tag add is idempotent', () => assert.deepEqual(taggedAgain.updated_tags, ['濒死']))
const untagged = await call('manage_tags', { char_name: '艾琳', action: 'remove', tag_name: '濒死' })
check('tag remove', () => assert.deepEqual(untagged.updated_tags, []))

console.log('tool: get_snapshot')
const snapshot = await call('get_snapshot', { group_id: 'g1' })
check('snapshot shape', () => {
  assert.equal(snapshot.characters.length, 1)
  assert.deepEqual(Object.keys(snapshot.characters[0]).sort(), ['char_name', 'hp', 'san', 'tags'])
  assert.equal(snapshot.characters[0].char_name, '艾琳')
})
const emptySnapshot = await call('get_snapshot', { group_id: 'no-such-group' })
check('snapshot for unknown group is empty', () => assert.deepEqual(emptySnapshot.characters, []))

console.log('tool: manage_npc')
const denied = await call('manage_npc', {
  action: 'create_template',
  qq_id: '111',
  npc_name: '测试怪',
  template_data: { hp: 9 },
})
check('create_template denies non-KP', () => assert.match(denied.error, /权限不足，只有 KP 可以创建模板/))
const template = await call('manage_npc', {
  action: 'create_template',
  qq_id: '999',
  npc_name: '测试怪',
  template_data: { hp: 9, mp: 4, db: '+1D4', build: 1, skills: { 撕咬: 45 } },
})
check('create_template as KP', () => {
  assert.equal(template.action, 'create_template')
  assert.equal(template.template.npc_name, '测试怪')
  assert.equal(template.template.hp, 9)
  assert.equal(template.template.skills['撕咬'], 45)
})
const instance = await call('manage_npc', { action: 'create_instance', npc_name: '拜亚基' })
check('create_instance from seeded bestiary', () => {
  assert.equal(instance.action, 'create_instance')
  assert.equal(instance.instance.template_name, '拜亚基')
  assert.equal(instance.instance.current_hp, 14)
  assert.equal(instance.instance.status, 'active')
})
const damaged = await call('manage_npc', {
  action: 'update_hp',
  instance_id: instance.instance.instance_id,
  hp_change: -20,
})
check('update_hp delta and death', () => {
  assert.equal(damaged.instance.current_hp, 0)
  assert.equal(damaged.instance.status, 'dead')
})
const missingInstance = await call('manage_npc', { action: 'update_hp', instance_id: 'nope', hp_change: -1 })
check('update_hp missing instance error', () => assert.match(missingInstance.error, /实例不存在/))

console.log('tool: lookup_weapon')
const thompson = await call('lookup_weapon', { weapon_name: '汤普森冲锋枪' })
check('exact weapon lookup', () => {
  assert.equal(thompson.weapon_name, '汤普森冲锋枪')
  assert.equal(thompson.damage, '1D10+2')
  assert.equal(thompson.impale, true)
  assert.equal(thompson.malfunction, 96)
})
const pistolMatches = await call('lookup_weapon', { weapon_name: '手枪' })
check('fuzzy weapon query returns candidates', () => {
  assert.equal(pistolMatches.matches.length, 5)
  assert.ok(pistolMatches.matches.every((row) => row.weapon_name.includes('手枪')))
})
const meleeCategory = await call('lookup_weapon', { category: '近战武器' })
check('weapon category listing', () => assert.equal(meleeCategory.matches.length, 8))
const noWeapon = await call('lookup_weapon', { weapon_name: '不存在的武器' })
check('unknown weapon returns empty candidate list', () => assert.deepEqual(noWeapon.matches, []))

console.log('tool: lookup_spell')
const cursedEye = await call('lookup_spell', { spell_name: '被诅咒的眼' })
check('exact spell lookup', () => {
  assert.equal(cursedEye.spell_name, '被诅咒的眼')
  assert.equal(cursedEye.cost.mp, '6')
  assert.equal(cursedEye.cost.san, '1D4')
  assert.equal(cursedEye.casting_time, '30分钟')
  assert.equal(cursedEye.effect_mechanics.length, 5)
  assert.equal(cursedEye.manual_review_needed, false)
})
const flaggedSpell = await call('lookup_spell', { spell_name: '阿布霍斯唤醒术' })
check('manual_review_needed flag is returned', () => {
  assert.equal(flaggedSpell.manual_review_needed, true)
  assert.equal(typeof flaggedSpell.raw_text, 'string')
})
const summonMatches = await call('lookup_spell', { spell_name: '召唤' })
check('fuzzy spell query returns candidates', () => assert.ok(summonMatches.matches.length > 0))
const noSpell = await call('lookup_spell', { spell_name: '不存在的法术' })
check('unknown spell returns empty candidate list', () => assert.deepEqual(noSpell.matches, []))

console.log('tool: lookup_npc')
const byakhee = await call('lookup_npc', { npc_name: '拜亚基' })
check('exact bestiary lookup', () => {
  assert.equal(byakhee.npc_name, '拜亚基')
  assert.match(byakhee.category, /下级仆从种族/)
  assert.equal(byakhee.hp, 14)
  assert.equal(byakhee.db, '+1D6')
  // 新怪物.json 的拜亚基「衍生」未列 Build，数值列取默认 0（原文见 attributes）。
  assert.equal(byakhee.build, 0)
  assert.equal(byakhee.skills['爪击'], 35)
  assert.equal(byakhee.attributes['分类'], '下级仆从种族')
  assert.ok(byakhee.attributes['战斗'])
  assert.ok(byakhee.attributes['护甲'])
  assert.ok(byakhee.attributes['理智损失'])
})
const fuzzyNpc = await call('lookup_npc', { npc_name: '修' })
check('fuzzy bestiary candidates', () => assert.equal(fuzzyNpc.matches.length, 7))
const outerGods = await call('lookup_npc', { category: '外神' })
check('bestiary category listing', () => assert.equal(outerGods.matches.length, 15))
const cthulhu = await call('lookup_npc', { npc_name: '克苏鲁' })
check('newly added creature lookup', () => {
  assert.equal(cthulhu.npc_name, '克苏鲁')
  assert.equal(cthulhu.category, '旧日支配者')
  assert.equal(cthulhu.hp, 160)
  assert.equal(cthulhu.db, '+21D6')
  assert.equal(cthulhu.skills['触须'], 100)
  assert.equal(cthulhu.attributes['理智损失'], '1D10/1D100')
})
const ghatanothoaNpc = await call('lookup_npc', { npc_name: '加塔诺托亚' })
check('corrected creature lookup keeps the 7e block', () => {
  assert.equal(ghatanothoaNpc.npc_name, '加塔诺托亚')
  assert.equal(ghatanothoaNpc.hp, 110)
  assert.equal(ghatanothoaNpc.db, '+13D6')
  assert.equal(ghatanothoaNpc.build, 14)
  assert.equal(ghatanothoaNpc.attributes['属性']['STR'], 450)
  assert.equal(ghatanothoaNpc.attributes['理智损失'], '1D10/1D100')
})
const noNpc = await call('lookup_npc', { npc_name: '不存在的怪物' })
check('unknown creature returns empty candidate list', () => assert.deepEqual(noNpc.matches, []))

console.log('tool: manage_character update/delete')
const updated = await call('manage_character', {
  action: 'update',
  char_name: '艾琳',
  hp: 7,
  tags: ['旧伤'],
})
check('character update', () => {
  assert.equal(updated.hp, 7)
  assert.deepEqual(updated.tags, ['旧伤'])
})
const deleted = await call('manage_character', { action: 'delete', char_name: '艾琳' })
check('character delete', () => {
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.char_name, '艾琳')
})
const deletedAgain = await call('manage_character', { action: 'delete', char_name: '艾琳' })
check('delete missing character error', () => assert.match(deletedAgain.error, /角色不存在/))

console.log('local kp config precedence')
const localConfigFile = join(process.cwd(), '.test-kp-local.json')
writeFileSync(localConfigFile, JSON.stringify({ kp_qq_id: '777', kp_nickname: '本地KP' }), 'utf8')
process.env.DSH_COC_KP_CONFIG = localConfigFile
const localDefinitions = new Map()
const localCtx = {
  tools: {
    register(definition) {
      localDefinitions.set(definition.name, definition)
      return () => localDefinitions.delete(definition.name)
    },
  },
}
await plugin.apply(localCtx, { fumble_rule: 'auto', kp_qq_id: '999', kp_nickname: '配置KP' })
check('local nickname appears in the manage_npc description', () =>
  assert.match(localDefinitions.get('manage_npc').description, /群内 KP：本地KP/))
const localTemplate = await localDefinitions.get('manage_npc').execute(
  { action: 'create_template', qq_id: '777', npc_name: '本地配置测试怪', template_data: { hp: 6 } },
  { signal: new AbortController().signal },
)
check('local kp QQ overrides the plugin config', () =>
  assert.equal(localTemplate.template.npc_name, '本地配置测试怪'))
const localDenied = await localDefinitions.get('manage_npc').execute(
  { action: 'create_template', qq_id: '999', npc_name: '应被拒绝怪' },
  { signal: new AbortController().signal },
)
check('plugin-config QQ is ignored when the local file has one', () =>
  assert.match(localDenied.error, /权限不足，只有 KP 可以创建模板/))
rmSync(localConfigFile, { force: true })
process.env.DSH_COC_KP_CONFIG = join(process.cwd(), '.test-no-kp-config.json')

const pluginDb = await import('../dist/db.js')
pluginDb.closeDatabase()
for (const suffix of ['', '-wal', '-shm']) rmSync(testDbFile + suffix, { force: true })

console.log(`\nTOOLS OK — ${checks} checks passed`)
