import figlet from 'figlet';
import chalk from 'chalk';

/**
 * Wrap text in a box
 */
function wrapInBox(text: string, padding = 1): string {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const maxLength = Math.max(...lines.map(line => line.length));
  
  const horizontalBorder = '─'.repeat(maxLength + padding * 2);
  const top = `┌${horizontalBorder}┐`;
  const bottom = `└${horizontalBorder}┘`;
  
  const paddedLines = lines.map(line => {
    const padRight = ' '.repeat(maxLength - line.length + padding);
    const padLeft = ' '.repeat(padding);
    return `│${padLeft}${line}${padRight}│`;
  });
  
  return [top, ...paddedLines, bottom].join('\n');
}

/**
 * Display the Lien ASCII art banner (uses stderr for MCP server)
 * @param subtitle Optional subtitle to show below the banner
 */
export function showBanner(subtitle?: string): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const boxedBanner = wrapInBox(banner.trim());
  console.error(chalk.cyan(boxedBanner));
  
  if (subtitle) {
    console.error(chalk.dim(`\n  ${subtitle}\n`));
  } else {
    console.error(); // Empty line
  }
}

/**
 * Display a compact version of the Lien logo (uses stdout for CLI commands)
 */
export function showCompactBanner(): void {
  const banner = figlet.textSync('LIEN', {
    font: 'Standard',
    horizontalLayout: 'fitted',
    verticalLayout: 'fitted',
  });

  const boxedBanner = wrapInBox(banner.trim());
  console.log(chalk.cyan(boxedBanner));
  console.log(); // Empty line
}

