/**
 * Generates `api/seed/seed.json`: the production baseline a fresh database
 * boots with. That baseline is deliberately minimal — the single internal
 * customer `INTERNAL_CUSTOMER` ("IBsolution GmbH", our own firm, so internal
 * projects always have a client to attach to). Users are NOT part of the
 * seed: accounts are created by the auth layer (`QFC_ADMIN_EMAILS` /
 * `QFC_DEFAULT_ROLE`, see `api/src/auth.rs`), so a fresh deployment starts
 * with exactly one Admin plus this one customer and nothing else.
 *
 * The full `MOCK_*` demo dataset that used to populate this file still lives
 * in `web/src/constants.ts` / `web/src/mocks` for tests and purely local
 * feature development; it is intentionally not part of the shipped seed. If
 * a local image ever needs demo data again, re-include the `MOCK_*` arrays
 * here, regenerate, and rebuild — do not make the production seed carry it.
 *
 * Conversion goes through the same `*ToProto` adapters
 * (`web/src/api/adapters.ts`) the web app itself uses, serialized as
 * canonical protobuf JSON via `@bufbuild/protobuf`'s `toJson`.
 *
 * `api/src/seed.rs` embeds this same file at compile time and deserializes
 * it into buffa-generated message types whose serde impls speak the
 * identical wire format (full enum names, lowerCamelCase field names), so
 * the JSON produced here needs almost no adjustment to be read on the Rust
 * side.
 *
 * Run via `pnpm seed:gen` (see the root `package.json`), which pipes this
 * file through `jiti` rather than plain `node`: the imports below use
 * `.js`-suffixed specifiers that only resolve to their `.ts` siblings under
 * a TS-aware loader - Node's own native type-stripping (verified against
 * this repo's Node 26) strips types syntactically but does not remap those
 * extensions, so `node tools/gen-seed.ts` fails to resolve them. `jiti` is
 * not a new dependency: it is already pinned in `pnpm-lock.yaml` as Vite's
 * optional peer dependency (used by Vite/Vitest themselves to load TS
 * config files) and its binary is already present at
 * `web/node_modules/.bin/jiti`.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toJson } from '@bufbuild/protobuf';

import { INTERNAL_CUSTOMER } from '../web/src/constants.js';
import { customersToProto } from '../web/src/api/adapters.js';
import { CustomerSchema } from '../web/src/api/gen/qfc/crm/v1/crm_pb.js';

/**
 * The production baseline. Every key stays an array (empty where the
 * baseline ships nothing) so the shape is stable and
 * `api/tests/seed.rs`'s dynamic row-count checks keep working.
 */
const seed = {
  employees: [],
  projects: [],
  customers: customersToProto([INTERNAL_CUSTOMER]).map(msg =>
    toJson(CustomerSchema, msg)
  ),
  versions: [],
  holidays: [],
  goals: [],
  northStars: [],
  oneOnOnes: [],
};

const outPath = fileURLToPath(new URL('../api/seed/seed.json', import.meta.url));
writeFileSync(outPath, `${JSON.stringify(seed, null, 2)}\n`);

console.log(`wrote ${outPath}`);
for (const [key, value] of Object.entries(seed)) {
  console.log(`  ${key}: ${value.length}`);
}
