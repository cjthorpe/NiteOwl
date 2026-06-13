import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };
export { encrypt, decrypt, encryptOptional, decryptOptional } from "./encryption.js";

export type {
  ActivityEvent,
  Integration,
  NewActivityEvent,
  NewIntegration,
  NewOauthToken,
  NewRefreshToken,
  NewSlackAlertConfig,
  NewUser,
  NewWebhookEvent,
  OauthToken,
  RefreshToken,
  SlackAlertConfig,
  User,
  WebhookEvent,
  WebhookEventStatus,
} from "./schema";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
