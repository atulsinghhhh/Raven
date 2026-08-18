export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
      {description && <p className="text-sm text-neutral-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description }: { title?: string; description?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">{title}</p>
      {description && <p className="text-sm text-red-700 dark:text-red-400 mt-1">{description}</p>}
    </div>
  );
}

export function NoDataYet({ label = 'No data yet' }: { label?: string }) {
  return <span className="text-sm text-neutral-400 italic">{label}</span>;
}
