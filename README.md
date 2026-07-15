# AI Task Processing Platform

A MERN application where authenticated users create text-processing tasks that
run asynchronously on a Python worker via a Redis queue, with MongoDB for
persistence. Containerized, deployed on Kubernetes, managed via Argo CD GitOps,
built and shipped through a GitHub Actions CI/CD pipeline.

Repo layout:
- `backend/` — Node.js + Express API (auth, task CRUD, queue producer)
- `frontend/` — React (Vite) SPA
- `worker/` — Python queue consumer that executes task operations
- `infra/` — Kubernetes manifests + Argo CD Application (this belongs in the
  **separate infrastructure repository** per the assessment brief — see note below)
- `.github/workflows/ci-cd.yml` — lint → build → push images → update infra repo

> **Note on repo split:** the assignment asks for a separate Application
> Repository and Infrastructure Repository. This project is scaffolded as one
> folder tree for convenience; before submitting, split it into two git repos
> exactly as `infra/` vs everything else — see "Splitting into two repos" below.

## 1. Local development (Docker Compose)

Prerequisites: Docker + Docker Compose.

```bash
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
cp frontend/.env.example frontend/.env

# edit backend/.env and set a real JWT_SECRET, e.g.:
# openssl rand -base64 48

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000/api
- Health check: http://localhost:5000/healthz

Register a user in the UI, create a task, and watch its status move
`PENDING → RUNNING → SUCCESS` as the worker picks it up (the dashboard polls
every 3s).

## 2. Running without Docker (for active development)

**Backend**
```bash
cd backend
npm install
npm run dev   # requires local Mongo + Redis, or point .env at hosted ones
```

**Worker**
```bash
cd worker
pip install -r requirements.txt
python src/main.py
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## 3. Running tests / lint

```bash
cd backend && npm run lint
cd worker && python -m pytest src/test_operations.py -v
```

## 4. Building and pushing Docker images manually

```bash
docker build -t <your-dockerhub-user>/ai-task-platform-backend:latest ./backend
docker build -t <your-dockerhub-user>/ai-task-platform-worker:latest ./worker
docker build -t <your-dockerhub-user>/ai-task-platform-frontend:latest ./frontend

docker push <your-dockerhub-user>/ai-task-platform-backend:latest
docker push <your-dockerhub-user>/ai-task-platform-worker:latest
docker push <your-dockerhub-user>/ai-task-platform-frontend:latest
```

## 5. Deploying to Kubernetes

See `infra/k8s/` — apply in numeric order, or let Argo CD do it (recommended,
see `infra/argocd/README.md`):

```bash
kubectl apply -f infra/k8s/00-namespace.yaml
kubectl apply -f infra/k8s/01-configmap.yaml
# create the real secret (do NOT use 02-secret.example.yaml as-is):
kubectl create secret generic app-secrets -n ai-task-platform \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)"
kubectl apply -f infra/k8s/10-mongo.yaml
kubectl apply -f infra/k8s/11-redis.yaml
kubectl apply -f infra/k8s/20-backend.yaml
kubectl apply -f infra/k8s/21-worker.yaml
kubectl apply -f infra/k8s/22-frontend.yaml
kubectl apply -f infra/k8s/30-ingress.yaml
```

Before applying, replace `REGISTRY_PLACEHOLDER` in `20-backend.yaml`,
`21-worker.yaml`, and `22-frontend.yaml` with your actual Docker Hub username
(the CI pipeline does this automatically for the infra repo once it's wired
up — see below).

## 6. CI/CD pipeline

`.github/workflows/ci-cd.yml` does, on every push to `main`:
1. **Lint** backend (ESLint) and **test** the worker (pytest).
2. **Build & push** Docker images for backend, worker, frontend to Docker Hub, tagged with the short commit SHA and `latest`.
3. **Update the infra repo**: checks out the infra repo, patches the image tags in the K8s manifests, and pushes — which Argo CD then auto-syncs to the cluster.

Required GitHub Actions secrets (set on the **app** repo):
| Secret | Purpose |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username / namespace for pushed images |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `INFRA_REPO_TOKEN` | A GitHub PAT with push access to the infra repo |

Also update `YOUR_ORG/ai-task-platform-infra` in the workflow file and in
`infra/argocd/application.yaml` to your actual infra repo path.

## 7. Splitting into two repos

```bash
# Application repo
git init ai-task-platform-app
cp -r backend frontend worker docker-compose.yml .github ai-task-platform-app/
cd ai-task-platform-app && git add . && git commit -m "Initial commit" && git remote add origin <app-repo-url> && git push -u origin main

# Infrastructure repo
git init ai-task-platform-infra
cp -r infra/* ai-task-platform-infra/
cd ai-task-platform-infra && git add . && git commit -m "Initial commit" && git remote add origin <infra-repo-url> && git push -u origin main
```

See `docs/ARCHITECTURE.md` for the system design, scaling strategy, and
failure-handling notes required by the assessment.
# trigger
