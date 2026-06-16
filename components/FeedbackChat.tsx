"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface FeedbackChatProps {
  context: string;
  buttonLabel?: string;
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function FeedbackChat({ context, buttonLabel = "Help" }: FeedbackChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (open && !started) {
      setStarted(true);
      streamReply([{ role: "user", content: "Hi" }], true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function streamReply(toSend: Message[], isInit = false) {
    setStreaming(true);

    const payload = isInit
      ? [{ role: "user" as const, content: "Hi" }]
      : toSend;

    setMessages(prev => [
      ...(isInit ? [] : prev.slice(0, -1)),
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/build-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, context }),
      });
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: full };
          return updated;
        });
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: "Something went wrong." };
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const next = [...messages, userMsg, { role: "assistant" as const, content: "" }];
    setMessages(next);
    setInput("");
    await streamReply([...messages, userMsg]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function close() {
    setOpen(false);
    setMessages([]);
    setStarted(false);
    setInput("");
  }

  return (
    <>
      {/* Trigger — small, lowkey */}
      <button
        onClick={() => setOpen(true)}
        title="Ask Kimi"
        className="inline-flex items-center gap-1.5 text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter">
          <path d="M1 1h14v10H9l-3 3v-3H1z"/>
        </svg>
        <span className="text-2xs font-mono uppercase tracking-widest">{buttonLabel}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-[rgba(0,0,0,0.6)] z-40" onClick={close} aria-hidden="true" />

          <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-surface-1 border border-border-1 max-h-[85vh] lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[380px] lg:max-h-[520px]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-0">
              <div className="flex items-center gap-2.5">
                {/* F1 helmet icon */}
                <div className="w-6 h-6 bg-accent flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 9C2 5.5 3.5 2 7 2C10.5 2 12 5 12 8C12 9.5 11 11 9.5 11.5L9 12H5L4.5 11.5C3 11 2 10.5 2 9Z" fill="white"/>
                    <path d="M4.5 11.5H9.5V13H4.5V11.5Z" fill="white" opacity="0.5"/>
                    <rect x="2" y="8" width="10" height="1.5" fill="white" opacity="0.3"/>
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-mono font-semibold text-text-primary tracking-wide">KIMI</div>
                  <div className="text-2xs font-mono text-text-tertiary tracking-widest uppercase">PitStop Assistant</div>
                </div>
              </div>
              <button
                onClick={close}
                className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {messages.map((msg, i) => {
                const isLast = i === messages.length - 1;
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[82%] bg-accent text-white px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="flex justify-start gap-2">
                    <div className="w-5 h-5 bg-accent shrink-0 mt-0.5 flex items-center justify-center">
                      <span className="text-[9px] font-mono font-bold text-white">K</span>
                    </div>
                    <div className="max-w-[82%] text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                      {streaming && isLast && (
                        <span className="inline-block w-1 h-3.5 bg-text-tertiary ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask or leave feedback…"
                  rows={2}
                  className="flex-1 resize-none bg-surface-2 border border-border-1 text-text-primary placeholder:text-text-tertiary px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors font-sans"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || streaming}
                  className="shrink-0 w-9 h-9 flex items-center justify-center bg-accent hover:bg-accent-dim disabled:opacity-40 text-white transition-colors"
                >
                  {streaming ? <Spinner /> : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] font-mono text-text-tertiary opacity-60">
                Bwoah. Ask or leave feedback — I&apos;ll note it.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
