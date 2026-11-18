import {
  APP_ROLES,
  ASSET_KINDS,
  ASSET_ORIGINS,
  CLAIM_CERTAINTIES,
  OPPORTUNITY_STATUSES,
  PLATFORMS,
  PUBLICATION_STATUSES,
  RIGHTS_STATUSES,
  SCRIPT_REQUEST_STATUSES,
  SCRIPT_STATUSES,
  SOURCE_TYPES,
} from "@gta6/domain";
import { describe, expect, it } from "vitest";

import { Constants } from "../database.types";

const db = Constants.public.Enums;

// The domain keeps its own copies of the database enums so it imports nothing from `db`.
// This test fails as soon as a migration and the domain drift apart.
describe("domain enums match the database", () => {
  it.each([
    ["app_role", APP_ROLES, db.app_role],
    ["platform", PLATFORMS, db.platform],
    ["publication_status", PUBLICATION_STATUSES, db.publication_status],
    ["source_type", SOURCE_TYPES, db.source_type],
    ["claim_certainty", CLAIM_CERTAINTIES, db.claim_certainty],
    ["opportunity_status", OPPORTUNITY_STATUSES, db.opportunity_status],
    ["script_status", SCRIPT_STATUSES, db.script_status],
    ["script_request_status", SCRIPT_REQUEST_STATUSES, db.script_request_status],
    ["rights_status", RIGHTS_STATUSES, db.rights_status],
    ["asset_kind", ASSET_KINDS, db.asset_kind],
    ["asset_origin", ASSET_ORIGINS, db.asset_origin],
  ] as const)("%s", (_name, domain, database) => {
    expect([...domain]).toEqual([...database]);
  });
});
