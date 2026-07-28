import { describe, it, expect } from 'vitest';
import {
  parseQuarterName,
  computeQuarterCapacity,
  computeMonthlyBreakdown,
  runMonteCarloSimulation,
  calculateCapacityMetrics,
} from './forecast';
import type {
  QuarterData,
  Project,
  Employee,
  Absence,
  Assignment,
  PublicHoliday,
} from '../types';

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const baseProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p-test',
  name: 'Test Project',
  client: 'Test Client',
  color: 'blue',
  status: 'active',
  ...overrides,
});

const baseEmployee = (overrides: Partial<Employee> = {}): Employee => ({
  id: 'e-test',
  name: 'Test Employee',
  role: 'Dev',
  avatar: '',
  skills: [],
  availability: 100,
  location: 'DE',
  type: 'internal',
  ...overrides,
});

const baseQuarter = (overrides: Partial<QuarterData> = {}): QuarterData => ({
  id: 'q-test',
  name: 'Q1 2026',
  months: ['Jan', 'Feb', 'Mar'],
  totalCapacity: [0, 0, 0],
  runningProjects: [],
  mustWinOpportunities: [],
  alternativeOpportunities: [],
  notes: '',
  ...overrides,
});

describe('parseQuarterName', () => {
  it('parses QX YYYY format', () => {
    expect(parseQuarterName('Q2 2026')).toEqual({ quarter: 2, year: 2026 });
  });

  it('finds quarter identity inside a longer name', () => {
    expect(parseQuarterName('Forecast Q3 2026')).toEqual({ quarter: 3, year: 2026 });
  });

  it('returns null for non-matching input', () => {
    expect(parseQuarterName('garbage')).toBeNull();
    expect(parseQuarterName('Q2')).toBeNull();
    expect(parseQuarterName('2026 Q2')).toBeNull();
    expect(parseQuarterName('Q5 2026')).toBeNull();
  });
});

describe('computeQuarterCapacity', () => {
  it('returns the quarter unchanged when the name cannot be parsed', () => {
    const quarter = baseQuarter({ name: 'garbage' });
    const result = computeQuarterCapacity({
      quarter,
      employees: [baseEmployee()],
      absences: [],
      holidays: [],
      assignments: [],
      allProjects: [],
    });
    expect(result).toBe(quarter);
  });

  it('reduces capacity by availability, holidays, and absences', () => {
    const quarter = baseQuarter({ name: 'Q1 2026' });
    const employee = baseEmployee({ availability: 100 });
    const holiday: PublicHoliday = { date: '2026-01-01', name: 'Neujahr', location: 'DE' };
    const absence: Absence = {
      id: 'abs-test',
      employeeId: employee.id,
      date: '2026-01-02',
      type: 'vacation',
      approved: true,
    };

    const result = computeQuarterCapacity({
      quarter,
      employees: [employee],
      absences: [absence],
      holidays: [holiday],
      assignments: [],
      allProjects: [],
    });

    // Jan 2026 has 22 working days, minus 1 holiday and 1 absence = 20.
    // Feb 2026 has 20 working days.
    // Mar 2026 has 22 working days.
    expect(result.totalCapacity).toEqual([20, 20, 22]);
  });

  it('derives running projects from assignments within the quarter', () => {
    const project = baseProject({ id: 'p1' });
    const quarter = baseQuarter({ name: 'Q1 2026' });
    const assignments: Assignment[] = [
      { id: 'a1', employeeId: 'e1', projectId: 'p1', date: '2026-01-06', allocation: 1 },
      { id: 'a2', employeeId: 'e1', projectId: 'p1', date: '2026-02-10', allocation: 0.5 },
      // Outside quarter
      { id: 'a3', employeeId: 'e1', projectId: 'p1', date: '2026-04-01', allocation: 1 },
    ];

    const result = computeQuarterCapacity({
      quarter,
      employees: [baseEmployee()],
      absences: [],
      holidays: [],
      assignments,
      allProjects: [project],
    });

    expect(result.runningProjects).toHaveLength(1);
    expect(result.runningProjects[0]!.id).toBe('p1');
    expect(result.runningProjects[0]!.volume).toBe(1.5);
  });

  it('scales capacity by availability percentage', () => {
    const quarter = baseQuarter({ name: 'Q1 2026' });
    const employee = baseEmployee({ availability: 50 });

    const result = computeQuarterCapacity({
      quarter,
      employees: [employee],
      absences: [],
      holidays: [],
      assignments: [],
      allProjects: [],
    });

    // Half capacity for a quarter with 22/20/22 working days.> 10/10/11 days.
    expect(result.totalCapacity).toEqual([11, 10, 11]);
  });
});

describe('calculateCapacityMetrics', () => {
  it('clamps availableAfterRunning but keeps raw finalAvailable', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      runningProjects: [baseProject({ volume: 250 })],
      mustWinOpportunities: [baseProject({ volume: 60 })],
    });

    const metrics = calculateCapacityMetrics(quarter);

    expect(metrics.totalCap).toBe(300);
    expect(metrics.assignedDays).toBe(250);
    expect(metrics.availableAfterRunning).toBe(50);
    expect(metrics.opportunityDays).toBe(60);
    expect(metrics.finalAvailable).toBe(-10);
  });
});

describe('computeMonthlyBreakdown', () => {
  it('distributes values so monthly sums equal quarter totals', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      runningProjects: [baseProject({ volume: 330 })],
      mustWinOpportunities: [baseProject({ volume: 60 })],
    });

    const metrics = calculateCapacityMetrics(quarter);
    const breakdown = computeMonthlyBreakdown(quarter, metrics);

    const totalCapacity = breakdown.reduce((sum, m) => sum + m.total, 0);
    expect(totalCapacity).toBe(metrics.totalCap);

    const totalAssigned = breakdown.reduce((sum, m) => sum + (m.total - m.rawAvailable), 0);
    expect(totalAssigned).toBe(metrics.assignedDays);

    const totalOpportunities = breakdown.reduce(
      (sum, m) => sum + (m.rawAvailable - m.optimistic),
      0
    );
    expect(totalOpportunities).toBe(metrics.opportunityDays);
  });

  it('surfaces negative rawAvailable while keeping available clamped', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      runningProjects: [baseProject({ volume: 330 })],
    });

    const metrics = calculateCapacityMetrics(quarter);
    const breakdown = computeMonthlyBreakdown(quarter, metrics);

    expect(breakdown.every(m => m.available >= 0)).toBe(true);
    expect(breakdown.every(m => m.rawAvailable < 0)).toBe(true);
  });

  it('returns zeros when total capacity is zero', () => {
    const quarter = baseQuarter({ totalCapacity: [0, 0, 0] });
    const metrics = calculateCapacityMetrics(quarter);
    const breakdown = computeMonthlyBreakdown(quarter, metrics);

    expect(breakdown.every(m => m.total === 0 && m.available === 0)).toBe(true);
  });
});

describe('runMonteCarloSimulation', () => {
  it('is deterministic with a seeded rng', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 50 })],
    });

    const result1 = runMonteCarloSimulation(quarter, mulberry32(12345));
    const result2 = runMonteCarloSimulation(quarter, mulberry32(12345));

    expect(result1).toEqual(result2);
  });

  it('has ordered percentiles', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 50 })],
    });

    const result = runMonteCarloSimulation(quarter, mulberry32(12345));

    expect(result.p10).toBeLessThanOrEqual(result.p50);
    expect(result.p50).toBeLessThanOrEqual(result.p90);
  });

  it('histogram bin counts sum to the number of iterations', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [
        baseProject({ volume: 50, probability: 50 }),
        baseProject({ volume: 30, probability: 30 }),
      ],
    });

    const result = runMonteCarloSimulation(quarter, mulberry32(12345));
    const totalCount = result.histogram.reduce((sum, b) => sum + b.count, 0);

    expect(totalCount).toBe(2000);
  });

  it('probability 0 never contributes', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 0 })],
    });

    const result = runMonteCarloSimulation(quarter, Math.random);

    expect(result.minVol).toBe(0);
    expect(result.maxVol).toBe(0);
    expect(result.p50).toBe(0);
  });

  it('probability 100 always contributes', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 100 })],
    });

    const result = runMonteCarloSimulation(quarter, Math.random);

    expect(result.minVol).toBe(50);
    expect(result.maxVol).toBe(50);
    expect(result.p50).toBe(50);
  });

  it('reports overload probability when demand exceeds capacity', () => {
    const quarter = baseQuarter({
      totalCapacity: [10, 10, 10],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 100 })],
    });

    const result = runMonteCarloSimulation(quarter, Math.random);

    expect(result.baseCapacity).toBe(30);
    expect(result.overloadProbability).toBe(100);
  });

  it('does not return the raw iterations array', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [baseProject({ volume: 50, probability: 50 })],
    });

    const result = runMonteCarloSimulation(quarter, mulberry32(12345));

    expect('iterations' in result).toBe(false);
  });

  it('returns an expected mean within the observed range', () => {
    const quarter = baseQuarter({
      totalCapacity: [100, 100, 100],
      mustWinOpportunities: [
        baseProject({ volume: 50, probability: 50 }),
        baseProject({ volume: 30, probability: 30 }),
      ],
    });

    const result = runMonteCarloSimulation(quarter, mulberry32(12345));

    expect(typeof result.expected).toBe('number');
    expect(result.expected).toBeGreaterThanOrEqual(result.minVol);
    expect(result.expected).toBeLessThanOrEqual(result.maxVol);
  });
});
