import { Command } from 'commander';
import { registerSdkInstallCommand } from './install.js';

export function registerSdkCommand(program: Command): void {
  const sdk = program.command('sdk').description('Install and manage the Raven SDK in this project');
  registerSdkInstallCommand(sdk);
}
