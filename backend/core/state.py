"""
backend/state.py — Shared mutable application state.

Kept in a separate module to avoid circular imports between main.py
(which populates state at startup) and routers/* (which read it at
request time).

Usage:
    from backend.state import ml_artifacts
    svd = ml_artifacts.get("svd_model")
"""

# The ML model loaded at startup by main.py's lifespan context.
# Routers read from this dict; main.py writes to it.
ml_artifacts: dict = {}
