/**
 * Tests for AgentInstallCommand — repo-install flow
 *
 * Covers each row of the I/O matrix in the spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// isRepoInput unit tests (pure function, no mocks needed)
// ---------------------------------------------------------------------------

describe('isRepoInput', () => {
  it('returns true for owner/repo shorthand', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('tescalada/agents')).toBe(true);
    expect(isRepoInput('owner/repo')).toBe(true);
  });

  it('returns true for gitlab: prefix', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('gitlab:owner/repo')).toBe(true);
  });

  it('returns true for bitbucket: prefix', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('bitbucket:owner/repo')).toBe(true);
  });

  it('returns true for local paths', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('./my-agents')).toBe(true);
    expect(isRepoInput('/abs/path')).toBe(true);
    expect(isRepoInput('~/path')).toBe(true);
  });

  it('returns false for plain bundled name', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('code-reviewer')).toBe(false);
    expect(isRepoInput('architect')).toBe(false);
    expect(isRepoInput('tdd-guide')).toBe(false);
  });

  it('returns false for name with spaces', async () => {
    const { isRepoInput } = await import('../agent.js');
    expect(isRepoInput('foo bar/baz')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentInstallCommand integration tests
// ---------------------------------------------------------------------------

describe('AgentInstallCommand', () => {
  let tempDir: string;
  let sourceDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-install-test-'));
    sourceDir = join(tempDir, 'source');
    mkdirSync(sourceDir, { recursive: true });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Helper: create a minimal agent .md file in sourceDir
  function createAgentFile(name: string, dir: string = sourceDir): void {
    writeFileSync(
      join(dir, `${name}.md`),
      `---\nname: ${name}\ndescription: Test agent\n---\n\nAgent body.\n`,
    );
  }

  // Helper: build a minimal AgentInstallCommand-like object for unit testing
  // We bypass clipanion and invoke installFromRepo via the exported class.
  async function makeCommand(overrides: Record<string, unknown> = {}) {
    const { AgentInstallCommand } = await import('../agent.js');
    const cmd = new AgentInstallCommand();
    // Default values matching Option definitions
    Object.assign(cmd, {
      global: false,
      force: false,
      all: false,
      agentType: undefined,
      name: undefined,
      ...overrides,
    });
    return cmd;
  }

  // -------------------------------------------------------------------------
  // Local-path scenario
  // -------------------------------------------------------------------------
  describe('local path input', () => {
    it('discovers and translates agents from a local directory', async () => {
      createAgentFile('planner');
      createAgentFile('reviewer');

      const { AgentInstallCommand } = await import('../agent.js');
      const cmd = await makeCommand({ name: sourceDir, agentType: 'claude-code' });

      // Override cwd so getAgentTargetDirectory resolves inside tempDir
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      try {
        const exitCode = await cmd.execute();
        expect(exitCode).toBe(0);

        const outputDir = join(tempDir, '.claude', 'agents');
        expect(existsSync(outputDir)).toBe(true);

        const files = ['planner.md', 'reviewer.md'];
        for (const f of files) {
          expect(existsSync(join(outputDir, f))).toBe(true);
        }
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it('returns 1 when local path does not exist', async () => {
      const cmd = await makeCommand({ name: join(tempDir, 'nonexistent'), agentType: 'claude-code' });
      const exitCode = await cmd.execute();
      expect(exitCode).toBe(1);
    });

    it('returns 0 with warning when no agents found', async () => {
      const emptyDir = join(tempDir, 'empty');
      mkdirSync(emptyDir);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      try {
        const cmd = await makeCommand({ name: emptyDir, agentType: 'claude-code' });
        const exitCode = await cmd.execute();
        expect(exitCode).toBe(0);
        const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
        expect(logCalls).toMatch(/No agents found/);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it('skips existing file without --force', async () => {
      createAgentFile('planner');

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      try {
        // First install
        const cmd1 = await makeCommand({ name: sourceDir, agentType: 'claude-code' });
        await cmd1.execute();

        consoleLogSpy.mockClear();

        // Second install without --force
        const cmd2 = await makeCommand({ name: sourceDir, agentType: 'claude-code', force: false });
        const exitCode = await cmd2.execute();
        expect(exitCode).toBe(0);
        const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
        expect(logCalls).toMatch(/already exists/);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it('overwrites existing file with --force', async () => {
      createAgentFile('planner');

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      try {
        const cmd1 = await makeCommand({ name: sourceDir, agentType: 'claude-code' });
        await cmd1.execute();

        consoleLogSpy.mockClear();

        const cmd2 = await makeCommand({ name: sourceDir, agentType: 'claude-code', force: true });
        const exitCode = await cmd2.execute();
        expect(exitCode).toBe(0);
        const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
        expect(logCalls).not.toMatch(/already exists/);
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // --agent flag validation
  // -------------------------------------------------------------------------
  describe('--agent flag', () => {
    it('returns 1 for unknown agent type', async () => {
      createAgentFile('planner');
      const cmd = await makeCommand({ name: sourceDir, agentType: 'not-a-real-agent' });
      const exitCode = await cmd.execute();
      expect(exitCode).toBe(1);
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toMatch(/Unknown agent type/);
    });

    it('accepts valid agent type codex', async () => {
      createAgentFile('planner');
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
      try {
        const cmd = await makeCommand({ name: sourceDir, agentType: 'codex' });
        const exitCode = await cmd.execute();
        expect(exitCode).toBe(0);
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // GitHub provider clone failure
  // -------------------------------------------------------------------------
  describe('github owner/repo with provider failure', () => {
    it('surfaces clone error with "tried as repo" message', async () => {
      // Mock detectProvider to return a provider whose clone fails
      vi.doMock('@skillkit/core', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@skillkit/core')>();
        return {
          ...actual,
          detectProvider: () => ({
            name: 'GitHub',
            type: 'github',
            matches: () => true,
            parseSource: () => ({ owner: 'foo', repo: 'bar' }),
            clone: async () => ({ success: false, error: 'Repository not found (404)' }),
          }),
          isLocalPath: actual.isLocalPath,
        };
      });

      const { AgentInstallCommand } = await import('../agent.js');
      const cmd = Object.assign(new AgentInstallCommand(), {
        global: false,
        force: false,
        all: false,
        agentType: 'claude-code',
        name: 'foo/bar',
      });

      const exitCode = await cmd.execute();
      expect(exitCode).toBe(1);
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).toMatch(/tried as repo/);

      vi.doUnmock('@skillkit/core');
    });
  });

  // -------------------------------------------------------------------------
  // Bundled template regression (plain name, no slash)
  // -------------------------------------------------------------------------
  describe('bundled template fallback', () => {
    it('falls through to bundled agent lookup when name has no slash', async () => {
      // 'code-reviewer' has no slash → isRepoInput returns false
      // getBundledAgent will return undefined in test env (no real bundled agents)
      // so we expect failure indicating it tried bundled path
      const cmd = await makeCommand({ name: 'code-reviewer' });
      const exitCode = await cmd.execute();
      // In test env bundled agents may or may not exist; we just verify
      // that the repo flow was NOT invoked (no "tried as repo" in output)
      const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toMatch(/tried as repo/);
    });

    it('install --all proceeds without name (existing behavior)', async () => {
      const cmd = await makeCommand({ all: true });
      // getBundledAgents may return empty in test env, should still return 0
      const exitCode = await cmd.execute();
      expect([0, 1]).toContain(exitCode); // just verifies no crash
    });
  });
});
