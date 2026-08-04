import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock the client layer (same approach as useUsers.test.ts) so the component
// exercises the real `useSystemStatus` hook, including the bigint->number
// mapping.
const { adminClient } = vi.hoisted(() => ({
  adminClient: {
    getSystemStatus: vi.fn(),
  },
}));

vi.mock('../../api/clients', () => ({ adminClient }));

import { SystemStatus } from './SystemStatus';

const HOUR_MS = 3600 * 1000;

function makeStatusResponse(devUserMode = true) {
  return {
    status: {
      serverStartedAtMillis: 1000n,
      // 26 hours of uptime -> rendered as "1d 2h".
      serverTimeMillis: BigInt(1000 + 26 * HOUR_MS),
      version: '0.4.2',
      dbPath: '/data/qfc.db',
      dbSizeBytes: BigInt(5 * 1024 * 1024),
      devUserMode,
      activeWatchSubscriptions: 3n,
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
      changeLog: {
        rows: 500n,
        oldestSeq: 1n,
        newestSeq: 500n,
        retentionRows: 1000n,
      },
    },
  };
}

const renderPage = () =>
  render(
    <LanguageProvider>
      <SystemStatus />
    </LanguageProvider>
  );

beforeEach(() => {
  adminClient.getSystemStatus.mockReset();
  adminClient.getSystemStatus.mockResolvedValue(makeStatusResponse());
});

describe('SystemStatus', () => {
  it('renders the status cards from the polled snapshot', async () => {
    renderPage();

    expect(await screen.findByText('0.4.2')).toBeInTheDocument();
    expect(screen.getByText('1d 2h')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText('/data/qfc.db')).toBeInTheDocument();
    // Entity grid renders the counts as plain numbers (bigint mapped away).
    expect(screen.getByText('Employees')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/1 – 500/)).toBeInTheDocument();
  });

  it('warns prominently when dev-user mode is active, and stays quiet otherwise', async () => {
    const { unmount } = renderPage();

    expect(
      await screen.findByText('Dev-user mode is active (QFC_DEV_USER) - never enable this in production.')
    ).toBeInTheDocument();

    unmount();
    adminClient.getSystemStatus.mockResolvedValue(makeStatusResponse(false));
    renderPage();

    expect(await screen.findByText('0.4.2')).toBeInTheDocument();
    expect(
      screen.queryByText('Dev-user mode is active (QFC_DEV_USER) - never enable this in production.')
    ).not.toBeInTheDocument();
  });

  it('fills the retention bar by rows / retention cap', async () => {
    renderPage();

    // 500 rows of a 1000-row cap -> 50%.
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar.firstChild).toHaveStyle({ width: '50%' });
  });
});
