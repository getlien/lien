// src/index.ts
import * as core from "@actions/core";
import * as github from "@actions/github";

// ../review/dist/index.js
import * as fs from "fs";
import { execSync } from "child_process";
import collect3 from "collect.js";
import {
  indexCodebase,
  createVectorDB,
  ComplexityAnalyzer,
  RISK_ORDER
} from "@liendev/core";
import { Octokit } from "@octokit/rest";
import collect2 from "collect.js";
import collect from "collect.js";
function createOctokit(token) {
  return new Octokit({ auth: token });
}
async function getPRChangedFiles(octokit, prContext) {
  const files = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const response = await octokit.pulls.listFiles({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      per_page: perPage,
      page
    });
    for (const file of response.data) {
      if (file.status !== "removed") {
        files.push(file.filename);
      }
    }
    if (response.data.length < perPage) {
      break;
    }
    page++;
  }
  return files;
}
async function postPRComment(octokit, prContext, body, logger) {
  const existingComment = await findExistingComment(octokit, prContext);
  if (existingComment) {
    logger.info(`Updating existing comment ${existingComment.id}`);
    await octokit.issues.updateComment({
      owner: prContext.owner,
      repo: prContext.repo,
      comment_id: existingComment.id,
      body
    });
  } else {
    logger.info("Creating new comment");
    await octokit.issues.createComment({
      owner: prContext.owner,
      repo: prContext.repo,
      issue_number: prContext.pullNumber,
      body
    });
  }
}
async function findExistingComment(octokit, prContext) {
  const COMMENT_MARKER = "<!-- lien-ai-review -->";
  const comments = await octokit.issues.listComments({
    owner: prContext.owner,
    repo: prContext.repo,
    issue_number: prContext.pullNumber
  });
  for (const comment of comments.data) {
    if (comment.body?.includes(COMMENT_MARKER)) {
      return { id: comment.id };
    }
  }
  return null;
}
async function getFileContent(octokit, prContext, filepath, startLine, endLine, logger) {
  try {
    const response = await octokit.repos.getContent({
      owner: prContext.owner,
      repo: prContext.repo,
      path: filepath,
      ref: prContext.headSha
    });
    if ("content" in response.data) {
      const content = Buffer.from(response.data.content, "base64").toString(
        "utf-8"
      );
      const lines = content.split("\n");
      const snippet = lines.slice(startLine - 1, endLine).join("\n");
      return snippet;
    }
  } catch (error2) {
    logger.warning(`Failed to get content for ${filepath}: ${error2}`);
  }
  return null;
}
async function postPRReview(octokit, prContext, comments, summaryBody, logger) {
  if (comments.length === 0) {
    await postPRComment(octokit, prContext, summaryBody, logger);
    return;
  }
  logger.info(`Creating review with ${comments.length} line comments`);
  try {
    await octokit.pulls.createReview({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      commit_id: prContext.headSha,
      event: "COMMENT",
      // Don't approve or request changes, just comment
      body: summaryBody,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body
      }))
    });
    logger.info("Review posted successfully");
  } catch (error2) {
    logger.warning(`Failed to post line comments: ${error2}`);
    logger.info("Falling back to regular PR comment");
    await postPRComment(octokit, prContext, summaryBody, logger);
  }
}
var DESCRIPTION_START_MARKER = "<!-- lien-stats -->";
var DESCRIPTION_END_MARKER = "<!-- /lien-stats -->";
async function updatePRDescription(octokit, prContext, badgeMarkdown, logger) {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber
    });
    const currentBody = pr.body || "";
    const wrappedBadge = `${DESCRIPTION_START_MARKER}
${badgeMarkdown}
${DESCRIPTION_END_MARKER}`;
    let newBody;
    const startIdx = currentBody.indexOf(DESCRIPTION_START_MARKER);
    const endIdx = currentBody.indexOf(DESCRIPTION_END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      newBody = currentBody.slice(0, startIdx) + wrappedBadge + currentBody.slice(endIdx + DESCRIPTION_END_MARKER.length);
      logger.info("Updating existing stats badge in PR description");
    } else {
      newBody = currentBody.trim() + "\n\n---\n\n" + wrappedBadge;
      logger.info("Adding stats badge to PR description");
    }
    await octokit.pulls.update({
      owner: prContext.owner,
      repo: prContext.repo,
      pull_number: prContext.pullNumber,
      body: newBody
    });
    logger.info("PR description updated with complexity stats");
  } catch (error2) {
    logger.warning(`Failed to update PR description: ${error2}`);
  }
}
function parsePatchLines(patch) {
  const lines = /* @__PURE__ */ new Set();
  let currentLine = 0;
  for (const patchLine of patch.split("\n")) {
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (patchLine.startsWith("+") || patchLine.startsWith(" ")) {
      if (!patchLine.startsWith("+++")) {
        lines.add(currentLine);
        currentLine++;
      }
    }
  }
  return lines;
}
async function getPRDiffLines(octokit, prContext) {
  const diffLines = /* @__PURE__ */ new Map();
  const iterator = octokit.paginate.iterator(octokit.pulls.listFiles, {
    owner: prContext.owner,
    repo: prContext.repo,
    pull_number: prContext.pullNumber,
    per_page: 100
  });
  for await (const response of iterator) {
    for (const file of response.data) {
      if (!file.patch) continue;
      const lines = parsePatchLines(file.patch);
      if (lines.size > 0) {
        diffLines.set(file.filename, lines);
      }
    }
  }
  return diffLines;
}
function getFunctionKey(filepath, symbolName, metricType) {
  return `${filepath}::${symbolName}::${metricType}`;
}
function buildComplexityMap(report, files) {
  if (!report) return /* @__PURE__ */ new Map();
  const entries = collect(files).map((filepath) => ({ filepath, fileData: report.files[filepath] })).filter(({ fileData }) => !!fileData).flatMap(
    ({ filepath, fileData }) => fileData.violations.map((violation) => [
      getFunctionKey(filepath, violation.symbolName, violation.metricType),
      { complexity: violation.complexity, violation }
    ])
  ).all();
  return new Map(entries);
}
function determineSeverity(baseComplexity, headComplexity, delta, threshold) {
  if (baseComplexity === null) return "new";
  if (delta < 0) return "improved";
  return headComplexity >= threshold * 2 ? "error" : "warning";
}
function createDelta(violation, baseComplexity, headComplexity, severity) {
  const delta = baseComplexity !== null && headComplexity !== null ? headComplexity - baseComplexity : headComplexity ?? -(baseComplexity ?? 0);
  return {
    filepath: violation.filepath,
    symbolName: violation.symbolName,
    symbolType: violation.symbolType,
    startLine: violation.startLine,
    metricType: violation.metricType,
    baseComplexity,
    headComplexity,
    delta,
    threshold: violation.threshold,
    severity
  };
}
var SEVERITY_ORDER = {
  error: 0,
  warning: 1,
  new: 2,
  improved: 3,
  deleted: 4
};
function sortDeltas(deltas) {
  return deltas.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return b.delta - a.delta;
  });
}
function processHeadViolations(headMap, baseMap) {
  const seenBaseKeys = /* @__PURE__ */ new Set();
  const deltas = collect(Array.from(headMap.entries())).map(([key, headData]) => {
    const baseData = baseMap.get(key);
    if (baseData) seenBaseKeys.add(key);
    const baseComplexity = baseData?.complexity ?? null;
    const headComplexity = headData.complexity;
    const delta = baseComplexity !== null ? headComplexity - baseComplexity : headComplexity;
    const severity = determineSeverity(baseComplexity, headComplexity, delta, headData.violation.threshold);
    return createDelta(headData.violation, baseComplexity, headComplexity, severity);
  }).all();
  return { deltas, seenBaseKeys };
}
function calculateDeltas(baseReport, headReport, changedFiles) {
  const baseMap = buildComplexityMap(baseReport, changedFiles);
  const headMap = buildComplexityMap(headReport, changedFiles);
  const { deltas: headDeltas, seenBaseKeys } = processHeadViolations(headMap, baseMap);
  const deletedDeltas = collect(Array.from(baseMap.entries())).filter(([key]) => !seenBaseKeys.has(key)).map(([_, baseData]) => createDelta(baseData.violation, baseData.complexity, null, "deleted")).all();
  return sortDeltas([...headDeltas, ...deletedDeltas]);
}
function calculateDeltaSummary(deltas) {
  const collection = collect(deltas);
  const categorized = collection.map((d) => {
    if (d.severity === "improved") return "improved";
    if (d.severity === "new") return "new";
    if (d.severity === "deleted") return "deleted";
    if (d.delta > 0) return "degraded";
    if (d.delta === 0) return "unchanged";
    return "improved";
  });
  const counts = categorized.countBy().all();
  return {
    totalDelta: collection.sum("delta"),
    improved: counts["improved"] || 0,
    degraded: counts["degraded"] || 0,
    newFunctions: counts["new"] || 0,
    deletedFunctions: counts["deleted"] || 0,
    unchanged: counts["unchanged"] || 0
  };
}
function formatDelta(delta) {
  if (delta > 0) return `+${delta} \u2B06\uFE0F`;
  if (delta < 0) return `${delta} \u2B07\uFE0F`;
  return "\xB10";
}
function formatSeverityEmoji(severity) {
  switch (severity) {
    case "error":
      return "\u{1F534}";
    case "warning":
      return "\u{1F7E1}";
    case "improved":
      return "\u{1F7E2}";
    case "new":
      return "\u{1F195}";
    case "deleted":
      return "\u{1F5D1}\uFE0F";
  }
}
function logDeltaSummary(summary, logger) {
  const sign = summary.totalDelta >= 0 ? "+" : "";
  logger.info(`Complexity delta: ${sign}${summary.totalDelta}`);
  logger.info(`  Degraded: ${summary.degraded}, Improved: ${summary.improved}`);
  logger.info(`  New: ${summary.newFunctions}, Deleted: ${summary.deletedFunctions}`);
}
function formatTime(minutes) {
  const sign = minutes < 0 ? "-" : "";
  const roundedMinutes = Math.round(Math.abs(minutes));
  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;
    return mins > 0 ? `${sign}${hours}h ${mins}m` : `${sign}${hours}h`;
  }
  return `${sign}${roundedMinutes}m`;
}
function formatDeltaValue(metricType, delta) {
  if (metricType === "halstead_bugs") {
    return delta.toFixed(2);
  }
  if (metricType === "halstead_effort") {
    return formatTime(delta);
  }
  return String(Math.round(delta));
}
var COMMENT_EXAMPLES = {
  cyclomatic: `The 5 permission cases (lines 45-67) can be extracted to \`checkAdminAccess()\`, \`checkEditorAccess()\`, \`checkViewerAccess()\`. Each returns early if unauthorized, reducing test paths from ~15 to ~5.`,
  cognitive: `The 6 levels of nesting create significant mental load. Flatten with guard clauses: \`if (!user) return null;\` at line 23, then \`if (!hasPermission) throw new UnauthorizedError();\` at line 28. The remaining logic becomes linear.`,
  halstead_effort: `This function uses 23 unique operators across complex expressions. Extract the date math (lines 34-41) into \`calculateDaysUntilExpiry()\` and replace magic numbers (30, 86400) with named constants.`,
  halstead_bugs: `High predicted bug density from complex expressions. The chained ternaries on lines 56-62 should be a lookup object: \`const STATUS_MAP = { pending: 'yellow', approved: 'green', ... }\`. Reduces operator count and improves readability.`
};
var DEFAULT_EXAMPLE = COMMENT_EXAMPLES.cyclomatic;
function createDeltaKey(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    collect2(deltas).map((d) => [createDeltaKey(d), d]).all()
  );
}
function getMetricLabel(metricType) {
  switch (metricType) {
    case "cognitive":
      return "mental load";
    case "cyclomatic":
      return "test paths";
    case "halstead_effort":
      return "time to understand";
    case "halstead_bugs":
      return "estimated bugs";
    default:
      return "complexity";
  }
}
function formatComplexityValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return `~${formatTime(value)}`;
    case "halstead_bugs":
      return value.toFixed(2);
    case "cyclomatic":
      return `${value} tests`;
    default:
      return value.toString();
  }
}
function formatThresholdValue(metricType, value) {
  switch (metricType) {
    case "halstead_effort":
      return formatTime(value);
    case "halstead_bugs":
      return value.toFixed(1);
    default:
      return value.toString();
  }
}
function formatViolationLine(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const metricLabel = getMetricLabel(v.metricType);
  const valueDisplay = formatComplexityValue(v.metricType, v.complexity);
  const thresholdDisplay = formatThresholdValue(v.metricType, v.threshold);
  return `  - ${v.symbolName} (${v.symbolType}): ${metricLabel} ${valueDisplay}${deltaStr} (threshold: ${thresholdDisplay}) [${v.severity}]`;
}
function buildDependencyContext(fileData) {
  if (!fileData.dependentCount || fileData.dependentCount === 0) {
    return "";
  }
  const riskEmoji = {
    low: "\u{1F7E2}",
    medium: "\u{1F7E1}",
    high: "\u{1F7E0}",
    critical: "\u{1F534}"
  };
  const emoji = riskEmoji[fileData.riskLevel] || "\u26AA";
  const hasDependentsList = fileData.dependents && fileData.dependents.length > 0;
  const dependentsList = hasDependentsList ? fileData.dependents.slice(0, 10).map((f) => `  - ${f}`).join("\n") : "";
  const complexityNote = fileData.dependentComplexityMetrics ? `
- **Dependent complexity**: Avg ${fileData.dependentComplexityMetrics.averageComplexity.toFixed(1)}, Max ${fileData.dependentComplexityMetrics.maxComplexity}` : "";
  const moreNote = hasDependentsList && fileData.dependents.length > 10 ? "\n  ... (and more)" : "";
  return `
**Dependency Impact**: ${emoji} ${fileData.riskLevel.toUpperCase()} risk
- **Dependents**: ${fileData.dependentCount} file(s) import this
${dependentsList ? `
**Key dependents:**
${dependentsList}${moreNote}` : ""}${complexityNote}
- **Review focus**: Changes here affect ${fileData.dependentCount} other file(s). Extra scrutiny recommended.`;
}
var LANGUAGE_NAMES = {
  "typescript": "TypeScript",
  "javascript": "JavaScript",
  "php": "PHP",
  "python": "Python",
  "go": "Go",
  "rust": "Rust",
  "java": "Java",
  "ruby": "Ruby",
  "swift": "Swift",
  "kotlin": "Kotlin",
  "csharp": "C#",
  "scala": "Scala",
  "cpp": "C++",
  "c": "C"
};
var EXTENSION_LANGUAGES = {
  "ts": "TypeScript",
  "tsx": "TypeScript React",
  "js": "JavaScript",
  "jsx": "JavaScript React",
  "mjs": "JavaScript",
  "cjs": "JavaScript",
  "php": "PHP",
  "py": "Python",
  "go": "Go",
  "rs": "Rust",
  "java": "Java",
  "rb": "Ruby",
  "swift": "Swift",
  "kt": "Kotlin",
  "cs": "C#",
  "scala": "Scala",
  "cpp": "C++",
  "cc": "C++",
  "cxx": "C++",
  "c": "C"
};
var FILE_TYPE_PATTERNS = [
  { pattern: "controller", type: "Controller" },
  { pattern: "service", type: "Service" },
  { pattern: "component", type: "Component" },
  { pattern: "middleware", type: "Middleware" },
  { pattern: "handler", type: "Handler" },
  { pattern: "util", type: "Utility" },
  { pattern: "helper", type: "Utility" },
  { pattern: "_test.", type: "Test" },
  { pattern: "/model/", type: "Model" },
  { pattern: "/models/", type: "Model" },
  { pattern: "/repository/", type: "Repository" },
  { pattern: "/repositories/", type: "Repository" }
];
function detectLanguage(filepath, violations) {
  const languageFromViolation = violations[0]?.language;
  if (languageFromViolation) {
    return LANGUAGE_NAMES[languageFromViolation.toLowerCase()] || languageFromViolation;
  }
  const ext = filepath.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGES[ext] || null : null;
}
function detectFileType(filepath) {
  const pathLower = filepath.toLowerCase();
  const match = FILE_TYPE_PATTERNS.find((p) => pathLower.includes(p.pattern));
  return match?.type || null;
}
function buildFileContext(filepath, fileData) {
  const parts = [];
  const language = detectLanguage(filepath, fileData.violations);
  if (language) parts.push(`Language: ${language}`);
  const fileType = detectFileType(filepath);
  if (fileType) parts.push(`Type: ${fileType}`);
  if (fileData.violations.length > 1) {
    parts.push(`${fileData.violations.length} total violations in this file`);
  }
  return parts.length > 0 ? `
*Context: ${parts.join(", ")}*` : "";
}
function isNewOrWorsened(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey(v));
  return !!delta && (delta.severity === "new" || delta.delta > 0);
}
function groupViolationsByFile(violations) {
  const byFile = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const existing = byFile.get(v.filepath) || [];
    existing.push(v);
    byFile.set(v.filepath, existing);
  }
  return byFile;
}
function formatFileGroup(violations, files, deltaMap) {
  return Array.from(groupViolationsByFile(violations).entries()).map(([filepath, vs]) => {
    const fileData = files[filepath];
    const violationList = vs.map((v) => formatViolationLine(v, deltaMap)).join("\n");
    const dependencyContext = fileData ? buildDependencyContext(fileData) : "";
    const fileContext = fileData ? buildFileContext(filepath, fileData) : "";
    return `**${filepath}** (risk: ${fileData?.riskLevel || "unknown"})${fileContext}
${violationList}${dependencyContext}`;
  }).join("\n\n");
}
function buildViolationsSummary(files, deltaMap) {
  if (deltaMap.size === 0) {
    const allViolations2 = Object.values(files).flatMap((data) => data.violations);
    return formatFileGroup(allViolations2, files, deltaMap);
  }
  const allViolations = Object.values(files).filter((data) => data.violations.length > 0).flatMap((data) => data.violations);
  const newViolations = allViolations.filter((v) => isNewOrWorsened(v, deltaMap));
  const preExisting = allViolations.filter((v) => !isNewOrWorsened(v, deltaMap));
  const sections = [];
  if (newViolations.length > 0) {
    sections.push(`### New/Worsened Violations (introduced or worsened in this PR)

${formatFileGroup(newViolations, files, deltaMap)}`);
  }
  if (preExisting.length > 0) {
    sections.push(`### Pre-existing Violations (in files touched by this PR)

${formatFileGroup(preExisting, files, deltaMap)}`);
  }
  return sections.join("\n\n");
}
function formatDeltaChange(d) {
  const from = d.baseComplexity ?? "new";
  const to = d.headComplexity ?? "removed";
  return `  - ${d.symbolName}: ${from} \u2192 ${to} (${formatDelta(d.delta)})`;
}
function buildDeltaContext(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const improved = deltas.filter((d) => d.severity === "improved");
  const degraded = deltas.filter((d) => (d.severity === "error" || d.severity === "warning") && d.delta > 0);
  const newFuncs = deltas.filter((d) => d.severity === "new");
  const deleted = deltas.filter((d) => d.severity === "deleted");
  const sections = [
    `
## Complexity Changes (vs base branch)`,
    `- **Degraded**: ${degraded.length} function(s) got more complex`,
    `- **Improved**: ${improved.length} function(s) got simpler`,
    `- **New**: ${newFuncs.length} new complex function(s)`,
    `- **Removed**: ${deleted.length} complex function(s) deleted`
  ];
  if (degraded.length > 0) {
    sections.push(`
Functions that got worse:
${degraded.map(formatDeltaChange).join("\n")}`);
  }
  if (improved.length > 0) {
    sections.push(`
Functions that improved:
${improved.map(formatDeltaChange).join("\n")}`);
  }
  if (newFuncs.length > 0) {
    sections.push(`
New complex functions:
${newFuncs.map((d) => `  - ${d.symbolName}: complexity ${d.headComplexity}`).join("\n")}`);
  }
  return sections.join("\n");
}
function buildSnippetsSection(codeSnippets) {
  return Array.from(codeSnippets.entries()).map(([key, code]) => {
    const [filepath, symbolName] = key.split("::");
    return `### ${filepath} - ${symbolName}
\`\`\`
${code}
\`\`\``;
  }).join("\n\n");
}
function buildReviewPrompt(report, prContext, codeSnippets, deltas = null) {
  const { summary, files } = report;
  const deltaMap = buildDeltaMap(deltas);
  const violationsByFile = Object.entries(files).filter(([_, data]) => data.violations.length > 0);
  const violationsSummary = buildViolationsSummary(files, deltaMap);
  const snippetsSection = buildSnippetsSection(codeSnippets);
  const deltaContext = buildDeltaContext(deltas);
  return `# Code Complexity Review Request

## Context
- **Repository**: ${prContext.owner}/${prContext.repo}
- **PR**: #${prContext.pullNumber} - ${prContext.title}
- **Files with violations**: ${violationsByFile.length}
- **Total violations**: ${summary.totalViolations} (${summary.bySeverity.error} errors, ${summary.bySeverity.warning} warnings)
${deltaContext}
## Complexity Violations Found

${violationsSummary}

## Code Snippets

${snippetsSection || "_No code snippets available_"}

## Your Task

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets below to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?
- How is code organized (modules, files, exports)?

For each violation:
1. **Explain** why this complexity is problematic in this specific context
   - Consider the file type (controller, service, component, etc.) and language
   - Note if this is the only violation in the file or one of many
   - Consider dependency impact - high-risk files need extra scrutiny
2. **Suggest** concrete refactoring steps (not generic advice like "break into smaller functions")
   - Be specific to the language and framework patterns
   - Consider file type conventions (e.g., controllers often delegate to services)
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes
3. **Prioritize** which violations are most important to address - focus on functions that got WORSE (higher delta)
4. If the complexity seems justified for the use case, say so
   - Some patterns (orchestration, state machines) may legitimately be complex
5. Celebrate improvements! If a function got simpler, acknowledge it.

Format your response as a PR review comment with:
- A brief summary at the top (2-3 sentences)
- File-by-file breakdown with specific suggestions
- Prioritized list of recommended changes

Be concise but actionable. Focus on the highest-impact improvements.`;
}
function buildNoViolationsMessage(prContext, deltas = null) {
  let deltaMessage = "";
  if (deltas && deltas.length > 0) {
    const improved = deltas.filter((d) => d.severity === "improved" || d.severity === "deleted");
    if (improved.length > 0) {
      deltaMessage = `

\u{1F389} **Great job!** This PR improved complexity in ${improved.length} function(s).`;
    }
  }
  return `<!-- lien-ai-review -->
## \u2705 Lien Complexity Analysis

No complexity violations found in PR #${prContext.pullNumber}.

All analyzed functions are within the configured complexity threshold.${deltaMessage}`;
}
function groupDeltasByMetric(deltas) {
  return collect2(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdownForDisplay(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  const emojiMap = {
    cyclomatic: "\u{1F500}",
    cognitive: "\u{1F9E0}",
    halstead_effort: "\u23F1\uFE0F",
    halstead_bugs: "\u{1F41B}"
  };
  return collect2(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = emojiMap[metricType] || "\u{1F4CA}";
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function categorizeDeltas(deltas) {
  return deltas.reduce((acc, d) => {
    if (["improved", "deleted"].includes(d.severity)) acc.improved++;
    else if (["warning", "error", "new"].includes(d.severity)) acc.degraded++;
    return acc;
  }, { improved: 0, degraded: 0 });
}
function getTrendEmoji(totalDelta) {
  if (totalDelta > 0) return "\u2B06\uFE0F";
  if (totalDelta < 0) return "\u2B07\uFE0F";
  return "\u27A1\uFE0F";
}
function formatDeltaDisplay(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const { improved, degraded } = categorizeDeltas(deltas);
  const deltaByMetric = groupDeltasByMetric(deltas);
  const totalDelta = Object.values(deltaByMetric).reduce((sum, v) => sum + v, 0);
  if (totalDelta === 0 && improved === 0) {
    return "\n\n**Complexity:** No change from this PR.";
  }
  const metricBreakdown = buildMetricBreakdownForDisplay(deltaByMetric);
  const trend = getTrendEmoji(totalDelta);
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (improved > 0) display += ` | ${improved} improved`;
  if (degraded > 0) display += ` | ${degraded} degraded`;
  return display;
}
function formatTokenStats(tokenUsage) {
  if (!tokenUsage || tokenUsage.totalTokens <= 0) return "";
  return `
- Tokens: ${tokenUsage.totalTokens.toLocaleString()} ($${tokenUsage.cost.toFixed(4)})`;
}
function formatFallbackNote(isFallback) {
  if (!isFallback) return "";
  return `

> \u{1F4A1} *These violations exist in files touched by this PR but not on changed lines. Consider the [boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html): leave the code cleaner than you found it!*
`;
}
function countViolationsByNovelty(totalViolations, deltas) {
  if (!deltas || deltas.length === 0) {
    return { newCount: 0, preExistingCount: 0, improvedCount: 0 };
  }
  const newCount = deltas.filter(
    (d) => d.severity === "new" || d.severity === "warning" || d.severity === "error"
  ).filter((d) => d.severity === "new" || d.delta > 0).length;
  const improvedCount = deltas.filter((d) => d.severity === "improved").length;
  const preExistingCount = Math.max(0, totalViolations - newCount);
  return { newCount, preExistingCount, improvedCount };
}
function buildHeaderLine(totalViolations, deltas) {
  const { newCount, preExistingCount, improvedCount } = countViolationsByNovelty(totalViolations, deltas);
  if (!deltas || deltas.length === 0) {
    return `${totalViolations} issue${totalViolations === 1 ? "" : "s"} spotted in this PR.`;
  }
  const parts = [];
  if (newCount > 0) {
    parts.push(`${newCount} new issue${newCount === 1 ? "" : "s"} spotted in this PR.`);
  } else {
    parts.push("No new complexity introduced.");
  }
  if (improvedCount > 0) {
    parts.push(`${improvedCount} function${improvedCount === 1 ? "" : "s"} improved.`);
  }
  if (preExistingCount > 0) {
    parts.push(`${preExistingCount} pre-existing issue${preExistingCount === 1 ? "" : "s"} in touched files.`);
  }
  return parts.join(" ");
}
function formatReviewComment(aiReview, report, isFallback = false, tokenUsage, deltas, uncoveredNote = "") {
  const { summary } = report;
  const deltaDisplay = formatDeltaDisplay(deltas);
  const fallbackNote = formatFallbackNote(isFallback);
  const tokenStats = formatTokenStats(tokenUsage);
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${headerLine}${deltaDisplay}${fallbackNote}

---

${aiReview}

---${uncoveredNote}

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${tokenStats}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
function getViolationKey(violation) {
  return `${violation.filepath}::${violation.symbolName}`;
}
function determineStatus(report, deltaSummary) {
  const violations = report?.summary.totalViolations ?? 0;
  const errors = report?.summary.bySeverity.error ?? 0;
  const delta = deltaSummary?.totalDelta ?? 0;
  const newViolations = deltaSummary?.newFunctions ?? 0;
  const preExisting = Math.max(0, violations - newViolations);
  if (delta < 0) {
    if (preExisting > 0) {
      return {
        emoji: "\u2705",
        message: `**Improved!** Complexity reduced by ${Math.abs(delta)}. ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} remain${preExisting === 1 ? "s" : ""} in touched files.`
      };
    }
    return { emoji: "\u2705", message: `**Improved!** This PR reduces complexity by ${Math.abs(delta)}.` };
  }
  if (newViolations > 0 && errors > 0) {
    return {
      emoji: "\u{1F534}",
      message: `**Review required** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} too complex.`
    };
  }
  if (newViolations > 0) {
    return {
      emoji: "\u26A0\uFE0F",
      message: `**Needs attention** - ${newViolations} new function${newViolations === 1 ? " is" : "s are"} more complex than recommended.`
    };
  }
  if (violations > 0) {
    return {
      emoji: "\u27A1\uFE0F",
      message: `**Stable** - ${preExisting} pre-existing issue${preExisting === 1 ? "" : "s"} in touched files (none introduced).`
    };
  }
  if (delta > 0) {
    return { emoji: "\u27A1\uFE0F", message: "**Stable** - Complexity increased slightly but within limits." };
  }
  return { emoji: "\u2705", message: "**Good** - No complexity issues found." };
}
function getMetricEmoji(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function buildMetricTable(report, deltas) {
  if (!report || report.summary.totalViolations === 0) return "";
  const byMetric = collect2(Object.values(report.files)).flatMap((f) => f.violations).countBy("metricType").all();
  const deltaByMetric = deltas ? collect2(deltas).groupBy("metricType").map((group) => group.sum("delta")).all() : {};
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  const rows = collect2(metricOrder).filter((metricType) => byMetric[metricType] > 0).map((metricType) => {
    const emoji = getMetricEmoji(metricType);
    const label = getMetricLabel(metricType);
    const count = byMetric[metricType];
    const delta = deltaByMetric[metricType] || 0;
    const deltaStr = deltas ? delta >= 0 ? `+${delta}` : `${delta}` : "\u2014";
    return `| ${emoji} ${label} | ${count} | ${deltaStr} |`;
  }).all();
  if (rows.length === 0) return "";
  return `
| Metric | Violations | Change |
|--------|:----------:|:------:|
${rows.join("\n")}
`;
}
function buildImpactSummary(report) {
  if (!report) return "";
  const filesWithDependents = Object.values(report.files).filter((f) => f.dependentCount && f.dependentCount > 0);
  if (filesWithDependents.length === 0) return "";
  const totalDependents = filesWithDependents.reduce((sum, f) => sum + (f.dependentCount || 0), 0);
  const highRiskFiles = filesWithDependents.filter(
    (f) => ["high", "critical"].includes(f.riskLevel)
  ).length;
  if (highRiskFiles === 0) return "";
  return `
\u{1F517} **Impact**: ${highRiskFiles} high-risk file(s) with ${totalDependents} total dependents`;
}
function buildDescriptionBadge(report, deltaSummary, deltas) {
  const status = determineStatus(report, deltaSummary);
  const metricTable = buildMetricTable(report, deltas);
  const impactSummary = buildImpactSummary(report);
  return `### \u{1F441}\uFE0F Veille

${status.emoji} ${status.message}${impactSummary}
${metricTable}
*[Veille](https://lien.dev) by Lien*`;
}
function formatHalsteadContext(violation) {
  if (!violation.metricType?.startsWith("halstead_")) return "";
  if (!violation.halsteadDetails) return "";
  const details = violation.halsteadDetails;
  return `
**Halstead Metrics**: Volume: ${details.volume?.toLocaleString()}, Difficulty: ${details.difficulty?.toFixed(1)}, Effort: ${details.effort?.toLocaleString()}, Est. bugs: ${details.bugs?.toFixed(3)}`;
}
function getExampleForPrimaryMetric(violations) {
  if (violations.length === 0) return DEFAULT_EXAMPLE;
  const counts = collect2(violations).countBy((v) => v.metricType || "cyclomatic").all();
  const maxType = Object.entries(counts).reduce(
    (max, [type, count]) => count > max.count ? { type, count } : max,
    { type: "cyclomatic", count: 0 }
  ).type;
  return COMMENT_EXAMPLES[maxType] || DEFAULT_EXAMPLE;
}
function buildBatchedCommentsPrompt(violations, codeSnippets, report) {
  const violationsText = violations.map((v, i) => {
    const key = `${v.filepath}::${v.symbolName}`;
    const snippet = codeSnippets.get(key);
    const snippetSection = snippet ? `
Code:
\`\`\`
${snippet}
\`\`\`` : "";
    const metricType = v.metricType || "cyclomatic";
    const metricLabel = getMetricLabel(metricType);
    const valueDisplay = formatComplexityValue(metricType, v.complexity);
    const thresholdDisplay = formatThresholdValue(metricType, v.threshold);
    const halsteadContext = formatHalsteadContext(v);
    const fileData = report.files[v.filepath];
    const dependencyContext = fileData ? buildDependencyContext(fileData) : "";
    const fileContext = fileData ? buildFileContext(v.filepath, fileData) : "";
    return `### ${i + 1}. ${v.filepath}::${v.symbolName}
- **Function**: \`${v.symbolName}\` (${v.symbolType})
- **Complexity**: ${valueDisplay} ${metricLabel} (threshold: ${thresholdDisplay})${halsteadContext}
- **Severity**: ${v.severity}${fileContext}${dependencyContext}${snippetSection}`;
  }).join("\n\n");
  const jsonKeys = violations.map((v) => `  "${v.filepath}::${v.symbolName}": "your comment here"`).join(",\n");
  return `You are a senior engineer reviewing code for complexity. Generate thoughtful, context-aware review comments.

## Violations to Review

${violationsText}

## Instructions

**IMPORTANT**: Before suggesting refactorings, analyze the code snippets provided to identify the codebase's patterns:
- Are utilities implemented as functions or classes?
- How are similar refactorings done elsewhere in the codebase?
- What naming conventions are used?

For each violation, write a code review comment that:

1. **Identifies the specific pattern** causing complexity (not just "too complex")
   - Is it nested conditionals? Long parameter lists? Multiple responsibilities?
   - For Halstead metrics: many unique operators/operands, complex expressions
   - Be specific: "5 levels of nesting" not "deeply nested"

2. **Suggests a concrete fix** with a short code example (3-5 lines)
   - Consider: early returns, guard clauses, lookup tables, extracting helpers, strategy pattern
   - For Halstead: named constants, reducing operator variety, extracting complex expressions
   - Name specific functions: "Extract \`handleAdminCase()\`" not "extract a function"
   - Choose the SIMPLEST fix that addresses the issue (KISS principle)
   - **Match the existing codebase patterns** - if utilities are functions, suggest functions; if they're classes, suggest classes

3. **Acknowledges context** when relevant
   - If this is an orchestration function, complexity may be acceptable
   - If the logic is inherently complex (state machines, parsers), say so
   - Don't suggest over-engineering for marginal gains

Be direct and specific to THIS code. Avoid generic advice like "break into smaller functions."

**Example of a good comment:**
"${getExampleForPrimaryMetric(violations)}"

Write comments of similar quality and specificity for each violation below.

IMPORTANT: Do NOT include headers like "Complexity: X" or emojis - we add those.

## Response Format

Respond with ONLY valid JSON. Each key is "filepath::symbolName", value is the comment text.
Use \\n for newlines within comments.

\`\`\`json
{
${jsonKeys}
}
\`\`\``;
}
var OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
var totalUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0
};
function resetTokenUsage() {
  totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0
  };
}
function getTokenUsage() {
  return { ...totalUsage };
}
function trackUsage(usage) {
  if (!usage) return;
  totalUsage.promptTokens += usage.prompt_tokens;
  totalUsage.completionTokens += usage.completion_tokens;
  totalUsage.totalTokens += usage.total_tokens;
  totalUsage.cost += usage.cost || 0;
}
function parseCommentsResponse(content, logger) {
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();
  logger.info(`Parsing JSON response (${jsonStr.length} chars)`);
  try {
    const parsed = JSON.parse(jsonStr);
    logger.info(`Successfully parsed ${Object.keys(parsed).length} comments`);
    return parsed;
  } catch (parseError) {
    logger.warning(`Initial JSON parse failed: ${parseError}`);
  }
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      logger.info(`Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} comments`);
      return parsed;
    } catch (retryError) {
      logger.warning(`Retry parsing also failed: ${retryError}`);
    }
  }
  logger.warning(`Full response content:
${content}`);
  return null;
}
async function generateReview(prompt, apiKey, model, logger) {
  logger.info(`Calling OpenRouter with model: ${model}`);
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getlien/lien",
      "X-Title": "Veille by Lien"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code reviewer. Provide actionable, specific feedback on code complexity issues. Be concise but thorough. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 2e3,
      temperature: 0.3,
      // Lower temperature for more consistent reviews
      // Enable usage accounting to get cost data
      // https://openrouter.ai/docs/guides/guides/usage-accounting
      usage: {
        include: true
      }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorText}`
    );
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  const review = data.choices[0].message.content;
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(
      `Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }
  return review;
}
async function callBatchedCommentsAPI(prompt, apiKey, model) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getlien/lien",
      "X-Title": "Veille by Lien"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.3,
      usage: { include: true }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("No response from OpenRouter");
  }
  return data;
}
function mapCommentsToViolations(commentsMap, violations, logger) {
  const results = /* @__PURE__ */ new Map();
  const fallbackMessage = (v) => `This ${v.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`;
  if (!commentsMap) {
    for (const violation of violations) {
      results.set(violation, fallbackMessage(violation));
    }
    return results;
  }
  for (const violation of violations) {
    const key = `${violation.filepath}::${violation.symbolName}`;
    const comment = commentsMap[key];
    if (comment) {
      results.set(violation, comment.replace(/\\n/g, "\n"));
    } else {
      logger.warning(`No comment generated for ${key}`);
      results.set(violation, fallbackMessage(violation));
    }
  }
  return results;
}
async function generateLineComments(violations, codeSnippets, apiKey, model, report, logger) {
  if (violations.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  logger.info(`Generating comments for ${violations.length} violations in single batch`);
  const prompt = buildBatchedCommentsPrompt(violations, codeSnippets, report);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : "";
    logger.info(`Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`);
  }
  const commentsMap = parseCommentsResponse(data.choices[0].message.content, logger);
  return mapCommentsToViolations(commentsMap, violations, logger);
}
function filterAnalyzableFiles(files) {
  const codeExtensions = /* @__PURE__ */ new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".php"
  ]);
  const excludePatterns = [
    /node_modules\//,
    /vendor\//,
    /dist\//,
    /build\//,
    /\.min\./,
    /\.bundle\./,
    /\.generated\./,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/
  ];
  return files.filter((file) => {
    const ext = file.slice(file.lastIndexOf("."));
    if (!codeExtensions.has(ext)) {
      return false;
    }
    for (const pattern of excludePatterns) {
      if (pattern.test(file)) {
        return false;
      }
    }
    return true;
  });
}
async function getFilesToAnalyze(octokit, prContext, logger) {
  const allChangedFiles = await getPRChangedFiles(octokit, prContext);
  logger.info(`Found ${allChangedFiles.length} changed files in PR`);
  const filesToAnalyze = filterAnalyzableFiles(allChangedFiles);
  logger.info(`${filesToAnalyze.length} files eligible for complexity analysis`);
  return filesToAnalyze;
}
async function runComplexityAnalysis(files, threshold, rootDir, logger) {
  if (files.length === 0) {
    logger.info("No files to analyze");
    return null;
  }
  try {
    logger.info("Indexing codebase...");
    await indexCodebase({
      rootDir
    });
    logger.info("Indexing complete");
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();
    logger.info("Analyzing complexity...");
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files);
    logger.info(`Found ${report.summary.totalViolations} violations`);
    return report;
  } catch (error2) {
    logger.error(`Failed to run complexity analysis: ${error2}`);
    return null;
  }
}
function prioritizeViolations(violations, report) {
  return violations.sort((a, b) => {
    const fileA = report.files[a.filepath];
    const fileB = report.files[b.filepath];
    const impactA = (fileA?.dependentCount || 0) * 10 + RISK_ORDER[fileA?.riskLevel || "low"];
    const impactB = (fileB?.dependentCount || 0) * 10 + RISK_ORDER[fileB?.riskLevel || "low"];
    if (impactB !== impactA) return impactB - impactA;
    const severityOrder = { error: 2, warning: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}
async function prepareViolationsForReview(report, octokit, prContext, logger) {
  const allViolations = Object.values(report.files).flatMap((fileData) => fileData.violations);
  const violations = prioritizeViolations(allViolations, report).slice(0, 10);
  const codeSnippets = /* @__PURE__ */ new Map();
  for (const violation of violations) {
    const snippet = await getFileContent(
      octokit,
      prContext,
      violation.filepath,
      violation.startLine,
      violation.endLine,
      logger
    );
    if (snippet) {
      codeSnippets.set(getViolationKey(violation), snippet);
    }
  }
  logger.info(`Collected ${codeSnippets.size} code snippets for review`);
  return { violations, codeSnippets };
}
function loadBaselineComplexity(path, logger) {
  if (!path) {
    logger.info("No baseline complexity path provided, skipping delta calculation");
    return null;
  }
  try {
    if (!fs.existsSync(path)) {
      logger.warning(`Baseline complexity file not found: ${path}`);
      return null;
    }
    const content = fs.readFileSync(path, "utf-8");
    const report = JSON.parse(content);
    if (!report.files || !report.summary) {
      logger.warning("Baseline complexity file has invalid format");
      return null;
    }
    logger.info(`Loaded baseline complexity: ${report.summary.totalViolations} violations`);
    return report;
  } catch (error2) {
    logger.warning(`Failed to load baseline complexity: ${error2}`);
    return null;
  }
}
async function analyzeBaseBranch(baseSha, filesToAnalyze, threshold, rootDir, logger) {
  try {
    logger.info(`Checking out base branch at ${baseSha.substring(0, 7)}...`);
    const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    execSync(`git checkout --force ${baseSha}`, { stdio: "pipe" });
    logger.info("Base branch checked out");
    logger.info("Analyzing base branch complexity...");
    const baseReport = await runComplexityAnalysis(filesToAnalyze, threshold, rootDir, logger);
    execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    logger.info("Restored to HEAD");
    if (baseReport) {
      logger.info(`Base branch: ${baseReport.summary.totalViolations} violations`);
    }
    return baseReport;
  } catch (error2) {
    logger.warning(`Failed to analyze base branch: ${error2}`);
    try {
      const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      execSync(`git checkout --force ${currentHead}`, { stdio: "pipe" });
    } catch (restoreError) {
      logger.warning(`Failed to restore HEAD: ${restoreError}`);
    }
    return null;
  }
}
async function getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger) {
  if (config.enableDeltaTracking) {
    logger.info("Delta tracking enabled - analyzing base branch...");
    return await analyzeBaseBranch(prContext.baseSha, filesToAnalyze, config.threshold, rootDir, logger);
  }
  if (config.baselineComplexityPath) {
    logger.warning("baseline_complexity input is deprecated. Use enable_delta_tracking: true instead.");
    return loadBaselineComplexity(config.baselineComplexityPath, logger);
  }
  return null;
}
async function orchestrateAnalysis(setup) {
  const { config, prContext, octokit, logger, rootDir } = setup;
  const filesToAnalyze = await getFilesToAnalyze(octokit, prContext, logger);
  if (filesToAnalyze.length === 0) {
    logger.info("No analyzable files found, skipping review");
    return null;
  }
  const baselineReport = await getBaselineReport(config, prContext, filesToAnalyze, rootDir, logger);
  const currentReport = await runComplexityAnalysis(filesToAnalyze, config.threshold, rootDir, logger);
  if (!currentReport) {
    logger.warning("Failed to get complexity report");
    return null;
  }
  logger.info(`Analysis complete: ${currentReport.summary.totalViolations} violations found`);
  const deltas = baselineReport ? calculateDeltas(baselineReport, currentReport, filesToAnalyze) : null;
  return {
    currentReport,
    baselineReport,
    deltas,
    filesToAnalyze
  };
}
async function handleAnalysisOutputs(result, setup) {
  const { octokit, prContext, logger } = setup;
  const deltaSummary = result.deltas ? calculateDeltaSummary(result.deltas) : null;
  if (deltaSummary) {
    logDeltaSummary(deltaSummary, logger);
  }
  const badge = buildDescriptionBadge(result.currentReport, deltaSummary, result.deltas);
  await updatePRDescription(octokit, prContext, badge, logger);
  return deltaSummary;
}
function findCommentLine(violation, diffLines) {
  const fileLines = diffLines.get(violation.filepath);
  if (!fileLines) return null;
  if (fileLines.has(violation.startLine)) {
    return violation.startLine;
  }
  for (let line = violation.startLine; line <= violation.endLine; line++) {
    if (fileLines.has(line)) {
      return line;
    }
  }
  return null;
}
function createDeltaKey2(v) {
  return `${v.filepath}::${v.symbolName}::${v.metricType}`;
}
function buildDeltaMap2(deltas) {
  if (!deltas) return /* @__PURE__ */ new Map();
  return new Map(
    collect3(deltas).map((d) => [createDeltaKey2(d), d]).all()
  );
}
function getMetricEmoji2(metricType) {
  switch (metricType) {
    case "cyclomatic":
      return "\u{1F500}";
    case "cognitive":
      return "\u{1F9E0}";
    case "halstead_effort":
      return "\u23F1\uFE0F";
    case "halstead_bugs":
      return "\u{1F41B}";
    default:
      return "\u{1F4CA}";
  }
}
function formatUncoveredLine(v, deltaMap) {
  const delta = deltaMap.get(createDeltaKey2(v));
  const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
  const emoji = getMetricEmoji2(v.metricType);
  const metricLabel = getMetricLabel(v.metricType || "cyclomatic");
  const valueDisplay = formatComplexityValue(v.metricType || "cyclomatic", v.complexity);
  return `* \`${v.symbolName}\` in \`${v.filepath}\`: ${emoji} ${metricLabel} ${valueDisplay}${deltaStr}`;
}
var BOY_SCOUT_LINK = "[boy scout rule](https://www.oreilly.com/library/view/97-things-every/9780596809515/ch08.html)";
function categorizeUncoveredViolations(violations, deltaMap) {
  const newOrWorsened = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey2(v));
    return delta && (delta.severity === "new" || delta.delta > 0);
  });
  const preExisting = violations.filter((v) => {
    const delta = deltaMap.get(createDeltaKey2(v));
    return !delta || delta.delta === 0;
  });
  return { newOrWorsened, preExisting };
}
function buildNewWorsenedSection(violations, deltaMap) {
  if (violations.length === 0) return "";
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

\u26A0\uFE0F **${violations.length} new/worsened violation${violations.length === 1 ? "" : "s"} outside diff:**

${list}`;
}
function buildPreExistingSection(violations, deltaMap) {
  if (violations.length === 0) return "";
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

<details>
<summary>\u2139\uFE0F ${violations.length} pre-existing violation${violations.length === 1 ? "" : "s"} outside diff</summary>

${list}

> *These violations existed before this PR. No action required, but consider the ${BOY_SCOUT_LINK}!*

</details>`;
}
function buildFallbackUncoveredSection(violations, deltaMap) {
  const list = violations.map((v) => formatUncoveredLine(v, deltaMap)).join("\n");
  return `

<details>
<summary>\u26A0\uFE0F ${violations.length} violation${violations.length === 1 ? "" : "s"} outside diff (no inline comment)</summary>

${list}

> \u{1F4A1} *These exist in files touched by this PR but the function declarations aren't in the diff. Consider the ${BOY_SCOUT_LINK}!*

</details>`;
}
function buildUncoveredNote(uncoveredViolations, deltaMap) {
  if (uncoveredViolations.length === 0) return "";
  const { newOrWorsened, preExisting } = categorizeUncoveredViolations(uncoveredViolations, deltaMap);
  if (newOrWorsened.length === 0 && preExisting.length === 0) {
    return buildFallbackUncoveredSection(uncoveredViolations, deltaMap);
  }
  return buildNewWorsenedSection(newOrWorsened, deltaMap) + buildPreExistingSection(preExisting, deltaMap);
}
function buildSkippedNote(skippedViolations) {
  if (skippedViolations.length === 0) return "";
  const skippedList = skippedViolations.map((v) => `  - \`${v.symbolName}\` in \`${v.filepath}\`: complexity ${v.complexity}`).join("\n");
  return `

<details>
<summary>\u2139\uFE0F ${skippedViolations.length} pre-existing violation${skippedViolations.length === 1 ? "" : "s"} (unchanged)</summary>

${skippedList}

> *These violations existed before this PR and haven't changed. No inline comments added to reduce noise.*

</details>`;
}
function formatCostDisplay(usage) {
  return usage.totalTokens > 0 ? `
- Tokens: ${usage.totalTokens.toLocaleString()} ($${usage.cost.toFixed(4)})` : "";
}
function groupDeltasByMetric2(deltas) {
  return collect3(deltas).groupBy("metricType").map((group) => group.sum("delta")).all();
}
function buildMetricBreakdown(deltaByMetric) {
  const metricOrder = ["cyclomatic", "cognitive", "halstead_effort", "halstead_bugs"];
  return collect3(metricOrder).map((metricType) => {
    const metricDelta = deltaByMetric[metricType] || 0;
    const emoji = getMetricEmoji2(metricType);
    const sign = metricDelta >= 0 ? "+" : "";
    return `${emoji} ${sign}${formatDeltaValue(metricType, metricDelta)}`;
  }).all().join(" | ");
}
function formatDeltaDisplay2(deltas) {
  if (!deltas || deltas.length === 0) return "";
  const deltaSummary = calculateDeltaSummary(deltas);
  const deltaByMetric = groupDeltasByMetric2(deltas);
  if (deltaSummary.totalDelta === 0 && deltaSummary.improved === 0 && deltaSummary.newFunctions === 0) {
    return "\n\n**Complexity:** No change from this PR.";
  }
  const metricBreakdown = buildMetricBreakdown(deltaByMetric);
  const trend = deltaSummary.totalDelta > 0 ? "\u2B06\uFE0F" : deltaSummary.totalDelta < 0 ? "\u2B07\uFE0F" : "\u27A1\uFE0F";
  let display = `

**Complexity Change:** ${metricBreakdown} ${trend}`;
  if (deltaSummary.improved > 0) display += ` (${deltaSummary.improved} improved)`;
  if (deltaSummary.degraded > 0) display += ` (${deltaSummary.degraded} degraded)`;
  return display;
}
function buildReviewSummary(report, deltas, uncoveredNote) {
  const { summary } = report;
  const costDisplay = formatCostDisplay(getTokenUsage());
  const deltaDisplay = formatDeltaDisplay2(deltas);
  const headerLine = buildHeaderLine(summary.totalViolations, deltas);
  return `<!-- lien-ai-review -->
## \u{1F441}\uFE0F Veille

${headerLine}${deltaDisplay}

See inline comments on the diff for specific suggestions.${uncoveredNote}

<details>
<summary>\u{1F4CA} Analysis Details</summary>

- Files analyzed: ${summary.filesAnalyzed}
- Average complexity: ${summary.avgComplexity.toFixed(1)}
- Max complexity: ${summary.maxComplexity}${costDisplay}

</details>

*[Veille](https://lien.dev) by Lien*`;
}
function buildLineComments(violationsWithLines, aiComments, deltaMap, logger) {
  return collect3(violationsWithLines).filter(({ violation }) => aiComments.has(violation)).map(({ violation, commentLine }) => {
    const comment = aiComments.get(violation);
    const delta = deltaMap.get(createDeltaKey2(violation));
    const deltaStr = delta ? ` (${formatDelta(delta.delta)})` : "";
    const severityEmoji = delta ? formatSeverityEmoji(delta.severity) : violation.severity === "error" ? "\u{1F534}" : "\u{1F7E1}";
    const lineNote = commentLine !== violation.startLine ? ` *(\`${violation.symbolName}\` starts at line ${violation.startLine})*` : "";
    const metricLabel = getMetricLabel(violation.metricType || "cyclomatic");
    const valueDisplay = formatComplexityValue(violation.metricType || "cyclomatic", violation.complexity);
    const thresholdDisplay = formatThresholdValue(violation.metricType || "cyclomatic", violation.threshold);
    logger.info(`Adding comment for ${violation.filepath}:${commentLine} (${violation.symbolName})${deltaStr}`);
    return {
      path: violation.filepath,
      line: commentLine,
      body: `${severityEmoji} **${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)}: ${valueDisplay}**${deltaStr} (threshold: ${thresholdDisplay})${lineNote}

${comment}`
    };
  }).all();
}
function partitionViolationsByDiff(violations, diffLines) {
  const withLines = [];
  const uncovered = [];
  for (const v of violations) {
    const commentLine = findCommentLine(v, diffLines);
    if (commentLine !== null) {
      withLines.push({ violation: v, commentLine });
    } else {
      uncovered.push(v);
    }
  }
  return { withLines, uncovered };
}
function filterNewOrDegraded(violationsWithLines, deltaMap) {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey2(violation);
    const delta = deltaMap.get(key);
    return !delta || delta.severity === "new" || delta.delta > 0;
  });
}
function getSkippedViolations(violationsWithLines, deltaMap) {
  return violationsWithLines.filter(({ violation }) => {
    const key = createDeltaKey2(violation);
    const delta = deltaMap.get(key);
    return delta && delta.severity !== "new" && delta.delta === 0;
  }).map((v) => v.violation);
}
function processViolationsForReview(violations, diffLines, deltaMap) {
  const { withLines, uncovered } = partitionViolationsByDiff(violations, diffLines);
  const newOrDegraded = filterNewOrDegraded(withLines, deltaMap);
  const skipped = getSkippedViolations(withLines, deltaMap);
  return { withLines, uncovered, newOrDegraded, skipped };
}
async function handleNoNewViolations(octokit, prContext, violationsWithLines, uncoveredViolations, deltaMap, report, deltas, logger) {
  if (violationsWithLines.length === 0) {
    return;
  }
  const skippedInDiff = getSkippedViolations(violationsWithLines, deltaMap);
  const uncoveredNote = buildUncoveredNote(uncoveredViolations, deltaMap);
  const skippedNote = buildSkippedNote(skippedInDiff);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRComment(octokit, prContext, summaryBody, logger);
}
async function generateAndPostReview(octokit, prContext, processed, deltaMap, codeSnippets, config, report, deltas, logger) {
  const commentableViolations = processed.newOrDegraded.map((v) => v.violation);
  logger.info(`Generating AI comments for ${commentableViolations.length} new/degraded violations...`);
  const aiComments = await generateLineComments(
    commentableViolations,
    codeSnippets,
    config.openrouterApiKey,
    config.model,
    report,
    logger
  );
  const lineComments = buildLineComments(processed.newOrDegraded, aiComments, deltaMap, logger);
  logger.info(`Built ${lineComments.length} line comments for new/degraded violations`);
  const uncoveredNote = buildUncoveredNote(processed.uncovered, deltaMap);
  const skippedNote = buildSkippedNote(processed.skipped);
  const summaryBody = buildReviewSummary(report, deltas, uncoveredNote + skippedNote);
  await postPRReview(octokit, prContext, lineComments, summaryBody, logger);
  logger.info(`Posted review with ${lineComments.length} line comments`);
}
async function postLineReview(octokit, prContext, report, violations, codeSnippets, config, logger, deltas = null) {
  const diffLines = await getPRDiffLines(octokit, prContext);
  logger.info(`Diff covers ${diffLines.size} files`);
  const deltaMap = buildDeltaMap2(deltas);
  const processed = processViolationsForReview(violations, diffLines, deltaMap);
  logger.info(
    `${processed.withLines.length}/${violations.length} violations can have inline comments (${processed.uncovered.length} outside diff)`
  );
  const skippedCount = processed.withLines.length - processed.newOrDegraded.length;
  if (skippedCount > 0) {
    logger.info(`Skipping ${skippedCount} unchanged pre-existing violations (no LLM calls needed)`);
  }
  if (processed.newOrDegraded.length === 0) {
    logger.info("No new or degraded violations to comment on");
    await handleNoNewViolations(
      octokit,
      prContext,
      processed.withLines,
      processed.uncovered,
      deltaMap,
      report,
      deltas,
      logger
    );
    return;
  }
  await generateAndPostReview(
    octokit,
    prContext,
    processed,
    deltaMap,
    codeSnippets,
    config,
    report,
    deltas,
    logger
  );
}
async function postSummaryReview(octokit, prContext, report, codeSnippets, config, logger, isFallback = false, deltas = null, uncoveredNote = "") {
  const prompt = buildReviewPrompt(report, prContext, codeSnippets, deltas);
  logger.debug(`Prompt length: ${prompt.length} characters`);
  const aiReview = await generateReview(
    prompt,
    config.openrouterApiKey,
    config.model,
    logger
  );
  const usage = getTokenUsage();
  const comment = formatReviewComment(aiReview, report, isFallback, usage, deltas, uncoveredNote);
  await postPRComment(octokit, prContext, comment, logger);
  logger.info("Successfully posted AI review summary comment");
}
async function postReviewIfNeeded(result, setup) {
  const { config, prContext, octokit, logger } = setup;
  if (result.currentReport.summary.totalViolations === 0) {
    logger.info("No complexity violations found");
    const successMessage = buildNoViolationsMessage(prContext, result.deltas);
    await postPRComment(octokit, prContext, successMessage, logger);
    return;
  }
  const { violations, codeSnippets } = await prepareViolationsForReview(
    result.currentReport,
    octokit,
    prContext,
    logger
  );
  resetTokenUsage();
  if (config.reviewStyle === "summary") {
    const diffLines = await getPRDiffLines(octokit, prContext);
    const deltaMap = buildDeltaMap2(result.deltas);
    const { uncovered } = partitionViolationsByDiff(violations, diffLines);
    const uncoveredNote = buildUncoveredNote(uncovered, deltaMap);
    await postSummaryReview(
      octokit,
      prContext,
      result.currentReport,
      codeSnippets,
      config,
      logger,
      false,
      result.deltas,
      uncoveredNote
    );
  } else {
    await postLineReview(
      octokit,
      prContext,
      result.currentReport,
      violations,
      codeSnippets,
      config,
      logger,
      result.deltas
    );
  }
}

// src/index.ts
var actionsLogger = {
  info: (msg) => core.info(msg),
  warning: (msg) => core.warning(msg),
  error: (msg) => core.error(msg),
  debug: (msg) => core.debug(msg)
};
function getConfig() {
  const reviewStyle = core.getInput("review_style") || "line";
  return {
    openrouterApiKey: core.getInput("openrouter_api_key", { required: true }),
    model: core.getInput("model") || "anthropic/claude-sonnet-4",
    threshold: core.getInput("threshold") || "15",
    reviewStyle: reviewStyle === "summary" ? "summary" : "line",
    enableDeltaTracking: core.getInput("enable_delta_tracking") === "true",
    baselineComplexityPath: core.getInput("baseline_complexity") || ""
  };
}
function getPRContext() {
  const { context } = github;
  if (!context.payload.pull_request) {
    core.warning("This action only works on pull_request events");
    return null;
  }
  const pr = context.payload.pull_request;
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber: pr.number,
    title: pr.title,
    baseSha: pr.base.sha,
    headSha: pr.head.sha
  };
}
function setOutputs(deltaSummary, report) {
  if (deltaSummary) {
    core.setOutput("total_delta", deltaSummary.totalDelta);
    core.setOutput("improved", deltaSummary.improved);
    core.setOutput("degraded", deltaSummary.degraded);
  }
  core.setOutput("violations", report.summary.totalViolations);
  core.setOutput("errors", report.summary.bySeverity.error);
  core.setOutput("warnings", report.summary.bySeverity.warning);
}
async function run() {
  try {
    core.info("Starting Lien AI Code Review...");
    core.info(`Node version: ${process.version}`);
    core.info(`Working directory: ${process.cwd()}`);
    const config = getConfig();
    core.info(`Using model: ${config.model}`);
    core.info(`Complexity threshold: ${config.threshold}`);
    core.info(`Review style: ${config.reviewStyle}`);
    const githubToken = core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
    if (!githubToken) {
      throw new Error("GitHub token is required");
    }
    const prContext = getPRContext();
    if (!prContext) {
      core.info("Not running in PR context, exiting gracefully");
      return;
    }
    core.info(`Reviewing PR #${prContext.pullNumber}: ${prContext.title}`);
    const octokit = createOctokit(githubToken);
    const setup = {
      config,
      prContext,
      octokit,
      logger: actionsLogger,
      rootDir: process.cwd()
    };
    const analysisResult = await orchestrateAnalysis(setup);
    if (!analysisResult) {
      return;
    }
    const deltaSummary = await handleAnalysisOutputs(analysisResult, setup);
    setOutputs(deltaSummary, analysisResult.currentReport);
    await postReviewIfNeeded(analysisResult, setup);
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : "An unexpected error occurred";
    const stack = error2 instanceof Error ? error2.stack : "";
    core.error(`Action failed: ${message}`);
    if (stack) {
      core.error(`Stack trace:
${stack}`);
    }
    core.setFailed(message);
  }
}
run().catch((error2) => {
  core.setFailed(error2 instanceof Error ? error2.message : String(error2));
  process.exit(1);
});
//# sourceMappingURL=index.js.map