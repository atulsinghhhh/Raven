import { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-raven-sm',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-raised hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-surface-raised',
  danger: 'bg-danger text-white hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
};

const BASE =
  'inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-100 disabled:opacity-50 disabled:pointer-events-none';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** Same visual language as Button, for real navigations. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a {...props} className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`}>
      {children}
    </a>
  );
}

function Spinner() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
