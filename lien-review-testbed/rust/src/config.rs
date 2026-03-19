use std::fs;

use serde::{Deserialize, Serialize};

use crate::error::AnalyzerError;

/// Configuration for the CLI analyzer tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub input_path: String,
    pub output_path: String,
    pub verbose: bool,
    pub max_depth: usize,
    pub cache_enabled: bool,
}

impl Config {
    /// Loads configuration from a JSON file at the given path.
    /// Returns an error if the file cannot be read or contains invalid JSON.
    pub fn load(path: &str) -> Result<Self, AnalyzerError> {
        let content = fs::read_to_string(path).map_err(|e| {
            AnalyzerError::ConfigError(format!(
                "Failed to read config file '{}': {}",
                path, e
            ))
        })?;

        let config: Config = serde_json::from_str(&content).map_err(|e| {
            AnalyzerError::ConfigError(format!(
                "Failed to parse config file '{}': {}",
                path, e
            ))
        })?;

        config.validate()?;
        Ok(config)
    }

    /// Returns the configuration value for the given key as a String.
    /// Returns an empty string for unknown keys.
    pub fn get(&self, key: &str) -> String {
        match key {
            "input_path" => self.input_path.clone(),
            "output_path" => self.output_path.clone(),
            "verbose" => self.verbose.to_string(),
            "max_depth" => self.max_depth.to_string(),
            "cache_enabled" => self.cache_enabled.to_string(),
            _ => String::new(),
        }
    }

    /// Validates the configuration values, ensuring paths are non-empty
    /// and max_depth is within a reasonable range.
    pub fn validate(&self) -> Result<(), AnalyzerError> {
        if self.input_path.is_empty() {
            return Err(AnalyzerError::ConfigError(
                "input_path must not be empty".to_string(),
            ));
        }

        if self.output_path.is_empty() {
            return Err(AnalyzerError::ConfigError(
                "output_path must not be empty".to_string(),
            ));
        }

        if self.max_depth == 0 {
            return Err(AnalyzerError::ConfigError(
                "max_depth must be greater than 0".to_string(),
            ));
        }

        if self.max_depth > 100 {
            return Err(AnalyzerError::ConfigError(
                "max_depth must not exceed 100".to_string(),
            ));
        }

        Ok(())
    }

    /// Returns a default configuration suitable for local development.
    pub fn default_config() -> Self {
        Config {
            input_path: "./input".to_string(),
            output_path: "./output".to_string(),
            verbose: false,
            max_depth: 10,
            cache_enabled: true,
        }
    }
}
