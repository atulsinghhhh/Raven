import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem } from '@/components/ui/menu';

function TestMenu() {
  return (
    <div>
      <Menu label="Account" trigger={() => <span>Account</span>}>
        <MenuItem onClick={() => {}}>First item</MenuItem>
        <MenuItem onClick={() => {}}>Second item</MenuItem>
      </Menu>
      <button type="button">After the menu</button>
    </div>
  );
}

describe('Menu', () => {
  it('opens on trigger click and closes on Escape, returning focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);

    const trigger = screen.getByRole('button', { name: 'Account' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ArrowDown/ArrowUp move roving focus between items once focus is inside the menu', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    const [first, second] = screen.getAllByRole('menuitem');

    // Arrow handling lives on the menu's own keydown, so focus has to be
    // inside it first — Tab from the trigger is how a keyboard user gets
    // there.
    await user.tab();
    expect(first).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();

    // Wraps back to the first item rather than falling off the end.
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
  });

  it('clicking an item closes the menu', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('menuitem', { name: 'First item' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('tabbing past the last item closes the menu instead of leaving it open with focus elsewhere', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    const [, second] = screen.getAllByRole('menuitem');
    second.focus();

    await user.tab();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'After the menu' })).toHaveFocus();
  });

  it('shift+tab from the trigger back out of the menu region does not close it (moving within the root is not "leaving")', async () => {
    const user = userEvent.setup();
    render(<TestMenu />);

    const trigger = screen.getByRole('button', { name: 'Account' });
    await user.click(trigger);
    const [first] = screen.getAllByRole('menuitem');
    first.focus();

    // Shift+Tab from the first item lands back on the trigger — still
    // inside the menu's root, so the popover must stay open.
    await user.tab({ shift: true });

    expect(trigger).toHaveFocus();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
