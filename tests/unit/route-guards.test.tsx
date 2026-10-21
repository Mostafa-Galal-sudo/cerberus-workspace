import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock('../../src/app/auth-context', () => ({ useAuth: mockUseAuth }));

import { AdminGate } from '../../src/app/route-guards';

function renderAdminRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<AdminGate />}>
          <Route path="/admin" element={<div>Admin surface</div>} />
        </Route>
        <Route path="/" element={<div>Workspace home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AdminGate route guard', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  afterEach(cleanup);

  it('redirects a signed-in member away from the admin surface', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['team_member'] } });
    renderAdminRoute();
    expect(screen.getByText('Workspace home')).toBeInTheDocument();
    expect(screen.queryByText('Admin surface')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor away from the admin surface', () => {
    mockUseAuth.mockReturnValue({ user: null });
    renderAdminRoute();
    expect(screen.getByText('Workspace home')).toBeInTheDocument();
    expect(screen.queryByText('Admin surface')).not.toBeInTheDocument();
  });

  it('renders the admin surface for a super admin', () => {
    mockUseAuth.mockReturnValue({ user: { roles: ['team_member', 'super_admin'] } });
    renderAdminRoute();
    expect(screen.getByText('Admin surface')).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });
});
