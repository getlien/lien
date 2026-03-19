use std::collections::HashMap;
use std::fs;

use crate::config::Config;
use crate::error::AnalyzerError;

/// Represents a parsed input file with its content and metadata.
#[derive(Debug, Clone)]
pub struct ParsedInput {
    pub filename: String,
    pub lines: Vec<String>,
    pub metadata: HashMap<String, String>,
}

/// Reads the file at the given path and parses it into a structured
/// representation. Respects the max_depth configuration to limit the
/// number of lines processed.
pub fn parse_input(path: &str, config: &Config) -> Result<ParsedInput, AnalyzerError> {
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

    let filename = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string();

    let mut input = ParsedInput {
        filename,
        lines,
        metadata: HashMap::new(),
    };

    let extracted = parse_metadata(&input);
    input.metadata = extracted;

    validate_input(&input)?;

    if config.verbose {
        let line_count = input.lines.len();
        let meta_count = input.metadata.len();
        eprintln!(
            "[parser] Parsed '{}': {} lines, {} metadata entries",
            path, line_count, meta_count
        );
    }

    Ok(input)
}

/// Parses a single line into a key-value pair. Lines containing ':'
/// are split at the first colon. Lines without a colon return the
/// whole line as the key with None as the value.
pub fn parse_line(line: &str) -> (String, Option<String>) {
    let trimmed = line.trim();

    if trimmed.is_empty() {
        return (String::new(), None);
    }

    match trimmed.find(':') {
        Some(pos) => {
            let key = trimmed[..pos].trim().to_string();
            let value = trimmed[pos + 1..].trim().to_string();

            if value.is_empty() {
                (key, None)
            } else {
                (key, Some(value))
            }
        }
        None => (trimmed.to_string(), None),
    }
}

/// Extracts metadata from the parsed input by scanning for lines that
/// start with '#' (header comments) or contain key-value patterns in
/// the first 50 lines of the file.
pub fn parse_metadata(input: &ParsedInput) -> HashMap<String, String> {
    let mut metadata = HashMap::new();
    let scan_limit = input.lines.len().min(50);

    for (idx, line) in input.lines.iter().take(scan_limit).enumerate() {
        let trimmed = line.trim();

        if trimmed.starts_with('#') {
            let comment = trimmed.trim_start_matches('#').trim();
            if !comment.is_empty() {
                let (key, value) = parse_line(comment);
                if let Some(val) = value {
                    metadata.insert(key, val);
                }
            }
            continue;
        }

        if trimmed.starts_with("//") {
            let comment = trimmed.trim_start_matches("//").trim();
            if !comment.is_empty() {
                let (key, value) = parse_line(comment);
                if let Some(val) = value {
                    metadata.insert(key, val);
                }
            }
            continue;
        }

        if idx < 10 {
            let (key, value) = parse_line(trimmed);
            if let Some(val) = value {
                metadata.insert(key, val);
            }
        }
    }

    metadata.insert("line_count".to_string(), input.lines.len().to_string());
    metadata.insert("filename".to_string(), input.filename.clone());

    metadata
}

/// Validates the parsed input, ensuring it is non-empty and does not
/// exceed maximum allowed size.
pub fn validate_input(input: &ParsedInput) -> Result<(), AnalyzerError> {
    if input.lines.is_empty() {
        return Err(AnalyzerError::ParseError(format!(
            "Input file '{}' is empty",
            input.filename
        )));
    }

    if input.filename.is_empty() {
        return Err(AnalyzerError::ParseError(
            "Input filename must not be empty".to_string(),
        ));
    }

    let total_chars: usize = input.lines.iter().map(|l| l.len()).sum();
    if total_chars > 10_000_000 {
        return Err(AnalyzerError::ParseError(format!(
            "Input file '{}' exceeds maximum size of 10MB",
            input.filename
        )));
    }

    let non_empty_lines = input.lines.iter().filter(|l| !l.trim().is_empty()).count();
    if non_empty_lines == 0 {
        return Err(AnalyzerError::ParseError(format!(
            "Input file '{}' contains only blank lines",
            input.filename
        )));
    }

    Ok(())
}
