// api/_lib/whatsapp/conversation.ts
// Historial conversacional en memoria por numero de telefono.
//
// LIMITACION CONOCIDA v1: Vercel Functions son stateless.
// Este Map vive en la instancia del proceso — el historial persiste
// mientras la instancia este caliente, pero se pierde en cold starts.
// Aceptable para v1. v2: migrar a Vercel KV o Redis.

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

const MAX_TURNS = 12; // 6 pares user/assistant

// Map<phoneNumber, turns[]>
const conversations = new Map<string, ConversationTurn[]>();

export function getHistory(phone: string): ConversationTurn[] {
    return conversations.get(phone) ?? [];
}

export function addTurn(phone: string, turn: ConversationTurn): void {
    const history = conversations.get(phone) ?? [];
    history.push(turn);

  // Truncar si excede MAX_TURNS (eliminar los mas antiguos)
  while (history.length > MAX_TURNS) {
        history.shift();
  }

  conversations.set(phone, history);
}

export function clearHistory(phone: string): void {
    conversations.delete(phone);
}
