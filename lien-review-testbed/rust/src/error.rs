use std::fmt;

/// Represents all possible errors that can occur during analysis.
#[derive(Debug)]
pub enum AnalyzerError {
    ConfigError(String),
    ParseError(String),
    IoError(String),
    CacheError(String),
}

impl fmt::Display for AnalyzerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AnalyzerError::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
            AnalyzerError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            AnalyzerError::IoError(msg) => write!(f, "I/O error: {}", msg),
            AnalyzerError::CacheError(msg) => write!(f, "Cache error: {}", msg),
        }
    }
}

impl std::error::Error for AnalyzerError {}

impl From<std::io::Error> for AnalyzerError {
    fn from(err: std::io::Error) -> Self {
        AnalyzerError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for AnalyzerError {
    fn from(err: serde_json::Error) -> Self {
        AnalyzerError::ParseError(err.to_string())
    }
}
