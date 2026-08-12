import {
  format,
  eachDayOfInterval,
  endOfMonth,
  isWeekend,
  startOfQuarter,
  addMonths,
} from 'date-fns';
import type {
  QuarterData,
  Project,
  Assignment,
  Employee,
  Absence,
  PublicHoliday,
} from '../types';

/**
 * Parses a quarter name looking for a "QX YYYY" pattern.
 *
 * Returns the 1-based quarter number and full year, or null if no
 * recognizable quarter identity is found.
 */
export function parseQuarterName(name: string): { quarter: number; year: number } | null {
  const match = /Q(\d)\s+(\d{4})(?!\d)/.exec(name);
  if (!match) return null;

  const quarter = parseInt(match[1]!, 10);
  const year = parseInt(match[2]!, 10);

  if (quarter < 1 || quarter > 4 || Number.isNaN(year)) return null;

  return { quarter, year };
}

/**
 * Builds a rolling window of `count` quarters starting at the quarter
 * containing `today`, backed by whatever `persisted` rows already exist for
 * those quarters.
 *
 * Persisted rows are matched to a window slot by their *parsed* name
 * (quarter + year), not by id - real persisted rows carry server-assigned
 * ids and must keep them. Window slots with no persisted match are
 * synthesized with a deterministic id (`q<year>-Q<n>`), so writing one back
 * to the backend is idempotent (upsert by `(version_id, id)` never creates a
 * duplicate row for the same quarter).
 *
 * Any persisted row that falls outside the window (or whose name can't be
 * parsed at all) is preserved rather than dropped, and the full result is
 * returned in chronological order.
 */
export function mergeForecastQuarters(
  persisted: QuarterData[],
  today: Date,
  count = 4
): QuarterData[] {
  const windowStart = startOfQuarter(today);

  const windowSlots = Array.from({ length: count }, (_, i) => {
    const slotStart = startOfQuarter(addMonths(windowStart, i * 3));
    const quarter = Math.floor(slotStart.getMonth() / 3) + 1;
    const year = slotStart.getFullYear();
    return { quarter, year, name: `Q${quarter} ${year}`, id: `q${year}-Q${quarter}` };
  });

  const usedPersistedIndices = new Set<number>();

  const windowQuarters: QuarterData[] = windowSlots.map(slot => {
    const matchIndex = persisted.findIndex((q, idx) => {
      if (usedPersistedIndices.has(idx)) return false;
      const parsed = parseQuarterName(q.name);
      return parsed !== null && parsed.quarter === slot.quarter && parsed.year === slot.year;
    });

    if (matchIndex !== -1) {
      usedPersistedIndices.add(matchIndex);
      return persisted[matchIndex]!;
    }

    return {
      id: slot.id,
      name: slot.name,
      months: [],
      totalCapacity: [],
      runningProjects: [],
      mustWinOpportunities: [],
      alternativeOpportunities: [],
      notes: '',
    };
  });

  const leftover = persisted.filter((_, idx) => !usedPersistedIndices.has(idx));

  // Sort chronologically by parsed quarter+year; rows with an unparseable
  // name sort last (in their original relative order) instead of being lost.
  const sortKey = (q: QuarterData): number => {
    const parsed = parseQuarterName(q.name);
    return parsed ? parsed.year * 4 + (parsed.quarter - 1) : Number.POSITIVE_INFINITY;
  };

  return [...windowQuarters, ...leftover].sort((a, b) => sortKey(a) - sortKey(b));
}

export interface QuarterCapacityInput {
  /** Quarter to compute capacity for. */
  quarter: QuarterData;
  /** Employees to include in capacity calculation. */
  employees: Employee[];
  /** Absences to exclude from capacity. */
  absences: Absence[];
  /** Public holidays to exclude from capacity. */
  holidays: PublicHoliday[];
  /** Project assignments used to derive running projects. */
  assignments: Assignment[];
  /** Full project catalog used to look up running project details. */
  allProjects: Project[];
}

/**
 * Computes the real quarter capacity from employees, absences, holidays and
 * assignments.
 *
 * The returned object is a shallow copy of the input quarter with
 * `totalCapacity` and `runningProjects` populated. If the quarter name cannot
 * be parsed, the input quarter is returned unchanged.
 */
export function computeQuarterCapacity(input: QuarterCapacityInput): QuarterData {
  const { quarter, employees, absences, holidays, assignments, allProjects } = input;

  const parsed = parseQuarterName(quarter.name);
  if (!parsed) return quarter;

  const { quarter: quarterNum, year } = parsed;
  const startMonth = (quarterNum - 1) * 3;
  const qStart = new Date(year, startMonth, 1);
  const qEnd = endOfMonth(new Date(year, startMonth + 2, 1));
  const qStartStr = format(qStart, 'yyyy-MM-dd');
  const qEndStr = format(qEnd, 'yyyy-MM-dd');

  const newTotalCapacity: number[] = [];

  for (let i = 0; i < 3; i++) {
    const mStart = new Date(year, startMonth + i, 1);
    const mEnd = endOfMonth(mStart);
    const days = eachDayOfInterval({ start: mStart, end: mEnd });

    let cap = 0;
    for (const emp of employees) {
      const empHolidays = holidays.filter(
        h => h.location === 'ALL' || h.location === emp.location
      );
      const empAbsences = absences.filter(a => a.employeeId === emp.id);

      for (const d of days) {
        if (isWeekend(d)) continue;
        const dStr = format(d, 'yyyy-MM-dd');
        if (empHolidays.some(h => h.date === dStr)) continue;
        if (empAbsences.some(a => a.date === dStr)) continue;

        cap += emp.availability / 100;
      }
    }
    newTotalCapacity.push(Math.round(cap));
  }

  const relevantAssignments = assignments.filter(
    a => a.date >= qStartStr && a.date <= qEndStr
  );

  const projMap = new Map<string, number>();
  for (const a of relevantAssignments) {
    const val = a.allocation || 1;
    projMap.set(a.projectId, (projMap.get(a.projectId) || 0) + val);
  }

  const runningProjects: Project[] = [];
  for (const [pid, volume] of projMap.entries()) {
    const p = allProjects.find(px => px.id === pid);
    if (p) {
      runningProjects.push({ ...p, volume: Math.round(volume * 10) / 10 });
    }
  }

  return {
    ...quarter,
    totalCapacity: newTotalCapacity,
    runningProjects,
  };
}

export interface CapacityMetrics {
  /** Sum of monthly total capacities. */
  totalCap: number;
  /** Sum of running project volumes. */
  assignedDays: number;
  /** Available capacity after running projects, clamped to non-negative. */
  availableAfterRunning: number;
  /** Sum of opportunity volumes. */
  opportunityDays: number;
  /** Net available after all opportunities (may be negative). */
  finalAvailable: number;
}

/**
 * Computes aggregate capacity metrics from a quarter with already-populated
 * total capacity and running projects.
 */
export function calculateCapacityMetrics(q: QuarterData): CapacityMetrics {
  const totalCap = q.totalCapacity.reduce((a, b) => a + b, 0);
  const assignedDays = q.runningProjects.reduce((acc, p) => acc + (p.volume || 60), 0);

  const rawAvailable = totalCap - assignedDays;
  const availableAfterRunning = Math.max(0, rawAvailable);

  const opportunityDays = [
    ...q.mustWinOpportunities,
    ...q.alternativeOpportunities,
  ].reduce((acc, p) => acc + (p.volume || 0), 0);

  const finalAvailable = rawAvailable - opportunityDays;

  return {
    totalCap,
    assignedDays,
    availableAfterRunning,
    opportunityDays,
    finalAvailable,
  };
}

export interface MonthlyBreakdownItem {
  /** Month name. */
  month: string;
  /** Total capacity for the month. */
  total: number;
  /** Available capacity after running projects, clamped to non-negative. */
  available: number;
  /** Raw available capacity before clamping (may be negative). */
  rawAvailable: number;
  /** Net available after opportunities (may be negative). */
  optimistic: number;
}

/**
 * Distributes quarter-level capacity metrics across the three months.
 *
 * Returns both the clamped display value and the raw unclamped value so callers
 * can surface over-capacity months.
 */
export function computeMonthlyBreakdown(
  q: QuarterData,
  metrics: CapacityMetrics
): MonthlyBreakdownItem[] {
  if (metrics.totalCap === 0) {
    return q.months.map((month, i) => ({
      month,
      total: q.totalCapacity[i] ?? 0,
      available: 0,
      rawAvailable: 0,
      optimistic: 0,
    }));
  }

  return q.months.map((month, index) => {
    const total = q.totalCapacity[index] ?? 0;
    const ratio = total / metrics.totalCap;
    const assigned = Math.round(metrics.assignedDays * ratio);
    const opportunities = Math.round(metrics.opportunityDays * ratio);

    const rawAvailable = total - assigned;
    const available = Math.max(0, rawAvailable);
    const optimistic = rawAvailable - opportunities;

    return { month, total, available, rawAvailable, optimistic };
  });
}

export interface SimResult {
  /** Low volume percentile (P10). */
  p10: number;
  /** Median volume percentile (P50). */
  p50: number;
  /** High volume percentile (P90). */
  p90: number;
  /** Expected (mean) volume. */
  expected: number;
  /** Base available capacity used for overload comparison. */
  baseCapacity: number;
  /** Histogram of opportunity volumes with raw bin counts. */
  histogram: { binStart: number; count: number }[];
  /** Percentage of iterations that exceeded base capacity. */
  overloadProbability: number;
  /** Maximum observed volume. */
  maxVol: number;
  /** Minimum observed volume. */
  minVol: number;
}

/**
 * Runs a 2000-iteration Monte Carlo simulation of opportunity volume.
 *
 * The random number generator can be injected for deterministic results in
 * tests. Defaults to `Math.random`.
 */
export function runMonteCarloSimulation(
  quarter: QuarterData,
  rng: () => number = Math.random
): SimResult {
  const metrics = calculateCapacityMetrics(quarter);
  const baseAvailable = metrics.availableAfterRunning;

  const opportunities = [
    ...quarter.mustWinOpportunities.map(p => ({
      ...p,
      probability: p.probability ?? 70,
    })),
    ...quarter.alternativeOpportunities.map(p => ({
      ...p,
      probability: p.probability ?? 30,
    })),
  ];

  const iterations = 2000;
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let oppVolume = 0;
    for (const opp of opportunities) {
      const rand = rng() * 100;
      if (rand < opp.probability) {
        oppVolume += opp.volume || 0;
      }
    }
    results.push(oppVolume);
  }

  results.sort((a, b) => a - b);

  const p10Vol = results[Math.floor(iterations * 0.1)] ?? 0;
  const p50Vol = results[Math.floor(iterations * 0.5)] ?? 0;
  const p90Vol = results[Math.floor(iterations * 0.9)] ?? 0;

  const minVal = results[0] ?? 0;
  const maxVal = results[results.length - 1] ?? 0;
  const expectedVal = Math.round(results.reduce((a, b) => a + b, 0) / iterations);
  const binCount = 30;
  const binSize = (maxVal - minVal) / binCount || 1;

  const histogram = Array.from({ length: binCount }, (_, i) => ({
    binStart: Math.floor(minVal + i * binSize),
    count: 0,
  }));

  for (const val of results) {
    const binIndex = Math.min(Math.floor((val - minVal) / binSize), binCount - 1);
    histogram[binIndex]!.count++;
  }

  const overloadCount = results.filter(v => v > baseAvailable).length;
  const overloadProbability = (overloadCount / iterations) * 100;

  return {
    p10: p10Vol,
    p50: p50Vol,
    p90: p90Vol,
    expected: expectedVal,
    baseCapacity: baseAvailable,
    histogram,
    overloadProbability,
    minVol: minVal,
    maxVol: maxVal,
  };
}
