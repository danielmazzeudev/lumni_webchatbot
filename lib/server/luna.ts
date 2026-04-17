import fs from "node:fs/promises";
import path from "node:path";

import nodemailer from "nodemailer";

type Role = "user" | "assistant";
type LeadIntent = "AGENDAR_CONSULTOR" | "ENVIAR_LEAD" | null;

type ChatHistoryItem = {
  role: Role;
  content: string;
};

type Lead = {
  chatId: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  interesse: string | null;
  detalhes: string | null;
  intencao: LeadIntent;
  emailEnviado: boolean;
  criadoEm: string;
};

type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
};

const SYSTEM_TEMPLATE = `Voce e a Luna, consultora virtual da Lumni.

REGRAS DE FORMATO:
- Maximo 2-3 frases curtas por mensagem. Isso e chat, nao email.
- Texto simples, sem markdown, sem emojis, sem listas.
- Portugues brasileiro, tom profissional e acolhedor.
- Uma pergunta por vez. Nunca faca duas perguntas na mesma mensagem.
- NUNCA comece sua resposta com "Luna:".

COMO CONDUZIR A CONVERSA:
1. Cumprimente e pergunte como pode ajudar.
2. Entenda o que o cliente precisa com perguntas curtas.
3. Apresente apenas o servico relevante, conectando ao problema dele.
4. Quando o cliente demonstrar interesse, colete TODOS os dados UM POR VEZ nesta ordem:
   a) Pergunte o que precisa / qual o interesse.
   b) Pergunte o nome.
   c) Pergunte o nome da empresa.
   d) Pergunte o email para enviar a proposta.
5. NAO encerre a conversa ate ter: interesse, nome, empresa e email.
6. Quando tiver TODOS os dados, agradeca e diga que a equipe entrara em contato.

COLETA DE DADOS - OBRIGATORIO:
Sempre que o cliente informar qualquer dado pessoal, voce DEVE incluir a tag abaixo no final.
Formato: [DADOS:campo=valor|campo2=valor2]
Campos possiveis: nome, email, telefone, empresa, interesse, detalhes

REGRAS DAS TAGS:
- SEMPRE inclua [DADOS:] quando o cliente informar nome, email, telefone, empresa ou interesse.
- Se o cliente disser apenas um nome, inclua [DADOS:nome=Nome].
- Se o cliente disser um email, inclua [DADOS:email=email@dominio.com].
- Inclua a tag no FINAL da resposta, nunca no meio.
- Nunca pule a tag.

ESTRATEGIA:
- Entenda a dor antes de oferecer solucao.
- Se perguntarem preco, diga que cada projeto e personalizado e ofereca montar uma proposta.
- Nunca pressione, conduza naturalmente.
- Nao invente informacoes fora da base de conhecimento.

ESTADO DO LEAD:
{leadState}

BASE DE CONHECIMENTO:
{context}

HISTORICO:
{history}

CLIENTE: {question}`;

const leads = new Map<string, Lead>();
const conversationHistory = new Map<string, ChatHistoryItem[]>();
let knowledgeCache = "";

function getOrCreateLead(chatId: string): Lead {
  if (!leads.has(chatId)) {
    leads.set(chatId, {
      chatId,
      nome: null,
      email: null,
      telefone: null,
      empresa: null,
      interesse: null,
      detalhes: null,
      intencao: null,
      emailEnviado: false,
      criadoEm: new Date().toISOString(),
    });
  }

  return leads.get(chatId)!;
}

function getLead(chatId: string) {
  return leads.get(chatId) ?? null;
}

function updateLead(chatId: string, data: Partial<Lead>) {
  const lead = getOrCreateLead(chatId);

  for (const [key, value] of Object.entries(data)) {
    if (value && key in lead) {
      (lead as Record<string, unknown>)[key] = value;
    }
  }

  return lead;
}

function markEmailSent(chatId: string) {
  const lead = getOrCreateLead(chatId);
  lead.emailEnviado = true;
}

function isReadyToSend(lead: Lead) {
  return Boolean(
    lead.intencao &&
      lead.nome &&
      lead.email &&
      lead.empresa &&
      lead.interesse &&
      !lead.emailEnviado,
  );
}

function formatLeadSummary(chatId: string) {
  const lead = getLead(chatId);
  if (!lead) {
    return "Nenhum dado coletado ainda.";
  }

  const lines: string[] = [];
  if (lead.nome) lines.push(`Nome: ${lead.nome}`);
  if (lead.email) lines.push(`Email: ${lead.email}`);
  if (lead.telefone) lines.push(`Telefone: ${lead.telefone}`);
  if (lead.empresa) lines.push(`Empresa: ${lead.empresa}`);
  if (lead.interesse) lines.push(`Interesse: ${lead.interesse}`);
  if (lead.detalhes) lines.push(`Detalhes: ${lead.detalhes}`);

  if (lead.intencao) {
    const faltam: string[] = [];
    if (!lead.interesse) faltam.push("interesse");
    if (!lead.nome) faltam.push("nome");
    if (!lead.empresa) faltam.push("empresa");
    if (!lead.email) faltam.push("email");

    if (faltam.length > 0) {
      lines.push(
        `ATENCAO: Cliente quer ${lead.intencao === "AGENDAR_CONSULTOR" ? "agendar consultor" : "orcamento"}. Falta coletar: ${faltam.join(", ")}. Pergunte UM POR VEZ.`,
      );
    } else {
      lines.push("Cliente ja forneceu todos os dados necessarios.");
    }
  }

  if (lead.emailEnviado) {
    lines.push("Solicitacao ja registrada. Nao peca mais dados.");
  }

  return lines.length > 0 ? lines.join("\n") : "Nenhum dado coletado ainda.";
}

function getHistory(chatId: string) {
  return conversationHistory.get(chatId) ?? [];
}

function addToHistory(chatId: string, role: Role, content: string) {
  const history = getHistory(chatId);
  history.push({ role, content });

  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  conversationHistory.set(chatId, history);
}

function formatHistory(chatId: string) {
  const history = getHistory(chatId);
  if (history.length === 0) {
    return "Primeira mensagem do cliente.";
  }

  return history
    .map((item) => `${item.role === "user" ? "Cliente" : "Luna"}: ${item.content}`)
    .join("\n");
}

async function loadKnowledge() {
  if (knowledgeCache) {
    return knowledgeCache;
  }

  const knowledgeDir = path.join(process.cwd(), "knowledge");
  const entries = await fs.readdir(knowledgeDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".txt"));
  const contents = await Promise.all(
    files.map(async (file) => {
      const fullPath = path.join(knowledgeDir, file.name);
      const content = await fs.readFile(fullPath, "utf8");
      return `ARQUIVO: ${file.name}\n${content.trim()}`;
    }),
  );

  knowledgeCache = contents.join("\n\n");
  return knowledgeCache;
}

function sanitize(str: string) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extractEmail(text: string) {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return match ? match[0] : null;
}

function extractPhone(text: string) {
  const match = text.match(/\(?\d{2}\)?\s*9\d{4}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}

function extractName(text: string, lead: Lead | null) {
  const msg = text.trim();
  const patterns = [
    /(?:meu nome|me chamo|sou o|sou a|pode me chamar de|aqui e o|aqui e a|eu sou o|eu sou a)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /^(?:sou|eu sou)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  if (lead && !lead.nome && lead.intencao) {
    const nameOnly = msg.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/);
    if (nameOnly) {
      return nameOnly[1];
    }
  }

  return null;
}

function extractNameFromAI(response: string, lead: Lead | null) {
  if (lead?.nome) {
    return null;
  }

  const patterns = [
    /(?:otimo|prazer|obrigado|obrigada|perfeito|certo|entendi),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[!.,]/i,
    /(?:ola|oi),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[!.,]/i,
  ];

  const falsePositives = new Set(["Lumni", "Luna", "Tudo", "Bom", "Boa", "Claro", "Sim"]);

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match && !falsePositives.has(match[1])) {
      return match[1].trim();
    }
  }

  return null;
}

function detectIntent(text: string): LeadIntent {
  const msg = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const agendamento = [
    "agendar",
    "agendamento",
    "marcar reuniao",
    "marcar uma conversa",
    "falar com alguem",
    "falar com consultor",
    "falar com especialista",
    "quero uma reuniao",
    "pode me ligar",
    "ligar para mim",
  ];

  const orcamento = [
    "orcamento",
    "proposta",
    "quanto custa",
    "qual o valor",
    "qual o preco",
    "quero contratar",
    "quero fechar",
    "vamos fechar",
    "quero comecar",
  ];

  for (const keyword of agendamento) {
    if (msg.includes(keyword)) {
      return "AGENDAR_CONSULTOR";
    }
  }

  for (const keyword of orcamento) {
    if (msg.includes(keyword)) {
      return "ENVIAR_LEAD";
    }
  }

  return null;
}

async function sendLeadEmails(lead: Lead) {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, LEAD_EMAIL_TO, SMTP_FROM_NAME, SMTP_FROM } =
    process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP nao configurado.");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const tipo = lead.intencao === "AGENDAR_CONSULTOR" ? "Agendamento" : "Orcamento";
  const tipoTexto =
    lead.intencao === "AGENDAR_CONSULTOR"
      ? "agendamento com nosso consultor"
      : "solicitacao de orcamento";
  const from = SMTP_FROM || `"${SMTP_FROM_NAME ?? "Lumni"}" <${SMTP_USER}>`;

  const emails: OutgoingEmail[] = [
    {
      to: LEAD_EMAIL_TO ?? "contato@lumni.dev.br",
      replyTo: lead.email ?? undefined,
      subject: `[Lumni] ${tipo} - ${lead.nome ?? "Lead WhatsApp"}`,
      html: `
        <h2>Novo lead via WhatsApp (Luna)</h2>
        <p><strong>Tipo:</strong> ${sanitize(tipo)}</p>
        <p><strong>Data:</strong> ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
        <hr>
        <p><strong>Nome:</strong> ${sanitize(lead.nome ?? "Nao informado")}</p>
        <p><strong>Email:</strong> ${sanitize(lead.email ?? "Nao informado")}</p>
        <p><strong>Telefone:</strong> ${sanitize(lead.telefone ?? lead.chatId)}</p>
        <p><strong>Empresa:</strong> ${sanitize(lead.empresa ?? "Nao informado")}</p>
        <p><strong>Interesse:</strong> ${sanitize(lead.interesse ?? "Nao informado")}</p>
        <p><strong>Detalhes:</strong> ${sanitize(lead.detalhes ?? "Nao informado")}</p>
      `,
    },
  ];

  if (lead.email) {
    const resumoLines = [];
    if (lead.interesse) resumoLines.push(`<strong>Servico:</strong> ${sanitize(lead.interesse)}`);
    if (lead.detalhes) resumoLines.push(`<strong>Detalhes:</strong> ${sanitize(lead.detalhes)}`);
    if (lead.empresa) resumoLines.push(`<strong>Empresa:</strong> ${sanitize(lead.empresa)}`);
    resumoLines.push(`<strong>Contato:</strong> ${sanitize(lead.email)}`);
    if (lead.telefone) resumoLines.push(`<strong>Telefone:</strong> ${sanitize(lead.telefone)}`);

    emails.push({
      to: lead.email,
      subject:
        lead.intencao === "AGENDAR_CONSULTOR"
          ? "Seu agendamento foi recebido — Lumni"
          : "Recebemos sua solicitacao — Lumni",
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #000000;">
          <div style="padding: 32px 24px; background: #000000; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 22px; color: #ffffff; font-weight: 700;">Lumni</h1>
          </div>
          <div style="padding: 32px 24px; background: #ffffff; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">
              Ola, ${sanitize(lead.nome ?? "cliente")}! Recebemos sua ${sanitize(tipoTexto)}.
            </p>
            <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">
              Nossa equipe esta analisando e entrara em contato em breve com uma proposta personalizada.
            </p>
            <div style="margin: 24px 0; padding: 16px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #000000;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">Resumo da sua solicitacao</p>
              <table style="width: 100%; border-collapse: collapse;">
                ${resumoLines.map((line) => `<tr><td style="padding: 4px 0; font-size: 14px; line-height: 1.5; color: #333;">${line}</td></tr>`).join("")}
              </table>
            </div>
            <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">
              Se precisar alterar algo, basta responder este email ou nos chamar no WhatsApp.
            </p>
            <p style="margin: 0; font-size: 15px; line-height: 1.6;">Obrigado por entrar em contato!</p>
          </div>
        </div>
      `,
    });
  }

  for (const email of emails) {
    await transporter.sendMail({
      from,
      to: email.to,
      replyTo: email.replyTo ?? undefined,
      subject: email.subject,
      html: email.html,
    });
  }
}

async function processResponse(chatId: string, rawResponse: string, clientMessage: string) {
  const lead = getOrCreateLead(chatId);

  const email = extractEmail(clientMessage);
  if (email) updateLead(chatId, { email });

  const telefone = extractPhone(clientMessage);
  if (telefone) updateLead(chatId, { telefone });

  const nome = extractName(clientMessage, lead);
  if (nome && !lead.nome) updateLead(chatId, { nome });

  const intent = detectIntent(clientMessage);
  if (intent) updateLead(chatId, { intencao: intent });

  for (const match of rawResponse.matchAll(/\[DADOS:([^\]]+)\]/g)) {
    const data: Partial<Lead> = {};

    for (const pair of match[1].split("|")) {
      const [key, ...rest] = pair.split("=");
      const parsedKey = key.trim();
      const parsedValue = rest.join("=").trim();

      if (parsedKey && parsedValue) {
        (data as Record<string, string>)[parsedKey] = parsedValue;
      }
    }

    if (Object.keys(data).length > 0) {
      updateLead(chatId, data);
    }
  }

  for (const match of rawResponse.matchAll(/\[ACAO:([A-Z_]+)\]/g)) {
    updateLead(chatId, { intencao: match[1] as LeadIntent });
  }

  const currentLead = getLead(chatId);
  if (!currentLead?.nome) {
    const fallbackName = extractNameFromAI(rawResponse, currentLead);
    if (fallbackName) {
      updateLead(chatId, { nome: fallbackName });
    }
  }

  let cleanResponse = rawResponse
    .replace(/\[\s*(ACAO|ESTAGIO|DADOS)\s*:\s*[^\]]*\]\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const updatedLead = getOrCreateLead(chatId);
  if (isReadyToSend(updatedLead)) {
    try {
      await sendLeadEmails(updatedLead);
      markEmailSent(chatId);
      cleanResponse =
        updatedLead.intencao === "AGENDAR_CONSULTOR"
          ? `Perfeito, ${updatedLead.nome}! Seu agendamento foi registrado. Nossa equipe entrara em contato em breve para combinar o melhor horario. Obrigada por falar com a Lumni!`
          : `Perfeito, ${updatedLead.nome}! Sua solicitacao foi registrada. Nossa equipe entrara em contato em breve com uma proposta personalizada. Obrigada por falar com a Lumni!`;
    } catch (error) {
      console.error("[luna] Falha ao enviar lead:", error);
      cleanResponse = `${updatedLead.nome ?? "Cliente"}, tivemos um problema tecnico ao registrar sua solicitacao. Por favor, envie um email para contato@lumni.dev.br ou tente novamente em alguns minutos.`;
    }
  }

  return cleanResponse;
}

async function callOpenAI(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Falha ao consultar o modelo: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function getLunaResponse(chatId: string, message: string) {
  getOrCreateLead(chatId);
  addToHistory(chatId, "user", message);

  const knowledge = await loadKnowledge();
  const prompt = SYSTEM_TEMPLATE
    .replace("{leadState}", formatLeadSummary(chatId))
    .replace("{context}", knowledge)
    .replace("{history}", formatHistory(chatId))
    .replace("{question}", message);

  const rawResponse = await callOpenAI(prompt);
  const response = await processResponse(chatId, rawResponse, message);
  addToHistory(chatId, "assistant", response);

  return {
    response,
    lead: getLead(chatId),
  };
}
