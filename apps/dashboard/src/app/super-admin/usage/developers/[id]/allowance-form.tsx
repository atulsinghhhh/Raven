'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Select, TextareaField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import type { ProductUsageBreakdown, UsageProduct } from '@/lib/super-admin/usage';

const PRODUCT_LABEL: Record<UsageProduct, string> = {
  RTC: 'RTC (minutes)',
  CHAT: 'Chat (messages)',
  LIVE_STREAMING: 'Live Streaming (host minutes)',
};

/**
 * "Admins can inspect unusual usage spikes. Admins must NOT silently modify
 * developer limits" — spec §14. This is the one place in the whole slice
 * that mutates anything, so it's deliberately harder to submit than a
 * normal settings form: the reason field is required before the button
 * even enables, and a native `confirm()` restates the exact before/after
 * change one more time before the request goes out. The API is the real
 * enforcement (400 without a reason, audit log on every write) — this is
 * just making the admin look at what they're about to do.
 */
export function AllowanceForm({ userId, products }: { userId: string; products: ProductUsageBreakdown[] }) {
  const router = useRouter();
  const [product, setProduct] = useState<UsageProduct>(products[0]?.product ?? 'RTC');
  const [value, setValue] = useState<string>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const current = products.find((p) => p.product === product);
  const isCountBased = product === 'CHAT';
  const parsedValue = Number.parseInt(value, 10);
  const valueValid = value.trim() !== '' && Number.isInteger(parsedValue) && parsedValue >= 0;
  const notProvisioned = !current?.provisioned;
  const canSubmit = valueValid && reason.trim().length > 0 && !saving && !notProvisioned;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const fieldLabel = isCountBased ? 'included messages' : 'included minutes';
    const before = current?.provisioned ? current.included : 0;
    const confirmed = window.confirm(
      `Change ${PRODUCT_LABEL[product]} ${fieldLabel} for this developer from ${before} to ${parsedValue}?\n\nReason: ${reason.trim()}\n\nThis is written to the admin audit log and cannot be undone silently.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError(undefined);
    setSaved(false);

    try {
      const res = await fetch(`/api/super-admin/usage/${userId}/allowance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          includedMinutes: isCountBased ? undefined : parsedValue,
          includedCount: isCountBased ? parsedValue : undefined,
          reason: reason.trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.message ?? 'Could not change the allowance');
        return;
      }

      setSaved(true);
      setReason('');
      setValue('');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorState title="Could not change the allowance" description={error} />}

      {notProvisioned && (
        <p className="rounded-md border border-warning-line bg-warning-subtle px-3 py-2 text-xs text-warning-text">
          This developer has never used {PRODUCT_LABEL[product]} — there is no allowance row to edit yet. It&apos;s
          created automatically the first time they use it.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          id="allowance-product"
          label="Product"
          value={product}
          onChange={(e) => {
            setProduct(e.target.value as UsageProduct);
            setValue('');
            setSaved(false);
          }}
        >
          {products.map((p) => (
            <option key={p.product} value={p.product}>
              {PRODUCT_LABEL[p.product]}
            </option>
          ))}
        </Select>

        <Field
          id="allowance-value"
          type="number"
          min={0}
          label={isCountBased ? 'New included message count' : 'New included minutes'}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder={current?.provisioned ? String(current.included) : '0'}
          hint={current?.provisioned ? `Currently ${current.included} — ${current.used} used so far.` : 'This developer has no grant for this product yet.'}
          required
        />
      </div>

      <TextareaField
        id="allowance-reason"
        label="Reason (required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setSaved(false);
        }}
        placeholder="Why is this limit changing? e.g. Approved plan upgrade — ticket RAV-1234"
        hint="Written to the admin audit log alongside the before/after values. Never silent."
        required
      />

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <Button type="submit" variant="danger" loading={saving} disabled={!canSubmit}>
          Change limit
        </Button>
        <span aria-live="polite" className="text-sm text-muted">
          {saved ? 'Saved and logged' : ''}
        </span>
      </div>
    </form>
  );
}
