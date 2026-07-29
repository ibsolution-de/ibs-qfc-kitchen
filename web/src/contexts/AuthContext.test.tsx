import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';

import { UserSchema, UserRole as UserRoleProto } from '../api/gen/qfc/session/v1/session_pb.js';
import { hasPlanningAccess } from '../utils/access';
import { LanguageProvider } from './LanguageContext';

// `AuthContext.tsx` must never touch the real network - mock the client layer.
const { sessionClient } = vi.hoisted(() => ({
  sessionClient: { getSession: vi.fn() },
}));

vi.mock('../api/clients', () => ({ sessionClient }));

// Import after the mock so `AuthContext` picks up the mocked client.
import { AuthProvider, useAuth } from './AuthContext';

function makeUserProto(roles: UserRoleProto[]) {
  return create(UserSchema, {
    id: 'u1',
    name: 'Ada Lovelace',
    roles,
    avatar: '',
    email: 'ada@example.com',
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>{children}</AuthProvider>
    </LanguageProvider>
  );
}

beforeEach(() => {
  sessionClient.getSession.mockReset();
});

describe('AuthContext.isRole', () => {
  it('is a set intersection: an employee+pm user matches both roles, is not read-only, and sees version history', async () => {
    sessionClient.getSession.mockResolvedValue({
      user: makeUserProto([UserRoleProto.EMPLOYEE, UserRoleProto.PM]),
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user.roles).toEqual(['employee', 'pm']));

    expect(result.current.isRole('employee')).toBe(true);
    expect(result.current.isRole('pm')).toBe(true);
    expect(result.current.isRole('bl')).toBe(false);
    expect(result.current.isRole(['bl', 'sales'])).toBe(false);
    expect(result.current.isRole(['pm', 'bl'])).toBe(true);

    // The exact case single-role tests never covered: being an employee no
    // longer implies read-only planner access or hidden version history.
    expect(hasPlanningAccess(result.current.isRole)).toBe(true);
  });

  it('is false for a role the user does not hold', async () => {
    sessionClient.getSession.mockResolvedValue({ user: makeUserProto([UserRoleProto.SALES]) });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user.roles).toEqual(['sales']));

    expect(result.current.isRole('pm')).toBe(false);
    expect(hasPlanningAccess(result.current.isRole)).toBe(false);
  });

  it('toggleDevRole starts from the real roles and adds/removes locally; clearDevRoleOverride resets it', async () => {
    sessionClient.getSession.mockResolvedValue({ user: makeUserProto([UserRoleProto.EMPLOYEE]) });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.user.roles).toEqual(['employee']));

    act(() => result.current.toggleDevRole('pm'));
    await waitFor(() => expect(result.current.user.roles).toEqual(['employee', 'pm']));
    expect(result.current.isRole('pm')).toBe(true);

    act(() => result.current.toggleDevRole('employee'));
    await waitFor(() => expect(result.current.user.roles).toEqual(['pm']));
    expect(result.current.isRole('employee')).toBe(false);

    act(() => result.current.clearDevRoleOverride());
    await waitFor(() => expect(result.current.user.roles).toEqual(['employee']));
  });
});
