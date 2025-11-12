import figlet from 'figlet';
import chalk from 'chalk';

/**
 * Display the Lien ASCII art banner (uses stderr for MCP server)
 * @param subtitle Optional subtitle to show below the banner
 */
export function showBanner(subtitle?: string): void {
  const banner = figlet.textSync('LIEN', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  console.error(chalk.cyan(banner));
  
  if (subtitle) {
    console.error(chalk.dim(`  ${subtitle}\n`));
  } else {
    console.error(); // Empty line
  }
}

/**
 * Display a compact version of the Lien logo (uses stdout for CLI commands)
 */
export function showCompactBanner(): void {
  const banner = figlet.textSync('LIEN', {
    font: 'Small',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  console.log(chalk.cyan(banner));
  console.log(); // Empty line
}

