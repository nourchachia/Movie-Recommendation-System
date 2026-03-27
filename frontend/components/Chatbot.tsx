'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle, X, Send, Mic, Square, PlusCircle, Trash2, Menu, Loader2
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import {
  ChatSession, ChatMessage, createChatSession, getChatSessions,
  getSessionHistory, deleteChatSession, sendChatMessage,
  transcribeAudio, clearAllChatHistory
} from '@/lib/chat';

export default function Chatbot() {
  const { user, accessToken } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Input
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Audio Recording
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Fetch list of sessions safely
  const fetchSessions = async () => {
    if (!accessToken) return;
    try {
      const data = await getChatSessions(accessToken);
      setSessions(data.sessions || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen && accessToken) {
      fetchSessions();
    }
  }, [isOpen, accessToken]);

  // Load a specific session's history
  useEffect(() => {
    if (!accessToken || !activeSessionId) {
      setMessages([]);
      return;
    }
    const loadHistory = async () => {
      try {
        const data = await getSessionHistory(activeSessionId, accessToken);
        setMessages(data.messages);
      } catch (e) {
        console.error('Failed to load history', e);
        setMessages([]);
      }
    };
    loadHistory();
  }, [activeSessionId, accessToken]);

  const handleNewSession = async () => {
    if (!accessToken) return;
    setIsLoading(true);
    try {
      const data = await createChatSession(accessToken);
      await fetchSessions();
      setActiveSessionId(data.session_id);
      setMessages([{ role: 'assistant', content: data.welcome, created_at: new Date().toISOString() }]);
      setIsSidebarOpen(false); // hide sidebar on mobile automatically
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!accessToken) return;
    if (!confirm('Delete this conversation?')) return;
    try {
      await deleteChatSession(id, accessToken);
      if (activeSessionId === id) setActiveSessionId(null);
      await fetchSessions();
    } catch (error) {
      console.error(error);
    }
  };

  const handleClearAll = async () => {
    if (!accessToken) return;
    if (!confirm('Are you sure you want to delete ALL chat history? This is irreversible.')) return;
    try {
      await clearAllChatHistory(accessToken);
      setSessions([]);
      setMessages([]);
      setActiveSessionId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const submitMessage = async (textToSend: string) => {
    if (!textToSend.trim() || !accessToken) return;

    // Start a new session if none exists
    let sid = activeSessionId;
    if (!sid) {
      const newSess = await createChatSession(accessToken);
      sid = newSess.session_id;
      setActiveSessionId(sid);
      // add the welcome msg
      setMessages([{ role: 'assistant', content: newSess.welcome, created_at: new Date().toISOString() }]);
    }

    const optimisticMsg: ChatMessage = {
      role: 'user', content: textToSend, created_at: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setIsLoading(true);

    try {
      const data = await sendChatMessage(sid, textToSend, accessToken);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, created_at: new Date().toISOString() }
      ]);
      fetchSessions(); // refresh the sidebar session summaries
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${e.message}`, created_at: new Date().toISOString() }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input;
    setInput('');
    await submitMessage(text);
  };

  // --- Audio Recording Logic ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

        setIsLoading(true);
        try {
          const { transcript } = await transcribeAudio(audioBlob, accessToken!);
          // Automatically send the transcribed text
          await submitMessage(transcript);
        } catch (e: any) {
          console.error(e);
          alert('Transcription failed: ' + e.message);
          setIsLoading(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Microphone exact error:', error);
      alert('Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  if (!user) return null; // Don't render if not logged in

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 rounded-full bg-[#E50914] hover:bg-[#FF1A1A] text-white shadow-lg shadow-[#E50914]/30 transition-all duration-300 ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100 hover:scale-105'}`}
        style={{ padding: '16px' }}
        aria-label="Open AI Chat"
      >
        <MessageCircle size={28} />
      </button>

      {/* Main Chat Overlay */}
      <div
        className={`fixed bottom-6 right-6 z-50 flex flex-col sm:flex-row shadow-2xl rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 transition-all duration-300 origin-bottom-right
          ${isOpen ? 'scale-100 opacity-100 pointer-events-auto w-[90vw] h-[75vh] sm:w-[800px] sm:h-[500px] max-w-5xl' : 'scale-75 opacity-0 pointer-events-none w-0 h-0'}
        `}
      >
        {isOpen && (
          <>
            {/* Sidebar (Session History) */}
            <div className={`flex flex-col border-r border-neutral-800 bg-neutral-950 transition-all duration-300 ${isSidebarOpen ? 'w-full sm:w-64' : 'hidden sm:flex sm:w-0 sm:overflow-hidden'}`}>
              <div className="border-b border-neutral-800 flex items-center justify-between min-w-[16rem]" style={{ padding: '16px' }}>
                <h3 className="font-semibold text-neutral-200">History</h3>
                <button onClick={handleNewSession} className="text-[#E50914] hover:text-[#FF1A1A] transition" title="Start New Chat">
                  <PlusCircle size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800" style={{ padding: '8px' }}>
                {sessions.length === 0 ? (
                  <p className="text-sm text-neutral-500 text-center" style={{ padding: '16px' }}>No past conversations.</p>
                ) : (
                  sessions.map(s => (
                    <div
                      key={s.session_id}
                      onClick={() => { setActiveSessionId(s.session_id); setIsSidebarOpen(false); }}
                      className={`group flex items-center justify-between rounded-xl mb-1 cursor-pointer transition-colors ${activeSessionId === s.session_id ? 'bg-[#E50914]/20 text-[#E50914]' : 'hover:bg-neutral-800 text-neutral-400'}`}
                      style={{ padding: '12px' }}
                    >
                      <div className="truncate" style={{ paddingRight: '8px' }}>
                        <div className="text-sm font-medium truncate">{s.title || 'New Conversation'}</div>
                        <div className="text-xs opacity-60 mt-1">{new Date(s.created_at).toLocaleDateString()} • {s.message_count} msgs</div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(e, s.session_id)}
                        className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {sessions.length > 0 && (
                <div className="border-t border-neutral-800 shrink-0 min-w-[16rem]" style={{ padding: '16px' }}>
                  <button onClick={handleClearAll} className="w-full flex items-center justify-center gap-2 text-sm text-neutral-500 hover:text-red-400 hover:bg-neutral-900 rounded-lg transition" style={{ padding: '8px 0' }}>
                    <Trash2 size={16} /> Clear All History
                  </button>
                </div>
              )}
            </div>

            {/* Main Chat Area */}
            <div className={`flex-1 flex flex-col bg-neutral-900 ${isSidebarOpen ? 'hidden sm:flex' : 'flex'}`}>

              {/* Header */}
              <div className="h-16 shrink-0 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md flex items-center justify-between" style={{ padding: '0 16px' }}>
                <div className="flex items-center gap-3">
                  <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="sm:hidden text-neutral-400 hover:text-white transition">
                    <Menu size={24} />
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#E50914]/20 flex items-center justify-center text-[#E50914] shrink-0">
                      <MessageCircle size={18} />
                    </div>
                    <div>
                      <h2 className="font-semibold text-neutral-100 text-sm leading-tight">Flicker AI</h2>
                      <p className="text-xs text-[#E50914] font-medium leading-tight">Your Movie Assistant</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="text-neutral-500 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-full transition" style={{ padding: '8px' }}>
                  <X size={20} />
                </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto space-y-6 scrollbar-thin scrollbar-thumb-neutral-700" style={{ padding: '24px' }}>
                {!activeSessionId && messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 space-y-4 max-w-sm mx-auto">
                    <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-600 mb-2">
                      <MessageCircle size={32} />
                    </div>
                    <p>Start a conversation to get personalized movie recommendations, genre deep-dives, and more.</p>
                    <button onClick={handleNewSession} className="bg-[#E50914] hover:bg-[#FF1A1A] text-white rounded-full font-medium transition shadow-lg shadow-[#E50914]/20" style={{ padding: '10px 24px' }}>
                      Start Talking
                    </button>
                  </div>
                ) : (
                  <>
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`
                            max-w-[85%] sm:max-w-[75%] rounded-2xl text-sm leading-relaxed
                            ${msg.role === 'user'
                              ? 'bg-[#E50914] text-white rounded-br-sm shadow-md'
                              : 'bg-neutral-800 text-neutral-200 rounded-bl-sm border border-neutral-700 shadow-sm'
                            }
                          `}
                          style={{ padding: '12px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-neutral-800 border border-neutral-700 rounded-2xl rounded-bl-sm flex items-center gap-2" style={{ padding: '16px 20px' }}>
                          <Loader2 size={18} className="animate-spin text-[#E50914]" />
                          <span className="text-neutral-400 text-sm animate-pulse w-24">Thinking...</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input Area */}
              <div className="shrink-0 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-md" style={{ padding: '16px' }}>
                <form
                  onSubmit={handleSendText}
                  className={`flex items-end gap-2 bg-neutral-950 border transition-colors rounded-2xl focus-within:border-[#E50914] focus-within:ring-1 focus-within:ring-[#E50914] ${isRecording ? 'border-red-500/50 bg-red-500/5' : 'border-neutral-700'}`}
                  style={{ padding: '8px 8px 8px 16px' }}
                >
                  <textarea
                    value={isRecording ? 'Listening...' : input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isRecording || isLoading}
                    placeholder="Ask about movies, genres, or actors..."
                    className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-0 resize-none text-[15px]"
                    style={{ padding: '12px 0' }}
                    rows={1}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (input.trim() && !isLoading && !isRecording) handleSendText(e);
                      }
                    }}
                  />

                  <div className="flex items-center gap-1 shrink-0 pb-1">
                    {/* Voice Record Button */}
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={isLoading}
                      className={`rounded-full transition-all ${isRecording
                        ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30'
                        : 'text-neutral-400 hover:text-[#E50914] hover:bg-neutral-800'
                        }`}
                      style={{ padding: '10px' }}
                      title={isRecording ? 'Stop Recording' : 'Voice Input (Groq Whisper)'}
                    >
                      {isRecording ? <Square size={20} className="fill-current" /> : <Mic size={20} />}
                    </button>

                    {/* Send Button */}
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading || isRecording}
                      className="rounded-full bg-[#E50914] text-white hover:bg-[#FF1A1A] disabled:opacity-50 disabled:bg-neutral-800 disabled:text-neutral-500 transition-colors"
                      style={{ padding: '10px' }}
                      title="Send Message"
                    >
                      {isLoading && !isRecording ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Send size={18} className="ml-0.5" />
                      )}
                    </button>
                  </div>
                </form>
                <div className="text-center mt-2 text-[11px] text-neutral-500 font-medium tracking-wide cursor-default">
                  POWERED BY GROQ & LLAMA 3
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
