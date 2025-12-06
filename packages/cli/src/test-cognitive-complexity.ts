/**
 * INTENTIONALLY COMPLEX FILE - FOR TESTING VEILLE CODE REVIEW
 * This file exists solely to trigger cognitive complexity warnings.
 * DELETE THIS FILE after testing!
 */

export function nightmareFunction(data: any[], options: any): any {
  let result = null;
  
  // Nesting level 0: if (+1)
  if (data && data.length > 0) {
    // Nesting level 1: for (+2 = 1 base + 1 nesting)
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      
      // Nesting level 2: if (+3 = 1 base + 2 nesting)
      if (item.type === 'special') {
        // Nesting level 3: switch (+4 = 1 base + 3 nesting)
        switch (item.subtype) {
          case 'a':
            // Nesting level 4: if (+5 = 1 base + 4 nesting)
            if (item.value > 10) {
              result = item.value * 2;
            } else { // +1 for else
              // Nesting level 5: if (+6 = 1 base + 5 nesting)  
              if (item.fallback) {
                result = item.fallback;
              }
            }
            break;
          case 'b':
            // Logical operators: && (+1 for sequence break)
            if (item.valid && item.enabled && item.visible) {
              result = 'b-valid';
            }
            break;
          case 'c':
            // Nesting level 4: try-catch
            try {
              // Nesting level 5: if (+6)
              if (item.risky) {
                throw new Error('risky');
              }
            } catch (e) { // +5 (1 base + 4 nesting)
              // Nesting level 5: if (+6)
              if (options.retry) {
                result = 'retry';
              }
            }
            break;
        }
      } else if (item.type === 'normal') { // +1 for else if
        // More nesting
        // Nesting level 3: while (+4)
        while (item.count > 0) {
          item.count--;
          // Nesting level 4: if (+5)
          if (item.count === 5) {
            // Ternary (+1)
            result = options.mode === 'fast' ? 'fast-5' : 'slow-5';
          }
        }
      } else { // +1 for else
        // Logical OR sequence (+1 for ||, +1 for break to &&)
        if (item.skip || item.ignore || (item.deprecated && item.legacy)) {
          continue;
        }
      }
    }
  }
  
  return result;
}

// Another complex function for good measure
export function anotherComplexOne(input: string, flags: Record<string, boolean>): string {
  let output = '';
  
  if (input) { // +1
    for (const char of input) { // +2
      if (char === 'a') { // +3
        if (flags.uppercase) { // +4
          output += 'A';
        } else { // +1
          if (flags.double) { // +5
            output += 'aa';
          } else { // +1
            output += 'a';
          }
        }
      } else if (char === 'b') { // +1
        if (flags.special && flags.enabled) { // +4, +1 for &&
          output += 'B!';
        }
      } else { // +1
        if (flags.keepOther || flags.allowAll) { // +4, +1 for ||
          output += char;
        }
      }
    }
  }
  
  return output;
}
