# ---- Build stage ----
FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# ---- Runtime stage ----
FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PATH=/home/appuser/.local/bin:$PATH

RUN useradd --create-home --shell /bin/bash appuser
COPY --from=build /root/.local /home/appuser/.local
COPY src ./src

RUN chown -R appuser:appuser /app
USER appuser

WORKDIR /app/src
CMD ["python", "main.py"]
