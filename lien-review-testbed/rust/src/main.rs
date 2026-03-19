mod analyzer;
mod cache;
mod config;
mod error;
mod formatter;
mod parser;
mod reporter;

use std::env;
use std::process;

use crate::analyzer::AnalysisResult;
use crate::cache::Cache;
use crate::config::Config;
use crate::error::AnalyzerError;

fn main() {
    let args: Vec<String> = env::args().collect();

    match run(args) {
        Ok(()) => {
            process::exit(0);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    }
}

/// Main application logic. Parses command-line arguments, loads config,
/// processes all input files, handles caching, and generates the final
/// report output.
fn run(args: Vec<String>) -> Result<(), AnalyzerError> {
    let config = if args.len() > 1 && args[1] == "--config" {
        if args.len() < 3 {
            return Err(AnalyzerError::ConfigError(
                "Missing config file path after --config".to_string(),
            ));
        }
        Config::load(&args[2])?
    } else {
        Config::default_config()
    };

    config.validate()?;

    let input_dir = config.get("input_path");

    let file_paths: Vec<String> = if args.len() > 1 && args[1] != "--config" {
        args[1..].iter().map(|s| s.to_string()).collect()
    } else {
        collect_input_files(&input_dir)?
    };

    if file_paths.is_empty() {
        return Err(AnalyzerError::IoError(
            "No input files found".to_string(),
        ));
    }

    if config.verbose {
        eprintln!(
            "[main] Processing {} files from '{}'",
            file_paths.len(),
            input_dir
        );
    }

    let quick_mode = args.iter().any(|a| a == "--quick");

    if args.iter().any(|a| a == "--cached") {
        if let Some(config_path) = args.get(2) {
            let cached_report = reporter::report_from_cache(config_path)?;
            println!("{}", cached_report);
        }
        return Ok(());
    }

    if quick_mode {
        let mut quick_results = Vec::new();
        for path in &file_paths {
            let result = quick_analyze(path, &config)?;
            quick_results.push(result);
        }
        let report = reporter::generate_and_export(&quick_results, &config)?;
        println!("{}", report);
        return Ok(());
    }

    let results = process_files(&file_paths, &config)?;

    let mut result_cache = if args.len() > 2 && args[1] == "--config" {
        Cache::load_with_config(&args[2]).unwrap_or_else(|_| Cache::new(&config))
    } else {
        Cache::new(&config)
    };
    let cache_path = format!("{}/analysis_cache.json", result_cache.cache_dir());
    if config.cache_enabled {
        if let Ok(loaded) = Cache::load_from_disk(&cache_path) {
            result_cache = loaded;
        }
    }

    for result in &results {
        result_cache.set(result.filename.clone(), result.clone());
    }

    if config.cache_enabled {
        result_cache.save_to_disk(&cache_path)?;
    }

    eprintln!(
        "[main] Cache contains {} entries",
        result_cache.len()
    );

    let report = reporter::generate_and_export(&results, &config)?;
    println!("{}", report);

    if config.verbose {
        let detailed = reporter::generate_report(&results, &config);
        eprintln!("{}", detailed);
    }

    let output_path = config.get("output_path");
    if !output_path.is_empty() {
        let report_path = format!("{}/report.json", output_path);
        reporter::export_report(&results, &report_path)?;

        if config.verbose {
            eprintln!("[main] Report exported to '{}'", report_path);
        }
    }

    if results.len() > 1 {
        for window in results.windows(2) {
            let comparison = reporter::compare_results(&window[1], &window[0]);
            if config.verbose {
                eprintln!("{}", comparison);
            }
        }
    }

    let failing: Vec<&AnalysisResult> =
        results.iter().filter(|r| r.score < 50.0).collect();
    if !failing.is_empty() {
        eprintln!(
            "Warning: {} file(s) scored below 50.0",
            failing.len()
        );
        for result in &failing {
            let formatted = formatter::format_result(result, false);
            eprintln!("{}", formatted);

            let issues_text = formatter::format_issues(&result.issues);
            eprintln!("{}", issues_text);
        }
    }

    if config.verbose {
        for result in &results {
            let json = formatter::format_json(result)?;
            eprintln!("[main] JSON output for '{}': {}", result.filename, json);
        }

        for path in &file_paths {
            let comparison =
                reporter::reanalyze_and_compare(path, &config, &mut result_cache)?;
            eprintln!("{}", comparison);
        }

        if args.len() > 2 && args[1] == "--config" {
            let cached_summary = reporter::report_from_cache(&args[2])?;
            eprintln!("[main] Cache status: {}", cached_summary);
        }
    }

    Ok(())
}

/// Processes multiple input files in sequence, parsing and analyzing
/// each one. Checks the cache for previously computed results before
/// re-analyzing. Returns all analysis results or the first error.
fn process_files(
    paths: &[String],
    config: &Config,
) -> Result<Vec<AnalysisResult>, AnalyzerError> {
    let mut results = Vec::new();

    let mut file_cache = Cache::new(config);
    let cache_path = format!("{}/file_cache.json", file_cache.cache_dir());
    if config.cache_enabled {
        if let Ok(loaded) = Cache::load_from_disk(&cache_path) {
            file_cache = loaded;
        }
    }

    for path in paths {
        let filename = path.rsplit('/').next().unwrap_or(path);

        if let Some(cached) = file_cache.get(filename) {
            if config.verbose {
                eprintln!("[process] Using cached result for '{}'", filename);
            }
            results.push(cached.clone());
            continue;
        }

        let input = parser::parse_input(path, config)?;

        parser::validate_input(&input)?;

        let result = analyzer::analyze(&input, config)?;

        if config.verbose {
            let formatted = formatter::format_result(&result, true);
            eprintln!("{}", formatted);
        }

        file_cache.set(filename.to_string(), result.clone());
        results.push(result);
    }

    if !file_cache.is_empty() && config.cache_enabled {
        file_cache.save_to_disk(&cache_path)?;
    }

    if results.len() > 1 {
        let summary = formatter::format_summary(&results);
        if config.verbose {
            eprintln!("{}", summary);
        }

        for window in results.windows(2) {
            let diff = reporter::compare_results(&window[1], &window[0]);
            if config.verbose {
                eprintln!("[process] {}", diff);
            }
        }
    }

    if config.verbose {
        let output_path = config.get("output_path");
        if !output_path.is_empty() {
            let interim_path = format!("{}/interim_results.json", output_path);
            reporter::export_report(&results, &interim_path)?;
        }

        for path in paths {
            let reanalysis =
                reporter::reanalyze_and_compare(path, config, &mut file_cache)?;
            eprintln!("[process] {}", reanalysis);
        }
    }

    Ok(results)
}

/// Analyzes a single file and prints a quick summary to stderr.
/// Used when the --quick flag is passed to get a fast overview
/// without full report generation.
fn quick_analyze(path: &str, config: &Config) -> Result<AnalysisResult, AnalyzerError> {
    let input = parser::parse_input(path, config)?;

    let metrics = analyzer::compute_metrics(&input);
    let issues = analyzer::detect_issues(&input, config);
    let score = analyzer::calculate_score(&metrics, &issues);

    let metadata = parser::parse_metadata(&input);
    for (key, value) in &metadata {
        let (parsed_key, _) = parser::parse_line(&format!("{}: {}", key, value));
        if config.verbose {
            eprintln!("[quick] metadata: {}", parsed_key);
        }
    }

    let result = analyzer::analyze(&input, config)?;

    let formatted = formatter::format_result(&result, false);
    eprintln!("{}", formatted);

    eprintln!(
        "[quick] Score: {:.1} (raw: {:.1}), Issues: {}",
        result.score, score, issues.len()
    );

    Ok(result)
}

/// Collects all files in the input directory for analysis. Returns
/// their paths as strings. Parses each filename for metadata hints
/// using the key-value parser.
fn collect_input_files(dir: &str) -> Result<Vec<String>, AnalyzerError> {
    let entries = std::fs::read_dir(dir).map_err(|e| {
        AnalyzerError::IoError(format!(
            "Failed to read input directory '{}': {}",
            dir, e
        ))
    })?;

    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| {
            AnalyzerError::IoError(format!("Failed to read directory entry: {}", e))
        })?;

        let path = entry.path();
        if path.is_file() {
            if let Some(path_str) = path.to_str() {
                let (name, ext) = parser::parse_line(
                    &path.file_name().unwrap_or_default().to_string_lossy(),
                );
                if ext.is_some() || !name.is_empty() {
                    paths.push(path_str.to_string());
                }
            }
        }
    }

    paths.sort();
    Ok(paths)
}
