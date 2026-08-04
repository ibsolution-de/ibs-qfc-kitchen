import React, { useEffect, useState } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { Save } from 'lucide-react';

import type { UserRole } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../ui/Toast';
import { useAppSettings } from '../../api/useAdmin';
import { PageHeader } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { FormField, SelectInput, inputClass } from '../ui/FormField';
import { AsciiSpinner } from '../ui/AsciiSpinner';

// `admin` is deliberately absent: the server rejects it as a default role
// (same rule as QFC_DEFAULT_ROLE), so offering it would be a guaranteed
// invalid_argument round-trip.
const SELECTABLE_ROLES: UserRole[] = ['employee', 'pm', 'bl', 'sales'];

/** Maps a Connect error from the settings RPCs to a user-facing message, falling back to the generic save error. */
function settingsErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ConnectError) {
    switch (err.code) {
      case Code.InvalidArgument:
        return t('admin.setup.errorInvalidSettings');
      case Code.PermissionDenied:
        return t('admin.errorPermissionDenied');
      default:
        break;
    }
  }
  return t('common.saveError');
}

/** Small badge marking a value that comes from the DB override rather than the startup environment. */
const OverrideBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="ml-2 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md font-medium align-middle">
    {label}
  </span>
);

/**
 * Form for the runtime-editable application settings (`AdminService`).
 * Shows the effective values alongside the startup-environment values so an
 * admin can see exactly what a DB override shadows. Emails are entered one
 * per line and normalized (trimmed, lowercased, blanks dropped) before
 * saving - the server stores them lowercase, so normalizing client-side
 * keeps the round-trip idempotent.
 */
export const ApplicationSetup: React.FC = () => {
  const { t } = useLanguage();
  const { success, error: toastError } = useToast();
  const { settings, status, refresh, save } = useAppSettings();

  const [defaultRole, setDefaultRole] = useState<UserRole>('employee');
  const [emailsText, setEmailsText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Populate the form once the settings load, and re-sync after each save's
  // refetch so the form always mirrors the server's effective values. No
  // background polling happens here, so this cannot clobber an edit in
  // progress.
  useEffect(() => {
    if (!settings) return;
    setDefaultRole(settings.defaultRole);
    setEmailsText(settings.adminEmails.join('\n'));
  }, [settings]);

  const handleSave = () => {
    const adminEmails = emailsText
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line.length > 0);
    // Cheap client-side guard only - the server remains the authority on
    // what a valid address is; this just saves an obvious round-trip.
    if (adminEmails.some(email => !email.includes('@'))) {
      setValidationError(t('admin.setup.validationInvalidEmail'));
      return;
    }
    setValidationError(null);
    setSaving(true);
    save({ defaultRole, adminEmails })
      .then(() => success(t('toast.settingsSaved')))
      .catch((err: unknown) => toastError(settingsErrorMessage(err, t)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="h-full overflow-auto bg-gray-50/50 p-6 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8">
        <PageHeader title={t('admin.setup.title')} subtitle={t('admin.setup.subtitle')} />

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

        {status === 'ready' && settings && (
          <div className="bg-white rounded-xl border border-charcoal-200 shadow-sm p-6 space-y-6">
            <FormField label={t('admin.setup.defaultRoleLabel')} htmlFor="settingsDefaultRole">
              <div className="flex items-center">
                <SelectInput
                  id="settingsDefaultRole"
                  value={defaultRole}
                  onChange={e => setDefaultRole(e.target.value as UserRole)}
                  className="max-w-xs"
                >
                  {SELECTABLE_ROLES.map(role => (
                    <option key={role} value={role}>{t(`roles.${role}`)}</option>
                  ))}
                </SelectInput>
                {settings.defaultRoleOverridden && <OverrideBadge label={t('admin.setup.overrideBadge')} />}
              </div>
              <p className="mt-1.5 text-xs text-charcoal-500">
                {t('admin.setup.environmentLabel')}: {t(`roles.${settings.environment.defaultRole}`)}
              </p>
            </FormField>

            <FormField label={t('admin.setup.adminEmailsLabel')} htmlFor="settingsAdminEmails">
              <div className="flex items-start">
                <textarea
                  id="settingsAdminEmails"
                  rows={4}
                  className={`${inputClass} resize-none font-mono`}
                  value={emailsText}
                  onChange={e => setEmailsText(e.target.value)}
                  placeholder={t('admin.setup.adminEmailsPlaceholder')}
                />
                {settings.adminEmailsOverridden && <OverrideBadge label={t('admin.setup.overrideBadge')} />}
              </div>
              <p className="mt-1.5 text-xs text-charcoal-500">
                {t('admin.setup.environmentLabel')}: {settings.environment.adminEmails.length > 0
                  ? settings.environment.adminEmails.join(', ')
                  : t('admin.setup.environmentEmpty')}
              </p>
            </FormField>

            <p className="text-xs text-charcoal-500 bg-charcoal-50 border border-charcoal-100 rounded-lg p-3">
              {t('admin.setup.firstSeenHint')}
            </p>

            {validationError && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">{validationError}</div>
            )}

            <div className="flex justify-end pt-2 border-t border-charcoal-100">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                <Save className="w-4 h-4" /> {saving ? t('admin.setup.saving') : t('admin.setup.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
