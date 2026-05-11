import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

const APP_NAME = 'scribepad'

export function repoIdFor(repoRoot: string): string {
  return hashPath(resolve(repoRoot))
}

export function docIdFor(repoRoot: string, docPath: string): string {
  return hashPath(relative(resolve(repoRoot), resolve(docPath)) || basename(docPath))
}

export function docRelativePath(repoRoot: string, docPath: string): string {
  return relative(resolve(repoRoot), resolve(docPath)) || basename(docPath)
}

export function xdgConfigHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(homedir(), '.config')
}

export function xdgStateHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_STATE_HOME ? resolve(env.XDG_STATE_HOME) : join(homedir(), '.local', 'state')
}

export function xdgRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_RUNTIME_DIR ? resolve(env.XDG_RUNTIME_DIR) : tmpdir()
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(xdgConfigHome(env), APP_NAME, 'config.json')
}

export function repoScopedConfigPath(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(xdgConfigHome(env), APP_NAME, 'repos', repoIdFor(repoRoot), 'config.json')
}

export function runtimeRegistryPath(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(xdgRuntimeHome(env), APP_NAME, repoIdFor(repoRoot), 'server.json')
}

export function documentStatePath(
  repoRoot: string,
  docPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    xdgStateHome(env),
    APP_NAME,
    repoIdFor(repoRoot),
    'documents',
    `${docIdFor(repoRoot, docPath)}.json`,
  )
}

export function exportPathFor(
  repoRoot: string,
  docPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(
    xdgStateHome(env),
    APP_NAME,
    repoIdFor(repoRoot),
    'exports',
    docIdFor(repoRoot, docPath),
    'latest.agent.md',
  )
}

export function legacySidecarPath(docPath: string): string {
  return join(dirname(docPath), '.' + basename(docPath) + '.annotations.json')
}

function hashPath(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
