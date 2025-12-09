"use strict";
/**
 * GitHub API helpers for the action
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPRContext = getPRContext;
exports.getPRChangedFiles = getPRChangedFiles;
exports.postPRComment = postPRComment;
exports.getFileContent = getFileContent;
exports.createOctokit = createOctokit;
exports.postPRReview = postPRReview;
exports.updatePRDescription = updatePRDescription;
exports.parsePatchLines = parsePatchLines;
exports.getPRDiffLines = getPRDiffLines;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
/**
 * Get PR context from the GitHub event
 */
function getPRContext() {
    const { context } = github;
    if (!context.payload.pull_request) {
        core.warning('This action only works on pull_request events');
        return null;
    }
    const pr = context.payload.pull_request;
    return {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pullNumber: pr.number,
        title: pr.title,
        baseSha: pr.base.sha,
        headSha: pr.head.sha,
    };
}
/**
 * Get list of files changed in the PR
 */
async function getPRChangedFiles(octokit, prContext) {
    const files = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const response = await octokit.rest.pulls.listFiles({
            owner: prContext.owner,
            repo: prContext.repo,
            pull_number: prContext.pullNumber,
            per_page: perPage,
            page,
        });
        for (const file of response.data) {
            // Only include added or modified files (not deleted)
            if (file.status !== 'removed') {
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
/**
 * Post a comment on the PR
 */
async function postPRComment(octokit, prContext, body) {
    // Check for existing Lien comment to update instead of creating new
    const existingComment = await findExistingComment(octokit, prContext);
    if (existingComment) {
        core.info(`Updating existing comment ${existingComment.id}`);
        await octokit.rest.issues.updateComment({
            owner: prContext.owner,
            repo: prContext.repo,
            comment_id: existingComment.id,
            body,
        });
    }
    else {
        core.info('Creating new comment');
        await octokit.rest.issues.createComment({
            owner: prContext.owner,
            repo: prContext.repo,
            issue_number: prContext.pullNumber,
            body,
        });
    }
}
/**
 * Find existing Lien review comment to update
 */
async function findExistingComment(octokit, prContext) {
    const COMMENT_MARKER = '<!-- lien-ai-review -->';
    const comments = await octokit.rest.issues.listComments({
        owner: prContext.owner,
        repo: prContext.repo,
        issue_number: prContext.pullNumber,
    });
    for (const comment of comments.data) {
        if (comment.body?.includes(COMMENT_MARKER)) {
            return { id: comment.id };
        }
    }
    return null;
}
/**
 * Get code snippet from a file at a specific commit
 */
async function getFileContent(octokit, prContext, filepath, startLine, endLine) {
    try {
        const response = await octokit.rest.repos.getContent({
            owner: prContext.owner,
            repo: prContext.repo,
            path: filepath,
            ref: prContext.headSha,
        });
        if ('content' in response.data) {
            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
            const lines = content.split('\n');
            // Line numbers are 1-based, array is 0-based
            const snippet = lines.slice(startLine - 1, endLine).join('\n');
            return snippet;
        }
    }
    catch (error) {
        core.warning(`Failed to get content for ${filepath}: ${error}`);
    }
    return null;
}
/**
 * Create an Octokit instance from token
 */
function createOctokit(token) {
    return github.getOctokit(token);
}
/**
 * Post a review with line-specific comments
 */
async function postPRReview(octokit, prContext, comments, summaryBody) {
    if (comments.length === 0) {
        // No line comments, just post summary as regular comment
        await postPRComment(octokit, prContext, summaryBody);
        return;
    }
    core.info(`Creating review with ${comments.length} line comments`);
    try {
        // Create a review with line comments
        await octokit.rest.pulls.createReview({
            owner: prContext.owner,
            repo: prContext.repo,
            pull_number: prContext.pullNumber,
            commit_id: prContext.headSha,
            event: 'COMMENT', // Don't approve or request changes, just comment
            body: summaryBody,
            comments: comments.map((c) => ({
                path: c.path,
                line: c.line,
                body: c.body,
            })),
        });
        core.info('Review posted successfully');
    }
    catch (error) {
        // If line comments fail (e.g., lines not in diff), fall back to regular comment
        core.warning(`Failed to post line comments: ${error}`);
        core.info('Falling back to regular PR comment');
        await postPRComment(octokit, prContext, summaryBody);
    }
}
/**
 * Marker comments for the PR description stats badge
 */
const DESCRIPTION_START_MARKER = '<!-- lien-stats -->';
const DESCRIPTION_END_MARKER = '<!-- /lien-stats -->';
/**
 * Update the PR description with a stats badge
 * Appends or replaces the stats section at the bottom of the description
 */
async function updatePRDescription(octokit, prContext, badgeMarkdown) {
    try {
        // Get current PR
        const { data: pr } = await octokit.rest.pulls.get({
            owner: prContext.owner,
            repo: prContext.repo,
            pull_number: prContext.pullNumber,
        });
        const currentBody = pr.body || '';
        const wrappedBadge = `${DESCRIPTION_START_MARKER}\n${badgeMarkdown}\n${DESCRIPTION_END_MARKER}`;
        let newBody;
        // Check if we already have a stats section
        const startIdx = currentBody.indexOf(DESCRIPTION_START_MARKER);
        const endIdx = currentBody.indexOf(DESCRIPTION_END_MARKER);
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            // Replace existing section
            newBody =
                currentBody.slice(0, startIdx) +
                    wrappedBadge +
                    currentBody.slice(endIdx + DESCRIPTION_END_MARKER.length);
            core.info('Updating existing stats badge in PR description');
        }
        else {
            // Append to end
            newBody = currentBody.trim() + '\n\n---\n\n' + wrappedBadge;
            core.info('Adding stats badge to PR description');
        }
        // Update the PR
        await octokit.rest.pulls.update({
            owner: prContext.owner,
            repo: prContext.repo,
            pull_number: prContext.pullNumber,
            body: newBody,
        });
        core.info('PR description updated with complexity stats');
    }
    catch (error) {
        // Don't fail the action if we can't update the description
        core.warning(`Failed to update PR description: ${error}`);
    }
}
/**
 * Parse unified diff patch to extract line numbers that can receive comments
 * Exported for testing
 */
function parsePatchLines(patch) {
    const lines = new Set();
    let currentLine = 0;
    for (const patchLine of patch.split('\n')) {
        // Hunk header: @@ -start,count +start,count @@
        const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
            currentLine = parseInt(hunkMatch[1], 10);
            continue;
        }
        // Added or context line (can have comments)
        if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
            if (!patchLine.startsWith('+++')) {
                lines.add(currentLine);
                currentLine++;
            }
        }
        // Deleted lines (-) don't increment currentLine
    }
    return lines;
}
/**
 * Get lines that are in the PR diff (only these can have line comments)
 * Handles pagination for PRs with 100+ files
 */
async function getPRDiffLines(octokit, prContext) {
    const diffLines = new Map();
    // Use pagination to handle PRs with 100+ files
    const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
        owner: prContext.owner,
        repo: prContext.repo,
        pull_number: prContext.pullNumber,
        per_page: 100,
    });
    for await (const response of iterator) {
        for (const file of response.data) {
            if (!file.patch)
                continue;
            const lines = parsePatchLines(file.patch);
            if (lines.size > 0) {
                diffLines.set(file.filename, lines);
            }
        }
    }
    return diffLines;
}
//# sourceMappingURL=github.js.map