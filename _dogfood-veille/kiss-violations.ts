// KISS violations — over-engineered factory pattern for trivial string ops.
// Expected: cyclomatic warning on createTransformer, architectural KISS observation

interface StringTransformer {
  name: string;
  transform(input: string): string;
  validate(input: string): boolean;
  getDescription(): string;
}

interface TransformerConfig {
  type: string;
  options?: Record<string, unknown>;
  fallback?: string;
  chainWith?: string;
  priority?: number;
}

class UpperCaseTransformer implements StringTransformer {
  name = 'uppercase';
  transform(input: string): string {
    return input.toUpperCase();
  }
  validate(input: string): boolean {
    return typeof input === 'string' && input.length > 0;
  }
  getDescription(): string {
    return 'Converts text to UPPER CASE';
  }
}

class LowerCaseTransformer implements StringTransformer {
  name = 'lowercase';
  transform(input: string): string {
    return input.toLowerCase();
  }
  validate(input: string): boolean {
    return typeof input === 'string' && input.length > 0;
  }
  getDescription(): string {
    return 'Converts text to lower case';
  }
}

class TrimTransformer implements StringTransformer {
  name = 'trim';
  transform(input: string): string {
    return input.trim();
  }
  validate(input: string): boolean {
    return typeof input === 'string';
  }
  getDescription(): string {
    return 'Removes leading and trailing whitespace';
  }
}

class ReverseTransformer implements StringTransformer {
  name = 'reverse';
  transform(input: string): string {
    return input.split('').reverse().join('');
  }
  validate(input: string): boolean {
    return typeof input === 'string' && input.length > 0;
  }
  getDescription(): string {
    return 'Reverses the string';
  }
}

class SlugifyTransformer implements StringTransformer {
  name = 'slugify';
  transform(input: string): string {
    return input
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  validate(input: string): boolean {
    return typeof input === 'string' && input.length > 0;
  }
  getDescription(): string {
    return 'Converts text to URL slug';
  }
}

class CamelCaseTransformer implements StringTransformer {
  name = 'camelCase';
  transform(input: string): string {
    return input.toLowerCase().replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''));
  }
  validate(input: string): boolean {
    return typeof input === 'string' && input.length > 0;
  }
  getDescription(): string {
    return 'Converts text to camelCase';
  }
}

export function createTransformer(config: TransformerConfig): StringTransformer {
  let transformer: StringTransformer;

  if (config.type === 'uppercase') {
    transformer = new UpperCaseTransformer();
  } else if (config.type === 'lowercase') {
    transformer = new LowerCaseTransformer();
  } else if (config.type === 'trim') {
    transformer = new TrimTransformer();
  } else if (config.type === 'reverse') {
    transformer = new ReverseTransformer();
  } else if (config.type === 'slugify') {
    transformer = new SlugifyTransformer();
  } else if (config.type === 'camelCase') {
    transformer = new CamelCaseTransformer();
  } else {
    if (config.fallback) {
      if (config.fallback === 'uppercase') {
        transformer = new UpperCaseTransformer();
      } else if (config.fallback === 'lowercase') {
        transformer = new LowerCaseTransformer();
      } else if (config.fallback === 'trim') {
        transformer = new TrimTransformer();
      } else {
        transformer = new LowerCaseTransformer();
      }
    } else {
      throw new Error(`Unknown transformer type: ${config.type}`);
    }
  }

  if (config.chainWith) {
    const chained = createTransformer({ type: config.chainWith });
    const base = transformer;
    return {
      name: `${base.name}+${chained.name}`,
      transform: (input: string) => chained.transform(base.transform(input)),
      validate: (input: string) => base.validate(input),
      getDescription: () => `${base.getDescription()} then ${chained.getDescription()}`,
    };
  }

  return transformer;
}

export function processStrings(inputs: string[], configs: TransformerConfig[]): string[] {
  const transformers = configs.map(c => createTransformer(c));
  return inputs.map(input => {
    let result = input;
    for (const t of transformers) {
      if (t.validate(result)) {
        result = t.transform(result);
      }
    }
    return result;
  });
}
