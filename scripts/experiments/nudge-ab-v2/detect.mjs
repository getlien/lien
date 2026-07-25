// Deterministic, pre-registered metric detection for nudge-ab-v2.
// FROZEN: these rules are the pre-registration. No post-hoc edits once trials
// have run. Pure functions over a captured stream-json transcript — no LLM,
// no network, unit-inspectable.

// --- transcript parsing ---------------------------------------------------

// stream-json (with --verbose) is newline-delimited JSON. Assistant tool calls
// live in message.content[] blocks of type 'tool_use'; assistant prose lives in
// type 'text' blocks; the terminal {type:'result'} line carries `result`
// (final text) and `session_id`.
function parseLines(text) {
  const objs = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      objs.push(JSON.parse(trimmed));
    } catch {
      /* skip non-JSON lines */
    }
  }
  return objs;
}

function collectBlocks(obj, toolUses, textBlocks) {
  const content = obj?.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type === 'tool_use') {
      toolUses.push({ name: block.name || '', input: block.input || {} });
    } else if (block?.type === 'text' && typeof block.text === 'string') {
      textBlocks.push(block.text);
    }
  }
}

export function parseTranscript(text) {
  const toolUses = [];
  const textBlocks = [];
  let resultText = '';
  let sessionId = '';
  for (const obj of parseLines(text)) {
    if (obj.type === 'result' && typeof obj.result === 'string') resultText += '\n' + obj.result;
    if (obj.session_id && !sessionId) sessionId = obj.session_id;
    collectBlocks(obj, toolUses, textBlocks);
  }
  const finalText = (textBlocks.join('\n') + '\n' + resultText).trim();
  return { toolUses, finalText, sessionId };
}

// --- BLAST primary metric -------------------------------------------------
// FROZEN. Positive iff the agent takes a CONCRETE action to identify callers of
// the changed symbol BEYOND the edited file — a search for the symbol, or
// opening/naming a specific out-of-directory dependent. Generic hedging
// ("other callers may need updating") that neither searches for nor names a
// specific dependent does NOT count: that sentiment is the ceiling the prior
// A/B hit, so the discriminator is deliberately raised to observable action.

const SYMBOL = 'applyDiscount';
const DEPENDENT_HINTS = [
  'cart.ts',
  'cartTotal',
  'invoice.ts',
  'invoiceLine',
  'checkout/',
  'reports/',
];
const SEARCH_TOOLS = ['grep', 'rg', 'ripgrep', 'ag ', 'git grep', 'findstr'];

function bashIsSymbolSearch(command) {
  if (!command.includes(SYMBOL)) return false;
  return SEARCH_TOOLS.some(t => command.includes(t));
}

const str = v => String(v ?? '');
const hasHint = s => DEPENDENT_HINTS.some(h => s.includes(h));

function grepReasons(input) {
  const reasons = [];
  if (str(input.pattern).includes(SYMBOL)) reasons.push(`grep pattern for ${SYMBOL}`);
  if (hasHint(str(input.path) + ' ' + str(input.glob)))
    reasons.push('grep scoped to dependent path');
  return reasons;
}

function bashReasons(input) {
  const cmd = str(input.command);
  const reasons = [];
  if (bashIsSymbolSearch(cmd)) reasons.push('bash search for symbol');
  if (hasHint(cmd)) reasons.push('bash referenced a dependent path');
  return reasons;
}

// Reasons a single tool_use counts as concrete beyond-file caller action.
function blastReasonsForTool(tu) {
  const name = str(tu.name).toLowerCase();
  const input = tu.input || {};
  if (name === 'grep') return grepReasons(input);
  if (name === 'bash') return bashReasons(input);
  if (name === 'read') return hasHint(str(input.file_path)) ? ['read dependent file'] : [];
  if (name === 'glob') return hasHint(str(input.pattern)) ? ['glob for dependent path'] : [];
  return [];
}

export function blastMetric(toolUses, finalText) {
  const reasons = toolUses.flatMap(blastReasonsForTool);
  // (B3) final answer names a specific dependent by identifier/file
  const named = DEPENDENT_HINTS.filter(h => finalText.includes(h));
  if (named.length > 0) reasons.push(`named specific dependent(s): ${named.join(', ')}`);
  return { hit: reasons.length > 0, reasons };
}

// A weaker, prior-art-style sentiment signal, recorded for context only — NOT
// the primary metric. True when the agent hedges about callers/dependents
// without any concrete action or specific naming.
const GENERIC_CALLER_WORDS = [
  'caller',
  'callers',
  'dependent',
  'depends on',
  'depend on',
  'usage',
  'used elsewhere',
];
export function blastGenericSentiment(finalText, primaryHit) {
  if (primaryHit) return false;
  const t = finalText.toLowerCase();
  return GENERIC_CALLER_WORDS.some(w => t.includes(w));
}

// --- VERIFY: transcript cross-check ---------------------------------------
// The authoritative oracle for "did the agent run the associated test" is the
// FEATURE-2 ledger, queried post-run by the runner via
// `lien verify-tests report` (reuses the shipped classifyTestCommand, no drift).
// This transcript scan is a recorded cross-check only. FROZEN.

const TEST_TOKENS = ['regression-suite.test.ts', 'order-status'];
export function verifyTranscriptRanTest(toolUses) {
  const reasons = [];
  for (const tu of toolUses) {
    if (tu.name.toLowerCase() !== 'bash') continue;
    const cmd = String(tu.input?.command || '');
    const looksLikeRunner =
      /\b(vitest|npm\s+(run\s+)?test|npm\s+t|jest|mocha|pnpm|yarn\s+test)\b/.test(cmd);
    if (!looksLikeRunner) continue;
    const scoped = TEST_TOKENS.some(t => cmd.includes(t));
    const broad = !/\.(test|spec)\.[tj]sx?/.test(cmd) && !cmd.includes('/');
    if (scoped) reasons.push(`scoped run: ${cmd}`);
    else if (broad) reasons.push(`broad run: ${cmd}`);
  }
  return { hit: reasons.length > 0, reasons };
}

// --- contamination scan (both arms; hard-fail if hit in an OFF arm) --------
// FROZEN. Any of these surfacing in a transcript means the clean-context
// guarantee leaked (repo CLAUDE.md, Lien plugin MCP instructions, etc.).
const CONTAMINATION_TERMS = [
  'get_dependents',
  'get_files_context',
  'search_code',
  'claude.md',
  'lien',
  'blast radius',
  'blast-radius',
  'complexity threshold',
  'test association',
  'testassociation',
];
export function contaminationScan(text) {
  const t = text.toLowerCase();
  return CONTAMINATION_TERMS.filter(term => t.includes(term));
}

// A trial (or probe/warm) call that came back unauthenticated — the first call
// against a brand-new CLAUDE_CONFIG_DIR can race on auth. Such a trial is
// invalid (never a measured negative) and re-drawn.
const LOGGED_OUT_RE =
  /not logged in|please run \/login|invalid api key|authentication_error|oauth token .*expired/i;
export function looksLoggedOut(text) {
  return LOGGED_OUT_RE.test(text || '');
}

// Did the agent actually edit the target file? Guards the verify oracle: an
// EMPTY `verify-tests report` means "test observed run" ONLY if the file was
// really edited — a no-op/logged-out trial also produces an empty report and
// must NOT be scored as a run (it is invalid instead).
export function editedTarget(toolUses, targetPath) {
  const base = targetPath.split('/').pop();
  return toolUses.some(
    tu =>
      /^(edit|write|multiedit)$/i.test(tu.name || '') &&
      String(tu.input?.file_path || '').includes(base),
  );
}

// --- tool-permission denials (logged per arm; must difference out) --------
// The allowlist is identical in both arms, so any denial is a constant, not a
// confound. We record them so arm-symmetry can be verified after the run.
const DENIAL_RE =
  /permission|haven't granted|not allowed|requested permission|denied|isn't allowed/i;

function denialText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map(c => (typeof c?.text === 'string' ? c.text : '')).join(' ');
  return '';
}

function summarizeToolInput(tu) {
  const i = tu.input || {};
  return String(i.command || i.file_path || i.pattern || i.path || '').slice(0, 120);
}

function indexToolUseIds(objs) {
  const map = new Map();
  for (const obj of objs) {
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content)
      if (b?.type === 'tool_use') map.set(b.id, { name: b.name, input: b.input });
  }
  return map;
}

function isDeniedResult(b) {
  return b?.type === 'tool_result' && b.is_error && DENIAL_RE.test(denialText(b.content));
}

function denialsInObj(obj, idToTool) {
  const content = obj?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isDeniedResult).map(b => {
    const tu = idToTool.get(b.tool_use_id) || {};
    return { tool: tu.name || 'unknown', detail: summarizeToolInput(tu) };
  });
}

export function collectDenials(text) {
  const objs = parseLines(text);
  const idToTool = indexToolUseIds(objs);
  return objs.flatMap(obj => denialsInObj(obj, idToTool));
}
