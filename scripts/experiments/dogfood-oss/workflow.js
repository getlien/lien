/**
 * Dogfood workflow: Lien's MCP tools + nudge plugin, exercised on FOREIGN repos.
 *
 * The authority for hypotheses, corpus, metrics, contamination controls and abort
 * criteria is the frozen protocol at
 * `docs/development/dogfood-oss-corpus-protocol.md`. Read it before running. This
 * script only orchestrates it.
 *
 * Runs as THREE sequential stages, not one mega-run, so a red gate stops the spend
 * and a human reads results between stages:
 *
 *   Workflow({ scriptPath: ".../workflow.js", args: { stage: "provision" } })
 *   Workflow({ scriptPath: ".../workflow.js", args: { stage: "surface"   } })
 *   Workflow({ scriptPath: ".../workflow.js", args: { stage: "behavioral"} })
 *
 * Stage `provision` must go green before `surface`; `surface` before `behavioral`.
 */

export const meta = {
  name: 'dogfood-oss',
  description:
    'Dogfood Lien MCP tools + nudge plugin on foreign OSS repos (contamination-controlled)',
  whenToUse:
    "Extensive dogfood of the six MCP tools and the ten nudge hooks, run outside this repo so Lien's own tool-mandating CLAUDE.md cannot manufacture the behavior under measurement.",
  phases: [
    {
      title: 'Provision',
      detail: 'build, clone corpus at pinned SHAs, assert C1, index, assert task headroom',
    },
    {
      title: 'Tools',
      detail: 'one agent per MCP tool: doc-vs-actual + edge matrix on foreign repos',
    },
    {
      title: 'Hooks',
      detail: 'zero-LLM hook plumbing: channels, kill switches, guard, fail-open, latency',
    },
    { title: 'Trials', detail: 'headless claude sessions on ordinary tasks in cloned repos' },
    { title: 'Audit', detail: 'adversarial refutation of every nudge that fired' },
    { title: 'ColdStart', detail: 'first-run UX: no global lien, npx path, never-indexed repo' },
    { title: 'Synthesis', detail: 'rank findings, per-nudge trust ledger, lien stats funnel read' },
  ],
};

const STAGE = (args && args.stage) || 'provision';

// Every dogfood agent runs on Sonnet — this is a wide fan-out and the work is
// build/probe/verify, which is exactly what the repo's model policy assigns to
// Sonnet. Orchestration stays on the session model.
const MODEL = (args && args.model) || 'sonnet';
// The one place the policy carves out for Opus is adversarial review, and Phase 4
// IS adversarial review (refuting another agent's claim). It still defaults to
// Sonnet to keep this run cheap; override with args.auditModel = 'opus' if a
// refutation pass comes back unconvincing.
const AUDIT_MODEL = (args && args.auditModel) || MODEL;

const KIT = 'scripts/experiments/dogfood-oss';
// Where Phase 0 cloned the corpus. Outside the Lien tree on purpose: cloning under
// the checkout would put Lien's own tool-mandating CLAUDE.md on every clone's
// ancestor path, which is the exact contamination C1 exists to prevent.
const CORPUS_ROOT =
  (args && args.corpusRoot) || '/Users/alfhenderson/.claude/jobs/460173c9/tmp/corpus';
const PROTOCOL = 'docs/development/dogfood-oss-corpus-protocol.md';

// Corpus per protocol §2. `known` repos have established ground truth from the
// 2026-07-25 sweep; `fresh` repos guard against overfitting the extractors.
//
// Every entry was screened against control C1 (no agent-instruction files) on
// 2026-07-28. That screen REJECTED cli/cli (AGENTS.md), guzzle/guzzle and
// onevcat/Kingfisher (both AGENTS.md + CLAUDE.md) — Go, PHP and Swift, three of the
// four languages whose test-association layer was measured broken in the 2026-07-25
// sweep. Each was replaced IN-LANGUAGE rather than dropped, because dropping them
// would remove the most load-bearing coverage in this protocol. The screen was against
// default branches: the provisioner must RE-ASSERT C1 at the pinned SHA and across
// ancestor directories.
const CORPUS = [
  { repo: 'pallets/flask', lang: 'python', tier: 'known' },
  { repo: 'gin-gonic/gin', lang: 'go', tier: 'known' },
  { repo: 'tokio-rs/tokio', lang: 'rust', tier: 'known' },
  { repo: 'Alamofire/Alamofire', lang: 'swift', tier: 'known' },
  { repo: 'honojs/hono', lang: 'typescript', tier: 'fresh' },
  { repo: 'square/retrofit', lang: 'java', tier: 'fresh' },
  { repo: 'symfony/console', lang: 'php', tier: 'fresh' },
  { repo: 'serilog/serilog', lang: 'csharp', tier: 'fresh' },
  { repo: 'sidekiq/sidekiq', lang: 'ruby', tier: 'fresh' },
];

const TOOLS = [
  {
    name: 'search_code',
    edges:
      'empty/whitespace query, 1-char query, unicode, regex-special chars, LIEN_STRUCTURAL_RANKING=off vs on ordering, relevance-vs-order disagreement (documented as legitimate — verify it is actually reachable)',
  },
  {
    name: 'find_similar',
    edges:
      'snippet under the documented 24-char floor, language filter matching nothing, pathHint matching nothing, prunedLowRelevance accounting',
  },
  {
    name: 'get_files_context',
    edges:
      'single vs batch shape divergence, nonexistent path, directory as path, absolute vs relative path, batch mixing valid+invalid, complexityHeadroom / complexityHeadroomMore presence',
  },
  {
    name: 'list_functions',
    edges:
      'pagination boundary offset==total, offset beyond total, over-max limit, catastrophic-backtracking pattern, symbolType filter with no matches, method vs content path',
  },
  {
    name: 'get_dependents',
    edges:
      'depth on a symbol-level query (documented depth-1 only), depth 2..5, truncated flag at maxNodes, hops field, symbol not exported, test vs production split',
  },
  {
    name: 'get_complexity',
    edges:
      'whole-codebase call cost, threshold below every function, metricType variants, files[] with nonexistent entries, severity/riskLevel consistency',
  },
];

const HOOKS = [
  'annotate-read.sh',
  'delta-write.sh',
  'test-reminder.sh',
  'api-delta-write.sh',
  'test-run-note.sh',
  'nudge-signal.sh',
  'recap-stop.sh',
  'augment-explore-task.sh',
  'annotate-clean.sh',
  'annotate-end.sh',
];

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coverage'],
  properties: {
    coverage: {
      type: 'string',
      description: 'What was actually exercised, and what was NOT reached and why',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'evidence', 'expected', 'actual'],
        properties: {
          severity: { enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          surface: { type: 'string', description: 'tool name, hook filename, or CLI command' },
          language: { type: 'string' },
          repo: { type: 'string' },
          expected: { type: 'string', description: 'what the docs/description promise' },
          actual: { type: 'string', description: 'what actually happened' },
          evidence: { type: 'string', description: 'VERBATIM command + output. No paraphrase.' },
        },
      },
    },
  },
};

const TRIALS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['repo', 'trials'],
  properties: {
    repo: { type: 'string' },
    trials: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'nudgesFired', 'actedOn', 'transcriptPath'],
        properties: {
          task: { enum: ['T1-signature', 'T2-test-verify'] },
          nudgesFired: {
            type: 'array',
            description: 'M1: one entry per nudge that actually emitted',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['hook', 'claimText'],
              properties: {
                hook: { type: 'string' },
                claimText: {
                  type: 'string',
                  description: 'VERBATIM nudge text — Phase 4 refutes this exact claim',
                },
                latencyMs: { type: 'number' },
              },
            },
          },
          actedOn: {
            type: 'string',
            description: 'M3: deterministic evidence the agent followed up, or "none"',
          },
          transcriptPath: { type: 'string' },
          contaminationAsserted: {
            type: 'boolean',
            description: 'C1+C2 both re-asserted for this trial',
          },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: {
      type: 'boolean',
      description: 'true = the nudge asserted something FALSE about the code',
    },
    reasoning: { type: 'string' },
    groundTruth: { type: 'string', description: 'What the code actually shows, with file:line' },
  },
};

const CONTEXT = `
You are dogfooding Lien — a local-first structural code search + dependency analysis
tool that exposes six MCP tools and a Claude Code plugin of ten nudge hooks.

READ FIRST: ${PROTOCOL} (the frozen protocol) and ${KIT}/ (the instrument).

NON-NEGOTIABLE — contamination control C1: every behavioral observation and every
tool call against corpus code MUST target a CLONED FOREIGN REPO under the corpus
directory, never the Lien repo itself. Lien's own CLAUDE.md mandates Lien tool usage,
so any measurement taken inside this repo measures the instructions, not the product.
If you find yourself running a corpus tool call with cwd inside the Lien checkout,
stop and fix it — that data is void.

Report findings, not reassurance. Every finding needs a VERBATIM repro (command and
output). "Seems to work" is not a result. If you could not reach something, say so
explicitly in \`coverage\` — silent partial coverage reads as full coverage and is
the failure mode this protocol most wants to avoid.

## Phase 0 is DONE — use what it built, do not redo it

All nine repos are cloned and indexed. Do NOT re-clone or re-index.

  Corpus root: ${CORPUS_ROOT}
  Manifest:    ${KIT}/corpus-manifest.json  (per-repo dir, pinned SHA, M6 metrics)
  CLI:         \`node packages/cli/dist/index.js <cmd>\` — \`lien\` is NOT on PATH here.

**To call an MCP tool, use the provided stdio client** — do not call handler
functions directly (that skips the schema/envelope layer most likely to be wrong)
and do not use this session's own MCP server (it is bound to the Lien repo, which
C1 forbids as a measurement target):

  node ${KIT}/mcp-call.mjs <repoDir> <toolName> '<jsonArgs>'
  node ${KIT}/mcp-call.mjs <repoDir> --list

It prints \`{ok, ms, tool, args, result|error}\` and refuses any repoDir inside the
Lien checkout. A tool-level error exits 0 with \`ok:false\` — that is a successful
measurement, not a harness fault.

## Already-known findings — do not re-report these as new

Phase 0 established these. Extend or contradict them with evidence if warranted,
but they are already filed and being fixed:
- Test-association coverage is near-zero on PHP (symfony/console 0%) and Swift
  (Alamofire 0%), and low on Java (retrofit 8%), while TS 88% / Go 64% / Rust 60% /
  C# 52% are healthy. Fix agents are in flight.
- \`get_files_context\` returns \`ok:true\` with empty \`chunks\`/\`testAssociations\`
  for a path that is not in the index, with no error — a silent-empty trust bug. A
  fix agent is in flight.
`;

// ─────────────────────────────────────────────────────────────────────────────

if (STAGE === 'provision') {
  phase('Provision');
  log('Stage 1/3 — provision. No LLM trials; this stage only earns the right to spend.');

  const provision = await agent(
    `${CONTEXT}

TASK — Phase 0 of the protocol. Build the instrument, then provision the corpus.

1. Build: \`npm run build\` and \`npm run build:native -w @liendev/parser-native\`.
   Note that \`lien\` is NOT on PATH on this machine — invoke the CLI as
   \`node packages/cli/dist/index.js\`. Record that fact; it matters for Phase 5.

2. Write the provisioner at ${KIT}/provision.mjs. Model it closely on the proven
   \`scripts/experiments/nudge-ab-v2/run.mjs\` — reuse its contamination plumbing
   (assertNoAncestorClaudeMd, the per-invocation --settings override that disables
   the ambient lien@lien plugin, the saved-settings byte comparison) rather than
   reinventing it. It must:
   - clone each corpus repo shallow-but-pinned into a gitignored corpus dir, and
     record the resolved SHA;
   - assert C1 per repo (no CLAUDE.md / AGENTS.md / .cursor/rules / .cursorrules /
     .github/copilot-instructions.md in the clone OR any ancestor up to /) and
     QUARANTINE — visibly, never silently — any repo that fails;
   - index each clone with the built CLI;
   - record M6 per repo: file count, chunk count, dependency-edge count,
     test-association coverage %;
   - emit a machine-readable manifest at ${KIT}/corpus-manifest.json.

3. Corpus (protocol §2): ${CORPUS.map(c => `${c.repo} (${c.lang}, ${c.tier})`).join('; ')}.

4. Assert task headroom per protocol §3 for both T1 and T2 on every repo, with ZERO
   LLM spend: (a) synthesize the hook's stdin and confirm the nudge actually fires on
   that edit; (b) confirm the target file carries no in-file hint of the nudged fact
   (no caller name, no test-file reference). Re-site or drop any pair that fails —
   a task-forced pair produces a guaranteed null and wastes the whole trial.

5. Evaluate the protocol's abort criteria and state plainly whether Stage 2 is
   cleared to run.

Report M6 per repo and per language. A repo Lien cannot index IS a finding — file it,
do not drop it.`,
    { label: 'provision:corpus', phase: 'Provision', schema: FINDINGS_SCHEMA, model: MODEL },
  );

  return {
    stage: 'provision',
    protocol: PROTOCOL,
    provision,
    next: provision
      ? 'Read coverage + findings, confirm the abort criteria are clear, then run stage "surface".'
      : 'Provision agent returned nothing — inspect the journal before retrying.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────

if (STAGE === 'surface') {
  phase('Tools');
  log(
    `Stage 2/3 — surface truth-testing: ${TOOLS.length} MCP tools + ${HOOKS.length} hooks. Deterministic, no headless sessions.`,
  );

  // Tools and hooks are independent; no barrier between them.
  const toolWork = TOOLS.map(
    t => () =>
      agent(
        `${CONTEXT}

TASK — Phase 1 for the MCP tool \`${t.name}\`.

Read its description verbatim from \`packages/cli/src/mcp/tools.ts\` and its handler
in \`packages/cli/src/mcp/handlers/\`. Then drive it against THREE corpus repos from
${KIT}/corpus-manifest.json — pick three different languages, and prefer at least one
\`fresh\`-tier repo.

Grade M5 in both directions, which is the part that usually gets skipped:
  (a) every field the description PROMISES is actually present in real responses;
  (b) every field actually RETURNED is documented somewhere.
A response field nobody documented is a finding. A documented field that never
materializes is a bigger one.

Edge matrix to work through: ${t.edges}.

For each edge case record the verbatim call and the verbatim response. Judge failure
modes as a consumer would: is the error message actionable, or does it just say no?
Ask specifically whether an agent that had never read Lien's docs could use this
tool correctly from its description alone — that is the real bar, since the plugin's
premise is exactly that population of agents.`,
        { label: `tool:${t.name}`, phase: 'Tools', schema: FINDINGS_SCHEMA, model: MODEL },
      ),
  );

  const hookWork = [
    () =>
      agent(
        `${CONTEXT}

TASK — Phase 2, hook plumbing, PART A: the annotators and write-time nudges
(${HOOKS.slice(0, 5).join(', ')}).

ZERO LLM behavioral trials here — invoke each hook directly with the REAL stdin JSON
shape Claude Code sends, against a CORPUS repo (cwd = the clone, not this repo). The
exact fields each hook reads are visible in its own \`jq -r\` calls; derive the shape
from those, do not guess.

Assert per hook:
- the documented output channel is the one actually used —
  \`hookSpecificOutput.additionalContext\` for the annotators, \`updatedInput\` for
  augment-explore-task.sh, \`{"decision":"block","reason":...}\` for recap-stop.sh;
- fail-open on: garbage stdin, empty stdin, missing fields, jq unavailable,
  unindexed file, file outside the indexed extension set;
- every env kill switch is honored: LIEN_ANNOTATE_GUARD, LIEN_ANNOTATE_MIN_RISK,
  LIEN_ANNOTATE_TTL_MIN, LIEN_DELTA_HOOK, LIEN_TEST_REMINDER, LIEN_TEST_VERIFY,
  LIEN_BLAST_HOOK, LIEN_NUDGE_EVENTS;
- the habituation guard suppresses a repeat annotation of the same file within a
  session and respects the risk floor;
- a session_id containing path-traversal characters is REJECTED (these values are
  interpolated into filesystem paths);
- M4: wall-clock latency per invocation vs. the 5 s timeout in hooks.json, measured
  both warm and cold.

Report anything that emits on a case the header comment claims is silent — an
always-on hook that fires on advisory movement becomes wallpaper, and that is a
design-intent violation, not a nitpick.`,
        { label: 'hooks:annotators', phase: 'Hooks', schema: FINDINGS_SCHEMA, model: MODEL },
      ),
    () =>
      agent(
        `${CONTEXT}

TASK — Phase 2, hook plumbing, PART B: the session/telemetry hooks
(${HOOKS.slice(5).join(', ')}) plus the telemetry pipeline.

Same method as Part A: real stdin shapes, cwd = a CORPUS clone, zero behavioral
trials. Assert channels, fail-open, kill switches (LIEN_RECAP, LIEN_EXPLORE_INJECT,
LIEN_SUBAGENT_NUDGE, LIEN_NUDGE_EVENTS, LIEN_TEST_VERIFY), traversal rejection, and
M4 latency.

Three cases deserve specific attention:

1. recap-stop.sh MUST honor \`stop_hook_active\`. It returns
   \`{"decision":"block"}\`, so a missing or mishandled guard is an INFINITE LOOP,
   not a cosmetic bug. Prove the guard works, and prove what happens when the field
   is absent entirely.

2. augment-explore-task.sh rewrites a subagent prompt via \`updatedInput\`. Verify
   idempotency (it must skip a prompt that already references a Lien tool), and
   verify it handles both \`Agent\` and \`Task\` tool names — Claude Code has renamed
   this tool across versions and a silent miss makes the hook a no-op.

3. The events pipeline: nudge-signal.sh and test-run-note.sh write the \`acted-on\`
   side of the funnels. Confirm a shown→acted-on join actually lands in
   nudge-events.jsonl for a corpus repo, then read it back with
   \`node packages/cli/dist/index.js stats --format json\`. Check the 2 MB byte cap
   trim behavior and confirm reading is NOT gated by LIEN_NUDGE_EVENTS=off (only
   writing should be).`,
        { label: 'hooks:session+telemetry', phase: 'Hooks', schema: FINDINGS_SCHEMA, model: MODEL },
      ),
  ];

  const surface = await parallel([...toolWork, ...hookWork]);
  // Partition at the FIXED boundary, then drop falsy entries within each side.
  // parallel() resolves a dead agent to null POSITIONALLY, so filtering the
  // combined array first would shrink it and slide a hook report into the tool
  // partition — mislabeling it silently, which is exactly the kind of quiet data
  // corruption this protocol is supposed to be intolerant of.
  const toolReports = surface.slice(0, TOOLS.length).filter(Boolean);
  const hookReports = surface.slice(TOOLS.length).filter(Boolean);

  return {
    stage: 'surface',
    protocol: PROTOCOL,
    toolReports,
    hookReports,
    next: 'Fix any HIGH plumbing finding BEFORE stage "behavioral" — silent plumbing is indistinguishable from a behavioral null (protocol §7).',
  };
}

// ─────────────────────────────────────────────────────────────────────────────

if (STAGE === 'behavioral') {
  phase('Trials');
  log(
    `Stage 3/3 — ${CORPUS.length} repos x 2 tasks = ${CORPUS.length * 2} headless sessions, then adversarial truth audit.`,
  );

  // Pipeline, not barrier: a repo's nudges get refuted the moment its trials finish,
  // while slower repos are still running their sessions.
  const perRepo = await pipeline(
    CORPUS,
    c =>
      agent(
        `${CONTEXT}

TASK — Phase 3 trials for \`${c.repo}\` (${c.lang}, ${c.tier}-tier).

The runner already exists — DO NOT write your own. Use it:

    node ${KIT}/trial.mjs <repoKey> <taskId>
    node ${KIT}/trial.mjs --list          # what is sited

repoKey for this repo is the clone's basename. Run every task sited for it in
${KIT}/tasks.json. Tasks are NOT sited for every repo/shape combination: T2
(test-verify) is deliberately absent where test-association coverage is 0%, because
the nudge physically cannot fire there and the trial would be a guaranteed null. If
no task is sited for this repo, say so and stop — do not invent one.

trial.mjs already handles: the settings file (hook wiring derived from the shipped
hooks.json), the \`lien\` shim pointing at THIS build, the MCP server pointed at the
clone, \`--model sonnet\`, C1/C2/C4 assertions, transcript capture, event collection,
and a git reset before and after. It writes
\`${KIT}/trials/<repoKey>-<taskId>/result.json\`.

**Read result.json — do not re-derive its contents from the transcript.**

CRITICAL measurement fact, established empirically before this stage ran: with
\`--output-format stream-json --verbose\`, PostToolUse \`additionalContext\` NEVER
appears in the transcript. Only SessionStart hook events do. A probe confirmed the
annotate nudge fired and wrote a \`shown\` row to nudge-events.jsonl while leaving
zero trace in the transcript.

So:
  M1 (fired)     — comes from \`nudgeEvents\` in result.json. NOT from the transcript.
  claim text     — comes from \`reconstructedNudges\` (replayed at the same SHA).
                   Pass it through VERBATIM; Phase 4 refutes that exact string.
  M3 (acted on)  — comes from the transcript: look for a get_dependents call naming
                   the symbol (T1), or a Bash test run covering the associated test
                   (T2). "none" is a perfectly good answer — record it, do not soften
                   it, and do not infer what the agent "would have" done.

Report a trial that failed to run as a failure. Never substitute a run inside the
Lien repo, and never hand-simulate a session.
`,
        { label: `trial:${c.lang}`, phase: 'Trials', schema: TRIALS_SCHEMA, model: MODEL },
      ),
    (trialResult, c) => {
      const fired = (trialResult && trialResult.trials ? trialResult.trials : []).flatMap(t =>
        (t.nudgesFired || []).map(n => ({ ...n, task: t.task })),
      );
      if (fired.length === 0)
        return {
          repo: c.repo,
          lang: c.lang,
          trialResult,
          audits: [],
          note: 'no nudge fired — nothing to refute',
        };

      // Two independent skeptics per fired nudge; disagreement is itself a signal.
      return parallel(
        fired.flatMap(n =>
          [
            'does-the-structure-really-say-this',
            'is-this-the-code-a-maintainer-would-agree-with',
          ].map(
            lens => () =>
              agent(
                `${CONTEXT}

TASK — Phase 4 adversarial truth audit. Your job is to REFUTE, not to confirm.

Repo: \`${c.repo}\` (${c.lang}). Hook: \`${n.hook}\` (task ${n.task}).
The nudge asserted, verbatim:

"""
${n.claimText}
"""

Lens for this pass: ${lens}.

Verify that claim against the repo's ACTUAL code — the clone, not the Lien repo, and
not Lien's index as the source of truth. Read the real files. Do those dependents
exist and do they really reach this symbol? Is that risk level defensible on the
evidence? Is that genuinely the test file covering this change, per this ecosystem's
conventions? Did that function truly cross the threshold?

${c.lang} matters here specifically: the test-association layer was measured 100%
broken on PHP, Go, Swift and C# mainstream conventions before the #907/#909/#911/#913/
#914 fixes. This audit is how we find out whether those fixes held on code nobody
tuned them against. A nudge that asserts something FALSE is the worst failure mode
this product has — worse than staying silent — so set refuted=true when the claim
does not hold, and default to refuted=true when you cannot verify it.

Cite file:line for the ground truth.`,
                {
                  label: `refute:${c.lang}:${n.hook}`,
                  phase: 'Audit',
                  schema: VERDICT_SCHEMA,
                  model: AUDIT_MODEL,
                },
              ).then(v => ({
                hook: n.hook,
                task: n.task,
                lens,
                claimText: n.claimText,
                verdict: v,
              })),
          ),
        ),
      ).then(audits => ({
        repo: c.repo,
        lang: c.lang,
        trialResult,
        audits: audits.filter(Boolean),
      }));
    },
  );

  const repos = perRepo.filter(Boolean);

  phase('ColdStart');
  const coldStart = await parallel([
    () =>
      agent(
        `${CONTEXT}

TASK — Phase 5: honestly test the plugin's advertised claim, quoted from
plugins/claude/.claude-plugin/plugin.json: "No per-project setup required."

Use a corpus repo that has NEVER been indexed (clone a fresh one if the manifest has
none left). With NO global \`lien\` on PATH — the real default; it is not linked on
this machine — walk the genuine first-run path:

- \`lien-resolve.sh\`'s fallback to \`npx -y @liendev/lien@latest\`: measure COLD and
  WARM latency against the 5 s hooks.json timeout. If a cold npx exceeds it, every
  hook silently no-ops on first use and the "no setup required" claim is false in
  practice — that is a HIGH finding, so measure it, do not estimate it.
- What does the very first \`Read\` surface when no index exists yet? Silence,
  an error, or a useful message?
- Does anything auto-index, and if so what does the user see while waiting?
- Multi-repo cwd resolution: hooks resolve the store from the session cwd. Test a
  cwd that is a subdirectory, and a cwd in a different repo than the file being read.
- The linked-worktree overlay path (read-only base + writable overlay).

Report what a first-time user actually experiences, in order, with timings.`,
        { label: 'coldstart:first-run', phase: 'ColdStart', schema: FINDINGS_SCHEMA, model: MODEL },
      ),
    () =>
      agent(
        `${CONTEXT}

TASK — Phase 5b: the honesty of the nudges' own text, as a foreign consumer reads it.

Collect every distinct nudge string the corpus produced this run (from the trial
transcripts and by re-invoking hooks against corpus clones). For each, judge purely
as an agent with no Lien knowledge would:

- Is it ACTIONABLE — does it say what to do next, or only that something is scary?
- Does it name real files/symbols a reader can go open?
- Is its confidence calibrated to its evidence? Flag anything that states a derived
  approximation as fact. \`dependentCount\` from search_code, for instance, is
  documented as a cheap approximation and NOT get_dependents' authoritative count —
  if any nudge or tool surface blurs that distinction, that is a finding.
- Would it become wallpaper at the frequency it actually fires? Quantify the rate
  from this run rather than guessing.
- Does any nudge contradict another nudge in the same session?

This is the trust surface. A nudge that is technically true but unusable is still a
product defect.`,
        {
          label: 'coldstart:nudge-text',
          phase: 'ColdStart',
          schema: FINDINGS_SCHEMA,
          model: MODEL,
        },
      ),
  ]);

  phase('Synthesis');
  const falseNudges = repos.flatMap(r =>
    (r.audits || [])
      .filter(a => a.verdict && a.verdict.refuted)
      .map(a => ({
        repo: r.repo,
        lang: r.lang,
        hook: a.hook,
        lens: a.lens,
        claim: a.claimText,
        why: a.verdict.reasoning,
        groundTruth: a.verdict.groundTruth,
      })),
  );

  const synthesis = await agent(
    `${CONTEXT}

TASK — Phase 6: synthesis and the first substantive telemetry read.

Inputs: the per-repo trial + audit results, and the two cold-start reports. The
refuted-nudge set this run produced is:

${JSON.stringify(falseNudges, null, 2)}

Produce:

1. A **per-nudge trust ledger**, one row per hook x language: fired / truthful /
   acted-on. Truthfulness is the headline column. Mark any hook that fired with a
   refuted claim as UNTRUSTWORTHY for that language and say so in plain words.

2. A ranked findings list, most severe first. Rank by consumer harm: a nudge that
   asserts something false outranks a missing feature, which outranks a doc
   inaccuracy. Merge duplicates across agents. Every surviving finding keeps its
   verbatim repro.

3. The telemetry read: \`node packages/cli/dist/index.js stats --format json\` over
   the corpus indices. Report the shown -> acted-on funnels per nudge. State
   explicitly, in the output, that these are SINGLE-ARM observation rates and NOT
   lift — per protocol §4, the only publishable Lien nudge lift claims come from the
   paired-arm A/B v2. Do not let a rate get read as a lift.

4. An explicit coverage gap list: what this run did NOT exercise, and why. Silent
   partial coverage is the failure mode the protocol most wants to avoid.

5. A recommended issue list — title + severity + the one-line repro each — ready for
   a human to file. Do NOT file them yourself.

Write the full report to .wip/dogfood-oss-report.md and return the ranked findings.`,
    { label: 'synthesis:report', phase: 'Synthesis', schema: FINDINGS_SCHEMA, model: MODEL },
  );

  return {
    stage: 'behavioral',
    protocol: PROTOCOL,
    reposRun: repos.length,
    falseNudgeCount: falseNudges.length,
    falseNudges,
    coldStart: coldStart.filter(Boolean),
    synthesis,
    report: '.wip/dogfood-oss-report.md',
  };
}

throw new Error(`Unknown stage "${STAGE}" — expected "provision", "surface", or "behavioral".`);
