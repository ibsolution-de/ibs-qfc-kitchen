import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';

import { LanguageProvider } from '../contexts/LanguageContext';
import type { AdminUser } from '../api/adapters';
import type { Employee } from '../types';

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => (key === 'ibs_qfc_language' ? 'en' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    writable: true,
  });
});

// ---------------------------------------------------------------------------
// Mock `useUsers` and `useToast` - `ManageUsers.tsx` must never touch the
// real network, and asserting on toast calls is far simpler than rendering
// the real `ToastProvider` and querying for its DOM.
// ---------------------------------------------------------------------------

const { saveUser, deleteUser, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
  saveUser: vi.fn(),
  deleteUser: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

let mockUsers: AdminUser[] = [];

vi.mock('../api/useUsers', () => ({
  useUsers: () => ({
    users: mockUsers,
    status: 'ready' as const,
    error: undefined,
    refresh,
    saveUser,
    deleteUser,
  }),
}));

vi.mock('./ui/Toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}));

import { ManageUsers } from './ManageUsers';

const employees: Employee[] = [
  { id: 'e1', name: 'Ada Lovelace', role: 'Engineer', avatar: '', skills: [], availability: 100, location: 'DE', type: 'internal' },
];

const existingUser: AdminUser = {
  id: 'u1',
  name: 'Grace Hopper',
  roles: ['admin'],
  avatar: '',
  employeeId: undefined,
  email: 'grace@example.com',
};

const renderPage = () =>
  render(
    <LanguageProvider>
      <ManageUsers employees={employees} />
    </LanguageProvider>
  );

beforeEach(() => {
  saveUser.mockReset();
  deleteUser.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockUsers = [existingUser];
  saveUser.mockResolvedValue(existingUser);
  deleteUser.mockResolvedValue(undefined);
});

describe('ManageUsers', () => {
  it('adds a never-logged-in email by calling UpsertUser with the typed email and selected role', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Project Manager' }));
    fireEvent.click(screen.getByRole('button', { name: /save user/i }));

    // The add dialog pre-selects the default employee role.
    await waitFor(() =>
      expect(saveUser).toHaveBeenCalledWith('new@example.com', ['employee', 'pm'], undefined)
    );
  });

  it('builds the right role set when toggling roles on and off', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'multi@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Project Manager' })); // + pm
    fireEvent.click(screen.getByRole('button', { name: 'Division Manager (BL)' })); // + bl
    fireEvent.click(screen.getByRole('button', { name: 'Project Manager' })); // - pm again

    fireEvent.click(screen.getByRole('button', { name: /save user/i }));

    await waitFor(() =>
      expect(saveUser).toHaveBeenCalledWith('multi@example.com', ['employee', 'bl'], undefined)
    );
  });

  it('blocks submit with a validation message when no role is selected', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'norole@example.com' } });
    // The employee role is pre-selected; unchecking it leaves the set empty,
    // which must still be rejected.
    fireEvent.click(screen.getByRole('button', { name: 'Employee' }));
    fireEvent.click(screen.getByRole('button', { name: /save user/i }));

    expect(await screen.findByText('At least one role is required.')).toBeInTheDocument();
    expect(saveUser).not.toHaveBeenCalled();
  });

  it('shows a toast message rather than throwing when deleting the last admin', async () => {
    deleteUser.mockRejectedValue(new ConnectError('cannot delete last admin', Code.FailedPrecondition));

    renderPage();

    fireEvent.click(screen.getByTitle('Delete User'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('grace@example.com'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Cannot delete the last admin or your own account.')
    );
  });

  it('shows an invalid-argument toast rather than throwing when the save is rejected server-side', async () => {
    saveUser.mockRejectedValue(new ConnectError('roles empty', Code.InvalidArgument));

    renderPage();

    fireEvent.click(screen.getByTitle('Edit User'));
    fireEvent.click(screen.getByRole('button', { name: /save user/i }));

    await waitFor(() => expect(saveUser).toHaveBeenCalled());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This user needs at least one role.'));
  });
});
