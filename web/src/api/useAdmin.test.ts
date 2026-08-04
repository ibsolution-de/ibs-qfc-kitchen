import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UserRole } from './gen/qfc/session/v1/session_pb.js';

// `useAdmin.ts` must never touch the real network - mock the client layer,
// the same way `useUsers.test.ts` does.
const { adminClient } = vi.hoisted(() => ({
  adminClient: {
    getSystemStatus: vi.fn(),
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
  },
}));

vi.mock('./clients', () => ({ adminClient }));

import { useSystemStatus, useAppSettings } from './useAdmin';

function makeStatusResponse() {
  return {
    status: {
      serverStartedAtMillis: 1000n,
      serverTimeMillis: 2000n,
      version: '0.4.2',
      dbPath: '/data/qfc.db',
      dbSizeBytes: 2048n,
      devUserMode: false,
      activeWatchSubscriptions: 1n,
      entities: {
        users: 2n,
        employees: 10n,
        customers: 4n,
        projects: 7n,
        planVersions: 3n,
        assignments: 120n,
        absences: 5n,
        quarterData: 6n,
        strategicGoals: 8n,
        northStarMetrics: 2n,
        oneOnOneSessions: 15n,
        publicHolidays: 30n,
      },
      changeLog: { rows: 500n, oldestSeq: 1n, newestSeq: 500n, retentionRows: 1000n },
    },
  };
}

const settingsResponse = {
  effective: { defaultRole: UserRole.PM, adminEmails: ['ada@example.com'] },
  environment: { defaultRole: UserRole.EMPLOYEE, adminEmails: [] },
  defaultRoleOverridden: true,
  adminEmailsOverridden: false,
};

beforeEach(() => {
  adminClient.getSystemStatus.mockReset();
  adminClient.getAppSettings.mockReset();
  adminClient.updateAppSettings.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSystemStatus', () => {
  it('loads on mount and maps every int64 to a plain number', async () => {
    adminClient.getSystemStatus.mockResolvedValue(makeStatusResponse());

    const { result } = renderHook(() => useSystemStatus());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.systemStatus?.version).toBe('0.4.2');
    expect(result.current.systemStatus?.dbSizeBytes).toBe(2048);
    expect(result.current.systemStatus?.entities.employees).toBe(10);
    expect(typeof result.current.systemStatus?.entities.employees).toBe('number');
    expect(result.current.systemStatus?.changeLog.retentionRows).toBe(1000);
  });

  it('re-polls on the given interval and stops after unmount', async () => {
    vi.useFakeTimers();
    adminClient.getSystemStatus.mockResolvedValue(makeStatusResponse());

    const { result, unmount } = renderHook(() => useSystemStatus(1000));
    await act(async () => {});
    expect(result.current.status).toBe('ready');
    expect(adminClient.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(adminClient.getSystemStatus).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(adminClient.getSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a transient failure and recovers', async () => {
    vi.useFakeTimers();
    adminClient.getSystemStatus
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeStatusResponse());

    const { result } = renderHook(() => useSystemStatus(1000));
    await act(async () => {});
    expect(result.current.status).toBe('error');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeUndefined();
  });
});

describe('useAppSettings', () => {
  it('loads effective and environment values, mapping roles to domain strings', async () => {
    adminClient.getAppSettings.mockResolvedValue(settingsResponse);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.settings?.defaultRole).toBe('pm');
    expect(result.current.settings?.environment.defaultRole).toBe('employee');
    expect(result.current.settings?.defaultRoleOverridden).toBe(true);
    expect(result.current.settings?.adminEmails).toEqual(['ada@example.com']);
  });

  it('save sends the proto role and refetches the effective settings', async () => {
    adminClient.getAppSettings.mockResolvedValue(settingsResponse);
    adminClient.updateAppSettings.mockResolvedValue({});

    const { result } = renderHook(() => useAppSettings());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.save({ defaultRole: 'bl', adminEmails: ['grace@example.com'] });
    });

    expect(adminClient.updateAppSettings).toHaveBeenCalledWith({
      settings: { defaultRole: UserRole.BL, adminEmails: ['grace@example.com'] },
    });
    expect(adminClient.getAppSettings).toHaveBeenCalledTimes(2);
  });

  it('surfaces an update failure as a rejected promise for the caller to toast', async () => {
    adminClient.getAppSettings.mockResolvedValue(settingsResponse);
    adminClient.updateAppSettings.mockRejectedValue(new Error('denied'));

    const { result } = renderHook(() => useAppSettings());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await expect(
      act(async () => {
        await result.current.save({ defaultRole: 'employee', adminEmails: [] });
      })
    ).rejects.toThrow('denied');
  });
});
