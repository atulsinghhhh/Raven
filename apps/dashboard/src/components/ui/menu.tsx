'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Small popover menu. Rolled by hand instead of pulling in a headless
 * UI dependency: this is the only overlay pattern the console needs,
 * and it's ~80 lines.
 *
 * Keyboard contract: Escape closes and returns focus to the trigger,
 * Arrow keys move between items, Tab out closes.
 */
export function Menu({
  trigger,
  children,
  align = 'start',
  label,
  className = '',
  menuClassName = '',
}: {
  trigger: (props: { open: boolean }) => React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end';
  label: string;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();

    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (items.length === 0) return;

    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="w-full"
      >
        {trigger({ open })}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          onClick={() => setOpen(false)}
          className={`animate-scale-in absolute z-50 mt-1.5 min-w-[13rem] overflow-hidden rounded-lg border border-line bg-overlay p-1 shadow-raven-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  href,
  onClick,
  icon,
  danger = false,
  selected = false,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  selected?: boolean;
}) {
  const cls = `flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors ${
    danger ? 'text-danger-text hover:bg-danger-subtle' : 'text-fg hover:bg-surface-raised'
  }`;

  const inner = (
    <>
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && (
        <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );

  if (href) {
    return (
      <a role="menuitem" href={href} className={cls}>
        {inner}
      </a>
    );
  }

  return (
    <button role="menuitem" type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs font-medium text-subtle">{children}</div>;
}
