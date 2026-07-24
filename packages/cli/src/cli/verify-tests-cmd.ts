/**
 * `lien verify-tests` — FEATURE 2, the did-you-run-the-tests verification
 * nudge. A session-scoped command group (like `lien config`) driving a
 * three-hook pipeline: `note-edit` (post-edit, records + reminds),
 * `note-run` (post-Bash, records silently), `report` (Stop, the
 * model-visible advisory). See docs/architecture/test-verification-nudge.md.
 *
 * Every subcommand is fail-open by construction: any error is swallowed and
 * the process still exits 0, since these run inside hooks that must never
 * block the agent's tool call or trap it at Stop.
 */

import { lookupTestAssociations, formatTestReminder } from './annotate-cmd.js';
import { resolveProjectRoot } from './project-root.js';
import { toAbsolutePath } from '../types/paths.js';
import { recordEdit, recordRun, readSession, type TestLedgerEvent } from '../utils/test-ledger.js';
import {
  classifyTestCommand,
  computeUnverifiedFiles,
  type TestRunClassification,
} from '../utils/test-run-matcher.js';

export interface NoteEditOptions {
  session?: string;
  file?: string;
  format?: string;
}
export interface NoteRunOptions {
  session?: string;
  command?: string;
}
export interface ReportOptions {
  session?: string;
  format?: string;
}

const VALID_FORMATS = ['text', 'json'];

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

async function runNoteEdit(options: NoteEditOptions): Promise<void> {
  const format = options.format ?? 'text';
  if (!options.session || !options.file || !VALID_FORMATS.includes(format)) return;

  const result = await lookupTestAssociations(options.file);
  if (!result || result.tests.length === 0) {
    if (format === 'json') console.log(JSON.stringify({ filepath: options.file, tests: [] }));
    return;
  }

  await recordEdit(result.rootDir, options.session, result.filepath, result.tests);
  if (format === 'json') {
    console.log(JSON.stringify({ filepath: result.filepath, tests: result.tests }));
  } else {
    console.log(formatTestReminder(result.filepath, result.tests));
  }
}

/** `note-edit --session <id> --file <path>`: the ledger-recording replacement for `lien annotate --tests-only`. */
export async function noteEditCommand(options: NoteEditOptions): Promise<void> {
  await runFailOpen(() => runNoteEdit(options));
}

async function runNoteRun(options: NoteRunOptions): Promise<void> {
  if (!options.session || !options.command) return;
  const classification = classifyTestCommand(options.command);
  if (!classification.isTestRun) return;
  await recordRun(resolveRootDir(), options.session, options.command);
}

/** `note-run --session <id> --command <cmd>`: silent recording only — never emits to stdout. */
export async function noteRunCommand(options: NoteRunOptions): Promise<void> {
  await runFailOpen(() => runNoteRun(options));
}

function splitSessionEvents(events: TestLedgerEvent[]): {
  edits: Map<string, string[]>;
  runs: TestRunClassification[];
} {
  const edits = new Map<string, string[]>();
  const runs: TestRunClassification[] = [];
  for (const event of events) {
    if (event.kind === 'edit') {
      edits.set(event.file, event.tests); // last-write-wins; a file's test associations don't change mid-session
    } else {
      runs.push(classifyTestCommand(event.command));
    }
  }
  return { edits, runs };
}

const MAX_TESTS_SHOWN_PER_FILE = 1;

function formatUnverifiedTests(tests: string[]): string {
  const shown = tests.slice(0, MAX_TESTS_SHOWN_PER_FILE).join(', ');
  const extra =
    tests.length > MAX_TESTS_SHOWN_PER_FILE
      ? ` (+${tests.length - MAX_TESTS_SHOWN_PER_FILE} more)`
      : '';
  return `${shown}${extra}`;
}

/**
 * Render the Stop-hook advisory (frozen wording — see the design doc's
 * "Advisory wording" section; the escape-hatch sentence is load-bearing, do
 * not shorten it away). Pure and exported so the wording is unit-testable.
 */
export function formatVerifyTestsAdvisory(
  unverified: Array<{ file: string; tests: string[] }>,
): string {
  const lines = [
    'Before finishing: these files you edited this session have associated tests I',
    'did not observe running in a Bash command:',
    ...unverified.map(u => `  • ${u.file} → ${formatUnverifiedTests(u.tests)}`),
    "If you already ran them (watch mode, an IDE, or a wrapper this ledger can't see),",
    'disregard and stop again. Otherwise, consider running them before you finish.',
  ];
  return lines.join('\n');
}

async function runReport(options: ReportOptions): Promise<void> {
  const format = options.format ?? 'text';
  if (!options.session || !VALID_FORMATS.includes(format)) return;

  const events = await readSession(resolveRootDir(), options.session);
  const { edits, runs } = splitSessionEvents(events);
  const unverified = computeUnverifiedFiles(edits, runs);

  if (format === 'json') {
    console.log(JSON.stringify({ unverified }));
    return;
  }
  if (unverified.length === 0) return;
  console.log(formatVerifyTestsAdvisory(unverified));
}

/** `report --session <id>`: the Stop hook's data source. Does not clear the ledger — see SessionEnd/SessionStart GC. */
export async function reportCommand(options: ReportOptions): Promise<void> {
  await runFailOpen(() => runReport(options));
}
