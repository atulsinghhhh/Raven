import chalk from 'chalk';

/** Prints exactly one JSON value to stdout — nothing else, ever, so it's always safe to pipe (Phase 8 spec §25). */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function printSuccess(message: string): void {
  process.stdout.write(`${chalk.green('✔')} ${message}\n`);
}

export function printInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** A "Label:\nvalue" block, e.g. the `whoami`/`projects inspect` output style from the spec. */
export function printField(label: string, value: string): void {
  process.stdout.write(`${chalk.dim(label + ':')}\n${value}\n`);
}

export interface TableColumn<T> {
  header: string;
  value: (row: T) => string;
}

/** A minimal, dependency-free table — column widths derived from content, like `docker ps`/`kubectl get`. */
export function printTable<T>(rows: T[], columns: TableColumn<T>[]): void {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => col.value(row).length)),
  );

  const headerLine = columns.map((col, i) => col.header.padEnd(widths[i])).join('   ');
  process.stdout.write(chalk.dim(headerLine) + '\n');

  for (const row of rows) {
    const line = columns.map((col, i) => col.value(row).padEnd(widths[i])).join('   ');
    process.stdout.write(line.trimEnd() + '\n');
  }
}

export function printEmpty(title: string, hint?: string): void {
  process.stdout.write(`${title}\n`);
  if (hint) process.stdout.write(`${chalk.dim(hint)}\n`);
}

export function statusIcon(status: 'up' | 'down' | 'unknown'): string {
  if (status === 'up') return chalk.green('✓');
  if (status === 'down') return chalk.red('✗');
  return chalk.yellow('?');
}
