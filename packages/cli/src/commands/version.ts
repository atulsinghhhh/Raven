import { Command } from 'commander';
import { CLI_VERSION } from '../version.js';
import { printInfo } from '../lib/output.js';

export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('Print the Raven CLI version')
    .action(() => {
      printInfo(`Raven CLI ${CLI_VERSION}`);
    });
}
