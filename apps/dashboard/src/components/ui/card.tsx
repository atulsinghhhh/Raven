export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-neutral-800/10 dark:border-neutral-100/10 bg-white dark:bg-neutral-900 p-5 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1 text-neutral-900 dark:text-neutral-100">{value}</div>
    </Card>
  );
}
