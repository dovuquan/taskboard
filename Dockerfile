# Stage 1: build the web app into web/dist.
FROM node:24-slim AS web
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# Stage 2: the Python image runs the API and serves web/dist.
FROM python:3.12-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/src ./src
RUN uv sync --locked --no-dev --no-editable
COPY --from=web /app/web/dist /app/web/dist

RUN useradd --create-home --uid 1000 taskboard \
    && mkdir -p /data && chown taskboard /data
USER taskboard
ENV TASKBOARD_WEB_DIST=/app/web/dist \
    PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "taskboard.app:app", "--host", "0.0.0.0", "--port", "8000"]
