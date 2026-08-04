import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';

import { UserSchema, UserRole } from './gen/qfc/session/v1/session_pb.js';

// `useUsers.ts` must never touch the real network - mock the client layer,
// the same way `liveStore.test.tsx` mocks `teamClient`/`projectClient`/etc.
const { adminClient } = vi.hoisted(() => ({
  adminClient: {
    listUsers: vi.fn(),
    upsertUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock('./clients', () => ({ adminClient }));

import { useUsers } from './useUsers';

function makeUserProto(overrides: Partial<{ id: string; name: string; roles: UserRole[]; email: string }> = {}) {
  return create(UserSchema, {
    id: 'u1',
    name: 'Ada Lovelace',
    roles: [UserRole.PM],
    avatar: '',
    email: 'ada@example.com',
    ...overrides,
  });
}

beforeEach(() => {
  adminClient.listUsers.mockReset();
  adminClient.upsertUser.mockReset();
  adminClient.deleteUser.mockReset();
});

describe('useUsers', () => {
  it('loads the user list on mount', async () => {
    adminClient.listUsers.mockResolvedValue({ users: [makeUserProto()] });

    const { result } = renderHook(() => useUsers());

    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.users).toEqual([
      { id: 'u1', name: 'Ada Lovelace', roles: ['pm'], avatar: '', employeeId: undefined, email: 'ada@example.com' },
    ]);
    expect(result.current.error).toBeUndefined();
  });

  it('saveUser upserts then refetches the list', async () => {
    adminClient.listUsers
      .mockResolvedValueOnce({ users: [] })
      .mockResolvedValueOnce({ users: [makeUserProto({ id: 'u2', name: 'new@example.com', roles: [UserRole.EMPLOYEE], email: 'new@example.com' })] });
    adminClient.upsertUser.mockResolvedValue({
      user: makeUserProto({ id: 'u2', name: 'new@example.com', roles: [UserRole.EMPLOYEE], email: 'new@example.com' }),
    });

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.users).toEqual([]);

    await act(async () => {
      await result.current.saveUser('new@example.com', ['employee']);
    });

    expect(adminClient.upsertUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      roles: [UserRole.EMPLOYEE],
      employeeId: undefined,
    });
    // Refetched after the mutation - `listUsers` called once for the initial load, once after saving.
    expect(adminClient.listUsers).toHaveBeenCalledTimes(2);
    expect(result.current.users).toEqual([
      { id: 'u2', name: 'new@example.com', roles: ['employee'], avatar: '', employeeId: undefined, email: 'new@example.com' },
    ]);
  });

  it('deleteUser deletes then refetches the list', async () => {
    adminClient.listUsers
      .mockResolvedValueOnce({ users: [makeUserProto()] })
      .mockResolvedValueOnce({ users: [] });
    adminClient.deleteUser.mockResolvedValue({});

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.users).toHaveLength(1));

    await act(async () => {
      await result.current.deleteUser('ada@example.com');
    });

    expect(adminClient.deleteUser).toHaveBeenCalledWith({ email: 'ada@example.com' });
    expect(adminClient.listUsers).toHaveBeenCalledTimes(2);
    expect(result.current.users).toEqual([]);
  });

  it('surfaces a permission_denied failure from saveUser as a rejected promise', async () => {
    adminClient.listUsers.mockResolvedValue({ users: [] });
    adminClient.upsertUser.mockRejectedValue(new ConnectError('nope', Code.PermissionDenied));

    const { result } = renderHook(() => useUsers());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await expect(result.current.saveUser('x@example.com', ['employee'])).rejects.toThrow(/nope/);
    // A failed save must not have refetched a second time.
    expect(adminClient.listUsers).toHaveBeenCalledTimes(1);
  });

  it('records a load failure in status/error', async () => {
    adminClient.listUsers.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useUsers());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('boom');
  });
});
