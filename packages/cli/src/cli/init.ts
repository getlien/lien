import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { showCompactBanner } from '../utils/banner.js';

export type EditorId =
  | 'cursor'
  | 'claude-code'
  | 'windsurf'
  | 'opencode'
  | 'kilo-code'
  | 'antigravity';

interface EditorDefinition {
  name: string;
  configPath: ((rootDir: string) => string) | null; // null = snippet-only
  configKey: string; // 'mcpServers' or 'mcp'
  buildEntry: (rootDir: string) => Record<string, unknown>;
  restartMessage: string;
}

const EDITORS: Record<EditorId, EditorDefinition> = {
  cursor: {
    name: 'Cursor',
    configPath: rootDir => path.join(rootDir, '.cursor', 'mcp.json'),
    configKey: 'mcpServers',
    buildEntry: () => ({ command: 'lien', args: ['serve'] }),
    restartMessage: 'Restart Cursor to activate.',
  },
  'claude-code': {
    name: 'Claude Code',
    configPath: rootDir => path.join(rootDir, '.mcp.json'),
    configKey: 'mcpServers',
    buildEntry: () => ({ command: 'lien', args: ['serve'] }),
    restartMessage: 'Restart Claude Code to activate.',
  },
  windsurf: {
    name: 'Windsurf',
    configPath: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    configKey: 'mcpServers',
    buildEntry: rootDir => ({
      command: 'lien',
      args: ['serve', '--root', path.resolve(rootDir)],
    }),
    restartMessage: 'Restart Windsurf to activate.',
  },
  opencode: {
    name: 'OpenCode',
    configPath: rootDir => path.join(rootDir, 'opencode.json'),
    configKey: 'mcp',
    buildEntry: () => ({ type: 'local', command: ['lien', 'serve'] }),
    restartMessage: 'Restart OpenCode to activate.',
  },
  'kilo-code': {
    name: 'Kilo Code',
    configPath: rootDir => path.join(rootDir, '.kilocode', 'mcp.json'),
    configKey: 'mcpServers',
    buildEntry: () => ({ command: 'lien', args: ['serve'] }),
    restartMessage: 'Restart VS Code to activate.',
  },
  antigravity: {
    name: 'Antigravity',
    configPath: null,
    configKey: 'mcpServers',
    buildEntry: () => ({ command: 'lien', args: ['serve'] }),
    restartMessage: 'Add this to your Antigravity MCP settings.',
  },
};

export interface InitOptions {
  editor?: EditorId;
  path?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function displayPath(configPath: string, rootDir: string): string {
  const rel = path.relative(rootDir, configPath);
  if (!rel.startsWith('..')) return rel;
  const home = os.homedir();
  if (configPath.startsWith(home)) return '~' + configPath.slice(home.length);
  return configPath;
}

async function writeEditorConfig(editor: EditorDefinition, rootDir: string): Promise<void> {
  const configPath = editor.configPath!(rootDir);
  const entry = editor.buildEntry(rootDir);
  const key = editor.configKey;

  let existingConfig: Record<string, unknown> | null = null;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) {
      existingConfig = parsed;
    }
  } catch {
    // File doesn't exist or isn't valid JSON
  }

  const existingSection = existingConfig?.[key] as Record<string, unknown> | undefined;

  if (existingSection?.lien) {
    console.log(
      chalk.green(
        `\n✓ Already configured — ${displayPath(configPath, rootDir)} contains lien entry`,
      ),
    );
    return;
  }

  if (existingConfig) {
    const section = isPlainObject(existingSection) ? { ...existingSection } : {};
    section.lien = entry;
    existingConfig[key] = section;
    await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2) + '\n');
    console.log(chalk.green(`\n✓ Added lien to existing ${displayPath(configPath, rootDir)}`));
  } else {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const config = { [key]: { lien: entry } };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(chalk.green(`\n✓ Created ${displayPath(configPath, rootDir)}`));
  }
}

async function promptForEditor(): Promise<EditorId> {
  const { default: inquirer } = await import('inquirer');
  const { editor } = await inquirer.prompt<{ editor: EditorId }>([
    {
      type: 'list',
      name: 'editor',
      message: 'Which editor are you using?',
      choices: [
        { name: 'Cursor', value: 'cursor' },
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Windsurf', value: 'windsurf' },
        { name: 'OpenCode', value: 'opencode' },
        { name: 'Kilo Code', value: 'kilo-code' },
        { name: 'Antigravity', value: 'antigravity' },
      ],
      default: 'cursor',
    },
  ]);
  return editor;
}

export async function initCommand(options: InitOptions = {}) {
  showCompactBanner();

  const rootDir = options.path || process.cwd();

  // Resolve editor
  let editorId: EditorId;
  if (options.editor) {
    editorId = options.editor;
  } else if (!process.stdout.isTTY) {
    console.error(chalk.red('Error: Use --editor to specify your editor in non-interactive mode.'));
    process.exit(1);
  } else {
    editorId = await promptForEditor();
  }

  const editor = EDITORS[editorId];

  if (editor.configPath) {
    await writeEditorConfig(editor, rootDir);
    console.log(chalk.dim(`  ${editor.restartMessage}\n`));
  } else {
    // Snippet-only editor (e.g. Antigravity)
    const entry = editor.buildEntry(rootDir);
    const snippet = { [editor.configKey]: { lien: entry } };
    console.log(chalk.yellow(`\n${editor.restartMessage}`));
    console.log(JSON.stringify(snippet, null, 2));
  }

  // Check if old config exists and warn
  const legacyConfigPath = path.join(rootDir, '.lien.config.json');
  try {
    await fs.access(legacyConfigPath);
    console.log(chalk.yellow('⚠️  Note: .lien.config.json found but no longer used'));
    console.log(chalk.dim('  You can safely delete it.'));
  } catch {
    // Config doesn't exist - that's fine
  }
}
