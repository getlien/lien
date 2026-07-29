/**
 * `lien nudge` — the recording side of the nudge-outcome funnels (telemetry v2).
 * A command group (like `lien verify-tests`) driving the plugin hooks: the
 * emitting hooks call `note-shown` when a nudge surfaces, and a PostToolUse hook
 * on the Lien MCP tools calls `note-signal` when a follow-up call is observed.
 * The funnels themselves are reported by `lien stats`, not here — this command
 * only appends to `nudge-events.jsonl` (see `../utils/nudge-events.ts`).
 *
 * Every subcommand is fail-open by construction: any error is swallowed and the
 * process still exits 0, since these run inside hooks that must never block the
 * agent's tool call. A missing/invalid argument is a silent no-op for the same
 * reason (mirrors `verify-tests`).
 */

import { resolveProjectRoot } from './project-root.js';
import { toAbsolutePath } from '../types/paths.js';
import {
  recordNudgeShown,
  recordNudgeSignal,
  isNudgeName,
  isNudgeSignalName,
} from '../utils/nudge-events.js';

export interface NoteShownOptions {
  session?: string;
  nudge?: string;
  file?: string;
  symbol?: string;
  hooksDir?: string;
}

export interface NoteSignalOptions {
  session?: string;
  signal?: string;
  file?: string;
  symbol?: string;
  hooksDir?: string;
}

function resolveRootDir(): string {
  return resolveProjectRoot(toAbsolutePath(process.cwd()));
}

/** Every subcommand shares this shape: run the real work, swallow any error, always exit 0. */
async function runFailOpen(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // Fail-open: these commands back hooks that must never block the agent.
  }
  process.exit(0);
}

async function runNoteShown(options: NoteShownOptions): Promise<void> {
  if (!options.session || !options.nudge || !isNudgeName(options.nudge)) return;
  await recordNudgeShown(resolveRootDir(), {
    sessionId: options.session,
    nudge: options.nudge,
    file: options.file,
    symbol: options.symbol,
    hooksDir: options.hooksDir,
  });
}

/** `note-shown --session <id> --nudge <name> [--file <path>] [--symbol <s>]`: record that a nudge surfaced. */
export async function noteShownCommand(options: NoteShownOptions): Promise<void> {
  await runFailOpen(() => runNoteShown(options));
}

async function runNoteSignal(options: NoteSignalOptions): Promise<void> {
  if (!options.session || !options.signal || !isNudgeSignalName(options.signal)) return;
  await recordNudgeSignal(resolveRootDir(), {
    sessionId: options.session,
    signal: options.signal,
    file: options.file,
    symbol: options.symbol,
    hooksDir: options.hooksDir,
  });
}

/** `note-signal --session <id> --signal <name> [--file <path>] [--symbol <s>]`: record a follow-up tool call. */
export async function noteSignalCommand(options: NoteSignalOptions): Promise<void> {
  await runFailOpen(() => runNoteSignal(options));
}
