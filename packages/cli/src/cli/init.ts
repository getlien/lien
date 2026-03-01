import { execFileSync } from 'child_process';
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

interface LspServerDefinition {
  command: string;
  args: string[];
  extensionToLanguage: Record<string, string>;
  markers: string[];
  markerExtensions?: string[];
  installHint: string;
}

const LSP_SERVERS: Record<string, LspServerDefinition> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    },
    markers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    installHint: 'npm install -g typescript-language-server typescript',
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensionToLanguage: { '.py': 'python' },
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
    installHint: 'pip install pyright  OR  npm install -g pyright',
  },
  go: {
    command: 'gopls',
    args: ['serve'],
    extensionToLanguage: { '.go': 'go' },
    markers: ['go.mod'],
    installHint: 'go install golang.org/x/tools/gopls@latest',
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    extensionToLanguage: { '.rs': 'rust' },
    markers: ['Cargo.toml'],
    installHint: 'rustup component add rust-analyzer',
  },
  php: {
    command: 'phpactor',
    args: ['language-server'],
    extensionToLanguage: { '.php': 'php' },
    markers: ['composer.json'],
    installHint: 'composer global require phpactor/phpactor',
  },
  java: {
    command: 'jdtls',
    args: [],
    extensionToLanguage: { '.java': 'java' },
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    installHint: 'See https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  },
  csharp: {
    command: 'csharp-ls',
    args: [],
    extensionToLanguage: { '.cs': 'csharp' },
    markers: [],
    markerExtensions: ['.csproj', '.sln'],
    installHint: 'dotnet tool install -g csharp-ls',
  },
};

export interface InitOptions {
  editor?: EditorId;
  path?: string;
  withLsp?: boolean;
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

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeEditorConfig(editor: EditorDefinition, rootDir: string): Promise<void> {
  const configPath = editor.configPath!(rootDir);
  const entry = editor.buildEntry(rootDir);
  const key = editor.configKey;
  const label = displayPath(configPath, rootDir);

  const existingConfig = await readJsonFile(configPath);
  const existingSection = existingConfig?.[key] as Record<string, unknown> | undefined;

  if (existingSection?.lien) {
    console.log(chalk.green(`\n✓ Already configured — ${label} contains lien entry`));
    return;
  }

  if (existingConfig) {
    const section = isPlainObject(existingSection) ? { ...existingSection } : {};
    section.lien = entry;
    existingConfig[key] = section;
    await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2) + '\n');
    console.log(chalk.green(`\n✓ Added lien to existing ${label}`));
  } else {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const config = { [key]: { lien: entry } };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(chalk.green(`\n✓ Created ${label}`));
  }
}

function isCommandAvailable(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function detectProjectLanguages(rootDir: string): Promise<string[]> {
  let rootFiles: string[];
  try {
    rootFiles = await fs.readdir(rootDir);
  } catch {
    return [];
  }

  const detected: string[] = [];
  for (const [serverKey, def] of Object.entries(LSP_SERVERS)) {
    const hasMarker = def.markers.some(marker => rootFiles.includes(marker));
    const hasMarkerExtension =
      def.markerExtensions?.some(ext => rootFiles.some(f => f.endsWith(ext))) ?? false;
    if (hasMarker || hasMarkerExtension) {
      detected.push(serverKey);
    }
  }
  return detected;
}

function buildLspConfig(serverKeys: string[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const key of serverKeys) {
    const def = LSP_SERVERS[key];
    const entry: Record<string, unknown> = {
      command: def.command,
      extensionToLanguage: def.extensionToLanguage,
    };
    if (def.args.length > 0) {
      entry.args = def.args;
    }
    config[key] = entry;
  }
  return config;
}

async function writeLspConfig(rootDir: string): Promise<void> {
  const lspConfigPath = path.join(rootDir, '.lsp.json');
  const label = displayPath(lspConfigPath, rootDir);

  const existing = await readJsonFile(lspConfigPath);
  if (existing && Object.keys(existing).length > 0) {
    console.log(chalk.green(`\n✓ Already configured — ${label} exists`));
    return;
  }

  const detected = await detectProjectLanguages(rootDir);
  if (detected.length === 0) {
    console.log(chalk.dim('\n  No supported languages detected — skipping .lsp.json'));
    return;
  }

  const config = buildLspConfig(detected);
  await fs.writeFile(lspConfigPath, JSON.stringify(config, null, 2) + '\n');
  console.log(chalk.green(`\n✓ Created ${label} with ${detected.join(', ')} support`));

  for (const key of detected) {
    const server = LSP_SERVERS[key];
    if (!isCommandAvailable(server.command)) {
      console.log(
        chalk.yellow(`  ⚠️  ${server.command} not found — install: ${server.installHint}`),
      );
    }
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

  // Handle --with-lsp
  if (options.withLsp) {
    if (editorId !== 'claude-code') {
      console.log(chalk.yellow('\n  --with-lsp is currently only supported for Claude Code'));
    } else {
      await writeLspConfig(rootDir);
    }
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
