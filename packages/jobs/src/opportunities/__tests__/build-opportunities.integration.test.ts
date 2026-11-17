import { randomUUID } from "node:crypto";

import { createLogger } from "@gta6/observability";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../../__tests__/test-db";
import { buildOpportunities } from "../build-opportunities";

const logger = createLogger({ name: "opportunities-it", level: "fatal" });
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
const sourceIds: string[] = [];

async function addSource(title: string, publisher: string, trust: number, type = "press") {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.sources (url, canonical_url, publisher, title, source_type, trust_level,
                                 published_at)
     values ($1, $1, $2, $3, $4, $5, now()) returning id`,
    [`https://it.example.test/${randomUUID()}`, publisher, title, type, trust],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("source not created");
  sourceIds.push(id);
  return id;
}

async function opportunityOf(sourceId: string) {
  const { rows } = await pool.query<{
    id: string;
    status: string;
    certainty: string;
    risk_flags: string[];
    sources: number;
  }>(
    `select o.id, o.status, o.certainty, o.risk_flags,
            (select count(*)::int from public.opportunity_sources x where x.opportunity_id = o.id) as sources
       from public.opportunity_sources os join public.opportunities o on o.id = os.opportunity_id
      where os.source_id = $1`,
    [sourceId],
  );
  return rows[0];
}

afterAll(async () => {
  const { rows } = await pool.query<{ opportunity_id: string }>(
    "select distinct opportunity_id from public.opportunity_sources where source_id = any($1)",
    [sourceIds],
  );
  await pool.query("delete from public.opportunities where id = any($1)", [
    rows.map((r) => r.opportunity_id),
  ]);
  await pool.query("delete from public.sources where id = any($1)", [sourceIds]);
  await pool.end();
});

describe("buildOpportunities against Postgres", () => {
  it("groups the same story from three outlets into one reported opportunity", async () => {
    const tag = randomUUID().slice(0, 8);
    const a = await addSource(
      `Rockstar publica el segundo tráiler de GTA VI ${tag}`,
      `A ${tag}`,
      2,
    );
    const b = await addSource(`GTA VI: Rockstar publica su segundo tráiler ${tag}`, `B ${tag}`, 2);
    const c = await addSource(
      `Rockstar publica el segundo tráiler de GTA VI hoy ${tag}`,
      `C ${tag}`,
      1,
    );
    await buildOpportunities(pool, logger);

    const first = await opportunityOf(a);
    expect(first).toMatchObject({ sources: 3, certainty: "reported", status: "new" });
    expect((await opportunityOf(b))?.id).toBe(first?.id);
    expect((await opportunityOf(c))?.id).toBe(first?.id);
  });

  it("keeps unrelated stories apart and flags a single source", async () => {
    const tag = randomUUID().slice(0, 8);
    const a = await addSource(`Take-Two presenta resultados trimestrales ${tag}`, `D ${tag}`, 2);
    await buildOpportunities(pool, logger);
    const opportunity = await opportunityOf(a);
    expect(opportunity).toMatchObject({ sources: 1, certainty: "rumor" });
    expect(opportunity?.risk_flags).toContain("single_source");
  });

  it("discards a possible leak automatically with a reason", async () => {
    const tag = randomUUID().slice(0, 8);
    const a = await addSource(`Filtración de una build interna ${tag}`, `E ${tag}`, 1);
    await buildOpportunities(pool, logger);
    expect((await opportunityOf(a))?.status).toBe("discarded");
  });

  it("is idempotent: a second run links nothing new", async () => {
    const tag = randomUUID().slice(0, 8);
    const a = await addSource(`Anuncio oficial de fecha ${tag}`, `Oficial ${tag}`, 3, "official");
    await buildOpportunities(pool, logger);
    const before = await opportunityOf(a);
    await buildOpportunities(pool, logger);
    expect(await opportunityOf(a)).toEqual(before);
    expect(before?.certainty).toBe("confirmed");
  });
});
