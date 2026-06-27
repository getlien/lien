/**
 * GitHub Actions logger.
 *
 * Implements the {@link Logger} interface that `@liendev/review` expects,
 * writing to stdout using GitHub workflow commands so messages render with the
 * right severity in the Actions log:
 * - `::error::` / `::warning::` annotate the run for error/warning levels
 * - `info`/`debug` print plainly (debug is gated behind `RUNNER_DEBUG`)
 * - {@link group} / {@link endGroup} wrap collapsible sections
 *
 * Writes via `process.stdout` (not `console`) because workflow commands are a
 * stdout protocol — `::error::` is a log directive, not an actual stderr error.
 * See https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */

import type { Logger } from '@liendev/review';

/** Escape a workflow-command message so `::`, newlines etc. don't break parsing. */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escape a workflow-command property value (stricter than message: also `:` and `,`). */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

export const actionLogger: Logger = {
  info: (message: string) => emit(message),
  warning: (message: string) => emit(`::warning::${escapeData(message)}`),
  error: (message: string) => emit(`::error::${escapeData(message)}`),
  debug: (message: string) => {
    if (process.env.RUNNER_DEBUG === '1') emit(`::debug::${escapeData(message)}`);
  },
};

/** Open a collapsible group in the Actions log. */
export function group(title: string): void {
  emit(`::group::${escapeData(title)}`);
}

/** Close the current collapsible group. */
export function endGroup(): void {
  emit('::endgroup::');
}

/**
 * Emit a GitHub Actions annotation bound to a file + line, so it renders inline
 * on the PR diff and on the job's check. Used in single-check mode (no separate
 * Lien Review check run) to surface findings where the check-run annotations
 * would otherwise have appeared.
 */
export function annotate(
  level: 'notice' | 'warning' | 'error',
  loc: { file: string; line: number; endLine?: number; title?: string },
  message: string,
): void {
  const props = [`file=${escapeProperty(loc.file)}`, `line=${loc.line}`];
  if (loc.endLine != null) props.push(`endLine=${loc.endLine}`);
  if (loc.title) props.push(`title=${escapeProperty(loc.title)}`);
  emit(`::${level} ${props.join(',')}::${escapeData(message)}`);
}
