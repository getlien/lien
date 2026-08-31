/**
 * Normalizes the deterministic signal modules' fifteen result shapes into one
 * renderable list.
 *
 * `@liendev/parser`'s signals each answer a different structural question, so
 * each returns a different type — one keyed by a changed site, one by a doc
 * line, one by a type-and-variant pair. The review engine handled that by
 * giving every module its own `render*Section` that emits a prompt block for a
 * model. `lien review` prints to a terminal for a person, so it needs its own
 * projection: file, optional line, one line of detail.
 *
 * Each adapter here is deliberately dumb — pick the location, phrase the fact.
 * No filtering, no ranking, no severity. These modules emit CANDIDATES FOR
 * ADJUDICATION, not findings; their precision is unmeasured, which is why this
 * command has no `--fail-on` and never exits non-zero on what it finds.
 */

import {
  collectGuidanceSurfaceChanges,
  computeComparisonChanges,
  computeDocsDriftCandidates,
  computeRemovedExportContexts,
  computeRenameSweepSignals,
  computeSimplicitySignals,
  computeStaleLiteralCandidates,
  computeTestCoverageGaps,
  computeUndiscriminatedCatches,
  computeUnreadFieldCandidates,
  computeVariantSweepContexts,
  extractDocClaims,
  extractSiblingSurfaces,
  extractUntrustedInputSites,
  type SignalContext,
} from '@liendev/parser';

/** One thing worth a look, located in the tree. */
export interface ReviewCandidate {
  file: string;
  line?: number;
  /** One line, phrased as the fact — not a verdict. */
  detail: string;
}

export interface SignalReport {
  id: string;
  title: string;
  /** The question the signal asks, so a reader can judge whether they care. */
  question: string;
  candidates: ReviewCandidate[];
  /**
   * A constraint that shaped this result, when one did. Printed even for an
   * empty result: "nothing found" and "could not look" are the same shape
   * otherwise, which is the failure this repo's index-state-honesty rule is
   * about.
   */
  limitation?: string;
}

/** Modules hard-gated to TypeScript/JavaScript by their own file filters. */
const TS_JS_ONLY = 'TypeScript/JavaScript only — other languages in this diff were not examined.';

/** Modules that need the whole-repo corpus to say anything useful. */
const NEEDS_REPO = 'Needs the repo-wide scan; run without --no-repo-scan for this one.';

const truncate = (s: string, max = 100): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function staleLiterals(context: SignalContext): ReviewCandidate[] {
  return computeStaleLiteralCandidates(context).map(c => ({
    file: c.changedSite.file,
    line: c.changedSite.line,
    detail:
      `${JSON.stringify(c.literal)} changed here (${c.kind}, ${c.confidence} confidence) ` +
      `but still appears at ${plural(c.staleSites.length, 'other site')}`,
  }));
}

function undiscriminatedCatches(context: SignalContext): ReviewCandidate[] {
  return computeUndiscriminatedCatches(context).map(c => ({
    file: c.file,
    line: c.line,
    detail:
      c.binding === null
        ? `catch with no binding — ${c.reason}`
        : `catch (${c.binding}) — ${c.reason}`,
  }));
}

function comparisonChanges(context: SignalContext): ReviewCandidate[] {
  return computeComparisonChanges(context).map(c => ({
    file: c.file,
    line: c.line,
    detail: `${truncate(c.oldFragment, 40)} → ${truncate(c.newFragment, 40)} (${c.kind}) — ${c.reason}`,
  }));
}

function removedExports(context: SignalContext): ReviewCandidate[] {
  return computeRemovedExportContexts(context).map(c => ({
    file: c.file,
    detail:
      `${c.symbol} removed from the exported surface; ` +
      `${plural(c.survivingReferences.length, 'surviving reference')}` +
      (c.changesetFile === null ? '; no changeset mentions it' : ''),
  }));
}

function variantSweeps(context: SignalContext): ReviewCandidate[] {
  return computeVariantSweepContexts(context).map(c => ({
    file: c.file,
    detail:
      `${c.typeName} gained variant ${c.variant} (${c.kind}); ` +
      `${plural(c.consumers.length, 'consumer')} may need the new case`,
  }));
}

function unreadFields(context: SignalContext): ReviewCandidate[] {
  return computeUnreadFieldCandidates(context).map(c => ({
    file: c.file,
    line: c.line,
    detail: `${c.typeName}.${c.field} added (${c.kind}) but never read`,
  }));
}

function siblingSurfaces(context: SignalContext): ReviewCandidate[] {
  return extractSiblingSurfaces(context).map(entry => {
    const kind = entry.isMirror ? 'mirror sibling' : 'sibling';
    const detail =
      entry.direction === 'unmirrored-addition'
        ? `${entry.display} added here but absent from ${plural(entry.siblings.length, kind)}`
        : `${entry.display} is shared by ${plural(entry.siblings.length, kind)} but absent here`;
    return { file: entry.file, line: entry.line, detail };
  });
}

function untrustedInput(patches: Map<string, string>): ReviewCandidate[] {
  return extractUntrustedInputSites(patches).map(s => ({
    file: s.file,
    line: s.line,
    detail: `${s.pattern} — ${truncate(s.snippet, 70)}`,
  }));
}

function testCoverage(context: SignalContext): ReviewCandidate[] {
  return computeTestCoverageGaps(context).map(file => ({
    file,
    detail: 'changed, with no test file associated with it',
  }));
}

function docsDrift(context: SignalContext): ReviewCandidate[] {
  return computeDocsDriftCandidates(context).map(c => ({
    file: c.docFile,
    line: c.docLine,
    detail: `still names ${c.referand} (${c.referandKind}, ${c.positionTier}) — ${truncate(c.excerpt, 70)}`,
  }));
}

function docClaims(patches: Map<string, string>): ReviewCandidate[] {
  return extractDocClaims(patches).map(claim => ({
    file: claim.file,
    detail: `${claim.shape}: ${truncate(claim.claimText, 90)}`,
  }));
}

function guidanceSurfaces(patches: Map<string, string>): ReviewCandidate[] {
  return collectGuidanceSurfaceChanges(patches).map(change => ({
    file: change.file,
    detail: 'agent-guidance or project documentation changed in this diff',
  }));
}

function renameSweeps(context: SignalContext): ReviewCandidate[] {
  const out: ReviewCandidate[] = [];
  for (const signal of computeRenameSweepSignals(context)) {
    const { from, to, occurrenceCount, fileCount } = signal.mapping;
    const swept = `${from} → ${to} (${occurrenceCount}× across ${fileCount} files)`;
    for (const prose of signal.proseTouched) {
      out.push({
        file: prose.file,
        line: prose.line,
        detail: `${swept}: swap landed in ${prose.kind} — ${truncate(prose.sentence, 70)}`,
      });
    }
    for (const survivor of signal.survivors) {
      const where = survivor.repoWide ? 'untouched file' : 'this diff';
      out.push({
        file: survivor.file,
        line: survivor.line,
        detail: `${swept}: old name survives in ${where} — ${truncate(survivor.snippet, 60)}`,
      });
    }
  }
  return out;
}

function simplicity(chunks: SignalContext['chunks'], changedFiles: string[]): ReviewCandidate[] {
  return computeSimplicitySignals(chunks, changedFiles)
    .filter(s => s.flagged)
    .map(s => ({ file: s.file, detail: s.reason }));
}

export interface RunSignalsOptions {
  /** False when the repo-wide corpus was not gathered. */
  repoScanned: boolean;
  /** True when the diff contains a file outside TypeScript/JavaScript. */
  hasNonTsJs: boolean;
}

/**
 * Run every signal over one context and return a report per signal, in a fixed
 * order so successive runs on the same diff are byte-comparable.
 */
export function runSignals(
  context: SignalContext,
  changedFiles: string[],
  options: RunSignalsOptions,
): SignalReport[] {
  const patches = context.pr?.patches ?? new Map<string, string>();
  const tsJs = options.hasNonTsJs ? TS_JS_ONLY : undefined;
  const repo = options.repoScanned ? undefined : NEEDS_REPO;

  return [
    {
      id: 'stale-literal',
      title: 'Stale duplicate literals',
      question: 'A literal changed here — does the old value still appear elsewhere?',
      candidates: staleLiterals(context),
      limitation: repo,
    },
    {
      id: 'removed-export',
      title: 'Removed exports',
      question: 'A symbol left the exported surface — does anything still reference it?',
      candidates: removedExports(context),
      limitation: repo,
    },
    {
      id: 'variant-sweep',
      title: 'Unswept variants',
      question: 'A variant was added — did every consumer that switches on it get the new case?',
      candidates: variantSweeps(context),
      limitation: tsJs,
    },
    {
      id: 'unread-field',
      title: 'Fields added but never read',
      question: 'A field was added to a type — does anything read it?',
      candidates: unreadFields(context),
      limitation: tsJs,
    },
    {
      id: 'catch-discrimination',
      title: 'Undiscriminated catches',
      question: 'A catch clause was added or changed — does it degrade indiscriminately?',
      candidates: undiscriminatedCatches(context),
      limitation: tsJs,
    },
    {
      id: 'comparison-change',
      title: 'Comparison and boundary changes',
      question: 'A comparison or index expression changed — is the new boundary right?',
      candidates: comparisonChanges(context),
    },
    {
      id: 'sibling-surface',
      title: 'Sibling surfaces',
      question: 'Was this applied to one member of a family and not its siblings?',
      candidates: siblingSurfaces(context),
      limitation: repo,
    },
    {
      id: 'rename-sweep',
      title: 'Rename sweeps',
      question: 'A mechanical rename — did it leave stale prose or unrenamed survivors?',
      candidates: renameSweeps(context),
      limitation: repo,
    },
    {
      id: 'untrusted-input',
      title: 'Untrusted input sites',
      question: 'Did this diff add a read of external input without validating it?',
      candidates: untrustedInput(patches),
    },
    {
      id: 'test-coverage',
      title: 'Changed files with no tests',
      question: 'Which changed files have no associated test file at all?',
      // Suppressed entirely without the repo scan, rather than run on absent
      // data. This signal reads `complexityReport.files[f].testAssociations`,
      // which is empty for every file until the corpus fills it in — so running
      // it unfed does not produce a weaker answer, it produces a confident
      // wrong one: every changed file reported as untested.
      candidates: options.repoScanned ? testCoverage(context) : [],
      limitation: repo,
    },
    {
      id: 'docs-drift',
      title: 'Documentation drift',
      question: 'Does an untouched doc still name something this change removed or renamed?',
      candidates: docsDrift(context),
      limitation: repo,
    },
    {
      id: 'doc-claims',
      title: 'Documentation claims touched',
      question: 'Which claims did the docs in this diff make, that need to still be true?',
      candidates: docClaims(patches),
    },
    {
      id: 'guidance-surface',
      title: 'Guidance surfaces changed',
      question: 'Did this diff change agent guidance or project documentation?',
      candidates: guidanceSurfaces(patches),
    },
    {
      id: 'simplicity',
      title: 'Structural complexity',
      question: 'Is a changed file over-abstracted, even with no single function over threshold?',
      candidates: simplicity(context.chunks, changedFiles),
    },
  ];
}
