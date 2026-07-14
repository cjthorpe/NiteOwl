# Staging deploy (Railway)

`.github/workflows/deploy-staging.yml` builds the API and Web images, pushes them
to GHCR, then promotes each SHA-tagged image to the Railway **staging**
environment.

## Image-deploy syntax (why it changed — FUL-156)

Railway CLI ≥ ~5.x removed `--image` from `railway up`. The prebuilt-image flow
now lives under two commands, which the workflow uses:

```bash
railway service source connect --image ghcr.io/<owner>/niteowl-api:sha-<short> --service api
railway redeploy --service api --from-source --yes
```

`service source connect` points the service at the exact SHA-tagged image;
`redeploy --from-source` pulls and rolls it out. The CLI is **pinned**
(`@railway/cli@5.26.1`) so an unattended upgrade can't silently break `up`/flags
again. Bump the pin deliberately and re-verify the two commands above still exist
(`railway service source connect --help`, `railway redeploy --help`).

## Required GitHub config (blocker — needs a repo/Railway admin)

The deploy jobs run in the GitHub `staging` environment. As of FUL-156 none of
the following were set, so `railway *` runs unauthenticated and the jobs fail
fast on the `RAILWAY_TOKEN is empty` guard. A human with Railway account access
must provision these **once**:

1. **Railway project** with two services named exactly `api` and `web`, each
   whose source is a Docker image (GHCR). One-time link:

   ```bash
   railway login
   railway link          # select the project + staging environment
   railway service source connect --image ghcr.io/<owner>/niteowl-api:latest --service api
   railway service source connect --image ghcr.io/<owner>/niteowl-web:latest --service web
   ```

   If the images are private on GHCR, add registry credentials to the Railway
   services (Settings → Source → Private registry).

2. **`RAILWAY_TOKEN`** — generate a **project token scoped to the staging
   environment** (Railway → Project → Settings → Tokens). A project token is
   environment-scoped, so the workflow does not pass `--project`/`--environment`.
   Add it as a **`staging` environment secret** (not a plain repo secret):

   ```bash
   gh secret set RAILWAY_TOKEN --env staging --body '<project-token>'
   ```

3. **Environment URLs** used by the health check / deployment URL:
   ```bash
   gh variable set STAGING_API_URL --env staging --body 'https://<api>.up.railway.app'
   gh variable set STAGING_WEB_URL --env staging --body 'https://<web>.up.railway.app'
   ```

Verify: `gh secret list --env staging` shows `RAILWAY_TOKEN`;
`gh variable list --env staging` shows both URLs; then re-run the latest
`Deploy to Staging` workflow.

## Notes

- `railway.toml` still declares `builder = "DOCKERFILE"` with a source path. That
  is for source-built services; when a service's source is a Docker image, no
  build runs. If Railway ever attempts a build in staging, disconnect the source
  path there and rely on `service source connect --image`.
