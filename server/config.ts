import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AiConfig } from '../types/api.js'

export type ScribepadHost = '127.0.0.1' | 'localhost'

export interface ScribepadConfig {
  initialIdleMs: number
  activeIdleMs: number
  host: ScribepadHost
  ai: AiConfig
}

export const DEFAULT_CONFIG: ScribepadConfig = {
  initialIdleMs: 10 * 60_000,
  activeIdleMs: 3 * 60_000,
  host: '127.0.0.1',
  ai: {
    provider: 'codex-cli',
    timeoutMs: 120_000,
    codex: {
      command: 'codex',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      sandbox: 'read-only',
    },
    claude: {
      command: 'claude',
      args: ['-p'],
    },
  },
}

type PartialConfig = Partial<ScribepadConfig>

const KNOWN_KEYS = new Set(['initialIdleMs', 'activeIdleMs', 'host', 'ai'])

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

export async function writeProjectLocalAiConfig(repoRoot: string, ai: AiConfig): Promise<void> {
  const path = resolveProjectLocalConfigPath(repoRoot)
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  current.ai = validateAiConfig(ai, 'ai config')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
}

function readEnvConfig(env: NodeJS.ProcessEnv): PartialConfig {
  const config: PartialConfig = {}
  if (env.SCRIBEPAD_HOST !== undefined) {
    config.host = env.SCRIBEPAD_HOST as ScribepadHost
  }
  if (env.SCRIBEPAD_AI_PROVIDER !== undefined) {
    config.ai = {
      ...DEFAULT_CONFIG.ai,
      provider: env.SCRIBEPAD_AI_PROVIDER as AiConfig['provider'],
    }
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
  if ('ai' in value) {
    config.ai = validateAiConfig(value.ai, `${label}.ai`)
  }
  return config
}

function validateConfig(value: ScribepadConfig, label: string): ScribepadConfig {
  return {
    initialIdleMs: validateIdleMs(value.initialIdleMs, `${label}.initialIdleMs`),
    activeIdleMs: validateIdleMs(value.activeIdleMs, `${label}.activeIdleMs`),
    host: validateHost(value.host, `${label}.host`),
    ai: validateAiConfig(value.ai, `${label}.ai`),
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

function validateAiConfig(value: unknown, label: string): AiConfig {
  if (!isRecord(value)) {
    throw new Error(`[scribepad] invalid ${label}: expected JSON object`)
  }

  const base = DEFAULT_CONFIG.ai
  const provider = value.provider ?? base.provider
  if (provider !== 'codex-cli' && provider !== 'claude-code-cli') {
    throw new Error(`[scribepad] invalid ${label}.provider`)
  }

  const timeoutMs = value.timeoutMs ?? base.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 10_000) {
    throw new Error(`[scribepad] invalid ${label}.timeoutMs: expected integer >= 10000`)
  }

  const codexValue = isRecord(value.codex) ? value.codex : {}
  const codexCommand = codexValue.command ?? base.codex.command
  const codexModel = codexValue.model ?? base.codex.model
  const reasoningEffort = codexValue.reasoningEffort ?? base.codex.reasoningEffort
  const sandbox = codexValue.sandbox ?? base.codex.sandbox
  if (typeof codexCommand !== 'string' || codexCommand.trim() === '') {
    throw new Error(`[scribepad] invalid ${label}.codex.command`)
  }
  if (typeof codexModel !== 'string' || codexModel.trim() === '') {
    throw new Error(`[scribepad] invalid ${label}.codex.model`)
  }
  if (!['low', 'medium', 'high', 'xhigh'].includes(String(reasoningEffort))) {
    throw new Error(`[scribepad] invalid ${label}.codex.reasoningEffort`)
  }
  if (sandbox !== 'read-only') {
    throw new Error(`[scribepad] invalid ${label}.codex.sandbox`)
  }

  const claudeValue = isRecord(value.claude) ? value.claude : {}
  const claudeCommand = claudeValue.command ?? base.claude.command
  const claudeArgs = claudeValue.args ?? base.claude.args
  if (typeof claudeCommand !== 'string' || claudeCommand.trim() === '') {
    throw new Error(`[scribepad] invalid ${label}.claude.command`)
  }
  if (!Array.isArray(claudeArgs) || claudeArgs.some((arg) => typeof arg !== 'string')) {
    throw new Error(`[scribepad] invalid ${label}.claude.args`)
  }

  return {
    provider,
    timeoutMs,
    codex: {
      command: codexCommand.trim(),
      model: codexModel.trim(),
      reasoningEffort: reasoningEffort as AiConfig['codex']['reasoningEffort'],
      sandbox,
    },
    claude: {
      command: claudeCommand.trim(),
      args: claudeArgs,
    },
  }
}

function mergeConfig(...configs: PartialConfig[]): ScribepadConfig {
  return configs.reduce<ScribepadConfig>(
    (merged, config) => ({
      ...merged,
      ...config,
      ai: config.ai
        ? {
            ...merged.ai,
            ...config.ai,
            codex: { ...merged.ai.codex, ...config.ai.codex },
            claude: { ...merged.ai.claude, ...config.ai.claude },
          }
        : merged.ai,
    }),
    DEFAULT_CONFIG,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
