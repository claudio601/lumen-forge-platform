// Historial en memoria; webhook.ts lo recupera y guarda en Upstash en cada turno.
// [CONCURRENCIA] Cada turno lleva el numero de orden de su mensaje (transcript.ts): el historial queda
// en el orden de llegada aunque un mensaje anterior termine despues, y dos instancias lo mezclan sin
// perder turnos. getHistory entrega solo rol y texto (lo que ve Claude).
// [TOPE] Cada texto se acota al entrar y al restaurar (4.096 letras, el maximo de un mensaje de WhatsApp).

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

/** Turno con su numero de orden (sin numero: guardado antes de este cambio, va primero). */
export interface SequencedTurn extends ConversationTurn {
    seq?: number;
}

export const MAX_TURNS = 12; // 6 pares user/assistant
export const MAX_TURN_TEXT = 4096;

// Map<phoneNumber, turns[]>
const conversations = new Map<string, SequencedTurn[]>();

export function clipTurnText(text: string): string {
    return text.length > MAX_TURN_TEXT ? text.slice(0, MAX_TURN_TEXT) + ' [...cortado]' : text;
}

function clean(turn: SequencedTurn): SequencedTurn {
    const out: SequencedTurn = { role: turn.role, content: clipTurnText(String(turn.content)) };
    if (typeof turn.seq === 'number' && Number.isFinite(turn.seq)) out.seq = turn.seq;
    return out;
}

export function getHistory(phone: string): ConversationTurn[] {
    return (conversations.get(phone) ?? []).map((t) => ({ role: t.role, content: t.content }));
}

/** [CONCURRENCIA] El historial con los numeros de orden (para guardarlo y mezclarlo). */
export function getHistoryEntries(phone: string): SequencedTurn[] {
    return (conversations.get(phone) ?? []).map((t) => ({ ...t }));
}

export function addTurn(phone: string, turn: ConversationTurn, seq?: number): void {
    const history = conversations.get(phone) ?? [];
    const entry = clean({ ...turn, ...(seq !== undefined ? { seq } : {}) });
    // [CONCURRENCIA] En su lugar por numero de orden; sin numero, al final (como antes).
    let at = history.length;
    if (entry.seq !== undefined) {
        while (at > 0 && history[at - 1].seq !== undefined && history[at - 1].seq! > entry.seq) at--;
    }
    history.splice(at, 0, entry);

  // Truncar si excede MAX_TURNS (eliminar los mas antiguos)
  while (history.length > MAX_TURNS) {
        history.shift();
  }

  conversations.set(phone, history);
}

export function clearHistory(phone: string): void {
    conversations.delete(phone);
}

/** Lo guardado con la forma de la memoria: los ultimos turnos, cada texto acotado. */
export function normalizeTurns(turns: SequencedTurn[]): SequencedTurn[] {
    return turns.slice(-MAX_TURNS).map(clean);
}

export function restoreHistory(phone: string, turns: SequencedTurn[]): void {
    conversations.set(phone, normalizeTurns(turns));
}
