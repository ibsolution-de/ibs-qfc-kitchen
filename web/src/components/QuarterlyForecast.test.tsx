import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QuarterlyForecast } from './QuarterlyForecast';
import { LanguageProvider } from '../contexts/LanguageContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { Project, QuarterData } from '../types';

// jsdom in this test environment doesn't provide `localStorage` (Node's own
// experimental global shadows it as `undefined`), but LanguageProvider and
// SettingsProvider - both required to mount QuarterlyForecast - read/write
// it on mount. Polyfill a minimal in-memory Storage so those providers
// don't crash; this is scoped to this file only.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}
if (typeof window.localStorage === 'undefined') {
  vi.stubGlobal('localStorage', new MemoryStorage());
}

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Project One',
  client: 'Client A',
  color: 'blue',
  status: 'opportunity',
  volume: 20,
  probability: 70,
  budget: '',
  ...overrides,
});

// Deliberately doesn't match the "QX YYYY" pattern `computeQuarterCapacity`
// looks for, so it returns the quarter unchanged - no need to populate
// employees/absences/holidays/assignments to get a stable fixture.
const makeQuarter = (mustWinOpportunities: Project[]): QuarterData => ({
  id: 'q1',
  name: 'Test Quarter',
  months: ['Jan', 'Feb', 'Mar'],
  totalCapacity: [10, 10, 10],
  runningProjects: [],
  mustWinOpportunities,
  alternativeOpportunities: [],
  notes: '',
});

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>
    <SettingsProvider>{children}</SettingsProvider>
  </LanguageProvider>
);

type UpdateForecastFn = (quarterId: string, type: 'mustWin' | 'alternative', projects: Project[]) => void;

const renderForecast = (data: QuarterData[], onUpdateForecast: UpdateForecastFn) =>
  render(
    <Providers>
      <QuarterlyForecast
        data={data}
        allProjects={data.flatMap(q => q.mustWinOpportunities)}
        assignments={[]}
        employees={[]}
        absences={[]}
        holidays={[]}
        onUpdateForecast={onUpdateForecast}
      />
    </Providers>
  );

describe('QuarterlyForecast budget field', () => {
  it('collapses several keystrokes into exactly one update call on commit, with the correct value', () => {
    const project = makeProject();
    const onUpdateForecast = vi.fn();
    renderForecast([makeQuarter([project])], onUpdateForecast);

    const input = screen.getByRole('textbox', { name: 'Budget' }) as HTMLInputElement;

    // Typing stays local (responsive echo) - nothing is sent per keystroke.
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.change(input, { target: { value: '50k' } });

    expect(input.value).toBe('50k');
    expect(onUpdateForecast).not.toHaveBeenCalled();

    // Only the commit (blur) sends exactly one update, carrying the settled value.
    fireEvent.blur(input);

    expect(onUpdateForecast).toHaveBeenCalledTimes(1);
    expect(onUpdateForecast).toHaveBeenCalledWith('q1', 'mustWin', [{ ...project, budget: '50k' }]);
  });

  it('reflects an external prop change in the field while no local edit is in flight', () => {
    const project = makeProject({ budget: '10k' });
    const onUpdateForecast = vi.fn();
    const { rerender } = renderForecast([makeQuarter([project])], onUpdateForecast);

    expect(screen.getByRole('textbox', { name: 'Budget' })).toHaveValue('10k');

    // Simulate another client's edit arriving over the live stream: the
    // `data` prop changes without any local typing having happened.
    const updatedProject = { ...project, budget: '20k' };
    rerender(
      <Providers>
        <QuarterlyForecast
          data={[makeQuarter([updatedProject])]}
          allProjects={[updatedProject]}
          assignments={[]}
          employees={[]}
          absences={[]}
          holidays={[]}
          onUpdateForecast={onUpdateForecast}
        />
      </Providers>
    );

    expect(screen.getByRole('textbox', { name: 'Budget' })).toHaveValue('20k');
    expect(onUpdateForecast).not.toHaveBeenCalled();
  });

  it('does not clobber an in-flight local edit with an external prop change', () => {
    const project = makeProject({ budget: '10k' });
    const onUpdateForecast = vi.fn();
    const { rerender } = renderForecast([makeQuarter([project])], onUpdateForecast);

    const input = screen.getByRole('textbox', { name: 'Budget' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15k (typing...)' } });

    // An external update for the same project arrives while the user is
    // still mid-edit; the local draft must win until it commits.
    const externalProject = { ...project, budget: '999' };
    rerender(
      <Providers>
        <QuarterlyForecast
          data={[makeQuarter([externalProject])]}
          allProjects={[externalProject]}
          assignments={[]}
          employees={[]}
          absences={[]}
          holidays={[]}
          onUpdateForecast={onUpdateForecast}
        />
      </Providers>
    );

    expect(screen.getByRole('textbox', { name: 'Budget' })).toHaveValue('15k (typing...)');
  });
});
