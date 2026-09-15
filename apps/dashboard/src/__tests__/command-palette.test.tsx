import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '@/components/shell/command-palette';
import { ProjectProvider } from '@/lib/project-context';
import type { Project } from '@/lib/api-client';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const PROJECT: Project = {
  id: 'proj_1',
  name: 'acme-video',
  description: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
} as Project;

function renderPalette() {
  return render(
    <div>
      <ProjectProvider project={PROJECT} capabilities={[]}>
        <CommandPalette />
      </ProjectProvider>
      <button type="button">After the palette</button>
    </div>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    push.mockClear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: [] }) });
  });

  it('opens on trigger click and closes on Escape, returning focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPalette();

    const trigger = screen.getByRole('button', { name: /^Search/ });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    // Not just visually gone — the search input this replaced is gone
    // from the DOM in the same render, and without an explicit restore
    // target the browser drops focus to <body>, stranding a keyboard
    // user at the top of the page.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape elsewhere on the page (palette never opened) does not steal focus to the search trigger', async () => {
    const user = userEvent.setup();
    renderPalette();

    const after = screen.getByRole('button', { name: 'After the palette' });
    after.focus();
    await user.keyboard('{Escape}');

    // Regression guard: a naive "Escape always closes/refocuses" handler
    // would yank focus to the search trigger even though the palette was
    // never open.
    expect(after).toHaveFocus();
  });

  it('selecting a result with the keyboard navigates and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPalette();

    const trigger = screen.getByRole('button', { name: /^Search/ });
    await user.click(trigger);
    // Focus moves into the input via requestAnimationFrame, one tick
    // after the panel mounts — the Enter below needs the input to
    // already own focus, the same race projects-list.test.tsx's Dialog
    // tests wait out.
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('clicking the scrim closes the palette and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPalette();

    const trigger = screen.getByRole('button', { name: /^Search/ });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Search' });

    // The scrim is the dialog's own positioning parent; clicking outside
    // the panel itself (but inside that wrapper) is what a mouse user
    // actually does to dismiss it.
    await user.click(dialog.parentElement!);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('Tab inside the palette never reaches the page behind it', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.click(screen.getByRole('button', { name: /^Search/ }));
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());

    await user.tab();

    // The palette's own contract (see command-palette.tsx's onInputKeyDown):
    // results are a listbox navigated by arrow keys, not Tab, so Tab is
    // swallowed rather than carrying focus out to whatever's behind the
    // scrim.
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'After the palette' })).not.toHaveFocus();
  });
});
