import { NextResponse } from "next/server";

import { getLunaResponse } from "@/lib/server/luna";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId e message sao obrigatorios." },
        { status: 400 },
      );
    }

    const response = await getLunaResponse(sessionId, message);
    return NextResponse.json(response);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Erro inesperado.";
    console.error("[api/chat]", detail);

    return NextResponse.json(
      { error: detail || "Falha ao responder." },
      { status: 500 },
    );
  }
}
