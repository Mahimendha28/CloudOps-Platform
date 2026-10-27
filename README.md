
# DevOps Cloud Platform

## Project Overview
An end-to-end DevOps capstone that demonstrates application development,
containerization, infrastructure automation, CI/CD, security, monitoring,
and recovery practices.

## Objectives
- Build a service-management web application.
- Containerize the frontend, backend, and database.
- Automate testing and deployment using GitHub Actions.
- Provision cloud infrastructure using Terraform.
- Configure Nginx as a reverse proxy.
- Secure application access and manage secrets safely.
- Monitor application health, logs, and infrastructure.
- Test backups, recovery, and deployment rollback.
- Practice Kubernetes and GitOps locally.

## Technology Stack
- Version control: Git and GitHub
- Application: Frontend + backend API
- Containers: Docker and Docker Compose
- Cloud: AWS
- Infrastructure as Code: Terraform
- Web server: Nginx
- CI/CD: GitHub Actions
- Monitoring: Prometheus / Grafana or CloudWatch
- Orchestration: Kubernetes and Argo CD

## Cost Strategy
Develop and test locally wherever practical.
Create AWS resources only when required, and verify estimated costs first.

## Project Status
Phase 0: Repository setup in progress.

## CloudOps Service Management Application

The working application lives entirely under `app/`; the existing infrastructure
directories remain planning material and are not required to run this local app.

- `app/frontend`: React + Vite dashboard.
- `app/backend`: Express REST API with a persistent MongoDB database.

MongoDB is configured through `MONGODB_URI` and `MONGODB_DB`. The original
SQLite file (`app/backend/data/cloudops.db`) is retained for safe migration and
is never changed by the MongoDB migration command.

### Run locally

Use two terminals from the repository root:

```powershell
cd app/backend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

```powershell
cd app/frontend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Open the dashboard at `http://localhost:5173`. The API health endpoint is
available at `http://localhost:3001/health`.

The frontend expects `VITE_API_URL` (default `http://localhost:3001`) and the
backend supports `PORT`, `FRONTEND_ORIGIN`, `MONGODB_URI`, and `MONGODB_DB`;
see each application's `.env.example` for safe local values.

### Migrating existing SQLite records

With MongoDB running and the backend `.env` configured, run:

```powershell
cd app/backend
npm.cmd run migrate:sqlite
```

The command reads the original SQLite database and upserts every collection by
its original numeric ID, so it is safe to rerun and does not overwrite or
delete the SQLite file. Its output shows source and MongoDB record counts.

## Documentation
Architecture, setup instructions, test evidence, troubleshooting,
and operational runbooks will be maintained in the docs/ directory.
EOF
