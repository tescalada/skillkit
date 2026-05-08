/**
 * Agent Command
 *
 * Manage custom AI sub-agents (e.g., .claude/agents/*.md)
 */

import { colors } from '../onboarding/index.js';
import { Command, Option } from 'clipanion';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import {
  findAllAgents,
  findAgent,
  discoverAgents,
  discoverAgentsFromPath,
  validateAgent,
  translateAgent,
  getAgentTargetDirectory,
  discoverSkills,
  readSkillContent,
  generateSubagentFromSkill,
  detectProvider,
  isLocalPath,
  type CustomAgent,
  type AgentType,
  type Skill,
  type AgentPermissionMode,
  type SkillToSubagentOptions,
} from '@skillkit/core';
import { detectAgent, getAllAdapters } from '@skillkit/agents';
import {
  getBundledAgents,
  getBundledAgent,
  getAvailableAgents,
  installBundledAgent,
  isAgentInstalled,
  type BundledAgent,
} from '@skillkit/resources';

/**
 * Returns true when `name` looks like a repo identifier rather than a
 * bundled-template name.  Matches:
 *   owner/repo           (GitHub shorthand)
 *   gitlab:owner/repo
 *   bitbucket:owner/repo
 *   ./path  /abs/path  ~/path  (local paths)
 */
export function isRepoInput(name: string): boolean {
  if (name.startsWith('gitlab:') || name.startsWith('bitbucket:')) return true;
  if (isLocalPath(name)) return true;
  // owner/repo — must contain exactly one slash with non-empty segments on
  // both sides, and no spaces (rules out prose like "foo bar/baz").
  const slashIdx = name.indexOf('/');
  if (slashIdx > 0 && slashIdx < name.length - 1 && !name.includes(' ')) return true;
  return false;
}

export class AgentCommand extends Command {
  static override paths = [['agent']];

  static override usage = Command.Usage({
    description: 'Manage custom AI sub-agents',
    details: `
      This command manages custom AI sub-agents that can be used with
      Claude Code, Cursor, and other AI coding agents.

      Agents are specialized personas (like architects, testers, reviewers)
      that can be invoked with @mentions or the --agent flag.

      Sub-commands:
        agent list       - List all installed agents
        agent show       - Show agent details
        agent create     - Create a new agent
        agent from-skill - Convert a skill to a subagent
        agent translate  - Translate agents between formats
        agent sync       - Sync agents to target AI agent
        agent validate   - Validate agent definitions
    `,
    examples: [
      ['List all agents', '$0 agent list'],
      ['Show agent details', '$0 agent show architect'],
      ['Create new agent', '$0 agent create security-reviewer'],
      ['Convert skill to subagent', '$0 agent from-skill code-simplifier'],
      ['Translate to Cursor format', '$0 agent translate --to cursor'],
      ['Sync agents', '$0 agent sync --agent claude-code'],
    ],
  });

  async execute(): Promise<number> {
    console.log(colors.cyan('Agent management commands:\n'));
    console.log('  agent list              List all installed agents');
    console.log('  agent show <name>       Show agent details');
    console.log('  agent create <name>     Create a new agent');
    console.log('  agent from-skill <name> Convert a skill to a subagent');
    console.log('  agent translate         Translate agents between formats');
    console.log('  agent sync              Sync agents to target AI agent');
    console.log('  agent validate [path]   Validate agent definitions');
    console.log();
    console.log(colors.muted('Run `skillkit agent <subcommand> --help` for more info'));
    return 0;
  }
}

export class AgentListCommand extends Command {
  static override paths = [['agent', 'list'], ['agent', 'ls']];

  static override usage = Command.Usage({
    description: 'List all installed agents',
    examples: [
      ['List all agents', '$0 agent list'],
      ['Show JSON output', '$0 agent list --json'],
      ['Show only project agents', '$0 agent list --project'],
    ],
  });

  json = Option.Boolean('--json,-j', false, {
    description: 'Output as JSON',
  });

  project = Option.Boolean('--project,-p', false, {
    description: 'Show only project agents',
  });

  global = Option.Boolean('--global,-g', false, {
    description: 'Show only global agents',
  });

  async execute(): Promise<number> {
    const searchDirs = [process.cwd()];
    let agents = findAllAgents(searchDirs);

    if (this.project) {
      agents = agents.filter((a: CustomAgent) => a.location === 'project');
    } else if (this.global) {
      agents = agents.filter((a: CustomAgent) => a.location === 'global');
    }

    agents.sort((a: CustomAgent, b: CustomAgent) => {
      if (a.location !== b.location) {
        return a.location === 'project' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    if (this.json) {
      console.log(JSON.stringify(agents.map((a: CustomAgent) => ({
        name: a.name,
        description: a.description,
        path: a.path,
        location: a.location,
        enabled: a.enabled,
        model: a.frontmatter.model,
        permissionMode: a.frontmatter.permissionMode,
      })), null, 2));
      return 0;
    }

    if (agents.length === 0) {
      console.log(colors.warning('No agents found'));
      console.log(colors.muted('Create an agent with: skillkit agent create <name>'));
      return 0;
    }

    console.log(colors.cyan(`Installed agents (${agents.length}):\n`));

    const projectAgents = agents.filter((a: CustomAgent) => a.location === 'project');
    const globalAgents = agents.filter((a: CustomAgent) => a.location === 'global');

    if (projectAgents.length > 0) {
      console.log(colors.info('Project agents:'));
      for (const agent of projectAgents) {
        printAgent(agent);
      }
      console.log();
    }

    if (globalAgents.length > 0) {
      console.log(colors.muted('Global agents:'));
      for (const agent of globalAgents) {
        printAgent(agent);
      }
      console.log();
    }

    console.log(
      colors.muted(`${projectAgents.length} project, ${globalAgents.length} global`)
    );

    return 0;
  }
}

export class AgentShowCommand extends Command {
  static override paths = [['agent', 'show'], ['agent', 'info']];

  static override usage = Command.Usage({
    description: 'Show details for a specific agent',
    examples: [
      ['Show agent details', '$0 agent show architect'],
    ],
  });

  name = Option.String({ required: true });

  async execute(): Promise<number> {
    const searchDirs = [process.cwd()];
    const agent = findAgent(this.name, searchDirs);

    if (!agent) {
      console.log(colors.error(`Agent not found: ${this.name}`));
      return 1;
    }

    console.log(colors.cyan(`Agent: ${agent.name}\n`));
    console.log(`${colors.muted('Description:')} ${agent.description}`);
    console.log(`${colors.muted('Location:')} ${agent.location} (${agent.path})`);
    console.log(`${colors.muted('Enabled:')} ${agent.enabled ? colors.success('yes') : colors.error('no')}`);

    const fm = agent.frontmatter;
    if (fm.model) {
      console.log(`${colors.muted('Model:')} ${fm.model}`);
    }
    if (fm.permissionMode) {
      console.log(`${colors.muted('Permission Mode:')} ${fm.permissionMode}`);
    }
    if (fm.context) {
      console.log(`${colors.muted('Context:')} ${fm.context}`);
    }
    if (fm.disallowedTools && fm.disallowedTools.length > 0) {
      console.log(`${colors.muted('Disallowed Tools:')} ${fm.disallowedTools.join(', ')}`);
    }
    if (fm.skills && fm.skills.length > 0) {
      console.log(`${colors.muted('Skills:')} ${fm.skills.join(', ')}`);
    }
    if (fm.hooks && fm.hooks.length > 0) {
      console.log(`${colors.muted('Hooks:')} ${fm.hooks.length} defined`);
    }
    if (fm.tags && fm.tags.length > 0) {
      console.log(`${colors.muted('Tags:')} ${fm.tags.join(', ')}`);
    }
    if (fm.author) {
      console.log(`${colors.muted('Author:')} ${fm.author}`);
    }
    if (fm.version) {
      console.log(`${colors.muted('Version:')} ${fm.version}`);
    }

    console.log();
    console.log(colors.muted('Content preview:'));
    console.log(colors.muted('─'.repeat(40)));
    const preview = agent.content.slice(0, 500);
    console.log(preview + (agent.content.length > 500 ? '\n...' : ''));

    return 0;
  }
}

export class AgentCreateCommand extends Command {
  static override paths = [['agent', 'create'], ['agent', 'new']];

  static override usage = Command.Usage({
    description: 'Create a new agent',
    examples: [
      ['Create an agent', '$0 agent create security-reviewer'],
      ['Create with model', '$0 agent create architect --model opus'],
      ['Create globally', '$0 agent create my-agent --global'],
    ],
  });

  name = Option.String({ required: true });

  model = Option.String('--model,-m', {
    description: 'Model to use (opus, sonnet, haiku)',
  });

  description = Option.String('--description,-d', {
    description: 'Agent description',
  });

  global = Option.Boolean('--global,-g', false, {
    description: 'Create in global agents directory',
  });

  async execute(): Promise<number> {
    const namePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!namePattern.test(this.name)) {
      console.log(colors.error('Invalid agent name: must be lowercase alphanumeric with hyphens'));
      console.log(colors.muted('Examples: my-agent, code-reviewer, security-expert'));
      return 1;
    }

    let targetDir: string;
    if (this.global) {
      targetDir = join(homedir(), '.claude', 'agents');
    } else {
      targetDir = join(process.cwd(), '.claude', 'agents');
    }

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const agentPath = join(targetDir, `${this.name}.md`);
    if (existsSync(agentPath)) {
      console.log(colors.error(`Agent already exists: ${agentPath}`));
      return 1;
    }

    const description = this.description || `${this.name} agent`;
    const content = generateAgentTemplate(this.name, description, this.model);

    writeFileSync(agentPath, content);

    console.log(colors.success(`Created agent: ${agentPath}`));
    console.log();
    console.log(colors.muted('Edit the file to customize the agent system prompt.'));
    console.log(colors.muted(`Invoke with: @${this.name}`));

    return 0;
  }
}

export class AgentTranslateCommand extends Command {
  static override paths = [['agent', 'translate']];

  static override usage = Command.Usage({
    description: 'Translate agents between AI coding agent formats',
    details: `
      Translates agent definitions between different AI coding agent formats.
      Supports recursive translation for directories with multiple agents.

      Use --source to specify a custom source directory with agents.
      Use --recursive to scan all subdirectories for agents.
    `,
    examples: [
      ['Translate all to Cursor', '$0 agent translate --to cursor'],
      ['Translate specific agent', '$0 agent translate architect --to cursor'],
      ['Translate from source directory', '$0 agent translate --source ./my-agents --to cursor'],
      ['Recursive translation', '$0 agent translate --source ./skills --to cursor --recursive'],
      ['Dry run', '$0 agent translate --to cursor --dry-run'],
    ],
  });

  name = Option.String({ required: false });

  to = Option.String('--to,-t', {
    description: 'Target AI agent (claude-code, cursor, codex, etc.)',
    required: true,
  });

  source = Option.String('--source,-s', {
    description: 'Source directory or file to translate from',
  });

  output = Option.String('--output,-o', {
    description: 'Output directory',
  });

  dryRun = Option.Boolean('--dry-run,-n', false, {
    description: 'Show what would be done without writing files',
  });

  all = Option.Boolean('--all,-a', false, {
    description: 'Translate all agents',
  });

  recursive = Option.Boolean('--recursive,-r', false, {
    description: 'Recursively scan directories for agents',
  });

  async execute(): Promise<number> {
    const searchDirs = [process.cwd()];
    const targetAgent = this.to as AgentType;

    let agents: CustomAgent[];

    if (this.source) {
      const sourcePath = this.source.startsWith('/')
        ? this.source
        : join(process.cwd(), this.source);

      if (!existsSync(sourcePath)) {
        console.log(colors.error(`Source path not found: ${sourcePath}`));
        return 1;
      }

      agents = discoverAgentsFromPath(sourcePath, this.recursive);

      if (agents.length === 0) {
        console.log(colors.warning(`No agents found in: ${sourcePath}`));
        if (!this.recursive) {
          console.log(colors.muted('Tip: Use --recursive to scan subdirectories'));
        }
        return 0;
      }
    } else if (this.name) {
      const agent = findAgent(this.name, searchDirs);
      if (!agent) {
        console.log(colors.error(`Agent not found: ${this.name}`));
        return 1;
      }
      agents = [agent];
    } else if (this.all) {
      agents = findAllAgents(searchDirs);
    } else {
      agents = discoverAgents(process.cwd());
    }

    if (agents.length === 0) {
      console.log(colors.warning('No agents found to translate'));
      return 0;
    }

    const outputDir = this.output || getAgentTargetDirectory(process.cwd(), targetAgent);

    console.log(colors.cyan(`Translating ${agents.length} agent(s) to ${targetAgent} format...\n`));

    let successCount = 0;
    let errorCount = 0;

    for (const agent of agents) {
      try {
        const result = translateAgent(agent, targetAgent, { addMetadata: true });

        if (!result.success) {
          console.log(colors.error(`✗ ${agent.name}: Translation failed`));
          errorCount++;
          continue;
        }

        const outputPath = join(outputDir, result.filename);

        if (this.dryRun) {
          console.log(colors.info(`Would write: ${outputPath}`));
          if (result.warnings.length > 0) {
            for (const warning of result.warnings) {
              console.log(colors.warning(`  ⚠ ${warning}`));
            }
          }
          if (result.incompatible.length > 0) {
            for (const incompat of result.incompatible) {
              console.log(colors.muted(`  ○ ${incompat}`));
            }
          }
        } else {
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }
          writeFileSync(outputPath, result.content);
          console.log(colors.success(`✓ ${agent.name} → ${outputPath}`));
        }

        successCount++;
      } catch (error) {
        console.log(colors.error(`✗ ${agent.name}: ${error instanceof Error ? error.message : 'Unknown error'}`));
        errorCount++;
      }
    }

    console.log();
    if (this.dryRun) {
      console.log(colors.muted(`Would translate ${successCount} agent(s)`));
    } else {
      console.log(colors.muted(`Translated ${successCount} agent(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`));
    }

    return errorCount > 0 ? 1 : 0;
  }
}

export class AgentSyncCommand extends Command {
  static override paths = [['agent', 'sync']];

  static override usage = Command.Usage({
    description: 'Sync agents to target AI coding agent',
    examples: [
      ['Sync to Claude Code', '$0 agent sync --agent claude-code'],
      ['Sync to multiple agents', '$0 agent sync --agent claude-code,cursor'],
    ],
  });

  agent = Option.String('--agent,-a', {
    description: 'Target AI agent(s) (comma-separated)',
  });

  async execute(): Promise<number> {
    const searchDirs = [process.cwd()];
    const agents = findAllAgents(searchDirs);

    if (agents.length === 0) {
      console.log(colors.warning('No agents found to sync'));
      return 0;
    }

    const targetAgents = this.agent
      ? this.agent.split(',').map(a => a.trim() as AgentType)
      : ['claude-code' as AgentType];

    console.log(colors.cyan(`Syncing ${agents.length} agent(s)...\n`));

    for (const targetAgent of targetAgents) {
      const outputDir = getAgentTargetDirectory(process.cwd(), targetAgent);

      console.log(colors.info(`→ ${targetAgent} (${outputDir})`));

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      for (const agent of agents) {
        const result = translateAgent(agent, targetAgent);
        if (result.success) {
          const outputPath = join(outputDir, result.filename);
          writeFileSync(outputPath, result.content);
          console.log(colors.success(`  ✓ ${agent.name}`));
        } else {
          console.log(colors.error(`  ✗ ${agent.name}`));
        }
      }
    }

    console.log();
    console.log(colors.muted('Sync complete'));

    return 0;
  }
}

export class AgentValidateCommand extends Command {
  static override paths = [['agent', 'validate']];

  static override usage = Command.Usage({
    description: 'Validate agent definitions',
    examples: [
      ['Validate specific agent', '$0 agent validate ./my-agent.md'],
      ['Validate all agents', '$0 agent validate --all'],
    ],
  });

  agentPath = Option.String({ required: false });

  all = Option.Boolean('--all,-a', false, {
    description: 'Validate all discovered agents',
  });

  async execute(): Promise<number> {
    let hasErrors = false;

    if (this.agentPath) {
      const result = validateAgent(this.agentPath);
      printValidationResult(this.agentPath, result);
      hasErrors = !result.valid;
    } else if (this.all) {
      const searchDirs = [process.cwd()];
      const agents = findAllAgents(searchDirs);

      if (agents.length === 0) {
        console.log(colors.warning('No agents found'));
        return 0;
      }

      console.log(colors.cyan(`Validating ${agents.length} agent(s)...\n`));

      for (const agent of agents) {
        const result = validateAgent(agent.path);
        printValidationResult(agent.name, result);
        if (!result.valid) hasErrors = true;
      }
    } else {
      console.log(colors.warning('Specify a path or use --all to validate all agents'));
      return 1;
    }

    return hasErrors ? 1 : 0;
  }
}

function printAgent(agent: CustomAgent): void {
  const status = agent.enabled ? colors.success('✓') : colors.error('○');
  const name = agent.enabled ? agent.name : colors.muted(agent.name);
  const model = agent.frontmatter.model ? colors.info(`[${agent.frontmatter.model}]`) : '';
  const desc = colors.muted(truncate(agent.description, 40));

  console.log(`  ${status} ${name} ${model}`);
  if (agent.description) {
    console.log(`    ${desc}`);
  }
}

function printValidationResult(
  name: string,
  result: { valid: boolean; errors: string[]; warnings: string[] }
): void {
  if (result.valid) {
    console.log(colors.success(`✓ ${name}`));
    for (const warning of result.warnings) {
      console.log(colors.warning(`  ⚠ ${warning}`));
    }
  } else {
    console.log(colors.error(`✗ ${name}`));
    for (const err of result.errors) {
      console.log(colors.error(`  • ${err}`));
    }
    for (const warning of result.warnings) {
      console.log(colors.warning(`  ⚠ ${warning}`));
    }
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function generateAgentTemplate(name: string, description: string, model?: string): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  if (model) {
    lines.push(`model: ${model}`);
  }
  lines.push('# permissionMode: default');
  lines.push('# disallowedTools: []');
  lines.push('# skills: []');
  lines.push('# context: fork');
  lines.push('---');
  lines.push('');
  lines.push(`# ${formatAgentName(name)}`);
  lines.push('');
  lines.push('You are a specialized AI assistant.');
  lines.push('');
  lines.push('## Responsibilities');
  lines.push('');
  lines.push('- TODO: Define what this agent is responsible for');
  lines.push('- TODO: Add specific tasks and behaviors');
  lines.push('');
  lines.push('## Guidelines');
  lines.push('');
  lines.push('- TODO: Add guidelines for how this agent should behave');
  lines.push('- TODO: Define any constraints or preferences');
  lines.push('');

  return lines.join('\n');
}

function formatAgentName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export class AgentInstallCommand extends Command {
  static override paths = [['agent', 'install']];

  static override usage = Command.Usage({
    description: 'Install a bundled agent template',
    details: `
      Installs a bundled agent template from @skillkit/resources.
      These are battle-tested agent configurations for common tasks.

      Use 'agent available' to see agents that can be installed.
    `,
    examples: [
      ['Install code-reviewer agent', '$0 agent install code-reviewer'],
      ['Install globally', '$0 agent install architect --global'],
      ['Force overwrite existing', '$0 agent install tdd-guide --force'],
      ['Install all bundled agents', '$0 agent install --all'],
    ],
  });

  name = Option.String({ required: false });

  global = Option.Boolean('--global,-g', false, {
    description: 'Install to global agents directory',
  });

  force = Option.Boolean('--force,-f', false, {
    description: 'Overwrite if agent already exists',
  });

  all = Option.Boolean('--all,-a', false, {
    description: 'Install all bundled agents',
  });

  agentType = Option.String('--agent', {
    description: 'Target runtime for translation (e.g. codex, cursor). Auto-detected if not specified.',
  });

  async execute(): Promise<number> {
    if (this.all) {
      return this.installAll();
    }

    if (!this.name) {
      console.log(colors.warning('Please specify an agent name or use --all'));
      console.log(colors.muted('Run `skillkit agent available` to see available agents'));
      return 1;
    }

    if (isRepoInput(this.name)) {
      return this.installFromRepo(this.name);
    }

    const agent = getBundledAgent(this.name);
    if (!agent) {
      console.log(colors.error(`Bundled agent not found: ${this.name}`));
      console.log(colors.muted('Run `skillkit agent available` to see available agents'));
      return 1;
    }

    const result = installBundledAgent(this.name, {
      global: this.global,
      force: this.force,
    });

    if (result.success) {
      console.log(colors.success(`✓ Installed: ${agent.name}`));
      console.log(colors.muted(`  Path: ${result.path}`));
      console.log(colors.muted(`  Invoke with: @${agent.id}`));
    } else {
      console.log(colors.error(`✗ Failed: ${result.message}`));
      return 1;
    }

    return 0;
  }

  private async installFromRepo(source: string): Promise<number> {
    // Resolve target runtime
    let targetAgent: AgentType;
    if (this.agentType) {
      const validTypes = getAllAdapters().map((a: { type: string }) => a.type);
      if (!validTypes.includes(this.agentType)) {
        console.log(colors.error(`Unknown agent type: ${this.agentType}`));
        console.log(colors.muted(`Valid types: ${validTypes.join(', ')}`));
        return 1;
      }
      targetAgent = this.agentType as AgentType;
    } else {
      targetAgent = await detectAgent();
    }

    // Resolve path: local or cloned remote
    const localPath = isLocalPath(source);
    let repoPath: string;
    let tempClonePath: string | undefined;

    if (localPath) {
      repoPath = source.startsWith('/') ? source : join(process.cwd(), source);
      if (!existsSync(repoPath)) {
        console.log(colors.error(`Path not found: ${repoPath}`));
        return 1;
      }
    } else {
      const providerAdapter = detectProvider(source);
      if (!providerAdapter) {
        console.log(colors.error(`Could not detect provider for: ${source}`));
        return 1;
      }
      let cloneResult: { success: boolean; path?: string; tempRoot?: string; error?: string };
      try {
        cloneResult = await providerAdapter.clone(source, '', { depth: 1 });
      } catch (err) {
        const providerError = err instanceof Error ? err.message : String(err);
        console.log(colors.error(`tried as repo: ${providerError}; not in bundled catalog`));
        return 1;
      }
      if (!cloneResult.success || !cloneResult.path) {
        const providerError = cloneResult.error || 'Clone failed';
        console.log(colors.error(`tried as repo: ${providerError}; not in bundled catalog`));
        return 1;
      }
      repoPath = cloneResult.path;
      tempClonePath = cloneResult.tempRoot || cloneResult.path;
    }

    try {
      const agents = discoverAgentsFromPath(repoPath, true);

      if (agents.length === 0) {
        console.log(colors.warning(`No agents found in ${source}`));
        return 0;
      }

      const outputDir = this.global
        ? getAgentTargetDirectory(homedir(), targetAgent)
        : getAgentTargetDirectory(process.cwd(), targetAgent);

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      console.log(colors.cyan(`Installing ${agents.length} agent(s) from ${source} to ${targetAgent}...\n`));

      for (const agent of agents) {
        try {
          const result = translateAgent(agent, targetAgent, { addMetadata: true });

          if (!result.success) {
            console.log(colors.error(`  ✗ ${agent.name}: Translation failed`));
            errorCount++;
            continue;
          }

          const outputPath = join(outputDir, result.filename);

          if (existsSync(outputPath) && !this.force) {
            console.log(colors.warning(`  ○ ${agent.name} already exists at ${outputPath} (use --force to overwrite)`));
            skipCount++;
            continue;
          }

          writeFileSync(outputPath, result.content);
          console.log(colors.success(`  ✓ ${agent.name} → ${outputPath}`));
          successCount++;
        } catch (err) {
          console.log(colors.error(`  ✗ ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`));
          errorCount++;
        }
      }

      console.log();
      console.log(colors.muted(`Installed: ${successCount}, Skipped: ${skipCount}, Errors: ${errorCount}`));

      return errorCount > 0 ? 1 : 0;
    } finally {
      if (!localPath && tempClonePath && existsSync(tempClonePath)) {
        rmSync(tempClonePath, { recursive: true, force: true });
      }
    }
  }

  private async installAll(): Promise<number> {
    const agents = getBundledAgents();
    console.log(colors.cyan(`Installing ${agents.length} bundled agents...\n`));

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const agent of agents) {
      const result = installBundledAgent(agent.id, {
        global: this.global,
        force: this.force,
      });

      if (result.success) {
        console.log(colors.success(`  ✓ ${agent.name}`));
        successCount++;
      } else if (result.message.includes('already exists')) {
        console.log(colors.warning(`  ○ ${agent.name} (already installed)`));
        skipCount++;
      } else {
        console.log(colors.error(`  ✗ ${agent.name}: ${result.message}`));
        errorCount++;
      }
    }

    console.log();
    console.log(
      colors.muted(
        `Installed: ${successCount}, Skipped: ${skipCount}, Errors: ${errorCount}`
      )
    );

    return errorCount > 0 ? 1 : 0;
  }
}

export class AgentAvailableCommand extends Command {
  static override paths = [['agent', 'available'], ['agent', 'bundled']];

  static override usage = Command.Usage({
    description: 'List bundled agents available for installation',
    examples: [
      ['List available agents', '$0 agent available'],
      ['Show JSON output', '$0 agent available --json'],
      ['Filter by category', '$0 agent available --category testing'],
    ],
  });

  json = Option.Boolean('--json,-j', false, {
    description: 'Output as JSON',
  });

  category = Option.String('--category,-c', {
    description: 'Filter by category (planning, development, testing, review, documentation, security, refactoring)',
  });

  installed = Option.Boolean('--installed,-i', false, {
    description: 'Show only installed bundled agents',
  });

  async execute(): Promise<number> {
    let agents: BundledAgent[];

    if (this.installed) {
      agents = getBundledAgents().filter(a => isAgentInstalled(a.id));
    } else {
      agents = getAvailableAgents();
    }

    if (this.category) {
      agents = agents.filter(a => a.category === this.category);
    }

    if (this.json) {
      console.log(JSON.stringify(agents, null, 2));
      return 0;
    }

    if (agents.length === 0) {
      if (this.installed) {
        console.log(colors.warning('No bundled agents installed'));
        console.log(colors.muted('Run `skillkit agent install <name>` to install'));
      } else {
        console.log(colors.success('All bundled agents are already installed!'));
      }
      return 0;
    }

    const title = this.installed
      ? 'Installed Bundled Agents'
      : 'Available Bundled Agents';

    console.log(colors.cyan(`${title} (${agents.length}):\n`));

    const categories = new Map<string, BundledAgent[]>();
    for (const agent of agents) {
      const cat = agent.category;
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(agent);
    }

    for (const [category, catAgents] of categories) {
      console.log(colors.info(`  ${formatCategoryName(category)}`));
      for (const agent of catAgents) {
        const installed = isAgentInstalled(agent.id);
        const status = installed ? colors.success('✓') : colors.muted('○');
        const model = agent.model ? colors.info(`[${agent.model}]`) : '';
        console.log(`    ${status} ${colors.bold(agent.id)} ${model}`);
        console.log(`      ${colors.muted(agent.description)}`);
      }
      console.log();
    }

    if (!this.installed) {
      console.log(colors.muted('Install with: skillkit agent install <name>'));
      console.log(colors.muted('Install all: skillkit agent install --all'));
    }

    return 0;
  }
}

export class AgentFromSkillCommand extends Command {
  static override paths = [['agent', 'from-skill']];

  static override usage = Command.Usage({
    description: 'Convert a skill into a Claude Code subagent',
    details: `
      Converts a SkillKit skill into a Claude Code native subagent format.
      The generated .md file can be used with @mentions in Claude Code.

      By default, the subagent references the skill (skills: [skill-name]).
      Use --inline to embed the full skill content in the system prompt.
    `,
    examples: [
      ['Convert skill to subagent', '$0 agent from-skill code-simplifier'],
      ['Create global subagent', '$0 agent from-skill code-simplifier --global'],
      ['Embed skill content inline', '$0 agent from-skill code-simplifier --inline'],
      ['Set model for subagent', '$0 agent from-skill code-simplifier --model opus'],
      ['Preview without writing', '$0 agent from-skill code-simplifier --dry-run'],
    ],
  });

  skillName = Option.String({ required: true });

  inline = Option.Boolean('--inline,-i', false, {
    description: 'Embed full skill content in system prompt',
  });

  model = Option.String('--model,-m', {
    description: 'Model to use (sonnet, opus, haiku, inherit)',
  });

  permission = Option.String('--permission,-p', {
    description: 'Permission mode (default, plan, auto-edit, full-auto, bypassPermissions)',
  });

  global = Option.Boolean('--global,-g', false, {
    description: 'Create in ~/.claude/agents/ instead of .claude/agents/',
  });

  output = Option.String('--output,-o', {
    description: 'Custom output filename (without .md)',
  });

  dryRun = Option.Boolean('--dry-run,-n', false, {
    description: 'Preview without writing files',
  });

  async execute(): Promise<number> {
    const skills = discoverSkills(process.cwd());
    const skill = skills.find((s: Skill) => s.name === this.skillName);

    if (!skill) {
      console.log(colors.error(`Skill not found: ${this.skillName}`));
      console.log(colors.muted('Available skills:'));
      for (const s of skills.slice(0, 10)) {
        console.log(colors.muted(`  - ${s.name}`));
      }
      if (skills.length > 10) {
        console.log(colors.muted(`  ... and ${skills.length - 10} more`));
      }
      return 1;
    }

    const skillContent = readSkillContent(skill.path);
    if (!skillContent) {
      console.log(colors.error(`Could not read skill content: ${skill.path}`));
      return 1;
    }

    const options: SkillToSubagentOptions = {
      inline: this.inline,
    };

    if (this.model) {
      const validModels = ['sonnet', 'opus', 'haiku', 'inherit'];
      if (!validModels.includes(this.model)) {
        console.log(colors.error(`Invalid model: ${this.model}`));
        console.log(colors.muted(`Valid options: ${validModels.join(', ')}`));
        return 1;
      }
      options.model = this.model as 'sonnet' | 'opus' | 'haiku' | 'inherit';
    }

    if (this.permission) {
      const validModes = ['default', 'plan', 'auto-edit', 'full-auto', 'bypassPermissions'];
      if (!validModes.includes(this.permission)) {
        console.log(colors.error(`Invalid permission mode: ${this.permission}`));
        console.log(colors.muted(`Valid options: ${validModes.join(', ')}`));
        return 1;
      }
      options.permissionMode = this.permission as AgentPermissionMode;
    }

    const content = generateSubagentFromSkill(skill, skillContent, options);

    const targetDir = this.global
      ? join(homedir(), '.claude', 'agents')
      : join(process.cwd(), '.claude', 'agents');

    let filename: string;
    if (this.output) {
      const sanitized = sanitizeFilename(this.output);
      if (!sanitized) {
        console.log(colors.error(`Invalid output filename: ${this.output}`));
        console.log(colors.muted('Filename must contain only alphanumeric characters, hyphens, and underscores'));
        return 1;
      }
      filename = `${sanitized}.md`;
    } else {
      const sanitized = sanitizeFilename(skill.name);
      if (!sanitized) {
        console.log(colors.error(`Invalid skill name for filename: ${skill.name}`));
        console.log(colors.muted('Skill name must contain only alphanumeric characters, hyphens, and underscores'));
        return 1;
      }
      filename = `${sanitized}.md`;
    }

    const outputPath = join(targetDir, filename);

    if (this.dryRun) {
      console.log(colors.cyan('Preview (dry run):\n'));
      console.log(colors.muted(`Would write to: ${outputPath}`));
      console.log(colors.muted('─'.repeat(50)));
      console.log(content);
      console.log(colors.muted('─'.repeat(50)));
      return 0;
    }

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    if (existsSync(outputPath)) {
      console.log(colors.warning(`Overwriting existing file: ${outputPath}`));
    }

    writeFileSync(outputPath, content);

    console.log(colors.success(`Created subagent: ${outputPath}`));
    console.log();
    console.log(colors.muted(`Invoke with: @${skill.name}`));
    if (!this.inline) {
      console.log(colors.muted(`Skills referenced: ${skill.name}`));
    } else {
      console.log(colors.muted('Skill content embedded inline'));
    }

    return 0;
  }
}

function formatCategoryName(category: string): string {
  return category
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sanitizeFilename(input: string): string | null {
  const base = basename(input);
  const stem = base.replace(/\.md$/i, '');

  if (!stem || stem.startsWith('.') || stem.startsWith('-')) {
    return null;
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(stem)) {
    return null;
  }

  if (stem.length > 64) {
    return null;
  }

  return stem;
}
