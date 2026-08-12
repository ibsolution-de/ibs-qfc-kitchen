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
});
