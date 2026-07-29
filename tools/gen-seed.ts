/**
 * Generates `api/seed/seed.json`: today's demo data, taken straight from
 * `web/src/constants.ts`'s `MOCK_*` arrays (the same source of truth the
 * frontend renders in mock mode), converted through the existing
 * `*ToProto` adapters in `web/src/api/adapters.ts` - never reimplemented
 * here - and serialized as canonical protobuf JSON via `@bufbuild/protobuf`'s
 * `toJson`.
 *
 * `api/src/seed.rs` embeds this same file at compile time and deserializes
 * it into buffa-generated message types whose serde impls speak the
 * identical wire format (full enum names, lowerCamelCase field names), so
 * the JSON produced here needs no adjustment to be read on the Rust side.
 *
 * Run via `pnpm seed:gen` (see the root `package.json`), which pipes this
 * file through `jiti` rather than plain `node`: several imports below
 * (and, transitively, everything under `web/src/api/gen`) use `.js`-suffixed
 * specifiers that only resolve to their `.ts` siblings under a TS-aware
 * loader - Node's own native type-stripping (verified against this repo's
 * Node 26) strips types syntactically but does not remap those extensions,
 * so `node tools/gen-seed.ts` fails to resolve them. `jiti` is not a new
 * dependency: it is already pinned in `pnpm-lock.yaml` as Vite's optional
 * peer dependency (used by Vite/Vitest themselves to load TS config files)
 * and its binary is already present at `web/node_modules/.bin/jiti`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toJson } from '@bufbuild/protobuf';

import {
  MOCK_EMPLOYEES,
  MOCK_PROJECTS,
  MOCK_CUSTOMERS,
  MOCK_VERSIONS,
  MOCK_HOLIDAYS,
  MOCK_GOALS,
  MOCK_NORTH_STARS,
  MOCK_1ON1S,
} from '../web/src/constants.js';

import {
  employeesToProto,
  projectsToProto,
  customersToProto,
  planVersionsToProto,
  publicHolidaysToProto,
  strategicGoalsToProto,
  northStarMetricsToProto,
  oneOnOneSessionsToProto,
} from '../web/src/api/adapters.js';

import { EmployeeSchema } from '../web/src/api/gen/qfc/team/v1/team_pb.js';
import { ProjectSchema } from '../web/src/api/gen/qfc/portfolio/v1/portfolio_pb.js';
import { CustomerSchema } from '../web/src/api/gen/qfc/crm/v1/crm_pb.js';
import {
  PlanVersionSchema,
  PublicHolidaySchema,
} from '../web/src/api/gen/qfc/planning/v1/planning_pb.js';
import {
  StrategicGoalSchema,
  NorthStarMetricSchema,
} from '../web/src/api/gen/qfc/strategy/v1/strategy_pb.js';
import { OneOnOneSessionSchema } from '../web/src/api/gen/qfc/growth/v1/growth_pb.js';

/**
 * Every MOCK_* array in `constants.ts` is a hand-authored literal (not a
 * runtime-computed/`Set`-or-`Map`-backed collection), so iterating each in
 * its declared order - as every `*ToProto` helper does - is already
 * deterministic: regenerating without a source change reproduces byte-
 * identical output, which keeps this generated, committed artifact's diffs
 * meaningful.
 */
const seed = {
  employees: employeesToProto(MOCK_EMPLOYEES).map(msg => toJson(EmployeeSchema, msg)),
  projects: projectsToProto(MOCK_PROJECTS).map(msg => toJson(ProjectSchema, msg)),
  customers: customersToProto(MOCK_CUSTOMERS).map(msg => toJson(CustomerSchema, msg)),
  versions: planVersionsToProto(MOCK_VERSIONS).map(msg => toJson(PlanVersionSchema, msg)),
  holidays: publicHolidaysToProto(MOCK_HOLIDAYS).map(msg => toJson(PublicHolidaySchema, msg)),
  goals: strategicGoalsToProto(MOCK_GOALS).map(msg => toJson(StrategicGoalSchema, msg)),
  northStars: northStarMetricsToProto(MOCK_NORTH_STARS).map(msg => toJson(NorthStarMetricSchema, msg)),
  oneOnOnes: oneOnOneSessionsToProto(MOCK_1ON1S).map(msg => toJson(OneOnOneSessionSchema, msg)),
};

const outPath = fileURLToPath(new URL('../api/seed/seed.json', import.meta.url));
writeFileSync(outPath, `${JSON.stringify(seed, null, 2)}\n`);

console.log(`wrote ${outPath}`);
for (const [key, value] of Object.entries(seed)) {
  console.log(`  ${key}: ${value.length}`);
}
