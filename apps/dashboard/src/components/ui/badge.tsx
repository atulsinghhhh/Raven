type BadgeTone = 'green' | 'red' | 'gray' | 'yellow';

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  gray: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
};

// Status is always icon + text, never color alone (accessibility).
export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      <span aria-hidden="true">{tone === 'green' ? '●' : tone === 'red' ? '●' : tone === 'yellow' ? '●' : '○'}</span>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'up' | 'down' | 'unknown' }) {
  if (status === 'up') return <Badge tone="green">Healthy</Badge>;
  if (status === 'down') return <Badge tone="red">Down</Badge>;
  return <Badge tone="gray">Unknown</Badge>;
}
