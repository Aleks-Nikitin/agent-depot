# Deploying Agent Depot on Vultr

Agent Depot is a containerized Next.js + PostgreSQL platform. It runs on any
Vultr compute product. This guide covers the fastest path (one VPS) and the
production path (Managed Database + optional Cloud GPU inference).

## 0. Get Vultr credits

Sign up at [vultr.com](https://www.vultr.com/) and claim the hackathon credits.
Create an API key under **Account → API** if you want to script provisioning.

## 1. Provision a Cloud Compute instance

- **Type:** Cloud Compute — Regular or High Performance
- **Plan:** 2 vCPU / 4 GB is comfortable for the app + in-box Postgres
- **OS:** Ubuntu 24.04
- **Add your SSH key**, then deploy and note the public IP.

Install Docker on the instance:

```bash
ssh root@YOUR_VULTR_IP
curl -fsSL https://get.docker.com | sh
```

## 2. Configure environment

On the instance:

```bash
mkdir -p /opt/agent-depot && cd /opt/agent-depot
# Copy .env.vultr.example from the repo to .env.production and fill it in:
#   - a strong POSTGRES_PASSWORD (and matching DATABASE_URL)
#   - RUNTIME_API_TOKEN (>= 24 random chars)
#   - GOOGLE_GENERATIVE_AI_API_KEY for the "Draft with Gemini" feature
```

## 3. Deploy

From your laptop, in the repo:

```bash
VULTR_HOST=root@YOUR_VULTR_IP npm run deploy:vultr
```

This rsyncs the source, builds the image, and starts `compose.prod.yaml`
(app + Postgres). The app container runs `prisma migrate deploy` on boot, so the
schema — including agent versioning — is applied automatically. Open
`http://YOUR_VULTR_IP` when the containers report healthy.

To run it by hand on the instance instead:

```bash
cd /opt/agent-depot
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

## 4. Production option — Vultr Managed Database for PostgreSQL

For durability and backups, use a managed cluster instead of the in-box
Postgres:

1. Create a **Managed Database → PostgreSQL** cluster in the Vultr console.
2. Copy its connection string into `DATABASE_URL` (keep `?sslmode=require`).
3. Delete the `postgres` service from `compose.prod.yaml`.
4. Redeploy. Migrations still run on container boot.

## 5. Scaling the frontend

The image is stateless (all state lives in Postgres), so you can:

- Put several instances behind a **Vultr Load Balancer**, or
- Push the image to the **Vultr Container Registry** and run it on **Vultr
  Kubernetes Engine (VKE)**:

  ```bash
  docker build -t YOUR_REGISTRY/agent-depot:latest .
  docker push YOUR_REGISTRY/agent-depot:latest
  ```

## 6. Optional — AI inference on Vultr Cloud GPU

The agent runtime talks to an LLM through an API. To keep inference on Vultr
infrastructure, run a model on **Vultr Cloud GPU** (or **Vultr Serverless
Inference**, which exposes an OpenAI-compatible endpoint) and point the runtime
model driver at that endpoint. This keeps both the platform and the model on
Vultr — the full "infrastructure is no longer the bottleneck" story.

## Health checks

```bash
docker compose -f compose.prod.yaml ps          # container status
curl -s http://YOUR_VULTR_IP/api/agents          # should return {"agents":[...]}
```
