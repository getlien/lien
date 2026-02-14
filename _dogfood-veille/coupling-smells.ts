// Coupling smells — monolithic pipeline with mixed responsibilities and mutable state.
// Expected: cyclomatic error, cognitive error, halstead_effort error, halstead_bugs warning,
//           architectural coupling/cohesion observation

interface RawRecord {
  id?: string;
  data?: string;
  type?: string;
  format?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  priority?: number;
}

interface ProcessedRecord {
  id: string;
  normalizedData: string;
  type: string;
  score: number;
  tags: string[];
  warnings: string[];
  outputFormat: string;
}

export function processRecordPipeline(
  records: RawRecord[],
  config: {
    allowedTypes: string[];
    maxRecords: number;
    scoreThreshold: number;
    enableDedup: boolean;
    outputFormat: 'json' | 'csv' | 'xml';
    tagFilters?: string[];
    sourceWeights?: Record<string, number>;
    priorityBoost?: boolean;
  },
): { processed: ProcessedRecord[]; errors: string[]; stats: Record<string, number> } {
  const processed: ProcessedRecord[] = [];
  const errors: string[] = [];
  const stats: Record<string, number> = {
    total: 0,
    valid: 0,
    invalid: 0,
    deduped: 0,
    filtered: 0,
    scored: 0,
  };
  const seenIds = new Set<string>();

  for (let i = 0; i < records.length && processed.length < config.maxRecords; i++) {
    const record = records[i];
    stats.total++;

    // Phase 1: Parsing & basic validation
    if (!record.id) {
      errors.push(`Record ${i}: missing id`);
      stats.invalid++;
      continue;
    }
    if (!record.data) {
      errors.push(`Record ${record.id}: missing data`);
      stats.invalid++;
      continue;
    }
    if (!record.type) {
      errors.push(`Record ${record.id}: missing type`);
      stats.invalid++;
      continue;
    }
    if (!config.allowedTypes.includes(record.type)) {
      errors.push(`Record ${record.id}: disallowed type '${record.type}'`);
      stats.invalid++;
      continue;
    }

    // Phase 2: Dedup
    if (config.enableDedup) {
      if (seenIds.has(record.id)) {
        stats.deduped++;
        continue;
      }
      seenIds.add(record.id);
    }

    // Phase 3: Tag filtering
    if (config.tagFilters && config.tagFilters.length > 0) {
      if (!record.tags || record.tags.length === 0) {
        stats.filtered++;
        continue;
      }
      const hasMatchingTag = record.tags.some(t => config.tagFilters!.includes(t));
      if (!hasMatchingTag) {
        stats.filtered++;
        continue;
      }
    }

    // Phase 4: Data normalization
    let normalizedData = record.data.trim();
    if (record.format === 'html') {
      normalizedData = normalizedData.replace(/<[^>]*>/g, '');
    } else if (record.format === 'markdown') {
      normalizedData = normalizedData.replace(/[#*_~`]/g, '');
    } else if (record.format === 'csv') {
      normalizedData = normalizedData.replace(/,/g, ' | ');
    }
    if (normalizedData.length > 1000) {
      normalizedData = normalizedData.substring(0, 1000) + '...';
    }

    // Phase 5: Scoring
    let score = 0;
    if (record.source && config.sourceWeights) {
      if (config.sourceWeights[record.source]) {
        score += config.sourceWeights[record.source];
      } else if (config.sourceWeights['default']) {
        score += config.sourceWeights['default'];
      } else {
        score += 1;
      }
    } else {
      score += 1;
    }

    if (record.priority !== undefined) {
      if (config.priorityBoost) {
        if (record.priority >= 8) {
          score *= 3;
        } else if (record.priority >= 5) {
          score *= 2;
        } else if (record.priority >= 3) {
          score *= 1.5;
        }
      }
    }

    if (record.tags && record.tags.length > 3) {
      score += record.tags.length * 0.5;
    }

    if (record.metadata) {
      if (record.metadata.verified) {
        score += 5;
      }
      if (record.metadata.featured) {
        score += 10;
      }
      if (record.metadata.sponsored) {
        score -= 2;
      }
    }

    if (score < config.scoreThreshold) {
      stats.filtered++;
      continue;
    }
    stats.scored++;

    // Phase 6: Build output
    const warnings: string[] = [];
    if (normalizedData.length < 10) {
      warnings.push('Very short content');
    }
    if (!record.tags || record.tags.length === 0) {
      warnings.push('No tags');
    }
    if (record.priority !== undefined && record.priority < 3) {
      warnings.push('Low priority');
    }

    let outputFormat = config.outputFormat;
    if (record.metadata?.preferredFormat) {
      if (
        record.metadata.preferredFormat === 'json' ||
        record.metadata.preferredFormat === 'csv' ||
        record.metadata.preferredFormat === 'xml'
      ) {
        outputFormat = record.metadata.preferredFormat as 'json' | 'csv' | 'xml';
      }
    }

    processed.push({
      id: record.id,
      normalizedData,
      type: record.type,
      score,
      tags: record.tags || [],
      warnings,
      outputFormat,
    });

    stats.valid++;
  }

  return { processed, errors, stats };
}
