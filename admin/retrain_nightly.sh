#!/bin/bash
# =============================================================
# Flicker — Nightly SVD Retraining Script
# =============================================================
# This script is called nightly by Windows Task Scheduler (see
# admin/schedule_retrain.md for setup instructions).
#
# It activates the WSL Python environment, runs the training
# pipeline (reads from Postgres, trains SVD, saves svd_model.pkl),
# and then calls POST /api/retrain to hot-swap the new model
# into the running server without a restart.
#
# Logs are written to logs/retrain.log with timestamps.
# =============================================================

set -euo pipefail   # Exit immediately on any error

PROJECT_DIR="/mnt/c/Users/ASUS/Desktop/projects2025/Movie-Recommendation-System"
VENV_ACTIVATE="$PROJECT_DIR/venv_wsl/bin/activate"
LOG_FILE="$PROJECT_DIR/logs/retrain.log"
API_URL="http://localhost:8000"

# Ensure the logs directory exists
mkdir -p "$PROJECT_DIR/logs"

echo "========================================" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly retrain started" >> "$LOG_FILE"

# Activate the WSL virtual environment
source "$VENV_ACTIVATE"

# Run the training pipeline directly from Python
# (Faster and more reliable than calling the HTTP endpoint from a script,
#  since the API server may not be running at 3am)
cd "$PROJECT_DIR"
python src/train.py >> "$LOG_FILE" 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Training complete. Model saved to models/svd_model.pkl" >> "$LOG_FILE"

# If the API server IS running, also hot-swap the model in memory.
# This is optional — the new model is picked up automatically on next restart.
# Requires ADMIN_SECRET to be set in the environment.
if [ -n "${ADMIN_SECRET:-}" ]; then
    RETRAIN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$API_URL/api/retrain" \
        -H "X-Admin-Secret: $ADMIN_SECRET")
    
    if [ "$RETRAIN_RESPONSE" = "202" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Hot-swap triggered via API (202 Accepted)" >> "$LOG_FILE"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] API hot-swap skipped (server not running or wrong secret). New model loads on next restart." >> "$LOG_FILE"
    fi
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ADMIN_SECRET not set — skipping API hot-swap." >> "$LOG_FILE"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly retrain finished." >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
