import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';

import { UserRole } from '../../api/gen/qfc/session/v1/session_pb.js';
import { LanguageProvider } from '../../contexts/LanguageContext';

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

// Mock the client layer (same approach as useUsers.test.ts): the component
// exercises the real `useAdmin` hook, so these tests also cover the
// proto<->domain mapping. `useToast` is mocked to assert on toast calls
// instead of rendering the real ToastProvider.
const { adminClient, toastSuccess, toastError } = vi.hoisted(() => ({
  adminClient: {
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../api/clients', () => ({ adminClient }));

vi.mock('../ui/Toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}));

import { ApplicationSetup } from './ApplicationSetup';

const settingsResponse = {
  effective: { defaultRole: UserRole.PM, adminEmails: ['ada@example.com'], planRevisionRetention: 5 },
  environment: { defaultRole: UserRole.EMPLOYEE, adminEmails: ['boss@company.com'], planRevisionRetention: 10 },
  defaultRoleOverridden: true,
  adminEmailsOverridden: false,
  planRevisionRetentionOverridden: false,
};

const renderPage = () =>
  render(
    <LanguageProvider>
      <ApplicationSetup />
    </LanguageProvider>
  );

beforeEach(() => {
  adminClient.getAppSettings.mockReset();
  adminClient.updateAppSettings.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  adminClient.getAppSettings.mockResolvedValue(settingsResponse);
  adminClient.updateAppSettings.mockResolvedValue({});
});

describe('ApplicationSetup', () => {
  it('renders the effective values once loaded', async () => {
    renderPage();

    expect(await screen.findByDisplayValue('ada@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText(/default role/i)).toHaveValue('pm');
  });

  it('shows an override badge and the shadowed environment value for overridden fields', async () => {
    renderPage();

    expect(await screen.findByText('DB Override')).toBeInTheDocument();
    expect(screen.getByText(/Environment: Employee/)).toBeInTheDocument();
    // admin_emails is NOT overridden in the fixture - exactly one badge.
    expect(screen.getAllByText('DB Override')).toHaveLength(1);
  });

  it('saves normalized values (lowercased emails, blank lines dropped) with the proto role', async () => {
    renderPage();

    // Gate on the value the load effect writes, not just on the field being
    // present: the textarea renders as soon as status is "ready", but the
    // effect that copies the loaded settings into form state can flush after
    // that. Editing before it does gets silently overwritten - which is
    // exactly how this test failed on CI while passing locally.
    await screen.findByDisplayValue('ada@example.com');

    fireEvent.change(screen.getByLabelText(/admin emails/i), {
      target: { value: '  ADA@Example.com\n\ngrace@example.com \n' },
    });
    fireEvent.change(screen.getByLabelText(/default role/i), { target: { value: 'bl' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() =>
      expect(adminClient.updateAppSettings).toHaveBeenCalledWith({
        settings: {
          defaultRole: UserRole.BL,
          adminEmails: ['ada@example.com', 'grace@example.com'],
          planRevisionRetention: 5,
        },
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Settings saved successfully.'));
    // The save refetches so the effective values/flags stay in sync.
    expect(adminClient.getAppSettings).toHaveBeenCalledTimes(2);
  });

  it('blocks saving when an email line is invalid', async () => {
    renderPage();

    // Same ordering guard as above: without it a late-flushing load effect
    // restores the valid fixture email and the save would go through.
    await screen.findByDisplayValue('ada@example.com');

    fireEvent.change(screen.getByLabelText(/admin emails/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByText('Every line must be a valid email address.')).toBeInTheDocument();
    expect(adminClient.updateAppSettings).not.toHaveBeenCalled();
  });

  it('shows a toast rather than throwing when the server rejects the settings', async () => {
    adminClient.updateAppSettings.mockRejectedValue(new ConnectError('invalid default role', Code.InvalidArgument));

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /save settings/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('The server rejected these settings. Please check the values.')
    );
  });
});
