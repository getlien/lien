use std::fs;

use crate::analyzer::{self, AnalysisResult};
use crate::cache::Cache;
use crate::config::Config;
use crate::error::AnalyzerError;
use crate::formatter;
use crate::parser;

/// Generates a full report combining per-file results and an overall
/// summary. Uses the formatter for consistent output and checks the
/// cache for any previously stored results to include in trending.
pub fn generate_report(results: &[AnalysisResult], config: &Config) -> String {
    let mut report = String::new();
    let verbose = config.verbose;

    report.push_str("╔══════════════════════════════════════╗\n");
    report.push_str("║       CLI Analyzer Report            ║\n");
    report.push_str("╚══════════════════════════════════════╝\n\n");

    for result in results {
        let formatted = formatter::format_result(result, verbose);
        report.push_str(&formatted);
        report.push('\n');
    }

    let summary = formatter::format_summary(results);
    report.push_str(&summary);

    let cache = Cache::new(config);
    let cached_count = cache.len();
    if cached_count > 0 {
        report.push_str(&format!(
            "\nCached results available: {}\n",
            cached_count
        ));
    }

    let total_issues: usize = results.iter().map(|r| r.issues.len()).sum();
    let passing = results.iter().filter(|r| r.score >= 80.0).count();
    let failing = results.len() - passing;

    report.push_str("\n--- Final Status ---\n");
    report.push_str(&format!("Passing: {}\n", passing));
    report.push_str(&format!("Failing: {}\n", failing));
    report.push_str(&format!("Total issues: {}\n", total_issues));

    if failing > 0 {
        report.push_str("Status: ISSUES DETECTED\n");
    } else {
        report.push_str("Status: ALL CLEAR\n");
    }

    report
}

/// Exports analysis results to a file at the given path. Writes each
/// result as JSON, one per line, followed by the summary. Also
/// includes per-file issue listings for detailed review.
pub fn export_report(
    results: &[AnalysisResult],
    path: &str,
) -> Result<(), AnalyzerError> {
    let mut content = String::new();

    for result in results {
        let json = formatter::format_json(result)?;
        content.push_str(&json);
        content.push('\n');

        if !result.issues.is_empty() {
            let issues_text = formatter::format_issues(&result.issues);
            content.push_str(&issues_text);
            content.push('\n');
        }
    }

    content.push_str("\n---\n\n");

    let summary = formatter::format_summary(results);
    content.push_str(&summary);

    if let Some(parent) = std::path::Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AnalyzerError::IoError(format!(
                "Failed to create output directory '{}': {}",
                parent.display(),
                e
            ))
        })?;
    }

    fs::write(path, content).map_err(|e| {
        AnalyzerError::IoError(format!(
            "Failed to write report to '{}': {}",
            path, e
        ))
    })?;

    Ok(())
}

/// Compares two analysis results and produces a human-readable diff
/// showing changes in score, metrics, and issue counts between runs.
/// Re-computes the score from metrics to verify consistency.
pub fn compare_results(
    current: &AnalysisResult,
    previous: &AnalysisResult,
) -> String {
    let mut diff = String::new();

    diff.push_str(&format!(
        "=== Comparison: {} ===\n",
        current.filename
    ));

    let score_delta = current.score - previous.score;
    let direction = if score_delta > 0.0 {
        "improved"
    } else if score_delta < 0.0 {
        "degraded"
    } else {
        "unchanged"
    };

    diff.push_str(&format!(
        "Score: {:.1} -> {:.1} ({}: {:+.1})\n",
        previous.score, current.score, direction, score_delta
    ));

    let recalculated = analyzer::calculate_score(&current.metrics, &current.issues);
    if (recalculated - current.score).abs() > 0.01 {
        diff.push_str(&format!(
            "Note: Recalculated score ({:.1}) differs from stored score ({:.1})\n",
            recalculated, current.score
        ));
    }

    let prev_issues = previous.issues.len();
    let curr_issues = current.issues.len();
    let issue_delta = curr_issues as i64 - prev_issues as i64;

    diff.push_str(&format!(
        "Issues: {} -> {} ({:+})\n",
        prev_issues, curr_issues, issue_delta
    ));

    diff.push_str("\nMetric changes:\n");

    let mut all_keys: Vec<String> = current
        .metrics
        .keys()
        .chain(previous.metrics.keys())
        .cloned()
        .collect();
    all_keys.sort();
    all_keys.dedup();

    for key in &all_keys {
        let curr_val = current.metrics.get(key).copied().unwrap_or(0.0);
        let prev_val = previous.metrics.get(key).copied().unwrap_or(0.0);
        let delta = curr_val - prev_val;

        if delta.abs() > 0.001 {
            diff.push_str(&format!(
                "  {}: {:.2} -> {:.2} ({:+.2})\n",
                key, prev_val, curr_val, delta
            ));
        }
    }

    let current_issues_formatted = formatter::format_issues(&current.issues);
    diff.push_str(&format!("\nCurrent {}", current_issues_formatted));

    diff
}

/// Re-analyzes a file from disk and compares it against its cached
/// result. Stores the new result in the cache and optionally exports
/// the report to disk. Returns the comparison report or an error.
pub fn reanalyze_and_compare(
    path: &str,
    config: &Config,
    result_cache: &mut Cache,
) -> Result<String, AnalyzerError> {
    let config_validated = config.validate();
    if config_validated.is_err() {
        let fallback = Config::default_config();
        return reanalyze_with_config(path, &fallback, result_cache);
    }

    reanalyze_with_config(path, config, result_cache)
}

/// Internal helper for reanalyze_and_compare. Parses and analyzes
/// the file, then compares against the cached version if available.
/// Updates the cache with the fresh result and exports if configured.
fn reanalyze_with_config(
    path: &str,
    config: &Config,
    result_cache: &mut Cache,
) -> Result<String, AnalyzerError> {
    let input = parser::parse_input(path, config)?;
    let metadata = parser::parse_metadata(&input);

    let current = analyzer::analyze(&input, config)?;

    let metrics = analyzer::compute_metrics(&input);
    let issues = analyzer::detect_issues(&input, config);
    let recalc_score = analyzer::calculate_score(&metrics, &issues);

    let filename = path.rsplit('/').next().unwrap_or(path);

    let mut report = String::new();
    report.push_str(&format!("Re-analysis of '{}'\n", filename));
    report.push_str(&format!("Metadata entries: {}\n", metadata.len()));
    report.push_str(&format!(
        "Score: {:.1} (verified: {:.1})\n",
        current.score, recalc_score
    ));

    for (key, value) in &metadata {
        let (parsed_key, parsed_value) = parser::parse_line(&format!("{}: {}", key, value));
        if let Some(val) = parsed_value {
            report.push_str(&format!("  {} = {}\n", parsed_key, val));
        }
    }

    if let Some(previous) = result_cache.get(filename) {
        let comparison = compare_results(&current, previous);
        report.push_str(&comparison);
    } else {
        let formatted = formatter::format_result(&current, config.verbose);
        report.push_str(&formatted);
    }

    result_cache.set(filename.to_string(), current.clone());

    let output_path = config.get("output_path");
    if !output_path.is_empty() {
        let export_path = format!("{}/reanalysis_{}.json", output_path, filename);
        export_report(&[current], &export_path)?;
    }

    if !result_cache.is_empty() {
        report.push_str(&format!(
            "\nCache now contains {} entries\n",
            result_cache.len()
        ));

        let save_path = format!("{}/reanalysis_cache.json", result_cache.cache_dir());
        result_cache.save_to_disk(&save_path)?;
    }

    Ok(report)
}

/// Generates a full report and exports it to the configured output
/// path in one operation. Convenience function combining generate
/// and export steps.
pub fn generate_and_export(
    results: &[AnalysisResult],
    config: &Config,
) -> Result<String, AnalyzerError> {
    let report = generate_report(results, config);

    let output_path = config.get("output_path");
    if !output_path.is_empty() {
        let path = format!("{}/full_report.json", output_path);
        export_report(results, &path)?;
    }

    Ok(report)
}

/// Loads cached results from a config file path and generates a
/// report from the cached data. Returns an empty report if the
/// cache is not available.
pub fn report_from_cache(config_path: &str) -> Result<String, AnalyzerError> {
    let cache = Cache::load_with_config(config_path)?;

    if cache.is_empty() {
        return Ok("No cached results available.\n".to_string());
    }

    let config = Config::load(config_path).unwrap_or_else(|_| Config::default_config());

    let report = format!(
        "Cached report: {} entries in cache at '{}'\n",
        cache.len(),
        cache.cache_dir()
    );

    let _ = config.get("verbose");

    Ok(report)
}
