import { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

/*
 * Filled variants carry no shadow. Depth in this console comes from the
 * surface/canvas contrast and hairline borders, and a drop shadow under
 * a button was the one place that rule was broken.
 *
 * The two filled variants run semibold and the outlined ones medium;
 * same split as the marketing site's buttons, and it's what lets a
 * primary action read as primary without also being the only coloured
 * thing on screen.
 */
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg font-semibold hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-fg font-medium hover:bg-surface-raised hover:border-line-strong',
  ghost: 'text-muted font-medium hover:text-fg hover:bg-surface-raised',
  danger: 'bg-danger text-white font-semibold hover:opacity-90',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
};

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-100 disabled:opacity-50 disabled:pointer-events-none';

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
