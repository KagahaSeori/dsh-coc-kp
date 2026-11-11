/**
 * Local smoke test for `dsh-coc-kp`.
 *
 * Runs against the compiled `dist/` modules — no Cordis host required. Covers
 * the pure rules in detail (deterministic rng), the generated madness tables,
 * and every database path used by the tools. The tool wiring itself is verified
 * after installation in the live Harness profile.
 *
 * Run: node test/smoke.mjs   (after `pnpm build`)
 */
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const testDbFile = join(process.cwd(), '.test-data.db')
for (const suffix of ['', '-wal', '-shm']) rmSync(testDbFile + suffix, { force: true })
process.env.DSH_COC_KP_DB = testDbFile

const rules = await import('../dist/rules.js')
const madness = await import('../dist/data/madness.js')
const db = await import('../dist/db.js')

/** Deterministic rng cycling through the given [0,1) values. */
function seq(...values) {
  let index = 0
  return () => values[index++ % values.length]
}

let checks = 0
function check(label, fn) {
  fn()
  checks += 1
  if (checks % 10 === 0) console.log(`  ...${checks} checks passed`)
}

console.log('config: local KP identity file')
const configModule = await import('../dist/config.js')
const kpConfigFile = join(process.cwd(), '.test-kp.config.json')
writeFileSync(kpConfigFile, JSON.stringify({ kp_qq_id: ' 123456 ', kp_nickname: ' 守秘人 ' }), 'utf8')
process.env.DSH_COC_KP_CONFIG = kpConfigFile
check('local kp config is parsed and trimmed', () =>
  assert.deepEqual(configModule.loadLocalKpConfig(), { kp_qq_id: '123456', kp_nickname: '守秘人' }))
writeFileSync(kpConfigFile, '{ not json', 'utf8')
check('broken local kp config is ignored', () => assert.deepEqual(configModule.loadLocalKpConfig(), {}))
writeFileSync(kpConfigFile, JSON.stringify({ kp_qq_id: 123, kp_nickname: null }), 'utf8')
check('non-string local values are ignored', () => assert.deepEqual(configModule.loadLocalKpConfig(), {}))
rmSync(kpConfigFile, { force: true })
check('missing local kp config is empty', () => assert.deepEqual(configModule.loadLocalKpConfig(), {}))

console.log('rules: percentile mapping')
check('rollD100 maps 0+0 to 100', () => assert.equal(rules.rollD100(seq(0, 0)), 100))
check('rollD100 maps tens 0 + ones 5 to 5', () => assert.equal(rules.rollD100(seq(0.05, 0.5)), 5))
check('rollD100 maps 0.95/0.5 to 95', () => assert.equal(rules.rollD100(seq(0.95, 0.5)), 95))
check('rollDie stays in 1..sides', () => {
  assert.equal(rules.rollDie(6, seq(0)), 1)
  assert.equal(rules.rollDie(6, seq(0.999999)), 6)
})

console.log('rules: success tiers')
const tier = (target, roll, rule = 'auto') => rules.classifyRoll(target, roll, rule)
check('1-5 is 大成功', () => assert.equal(tier(60, 5).success_level, '大成功'))
check('roll 12 vs target 60 is 极难', () => assert.equal(tier(60, 12).success_level, '极难'))
check('roll 13 vs target 60 is 困难', () => assert.equal(tier(60, 13).success_level, '困难'))
check('roll 30 vs target 60 is 困难', () => assert.equal(tier(60, 30).success_level, '困难'))
check('roll 31 vs target 60 is 成功', () => assert.equal(tier(60, 31).success_level, '成功'))
check('roll 61 vs target 60 is 失败', () => assert.equal(tier(60, 61).success_level, '失败'))
check('target >= 50: 96 is not a fumble', () => assert.equal(tier(60, 96).success_level, '失败'))
check('target >= 50: 100 is a fumble', () => assert.equal(tier(60, 100).success_level, '大失败'))
check('target < 50: 96 is a fumble', () => assert.equal(tier(40, 96).success_level, '大失败'))
check('96-100 rule: 96 fumbles on target 60', () => assert.equal(tier(60, 96, '96-100').success_level, '大失败'))
check('only-100 rule: 96 does not fumble on target 40', () => assert.equal(tier(40, 96, 'only-100').success_level, '失败'))
check('is_success mirrors the tier', () => {
  assert.equal(tier(60, 5).is_success, true)
  assert.equal(tier(60, 100).is_success, false)
})

console.log('rules: roll_check bonus / penalty dice')
check('plain roll 55 vs 60', () => {
  const result = rules.resolveCheck(60, 0, 0, 'auto', seq(0.5, 0.5))
  assert.deepEqual(result.tens_rolls, [50])
  assert.equal(result.ones_roll, 5)
  assert.equal(result.final_result, 55)
  assert.equal(result.success_level, '成功')
  assert.equal(result.is_success, true)
})
check('bonus die takes the lowest tens', () => {
  const result = rules.resolveCheck(60, 1, 0, 'auto', seq(0.9, 0.1, 0.5))
  assert.deepEqual(result.tens_rolls, [90, 10])
  assert.equal(result.final_result, 15)
  assert.equal(result.success_level, '困难')
})
check('penalty die takes the highest tens', () => {
  const result = rules.resolveCheck(60, 0, 1, 'auto', seq(0.9, 0.1, 0.5))
  assert.deepEqual(result.tens_rolls, [90, 10])
  assert.equal(result.final_result, 95)
  assert.equal(result.success_level, '失败')
})
check('bonus and penalty cancel to one tens die', () => {
  const result = rules.resolveCheck(60, 1, 1, 'auto', seq(0.42, 0.5))
  assert.equal(result.tens_rolls.length, 1)
  assert.equal(result.final_result, 45)
})
check('target 0 can only critical on 1-5', () => {
  assert.equal(rules.resolveCheck(0, 0, 0, 'auto', seq(0.5, 0.5)).success_level, '失败')
})
check('invalid bonus dice throw', () => assert.throws(() => rules.resolveCheck(50, -1, 0)))

console.log('rules: push_roll')
check('push uses min(skill, 50)', () => {
  const result = rules.resolvePushRoll(80, seq(0.5, 0.5))
  assert.equal(result.target, 50)
  assert.equal(result.roll, 55)
  assert.equal(result.result, '大失败')
})
check('push success below target', () => {
  const result = rules.resolvePushRoll(40, seq(0.2, 0.4))
  assert.equal(result.roll, 24)
  assert.equal(result.result, '大成功')
})

console.log('rules: skill growth')
check('growth when d100 > current', () => {
  const result = rules.resolveSkillGrowth(40, seq(0.5, 0.5, 0.9))
  assert.deepEqual(result, { success: true, growth: 10, new_value: 50 })
})
check('no growth when d100 <= current', () => {
  const result = rules.resolveSkillGrowth(60, seq(0.5, 0.5))
  assert.deepEqual(result, { success: false, growth: 0, new_value: 60 })
})

console.log('rules: dice expressions')
check('parse 1d6', () => assert.deepEqual(rules.parseDiceExpression('1d6'), { count: 1, sides: 6, modifier: 0 }))
check('parse 2D10+3', () => assert.deepEqual(rules.parseDiceExpression('2D10+3'), { count: 2, sides: 10, modifier: 3 }))
check('parse d6', () => assert.deepEqual(rules.parseDiceExpression('d6'), { count: 1, sides: 6, modifier: 0 }))
check('parse plain 0', () => assert.deepEqual(rules.parseDiceExpression('0'), { count: 0, sides: 0, modifier: 0 }))
check('parse rejects 1d6+', () => assert.equal(rules.parseDiceExpression('1d6+'), null))
check('rollExpression 1d6 -> 1', () => assert.equal(rules.rollExpression('1d6', seq(0)), 1))
check('rollExpression 1d6+2 -> 8', () => assert.equal(rules.rollExpression('1d6+2', seq(0.999999)), 8))
check('rollExpression clamps at 0', () => assert.equal(rules.rollExpression('1d4-3', seq(0)), 0))
check('rollExpression rejects junk', () => assert.throws(() => rules.rollExpression('abc')))

console.log('rules: general dice notation')
check('multi-term notation', () => {
  const result = rules.rollDiceNotation('1D6+1D10+2', { rng: seq(0, 0.5) })
  assert.equal(result.total, 9)
  assert.equal(result.resolved_expression, '1D6+1D10+2')
  assert.equal(result.rolls.length, 3)
  assert.deepEqual(result.rolls[0].values, [1])
  assert.deepEqual(result.rolls[1].values, [6])
  assert.equal(result.rolls[2].subtotal, 2)
})
check('subtraction and multiple dice terms', () => {
  const result = rules.rollDiceNotation('2D6-1D4+3', { rng: seq(0, 0, 0, 0) })
  assert.equal(result.total, 4)
  assert.equal(result.resolved_expression, '2D6-1D4+3')
})
check('DB substitution with explicit expression', () => {
  const result = rules.rollDiceNotation('1D10+DB', { db: '+1D4', rng: seq(0, 0) })
  assert.equal(result.db, '+1D4')
  assert.equal(result.resolved_expression, '1D10+1D4')
  assert.deepEqual(result.rolls.map((roll) => roll.subtotal), [1, 1])
  assert.equal(result.total, 2)
})
check('DB is required when the expression uses it', () => assert.throws(() => rules.rollDiceNotation('1D6+DB')))
check('invalid notation throws', () => {
  assert.throws(() => rules.rollDiceNotation('1D6++2'))
  assert.throws(() => rules.rollDiceNotation('ABC'))
  assert.throws(() => rules.rollDiceNotation('1D6+'))
  assert.throws(() => rules.rollDiceNotation('1D1'))
})
check('damage bonus tiers', () => {
  assert.equal(rules.damageBonusFor(60), '-2')
  assert.equal(rules.damageBonusFor(80), '-1')
  assert.equal(rules.damageBonusFor(110), '0')
  assert.equal(rules.damageBonusFor(200), '+1D6')
  assert.equal(rules.damageBonusFor(300), '+3D6')
  assert.equal(rules.damageBonusFor(1150), '+13D6')
})
check('damage bonus from attributes', () => {
  assert.equal(rules.damageBonusForAttributes({ STR: '50', SIZ: '60' }), '0')
  assert.equal(rules.damageBonusForAttributes({ STR: 120, SIZ: 80 }), '+1D6')
  assert.equal(rules.damageBonusForAttributes({ STR: 60 }), null)
})
check('armor text parsing', () => {
  assert.deepEqual(rules.parseArmorText('2-毛发与厚皮'), { armor: 2, immunePhysical: false })
  assert.deepEqual(rules.parseArmorText('21点，包括超维度污泥与肌肉'), { armor: 21, immunePhysical: false })
  assert.deepEqual(rules.parseArmorText('无实体，免疫物理攻击'), { armor: 0, immunePhysical: true })
  assert.deepEqual(rules.parseArmorText('无'), { armor: 0, immunePhysical: false })
  assert.deepEqual(rules.parseArmorText(undefined), { armor: 0, immunePhysical: false })
})
check('health states', () => {
  assert.equal(rules.healthStatus(10, 10), '正常')
  assert.equal(rules.healthStatus(6, 10), '正常')
  assert.equal(rules.healthStatus(5, 10), '重伤')
  assert.equal(rules.healthStatus(1, 10), '重伤')
  assert.equal(rules.healthStatus(0, 10), '濒死')
  assert.equal(rules.healthStatus(-9, 10), '濒死')
  assert.equal(rules.healthStatus(-10, 10), '死亡')
})

console.log('data: madness tables')
check('table sizes', () => {
  assert.equal(madness.MADNESS_TABLES.ti.length, 10)
  assert.equal(madness.MADNESS_TABLES.li.length, 10)
  assert.equal(madness.FEAR_TABLE.length, 100)
  assert.equal(madness.MANIA_TABLE.length, 100)
})
check('roll sequences are contiguous', () => {
  for (const [key, table] of [['ti', madness.MADNESS_TABLES.ti], ['li', madness.MADNESS_TABLES.li], ['fear', madness.FEAR_TABLE], ['mania', madness.MANIA_TABLE]]) {
    table.forEach((entry, index) => {
      assert.equal(entry.roll, index + 1, `${key} roll at ${index}`)
      assert.ok(entry.symptom.length > 0, `${key} symptom at ${index}`)
    })
  }
})
check('rollMadness ti first row', () => {
  const draw = madness.rollMadness('ti', seq(0))
  assert.equal(draw.roll, 1)
  assert.match(draw.symptom, /^失忆：/)
})
check('rollMadness li last row', () => {
  const draw = madness.rollMadness('li', seq(0.999999))
  assert.equal(draw.roll, 10)
  assert.match(draw.symptom, /^躁狂：/)
})
check('rollFear 1D100 range', () => {
  assert.equal(madness.rollFear(seq(0.5)).roll, 51)
  assert.equal(madness.rollMania(seq(0)).roll, 1)
})
check('unknown madness table throws', () => assert.throws(() => madness.rollMadness('7r')))

console.log('db: schema and bestiary seed')
check('database file follows DSH_COC_KP_DB', () => assert.equal(db.resolveDbFile(), testDbFile))
check('bestiary seeds 253 templates', () => {
  const database = db.getDb()
  const count = database.prepare('SELECT COUNT(*) AS c FROM NPC_Templates').get().c
  assert.equal(count, 253)
})
check('拜亚基 template extraction', () => {
  const template = db.getNpcTemplate('拜亚基')
  assert.ok(template !== null)
  assert.equal(template.hp, 14)
  assert.equal(template.mp, 10)
  assert.equal(template.db, '+1D6')
  assert.equal(template.skills['爪击'], 35)
  assert.equal(template.skills['撕咬'], 35)
  assert.ok(String(template.attributes['分类']).includes('下级'))
})
check('reseed is idempotent', () => {
  const database = db.getDb()
  db.seedBestiary(database)
  assert.equal(database.prepare('SELECT COUNT(*) AS c FROM NPC_Templates').get().c, 253)
})
check('bestiary fuzzy search', () => assert.equal(db.searchNpcTemplates('修').length, 7))
check('bestiary category filter', () => {
  assert.equal(db.searchNpcTemplates('', '外神').length, 15)
  assert.equal(db.searchNpcTemplates('', '旧日支配者').length, 50)
})
check('bestiary full listing', () => assert.equal(db.searchNpcTemplates('').length, 253))
check('new creatures from 新怪物.json are present', () => {
  for (const name of ['克苏鲁', '星之彩', '夏塔克鸟', '炎之精', '达贡&许德拉', '克苏鲁星之眷族']) {
    assert.ok(db.getNpcTemplate(name) !== null, `missing ${name}`)
  }
  assert.equal(db.getNpcTemplate('克苏鲁').hp, 160)
  assert.equal(db.getNpcTemplate('克苏鲁').db, '+21D6')
})
check('新怪物.json wins for duplicate names', () => {
  const deepOne = db.getNpcTemplate('深潜者')
  assert.equal(deepOne.attributes['属性']['STR'], '4D6 (14)')
  assert.equal(deepOne.hp, 13)
})
check('four verified corrections keep the 7e stat blocks', () => {
  const ghatanothoa = db.getNpcTemplate('加塔诺托亚')
  assert.equal(ghatanothoa.hp, 110)
  assert.equal(ghatanothoa.db, '+13D6')
  assert.equal(ghatanothoa.build, 14)
  assert.equal(ghatanothoa.attributes['属性']['STR'], 450)
  assert.equal(ghatanothoa.attributes['咒文 / 特殊能力'], '所有召唤/控制及相关接触咒文。')
  const nyogtha = db.getNpcTemplate('尼约格达')
  assert.equal(nyogtha.hp, 60)
  assert.equal(nyogtha.build, 10)
  assert.equal(nyogtha.attributes['属性']['STR'], 425)
  const bast = db.getNpcTemplate('巴斯特')
  assert.equal(bast.hp, 18)
  assert.equal(bast.attributes['属性']['STR'], 240)
  const nodens = db.getNpcTemplate('诺登斯')
  assert.equal(nodens.hp, 30)
  assert.equal(nodens.attributes['属性']['STR'], 210)
})

console.log('db: weapon library seed')
check('weapon seed count', () => {
  const database = db.getDb()
  assert.equal(database.prepare('SELECT COUNT(*) AS c FROM Weapons').get().c, 26)
})
check('汤普森冲锋枪 fields', () => {
  const weapon = db.getWeapon('汤普森冲锋枪')
  assert.ok(weapon !== null)
  assert.equal(weapon.category, '冲锋枪与机枪')
  assert.equal(weapon.skill, '射击(冲锋枪)')
  assert.equal(weapon.damage, '1D10+2')
  assert.equal(weapon.impale, true)
  assert.equal(weapon.base_range, '20码')
  assert.equal(weapon.attacks_per_round, '1或全自动')
  assert.equal(weapon.ammo, '20/30/50')
  assert.equal(weapon.malfunction, 96)
})
check('徒手 fields', () => {
  const weapon = db.getWeapon('徒手')
  assert.equal(weapon.damage, '1D3')
  assert.equal(weapon.impale, false)
  assert.equal(weapon.ammo, '0')
  assert.equal(weapon.malfunction, 100)
})
check('fuzzy weapon search', () => assert.equal(db.searchWeapons('手枪').length, 5))
check('weapon category listing', () => assert.equal(db.listWeapons('爆炸物与重武器').length, 4))
check('unknown weapon is null', () => assert.equal(db.getWeapon('不存在武器'), null))
check('weapon seed is idempotent', () => {
  const database = db.getDb()
  db.seedWeapons(database)
  assert.equal(database.prepare('SELECT COUNT(*) AS c FROM Weapons').get().c, 26)
})

console.log('db: spell catalogue seed')
check('spell seed count', () => {
  const database = db.getDb()
  assert.equal(database.prepare('SELECT COUNT(*) AS c FROM Spells').get().c, 545)
})
check('被诅咒的眼 spell fields', () => {
  const spell = db.getSpell('被诅咒的眼')
  assert.ok(spell !== null)
  assert.equal(spell.category, '交流/加害')
  assert.equal(spell.cost.mp, '6')
  assert.equal(spell.cost.san, '1D4')
  assert.equal(spell.cost.pow, '无')
  assert.equal(spell.casting_time, '30分钟')
  assert.equal(spell.effect_mechanics.length, 5)
  assert.equal(spell.manual_review_needed, false)
  assert.equal(spell.raw_text, undefined)
})
check('manual review flag is preserved', () => {
  const spell = db.getSpell('阿布霍斯唤醒术')
  assert.ok(spell !== null)
  assert.equal(spell.manual_review_needed, true)
  assert.equal(typeof spell.raw_text, 'string')
  assert.ok(spell.raw_text.length > 0)
})
check('fuzzy spell search', () => assert.ok(db.searchSpells('召唤').length > 0))
check('unknown spell is null', () => assert.equal(db.getSpell('不存在法术'), null))
check('spell seed is idempotent', () => {
  const database = db.getDb()
  db.seedSpells(database)
  assert.equal(database.prepare('SELECT COUNT(*) AS c FROM Spells').get().c, 545)
})

console.log('db: characters')
check('create character derives pools from POW', () => {
  const created = db.createCharacter({
    char_name: '测试调查员',
    owner_qq: '12345',
    group_id: 'g1',
    attributes: { STR: 60, POW: 55 },
    skills: { 侦查: 60 },
  })
  assert.equal(created.hpmax, 10)
  assert.equal(created.hp, 10)
  assert.equal(created.sanmax, 55)
  assert.equal(created.san, 55)
  assert.equal(created.skills['侦查'], 60)
  assert.deepEqual(created.tags, [])
})
check('duplicate character throws', () =>
  assert.throws(() => db.createCharacter({ char_name: '测试调查员' }), /角色已存在/))
check('create with explicit pools', () => {
  const created = db.createCharacter({ char_name: '二号', hpmax: 12, hp: 9, mpmax: 6 })
  assert.equal(created.hpmax, 12)
  assert.equal(created.hp, 9)
  assert.equal(created.mpmax, 6)
  assert.equal(created.mp, 6)
})
check('get / update character', () => {
  db.updateCharacter('二号', { hp: 11, san: 40, tags: ['旧伤'] })
  const updated = db.getCharacter('二号')
  assert.equal(updated.hp, 11)
  assert.equal(updated.san, 40)
  assert.deepEqual(updated.tags, ['旧伤'])
})
check('missing character helpers throw', () => {
  assert.equal(db.getCharacter('不存在'), null)
  assert.throws(() => db.requireCharacter('不存在'), /角色不存在/)
})
check('SAN clamps at 0', () => {
  const updated = db.setCharacterSan('二号', -5)
  assert.equal(updated.san, 0)
})
check('skill update', () => {
  const updated = db.setCharacterSkill('二号', '聆听', 45)
  assert.equal(updated.skills['聆听'], 45)
})
check('tag set is deduplicated and trimmed', () => {
  const tags = db.setCharacterTags('二号', ['a', 'a', ' b ', ''])
  assert.deepEqual(tags, ['a', 'b'])
})
check('group list filters and empty group lists all', () => {
  assert.equal(db.listGroupCharacters('g1').length, 1)
  assert.equal(db.listGroupCharacters('g1')[0].char_name, '测试调查员')
  assert.equal(db.listGroupCharacters('').length, 2)
})
check('player row recorded', () => {
  const player = db.getPlayer('12345')
  assert.ok(player !== null)
  assert.equal(player.group_id, 'g1')
})
check('delete character', () => {
  db.deleteCharacter('二号')
  assert.equal(db.getCharacter('二号'), null)
  assert.throws(() => db.deleteCharacter('二号'))
})
check('broken JSON columns degrade safely', () => {
  const database = db.getDb()
  database.prepare("UPDATE Characters SET attributes = '{oops', skills = '{\"a\":1,\"b\":\"2\",\"c\":\"x\"}', tags = 'nope' WHERE char_name = '测试调查员'").run()
  const character = db.getCharacter('测试调查员')
  assert.deepEqual(character.attributes, {})
  assert.deepEqual(character.skills, { a: 1, b: 2 })
  assert.deepEqual(character.tags, [])
})

console.log('db: NPC templates and instances')
check('create custom template', () => {
  const template = db.createNpcTemplate('自定义怪物', { hp: 12, mp: 6, db: '+1D4', build: 1, skills: { 撕咬: 40 } })
  assert.equal(template.npc_name, '自定义怪物')
  assert.equal(template.hp, 12)
  assert.equal(template.skills['撕咬'], 40)
})
check('duplicate template throws', () => assert.throws(() => db.createNpcTemplate('自定义怪物', {}), /已存在/))
check('instantiate template', () => {
  const instance = db.createNpcInstance('拜亚基', 'b1')
  assert.equal(instance.instance_id, 'b1')
  assert.equal(instance.current_hp, 14)
  assert.equal(instance.current_mp, 10)
  assert.equal(instance.status, 'active')
})
check('auto-generated instance id', () => {
  const instance = db.createNpcInstance('深潜者')
  assert.match(instance.instance_id, /^深潜者-/)
})
check('duplicate instance throws', () => assert.throws(() => db.createNpcInstance('拜亚基', 'b1'), /已存在/))
check('instance missing template throws', () => assert.throws(() => db.createNpcInstance('不存在'), /模板不存在/))
check('hp change records dying and death states', () => {
  const dying = db.updateNpcInstanceHp('b1', -20)
  assert.equal(dying.current_hp, -6)
  assert.equal(dying.status, 'dying')
  const dead = db.updateNpcInstanceHp('b1', -8)
  assert.equal(dead.current_hp, -14)
  assert.equal(dead.status, 'dead')
  const healed = db.updateNpcInstanceHp('b1', 5)
  assert.equal(healed.current_hp, -9)
  assert.equal(healed.status, 'dying')
})
check('missing instance throws', () => {
  assert.equal(db.getNpcInstance('nope'), null)
  assert.throws(() => db.updateNpcInstanceHp('nope', -1), /实例不存在/)
})
check('hp_change must be a number', () => assert.throws(() => db.updateNpcInstanceHp('b1', Number.NaN)))

db.closeDatabase()
for (const suffix of ['', '-wal', '-shm']) rmSync(testDbFile + suffix, { force: true })

console.log(`\nSMOKE OK — ${checks} checks passed`)
