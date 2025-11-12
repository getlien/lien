import figlet from 'figlet';
import chalk from 'chalk';

// Package info
const PACKAGE_NAME = '@liendev/lien';
const VERSION = '0.1.0';

/**
 * Wrap text in a box with a footer line
 */
function wrapInBox(text: string, footer: string, padding = 1): string {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  // Use only the main content (logo) to determine box width
  const maxLength = Math.max(...lines.map(line => line.length));
  
  const horizontalBorder = '─'.repeat(maxLength + padding * 2);
  const top = `┌${horizontalBorder}┐`;
  const bottom = `└${horizontalBorder}┘`;
  const separator = `├${horizontalBorder}┤`;
  
  const paddedLines = lines.map(line => {
    const padRight = ' '.repeat(maxLength - line.length + padding);
    const padLeft = ' '.repeat(padding);
    return `│${padLeft}${line}${padRight}│`;
  });
  
  // Center the footer line
  const totalPad = maxLength - footer.length;
  const leftPad = Math.floor(totalPad / 2);
  const rightPad = totalPad - leftPad;
  const centeredFooter = ' '.repeat(leftPad) + footer + ' '.repeat(rightPad);
  
  const paddedFooter = `│${' '.repeat(padding)}${centeredFooter}${' '.repeat(padding)}│`;
  
  return [top, ...paddedLines, separator, paddedFooter, bottom].join('\n');
}

/**
 * Display the gorgeous ANSI Shadow banner (uses stderr for MCP server)
 */
export function showBanner(): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const footer = `${PACKAGE_NAME} - v${VERSION}`;
  const boxedBanner = wrapInBox(banner.trim(), footer);
  console.error(chalk.cyan(boxedBanner));
  console.error(); // Empty line
}

/**
 * Display the gorgeous ANSI Shadow banner (uses stdout for CLI commands)
 */
export function showCompactBanner(): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const footer = `${PACKAGE_NAME} - v${VERSION}`;
  const boxedBanner = wrapInBox(banner.trim(), footer);
  console.log(chalk.cyan(boxedBanner));
  console.log(); // Empty line
}

