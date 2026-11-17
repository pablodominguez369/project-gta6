export * from "./admin-client";
export type { Database, Json } from "./database.types";

import type { Database } from "./database.types";

type PublicSchema = Database["public"];

export type TableRow<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TableInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type DbEnum<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
