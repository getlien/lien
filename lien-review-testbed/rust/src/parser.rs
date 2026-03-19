use std::collections::HashMap;
use crate::error::AnalyzerError;

/// Represents a parsed input file with its content and metadata.
#[derive(Debug, Clone)]
pub struct ParsedInput {
    pub filename: String,
    pub lines: Vec<String>,
    pub metadata: HashMap<String, String>,
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
