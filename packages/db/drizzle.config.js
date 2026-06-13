export default {
    schema: "./src/schema.ts",
    out: "./migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env["DATABASE_URL"] ?? "postgres://niteowl:niteowl@localhost:5432/niteowl",
    },
};
//# sourceMappingURL=drizzle.config.js.map