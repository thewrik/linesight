# Single image: FastAPI backend serving the built frontend. No secrets are baked in.
FROM node:20-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY backend/ backend/
RUN pip install --no-cache-dir -e ".[live]"
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV LINESIGHT_DB=/data/linesight.sqlite LINESIGHT_STATIC_DIR=/app/frontend/dist
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "linesight.api:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
