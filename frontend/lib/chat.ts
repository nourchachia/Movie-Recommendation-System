/**
 * frontend/lib/chat.ts
 * Wrappers for the Flicker backend AI Chatbot endpoints.
 */

const rawApi = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const API = rawApi.endsWith('/') ? rawApi.slice(0, -1) : rawApi;

export interface ChatSession {
  session_id: number;
  title: string;
  created_at: string;
  message_count: number;
  last_message_at: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface NewSessionResponse {
  session_id: number;
  title: string;
  created_at: string;
  welcome: string;
}

/** POST /api/chat/sessions — Start a new conversation */
export async function createChatSession(
  accessToken: string,
  title?: string
): Promise<NewSessionResponse> {
  const res = await fetch(`${API}/api/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ title: title ?? 'New Conversation' }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to create chat session');
  }
  return res.json();
}

/** GET /api/chat/sessions — List all your past conversations */
export async function getChatSessions(
  accessToken: string,
  limit: number = 50
): Promise<{ sessions: ChatSession[] }> {
  const res = await fetch(`${API}/api/chat/sessions?limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to list chat sessions');
  }
  return res.json();
}

/** GET /api/chat/sessions/{sid}/history — Get full message history */
export async function getSessionHistory(
  sessionId: number,
  accessToken: string
): Promise<{ session_id: number; title: string; messages: ChatMessage[] }> {
  const res = await fetch(`${API}/api/chat/sessions/${sessionId}/history`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to get session history');
  }
  return res.json();
}

/** DELETE /api/chat/sessions/{sid} — Delete a specific conversation */
export async function deleteChatSession(
  sessionId: number,
  accessToken: string
): Promise<void> {
  const res = await fetch(`${API}/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to delete session');
  }
}

/** POST /api/chat — Send a message to Flicker AI */
export async function sendChatMessage(
  sessionId: number,
  message: string,
  accessToken: string
): Promise<{ reply: string }> {
  const res = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to send chat message');
  }
  return res.json();
}

/** POST /api/chat/transcribe — Transcribe voice audio via Groq Whisper */
export async function transcribeAudio(
  audioBlob: Blob,
  accessToken: string
): Promise<{ transcript: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice.webm');

  const res = await fetch(`${API}/api/chat/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData, // do not set Content-Type manually with FormData
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Transcription failed');
  }
  return res.json();
}

/** DELETE /api/chat/history — Clear ALL chat history (nuclear option) */
export async function clearAllChatHistory(
  accessToken: string
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API}/api/chat/history`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.detail ?? 'Failed to clear chat history');
  }
  return res.json();
}
