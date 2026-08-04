import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';

import { EmploymentType, EmployeeSchema, type Employee as EmployeeProto } from './gen/qfc/team/v1/team_pb.js';
import { ChangeEventSchema, EntityKind, ChangeOp, type ChangeEvent } from './gen/qfc/events/v1/events_pb.js';
import {
  PlanVersionMetaSchema,
  PlanVersionSchema,
  AssignmentSchema,
  QuarterDataSchema,
  type PlanVersionMeta as PlanVersionMetaProto,
  type PlanVersion as PlanVersionProto,
  type Assignment as AssignmentProto,
  type QuarterData as QuarterDataProto,
} from './gen/qfc/planning/v1/planning_pb.js';
import {
  ProjectSchema,
  ProjectColor,
  ProjectStatus,
  type Project as ProjectProto,
} from './gen/qfc/portfolio/v1/portfolio_pb.js';
import { LiveStoreProvider, useLiveStore } from './liveStore';

// ---------------------------------------------------------------------------
// Mock the client layer entirely - liveStore.tsx must never touch the real
// network. `vi.mock` is hoisted above all imports (including the `./liveStore`
// import below), so the mocked clients must be created via `vi.hoisted` to
// avoid a temporal-dead-zone reference from inside the hoisted factory.
// ---------------------------------------------------------------------------

const { teamClient, customerClient, projectClient, planningClient, strategyClient, growthClient, eventClient } =
  vi.hoisted(() => ({
    teamClient: {
      listEmployees: vi.fn(),
      upsertEmployee: vi.fn(),
      deleteEmployee: vi.fn(),
    },
    customerClient: {
      listCustomers: vi.fn(),
      upsertCustomer: vi.fn(),
      deleteCustomer: vi.fn(),
    },
    projectClient: {
      listProjects: vi.fn(),
      upsertProject: vi.fn(),
      deleteProject: vi.fn(),
    },
    planningClient: {
      listHolidays: vi.fn(),
      listVersions: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateVersionMeta: vi.fn(),
      deleteVersion: vi.fn(),
      applyAssignments: vi.fn(),
      applyAbsences: vi.fn(),
      upsertQuarterData: vi.fn(),
    },
    strategyClient: {
      listGoals: vi.fn(),
      listNorthStarMetrics: vi.fn(),
      upsertGoal: vi.fn(),
      deleteGoal: vi.fn(),
      upsertNorthStarMetric: vi.fn(),
      deleteNorthStarMetric: vi.fn(),
    },
    growthClient: {
      listSessions: vi.fn(),
      upsertSession: vi.fn(),
      deleteSession: vi.fn(),
    },
    eventClient: {
      watch: vi.fn(),
      getEventsState: vi.fn(),
    },
  }));

vi.mock('./clients', () => ({
  teamClient,
  customerClient,
  projectClient,
  planningClient,
  strategyClient,
  growthClient,
  eventClient,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEmployeeProto(): EmployeeProto {
  return create(EmployeeSchema, {
    id: 'e1',
    name: 'Ada Lovelace',
    role: 'Engineer',
    avatar: '',
    skills: [],
    availability: 100,
    location: 'DE',
    employmentType: EmploymentType.INTERNAL,
  });
}

function makePlanVersionMetaProto(overrides: Partial<PlanVersionMetaProto> = {}): PlanVersionMetaProto {
  return create(PlanVersionMetaSchema, {
    id: 'v1',
    name: 'Version 1',
    createdAtMillis: 1704067200000n, // 2024-01-01T00:00:00Z
    ...overrides,
  });
}

function makePlanVersionProto(
  meta: PlanVersionMetaProto,
  overrides: { assignments?: AssignmentProto[]; forecastData?: QuarterDataProto[] } = {}
): PlanVersionProto {
  return create(PlanVersionSchema, {
    meta,
    assignments: overrides.assignments ?? [],
    absences: [],
    forecastData: overrides.forecastData ?? [],
  });
}

function makeAssignmentProto(overrides: Partial<AssignmentProto> = {}): AssignmentProto {
  return create(AssignmentSchema, {
    id: 'a1',
    versionId: 'v1',
    employeeId: 'e1',
    projectId: 'p1',
    date: '2026-01-05',
    allocation: 0.5,
    ...overrides,
  });
}

function makeProjectProto(id: string, name: string): ProjectProto {
  return create(ProjectSchema, {
    id,
    name,
    client: 'Acme',
    color: ProjectColor.BLUE,
    status: ProjectStatus.ACTIVE,
    volume: 10,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    hourlyRate: '100',
    milestones: [],
  });
}

function makeProjectEvent(seq: bigint, project: ProjectProto, op: ChangeOp = ChangeOp.UPSERT): ChangeEvent {
  return create(ChangeEventSchema, {
    seq,
    kind: EntityKind.PROJECT,
    op,
    entityId: project.id,
    actorEmail: 'actor@example.com',
    tsMillis: 0n,
    body: op === ChangeOp.DELETE ? { case: undefined } : { case: 'project', value: project },
  });
}

/** A promise the test resolves/rejects manually to control RPC timing. */
function deferred<T>() {
  // Hand-rolled Promise.withResolvers: the tsconfig lib is ES2022, so the
  // native helper (ES2024) isn't typed even though the runtime has it.
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emptyListResponses(): void {
  customerClient.listCustomers.mockResolvedValue({ customers: [] });
  projectClient.listProjects.mockResolvedValue({ projects: [] });
  planningClient.listHolidays.mockResolvedValue({ holidays: [] });
  planningClient.listVersions.mockResolvedValue({ versions: [] });
  strategyClient.listGoals.mockResolvedValue({ goals: [] });
  strategyClient.listNorthStarMetrics.mockResolvedValue({ metrics: [] });
  growthClient.listSessions.mockResolvedValue({ sessions: [] });
}

/** A watch stream that yields `items` in order then idles until the signal aborts. */
function makeWatchStream(items: ChangeEvent[], signal: AbortSignal): AsyncGenerator<ChangeEvent> {
  return (async function* () {
    for (const item of items) {
      if (signal.aborted) return;
      yield item;
    }
    await new Promise<void>(resolve => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  })();
}

/** A watch stream that immediately throws `error` (after any signal check). */
function makeFailingWatchStream(error: unknown, signal: AbortSignal): AsyncGenerator<ChangeEvent, void, unknown> {
  async function* generator(): AsyncGenerator<ChangeEvent, void, unknown> {
    if (signal.aborted) return;
    throw error;
  }
  return generator();
}

function makeEmployeeEvent(seq: bigint, employee: EmployeeProto, op: ChangeOp = ChangeOp.UPSERT): ChangeEvent {
  return create(ChangeEventSchema, {
    seq,
    kind: EntityKind.EMPLOYEE,
    op,
    entityId: employee.id,
    actorEmail: 'actor@example.com',
    tsMillis: 0n,
    body: op === ChangeOp.DELETE ? { case: undefined } : { case: 'employee', value: employee },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  teamClient.listEmployees.mockResolvedValue({ employees: [] });
  emptyListResponses();
  eventClient.getEventsState.mockResolvedValue({ maxSeq: 0n });
  eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
    makeWatchStream([], opts.signal)
  );
});

describe('LiveStoreProvider / useLiveStore', () => {
  it('populates state from the initial parallel load', async () => {
    teamClient.listEmployees.mockResolvedValue({ employees: [makeEmployeeProto()] });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.employees).toEqual([
      expect.objectContaining({ id: 'e1', name: 'Ada Lovelace', type: 'internal' }),
    ]);
    expect(result.current.projects).toEqual([]);
    expect(result.current.customers).toEqual([]);
    expect(result.current.versions).toEqual([]);
    expect(teamClient.listEmployees).toHaveBeenCalledTimes(1);
  });

  it('applies an UPSERT event by appending, and a second identical event is a no-op', async () => {
    // Both events share the same seq, as a replayed duplicate from the
    // server would: the second must be recognized as already-applied.
    const event = makeEmployeeEvent(1n, makeEmployeeProto());
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
      makeWatchStream([event, event], opts.signal)
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await waitFor(() => expect(result.current.employees).toHaveLength(1));
    expect(result.current.employees[0]).toEqual(expect.objectContaining({ id: 'e1' }));

    // Give the duplicate event a chance to be (mis)applied before asserting.
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result.current.employees).toHaveLength(1);
  });

  it('removes an entity on a DELETE event', async () => {
    teamClient.listEmployees.mockResolvedValue({ employees: [makeEmployeeProto()] });

    let watchCall = 0;
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      watchCall += 1;
      if (watchCall === 1) {
        return makeWatchStream([makeEmployeeEvent(1n, makeEmployeeProto(), ChangeOp.DELETE)], opts.signal);
      }
      return makeWatchStream([], opts.signal);
    });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await waitFor(() => expect(result.current.employees).toHaveLength(0));
  });

  it('reloads exactly once when the stream reports data_loss', async () => {
    teamClient.listEmployees.mockResolvedValue({ employees: [] });
    // After a data_loss the reload re-reads the high-water mark and the
    // restarted watch must resume from exactly that mark - not from 0 (a
    // pruned log cannot serve 0) and not from the stale previous seq.
    eventClient.getEventsState.mockResolvedValue({ maxSeq: 42n });

    let watchCall = 0;
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) => {
      watchCall += 1;
      if (watchCall === 1) {
        return makeFailingWatchStream(new ConnectError('data lost', Code.DataLoss), opts.signal);
      }
      return makeWatchStream([], opts.signal);
    });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(teamClient.listEmployees).toHaveBeenCalledTimes(2));

    // No further reloads should follow.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(teamClient.listEmployees).toHaveBeenCalledTimes(2);
    expect(watchCall).toBeGreaterThanOrEqual(2);
    expect(eventClient.getEventsState).toHaveBeenCalledTimes(2);
    expect(eventClient.watch).toHaveBeenNthCalledWith(2, { sinceSeq: 42n }, expect.anything());
  });

  it('rejects on a failed mutation and leaves local state unchanged', async () => {
    teamClient.listEmployees.mockResolvedValue({ employees: [makeEmployeeProto()] });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    teamClient.upsertEmployee.mockRejectedValue(new Error('boom'));

    const before = result.current.employees;
    await act(async () => {
      await expect(result.current.saveEmployee({ ...before[0]!, name: 'Changed' })).rejects.toThrow('boom');
    });

    expect(result.current.employees).toEqual(before);
    expect(result.current.employees[0]!.name).toBe('Ada Lovelace');
  });

  it('updateVersionMeta applies the server response to the matching version', async () => {
    const metaV1 = makePlanVersionMetaProto();
    planningClient.listVersions.mockResolvedValue({ versions: [metaV1] });
    planningClient.getVersion.mockResolvedValue({ version: makePlanVersionProto(metaV1) });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const updatedMeta = makePlanVersionMetaProto({ name: 'Renamed', description: 'New description' });
    planningClient.updateVersionMeta.mockResolvedValue({ meta: updatedMeta });

    let returned!: Awaited<ReturnType<typeof result.current.updateVersionMeta>>;
    await act(async () => {
      returned = await result.current.updateVersionMeta('v1', 'Renamed', 'New description');
    });

    expect(returned).toEqual(expect.objectContaining({ id: 'v1', name: 'Renamed', description: 'New description' }));
    expect(result.current.versions).toHaveLength(1);
    expect(result.current.versions[0]).toEqual(
      expect.objectContaining({ id: 'v1', name: 'Renamed', description: 'New description' })
    );
    expect(planningClient.updateVersionMeta).toHaveBeenCalledWith({
      versionId: 'v1',
      name: 'Renamed',
      description: 'New description',
    });
  });

  it('deleteVersion removes the version from state on success', async () => {
    const metaV1 = makePlanVersionMetaProto({ id: 'v1', name: 'Version 1' });
    const metaV2 = makePlanVersionMetaProto({ id: 'v2', name: 'Version 2' });
    planningClient.listVersions.mockResolvedValue({ versions: [metaV1, metaV2] });
    planningClient.getVersion.mockImplementation(({ versionId }: { versionId: string }) =>
      Promise.resolve({ version: makePlanVersionProto(versionId === 'v1' ? metaV1 : metaV2) })
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.versions).toHaveLength(2);

    planningClient.deleteVersion.mockResolvedValue({});

    await act(async () => {
      await result.current.deleteVersion('v1');
    });

    expect(planningClient.deleteVersion).toHaveBeenCalledWith({ versionId: 'v1' });
    expect(result.current.versions.map(v => v.id)).toEqual(['v2']);
  });

  it('deleteVersion rejects with a failed_precondition error for the last remaining version, leaving state unchanged', async () => {
    const metaV1 = makePlanVersionMetaProto({ id: 'v1', name: 'Only Version' });
    planningClient.listVersions.mockResolvedValue({ versions: [metaV1] });
    planningClient.getVersion.mockResolvedValue({ version: makePlanVersionProto(metaV1) });

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    planningClient.deleteVersion.mockRejectedValue(
      new ConnectError('cannot delete the last version', Code.FailedPrecondition)
    );

    await act(async () => {
      await expect(result.current.deleteVersion('v1')).rejects.toMatchObject({ code: Code.FailedPrecondition });
    });

    expect(result.current.versions.map(v => v.id)).toEqual(['v1']);
  });

  it('deleting the version that was active leaves a valid remaining version behind', async () => {
    // `activeVersionId` itself is App-level UI state (see App.tsx), not part
    // of LiveStore - but App.tsx's fallback logic depends on `versions`
    // always holding a valid remaining entry right after a successful
    // delete. This asserts that invariant at the store level: deleting the
    // (hypothetically active) first version still leaves the second version
    // in place for a caller to fall back to.
    const metaV1 = makePlanVersionMetaProto({ id: 'v1', name: 'Active Version' });
    const metaV2 = makePlanVersionMetaProto({ id: 'v2', name: 'Other Version' });
    planningClient.listVersions.mockResolvedValue({ versions: [metaV1, metaV2] });
    planningClient.getVersion.mockImplementation(({ versionId }: { versionId: string }) =>
      Promise.resolve({ version: makePlanVersionProto(versionId === 'v1' ? metaV1 : metaV2) })
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const activeVersionId = result.current.versions[result.current.versions.length - 1]!.id;
    expect(activeVersionId).toBe('v2');

    planningClient.deleteVersion.mockResolvedValue({});

    await act(async () => {
      await result.current.deleteVersion(activeVersionId);
    });

    // The active version is gone; a fallback (e.g. the new latest version)
    // must still exist and be selectable.
    expect(result.current.versions.find(v => v.id === activeVersionId)).toBeUndefined();
    expect(result.current.versions).toHaveLength(1);
    const fallback = result.current.versions[result.current.versions.length - 1];
    expect(fallback).toEqual(expect.objectContaining({ id: 'v1' }));
  });

  it('prefers watch-applied assignment changes over the staler GetVersion snapshot during hydration', async () => {
    // A PLAN_VERSION event for an unknown version creates a meta shell and
    // kicks off a hydration GetVersion. While that fetch is in flight, an
    // ASSIGNMENT event (higher seq) applies a newer change to the shell.
    // The hydration merge must keep the watch-applied entry instead of
    // overwriting it with the staler snapshot copy.
    const meta = makePlanVersionMetaProto();
    const snapshot = makePlanVersionProto(meta, {
      assignments: [makeAssignmentProto({ id: 'a1', allocation: 1 })],
    });
    const getVersionCall = deferred<{ version: PlanVersionProto }>();
    planningClient.getVersion.mockReturnValue(getVersionCall.promise);

    const planVersionEvent = create(ChangeEventSchema, {
      seq: 1n,
      kind: EntityKind.PLAN_VERSION,
      op: ChangeOp.UPSERT,
      entityId: 'v1',
      actorEmail: 'actor@example.com',
      tsMillis: 0n,
      body: { case: 'planVersion', value: meta },
    });
    const assignmentEvent = create(ChangeEventSchema, {
      seq: 2n,
      kind: EntityKind.ASSIGNMENT,
      op: ChangeOp.UPSERT,
      entityId: 'a1',
      versionId: 'v1',
      actorEmail: 'actor@example.com',
      tsMillis: 0n,
      body: { case: 'assignment', value: makeAssignmentProto({ id: 'a1', allocation: 0.5 }) },
    });
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
      makeWatchStream([planVersionEvent, assignmentEvent], opts.signal)
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // Wait until the shell exists, the watch-applied assignment landed, and
    // the hydration fetch is in flight - then resolve it with the stale
    // snapshot.
    await waitFor(() => expect(result.current.versions[0]?.assignments).toHaveLength(1));
    expect(planningClient.getVersion).toHaveBeenCalledTimes(1);
    await act(async () => {
      getVersionCall.resolve({ version: snapshot });
    });

    // The watch-applied allocation (0.5, seq 2 > hydration start seq 1)
    // must win over the snapshot's staler allocation (1).
    await waitFor(() => expect(result.current.versions[0]?.assignments).toHaveLength(1));
    expect(result.current.versions[0]!.assignments[0]).toEqual(expect.objectContaining({ id: 'a1', allocation: 0.5 }));
  });

  it('retries hydration after a failed GetVersion instead of leaving a permanent empty shell', async () => {
    // The first hydration fails; the id must NOT be latched as "known full",
    // so the next PLAN_VERSION event for the same id triggers a new fetch
    // that actually fills in the data.
    const meta = makePlanVersionMetaProto();
    planningClient.getVersion
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ version: makePlanVersionProto(meta, { assignments: [makeAssignmentProto()] }) });

    const planVersionEvent = (seq: bigint) =>
      create(ChangeEventSchema, {
        seq,
        kind: EntityKind.PLAN_VERSION,
        op: ChangeOp.UPSERT,
        entityId: 'v1',
        actorEmail: 'actor@example.com',
        tsMillis: 0n,
        body: { case: 'planVersion', value: meta },
      });
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
      makeWatchStream([planVersionEvent(1n), planVersionEvent(2n)], opts.signal)
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await waitFor(() => expect(planningClient.getVersion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.versions[0]?.assignments).toHaveLength(1));
    expect(result.current.versions[0]!.assignments[0]).toEqual(expect.objectContaining({ id: 'a1' }));
  });

  it('a PROJECT upsert event also updates the copies embedded in versions forecastData', async () => {
    const meta = makePlanVersionMetaProto();
    projectClient.listProjects.mockResolvedValue({ projects: [makeProjectProto('p1', 'Old Name')] });
    planningClient.listVersions.mockResolvedValue({ versions: [meta] });
    planningClient.getVersion.mockResolvedValue({
      version: makePlanVersionProto(meta, {
        forecastData: [
          create(QuarterDataSchema, {
            id: 'q1',
            name: 'Q1 2026',
            months: ['January', 'February', 'March'],
            totalCapacity: [20, 20, 20],
            runningProjectIds: ['p1'],
            mustWinOpportunityIds: [],
            alternativeOpportunityIds: ['p1'],
            notes: '',
          }),
        ],
      }),
    });
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
      makeWatchStream([makeProjectEvent(1n, makeProjectProto('p1', 'New Name'))], opts.signal)
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // QuarterlyForecast renders from the embedded copies, so both the
    // top-level project and every embedded reference must see the update.
    // (No intermediate 'Old Name' assertion: the watch event may be applied
    // in the same tick the status flips to ready, making that racy.)
    await waitFor(() => expect(result.current.projects[0]!.name).toBe('New Name'));
    const quarter = result.current.versions[0]!.forecastData[0]!;
    expect(quarter.runningProjects[0]!.name).toBe('New Name');
    expect(quarter.alternativeOpportunities[0]!.name).toBe('New Name');
  });

  it('a PROJECT delete event also removes the copies embedded in versions forecastData', async () => {
    const meta = makePlanVersionMetaProto();
    projectClient.listProjects.mockResolvedValue({ projects: [makeProjectProto('p1', 'Doomed')] });
    planningClient.listVersions.mockResolvedValue({ versions: [meta] });
    planningClient.getVersion.mockResolvedValue({
      version: makePlanVersionProto(meta, {
        forecastData: [
          create(QuarterDataSchema, {
            id: 'q1',
            name: 'Q1 2026',
            months: ['January', 'February', 'March'],
            totalCapacity: [20, 20, 20],
            runningProjectIds: ['p1'],
            mustWinOpportunityIds: ['p1'],
            alternativeOpportunityIds: [],
            notes: '',
          }),
        ],
      }),
    });
    eventClient.watch.mockImplementation((_req: unknown, opts: { signal: AbortSignal }) =>
      makeWatchStream([makeProjectEvent(1n, makeProjectProto('p1', 'Doomed'), ChangeOp.DELETE)], opts.signal)
    );

    const { result } = renderHook(() => useLiveStore(), { wrapper: LiveStoreProvider });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await waitFor(() => expect(result.current.projects).toHaveLength(0));
    const quarter = result.current.versions[0]!.forecastData[0]!;
    expect(quarter.runningProjects).toHaveLength(0);
    expect(quarter.mustWinOpportunities).toHaveLength(0);
  });
});
