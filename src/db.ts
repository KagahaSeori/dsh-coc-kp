/**
 * SQLite persistence for the CoC 7e Keeper plugin.
 *
 * The database file lives at `<plugin dir>/data.db` (the package root, one level
 * above `dist/`), and `DSH_COC_KP_DB` overrides it for tests or deployments.
 * Every statement is synchronous (`better-sqlite3`), which matches the tool
 * pipeline: a tool call is a short, atomic request/response.
 *
 * Tables follow the task book, with two documented deviations:
 * - `Characters` splits the glued column names into `hpmax/hp`, `mpmax/mp`,
 *   `sanmax/san`.
 * - `NPC_Templates` stores the damage bonus as text (`+1D6`, `+2D6`, ...), because
 *   the official stat blocks express it as a dice term, not an integer.
 *
 * @module dsh-coc-kp/db
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { BESTIARY } from './data/bestiary.js'
import { SPELLS } from './data/spells.js'
import { WEAPONS } from './data/weapons.js'

/** Parsed character sheet stored in `Characters`. */
export interface CharacterRecord {
  char_name: string
  owner_qq: string
  group_id: string
  hpmax: number
  hp: number
  mpmax: number
  mp: number
  sanmax: number
  san: number
  attributes: Record<string, unknown>
  skills: Record<string, number>
  tags: string[]
}

/** Editable character fields (`manage_character` update). */
export interface CharacterPatch {
  owner_qq?: string
  group_id?: string
  hpmax?: number
  hp?: number
  mpmax?: number
  mp?: number
  sanmax?: number
  san?: number
  attributes?: Record<string, unknown>
  skills?: Record<string, number>
  tags?: string[]
}

/** Input of `manage_character` action `create`. */
export interface CharacterCreateInput extends CharacterPatch {
  char_name: string
}

/** Parsed NPC template stored in `NPC_Templates`. */
export interface NpcTemplateRecord {
  npc_name: string
  hp: number
  mp: number
  db: string
  build: number
  skills: Record<string, number>
  attributes: Record<string, unknown>
}

/** Parsed NPC instance stored in `NPC_Instances`. */
export interface NpcInstanceRecord {
  instance_id: string
  template_name: string
  current_hp: number
  current_mp: number
  status: string
}

/** One weapon of the built-in 武器库, stored in `Weapons`. */
export interface WeaponRecord {
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

/** Cost block of one spell. */
export interface SpellCostRecord {
  mp: string
  san: string
  pow: string
}

/** Roll mechanics block of one spell. */
export interface SpellRollRecord {
  caster_check: string
  opposed: string
}

/** One spell of the built-in catalogue, stored in `Spells`. */
export interface SpellRecord {
  spell_name: string
  category: string
  cost: SpellCostRecord
  casting_time: string
  roll_mechanics: SpellRollRecord
  effect_mechanics: string[]
  manual_review_needed: boolean
  raw_text?: string
}

/** JSON columns only ever expose records of this shape. */
const AttributesSchema = z.record(z.string(), z.unknown())
/** Skill values are numbers; junk entries are dropped instead of failing a tool call. */
const SkillsSchema = z.record(z.string(), z.number())
/** Tags are a JSON array of strings. */
const TagsSchema = z.array(z.string())

/** Absolute path of the database file for this deployment. */
export const DEFAULT_DB_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data.db')

/** The database file actually used: `DSH_COC_KP_DB` wins, otherwise `data.db` in the package root. */
export function resolveDbFile(): string {
  const override = process.env.DSH_COC_KP_DB?.trim()
  return override !== undefined && override.length > 0 ? override : DEFAULT_DB_FILE
}

let instance: Database.Database | undefined

/** Lazily open (and initialize) the shared database. */
export function getDb(): Database.Database {
  if (instance === undefined) instance = openDatabase(resolveDbFile())
  return instance
}

/** Close the shared database (used by tests that switch files). */
export function closeDatabase(): void {
  instance?.close()
  instance = undefined
}

/** Open one database file, enable pragmas, create tables, and seed the bestiary once. */
export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createSchema(db)
  seedBestiary(db)
  seedWeapons(db)
  seedSpells(db)
  return db
}

/** Create every table and index required by the two tool families. */
export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Players (
      qq_id TEXT PRIMARY KEY,
      group_id TEXT
    );

    CREATE TABLE IF NOT EXISTS Characters (
      char_name TEXT PRIMARY KEY,
      owner_qq TEXT NOT NULL DEFAULT '',
      group_id TEXT NOT NULL DEFAULT '',
      hpmax INTEGER NOT NULL DEFAULT 10,
      hp INTEGER NOT NULL DEFAULT 10,
      mpmax INTEGER NOT NULL DEFAULT 10,
      mp INTEGER NOT NULL DEFAULT 10,
      sanmax INTEGER NOT NULL DEFAULT 50,
      san INTEGER NOT NULL DEFAULT 50,
      attributes TEXT NOT NULL DEFAULT '{}',
      skills TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS NPC_Templates (
      npc_name TEXT PRIMARY KEY,
      hp INTEGER NOT NULL DEFAULT 10,
      mp INTEGER NOT NULL DEFAULT 10,
      db TEXT NOT NULL DEFAULT '+0',
      build INTEGER NOT NULL DEFAULT 0,
      skills TEXT NOT NULL DEFAULT '{}',
      attributes TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS NPC_Instances (
      instance_id TEXT PRIMARY KEY,
      template_name TEXT NOT NULL,
      current_hp INTEGER NOT NULL,
      current_mp INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS Meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Weapons (
      weapon_name TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      skill TEXT NOT NULL DEFAULT '',
      damage TEXT NOT NULL DEFAULT '',
      impale INTEGER NOT NULL DEFAULT 0,
      base_range TEXT NOT NULL DEFAULT '',
      attacks_per_round TEXT NOT NULL DEFAULT '',
      ammo TEXT NOT NULL DEFAULT '',
      malfunction INTEGER NOT NULL DEFAULT 100,
      attributes TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS Spells (
      spell_name TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      casting_time TEXT NOT NULL DEFAULT '',
      cost TEXT NOT NULL DEFAULT '{}',
      roll_mechanics TEXT NOT NULL DEFAULT '{}',
      effect_mechanics TEXT NOT NULL DEFAULT '[]',
      manual_review_needed INTEGER NOT NULL DEFAULT 0,
      raw_text TEXT NOT NULL DEFAULT '',
      attributes TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_characters_group ON Characters(group_id);
    CREATE INDEX IF NOT EXISTS idx_instances_template ON NPC_Instances(template_name);
    CREATE INDEX IF NOT EXISTS idx_weapons_category ON Weapons(category);
    CREATE INDEX IF NOT EXISTS idx_spells_category ON Spells(category);
  `)
}

/** Bump when `src/data/bestiary.ts` gains creatures, so existing databases pick them up. */
const BESTIARY_SEED_VERSION = '3'

/**
 * Copy the built-in bestiary into `NPC_Templates`, once per seed version.
 *
 * On a version bump every built-in row is overwritten (upsert), so correcting a
 * stat block or switching a duplicate to the newer export reaches existing
 * databases. Templates are read-only through the tools, so there are no user
 * edits to preserve here.
 */
export function seedBestiary(db: Database.Database): void {
  const row = db.prepare(`SELECT value FROM Meta WHERE key = 'bestiary_seed_version'`).get() as
    | { value: string }
    | undefined
  if (row?.value === BESTIARY_SEED_VERSION) return
  const insert = db.prepare(
    `INSERT INTO NPC_Templates (npc_name, hp, mp, db, build, skills, attributes)
     VALUES (@npc_name, @hp, @mp, @db, @build, @skills, @attributes)
     ON CONFLICT(npc_name) DO UPDATE SET
       hp = excluded.hp,
       mp = excluded.mp,
       db = excluded.db,
       build = excluded.build,
       skills = excluded.skills,
       attributes = excluded.attributes`,
  )
  const seed = db.transaction((creatures: typeof BESTIARY) => {
    for (const creature of creatures) {
      const stats = templateStats(creature.data)
      insert.run({
        npc_name: creature.npc_name,
        hp: stats.hp,
        mp: stats.mp,
        db: stats.db,
        build: stats.build,
        skills: JSON.stringify(stats.skills),
        attributes: JSON.stringify(creature.data),
      })
    }
    db.prepare(`INSERT INTO Meta (key, value) VALUES ('bestiary_seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      BESTIARY_SEED_VERSION,
    )
  })
  seed(BESTIARY)
}

/** First integer found in a raw stat value such as `14-15`, `30` or `"无法计算"`. */
function firstNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string') return undefined
  const match = /-?\d+/.exec(value.replace(/,/g, ''))
  return match === null ? undefined : Number(match[0])
}

/** Read one 衍生 field, descending into per-form sub-objects (黑公牛 has 类人/巨牛 forms). */
function derivedValue(data: Readonly<Record<string, unknown>>, key: string): unknown {
  const derived = data['衍生']
  if (derived === null || typeof derived !== 'object' || Array.isArray(derived)) return undefined
  const record = derived as Record<string, unknown>
  if (key in record) return record[key]
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key]
    }
  }
  return undefined
}

/** Extract the numeric template columns and the skill percentages from one bestiary block. */
function templateStats(data: Readonly<Record<string, unknown>>): {
  hp: number
  mp: number
  db: string
  build: number
  skills: Record<string, number>
} {
  const rawDb = derivedValue(data, 'DB')
  const db = typeof rawDb === 'number' ? String(rawDb) : typeof rawDb === 'string' ? rawDb : '+0'
  const skills: Record<string, number> = {}
  const combat = data['战斗']
  if (combat !== null && typeof combat === 'object' && !Array.isArray(combat)) {
    for (const [name, text] of Object.entries(combat as Record<string, unknown>)) {
      if (typeof text !== 'string') continue
      const match = /(\d+)\s*%/.exec(text)
      if (match !== null) skills[name] = Number(match[1])
    }
  }
  return {
    hp: firstNumber(derivedValue(data, 'HP')) ?? 10,
    mp: firstNumber(derivedValue(data, 'MP')) ?? 10,
    db,
    build: firstNumber(derivedValue(data, 'Build')) ?? 0,
    skills,
  }
}

/** JSON.parse a TEXT column, returning `fallback` for null/broken values. */
function parseJsonColumn(text: string | null | undefined): unknown {
  if (text === null || text === undefined || text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Parse the `attributes` JSON column into a plain object. */
function parseAttributes(text: string | null | undefined): Record<string, unknown> {
  const parsed = AttributesSchema.safeParse(parseJsonColumn(text))
  return parsed.success ? parsed.data : {}
}

/** Parse the `skills` JSON column, coercing numeric strings and dropping junk entries. */
function parseSkills(text: string | null | undefined): Record<string, number> {
  const value = parseJsonColumn(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    if (Number.isFinite(number)) normalized[key] = number
  }
  const parsed = SkillsSchema.safeParse(normalized)
  return parsed.success ? parsed.data : {}
}

/** Parse the `tags` JSON column into a string array. */
function parseTags(text: string | null | undefined): string[] {
  const parsed = TagsSchema.safeParse(parseJsonColumn(text))
  return parsed.success ? parsed.data : []
}

/** Raw SQLite row of `Characters`. */
interface CharacterRow {
  char_name: string
  owner_qq: string
  group_id: string
  hpmax: number
  hp: number
  mpmax: number
  mp: number
  sanmax: number
  san: number
  attributes: string
  skills: string
  tags: string
}

/** Map one SQLite row to the public character record. */
function toCharacter(row: CharacterRow): CharacterRecord {
  return {
    char_name: row.char_name,
    owner_qq: row.owner_qq,
    group_id: row.group_id,
    hpmax: row.hpmax,
    hp: row.hp,
    mpmax: row.mpmax,
    mp: row.mp,
    sanmax: row.sanmax,
    san: row.san,
    attributes: parseAttributes(row.attributes),
    skills: parseSkills(row.skills),
    tags: parseTags(row.tags),
  }
}

/** Read one character, or null when it does not exist. */
export function getCharacter(charName: string): CharacterRecord | null {
  const row = getDb().prepare('SELECT * FROM Characters WHERE char_name = ?').get(charName) as CharacterRow | undefined
  return row === undefined ? null : toCharacter(row)
}

/** Read one character and throw a readable error when it is missing. */
export function requireCharacter(charName: string): CharacterRecord {
  const character = getCharacter(charName)
  if (character === null) throw new Error(`角色不存在: ${charName}`)
  return character
}

/** Every character of one group (pass an empty string for all groups). */
export function listGroupCharacters(groupId: string): CharacterRecord[] {
  const db = getDb()
  const rows =
    groupId.length > 0
      ? (db.prepare('SELECT * FROM Characters WHERE group_id = ? ORDER BY char_name').all(groupId) as CharacterRow[])
      : (db.prepare('SELECT * FROM Characters ORDER BY char_name').all() as CharacterRow[])
  return rows.map(toCharacter)
}

/** Validate a numeric sheet field before it reaches SQLite. */
function requireStat(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是数字: ${String(value)}`)
  return Math.max(0, Math.trunc(value))
}

/** Derive the max/current pairs so a sheet can be created from partial input. */
function derivePools(
  input: CharacterPatch,
  attributes: Record<string, unknown>,
): { hpmax: number; hp: number; mpmax: number; mp: number; sanmax: number; san: number } {
  const hpmax = requireStat(input.hpmax, 'hpmax') ?? requireStat(input.hp, 'hp') ?? 10
  const hp = requireStat(input.hp, 'hp') ?? hpmax
  const mpmax = requireStat(input.mpmax, 'mpmax') ?? requireStat(input.mp, 'mp') ?? 10
  const mp = requireStat(input.mp, 'mp') ?? mpmax
  const pow = typeof attributes['POW'] === 'number' ? Math.trunc(attributes['POW'] as number) : undefined
  // CoC 7e: SAN starts at POW (7th edition is 1:1, not the older POW×5).
  const sanBase = pow !== undefined && pow >= 0 ? Math.min(pow, 99) : 50
  const sanmax = requireStat(input.sanmax, 'sanmax') ?? requireStat(input.san, 'san') ?? sanBase
  const san = requireStat(input.san, 'san') ?? sanmax
  return { hpmax, hp, mpmax, mp, sanmax, san }
}

/** Remember which player owns which character within a group. */
export function upsertPlayer(qqId: string, groupId: string): void {
  if (qqId.length === 0) return
  getDb()
    .prepare(
      `INSERT INTO Players (qq_id, group_id) VALUES (?, ?)
       ON CONFLICT(qq_id) DO UPDATE SET group_id = excluded.group_id`,
    )
    .run(qqId, groupId)
}

/** Read one player row. */
export function getPlayer(qqId: string): { qq_id: string; group_id: string } | null {
  const row = getDb().prepare('SELECT qq_id, group_id FROM Players WHERE qq_id = ?').get(qqId) as
    | { qq_id: string; group_id: string }
    | undefined
  return row ?? null
}

/** Insert a new character sheet; throws when the name is taken. */
export function createCharacter(input: CharacterCreateInput): CharacterRecord {
  const charName = input.char_name.trim()
  if (charName.length === 0) throw new Error('角色名不能为空')
  const db = getDb()
  if (getCharacter(charName) !== null) throw new Error(`角色已存在: ${charName}`)
  const attributes = input.attributes ?? {}
  const skills = input.skills ?? {}
  const tags = input.tags ?? []
  const pools = derivePools(input, attributes)
  db.prepare(
    `INSERT INTO Characters
       (char_name, owner_qq, group_id, hpmax, hp, mpmax, mp, sanmax, san, attributes, skills, tags)
     VALUES
       (@char_name, @owner_qq, @group_id, @hpmax, @hp, @mpmax, @mp, @sanmax, @san, @attributes, @skills, @tags)`,
  ).run({
    char_name: charName,
    owner_qq: input.owner_qq ?? '',
    group_id: input.group_id ?? '',
    ...pools,
    attributes: JSON.stringify(attributes),
    skills: JSON.stringify(skills),
    tags: JSON.stringify(tags),
  })
  if ((input.owner_qq ?? '').length > 0) upsertPlayer(input.owner_qq ?? '', input.group_id ?? '')
  return requireCharacter(charName)
}

/** Patch the provided fields of an existing sheet. */
export function updateCharacter(charName: string, patch: CharacterPatch): CharacterRecord {
  const current = requireCharacter(charName)
  const next: CharacterRecord = {
    ...current,
    owner_qq: patch.owner_qq ?? current.owner_qq,
    group_id: patch.group_id ?? current.group_id,
    hpmax: requireStat(patch.hpmax, 'hpmax') ?? current.hpmax,
    hp: requireStat(patch.hp, 'hp') ?? current.hp,
    mpmax: requireStat(patch.mpmax, 'mpmax') ?? current.mpmax,
    mp: requireStat(patch.mp, 'mp') ?? current.mp,
    sanmax: requireStat(patch.sanmax, 'sanmax') ?? current.sanmax,
    san: requireStat(patch.san, 'san') ?? current.san,
    attributes: patch.attributes ?? current.attributes,
    skills: patch.skills ?? current.skills,
    tags: patch.tags ?? current.tags,
  }
  getDb()
    .prepare(
      `UPDATE Characters SET owner_qq = @owner_qq, group_id = @group_id, hpmax = @hpmax, hp = @hp,
         mpmax = @mpmax, mp = @mp, sanmax = @sanmax, san = @san, attributes = @attributes,
         skills = @skills, tags = @tags
       WHERE char_name = @char_name`,
    )
    .run({
      char_name: charName,
      owner_qq: next.owner_qq,
      group_id: next.group_id,
      hpmax: next.hpmax,
      hp: next.hp,
      mpmax: next.mpmax,
      mp: next.mp,
      sanmax: next.sanmax,
      san: next.san,
      attributes: JSON.stringify(next.attributes),
      skills: JSON.stringify(next.skills),
      tags: JSON.stringify(next.tags),
    })
  if (next.owner_qq.length > 0) upsertPlayer(next.owner_qq, next.group_id)
  return requireCharacter(charName)
}

/** Delete one character sheet; throws when it does not exist. */
export function deleteCharacter(charName: string): void {
  requireCharacter(charName)
  getDb().prepare('DELETE FROM Characters WHERE char_name = ?').run(charName)
}

/** Persist one new SAN value (clamped at 0) and return the sheet. */
export function setCharacterSan(charName: string, san: number): CharacterRecord {
  requireCharacter(charName)
  const next = Math.max(0, Math.trunc(san))
  getDb().prepare('UPDATE Characters SET san = ? WHERE char_name = ?').run(next, charName)
  return requireCharacter(charName)
}

/** Persist one new skill value and return the sheet. */
export function setCharacterSkill(charName: string, skillName: string, value: number): CharacterRecord {
  const character = requireCharacter(charName)
  const next = Math.max(0, Math.trunc(value))
  const skills = { ...character.skills, [skillName]: next }
  getDb().prepare('UPDATE Characters SET skills = ? WHERE char_name = ?').run(JSON.stringify(skills), charName)
  return requireCharacter(charName)
}

/** Persist the whole tag list and return it. */
export function setCharacterTags(charName: string, tags: string[]): string[] {
  requireCharacter(charName)
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
  getDb().prepare('UPDATE Characters SET tags = ? WHERE char_name = ?').run(JSON.stringify(unique), charName)
  return unique
}

/** Raw SQLite row of `NPC_Templates`. */
interface TemplateRow {
  npc_name: string
  hp: number
  mp: number
  db: string
  build: number
  skills: string
  attributes: string
}

/** Map one template row to the public record. */
function toTemplate(row: TemplateRow): NpcTemplateRecord {
  return {
    npc_name: row.npc_name,
    hp: row.hp,
    mp: row.mp,
    db: row.db,
    build: row.build,
    skills: parseSkills(row.skills),
    attributes: parseAttributes(row.attributes),
  }
}

/** Read one NPC template, or null. */
export function getNpcTemplate(npcName: string): NpcTemplateRecord | null {
  const row = getDb().prepare('SELECT * FROM NPC_Templates WHERE npc_name = ?').get(npcName) as TemplateRow | undefined
  return row === undefined ? null : toTemplate(row)
}

/** Read one NPC template and throw when it is missing. */
export function requireNpcTemplate(npcName: string): NpcTemplateRecord {
  const template = getNpcTemplate(npcName)
  if (template === null) throw new Error(`NPC 模板不存在: ${npcName}`)
  return template
}

/** Every known NPC template name. */
export function listNpcTemplates(): NpcTemplateRecord[] {
  const rows = getDb().prepare('SELECT * FROM NPC_Templates ORDER BY npc_name').all() as TemplateRow[]
  return rows.map(toTemplate)
}

/**
 * Bestiary lookup: templates whose name contains `query` (empty means all),
 * optionally filtered by a substring of the 分类 field stored in `attributes`.
 */
export function searchNpcTemplates(query: string, category = ''): NpcTemplateRecord[] {
  const db = getDb()
  const rows =
    query.length > 0
      ? (db
          .prepare("SELECT * FROM NPC_Templates WHERE npc_name LIKE ? ESCAPE '\\' ORDER BY npc_name")
          .all(likePattern(query)) as TemplateRow[])
      : (db.prepare('SELECT * FROM NPC_Templates ORDER BY npc_name').all() as TemplateRow[])
  const templates = rows.map(toTemplate)
  if (category.length === 0) return templates
  return templates.filter((template) => {
    const raw = template.attributes['分类']
    return typeof raw === 'string' && raw.includes(category)
  })
}

/** Insert a custom NPC template; throws when the name is taken. */
export function createNpcTemplate(npcName: string, input: Partial<NpcTemplateRecord>): NpcTemplateRecord {
  const name = npcName.trim()
  if (name.length === 0) throw new Error('NPC 名称不能为空')
  if (getNpcTemplate(name) !== null) throw new Error(`NPC 模板已存在: ${name}`)
  getDb()
    .prepare(
      `INSERT INTO NPC_Templates (npc_name, hp, mp, db, build, skills, attributes)
       VALUES (@npc_name, @hp, @mp, @db, @build, @skills, @attributes)`,
    )
    .run({
      npc_name: name,
      hp: Math.max(0, Math.trunc(input.hp ?? 10)),
      mp: Math.max(0, Math.trunc(input.mp ?? 10)),
      db: input.db ?? '+0',
      build: Math.max(0, Math.trunc(input.build ?? 0)),
      skills: JSON.stringify(input.skills ?? {}),
      attributes: JSON.stringify(input.attributes ?? {}),
    })
  return requireNpcTemplate(name)
}

/** Raw SQLite row of `NPC_Instances`. */
interface InstanceRow {
  instance_id: string
  template_name: string
  current_hp: number
  current_mp: number
  status: string
}

/** Map one instance row to the public record. */
function toInstance(row: InstanceRow): NpcInstanceRecord {
  return {
    instance_id: row.instance_id,
    template_name: row.template_name,
    current_hp: row.current_hp,
    current_mp: row.current_mp,
    status: row.status,
  }
}

/** Read one NPC instance, or null. */
export function getNpcInstance(instanceId: string): NpcInstanceRecord | null {
  const row = getDb().prepare('SELECT * FROM NPC_Instances WHERE instance_id = ?').get(instanceId) as
    | InstanceRow
    | undefined
  return row === undefined ? null : toInstance(row)
}

/** Read one NPC instance and throw when it is missing. */
export function requireNpcInstance(instanceId: string): NpcInstanceRecord {
  const instance = getNpcInstance(instanceId)
  if (instance === null) throw new Error(`NPC 实例不存在: ${instanceId}`)
  return instance
}

/** Spawn one NPC instance from a template, at full HP/MP. */
export function createNpcInstance(templateName: string, instanceId?: string): NpcInstanceRecord {
  const template = requireNpcTemplate(templateName)
  const id = instanceId?.trim() ?? ''
  const finalId = id.length > 0 ? id : `${templateName}-${randomUUID().slice(0, 8)}`
  if (getNpcInstance(finalId) !== null) throw new Error(`NPC 实例已存在: ${finalId}`)
  getDb()
    .prepare(
      `INSERT INTO NPC_Instances (instance_id, template_name, current_hp, current_mp, status)
       VALUES (?, ?, ?, ?, 'active')`,
    )
    .run(finalId, template.npc_name, template.hp, template.mp)
  return requireNpcInstance(finalId)
}

/**
 * Apply an HP delta to one instance. `hpChange` is a delta: a negative number
 * deals damage, a positive number heals. HP is clamped at 0 and the status
 * becomes `dead` at 0 HP, `active` above it.
 */
export function updateNpcInstanceHp(instanceId: string, hpChange: number): NpcInstanceRecord {
  if (!Number.isFinite(hpChange)) throw new Error(`hp_change 必须是数字: ${String(hpChange)}`)
  const instance = requireNpcInstance(instanceId)
  const delta = Math.trunc(hpChange)
  const hp = Math.max(0, instance.current_hp + delta)
  const status = hp <= 0 ? 'dead' : 'active'
  getDb().prepare('UPDATE NPC_Instances SET current_hp = ?, status = ? WHERE instance_id = ?').run(hp, status, instanceId)
  return requireNpcInstance(instanceId)
}

/** Read a Meta value, or undefined when the key was never written. */
function metaValue(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM Meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

/** Write (upsert) one Meta value. */
function setMetaValue(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO Meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

/** Escape LIKE wildcards so a weapon/spell query is matched literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** Bump when `src/data/weapons.ts` gains entries, so existing databases pick them up. */
const WEAPONS_SEED_VERSION = '1'

/** Copy the built-in weapon library into `Weapons`, once per seed version. */
export function seedWeapons(db: Database.Database): void {
  if (metaValue(db, 'weapons_seed_version') === WEAPONS_SEED_VERSION) return
  const insert = db.prepare(
    `INSERT OR IGNORE INTO Weapons
       (weapon_name, category, skill, damage, impale, base_range, attacks_per_round, ammo, malfunction, attributes)
     VALUES
       (@weapon_name, @category, @skill, @damage, @impale, @base_range, @attacks_per_round, @ammo, @malfunction, @attributes)`,
  )
  db.transaction((entries: typeof WEAPONS) => {
    for (const weapon of entries) {
      insert.run({
        weapon_name: weapon.weapon_name,
        category: weapon.category,
        skill: weapon.skill,
        damage: weapon.damage,
        impale: weapon.impale ? 1 : 0,
        base_range: weapon.base_range,
        attacks_per_round: weapon.attacks_per_round,
        ammo: weapon.ammo,
        malfunction: weapon.malfunction,
        attributes: JSON.stringify(weapon),
      })
    }
    setMetaValue(db, 'weapons_seed_version', WEAPONS_SEED_VERSION)
  })(WEAPONS)
}

/** Raw SQLite row of `Weapons`. */
interface WeaponRow {
  weapon_name: string
  category: string
  skill: string
  damage: string
  impale: number
  base_range: string
  attacks_per_round: string
  ammo: string
  malfunction: number
  attributes: string
}

/** Map one weapon row to the public record. */
function toWeapon(row: WeaponRow): WeaponRecord {
  return {
    weapon_name: row.weapon_name,
    category: row.category,
    skill: row.skill,
    damage: row.damage,
    impale: row.impale === 1,
    base_range: row.base_range,
    attacks_per_round: row.attacks_per_round,
    ammo: row.ammo,
    malfunction: row.malfunction,
  }
}

/** Read one weapon by exact name, or null. */
export function getWeapon(weaponName: string): WeaponRecord | null {
  const row = getDb().prepare('SELECT * FROM Weapons WHERE weapon_name = ?').get(weaponName) as WeaponRow | undefined
  return row === undefined ? null : toWeapon(row)
}

/** Every weapon, optionally limited to one category. */
export function listWeapons(category = ''): WeaponRecord[] {
  const db = getDb()
  const rows =
    category.length > 0
      ? (db.prepare('SELECT * FROM Weapons WHERE category = ? ORDER BY weapon_name').all(category) as WeaponRow[])
      : (db.prepare('SELECT * FROM Weapons ORDER BY weapon_name').all() as WeaponRow[])
  return rows.map(toWeapon)
}

/** Weapons whose name contains `query`, optionally limited to one category. */
export function searchWeapons(query: string, category = ''): WeaponRecord[] {
  const db = getDb()
  const rows =
    category.length > 0
      ? (db
          .prepare("SELECT * FROM Weapons WHERE weapon_name LIKE ? ESCAPE '\\' AND category = ? ORDER BY weapon_name")
          .all(likePattern(query), category) as WeaponRow[])
      : (db
          .prepare("SELECT * FROM Weapons WHERE weapon_name LIKE ? ESCAPE '\\' ORDER BY weapon_name")
          .all(likePattern(query)) as WeaponRow[])
  return rows.map(toWeapon)
}

/** Bump when `src/data/spells.ts` gains or changes entries. */
const SPELLS_SEED_VERSION = '1'

/** Copy the built-in spell catalogue into `Spells`, once per seed version. */
export function seedSpells(db: Database.Database): void {
  if (metaValue(db, 'spells_seed_version') === SPELLS_SEED_VERSION) return
  const insert = db.prepare(
    `INSERT OR IGNORE INTO Spells
       (spell_name, category, casting_time, cost, roll_mechanics, effect_mechanics, manual_review_needed, raw_text, attributes)
     VALUES
       (@spell_name, @category, @casting_time, @cost, @roll_mechanics, @effect_mechanics, @manual_review_needed, @raw_text, @attributes)`,
  )
  db.transaction((entries: typeof SPELLS) => {
    for (const spell of entries) {
      insert.run({
        spell_name: spell.spell_name,
        category: spell.category,
        casting_time: spell.casting_time,
        cost: JSON.stringify(spell.cost),
        roll_mechanics: JSON.stringify(spell.roll_mechanics),
        effect_mechanics: JSON.stringify(spell.effect_mechanics),
        manual_review_needed: spell.manual_review_needed === true ? 1 : 0,
        raw_text: spell.raw_text ?? '',
        attributes: JSON.stringify(spell),
      })
    }
    setMetaValue(db, 'spells_seed_version', SPELLS_SEED_VERSION)
  })(SPELLS)
}

/** Coerce a JSON value to a display string. */
function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return String(value)
}

/** Parse the spell `cost` JSON column into its three parts. */
function parseSpellCost(text: string | null | undefined): SpellCostRecord {
  const value = parseJsonColumn(text) as Record<string, unknown> | undefined
  if (value === undefined || value === null || typeof value !== 'object') return { mp: '', san: '', pow: '' }
  return { mp: asString(value['mp']), san: asString(value['san']), pow: asString(value['pow']) }
}

/** Parse the spell `roll_mechanics` JSON column. */
function parseSpellRoll(text: string | null | undefined): SpellRollRecord {
  const value = parseJsonColumn(text) as Record<string, unknown> | undefined
  if (value === undefined || value === null || typeof value !== 'object') return { caster_check: '', opposed: '' }
  return { caster_check: asString(value['caster_check']), opposed: asString(value['opposed']) }
}

/** Parse the spell `effect_mechanics` JSON array. */
function parseStringList(text: string | null | undefined): string[] {
  const parsed = z.array(z.string()).safeParse(parseJsonColumn(text))
  return parsed.success ? parsed.data : []
}

/** Raw SQLite row of `Spells`. */
interface SpellRow {
  spell_name: string
  category: string
  casting_time: string
  cost: string
  roll_mechanics: string
  effect_mechanics: string
  manual_review_needed: number
  raw_text: string
  attributes: string
}

/** Map one spell row to the public record. */
function toSpell(row: SpellRow): SpellRecord {
  const record: SpellRecord = {
    spell_name: row.spell_name,
    category: row.category,
    cost: parseSpellCost(row.cost),
    casting_time: row.casting_time,
    roll_mechanics: parseSpellRoll(row.roll_mechanics),
    effect_mechanics: parseStringList(row.effect_mechanics),
    manual_review_needed: row.manual_review_needed === 1,
  }
  if (row.raw_text.length > 0) record.raw_text = row.raw_text
  return record
}

/** Read one spell by exact name, or null. */
export function getSpell(spellName: string): SpellRecord | null {
  const row = getDb().prepare('SELECT * FROM Spells WHERE spell_name = ?').get(spellName) as SpellRow | undefined
  return row === undefined ? null : toSpell(row)
}

/** Every spell, optionally limited to one category. */
export function listSpells(category = ''): SpellRecord[] {
  const db = getDb()
  const rows =
    category.length > 0
      ? (db.prepare('SELECT * FROM Spells WHERE category = ? ORDER BY spell_name').all(category) as SpellRow[])
      : (db.prepare('SELECT * FROM Spells ORDER BY spell_name').all() as SpellRow[])
  return rows.map(toSpell)
}

/** Spells whose name contains `query`. */
export function searchSpells(query: string): SpellRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM Spells WHERE spell_name LIKE ? ESCAPE '\\' ORDER BY spell_name")
    .all(likePattern(query)) as SpellRow[]
  return rows.map(toSpell)
}
