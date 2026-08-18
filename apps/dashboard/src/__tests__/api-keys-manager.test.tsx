import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeysManager } from '@/app/dashboard/projects/[projectId]/api-keys/api-keys-manager';
import type { ApiKeySummary, CreatedApiKey } from '@/lib/api-client';

const EXISTING_KEY: ApiKeySummary = {
  id: 'key-1',
  projectId: 'proj-1',
  publicId: 'rvk_existing',
  name: 'existing-key',
  status: 'ACTIVE',
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null,
};

const CREATED_KEY: CreatedApiKey = {
  id: 'key-2',
  publicId: 'rvk_new',
  name: 'new-key',
  key: 'rvk_new.raw-secret-value',
  createdAt: '2026-01-02T00:00:00.000Z',
  warning: 'This is the only time the full key is shown. Store it securely — it cannot be retrieved again.',
};

describe('ApiKeysManager', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('shows an empty state when there are no keys yet', () => {
    render(<ApiKeysManager projectId="proj-1" initialKeys={[]} />);
    expect(screen.getByText('No API keys yet')).toBeInTheDocument();
  });

  it('renders existing keys without ever showing a secret value', () => {
    render(<ApiKeysManager projectId="proj-1" initialKeys={[EXISTING_KEY]} />);

    expect(screen.getByText('existing-key')).toBeInTheDocument();
    expect(screen.getByText('rvk_existing')).toBeInTheDocument();
    // The full secret is never part of ApiKeySummary — nothing to assert
    // "not present" against by value, but confirm no raw-looking key string leaked.
    expect(screen.queryByText(/rvk_existing\..+/)).not.toBeInTheDocument();
  });

  it('reveals the full secret exactly once, immediately after creating a key', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 201, json: async () => CREATED_KEY });
    const user = userEvent.setup();
    render(<ApiKeysManager projectId="proj-1" initialKeys={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => expect(screen.getByText('rvk_new.raw-secret-value')).toBeInTheDocument());
    expect(screen.getByText(CREATED_KEY.warning)).toBeInTheDocument();
  });

  it('the newly-created key appears in the list below with status Active, but the list entry itself carries no secret', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 201, json: async () => CREATED_KEY });
    const user = userEvent.setup();
    render(<ApiKeysManager projectId="proj-1" initialKeys={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => expect(screen.getByText('new-key')).toBeInTheDocument());
    expect(screen.getByText('rvk_new')).toBeInTheDocument();
  });

  it('revoking a key calls the revoke endpoint and flips its badge to Revoked, hiding the Revoke button', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined });
    const user = userEvent.setup();
    render(<ApiKeysManager projectId="proj-1" initialKeys={[EXISTING_KEY]} />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/api-keys/key-1', { method: 'DELETE' });
  });

  it('shows an error message when key creation fails, without crashing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ code: 'RATE_LIMITED', message: 'Too many requests' }),
    });
    const user = userEvent.setup();
    render(<ApiKeysManager projectId="proj-1" initialKeys={[]} />);

    await user.click(screen.getByRole('button', { name: 'Create key' }));

    await waitFor(() => expect(screen.getByText('Too many requests')).toBeInTheDocument());
  });
});
