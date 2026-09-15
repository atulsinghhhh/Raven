import { render, screen } from '@testing-library/react';
import { DistributionBar } from '@/components/ui/chart';

describe('DistributionBar', () => {
  it('renders segments and percentages when there is data', () => {
    render(
      <DistributionBar
        segments={[
          { label: 'Connected', value: 3, className: 'bg-success' },
          { label: 'Failed', value: 1, className: 'bg-danger' },
        ]}
        caption="Connection states"
      />,
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('75%', { exact: false })).toBeInTheDocument();
  });

  it('shows a genuinely-empty message when every segment is zero and the fetch succeeded', () => {
    render(
      <DistributionBar
        segments={[{ label: 'Connected', value: 0, className: 'bg-success' }]}
        caption="Connection states"
      />,
    );
    expect(screen.getByText('Nothing recorded in this period')).toBeInTheDocument();
  });

  it('shows a distinct failure message when every segment is zero because the underlying fetch was rejected', () => {
    render(
      <DistributionBar
        segments={[{ label: 'Connected', value: 0, className: 'bg-success' }]}
        caption="Connection states"
        failed
      />,
    );
    expect(screen.getByText('Could not be loaded right now')).toBeInTheDocument();
    expect(screen.queryByText('Nothing recorded in this period')).not.toBeInTheDocument();
  });
});
