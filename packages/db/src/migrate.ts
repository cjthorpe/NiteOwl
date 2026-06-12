import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl";

async function runMigrations(): Promise<void> {
  console.log("Running migrations…");

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  await migrate(db, {
    migrationsFolder: path.join(__dirname, "../migrations"),
  });

  await client.end();
  console.log("Migrations complete.");
}

runMigrations().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
