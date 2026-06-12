import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

export type {
  Activity,
  Integration,
  NewActivity,
  NewIntegration,
  NewOauthToken,
  NewRefreshToken,
  NewUser,
  NewWebhookEvent,
  OauthToken,
  RefreshToken,
  User,
  WebhookEvent,
} from "./schema";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
