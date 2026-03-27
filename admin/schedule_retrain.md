# Flicker — Nightly Retraining Setup Guide

This guide sets up a nightly cron job on Windows (via Task Scheduler + WSL)
that automatically retrains the SVD model from live Postgres data.

---

## Option A: Windows Task Scheduler (Recommended for Windows)

### Step 1: Open Task Scheduler
Press `Win + R`, type `taskschd.msc`, hit Enter.

### Step 2: Create a Basic Task
1. Click **"Create Basic Task"** in the right panel
2. Name: `Flicker Nightly Retrain`
3. Trigger: **Daily** at `03:00 AM`

### Step 3: Set the Action
- Action: **Start a program**
- Program/script:
  ```
  C:\Windows\System32\wsl.exe
  ```
- Add arguments:
  ```
  bash /mnt/c/Users/ASUS/Desktop/projects2025/Movie-Recommendation-System/admin/retrain_nightly.sh
  ```

### Step 4: Finish
Click Finish. The job now runs every night at 3am automatically.

---

## Option B: WSL Cron (Alternative)

> **Note:** WSL's cron daemon doesn't start automatically on Windows boot.
> You'd need to start it manually (`sudo service cron start`) each session.
> Task Scheduler is therefore more reliable for this use case.

If you want to use it anyway, add this to your crontab (`crontab -e` in WSL):
```
0 3 * * * cd /mnt/c/Users/ASUS/Desktop/projects2025/Movie-Recommendation-System && source venv_wsl/bin/activate && python src/train.py >> logs/retrain.log 2>&1
```

---

## Verifying the Job Ran

After the first scheduled run, check:
```bash
cat logs/retrain.log
```

It should look like:
```
========================================
[2026-03-21 03:00:01] Nightly retrain started
[1/3] Loading ratings data...
  Connecting to PostgreSQL...
  Loaded 100,234 ratings from Postgres (611 users, 9,724 movies)
[2/3] Training SVD model (100 factors, 20 epochs)...
  Training complete.
[3/3] Saving model artifact...
  Saved → models/svd_model.pkl
[2026-03-21 03:01:05] Training complete. Model saved to models/svd_model.pkl
[2026-03-21 03:01:05] Nightly retrain finished.
========================================
```

---

## Manual Trigger (any time)

To retrain on-demand without waiting for 3am:
```bash
# In WSL with venv activated:
python src/train.py

# Or via the API (requires ADMIN_SECRET in .env):
curl -X POST http://localhost:8000/api/retrain -H "X-Admin-Secret: your-secret-here"
```
