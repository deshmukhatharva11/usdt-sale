# PVC Meta - Docker Deployment Guide

## Prerequisites
- Docker Desktop installed and running.

## Quick Start
1. **Start the System**
   ```bash
   docker-compose up -d --build
   ```
   This will start:
   - Backend API (Port 3000)
   - PostgreSQL Database (Port 5432)
   - PGAdmin Interface (Port 5050)

2. **Initialize Database**
   Since the backend runs automatically, we need to run the initialization script *inside* the container once:
   ```bash
   docker exec -it pvc-backend node server/init-db.js
   ```

3. **Access Services**
   - **Frontend/API**: [http://localhost:3000](http://localhost:3000)
   - **Admin Panel**: [http://localhost:3000/admin/admin.html](http://localhost:3000/admin/admin.html)
   - **PGAdmin**: [http://localhost:5050](http://localhost:5050)
     - Login: `admin@pvcmeta.io` / `admin`
     - Connect to Server: Use host `postgres`

## Troubleshooting
- **Rebuild**: `docker-compose up -d --build`
- **Logs**: `docker-compose logs -f`
- **Stop**: `docker-compose down`
- **Clean Start**: `docker-compose down -v` (Deletes database data!)
