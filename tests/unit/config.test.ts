import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  loadConfig,
  resolveProjectLocalConfigPath,
  writeProjectLocalAiConfig,
} from '../../server/config'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'scribepad-config-'))
}

describe('loadConfig', () => {
  it('returns defaults when no config files exist', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()

    await expect(loadConfig({ repoRoot, env: { XDG_CONFIG_HOME: xdg } })).resolves.toEqual(
      DEFAULT_CONFIG,
    )
  })

  it('loads XDG user config', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()
    await mkdir(join(xdg, 'scribepad'), { recursive: true })
    await writeFile(join(xdg, 'scribepad', 'config.json'), '{"initialIdleMs":700000}', 'utf8')

    const config = await loadConfig({ repoRoot, env: { XDG_CONFIG_HOME: xdg } })
    expect(config.initialIdleMs).toBe(700_000)
    expect(config.activeIdleMs).toBe(DEFAULT_CONFIG.activeIdleMs)
  })

  it('applies project, local, SCRIBEPAD_CONFIG, then SCRIBEPAD_HOST priority', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()
    const override = join(await tempDir(), 'override.json')
    const localPath = resolveProjectLocalConfigPath(repoRoot, { XDG_CONFIG_HOME: xdg })
    await mkdir(join(xdg, 'scribepad'), { recursive: true })
    await mkdir(join(repoRoot, '.scribepad'), { recursive: true })
    await mkdir(join(localPath, '..'), { recursive: true })
    await writeFile(join(xdg, 'scribepad', 'config.json'), '{"activeIdleMs":100000}', 'utf8')
    await writeFile(join(repoRoot, '.scribepad', 'config.json'), '{"activeIdleMs":200000}', 'utf8')
    await writeFile(localPath, '{"activeIdleMs":300000,"host":"localhost"}', 'utf8')
    await writeFile(override, '{"activeIdleMs":400000,"host":"127.0.0.1"}', 'utf8')

    const config = await loadConfig({
      repoRoot,
      env: {
        XDG_CONFIG_HOME: xdg,
        SCRIBEPAD_CONFIG: override,
        SCRIBEPAD_HOST: 'localhost',
      },
    })

    expect(config.activeIdleMs).toBe(400_000)
    expect(config.host).toBe('localhost')
  })

  it('merges AI provider config with defaults', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()
    const localPath = resolveProjectLocalConfigPath(repoRoot, { XDG_CONFIG_HOME: xdg })
    await mkdir(join(localPath, '..'), { recursive: true })
    await writeFile(
      localPath,
      '{"ai":{"provider":"claude-code-cli","claude":{"command":"claude-beta"}}}',
      'utf8',
    )

    const config = await loadConfig({ repoRoot, env: { XDG_CONFIG_HOME: xdg } })

    expect(config.ai.provider).toBe('claude-code-cli')
    expect(config.ai.claude.command).toBe('claude-beta')
    expect(config.ai.claude.args).toEqual(['-p'])
    expect(config.ai.codex.command).toBe('codex')
  })

  it('writes project-local AI config without dropping other local keys', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()
    const env = { XDG_CONFIG_HOME: xdg }
    const localPath = resolveProjectLocalConfigPath(repoRoot, env)
    await mkdir(join(localPath, '..'), { recursive: true })
    await writeFile(localPath, '{"host":"localhost"}', 'utf8')

    await writeProjectLocalAiConfig(
      repoRoot,
      {
        ...DEFAULT_CONFIG.ai,
        provider: 'claude-code-cli',
        claude: { command: 'claude', args: ['-p'] },
      },
      env,
    )

    const raw = JSON.parse(await readFile(localPath, 'utf8')) as {
      host?: string
      ai?: { provider?: string }
    }
    expect(raw.host).toBe('localhost')
    expect(raw.ai?.provider).toBe('claude-code-cli')
  })

  it('does not read idle timeout environment variables', async () => {
    const repoRoot = await tempDir()
    const xdg = await tempDir()
    const config = await loadConfig({
      repoRoot,
      env: {
        XDG_CONFIG_HOME: xdg,
        SCRIBEPAD_INITIAL_IDLE_MS: '1',
        SCRIBEPAD_ACTIVE_IDLE_MS: '1',
      },
    })

    expect(config.initialIdleMs).toBe(DEFAULT_CONFIG.initialIdleMs)
    expect(config.activeIdleMs).toBe(DEFAULT_CONFIG.activeIdleMs)
  })

  it('rejects invalid idle values', async () => {
    const repoRoot = await tempDir()
    await mkdir(join(repoRoot, '.scribepad'), { recursive: true })
    await writeFile(join(repoRoot, '.scribepad', 'config.json'), '{"activeIdleMs":1}', 'utf8')

    await expect(loadConfig({ repoRoot, env: {} })).rejects.toThrow(/activeIdleMs/)
  })

  it('rejects invalid host', async () => {
    const repoRoot = await tempDir()

    await expect(loadConfig({ repoRoot, env: { SCRIBEPAD_HOST: '0.0.0.0' } })).rejects.toThrow(
      /host/,
    )
  })
})
