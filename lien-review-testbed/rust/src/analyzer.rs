use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
