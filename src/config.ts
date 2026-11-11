/**
 * Local, git-ignored KP identity configuration.
 *
 * The plugin reads `kp.config.json` from its package root (the same folder as
 * `data.db`) so each operator can keep their own KP QQ number and in-group
 * nickname out of the repository. `DSH_COC_KP_CONFIG` points at another file,
 * which the tests use to stay isolated.
 *
 * Values are optional: an empty/missing file simply falls back to the plugin
 * configuration (`kp_qq_id`) and then to the `KP_QQ_ID` environment variable.
 *
 * @module dsh-coc-kp/config
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Shape accepted by `kp.config.json`. */
export interface LocalKpConfig {
  /** QQ number allowed to create NPC templates (team keeper). */
  kp_qq_id?: string
  /** The keeper's nickname inside the QQ group; shown in tool descriptions. */
  kp_nickname?: string
}

/** Package root (one level above `dist/`). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Default local config file: `<plugin dir>/kp.config.json`. */
export const DEFAULT_LOCAL_CONFIG_FILE = resolve(PACKAGE_ROOT, 'kp.config.json')

/** The local config file actually used (`DSH_COC_KP_CONFIG` wins). */
export function resolveLocalConfigFile(): string {
  const override = process.env.DSH_COC_KP_CONFIG?.trim()
  return override !== undefined && override.length > 0 ? override : DEFAULT_LOCAL_CONFIG_FILE
}

/**
 * Load the local KP config. Any unreadable, missing or malformed file yields an
 * empty object; a bad local file must never stop the plugin from activating.
 */
export function loadLocalKpConfig(): LocalKpConfig {
  let raw: string
  try {
    raw = readFileSync(resolveLocalConfigFile(), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const result: LocalKpConfig = {}
  const qqId = typeof record['kp_qq_id'] === 'string' ? record['kp_qq_id'].trim() : ''
  const nickname = typeof record['kp_nickname'] === 'string' ? record['kp_nickname'].trim() : ''
  if (qqId.length > 0) result.kp_qq_id = qqId
  if (nickname.length > 0) result.kp_nickname = nickname
  return result
}
