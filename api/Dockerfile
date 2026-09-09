# Pinned base image. python:3.11-slim is the official Python image; the
# major.minor is fixed at 3.11 to match the local dev venv.
FROM python:3.11-slim

# Create a non-root user and group. The application runs as this user so
# a container compromise does not yield root on the host.
RUN groupadd --system --gid 1001 appgroup \
    && useradd  --system --uid 1001 --gid appgroup --create-home --shell /bin/bash appuser

WORKDIR /app

# Install Python dependencies first for better layer caching. The pinned
# requirements.txt ships only prebuilt wheels for the python:3.11-slim
# image, so no build tools are required at this stage.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip cache purge 2>/dev/null || true

# Copy application code and create the FastF1 cache directory owned by appuser
COPY --chown=appuser:appgroup . .
RUN mkdir -p cache && chown -R appuser:appgroup cache

# Drop privileges
USER appuser

ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080

# Healthcheck hits the in-process /health endpoint. Cloud Run also calls this
# (or the same path) as part of startup/liveness probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; \
    sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).status == 200 else 1)"

# Single worker keeps FastF1's in-process session cache effective. FastF1 loads
# hundreds of MB per session, so running multiple workers multiplies RSS.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
