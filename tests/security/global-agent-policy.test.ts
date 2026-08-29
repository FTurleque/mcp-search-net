import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const configureScript = resolve('packaging/windows/configure-install.ps1');
const distributionBuilder = readFileSync(
  resolve('scripts/release/build-windows-distribution.ps1'),
  'utf8',
);
const installerBuilder = readFileSync(
  resolve('scripts/release/build-windows-installer.ps1'),
  'utf8',
);
const configureSource = readFileSync(configureScript, 'utf8');

const BEGIN_MARK = '<!-- BEGIN MCP-SEARCH-NET GLOBAL POLICY -->';
const END_MARK = '<!-- END MCP-SEARCH-NET GLOBAL POLICY -->';

function windowsRuntimeTest(name: string, body: () => void) {
  it(name, (context) => {
    context.skip(process.platform !== 'win32', 'Windows-only test');
    body();
  });
}

interface Sandbox {
  readonly root: string;
  readonly installRoot: string;
  readonly localAppData: string;
  readonly userProfile: string;
  readonly codexHome: string;
  readonly copilotHome: string;
}

function createSandbox(prefix: string): Sandbox {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const sandbox: Sandbox = {
    root,
    installRoot: join(root, 'install'),
    localAppData: join(root, 'local'),
    userProfile: join(root, 'user'),
    codexHome: join(root, 'codex-home'),
    copilotHome: join(root, 'copilot-home'),
  };
  mkdirSync(sandbox.userProfile, { recursive: true });
  mkdirSync(join(sandbox.installRoot, 'scripts'), { recursive: true });
  writeFileSync(
    join(sandbox.installRoot, 'scripts', 'mcp-search-net-global-policy.md'),
    readFileSync(resolve('packaging/windows/mcp-search-net-global-policy.md'), 'utf8'),
  );
  return sandbox;
}

function runConfigure(
  sandbox: Sandbox,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      configureScript,
      '-InstallRoot',
      sandbox.installRoot,
      ...args,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        LOCALAPPDATA: sandbox.localAppData,
        APPDATA: join(sandbox.localAppData, 'Roaming'),
        USERPROFILE: sandbox.userProfile,
        CODEX_HOME: '',
        COPILOT_HOME: '',
        ...extraEnvironment,
      },
    },
  );
}

function claudePath(sandbox: Sandbox): string {
  return join(sandbox.userProfile, '.claude', 'CLAUDE.md');
}

function codexPath(sandbox: Sandbox, home?: string): string {
  return join(home ?? join(sandbox.userProfile, '.codex'), 'AGENTS.md');
}

function copilotCliPath(sandbox: Sandbox, home?: string): string {
  return join(home ?? join(sandbox.userProfile, '.copilot'), 'copilot-instructions.md');
}

function jetbrainsPath(sandbox: Sandbox): string {
  return join(sandbox.localAppData, 'github-copilot', 'intellij', 'global-copilot-instructions.md');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('global agent policy — static contract (source inspection)', () => {
  it('exists as a single canonical policy source packaged into the distribution', () => {
    expect(existsSync(resolve('packaging/windows/mcp-search-net-global-policy.md'))).toBe(true);
    expect(distributionBuilder).toContain("'packaging\\windows\\mcp-search-net-global-policy.md'");
    expect(distributionBuilder).toContain('$ScriptsDist');
    expect(installerBuilder).toContain("'scripts\\mcp-search-net-global-policy.md'");
  });

  it('is exclusively USER-SCOPED: resolvers use only USERPROFILE/LOCALAPPDATA/CODEX_HOME/COPILOT_HOME', () => {
    expect(configureSource).toContain('function Resolve-ClaudeGlobalInstructionsPath');
    expect(configureSource).toContain('function Resolve-CodexGlobalInstructionsPath');
    expect(configureSource).toContain('function Resolve-CopilotCliGlobalInstructionsPath');
    expect(configureSource).toContain('function Resolve-CopilotJetBrainsGlobalInstructionsPath');
    expect(configureSource).toContain('$env:CODEX_HOME');
    expect(configureSource).toContain('$env:COPILOT_HOME');

    // Regression lock (mission invariant): the global policy must never be redirected toward
    // a repository-relative path. None of these must ever appear in configure-install.ps1.
    for (const forbidden of [
      'Get-Location',
      '$PWD',
      'git rev-parse --show-toplevel',
      '.github\\copilot-instructions.md',
      '.github/copilot-instructions.md',
    ]) {
      expect(configureSource).not.toContain(forbidden);
    }
  });

  it('never targets Claude Desktop for the global policy', () => {
    // Claude Desktop keeps only its existing MCP registration; the global policy block is
    // wired solely for claude-code, codex, copilot-cli and copilot-jetbrains.
    expect(configureSource).not.toContain("'claude-desktop:global-policy'");
  });

  it('reuses the existing durable/atomic write and ownership primitives instead of naive writes', () => {
    expect(configureSource).toContain('function Install-ManagedGlobalPolicy');
    expect(configureSource).toContain('function Remove-ManagedGlobalPolicy');
    expect(configureSource).toContain(
      'Write-DurableUtf8File -Path $ConfigPath -Content $newText -ExpectedSnapshot $snapshot',
    );
    expect(configureSource).toContain('Set-IntegrationRecordDurably');
    expect(configureSource).toContain('Backup-ConfigFile $ConfigPath');
    expect(configureSource).toContain('MCP_CONFIG_MANAGED_POLICY_DRIFT');
    expect(configureSource).toContain('MCP_CONFIG_MANAGED_POLICY_MARKERS_INVALID');
    expect(configureSource).toContain(
      'MCP_CONFIG_CONCURRENT_MODIFICATION_RETRY_EXHAUSTED:$ConfigPath',
    );
    for (const naive of ['Add-Content ', 'Set-Content ', 'Out-File ']) {
      expect(configureSource).not.toContain(naive);
    }
  });

  it('detects every invalid marker combination and fails closed rather than repairing the file', () => {
    expect(configureSource).toContain('function Test-ManagedPolicyMarkersValid');
    expect(configureSource).toContain('($beginCount -eq $endCount) -and ($beginCount -le 1)');
  });
});

describe('global agent policy — repository isolation', () => {
  windowsRuntimeTest('never writes into an arbitrary application repository', () => {
    const sandbox = createSandbox('mcp-policy-repo-isolation-');
    const repoA = join(sandbox.root, 'application-a');
    const repoB = join(sandbox.root, 'application-b');
    for (const repo of [repoA, repoB]) {
      mkdirSync(join(repo, '.github', 'instructions'), { recursive: true });
      mkdirSync(join(repo, '.claude'), { recursive: true });
      mkdirSync(join(repo, '.codex'), { recursive: true });
      writeFileSync(join(repo, 'README.md'), '# app\n');
    }

    try {
      // Simulate "installed from inside an arbitrary open repository": the process cwd is
      // the repo, but path resolution must never consult it.
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          configureScript,
          '-InstallRoot',
          sandbox.installRoot,
          '-FromInstaller',
          // copilot-cli deliberately excluded: its MCP registration verification shells
          // out to a real `copilot` executable if one is resolvable on PATH, which is
          // fakeable neither here nor on CI runners (see the identical rationale on the
          // "already-applied JSON client integration" test in windows-upgrade-contract.
          // test.ts). copilot-cli's own global-policy resolver is covered separately by
          // the dedicated "Copilot CLI" describe block below.
          '-Clients',
          'claude-code,codex,copilot-jetbrains',
        ],
        {
          cwd: repoA,
          encoding: 'utf8',
          windowsHide: true,
          env: {
            ...process.env,
            LOCALAPPDATA: sandbox.localAppData,
            APPDATA: join(sandbox.localAppData, 'Roaming'),
            USERPROFILE: sandbox.userProfile,
            CODEX_HOME: '',
            COPILOT_HOME: '',
          },
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `repository isolation probe failed (status=${result.status}): stdout=${result.stdout} stderr=${result.stderr}`,
        );
      }

      for (const repo of [repoA, repoB]) {
        expect(existsSync(join(repo, 'CLAUDE.md'))).toBe(false);
        expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
        expect(existsSync(join(repo, '.github', 'copilot-instructions.md'))).toBe(false);
        expect(existsSync(join(repo, '.claude', 'CLAUDE.md'))).toBe(false);
        expect(existsSync(join(repo, '.codex', 'AGENTS.md'))).toBe(false);
      }

      // The global policy did land in the user-scoped locations.
      expect(existsSync(claudePath(sandbox))).toBe(true);
      expect(existsSync(codexPath(sandbox))).toBe(true);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });
});

describe('global agent policy — Claude Code', () => {
  windowsRuntimeTest('installs into an absent ~/.claude/CLAUDE.md', () => {
    const sandbox = createSandbox('mcp-policy-claude-absent-');
    try {
      const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
      expect(result.status).toBe(0);
      const content = readFileSync(claudePath(sandbox), 'utf8');
      expect(content).toContain(BEGIN_MARK);
      expect(content).toContain(END_MARK);
      expect(content).toContain('mcp-search-net');
      expect(countOccurrences(content, BEGIN_MARK)).toBe(1);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });

  windowsRuntimeTest('preserves pre-existing user instructions around the managed block', () => {
    const sandbox = createSandbox('mcp-policy-claude-preserve-');
    const userText =
      'Always use French for explanations.\r\n\r\nPrefer Maven for Java projects.\r\n';
    mkdirSync(join(sandbox.userProfile, '.claude'), { recursive: true });
    writeFileSync(claudePath(sandbox), userText, 'utf8');

    try {
      const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
      expect(result.status).toBe(0);
      const content = readFileSync(claudePath(sandbox), 'utf8');
      expect(content).toContain('Always use French for explanations.');
      expect(content).toContain('Prefer Maven for Java projects.');
      expect(content.indexOf('Prefer Maven')).toBeLessThan(content.indexOf(BEGIN_MARK));
      expect(content).toContain(BEGIN_MARK);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });

  windowsRuntimeTest(
    'is idempotent on reinstall: exactly one managed block, byte-identical',
    () => {
      const sandbox = createSandbox('mcp-policy-claude-idempotent-');
      try {
        const first = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(first.status).toBe(0);
        const before = readFileSync(claudePath(sandbox), 'utf8');

        const second = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(second.status).toBe(0);
        // Not asserting on the exact (accented) French wording here: Windows PowerShell
        // 5.1's default console output encoding mangles non-ASCII characters when captured
        // through a pipe -- a Node/PowerShell IPC quirk unrelated to what this test verifies,
        // which is that a second run is a true no-op.
        const after = readFileSync(claudePath(sandbox), 'utf8');
        expect(after).toBe(before);
        expect(countOccurrences(after, BEGIN_MARK)).toBe(1);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest('detects drift inside the managed block and refuses to overwrite it', () => {
    const sandbox = createSandbox('mcp-policy-claude-drift-');
    try {
      const first = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
      expect(first.status).toBe(0);
      const original = readFileSync(claudePath(sandbox), 'utf8');
      const drifted = original.replace('Use the `mcp-search-net`', 'USER EDITED THIS LINE');
      writeFileSync(claudePath(sandbox), drifted, 'utf8');

      const second = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
      expect(second.status).not.toBe(0);
      expect(second.stdout + second.stderr).toContain('MCP_CONFIG_MANAGED_POLICY_DRIFT');
      expect(readFileSync(claudePath(sandbox), 'utf8')).toBe(drifted);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });

  windowsRuntimeTest(
    'rejects ambiguous markers (duplicate BEGIN) and preserves the file untouched',
    () => {
      const sandbox = createSandbox('mcp-policy-claude-invalid-markers-');
      mkdirSync(join(sandbox.userProfile, '.claude'), { recursive: true });
      const ambiguous = [
        'User notes.',
        BEGIN_MARK,
        'first block',
        END_MARK,
        BEGIN_MARK,
        'second block',
        END_MARK,
        '',
      ].join('\r\n');
      writeFileSync(claudePath(sandbox), ambiguous, 'utf8');

      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(
          'MCP_CONFIG_MANAGED_POLICY_MARKERS_INVALID',
        );
        expect(readFileSync(claudePath(sandbox), 'utf8')).toBe(ambiguous);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'upgrades an old managed block to the current canonical content without touching user text',
    () => {
      const sandbox = createSandbox('mcp-policy-claude-upgrade-');
      mkdirSync(join(sandbox.userProfile, '.claude'), { recursive: true });
      const oldBlock = [
        BEGIN_MARK,
        '',
        'An older mcp-search-net policy revision.',
        '',
        END_MARK,
      ].join('\r\n');
      const original = ['My personal instructions.', '', oldBlock, ''].join('\r\n');
      writeFileSync(claudePath(sandbox), original, 'utf8');

      // Pre-seed ownership so the installer treats the existing block as its own prior write
      // (matching a real upgrade scenario where mcp-client-integrations.json already records
      // this client as managed from a previous version).
      const integrationsPath = join(sandbox.installRoot, 'mcp-client-integrations.json');
      const fingerprint = createHash('sha256').update(Buffer.from(oldBlock, 'utf8')).digest('hex');
      writeFileSync(
        integrationsPath,
        JSON.stringify(
          {
            'claude-code:global-policy': {
              ownership: 'managed',
              state: 'applied',
              transactionId: 'seed',
              configPath: claudePath(sandbox),
              entryFingerprint: fingerprint,
              fileCreatedByInstaller: false,
              configuredAt: new Date(0).toISOString(),
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(result.status).toBe(0);
        const content = readFileSync(claudePath(sandbox), 'utf8');
        expect(content).toContain('My personal instructions.');
        expect(content).not.toContain('An older mcp-search-net policy revision.');
        expect(content).toContain('Use the `mcp-search-net` MCP server automatically');
        expect(countOccurrences(content, BEGIN_MARK)).toBe(1);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'uninstall removes only the managed block and preserves surrounding user content',
    () => {
      const sandbox = createSandbox('mcp-policy-claude-uninstall-preserve-');
      const before = 'My personal instructions.\r\n';
      mkdirSync(join(sandbox.userProfile, '.claude'), { recursive: true });
      writeFileSync(claudePath(sandbox), before, 'utf8');

      try {
        const install = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(install.status).toBe(0);

        const uninstall = runConfigure(sandbox, ['-Uninstall']);
        expect(uninstall.status).toBe(0);
        const after = readFileSync(claudePath(sandbox), 'utf8');
        expect(after).not.toContain(BEGIN_MARK);
        expect(after).toContain('My personal instructions.');
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'uninstall deletes a file it created entirely once its managed block is removed',
    () => {
      const sandbox = createSandbox('mcp-policy-claude-uninstall-delete-');
      try {
        const install = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(install.status).toBe(0);
        expect(existsSync(claudePath(sandbox))).toBe(true);

        const uninstall = runConfigure(sandbox, ['-Uninstall']);
        expect(uninstall.status).toBe(0);
        expect(existsSync(claudePath(sandbox))).toBe(false);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );
});

describe('global agent policy — Codex', () => {
  windowsRuntimeTest(
    'resolves to %USERPROFILE%\\.codex\\AGENTS.md when CODEX_HOME is unset',
    () => {
      const sandbox = createSandbox('mcp-policy-codex-default-');
      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'codex']);
        expect(result.status).toBe(0);
        expect(existsSync(codexPath(sandbox))).toBe(true);
        expect(existsSync(codexPath(sandbox, sandbox.codexHome))).toBe(false);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest('resolves to $CODEX_HOME\\AGENTS.md when CODEX_HOME is set', () => {
    const sandbox = createSandbox('mcp-policy-codex-home-');
    mkdirSync(sandbox.codexHome, { recursive: true });
    try {
      const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'codex'], {
        CODEX_HOME: sandbox.codexHome,
      });
      expect(result.status).toBe(0);
      expect(existsSync(codexPath(sandbox, sandbox.codexHome))).toBe(true);
      expect(existsSync(codexPath(sandbox))).toBe(false);
      const content = readFileSync(codexPath(sandbox, sandbox.codexHome), 'utf8');
      expect(content).toContain(BEGIN_MARK);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });

  windowsRuntimeTest(
    'never writes a repository-scoped AGENTS.md alongside CODEX_HOME resolution',
    () => {
      const sandbox = createSandbox('mcp-policy-codex-no-repo-');
      const repo = join(sandbox.root, 'application-c');
      mkdirSync(repo, { recursive: true });
      mkdirSync(sandbox.codexHome, { recursive: true });
      try {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            configureScript,
            '-InstallRoot',
            sandbox.installRoot,
            '-FromInstaller',
            '-Clients',
            'codex',
          ],
          {
            cwd: repo,
            encoding: 'utf8',
            windowsHide: true,
            env: {
              ...process.env,
              LOCALAPPDATA: sandbox.localAppData,
              APPDATA: join(sandbox.localAppData, 'Roaming'),
              USERPROFILE: sandbox.userProfile,
              CODEX_HOME: sandbox.codexHome,
              COPILOT_HOME: '',
            },
          },
        );
        expect(result.status).toBe(0);
        expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
        expect(existsSync(codexPath(sandbox, sandbox.codexHome))).toBe(true);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );
});

describe('global agent policy — Copilot CLI', () => {
  windowsRuntimeTest(
    'resolves to %USERPROFILE%\\.copilot\\copilot-instructions.md when COPILOT_HOME is unset',
    () => {
      const sandbox = createSandbox('mcp-policy-copilot-cli-default-');
      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'copilot-cli']);
        // copilot-cli's *MCP registration* may report a partial failure in this sandbox (no real
        // `copilot` executable on PATH), but the global policy file is independent of that and
        // must still be written.
        expect(existsSync(copilotCliPath(sandbox))).toBe(true);
        void result;
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'resolves to $COPILOT_HOME\\copilot-instructions.md when COPILOT_HOME is set',
    () => {
      const sandbox = createSandbox('mcp-policy-copilot-cli-home-');
      mkdirSync(sandbox.copilotHome, { recursive: true });
      try {
        runConfigure(sandbox, ['-FromInstaller', '-Clients', 'copilot-cli'], {
          COPILOT_HOME: sandbox.copilotHome,
        });
        expect(existsSync(copilotCliPath(sandbox, sandbox.copilotHome))).toBe(true);
        expect(existsSync(copilotCliPath(sandbox))).toBe(false);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );
});

describe('global agent policy — Copilot JetBrains', () => {
  windowsRuntimeTest(
    'installs into %LOCALAPPDATA%\\github-copilot\\intellij\\global-copilot-instructions.md',
    () => {
      const sandbox = createSandbox('mcp-policy-jetbrains-');
      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'copilot-jetbrains']);
        expect(result.status).toBe(0);
        expect(existsSync(jetbrainsPath(sandbox))).toBe(true);
        const content = readFileSync(jetbrainsPath(sandbox), 'utf8');
        expect(content).toContain(BEGIN_MARK);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest('never creates the repository-scoped .github/copilot-instructions.md', () => {
    const sandbox = createSandbox('mcp-policy-jetbrains-no-repo-scoped-');
    const repo = join(sandbox.root, 'application-d');
    mkdirSync(join(repo, '.github'), { recursive: true });
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          configureScript,
          '-InstallRoot',
          sandbox.installRoot,
          '-FromInstaller',
          '-Clients',
          'copilot-jetbrains',
        ],
        {
          cwd: repo,
          encoding: 'utf8',
          windowsHide: true,
          env: {
            ...process.env,
            LOCALAPPDATA: sandbox.localAppData,
            APPDATA: join(sandbox.localAppData, 'Roaming'),
            USERPROFILE: sandbox.userProfile,
            CODEX_HOME: '',
            COPILOT_HOME: '',
          },
        },
      );
      expect(result.status).toBe(0);
      expect(existsSync(join(repo, '.github', 'copilot-instructions.md'))).toBe(false);
      expect(existsSync(jetbrainsPath(sandbox))).toBe(true);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });
});

describe('global agent policy — client selection', () => {
  windowsRuntimeTest('only installs the policy for clients selected via -Clients', () => {
    const sandbox = createSandbox('mcp-policy-selection-');
    try {
      const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code,codex']);
      expect(result.status).toBe(0);
      expect(existsSync(claudePath(sandbox))).toBe(true);
      expect(existsSync(codexPath(sandbox))).toBe(true);
      expect(existsSync(jetbrainsPath(sandbox))).toBe(false);
      expect(existsSync(copilotCliPath(sandbox))).toBe(false);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });
});

describe('global agent policy — concurrency and crash recovery', () => {
  windowsRuntimeTest(
    'detects a concurrent modification of the global instructions file and retries',
    () => {
      const sandbox = createSandbox('mcp-policy-concurrent-');
      const injectedContent = Buffer.from(
        'Concurrently written by another process.\r\n',
        'utf8',
      ).toString('base64');
      try {
        const result = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code'], {
          MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_PUBLISH: 'CLAUDE.md',
          MCP_SEARCH_NET_TEST_CONCURRENT_CONFIG_CONTENT_BASE64: injectedContent,
        });
        expect(result.status).toBe(0);
        const content = readFileSync(claudePath(sandbox), 'utf8');
        // The retry must observe the concurrently-published content and merge on top of it,
        // never silently discard it.
        expect(content).toContain('Concurrently written by another process.');
        expect(content).toContain(BEGIN_MARK);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );

  windowsRuntimeTest(
    'leaves no orphaned temp file after a crash before publication, and recovers next run',
    () => {
      const sandbox = createSandbox('mcp-policy-crash-');
      try {
        const crashed = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code'], {
          MCP_SEARCH_NET_TEST_CRASH_BEFORE_CONFIG_PUBLISH: 'CLAUDE.md',
        });
        expect(crashed.status).not.toBe(0);
        expect(existsSync(claudePath(sandbox))).toBe(false);

        const recovered = runConfigure(sandbox, ['-FromInstaller', '-Clients', 'claude-code']);
        expect(recovered.status).toBe(0);
        const content = readFileSync(claudePath(sandbox), 'utf8');
        expect(content).toContain(BEGIN_MARK);
      } finally {
        rmSync(sandbox.root, { recursive: true, force: true });
      }
    },
  );
});

describe('global agent policy — sandboxed smoke isolation', () => {
  windowsRuntimeTest('never touches the real operator profile during a sandboxed run', () => {
    // This mirrors what the packaged release smoke tests must guarantee: pointing
    // USERPROFILE/LOCALAPPDATA/CODEX_HOME/COPILOT_HOME at a sandbox is sufficient to fully
    // redirect every global policy write away from the real profile, with no fallback to
    // process.env values read some other way.
    const sandbox = createSandbox('mcp-policy-sandbox-isolation-');
    const realClaude = join(process.env['USERPROFILE'] ?? '', '.claude', 'CLAUDE.md');
    try {
      const realClaudeExistedBefore = existsSync(realClaude);
      const before = realClaudeExistedBefore ? readFileSync(realClaude, 'utf8') : null;

      // copilot-cli excluded here too (see the repository-isolation test above): its MCP
      // registration verification shells out to a real `copilot` executable if one is
      // resolvable on PATH, which this sandbox cannot fake.
      const result = runConfigure(sandbox, [
        '-FromInstaller',
        '-Clients',
        'claude-code,codex,copilot-jetbrains',
      ]);
      expect(result.status).toBe(0);

      const afterExists = existsSync(realClaude);
      expect(afterExists).toBe(realClaudeExistedBefore);
      if (before !== null) {
        expect(readFileSync(realClaude, 'utf8')).toBe(before);
      }
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });
});
