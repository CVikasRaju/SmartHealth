# Deployment

## 1. Environment Configuration

Create and configure `backend/.env`[cite: 13]:

```env
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/smartmedic?retryWrites=true&w=majority
REDIS_HOST=smartmedic-redis
REDIS_PORT=6379
REDIS_PASSWORD=SmartRedisSecure2026!
JWT_SECRET=production_ultra_secure_jwt_secret_hospital_key_2026
JWT_EXPIRES_IN=900
REFRESH_TOKEN_SECRET=production_refresh_token_secret_key_2026
CORS_ORIGIN=[https://app.smartmedic.io](https://app.smartmedic.io)
SHORTAGE_JOB_INTERVAL_HOURS=6
OCR_ENGINE=tesseract
UPLOAD_MAX_FILE_SIZE_MB=15
```

---

## 2. Multi-Container Production Docker Setup

```bash
docker-compose up --build -d
```

The orchestration spins up:
- **`smartmedic-backend`**: Node.js 18 LTS micro-service with Multer file streaming, BullMQ queue workers, and Express REST gateway[cite: 2, 13].
- **`smartmedic-frontend`**: React 18 production bundle served via high-performance Nginx with custom routing fallbacks[cite: 2, 13].
- **`smartmedic-mongo`**: MongoDB 6.0 with persistent storage volumes and authentication[cite: 2, 13].
- **`smartmedic-redis`**: Redis 7.0 for BullMQ task distribution, socket connections, and caching[cite: 2, 13].
- **`smartmedic-monitoring`**: Prometheus scraping system telemetry and Grafana pre-configured with operational dashboards[cite: 2, 11, 13].

---

## 3. Production Security Checklist

- [ ] TLS 1.3 configured across all public routes via Let's Encrypt / Certbot[cite: 2, 13].
- [ ] Database storage volume encrypted with AES-256[cite: 2].
- [ ] Uploaded medical reports stored in private, signed S3 buckets or encrypted volumes; direct public access denied[cite: 11, 13].
- [ ] OCR extraction worker isolated in non-root Docker execution sandbox[cite: 2, 13].
- [ ] Rate-limiting enabled: max 10 requests/min on `/auth`, max 5 uploads/min on `/reports/upload`[cite: 13].
- [ ] Immutable audit logging verified for all write operations across clinical, inventory, and billing databases[cite: 2, 13, 18].