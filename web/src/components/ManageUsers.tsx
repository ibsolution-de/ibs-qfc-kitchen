import React, { useCallback } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { Mail, ShieldCheck, Trash2, Edit2, UserPlus, Link2 } from 'lucide-react';

import { Employee, UserRole } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from './ui/Toast';
import { useUsers } from '../api/useUsers';
import type { AdminUser } from '../api/adapters';
import { useCrudForm } from '../hooks/useCrudForm';
import { PageHeader } from './ui/PageHeader';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { FormField, TextInput, SelectInput } from './ui/FormField';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AsciiSpinner } from './ui/AsciiSpinner';

interface ManageUsersProps {
  employees: Employee[];
}

const ALL_ROLES: UserRole[] = ['employee', 'pm', 'bl', 'sales', 'admin'];

/** Maps a Connect error from an AdminService RPC to a user-facing message, falling back to the generic save error. */
function adminErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ConnectError) {
    switch (err.code) {
      case Code.InvalidArgument:
        return t('admin.errorInvalidRoles');
      case Code.FailedPrecondition:
        return t('admin.errorDeleteGuard');
      case Code.NotFound:
        return t('admin.errorUserNotFound');
      case Code.PermissionDenied:
        return t('admin.errorPermissionDenied');
      default:
        break;
    }
  }
  return t('common.saveError');
}

export const ManageUsers: React.FC<ManageUsersProps> = ({ employees }) => {
  const { t } = useLanguage();
  const { success, error: toastError } = useToast();
  const { users, status, refresh, saveUser, deleteUser } = useUsers();

  const makeDefaults = useCallback(
    (): Partial<AdminUser> => ({
      email: '',
      // The default role every user starts with (mirrors QFC_DEFAULT_ROLE);
      // the admin adds pm/bl/sales/admin on top as needed.
      roles: ['employee'],
      employeeId: undefined,
    }),
    []
  );

  const handleAfterSave = useCallback(
    (user: AdminUser) => {
      saveUser(user.email, user.roles, user.employeeId)
        .then(() => success(t('toast.userSaved')))
        .catch((err: unknown) => toastError(adminErrorMessage(err, t)));
    },
    [saveUser, success, toastError, t]
  );

  const handleAfterDelete = useCallback(
    (user: AdminUser) => {
      deleteUser(user.email)
        .then(() => success(t('toast.userDeleted')))
        .catch((err: unknown) => toastError(adminErrorMessage(err, t)));
    },
    [deleteUser, success, toastError, t]
  );

  const {
    isModalOpen,
    editingId,
    formData,
    setFormData,
    openAdd,
    openEdit,
    closeModal,
    handleSubmit,
    requestDelete,
    confirmDelete,
    deleteTarget,
    cancelDelete,
    validationError,
  } = useCrudForm<AdminUser>({
    items: users,
    // No-op: `users` is server state owned by `useUsers`. `onAfterSave`/`onAfterDelete`
    // below perform the actual mutation, and `useUsers` refetches internally afterwards.
    onUpdate: () => {},
    makeDefaults,
    validate: useCallback(
      (data) => {
        if (!data.email?.trim()) {
          return t('admin.validation.emailRequired');
        }
        if (!data.roles || data.roles.length === 0) {
          return t('admin.validation.roleRequired');
        }
        return null;
      },
      [t]
    ),
    onAfterSave: handleAfterSave,
    onAfterDelete: handleAfterDelete,
  });

  const buildUser = (data: Partial<AdminUser>, editingId: string | null): AdminUser => {
    const email = (data.email ?? '').trim();
    return {
      id: editingId ?? '',
      name: data.name ?? email,
      avatar: data.avatar ?? '',
      roles: data.roles ?? [],
      employeeId: data.employeeId,
      email,
    };
  };

  const toggleRole = (role: UserRole) => {
    setFormData(prev => {
      const roles = prev.roles ?? [];
      return {
        ...prev,
        roles: roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role],
      };
    });
  };

  const employeeName = (employeeId: string | undefined): string | undefined =>
    employeeId ? employees.find(employee => employee.id === employeeId)?.name : undefined;

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        <PageHeader
          title={t('admin.title')}
          subtitle={t('admin.subtitle')}
          actions={
            <Button onClick={openAdd} className="gap-2">
              <UserPlus className="w-4 h-4" /> {t('admin.addUser')}
            </Button>
          }
        />

        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 text-charcoal-500 gap-2">
            <AsciiSpinner className="text-xl" />
            <span className="text-sm font-medium">{t('common.loading')}</span>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-16 space-y-3">
            <p className="text-sm text-red-600">{t('common.loadError')}</p>
            <Button variant="secondary" onClick={() => void refresh()}>{t('admin.retry')}</Button>
          </div>
        )}

        {status === 'ready' && (
          <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm divide-y divide-charcoal-100">
            {users.length === 0 && (
              <div className="p-8 text-center text-sm text-charcoal-400 italic">{t('admin.noUsers')}</div>
            )}
            {users.map(user => (
              <div key={user.email} className="p-4 flex items-center gap-4 hover:bg-charcoal-50/50 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-charcoal-900">
                    <Mail className="w-3.5 h-3.5 text-charcoal-400 flex-shrink-0" />
                    <span className="truncate">{user.email}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {user.roles.map(role => (
                      <span
                        key={role}
                        className="px-2 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 text-xs rounded-md font-medium"
                      >
                        {t(`roles.${role}`)}
                      </span>
                    ))}
                  </div>
                  {employeeName(user.employeeId) && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-charcoal-500">
                      <Link2 className="w-3 h-3" /> {employeeName(user.employeeId)}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(user)}
                    className="p-1.5 text-charcoal-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title={t('admin.editUser')}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => requestDelete(user.id)}
                    className="p-1.5 text-charcoal-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title={t('admin.deleteUser')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('admin.editUser') : t('admin.addUser')}
        size="md"
      >
        <form onSubmit={handleSubmit(buildUser)} className="space-y-5">
          <FormField label={t('admin.email')} htmlFor="userEmail">
            <TextInput
              id="userEmail"
              type="email"
              required
              disabled={editingId !== null}
              value={formData.email ?? ''}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              placeholder={t('admin.emailPlaceholder')}
            />
          </FormField>

          <FormField label={t('admin.roles')} htmlFor="userRoles">
            <div id="userRoles" className="flex flex-wrap gap-2">
              {ALL_ROLES.map(role => {
                const checked = (formData.roles ?? []).includes(role);
                return (
                  <button
                    type="button"
                    key={role}
                    onClick={() => toggleRole(role)}
                    aria-pressed={checked}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors flex items-center gap-1.5
                      ${checked
                        ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                        : 'bg-white border-charcoal-200 text-charcoal-600 hover:bg-charcoal-50'
                      }`}
                  >
                    {role === 'admin' && <ShieldCheck className="w-3.5 h-3.5" />}
                    {t(`roles.${role}`)}
                  </button>
                );
              })}
            </div>
          </FormField>

          <FormField label={t('admin.linkedEmployee')} htmlFor="userEmployeeId">
            <SelectInput
              id="userEmployeeId"
              value={formData.employeeId ?? ''}
              onChange={e => setFormData({ ...formData, employeeId: e.target.value || undefined })}
            >
              <option value="">{t('admin.noEmployeeLink')}</option>
              {employees.map(employee => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </SelectInput>
          </FormField>

          {validationError && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{validationError}</div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-charcoal-100">
            <Button type="button" variant="ghost" onClick={closeModal}>{t('admin.cancel')}</Button>
            <Button type="submit">{t('admin.saveUser')}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('admin.deleteTitle')}
        message={t('admin.confirmDelete')}
        confirmLabel={t('admin.delete')}
        cancelLabel={t('admin.cancel')}
        destructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
};
