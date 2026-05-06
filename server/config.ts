import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type ScribepadHost = '127.0.0.1' | 'localhost'

export interface ScribepadConfig {
  initialIdleMs: number
  activeIdleMs: number
  host: ScribepadHost
}

export const DEFAULT_CONFIG: ScribepadConfig = {
  initialIdleMs: 10 * 60_000,
  activeIdleMs: 3 * 60_000,
  host: '127.0.0.1',
}

type PartialConfig = Partial<ScribepadConfig>

const KNOWN_KEYS = new Set(['initialIdleMs', 'activeIdleMs', 'host'])

export async function loadConfig(options: {
  env: NodeJS.ProcessEnv
  repoRoot: string
}): Promise<ScribepadConfig> {
  const { env, repoRoot } = options
  const config = mergeConfig(
    DEFAULT_CONFIG,
    await readOptionalConfig(resolveUserConfigPath(env), 'user config'),
    await readOptionalConfig(resolveProjectConfigPath(repoRoot), 'project config'),
    await readOptionalConfig(resolveProjectLocalConfigPath(repoRoot), 'project local config'),
    env.SCRIBEPAD_CONFIG
      ? await readRequiredConfig(resolve(env.SCRIBEPAD_CONFIG), 'SCRIBEPAD_CONFIG')
      : {},
    readEnvConfig(env),
  )
  return validateConfig(config, 'merged config')
}

export function resolveUserConfigPath(env: NodeJS.ProcessEnv): string {
  const configHome = env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(homedir(), '.config')
  return join(configHome, 'scribepad', 'config.json')
}

export function resolveProjectConfigPath(repoRoot: string): string {
  return join(repoRoot, '.scribepad', 'config.json')
}

export function resolveProjectLocalConfigPath(repoRoot: string): string {
  return join(repoRoot, '.scribepad', 'config.local.json')
}

function readEnvConfig(env: NodeJS.ProcessEnv): PartialConfig {
  const config: PartialConfig = {}
  if (env.SCRIBEPAD_HOST !== undefined) {
    config.host = env.SCRIBEPAD_HOST as ScribepadHost
  }
  return config
}

async function readOptionalConfig(path: string, label: string): Promise<PartialConfig> {
  try {
    return await readRequiredConfig(path, label)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw e
  }
}

async function readRequiredConfig(path: string, label: string): Promise<PartialConfig> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e
    throw new Error(`[scribepad] invalid ${label} at ${path}: ${(e as Error).message}`)
  }
  return validatePartialConfig(parsed, `${label} at ${path}`)
}

function validatePartialConfig(value: unknown, label: string): PartialConfig {
  if (!isRecord(value)) {
    throw new Error(`[scribepad] invalid ${label}: expected JSON object`)
  }

  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) {
      console.warn(`[scribepad] unknown config key in ${label}: ${key}`)
    }
  }

  const config: PartialConfig = {}
  if ('initialIdleMs' in value) {
    config.initialIdleMs = validateIdleMs(value.initialIdleMs, `${label}.initialIdleMs`)
  }
  if ('activeIdleMs' in value) {
    config.activeIdleMs = validateIdleMs(value.activeIdleMs, `${label}.activeIdleMs`)
  }
  if ('host' in value) {
    config.host = validateHost(value.host, `${label}.host`)
  }
  return config
}

function validateConfig(value: ScribepadConfig, label: string): ScribepadConfig {
  return {
    initialIdleMs: validateIdleMs(value.initialIdleMs, `${label}.initialIdleMs`),
    activeIdleMs: validateIdleMs(value.activeIdleMs, `${label}.activeIdleMs`),
    host: validateHost(value.host, `${label}.host`),
  }
}

function validateIdleMs(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 10_000) {
    throw new Error(`[scribepad] invalid ${label}: expected integer >= 10000`)
  }
  return value
}

function validateHost(value: unknown, label: string): ScribepadHost {
  if (value === '127.0.0.1' || value === 'localhost') return value
  throw new Error(`[scribepad] invalid ${label}: expected "127.0.0.1" or "localhost"`)
}

function mergeConfig(...configs: PartialConfig[]): ScribepadConfig {
  return Object.assign({}, ...configs) as ScribepadConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
