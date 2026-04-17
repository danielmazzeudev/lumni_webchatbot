"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";

import "./Chatbot.css";

type Message = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

export function Chatbot() {
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Olá! Eu sou a Luna, consultora virtual da Lumni. Como posso ajudar você hoje?",
    },
  ]);
  const answersRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef("");

  useEffect(() => {
    const sessionId = window.localStorage.getItem("luna-session-id") ?? crypto.randomUUID();
    sessionIdRef.current = sessionId;
    window.localStorage.setItem("luna-session-id", sessionId);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!answersRef.current) return;
    answersRef.current.scrollTop = answersRef.current.scrollHeight;
  }, [messages, loading]);

  const resetConversation = () => {
    const nextSessionId = crypto.randomUUID();
    sessionIdRef.current = nextSessionId;
    window.localStorage.setItem("luna-session-id", nextSessionId);
    setCooldown(0);
    setQuestion("");
    setMessages([
      {
        id: "welcome-reset",
        role: "assistant",
        content: "Conversa reiniciada. Me conte rapidamente o que você precisa e eu sigo com você.",
      },
    ]);
  };

  const handleSuggestion = (value: string) => {
    setQuestion(value);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (!question.trim() || loading || cooldown > 0) return;

    const currentQuestion = question.trim();
    setQuestion("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: currentQuestion,
      },
    ]);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: currentQuestion,
        }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Falha ao consultar a Luna.");
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: String(data.response),
        },
      ]);
      setCooldown(4);
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "A resposta demorou mais do que o esperado. Tente novamente em instantes."
          : "Tive um problema técnico para responder agora. Tente novamente em instantes.";

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  return (
    <main className="luna-shell">
      <section className="luna-stage luna-stage-single">
        <section className="luna-chat glass-panel">
          <header className="chat-header">
            <div className="chat-title">
              <div className="chat-avatar">
                <Image
                  src="/logo_inverse.png"
                  alt="Lumni"
                  fill
                  sizes="44px"
                  className="chat-avatar-image"
                />
              </div>
              <div>
                <strong>Luna</strong>
                <span>Atendimento inteligente da Lumni</span>
              </div>
            </div>

            <button type="button" className="ghost-button" onClick={resetConversation}>
              <RotateCcw size={16} />
              Reiniciar
            </button>
          </header>

          <div className="chat-hero">
            <div className="chat-hero-copy">
              <div className="luna-badge">
                <Sparkles size={14} />
                Atendimento online
              </div>
              <h1>Fale com a Luna e vá direto ao que importa.</h1>
              <p>
                Tire dúvidas, explique sua necessidade e receba o atendimento certo sem passar por uma
                página de apresentação disfarçada de chat.
              </p>
            </div>
            <div className="chat-hero-aside">
              <span>Respostas objetivas</span>
              <span>Uma pergunta por vez</span>
              <span>Contato comercial organizado</span>
            </div>
          </div>

          <div className="chat-messages" ref={answersRef}>
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message-bubble ${
                  message.role === "user" ? "message-user" : "message-assistant"
                }`}
              >
                <span className="message-author">{message.role === "user" ? "Você" : "Luna"}</span>
                <p>{message.content}</p>
              </article>
            ))}

            {loading ? (
              <article className="message-bubble message-assistant">
                <span className="message-author">Luna</span>
                <p className="thinking">
                  <LoaderCircle size={16} className="spin" />
                  Pensando na melhor resposta...
                </p>
              </article>
            ) : null}
          </div>

          <div className="chat-suggestions">
            <button type="button" onClick={() => handleSuggestion("Preciso de uma proposta para dashboards.")}>
              Quero dashboards
            </button>
            <button
              type="button"
              onClick={() => handleSuggestion("Quero entender como vocês podem integrar meus sistemas.")}
            >
              Integrar sistemas
            </button>
            <button
              type="button"
              onClick={() => handleSuggestion("Quero falar sobre IA customizada para minha empresa.")}
            >
              IA customizada
            </button>
          </div>

          <form className="chat-form" onSubmit={handleSubmit}>
            <label htmlFor="luna-message" className="sr-only">
              Digite sua mensagem
            </label>
            <textarea
              id="luna-message"
              maxLength={800}
              placeholder="Escreva sua mensagem aqui..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />

            <div className="chat-form-footer">
              <span>{question.length} / 800</span>
              <button type="submit" className="send-button" disabled={loading || !question.trim() || cooldown > 0}>
                {cooldown > 0 ? `Aguarde ${cooldown}s` : "Enviar"}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
