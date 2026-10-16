import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CerberusLogo, CerberusMark, CerberusSentinelStatus } from '../../src/components/cerberus-logo';

describe('CERBERUS brand visual identity components', () => {
  it('renders the six-headed guardian mark with proper accessible label', () => {
    render(<CerberusMark size={48} />);
    const mark = screen.getByRole('img', { name: /cerberus six-headed guardian crest/i });
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveAttribute('width', '48');
    expect(mark).toHaveAttribute('height', '48');
  });

  it('renders the complete Cerberus logo lockup with wordmark and subtitle', () => {
    render(<CerberusLogo size="lg" showSubtitle={true} />);
    expect(screen.getByText('CERBERUS')).toBeInTheDocument();
    expect(screen.getByText('SENTINEL WORKSPACE')).toBeInTheDocument();
  });

  it('renders the Cerberus sentinel telemetry status indicator', () => {
    render(<CerberusSentinelStatus />);
    expect(screen.getByText('SENTINEL VIGILANT')).toBeInTheDocument();
    expect(screen.getByText('Evidence-gated operations')).toBeInTheDocument();
  });
});
