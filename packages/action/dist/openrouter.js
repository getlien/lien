"use strict";
/**
 * OpenRouter API client for LLM access
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
exports.resetTokenUsage = resetTokenUsage;
exports.getTokenUsage = getTokenUsage;
exports.parseCommentsResponse = parseCommentsResponse;
exports.generateReview = generateReview;
exports.mapCommentsToViolations = mapCommentsToViolations;
exports.generateLineComments = generateLineComments;
const core = __importStar(require("@actions/core"));
const prompt_js_1 = require("./prompt.js");
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
/**
 * Global token usage accumulator
 */
let totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
};
/**
 * Reset token usage (call at start of review)
 */
function resetTokenUsage() {
    totalUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
    };
}
/**
 * Get current token usage
 */
function getTokenUsage() {
    return { ...totalUsage };
}
/**
 * Accumulate token usage from API response
 * Cost is returned in usage.cost when usage accounting is enabled
 */
function trackUsage(usage) {
    if (!usage)
        return;
    totalUsage.promptTokens += usage.prompt_tokens;
    totalUsage.completionTokens += usage.completion_tokens;
    totalUsage.totalTokens += usage.total_tokens;
    totalUsage.cost += usage.cost || 0;
}
/**
 * Parse JSON comments response from AI, handling markdown code blocks
 * Returns null if parsing fails after retry attempts
 * Exported for testing
 */
function parseCommentsResponse(content) {
    // Try extracting JSON from markdown code block first
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();
    core.info(`Parsing JSON response (${jsonStr.length} chars)`);
    try {
        const parsed = JSON.parse(jsonStr);
        core.info(`Successfully parsed ${Object.keys(parsed).length} comments`);
        return parsed;
    }
    catch (parseError) {
        core.warning(`Initial JSON parse failed: ${parseError}`);
    }
    // Aggressive retry: extract any JSON object from response
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            const parsed = JSON.parse(objectMatch[0]);
            core.info(`Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} comments`);
            return parsed;
        }
        catch (retryError) {
            core.warning(`Retry parsing also failed: ${retryError}`);
        }
    }
    core.warning(`Full response content:\n${content}`);
    return null;
}
/**
 * Generate an AI review using OpenRouter
 */
async function generateReview(prompt, apiKey, model) {
    core.info(`Calling OpenRouter with model: ${model}`);
    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/getlien/lien',
            'X-Title': 'Veille by Lien',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert code reviewer. Provide actionable, specific feedback on code complexity issues. Be concise but thorough.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            max_tokens: 2000,
            temperature: 0.3, // Lower temperature for more consistent reviews
            // Enable usage accounting to get cost data
            // https://openrouter.ai/docs/guides/guides/usage-accounting
            usage: {
                include: true,
            },
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }
    const data = (await response.json());
    if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenRouter');
    }
    const review = data.choices[0].message.content;
    // Cost is in usage.cost when usage accounting is enabled
    if (data.usage) {
        trackUsage(data.usage);
        const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
        core.info(`Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`);
    }
    return review;
}
/**
 * Call OpenRouter API with batched comments prompt
 */
async function callBatchedCommentsAPI(prompt, apiKey, model) {
    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/getlien/lien',
            'X-Title': 'Veille by Lien',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON.',
                },
                { role: 'user', content: prompt },
            ],
            max_tokens: 4096,
            temperature: 0.3,
            usage: { include: true },
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }
    const data = (await response.json());
    if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenRouter');
    }
    return data;
}
/**
 * Map parsed comments to violations, with fallback for missing comments
 * Exported for testing
 */
function mapCommentsToViolations(commentsMap, violations) {
    const results = new Map();
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
            results.set(violation, comment.replace(/\\n/g, '\n'));
        }
        else {
            core.warning(`No comment generated for ${key}`);
            results.set(violation, fallbackMessage(violation));
        }
    }
    return results;
}
/**
 * Generate line comments for multiple violations in a single API call
 *
 * This is more efficient than individual calls:
 * - System prompt only sent once (saves ~100 tokens per violation)
 * - AI has full context of all violations (can identify patterns)
 * - Single API call = faster execution
 */
async function generateLineComments(violations, codeSnippets, apiKey, model) {
    if (violations.length === 0) {
        return new Map();
    }
    core.info(`Generating comments for ${violations.length} violations in single batch`);
    const prompt = (0, prompt_js_1.buildBatchedCommentsPrompt)(violations, codeSnippets);
    const data = await callBatchedCommentsAPI(prompt, apiKey, model);
    if (data.usage) {
        trackUsage(data.usage);
        const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
        core.info(`Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`);
    }
    const commentsMap = parseCommentsResponse(data.choices[0].message.content);
    return mapCommentsToViolations(commentsMap, violations);
}
//# sourceMappingURL=openrouter.js.map