# Deployment runbook: Vercel (frontend) + Railway (backend)
#
# The SPA and the Express API deploy independently. The API is a long-running
# container with in-process pipeline workers + SSE streaming — Railway's
# always-on container model fits it with no serverless fights.
#
# ## Backend (Railway)
#
# 1. Create a Railway project, add a service from this GitHub repo.
# 2. Set the builder to Dockerfile (repo root Dockerfile).
# 3. Environment variables (all from .env.example; never commit secrets):
#      NODE_ENV=production
#      APP_ENV=production
#      PORT            — injected by Railway automatically; code reads process.env.PORT.
#      FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, STORAGE_BUCKET,
#      FIREBASE_AUTH_DOMAIN, GEMINI_API_KEY (or GEMINI_CREDENTIAL_SOURCE),
#      PRODUCTION_FIREBASE_PROJECT_ID (isolation guard),
#      FRONTEND_ORIGIN=https://<your-app>.vercel.app   (CORS allowlist, required)
#      ADMIN_UIDS=<comma-separated Firebase UIDs>      (empty = nobody is admin)
#      LOG_LEVEL=info
#      RATE_LIMIT_STORE / COST_STORE / CACHE_STORE=memory (single replica)
# 4. Deploy. Verify: GET https://<service>.up.railway.app/health -> 200.
# 5. Firebase console -> Authentication -> Settings -> Authorized domains:
#    add the Vercel domain or browser auth flows break.
#
# ## Frontend (Vercel)
#
# 1. Import the same GitHub repo into Vercel as a new project.
# 2. Framework preset: Vite. Build command: `vite build`. Output: `dist`.
#    (Vercel builds the SPA only; it never runs server.ts.)
# 3. Environment variable for the client (Vite bakes VITE_* at build time):
#      VITE_API_URL=https://<service>.up.railway.app
#    The SPA must send API/SSE calls to VITE_API_URL, not same-origin.
# 4. Deploy. The SPA calls the Railway API cross-origin (Bearer tokens);
#    the backend CORS gate allows only FRONTEND_ORIGIN.
#
# ## SSE note
#
# The progress stream (/api/v1/research/:id/events) is served by Railway
# with `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` so
# proxies don't buffer it. If a future proxy buffers anyway, the client
# falls back to polling GET /api/v1/research/:id.
#
# ## Redis (later)
#
# Not provisioned. When replicas>1 justifies it: add the Railway Redis
# addon, set REDIS_URL, and implement Redis*Store classes behind the
# RateLimitStore/CostStore/CacheStore interfaces (stores.ts) — no middleware
# or route changes required.
