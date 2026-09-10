import { Command } from 'commander';
import { CLI_VERSION } from '../version.js';
import { printInfo } from '../lib/output.js';

export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('Print the Livqeno CLI version')
    .action(() => {
      printInfo(`Livqeno CLI ${CLI_VERSION}`);
    });
}
