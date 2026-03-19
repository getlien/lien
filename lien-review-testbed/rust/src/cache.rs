use std::collections::HashMap;
use std::fs;

use crate::analyzer::AnalysisResult;
use crate::config::Config;
use crate::error::AnalyzerError;

/// An in-memory cache for analysis results, with optional disk
/// persistence. Cache entries are keyed by filename.
#[derive(Debug)]
pub struct Cache {
    entries: HashMap<String, AnalysisResult>,
    cache_enabled: bool,
    cache_dir: String,
}

impl Cache {
    /// Creates a new cache instance configured from the given Config.
    /// The cache respects the cache_enabled flag and derives the cache
    /// directory from the output_path config value.
    pub fn new(config: &Config) -> Self {
        let cache_enabled_str = config.get("cache_enabled");
        let enabled = cache_enabled_str == "true";

        let output_dir = config.get("output_path");
        let cache_dir = if output_dir.is_empty() {
            ".cache".to_string()
        } else {
            format!("{}/.cache", output_dir)
        };

        Cache {
            entries: HashMap::new(),
            cache_enabled: enabled,
            cache_dir,
        }
    }

    /// Looks up a cached analysis result by key. Returns None if the
    /// key is not present or caching is disabled.
    pub fn get(&self, key: &str) -> Option<&AnalysisResult> {
        if !self.cache_enabled {
            return None;
        }
        self.entries.get(key)
    }

    /// Stores an analysis result in the cache. If caching is disabled,
    /// the entry is silently dropped.
    pub fn set(&mut self, key: String, result: AnalysisResult) {
        if !self.cache_enabled {
            return;
        }

        self.entries.insert(key, result);
    }

    /// Loads a previously saved cache from a JSON file on disk.
    /// Returns an error if the file cannot be read or parsed.
    pub fn load_from_disk(path: &str) -> Result<Self, AnalyzerError> {
        let content = fs::read_to_string(path).map_err(|e| {
            AnalyzerError::CacheError(format!(
                "Failed to read cache file '{}': {}",
                path, e
            ))
        })?;

        let entries: HashMap<String, AnalysisResult> =
            serde_json::from_str(&content).map_err(|e| {
                AnalyzerError::CacheError(format!(
                    "Failed to parse cache file '{}': {}",
                    path, e
                ))
            })?;

        Ok(Cache {
            entries,
            cache_enabled: true,
            cache_dir: path
                .rsplit('/')
                .skip(1)
                .collect::<Vec<&str>>()
                .into_iter()
                .rev()
                .collect::<Vec<&str>>()
                .join("/"),
        })
    }

    /// Loads a cache from disk using configuration from a config file.
    /// Falls back to a fresh cache with default config if the config
    /// file or cache file cannot be loaded.
    pub fn load_with_config(config_path: &str) -> Result<Self, AnalyzerError> {
        let config = Config::load(config_path).unwrap_or_else(|_| Config::default_config());
        let mut cache = Cache::new(&config);

        let cache_file = format!("{}/analysis_cache.json", cache.cache_dir());
        if let Ok(loaded) = Cache::load_from_disk(&cache_file) {
            cache = loaded;
        }

        Ok(cache)
    }

    /// Saves the current cache contents to a JSON file on disk.
    /// Creates the parent directory if it does not exist.
    pub fn save_to_disk(&self, path: &str) -> Result<(), AnalyzerError> {
        if !self.cache_enabled {
            return Ok(());
        }

        if let Some(parent) = std::path::Path::new(path).parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AnalyzerError::CacheError(format!(
                    "Failed to create cache directory '{}': {}",
                    parent.display(),
                    e
                ))
            })?;
        }

        let json = serde_json::to_string_pretty(&self.entries).map_err(|e| {
            AnalyzerError::CacheError(format!("Failed to serialize cache: {}", e))
        })?;

        fs::write(path, json).map_err(|e| {
            AnalyzerError::CacheError(format!(
                "Failed to write cache file '{}': {}",
                path, e
            ))
        })?;

        Ok(())
    }

    /// Returns the number of entries currently in the cache.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns true if the cache contains no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Returns the configured cache directory path.
    pub fn cache_dir(&self) -> &str {
        &self.cache_dir
    }
}
