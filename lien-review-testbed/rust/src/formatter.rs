use crate::analyzer::{AnalysisResult, Issue};
use crate::error::AnalyzerError;

/// Formats an analysis result for terminal display. When verbose is
/// true, includes individual metrics and the full issue list.
pub fn format_result(result: &AnalysisResult, verbose: bool) -> String {
    let mut output = String::new();

    output.push_str(&format!(
        "=== Analysis: {} ===\n",
        result.filename
    ));
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
            output.push_str(&format_issues(&result.issues));
        }
    } else {
        let error_count = result
            .issues
            .iter()
            .filter(|i| i.severity == "error")
            .count();
        let warning_count = result
            .issues
            .iter()
            .filter(|i| i.severity == "warning")
            .count();

        if error_count > 0 || warning_count > 0 {
            output.push_str(&format!(
                "  ({} errors, {} warnings)\n",
                error_count, warning_count
            ));
        }
    }

    output
}

/// Serializes an analysis result to a pretty-printed JSON string.
/// Returns an error if serialization fails.
pub fn format_json(result: &AnalysisResult) -> Result<String, AnalyzerError> {
    let json = serde_json::to_string_pretty(result).map_err(|e| {
        AnalyzerError::IoError(format!(
            "Failed to serialize result for '{}': {}",
            result.filename, e
        ))
    })?;

    Ok(json)
}

/// Formats a summary of multiple analysis results, showing aggregate
/// statistics across all analyzed files.
pub fn format_summary(results: &[AnalysisResult]) -> String {
    let mut output = String::new();

    output.push_str("=== Analysis Summary ===\n");
    output.push_str(&format!("Files analyzed: {}\n", results.len()));

    if results.is_empty() {
        output.push_str("No files were analyzed.\n");
        return output;
    }

    let total_issues: usize = results.iter().map(|r| r.issues.len()).sum();
    let avg_score: f64 =
        results.iter().map(|r| r.score).sum::<f64>() / results.len() as f64;
    let min_score = results
        .iter()
        .map(|r| r.score)
        .fold(f64::INFINITY, f64::min);
    let max_score = results
        .iter()
        .map(|r| r.score)
        .fold(f64::NEG_INFINITY, f64::max);

    output.push_str(&format!("Total issues: {}\n", total_issues));
    output.push_str(&format!("Average score: {:.1}\n", avg_score));
    output.push_str(&format!("Score range: {:.1} - {:.1}\n", min_score, max_score));

    output.push_str("\nPer-file scores:\n");
    let mut scored_results: Vec<(&String, f64)> = results
        .iter()
        .map(|r| (&r.filename, r.score))
        .collect();
    scored_results.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

    for (filename, score) in &scored_results {
        let indicator = if *score >= 80.0 {
            "PASS"
        } else if *score >= 50.0 {
            "WARN"
        } else {
            "FAIL"
        };
        output.push_str(&format!(
            "  [{}] {}: {:.1}\n",
            indicator, filename, score
        ));
    }

    output
}

/// Formats a list of issues for display, grouped by severity level
/// and sorted by line number within each group.
pub fn format_issues(issues: &[Issue]) -> String {
    let mut output = String::new();

    if issues.is_empty() {
        output.push_str("No issues found.\n");
        return output;
    }

    output.push_str("Issues:\n");

    let mut errors: Vec<&Issue> = issues.iter().filter(|i| i.severity == "error").collect();
    let mut warnings: Vec<&Issue> = issues.iter().filter(|i| i.severity == "warning").collect();
    let mut infos: Vec<&Issue> = issues.iter().filter(|i| i.severity == "info").collect();

    errors.sort_by_key(|i| i.line);
    warnings.sort_by_key(|i| i.line);
    infos.sort_by_key(|i| i.line);

    if !errors.is_empty() {
        output.push_str("  Errors:\n");
        for issue in &errors {
            output.push_str(&format!(
                "    L{}: {} -> {}\n",
                issue.line, issue.message, issue.suggestion
            ));
        }
    }

    if !warnings.is_empty() {
        output.push_str("  Warnings:\n");
        for issue in &warnings {
            output.push_str(&format!(
                "    L{}: {} -> {}\n",
                issue.line, issue.message, issue.suggestion
            ));
        }
    }

    if !infos.is_empty() {
        output.push_str("  Info:\n");
        for issue in &infos {
            output.push_str(&format!(
                "    L{}: {} -> {}\n",
                issue.line, issue.message, issue.suggestion
            ));
        }
    }

    output
}
