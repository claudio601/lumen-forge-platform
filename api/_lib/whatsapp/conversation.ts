// Historial en memoria; webhook.ts lo recupera y guarda en Upstash en cada turno.

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

const MAX_TURNS = 12; // 6 pares user/assistant

// Map<phoneNumber, turns[]>
const conversations = new Map<string, ConversationTurn[]>();

export function getHistory(phone: string): ConversationTurn[] {
    return [...(conversations.get(phone) ?? [])];
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

export function restoreHistory(phone: string, turns: ConversationTurn[]): void {
    conversations.set(phone, turns.slice(-MAX_TURNS));
}
