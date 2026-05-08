/**
 * Agent Translator Tests
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  translateAgent,
  translateCanonicalAgent,
  getAgentFilename,
  getAgentTargetDirectory,
  isAgentCompatible,
} from '../translator.js';
import type { CustomAgent, CanonicalAgent, AgentFrontmatter } from '../types.js';

// RFC-compliant TOML parser from the pnpm store (confbox is a transitive dep)
const _require = createRequire(import.meta.url);
let _parseTOML: ((toml: string) => Record<string, unknown>) | null = null;
async function parseTOML(toml: string): Promise<Record<string, unknown>> {
  if (!_parseTOML) {
    const mod = await import('/home/coder/projects/skillkit/node_modules/.pnpm/confbox@0.1.8/node_modules/confbox/dist/toml.mjs');
    _parseTOML = mod.parseTOML as (toml: string) => Record<string, unknown>;
  }
  return _parseTOML!(toml);
}

describe('Agent Translator', () => {
  describe('translateAgent', () => {
    it('should translate agent to claude-code format', () => {
      const agent: CustomAgent = {
        name: 'test-agent',
        description: 'A test agent',
        path: '/path/to/agent.md',
        location: 'project',
        frontmatter: {
          name: 'test-agent',
          description: 'A test agent',
          model: 'opus',
        } as AgentFrontmatter,
        content: 'Agent instructions here.',
        enabled: true,
      };

      const result = translateAgent(agent, 'claude-code');

      expect(result.success).toBe(true);
      expect(result.targetAgent).toBe('claude-code');
      expect(result.targetFormat).toBe('claude-agent');
      expect(result.content).toContain('name: test-agent');
      expect(result.content).toContain('model: opus');
    });

    it('should translate agent to cursor format', () => {
      const agent: CustomAgent = {
        name: 'reviewer',
        description: 'Code reviewer',
        path: '/path/to/agent.md',
        location: 'project',
        frontmatter: {
          name: 'reviewer',
          description: 'Code reviewer',
        } as AgentFrontmatter,
        content: 'Review code carefully.',
        enabled: true,
      };

      const result = translateAgent(agent, 'cursor');

      expect(result.success).toBe(true);
      expect(result.targetAgent).toBe('cursor');
      expect(result.targetFormat).toBe('cursor-agent');
      expect(result.filename).toBe('reviewer.md');
    });

    it('should add warnings for hooks in cursor format', () => {
      const agent: CustomAgent = {
        name: 'hooked-agent',
        description: 'Agent with hooks',
        path: '/path/to/agent.md',
        location: 'project',
        frontmatter: {
          name: 'hooked-agent',
          description: 'Agent with hooks',
          hooks: [
            { type: 'PreToolUse', command: 'echo test' },
          ],
        } as AgentFrontmatter,
        content: 'Content here.',
        enabled: true,
      };

      const result = translateAgent(agent, 'cursor');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Hooks may require manual adjustment for Cursor');
    });

    it('should add incompatible features for universal format', () => {
      const agent: CustomAgent = {
        name: 'complex-agent',
        description: 'Complex agent',
        path: '/path/to/agent.md',
        location: 'project',
        frontmatter: {
          name: 'complex-agent',
          description: 'Complex agent',
          permissionMode: 'plan',
          hooks: [
            { type: 'SessionStart', command: 'echo start' },
          ],
        } as AgentFrontmatter,
        content: 'Content here.',
        enabled: true,
      };

      const result = translateAgent(agent, 'universal');

      expect(result.success).toBe(true);
      expect(result.incompatible).toContain('hooks (not supported in universal format)');
      expect(result.incompatible).toContain('permissionMode (not supported in universal format)');
    });
  });

  describe('translateCanonicalAgent', () => {
    it('should translate canonical agent to different formats', () => {
      const canonical: CanonicalAgent = {
        name: 'test-agent',
        description: 'Test agent',
        model: 'sonnet',
        content: 'Agent content.',
        sourceFormat: 'claude-agent',
      };

      const claudeResult = translateCanonicalAgent(canonical, 'claude-code');
      expect(claudeResult.success).toBe(true);
      expect(claudeResult.content).toContain('name: test-agent');

      const cursorResult = translateCanonicalAgent(canonical, 'cursor');
      expect(cursorResult.success).toBe(true);
      expect(cursorResult.content).toContain('name: test-agent');

      const universalResult = translateCanonicalAgent(canonical, 'universal');
      expect(universalResult.success).toBe(true);
      expect(universalResult.content).toContain('name: test-agent');
    });

    it('should include metadata when option is set', () => {
      const canonical: CanonicalAgent = {
        name: 'test-agent',
        description: 'Test agent',
        content: 'Content.',
        sourceFormat: 'claude-agent',
        sourceAgent: 'cursor',
      };

      const result = translateCanonicalAgent(canonical, 'claude-code', { addMetadata: true });

      expect(result.content).toContain('# Translated by SkillKit from cursor');
    });
  });

  describe('getAgentFilename', () => {
    it('should return correct filename for different agents', () => {
      expect(getAgentFilename('test-agent', 'claude-code')).toBe('test-agent.md');
      expect(getAgentFilename('reviewer', 'cursor')).toBe('reviewer.md');
      expect(getAgentFilename('my-agent', 'universal')).toBe('my-agent.md');
    });
  });

  describe('getAgentTargetDirectory', () => {
    it('should return correct target directory', () => {
      const rootDir = '/home/user/project';

      expect(getAgentTargetDirectory(rootDir, 'claude-code')).toBe('/home/user/project/.claude/agents');
      expect(getAgentTargetDirectory(rootDir, 'cursor')).toBe('/home/user/project/.cursor/agents');
      expect(getAgentTargetDirectory(rootDir, 'universal')).toBe('/home/user/project/agents');
    });
  });

  describe('isAgentCompatible', () => {
    it('should return compatible for same format', () => {
      const result = isAgentCompatible('claude-agent', 'claude-agent');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return compatible for claude-agent target', () => {
      const result = isAgentCompatible('cursor-agent', 'claude-agent');
      expect(result.compatible).toBe(true);
    });

    it('should add warnings for universal target from claude-agent', () => {
      const result = isAgentCompatible('claude-agent', 'universal');
      expect(result.compatible).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should add warnings for cursor target from claude-agent', () => {
      const result = isAgentCompatible('claude-agent', 'cursor-agent');
      expect(result.compatible).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should add warnings for codex-agent target from claude-agent', () => {
      const result = isAgentCompatible('claude-agent', 'codex-agent');
      expect(result.compatible).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('codex agent translation', () => {
    it('basic: name, description, body only produces valid TOML with required fields', () => {
      const canonical: CanonicalAgent = {
        name: 'my-agent',
        description: 'Does things',
        content: 'You are a helpful assistant.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.success).toBe(true);
      expect(result.targetFormat).toBe('codex-agent');
      expect(result.filename).toBe('my-agent.toml');
      expect(result.content).toContain('name = "my-agent"');
      expect(result.content).toContain('description = "Does things"');
      expect(result.content).toContain('developer_instructions');
      expect(result.content).toContain('You are a helpful assistant.');
      expect(result.content).not.toContain('sandbox_mode');
    });

    it('filename returns .toml for codex target', () => {
      expect(getAgentFilename('my-coder', 'codex')).toBe('my-coder.toml');
    });

    it('with model: emits model field', () => {
      const canonical: CanonicalAgent = {
        name: 'coder',
        description: 'Coding assistant',
        model: 'opus',
        content: 'Write clean code.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('model = "opus"');
    });

    it('permissionMode default maps to sandbox_mode = "read-only"', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        permissionMode: 'default',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('sandbox_mode = "read-only"');
    });

    it('permissionMode plan maps to sandbox_mode = "read-only"', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        permissionMode: 'plan',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('sandbox_mode = "read-only"');
    });

    it('permissionMode auto-edit maps to sandbox_mode = "workspace-write"', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        permissionMode: 'auto-edit',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('sandbox_mode = "workspace-write"');
    });

    it('permissionMode full-auto maps to sandbox_mode = "danger-full-access"', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        permissionMode: 'full-auto',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('sandbox_mode = "danger-full-access"');
    });

    it('permissionMode bypassPermissions maps to sandbox_mode = "danger-full-access"', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        permissionMode: 'bypassPermissions',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('sandbox_mode = "danger-full-access"');
    });

    it('permissionMode unset omits sandbox_mode', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).not.toContain('sandbox_mode');
    });

    it('hooks present: incompatible includes hooks, TOML omits them', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        hooks: [{ type: 'PreToolUse', command: 'echo hi' }],
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.incompatible).toContain('hooks (not supported in codex format)');
      expect(result.content).not.toContain('hooks');
    });

    it('description with quotes escapes correctly in TOML basic string', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'agent for "the team"',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.content).toContain('description = "agent for \\"the team\\""');
    });

    it('body with backticks and backslashes uses literal multiline verbatim', () => {
      const body = 'Use `code` blocks.\nPath: C:\\Users\\foo\n';
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        content: body,
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      // Literal multiline preserves verbatim — no escaping of backticks or backslashes
      expect(result.content).toContain("developer_instructions = '''");
      expect(result.content).toContain('Use `code` blocks.');
      expect(result.content).toContain('C:\\Users\\foo');
    });

    it('body containing triple-quote literal falls back to basic multiline', () => {
      const body = "Contains ''' here.";
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        content: body,
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      // Must use basic multiline since body contains '''
      expect(result.content).toContain('developer_instructions = """');
      expect(result.content).not.toContain("developer_instructions = '''");
    });

    it('full-featured agent: acceptance criteria check', () => {
      const canonical: CanonicalAgent = {
        name: 'my-coder',
        description: 'A coding assistant',
        model: 'gpt-4o',
        permissionMode: 'auto-edit',
        content: 'You write clean, tested code.',
        sourceFormat: 'claude-agent',
        sourceAgent: 'claude-code',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.filename).toBe('my-coder.toml');
      expect(result.content).toContain('name = "my-coder"');
      expect(result.content).toContain('description = "A coding assistant"');
      expect(result.content).toContain('developer_instructions');
      expect(result.content).toContain('You write clean, tested code.');
      expect(result.content).toContain('model = "gpt-4o"');
      expect(result.content).toContain('sandbox_mode = "workspace-write"');
    });

    it('addMetadata option adds translated-by comment', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        content: 'Content.',
        sourceFormat: 'claude-agent',
        sourceAgent: 'claude-code',
      };

      const result = translateCanonicalAgent(canonical, 'codex', { addMetadata: true });

      expect(result.content).toContain('# Translated by SkillKit from claude-code');
    });

    it('round-trip: parsed developer_instructions equals source body byte-for-byte', async () => {
      const body = 'You are a helpful assistant.\n\nDo the following:\n1. Be helpful\n2. Use `code` blocks\n3. Avoid C:\\path hacks\n';
      const canonical: CanonicalAgent = {
        name: 'round-trip-agent',
        description: 'Round trip test',
        content: body,
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');
      const parsed = await parseTOML(result.content);

      expect(parsed['developer_instructions']).toBe(body);
    });

    it('round-trip with triple-quote body: parsed developer_instructions equals source body byte-for-byte', async () => {
      const body = "Has triple-quotes: ''' and some text after.\n";
      const canonical: CanonicalAgent = {
        name: 'triple-quote-agent',
        description: 'Triple quote test',
        content: body,
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');
      const parsed = await parseTOML(result.content);

      expect(parsed['developer_instructions']).toBe(body);
    });

    it('allowedTools present: incompatible includes allowedTools', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        allowedTools: ['Bash', 'Read'],
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.incompatible).toContain('allowedTools (not supported in codex format)');
    });

    it('disallowedTools present: incompatible includes disallowedTools', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        disallowedTools: ['Bash'],
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.incompatible).toContain('disallowedTools (not supported in codex format)');
    });

    it('context present: incompatible includes context', () => {
      const canonical: CanonicalAgent = {
        name: 'agent',
        description: 'Agent',
        context: 'fork',
        content: 'Content.',
        sourceFormat: 'claude-agent',
      };

      const result = translateCanonicalAgent(canonical, 'codex');

      expect(result.incompatible).toContain('context (not supported in codex format)');
    });
  });
});
