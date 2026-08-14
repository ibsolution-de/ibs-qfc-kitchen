import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FinancialOverview } from './FinancialOverview';
import { LanguageProvider } from '../contexts/LanguageContext';
import { Project, Assignment } from '../types';

// jsdom lacks ResizeObserver; the Chart adapter uses it for responsive sizing.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
  readonly contentRect = { width: 640, height: 288, x: 0, y: 0, top: 0, right: 640, bottom: 288, left: 0, toJSON: () => {} };
  readonly borderBoxSize = [];
  readonly contentBoxSize = [];
  readonly devicePixelContentBoxSize = [];
}
const win = globalThis as unknown as { ResizeObserver?: typeof RO };
if (typeof win.ResizeObserver === 'undefined') {
  win.ResizeObserver = RO;
}

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

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', client: 'Client A', color: 'blue', status: 'opportunity', volume: 10, probability: 70, budget: '100000', startDate: '2026-01-01', endDate: '2026-06-30' },
  { id: 'p2', name: 'Beta', client: 'Client B', color: 'green', status: 'active', volume: 20, probability: 90, budget: '200000', startDate: '2026-03-01', endDate: '2026-12-31' },
] as unknown as Project[];

const assignments: Assignment[] = [];

describe('FinancialOverview charts mount smoke', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders TanStack Chart SVG without crashing', () => {
    render(
      <LanguageProvider>
        <FinancialOverview projects={projects} assignments={assignments} currentDate={new Date('2026-04-01')} />
      </LanguageProvider>
    );
    const svg = document.querySelector('svg');
    expect(document.querySelector('table.sr-only')).toBeInTheDocument();
    expect(svg).toBeTruthy();
    const labeled =
      svg?.getAttribute('aria-label') ?? document.querySelector('[aria-label]')?.getAttribute('aria-label');
    expect(labeled).toBeTruthy();
  });

  it('forecasts only confirmed account budgets over their dates; projects without accounts fall back to project dates/budget', () => {
    const projectsWithAccounts: Project[] = [
      {
        id: 'pAcc',
        name: 'Gamma',
        client: 'Client C',
        color: 'purple',
        status: 'active',
        budget: '200000', // ignored while accounts exist
        startDate: '2026-04-01',
        endDate: '2026-12-31',
        accounts: [
          { id: 'a1', projectId: 'pAcc', name: 'Core', status: 'confirmed', budget: '120000', startDate: '2026-04-01', endDate: '2026-12-31' },
          { id: 'a2', projectId: 'pAcc', name: 'Optional', status: 'requested', budget: '80000', startDate: '2026-04-01', endDate: '2026-12-31' },
        ],
      },
      {
        id: 'pEst',
        name: 'Delta',
        client: 'Client D',
        color: 'gray',
        status: 'active',
        budget: '100000',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
      },
    ];

    render(
      <LanguageProvider>
        <FinancialOverview projects={projectsWithAccounts} assignments={[]} currentDate={new Date('2026-04-01')} />
      </LanguageProvider>
    );

    // Parse the sr-only chart-data table into quarter|client → revenue (rounded k).
    const byQuarterClient: Record<string, number> = {};
    document.querySelectorAll('table.sr-only tbody tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent ?? '');
      const [quarter, client, revenue] = cells;
      if (!quarter || !client) return;
      const k = Math.round(parseFloat(revenue?.replace(/[^\d.]/g, '') || '0'));
      const key = `${quarter}|${client}`;
      byQuarterClient[key] = (byQuarterClient[key] ?? 0) + k;
    });

    const totalFor = (client: string) =>
      Object.entries(byQuarterClient)
        .filter(([key]) => key.endsWith(`|${client}`))
        .reduce((sum, [, v]) => sum + v, 0);

    // Client C: only the confirmed 120k account is forecast — the requested
    // 80k account and the 200k project estimate must stay out.
    expect(totalFor('Client C')).toBeGreaterThanOrEqual(118);
    expect(totalFor('Client C')).toBeLessThanOrEqual(122);

    // Client D: no accounts → project-level fallback (100k over project dates).
    expect(totalFor('Client D')).toBeGreaterThanOrEqual(98);
    expect(totalFor('Client D')).toBeLessThanOrEqual(102);

    // The confirmed budget is distributed over the account's own date window:
    // nothing lands in Q1 2027 (account ends 2026-12-31), Q2 2026 is positive.
    expect(byQuarterClient['Q1 2027|Client C'] ?? 0).toBe(0);
    expect(byQuarterClient['Q2 2026|Client C'] ?? 0).toBeGreaterThan(0);
  });
});
