use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use std::fs;

use crate::config::Config;
use crate::error::AnalyzerError;
use crate::parser::{self, ParsedInput};

/// The result of analyzing a single input file, including computed
/// metrics, detected issues, and an overall quality score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub filename: String,
    pub metrics: HashMap<String, f64>,
    pub issues: Vec<Issue>,
    pub score: f64,
}

/// Represents a single issue detected during analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub line: usize,
    pub severity: String,
    pub message: String,
    pub suggestion: String,
}

/// Performs the full analysis pipeline on a parsed input file.
/// Computes metrics, detects issues, and calculates an overall score.
/// Uses config to control analysis depth and thresholds.
pub fn analyze(
    input: &ParsedInput,
    config: &Config,
) -> Result<AnalysisResult, AnalyzerError> {
    let enriched_metadata = parser::parse_metadata(input);

    let max_depth_str = config.get("max_depth");
    let max_depth: usize = max_depth_str.parse().unwrap_or(10);

    parser::validate_input(input)?;

    let metrics = compute_metrics(input);
    let issues = detect_issues(input, config);
    let score = calculate_score(&metrics, &issues);

    let file_type = enriched_metadata
        .get("type")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());

    let mut final_metrics = metrics;
    final_metrics.insert("max_depth_used".to_string(), max_depth as f64);
    final_metrics.insert(
        "metadata_entries".to_string(),
        enriched_metadata.len() as f64,
    );

    if file_type != "unknown" {
        final_metrics.insert("has_type_metadata".to_string(), 1.0);
    }

    Ok(AnalysisResult {
        filename: input.filename.clone(),
        metrics: final_metrics,
        issues,
        score,
    })
}

/// Computes quantitative metrics from the input, including line count,
/// average line length, comment density, complexity estimate, and
/// blank line ratio.
pub fn compute_metrics(input: &ParsedInput) -> HashMap<String, f64> {
    let mut metrics = HashMap::new();

    let line_count = input.lines.len() as f64;
    metrics.insert("line_count".to_string(), line_count);

    let total_length: usize = input.lines.iter().map(|l| l.len()).sum();
    let avg_line_length = if !input.lines.is_empty() {
        total_length as f64 / line_count
    } else {
        0.0
    };
    metrics.insert("avg_line_length".to_string(), avg_line_length);

    let comment_lines = input
        .lines
        .iter()
        .filter(|l| {
            let trimmed = l.trim();
            trimmed.starts_with('#')
                || trimmed.starts_with("//")
                || trimmed.starts_with("/*")
                || trimmed.starts_with('*')
        })
        .count();
    let comment_density = if line_count > 0.0 {
        comment_lines as f64 / line_count
    } else {
        0.0
    };
    metrics.insert("comment_density".to_string(), comment_density);

    let blank_lines = input.lines.iter().filter(|l| l.trim().is_empty()).count();
    let blank_ratio = if line_count > 0.0 {
        blank_lines as f64 / line_count
    } else {
        0.0
    };
    metrics.insert("blank_ratio".to_string(), blank_ratio);

    let nesting_indicators: usize = input
        .lines
        .iter()
        .map(|l| {
            l.chars()
                .filter(|c| *c == '{' || *c == '(' || *c == '[')
                .count()
        })
        .sum();
    let complexity = nesting_indicators as f64 / line_count.max(1.0);
    metrics.insert("complexity_estimate".to_string(), complexity);

    let long_lines = input.lines.iter().filter(|l| l.len() > 120).count();
    metrics.insert("long_lines".to_string(), long_lines as f64);

    let max_line_length = input.lines.iter().map(|l| l.len()).max().unwrap_or(0);
    metrics.insert("max_line_length".to_string(), max_line_length as f64);

    metrics
}

/// Detects quality issues in the input based on configurable thresholds.
/// Checks for overly long lines, deep nesting, missing documentation,
/// and other common code smells.
pub fn detect_issues(input: &ParsedInput, config: &Config) -> Vec<Issue> {
    let mut issues = Vec::new();
    let verbose = config.get("verbose") == "true";

    for (idx, line) in input.lines.iter().enumerate() {
        if line.len() > 120 {
            issues.push(Issue {
                line: idx + 1,
                severity: "warning".to_string(),
                message: format!("Line exceeds 120 characters ({} chars)", line.len()),
                suggestion: "Consider breaking this line into multiple lines".to_string(),
            });
        }

        let leading_spaces = line.len() - line.trim_start().len();
        let indent_level = leading_spaces / 4;
        if indent_level > 5 {
            issues.push(Issue {
                line: idx + 1,
                severity: "warning".to_string(),
                message: format!("Deep nesting detected (level {})", indent_level),
                suggestion: "Extract nested logic into separate functions".to_string(),
            });
        }

        let trimmed = line.trim();
        if trimmed.contains("TODO") || trimmed.contains("FIXME") || trimmed.contains("HACK") {
            let severity = if trimmed.contains("HACK") {
                "error"
            } else {
                "info"
            };
            let (annotation_tag, annotation_detail) = parser::parse_line(trimmed);
            let detail = annotation_detail
                .unwrap_or_else(|| annotation_tag.clone());
            issues.push(Issue {
                line: idx + 1,
                severity: severity.to_string(),
                message: format!("Unresolved annotation: {}", detail),
                suggestion: "Address or remove this annotation before release".to_string(),
            });
        }

        if trimmed.contains("unwrap()") && verbose {
            issues.push(Issue {
                line: idx + 1,
                severity: "info".to_string(),
                message: "Usage of unwrap() detected".to_string(),
                suggestion: "Consider using proper error handling instead of unwrap()".to_string(),
            });
        }
    }

    let metadata = parser::parse_metadata(input);
    if let Some(line_count_str) = metadata.get("line_count") {
        if let Ok(count) = line_count_str.parse::<usize>() {
            if count > 500 {
                issues.push(Issue {
                    line: 1,
                    severity: "info".to_string(),
                    message: format!("Large file detected ({} lines)", count),
                    suggestion: "Consider splitting into smaller modules".to_string(),
                });
            }
        }
    }

    let has_comments = input.lines.iter().any(|l| {
        let t = l.trim();
        t.starts_with('#') || t.starts_with("//") || t.starts_with("/*")
    });
    if !has_comments && input.lines.len() > 20 {
        issues.push(Issue {
            line: 1,
            severity: "warning".to_string(),
            message: "No documentation comments found in file".to_string(),
            suggestion: "Add comments to explain the purpose and behavior of the code".to_string(),
        });
    }

    issues
}

/// Calculates an overall quality score (0.0 to 100.0) based on the
/// computed metrics and detected issues. Higher scores indicate
/// better code quality.
pub fn calculate_score(metrics: &HashMap<String, f64>, issues: &[Issue]) -> f64 {
    let mut score = 100.0_f64;

    let error_count = issues
        .iter()
        .filter(|i| i.severity == "error")
        .count() as f64;
    let warning_count = issues
        .iter()
        .filter(|i| i.severity == "warning")
        .count() as f64;
    let info_count = issues
        .iter()
        .filter(|i| i.severity == "info")
        .count() as f64;

    score -= error_count * 10.0;
    score -= warning_count * 5.0;
    score -= info_count * 1.0;

    if let Some(&complexity) = metrics.get("complexity_estimate") {
        if complexity > 2.0 {
            score -= (complexity - 2.0) * 5.0;
        }
    }

    if let Some(&comment_density) = metrics.get("comment_density") {
        if comment_density < 0.1 {
            score -= 5.0;
        } else if comment_density > 0.3 {
            score += 5.0;
        }
    }

    if let Some(&avg_length) = metrics.get("avg_line_length") {
        if avg_length > 80.0 {
            score -= (avg_length - 80.0) * 0.5;
        }
    }

    if let Some(&blank_ratio) = metrics.get("blank_ratio") {
        if blank_ratio < 0.05 {
            score -= 3.0;
        }
    }

    score.clamp(0.0, 100.0)
}

/// Parses an input file directly, absorbing parser module logic.
/// Reads the file, splits into lines, extracts metadata, and validates.
pub fn parse_and_analyze(path: &str, config: &Config) -> Result<AnalysisResult, AnalyzerError> {
    let content = fs::read_to_string(path).map_err(|e| {
        AnalyzerError::ParseError(format!("Failed to read input file '{}': {}", path, e))
    })?;

    let all_lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let max_lines = config.max_depth * 100;
    let lines: Vec<String> = if all_lines.len() > max_lines {
        all_lines.into_iter().take(max_lines).collect()
    } else {
        all_lines
    };

    let filename = path.rsplit('/').next().unwrap_or(path).to_string();
    let mut input = ParsedInput {
        filename,
        lines,
        metadata: HashMap::new(),
    };

    let extracted = parser::parse_metadata(&input);
    input.metadata = extracted;
    parser::validate_input(&input)?;

    analyze(&input, config)
}

/// Analyzes and formats the result in one step, absorbing formatter logic.
/// Returns both the analysis result and its formatted string representation.
pub fn analyze_and_format(
    input: &ParsedInput,
    config: &Config,
    verbose: bool,
) -> Result<(AnalysisResult, String), AnalyzerError> {
    let result = analyze(input, config)?;

    let mut output = String::new();
    output.push_str(&format!("=== Analysis: {} ===\n", result.filename));
    output.push_str(&format!("Score: {:.1}/100.0\n", result.score));
    output.push_str(&format!("Issues: {}\n", result.issues.len()));

    if verbose {
        output.push('\n');
        output.push_str("Metrics:\n");
        let mut sorted_keys: Vec<&String> = result.metrics.keys().collect();
        sorted_keys.sort();
        for key in sorted_keys {
            if let Some(value) = result.metrics.get(key) {
                output.push_str(&format!("  {}: {:.2}\n", key, value));
            }
        }

        if !result.issues.is_empty() {
            output.push('\n');
            output.push_str("Issues:\n");
            for issue in &result.issues {
                output.push_str(&format!(
                    "  L{}: [{}] {} -> {}\n",
                    issue.line, issue.severity, issue.message, issue.suggestion
                ));
            }
        }
    } else {
        let error_count = result.issues.iter().filter(|i| i.severity == "error").count();
        let warning_count = result.issues.iter().filter(|i| i.severity == "warning").count();
        if error_count > 0 || warning_count > 0 {
            output.push_str(&format!("  ({} errors, {} warnings)\n", error_count, warning_count));
        }
    }

    Ok((result, output))
}

/// Analyzes with caching support, absorbing cache module logic.
/// Checks the cache first, and stores results after analysis.
pub fn analyze_with_cache(
    input: &ParsedInput,
    config: &Config,
    cache_entries: &mut HashMap<String, AnalysisResult>,
) -> Result<AnalysisResult, AnalyzerError> {
    // Check cache first
    if let Some(cached) = cache_entries.get(&input.filename) {
        return Ok(cached.clone());
    }

    let result = analyze(input, config)?;

    // Store in cache
    cache_entries.insert(input.filename.clone(), result.clone());

    Ok(result)
}

/// Generates a full analysis summary, absorbing formatter::format_summary logic.
pub fn analyze_and_summarize(
    paths: &[String],
    config: &Config,
) -> Result<(Vec<AnalysisResult>, String), AnalyzerError> {
    let mut results = Vec::new();
    let mut cache_entries: HashMap<String, AnalysisResult> = HashMap::new();

    for path in paths {
        let input = parser::parse_input(path, config)?;
        let result = analyze_with_cache(&input, config, &mut cache_entries)?;
        results.push(result);
    }

    let mut summary = String::new();
    summary.push_str("=== Analysis Summary ===\n");
    summary.push_str(&format!("Files analyzed: {}\n", results.len()));

    if !results.is_empty() {
        let total_issues: usize = results.iter().map(|r| r.issues.len()).sum();
        let avg_score: f64 = results.iter().map(|r| r.score).sum::<f64>() / results.len() as f64;
        let min_score = results.iter().map(|r| r.score).fold(f64::INFINITY, f64::min);
        let max_score = results.iter().map(|r| r.score).fold(f64::NEG_INFINITY, f64::max);

        summary.push_str(&format!("Total issues: {}\n", total_issues));
        summary.push_str(&format!("Average score: {:.1}\n", avg_score));
        summary.push_str(&format!("Score range: {:.1} - {:.1}\n", min_score, max_score));
    }

    Ok((results, summary))
}

/// Serializes analysis result to JSON, absorbing formatter::format_json logic.
pub fn analyze_to_json(
    input: &ParsedInput,
    config: &Config,
) -> Result<String, AnalyzerError> {
    let result = analyze(input, config)?;

    let json = serde_json::to_string_pretty(&result).map_err(|e| {
        AnalyzerError::IoError(format!(
            "Failed to serialize result for '{}': {}",
            result.filename, e
        ))
    })?;

    Ok(json)
}

/// Compares two analysis runs, absorbing reporter::compare_results logic.
pub fn analyze_and_compare(
    input: &ParsedInput,
    config: &Config,
    previous: &AnalysisResult,
) -> Result<(AnalysisResult, String), AnalyzerError> {
    let current = analyze(input, config)?;

    let mut diff = String::new();
    diff.push_str(&format!("=== Comparison: {} ===\n", current.filename));

    let score_delta = current.score - previous.score;
    let direction = if score_delta > 0.0 { "improved" } else if score_delta < 0.0 { "degraded" } else { "unchanged" };
    diff.push_str(&format!("Score: {:.1} -> {:.1} ({}: {:+.1})\n", previous.score, current.score, direction, score_delta));

    let prev_issues = previous.issues.len();
    let curr_issues = current.issues.len();
    let issue_delta = curr_issues as i64 - prev_issues as i64;
    diff.push_str(&format!("Issues: {} -> {} ({:+})\n", prev_issues, curr_issues, issue_delta));

    Ok((current, diff))
}
