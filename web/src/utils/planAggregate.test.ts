import { describe, it, expect } from 'vitest';
import {
  SYSTEM_OWNER,
  latestVersionPerOwner,
  currentPlanAssignments,
  currentPlanAbsences,
  ownerHasPlan,
  isLatestOfOwner,
  canEditVersion,
} from './planAggregate';
import type { PlanVersion, Assignment, Absence } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVersion(id: string, owner: string, createdAt: number, overrides: Partial<PlanVersion> = {}): PlanVersion {
  return {
    id,
    name: `Version ${id}`,
    createdAt,
    owner,
    ownerName: owner === SYSTEM_OWNER ? 'System' : owner,
    assignments: [],
    absences: [],
    forecastData: [],
    ...overrides,
  };
}

const assignment = (id: string, projectId: string): Assignment => ({
  id,
  employeeId: 'e1',
  projectId,
  date: '2026-01-05',
  allocation: 0.5,
});

const absence = (id: string): Absence => ({
  id,
  employeeId: 'e1',
  date: '2026-01-05',
  type: 'vacation',
  approved: true,
});

// ---------------------------------------------------------------------------
// latestVersionPerOwner
// ---------------------------------------------------------------------------

describe('latestVersionPerOwner', () => {
  it('drops system-owned versions from the aggregate', () => {
    const versions = [
      makeVersion('v1', SYSTEM_OWNER, 100),
      makeVersion('v2', 'pm@example.com', 200),
      makeVersion('v3', SYSTEM_OWNER, 300),
    ];
    const latest = latestVersionPerOwner(versions);
    expect(latest.map(v => v.id)).toEqual(['v2']);
  });

  it('returns the newest version per owner even when createdAt is interleaved across owners', () => {
    const versions = [
      makeVersion('v1', 'pm-a@example.com', 100),
      makeVersion('v2', 'pm-b@example.com', 200),
      makeVersion('v3', 'pm-a@example.com', 300), // newest of pm-a
      makeVersion('v4', 'pm-b@example.com', 400), // newest of pm-b
      makeVersion('v5', SYSTEM_OWNER, 500),
    ];
    const latest = latestVersionPerOwner(versions);
    expect(latest.map(v => v.id).sort()).toEqual(['v3', 'v4']);
    expect(latest.find(v => v.owner === 'pm-a@example.com')?.id).toBe('v3');
    expect(latest.find(v => v.owner === 'pm-b@example.com')?.id).toBe('v4');
  });

  it('keeps only the last occurrence on equal createdAt (versions come ordered by createdAt ASC)', () => {
    const versions = [
      makeVersion('v1', 'pm@example.com', 100),
      makeVersion('v3', 'pm@example.com', 100),
      makeVersion('v2', 'pm@example.com', 100),
    ];
    const latest = latestVersionPerOwner(versions);
    expect(latest.map(v => v.id)).toEqual(['v2']);
  });

  it('returns an empty list when only system versions exist', () => {
    const versions = [makeVersion('v1', SYSTEM_OWNER, 100), makeVersion('v2', SYSTEM_OWNER, 200)];
    expect(latestVersionPerOwner(versions)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// currentPlanAssignments / currentPlanAbsences
// ---------------------------------------------------------------------------

describe('currentPlanAssignments / currentPlanAbsences', () => {
  it('flattens assignments/absences of only the newest version of each non-system owner', () => {
    const versions = [
      makeVersion('v1', 'pm-a@example.com', 100, {
        assignments: [assignment('a-1', 'p1')],
        absences: [absence('ab-1')],
      }),
      makeVersion('v2', 'pm-a@example.com', 200, {
        // Newer supersedes v1: v1's entries must not leak into the aggregate.
        assignments: [assignment('a-2', 'p2')],
        absences: [absence('ab-2')],
      }),
      makeVersion('v3', 'pm-b@example.com', 300, {
        assignments: [assignment('a-3', 'p3')],
        absences: [absence('ab-3')],
      }),
      makeVersion('v4', SYSTEM_OWNER, 400, {
        assignments: [assignment('a-4', 'p4')],
        absences: [absence('ab-4')],
      }),
    ];

    expect(currentPlanAssignments(versions).map(a => a.id).sort()).toEqual(['a-2', 'a-3']);
    expect(currentPlanAbsences(versions).map(a => a.id).sort()).toEqual(['ab-2', 'ab-3']);
  });

  it('returns empty arrays when no non-system version exists', () => {
    const versions = [makeVersion('v1', SYSTEM_OWNER, 100)];
    expect(currentPlanAssignments(versions)).toEqual([]);
    expect(currentPlanAbsences(versions)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ownerHasPlan / isLatestOfOwner / canEditVersion
// ---------------------------------------------------------------------------

describe('ownerHasPlan', () => {
  it('is true when the email owns at least one version', () => {
    const versions = [
      makeVersion('v1', 'pm-a@example.com', 100),
      makeVersion('v2', 'pm-b@example.com', 200),
    ];
    expect(ownerHasPlan(versions, 'pm-a@example.com')).toBe(true);
  });

  it('is false when the email owns nothing', () => {
    const versions = [makeVersion('v1', 'pm-a@example.com', 100)];
    expect(ownerHasPlan(versions, 'pm-b@example.com')).toBe(false);
  });

  it('is false when only system-owned versions exist', () => {
    const versions = [makeVersion('v1', SYSTEM_OWNER, 100)];
    expect(ownerHasPlan(versions, 'pm@example.com')).toBe(false);
  });
});

describe('isLatestOfOwner', () => {
  const versions = [
    makeVersion('v1', 'pm@example.com', 100),
    makeVersion('v2', 'pm@example.com', 200),
    makeVersion('v3', 'other@example.com', 300),
  ];

  it('is true for the newest version of its owner, regardless of other owners', () => {
    expect(isLatestOfOwner(versions[1]!, versions)).toBe(true);
    expect(isLatestOfOwner(versions[2]!, versions)).toBe(true);
  });

  it('is false for an older version of the same owner', () => {
    expect(isLatestOfOwner(versions[0]!, versions)).toBe(false);
  });

  it('is false for a system-owned version', () => {
    const systemVersions = [...versions, makeVersion('v9', SYSTEM_OWNER, 999)];
    const system = systemVersions[systemVersions.length - 1]!;
    expect(isLatestOfOwner(system, systemVersions)).toBe(false);
  });
});

describe('canEditVersion', () => {
  const versions = [
    makeVersion('v1', 'pm@example.com', 100),
    makeVersion('v2', 'pm@example.com', 200),
    makeVersion('v3', 'other@example.com', 300),
    makeVersion('v4', SYSTEM_OWNER, 400),
  ];

  it('is true when the email owns the version and it is the newest of that owner', () => {
    expect(canEditVersion(versions[1]!, 'pm@example.com', versions)).toBe(true);
  });

  it('is false when the email does not own the version', () => {
    expect(canEditVersion(versions[1]!, 'other@example.com', versions)).toBe(false);
  });

  it('is false for an older version even when owned', () => {
    expect(canEditVersion(versions[0]!, 'pm@example.com', versions)).toBe(false);
  });

  it('is never true for a system-owned version', () => {
    expect(canEditVersion(versions[3]!, 'system', versions)).toBe(false);
    expect(canEditVersion(versions[3]!, 'pm@example.com', versions)).toBe(false);
  });
});
