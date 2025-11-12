import figlet from 'figlet';
import chalk from 'chalk';

// Version from package.json
const VERSION = '0.1.0';

/**
 * Wrap text in a box with optional footer lines (fixed width based on main content)
 */
function wrapInBox(text: string, footerLines: string[] = [], padding = 1): string {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  // Use only the main content (logo) to determine box width
  const maxLength = Math.max(...lines.map(line => line.length));
  
  const horizontalBorder = '─'.repeat(maxLength + padding * 2);
  const top = `┌${horizontalBorder}┐`;
  const bottom = `└${horizontalBorder}┘`;
  
  const paddedLines = lines.map(line => {
    const padRight = ' '.repeat(maxLength - line.length + padding);
    const padLeft = ' '.repeat(padding);
    return `│${padLeft}${line}${padRight}│`;
  });
  
  // Add separator and footer if provided
  if (footerLines.length > 0) {
    const separator = `├${horizontalBorder}┤`;
    
    // Wrap footer lines to fit the box width
    const wrappedFooter: string[] = [];
    for (const line of footerLines) {
      if (line.length <= maxLength) {
        // Center short lines
        const totalPad = maxLength - line.length;
        const leftPad = Math.floor(totalPad / 2);
        const rightPad = totalPad - leftPad;
        wrappedFooter.push(' '.repeat(leftPad) + line + ' '.repeat(rightPad));
      } else {
        // Wrap long lines
        const words = line.split(' ');
        let currentLine = '';
        
        for (const word of words) {
          if (currentLine.length + word.length + 1 <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) {
              wrappedFooter.push(currentLine.padEnd(maxLength));
            }
            currentLine = word;
          }
        }
        if (currentLine) {
          wrappedFooter.push(currentLine.padEnd(maxLength));
        }
      }
    }
    
    const paddedFooter = wrappedFooter.map(line => {
      const padLeft = ' '.repeat(padding);
      const padRight = ' '.repeat(padding);
      return `│${padLeft}${line}${padRight}│`;
    });
    
    return [top, ...paddedLines, separator, ...paddedFooter, bottom].join('\n');
  }
  
  return [top, ...paddedLines, bottom].join('\n');
}

/**
 * Display the gorgeous ANSI Shadow banner (uses stderr for MCP server)
 * @param subtitle Optional subtitle to show inside the banner
 */
export function showBanner(subtitle?: string): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const footerLines: string[] = [];
  if (subtitle) {
    footerLines.push(subtitle);
  }
  footerLines.push(`v${VERSION}`);

  const boxedBanner = wrapInBox(banner.trim(), footerLines);
  console.error(chalk.cyan(boxedBanner));
  console.error(); // Empty line
}

/**
 * Display the gorgeous ANSI Shadow banner (uses stdout for CLI commands)
 * @param subtitle Optional subtitle to show inside the banner
 */
export function showCompactBanner(subtitle?: string): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const footerLines: string[] = [];
  if (subtitle) {
    footerLines.push(subtitle);
  }
  footerLines.push(`v${VERSION}`);

  const boxedBanner = wrapInBox(banner.trim(), footerLines);
  console.log(chalk.cyan(boxedBanner));
  console.log(); // Empty line
}

