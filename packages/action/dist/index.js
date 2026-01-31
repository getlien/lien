// src/index.ts
import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  orchestrateAnalysis,
  handleAnalysisOutputs,
  postReviewIfNeeded
} from "@liendev/review";
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
    const octokit = github.getOctokit(githubToken);
    const setup = {
      config,
      prContext,
      // @actions/github's Octokit is compatible with @octokit/rest API surface
      octokit: octokit.rest,
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