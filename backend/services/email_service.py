"""
backend/email_service.py — Flicker Email Service
=================================================
Handles transactional emails:
  - Password reset links
  - 2FA OTP codes (backup for users without an authenticator app)
  - Welcome emails (optional)

Uses FastAPI-Mail which supports Gmail SMTP (with App Password),
SendGrid, Mailgun, and any generic SMTP server out of the box.

SETUP (one-time, takes 2 minutes):
  1. Go to your Google Account → Security → 2-Step Verification → App Passwords
  2. Create a new App Password for "Mail" / "Other (Flicker)"
  3. Copy the 16-character app password into your .env file
  4. Never use your real Gmail password here
"""

import os
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType
from dotenv import load_dotenv

load_dotenv()

# ── Email Configuration ────────────────────────────────────────────────────────
# All values come from .env — never hardcode credentials in source code.
# Only configure email if credentials are present.
# If MAIL_USERNAME is empty, all send functions become silent no-ops so the app
# starts and works without SMTP configured (useful for local/dev environments).
_mail_enabled = bool(os.getenv("MAIL_USERNAME", "").strip())

if _mail_enabled:
    email_conf = ConnectionConfig(
        MAIL_USERNAME   = os.getenv("MAIL_USERNAME", ""),
        MAIL_PASSWORD   = os.getenv("MAIL_APP_PASSWORD", ""),
        MAIL_FROM       = os.getenv("MAIL_FROM", "noreply@flicker.app"),
        MAIL_FROM_NAME  = "Flicker 🎬",
        MAIL_PORT       = int(os.getenv("MAIL_PORT", "587")),
        MAIL_SERVER     = os.getenv("MAIL_SERVER", "smtp.gmail.com"),
        MAIL_STARTTLS   = True,
        MAIL_SSL_TLS    = False,
        USE_CREDENTIALS = True,
        VALIDATE_CERTS  = True,
    )
    fm = FastMail(email_conf)
else:
    email_conf = None
    fm = None


# ═══════════════════════════════════════════════════════════════
# TEMPLATES
# ═══════════════════════════════════════════════════════════════

def _password_reset_html(reset_link: str, expires_minutes: int = 15) -> str:
    """Return a clean, branded HTML email for password resets."""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; 
                background: #0A0A0A; color: #ffffff; padding: 40px; border-radius: 12px;">
        <h1 style="color: #FF3B30; font-size: 28px; margin-bottom: 8px;">🎬 Flicker</h1>
        <h2 style="font-size: 20px; font-weight: 400; margin-bottom: 24px;">Password Reset Request</h2>
        <p style="color: #cccccc; line-height: 1.6;">
            We received a request to reset your Flicker password. 
            Click the button below to choose a new one.
        </p>
        <a href="{reset_link}" 
           style="display: inline-block; background: #FF3B30; color: white; 
                  padding: 14px 28px; border-radius: 8px; text-decoration: none;
                  font-weight: bold; margin: 24px 0;">
            Reset My Password
        </a>
        <p style="color: #888888; font-size: 13px; margin-top: 24px;">
            This link expires in <strong>{expires_minutes} minutes</strong>. 
            If you didn't request a reset, you can safely ignore this email — 
            your password will not change.
        </p>
        <p style="color: #555555; font-size: 12px; margin-top: 16px;">
            Or copy and paste this URL into your browser:<br>
            <span style="color: #FF3B30;">{reset_link}</span>
        </p>
    </div>
    """


def _two_fa_code_html(code: str, expires_minutes: int = 10) -> str:
    """Return a clean HTML email for email-based 2FA codes."""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; 
                background: #0A0A0A; color: #ffffff; padding: 40px; border-radius: 12px;">
        <h1 style="color: #FF3B30; font-size: 28px; margin-bottom: 8px;">🎬 Flicker</h1>
        <h2 style="font-size: 20px; font-weight: 400; margin-bottom: 24px;">Your Verification Code</h2>
        <p style="color: #cccccc;">Enter this code to complete your sign-in:</p>
        <div style="background: #1a1a1a; border: 2px solid #FF3B30; border-radius: 12px; 
                    padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 48px; font-weight: bold; letter-spacing: 12px; 
                         color: #FF3B30; font-family: monospace;">{code}</span>
        </div>
        <p style="color: #888888; font-size: 13px;">
            This code expires in <strong>{expires_minutes} minutes</strong>. 
            Never share this code with anyone.
        </p>
    </div>
    """


def _welcome_html(username: str) -> str:
    """Return a welcome email for new registrations."""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; 
                background: #0A0A0A; color: #ffffff; padding: 40px; border-radius: 12px;">
        <h1 style="color: #FF3B30; font-size: 28px; margin-bottom: 8px;">🎬 Flicker</h1>
        <h2 style="font-size: 20px; font-weight: 400;">Welcome, {username}! 🎉</h2>
        <p style="color: #cccccc; line-height: 1.6;">
            Your Flicker account is ready. Start exploring personalized movie recommendations 
            crafted just for you using AI.
        </p>
        <p style="color: #888888; font-size: 13px; margin-top: 32px;">
            — The Flicker Team
        </p>
    </div>
    """


# ═══════════════════════════════════════════════════════════════
# SEND FUNCTIONS
# ═══════════════════════════════════════════════════════════════

async def send_password_reset_email(to_email: str, reset_link: str) -> None:
    """Send the password reset email. Called from the /auth/forgot-password endpoint."""
    if not fm:
        return  # SMTP not configured — skip silently
    message = MessageSchema(
        subject="Reset your Flicker password",
        recipients=[to_email],
        body=_password_reset_html(reset_link),
        subtype=MessageType.html,
    )
    await fm.send_message(message)


async def send_2fa_code_email(to_email: str, code: str) -> None:
    """Send a 6-digit email-based 2FA verification code."""
    if not fm:
        return  # SMTP not configured — skip silently
    message = MessageSchema(
        subject="Your Flicker verification code",
        recipients=[to_email],
        body=_two_fa_code_html(code),
        subtype=MessageType.html,
    )
    await fm.send_message(message)


async def send_welcome_email(to_email: str, username: str) -> None:
    """Send a welcome email to newly registered users."""
    if not fm:
        return  # SMTP not configured — skip silently
    message = MessageSchema(
        subject="Welcome to Flicker 🎬",
        recipients=[to_email],
        body=_welcome_html(username),
        subtype=MessageType.html,
    )
    await fm.send_message(message)
