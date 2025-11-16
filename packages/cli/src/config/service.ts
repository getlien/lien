import fs from 'fs/promises';
import path from 'path';
import { LienConfig, LegacyLienConfig, defaultConfig, isLegacyConfig, isModernConfig } from './schema.js';
import { deepMergeConfig } from './merge.js';
import { needsMigration as checkNeedsMigration, migrateConfig as performMigration } from './migration.js';
import { ConfigError, wrapError } from '../errors/index.js';

/**
 * Validation result with errors and warnings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Migration result with status and config
 */
export interface MigrationResult {
  migrated: boolean;
  backupPath?: string;
  config: LienConfig;
}

/**
 * ConfigService encapsulates all configuration operations including
 * loading, saving, migration, and validation.
 * 
 * This service provides a single point of truth for config management
 * with comprehensive error handling and validation.
 */
export class ConfigService {
  private static readonly CONFIG_FILENAME = '.lien.config.json';
  
  /**
   * Load configuration from the specified directory.
   * Automatically handles migration if needed.
   * 
   * @param rootDir - Root directory containing the config file
   * @returns Loaded and validated configuration
   * @throws {ConfigError} If config is invalid or cannot be loaded
   */
  async load(rootDir: string = process.cwd()): Promise<LienConfig> {
    const configPath = this.getConfigPath(rootDir);
    
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const userConfig = JSON.parse(configContent);
      
      // Check if migration is needed
      if (this.needsMigration(userConfig)) {
        console.log('🔄 Migrating config from v0.2.0 to v0.3.0...');
        
        const result = await this.migrate(rootDir);
        
        if (result.migrated && result.backupPath) {
          const backupFilename = path.basename(result.backupPath);
          console.log(`✅ Migration complete! Backup saved as ${backupFilename}`);
          console.log('📝 Your config now uses the framework-based structure.');
        }
        
        return result.config;
      }
      
      // Merge with defaults first
      const mergedConfig = deepMergeConfig(defaultConfig, userConfig as Partial<LienConfig>);
      
      // Then validate the merged config
      const validation = this.validate(mergedConfig);
      if (!validation.valid) {
        throw new ConfigError(
          `Invalid configuration:\n${validation.errors.join('\n')}`,
          { errors: validation.errors, warnings: validation.warnings }
        );
      }
      
      // Show warnings if any
      if (validation.warnings.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        validation.warnings.forEach(warning => console.warn(`   ${warning}`));
      }
      
      return mergedConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Config doesn't exist, return defaults
        return defaultConfig;
      }
      
      if (error instanceof ConfigError) {
        throw error;
      }
      
      if (error instanceof SyntaxError) {
        throw new ConfigError(
          'Failed to parse config file: Invalid JSON syntax',
          { path: configPath, originalError: error.message }
        );
      }
      
      throw wrapError(error, 'Failed to load configuration', { path: configPath });
    }
  }
  
  /**
   * Save configuration to the specified directory.
   * Validates the config before saving.
   * 
   * @param rootDir - Root directory to save the config file
   * @param config - Configuration to save
   * @throws {ConfigError} If config is invalid or cannot be saved
   */
  async save(rootDir: string, config: LienConfig): Promise<void> {
    const configPath = this.getConfigPath(rootDir);
    
    // Validate before saving
    const validation = this.validate(config);
    if (!validation.valid) {
      throw new ConfigError(
        `Cannot save invalid configuration:\n${validation.errors.join('\n')}`,
        { errors: validation.errors }
      );
    }
    
    try {
      const configJson = JSON.stringify(config, null, 2) + '\n';
      await fs.writeFile(configPath, configJson, 'utf-8');
    } catch (error) {
      throw wrapError(error, 'Failed to save configuration', { path: configPath });
    }
  }
  
  /**
   * Check if a configuration file exists in the specified directory.
   * 
   * @param rootDir - Root directory to check
   * @returns True if config file exists
   */
  async exists(rootDir: string = process.cwd()): Promise<boolean> {
    const configPath = this.getConfigPath(rootDir);
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Migrate configuration from v0.2.0 to v0.3.0 format.
   * Creates a backup of the original config file.
   * 
   * @param rootDir - Root directory containing the config file
   * @returns Migration result with status and new config
   * @throws {ConfigError} If migration fails
   */
  async migrate(rootDir: string = process.cwd()): Promise<MigrationResult> {
    const configPath = this.getConfigPath(rootDir);
    
    try {
      // Read existing config
      const configContent = await fs.readFile(configPath, 'utf-8');
      const oldConfig = JSON.parse(configContent);
      
      // Check if migration is needed
      if (!this.needsMigration(oldConfig)) {
        return {
          migrated: false,
          config: oldConfig as LienConfig,
        };
      }
      
      // Perform migration
      const newConfig = performMigration(oldConfig);
      
      // Validate migrated config
      const validation = this.validate(newConfig);
      if (!validation.valid) {
        throw new ConfigError(
          `Migration produced invalid configuration:\n${validation.errors.join('\n')}`,
          { errors: validation.errors }
        );
      }
      
      // Create backup
      const backupPath = `${configPath}.v0.2.0.backup`;
      await fs.copyFile(configPath, backupPath);
      
      // Write migrated config
      await this.save(rootDir, newConfig);
      
      return {
        migrated: true,
        backupPath,
        config: newConfig,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          migrated: false,
          config: defaultConfig,
        };
      }
      
      if (error instanceof ConfigError) {
        throw error;
      }
      
      throw wrapError(error, 'Configuration migration failed', { path: configPath });
    }
  }
  
  /**
   * Check if a config object needs migration from v0.2.0 to v0.3.0.
   * 
   * @param config - Config object to check
   * @returns True if migration is needed
   */
  needsMigration(config: unknown): boolean {
    return checkNeedsMigration(config);
  }
  
  /**
   * Validate a configuration object.
   * Checks all constraints and returns detailed validation results.
   * 
   * @param config - Configuration to validate
   * @returns Validation result with errors and warnings
   */
  validate(config: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Type check
    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        errors: ['Configuration must be an object'],
        warnings: [],
      };
    }
    
    const cfg = config as Partial<LienConfig>;
    
    // Check for required top-level fields
    if (!cfg.version) {
      errors.push('Missing required field: version');
    }
    
    // Validate based on config type
    if (isModernConfig(cfg as LienConfig | LegacyLienConfig)) {
      this.validateModernConfig(cfg as LienConfig, errors, warnings);
    } else if (isLegacyConfig(cfg as LienConfig | LegacyLienConfig)) {
      this.validateLegacyConfig(cfg as LegacyLienConfig, errors, warnings);
    } else {
      errors.push('Configuration format not recognized. Must have either "frameworks" or "indexing" field');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Validate a partial configuration object.
   * Useful for validating user input before merging with defaults.
   * 
   * @param config - Partial configuration to validate
   * @returns Validation result with errors and warnings
   */
  validatePartial(config: Partial<LienConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Validate core settings if present
    if (config.core) {
      this.validateCoreConfig(config.core, errors, warnings);
    }
    
    // Validate MCP settings if present
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }
    
    // Validate git detection settings if present
    if (config.gitDetection) {
      this.validateGitDetectionConfig(config.gitDetection, errors, warnings);
    }
    
    // Validate file watching settings if present
    if (config.fileWatching) {
      this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
    }
    
    // Validate frameworks if present
    if (config.frameworks) {
      this.validateFrameworks(config.frameworks, errors, warnings);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Get the full path to the config file
   */
  private getConfigPath(rootDir: string): string {
    return path.join(rootDir, ConfigService.CONFIG_FILENAME);
  }
  
  /**
   * Validate modern (v0.3.0+) configuration
   */
  private validateModernConfig(
    config: LienConfig,
    errors: string[],
    warnings: string[]
  ): void {
    // Validate core settings
    if (!config.core) {
      errors.push('Missing required field: core');
      return;
    }
    this.validateCoreConfig(config.core, errors, warnings);
    
    // Validate MCP settings
    if (!config.mcp) {
      errors.push('Missing required field: mcp');
      return;
    }
    this.validateMCPConfig(config.mcp, errors, warnings);
    
    // Validate git detection settings
    if (!config.gitDetection) {
      errors.push('Missing required field: gitDetection');
      return;
    }
    this.validateGitDetectionConfig(config.gitDetection, errors, warnings);
    
    // Validate file watching settings
    if (!config.fileWatching) {
      errors.push('Missing required field: fileWatching');
      return;
    }
    this.validateFileWatchingConfig(config.fileWatching, errors, warnings);
    
    // Validate frameworks
    if (!config.frameworks) {
      errors.push('Missing required field: frameworks');
      return;
    }
    this.validateFrameworks(config.frameworks, errors, warnings);
  }
  
  /**
   * Validate legacy (v0.2.0) configuration
   */
  private validateLegacyConfig(
    config: LegacyLienConfig,
    errors: string[],
    warnings: string[]
  ): void {
    warnings.push('Using legacy configuration format. Consider running "lien init" to migrate to v0.3.0');
    
    // Validate indexing settings
    if (!config.indexing) {
      errors.push('Missing required field: indexing');
      return;
    }
    
    const { indexing } = config;
    
    if (typeof indexing.chunkSize !== 'number' || indexing.chunkSize <= 0) {
      errors.push('indexing.chunkSize must be a positive number');
    }
    
    if (typeof indexing.chunkOverlap !== 'number' || indexing.chunkOverlap < 0) {
      errors.push('indexing.chunkOverlap must be a non-negative number');
    }
    
    if (typeof indexing.concurrency !== 'number' || indexing.concurrency < 1 || indexing.concurrency > 16) {
      errors.push('indexing.concurrency must be between 1 and 16');
    }
    
    if (typeof indexing.embeddingBatchSize !== 'number' || indexing.embeddingBatchSize <= 0) {
      errors.push('indexing.embeddingBatchSize must be a positive number');
    }
    
    // Validate MCP settings (same for both)
    if (config.mcp) {
      this.validateMCPConfig(config.mcp, errors, warnings);
    }
  }
  
  /**
   * Validate core configuration settings
   */
  private validateCoreConfig(
    core: Partial<LienConfig['core']>,
    errors: string[],
    warnings: string[]
  ): void {
    if (core.chunkSize !== undefined) {
      if (typeof core.chunkSize !== 'number' || core.chunkSize <= 0) {
        errors.push('core.chunkSize must be a positive number');
      } else if (core.chunkSize < 50) {
        warnings.push('core.chunkSize is very small (<50 lines). This may result in poor search quality');
      } else if (core.chunkSize > 500) {
        warnings.push('core.chunkSize is very large (>500 lines). This may impact performance');
      }
    }
    
    if (core.chunkOverlap !== undefined) {
      if (typeof core.chunkOverlap !== 'number' || core.chunkOverlap < 0) {
        errors.push('core.chunkOverlap must be a non-negative number');
      }
    }
    
    if (core.concurrency !== undefined) {
      if (typeof core.concurrency !== 'number' || core.concurrency < 1 || core.concurrency > 16) {
        errors.push('core.concurrency must be between 1 and 16');
      }
    }
    
    if (core.embeddingBatchSize !== undefined) {
      if (typeof core.embeddingBatchSize !== 'number' || core.embeddingBatchSize <= 0) {
        errors.push('core.embeddingBatchSize must be a positive number');
      } else if (core.embeddingBatchSize > 100) {
        warnings.push('core.embeddingBatchSize is very large (>100). This may cause memory issues');
      }
    }
  }
  
  /**
   * Validate MCP configuration settings
   */
  private validateMCPConfig(
    mcp: Partial<LienConfig['mcp']>,
    errors: string[],
    _warnings: string[]
  ): void {
    if (mcp.port !== undefined) {
      if (typeof mcp.port !== 'number' || mcp.port < 1024 || mcp.port > 65535) {
        errors.push('mcp.port must be between 1024 and 65535');
      }
    }
    
    if (mcp.transport !== undefined) {
      if (mcp.transport !== 'stdio' && mcp.transport !== 'socket') {
        errors.push('mcp.transport must be either "stdio" or "socket"');
      }
    }
    
    if (mcp.autoIndexOnFirstRun !== undefined) {
      if (typeof mcp.autoIndexOnFirstRun !== 'boolean') {
        errors.push('mcp.autoIndexOnFirstRun must be a boolean');
      }
    }
  }
  
  /**
   * Validate git detection configuration settings
   */
  private validateGitDetectionConfig(
    gitDetection: Partial<LienConfig['gitDetection']>,
    errors: string[],
    _warnings: string[]
  ): void {
    if (gitDetection.enabled !== undefined) {
      if (typeof gitDetection.enabled !== 'boolean') {
        errors.push('gitDetection.enabled must be a boolean');
      }
    }
    
    if (gitDetection.pollIntervalMs !== undefined) {
      if (typeof gitDetection.pollIntervalMs !== 'number' || gitDetection.pollIntervalMs < 100) {
        errors.push('gitDetection.pollIntervalMs must be at least 100ms');
      } else if (gitDetection.pollIntervalMs < 1000) {
        _warnings.push('gitDetection.pollIntervalMs is very short (<1s). This may impact performance');
      }
    }
  }
  
  /**
   * Validate file watching configuration settings
   */
  private validateFileWatchingConfig(
    fileWatching: Partial<LienConfig['fileWatching']>,
    errors: string[],
    warnings: string[]
  ): void {
    if (fileWatching.enabled !== undefined) {
      if (typeof fileWatching.enabled !== 'boolean') {
        errors.push('fileWatching.enabled must be a boolean');
      }
    }
    
    if (fileWatching.debounceMs !== undefined) {
      if (typeof fileWatching.debounceMs !== 'number' || fileWatching.debounceMs < 0) {
        errors.push('fileWatching.debounceMs must be a non-negative number');
      } else if (fileWatching.debounceMs < 100) {
        warnings.push('fileWatching.debounceMs is very short (<100ms). This may cause excessive reindexing');
      }
    }
  }
  
  /**
   * Validate frameworks configuration
   */
  private validateFrameworks(
    frameworks: unknown[],
    errors: string[],
    warnings: string[]
  ): void {
    if (!Array.isArray(frameworks)) {
      errors.push('frameworks must be an array');
      return;
    }
    
    frameworks.forEach((framework, index) => {
      if (!framework || typeof framework !== 'object') {
        errors.push(`frameworks[${index}] must be an object`);
        return;
      }
      
      const fw = framework as Partial<any>;
      
      // Validate required fields
      if (!fw.name) {
        errors.push(`frameworks[${index}] missing required field: name`);
      }
      
      if (fw.path === undefined) {
        errors.push(`frameworks[${index}] missing required field: path`);
      } else if (typeof fw.path !== 'string') {
        errors.push(`frameworks[${index}].path must be a string`);
      } else if (path.isAbsolute(fw.path)) {
        errors.push(`frameworks[${index}].path must be relative, got: ${fw.path}`);
      }
      
      if (fw.enabled === undefined) {
        errors.push(`frameworks[${index}] missing required field: enabled`);
      } else if (typeof fw.enabled !== 'boolean') {
        errors.push(`frameworks[${index}].enabled must be a boolean`);
      }
      
      if (!fw.config) {
        errors.push(`frameworks[${index}] missing required field: config`);
      } else {
        this.validateFrameworkConfig(fw.config, `frameworks[${index}].config`, errors, warnings);
      }
    });
  }
  
  /**
   * Validate framework-specific configuration
   */
  private validateFrameworkConfig(
    config: any,
    prefix: string,
    errors: string[],
    _warnings: string[]
  ): void {
    if (!config || typeof config !== 'object') {
      errors.push(`${prefix} must be an object`);
      return;
    }
    
    // Validate include patterns
    if (!Array.isArray(config.include)) {
      errors.push(`${prefix}.include must be an array`);
    } else {
      config.include.forEach((pattern: unknown, i: number) => {
        if (typeof pattern !== 'string') {
          errors.push(`${prefix}.include[${i}] must be a string`);
        }
      });
    }
    
    // Validate exclude patterns
    if (!Array.isArray(config.exclude)) {
      errors.push(`${prefix}.exclude must be an array`);
    } else {
      config.exclude.forEach((pattern: unknown, i: number) => {
        if (typeof pattern !== 'string') {
          errors.push(`${prefix}.exclude[${i}] must be a string`);
        }
      });
    }
    
    // Validate test patterns
    if (!config.testPatterns) {
      errors.push(`${prefix} missing required field: testPatterns`);
    } else if (typeof config.testPatterns !== 'object') {
      errors.push(`${prefix}.testPatterns must be an object`);
    }
  }
}

// Export a singleton instance for convenience
export const configService = new ConfigService();

