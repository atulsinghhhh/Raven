'use client';

import { Children, isValidElement, useId, useState, type ReactElement, type ReactNode } from 'react';

export interface TabProps {
  title: string;
  children: ReactNode;
}

/** A single tab's content. Only meaningful as a direct child of `<Tabs>`. */
export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

/**
 * SDK/language switcher for a code example. Every panel is always
 * present in the DOM — only CSS visibility toggles on click — so the
 * page's static HTML (what the search indexer reads, what a reader with
 * JS disabled sees, what a crawler sees) already contains every SDK's
 * version of the example, not just whichever one loads active.
 */
export function Tabs({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(
    (child): child is ReactElement<TabProps> => isValidElement(child) && Boolean((child.props as TabProps)?.title),
  );
  const [active, setActive] = useState(0);
  const groupId = useId();

  if (items.length === 0) return null;

  return (
    <div className="tabs">
      <div role="tablist" className="tabs-list" aria-label="Code example language">
        {items.map((item, index) => (
          <button
            key={item.props.title}
            type="button"
            role="tab"
            id={`${groupId}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${groupId}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            className="tabs-trigger"
            onClick={() => setActive(index)}
          >
            {item.props.title}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.props.title}
          role="tabpanel"
          id={`${groupId}-panel-${index}`}
          aria-labelledby={`${groupId}-tab-${index}`}
          hidden={index !== active}
          className="tabs-panel"
        >
          {item}
        </div>
      ))}
    </div>
  );
}
