// api/_tests/sourceLiterals.ts
// Lee los literales de texto ('…', "…" y los trozos de `…`) de un archivo .ts, sin el compilador de TypeScript:
// cargarlo en la suite (unos 400 ms de CPU) hacía fallar las pruebas de tiempo de summary.test.ts. Lo usa la guarda
// de los textos del bot (api/_lib/whatsapp/ownerApprovedTexts.test.ts).
// Alcance: el estilo de este repo (comentarios, expresiones regulares, plantillas con ${…}, sentencias con ";"; sin ";"
// la sentencia termina donde empieza la siguiente declaración del mismo nivel: export, import, const, function…). Deja
// marcados como omitidos los literales dentro de console.*(…), RegExp(…) y Error(…), los de import/export y los de la
// declaración de una constante de `covered` (esas se revisan enteras aparte). No es una prueba ni una función: vive
// en api/_tests/ para que Vercel no lo despliegue.

export interface SourceLiteral {
  /** El texto ya interpretado (los escapes \u, \n… convertidos). */
  text: string;
  /** Tal como está en el código, con las comillas. */
  raw: string;
  line: number;
  /** Dónde empieza en el código (la comilla de apertura, o la } que reanuda una plantilla). */
  index: number;
  /** Dentro de console.*, RegExp, Error, import/export o la declaración de una constante de `covered`. */
  skipped: boolean;
}

export interface SourceConstant {
  name: string;
  /** El código de la declaración, desde el nombre hasta el ";" (o hasta la declaración siguiente, si no lo lleva). */
  source: string;
}

const SKIPPED_CALLEES = new Set(['RegExp', 'Error']);
/** Después de estas palabras, una "/" empieza una expresión regular (no es una división). */
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
/**
 * (revisión 16-11) Palabras que empiezan otra declaración: una sentencia abierta (import/export … from, o la
 * declaración de una constante cubierta) sin ";" termina ahí, en su mismo nivel. Antes seguía hasta el próximo ";" y
 * dejaba omitidos los literales de las funciones que venían después.
 */
const STATEMENT_WORDS = new Set(['export', 'import', 'const', 'let', 'var', 'function', 'class', 'interface', 'enum', 'declare']);

function decode(body: string): string {
  return body.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r\n|[\s\S])/g, (_m, esc: string, cp?: string, u4?: string, x2?: string) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    switch (esc) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      case '\n': case '\r\n': return '';
      default: return esc;
    }
  });
}

interface Frame { close: string; skip: boolean; template?: boolean }

/** Los literales de texto del código, en orden, y las declaraciones de las constantes de `covered`. */
export function sourceLiterals(code: string, covered: ReadonlySet<string> = new Set()): { literals: SourceLiteral[]; constants: SourceConstant[] } {
  const literals: SourceLiteral[] = [];
  const constants: SourceConstant[] = [];
  const stack: Frame[] = [];
  /** Las últimas palabras y signos (sin comentarios ni espacios). */
  const tokens: string[] = [];
  let lastKind: 'word' | 'value' | 'punct' | 'none' = 'none';
  /** La sentencia import/export … from o la declaración cubierta: hasta su ";" en esta profundidad. */
  let statement: { depth: number; start: number; name?: string } | undefined;
  let line = 1;
  let i = 0;

  const skipping = () => statement !== undefined || stack.some((f) => f.skip);
  /** Cierra la sentencia abierta en `end` (su ";" o el comienzo de la declaración siguiente). */
  const closeStatement = (end: number) => {
    if (statement?.name) constants.push({ name: statement.name, source: code.slice(statement.start, end).trimEnd() });
    statement = undefined;
  };
  // Leido con una funcion: TypeScript no ve que push() lo cambia y lo daria siempre por 'none'.
  const lastKindNow = (): typeof lastKind => lastKind;
  const push = (token: string, kind: typeof lastKind) => {
    tokens.push(token);
    if (tokens.length > 4) tokens.shift();
    lastKind = kind;
  };
  const addLiteral = (start: number, end: number, body: string, startLine: number) => {
    literals.push({ text: decode(body), raw: code.slice(start, end), line: startLine, index: start, skipped: skipping() });
  };
  /** Lee el texto de una plantilla desde i (después de ` o de }) hasta ` o ${. */
  const readTemplateChunk = () => {
    const start = i - 1;
    const startLine = line;
    let body = '';
    while (i < code.length) {
      const c = code[i];
      if (c === '\\') { body += code.slice(i, i + 2); if (code[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '`') { i++; addLiteral(start, i, body, startLine); push('`', 'value'); return; }
      if (c === '$' && code[i + 1] === '{') {
        i += 2;
        addLiteral(start, i, body, startLine);
        stack.push({ close: '}', skip: false, template: true });
        push('${', 'punct');
        return;
      }
      if (c === '\n') line++;
      body += c;
      i++;
    }
  };

  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && next === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? code.length : end + 2;
      for (let k = i; k < stop; k++) if (code[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      const startLine = line;
      i++;
      let body = '';
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') { body += code.slice(i, i + 2); if (code[i + 1] === '\n') line++; i += 2; continue; }
        body += code[i];
        i++;
      }
      i++;
      const fromImport = tokens[tokens.length - 1] === 'from' || tokens[tokens.length - 1] === 'import';
      if (fromImport && !statement) statement = { depth: stack.length, start };
      addLiteral(start, i, body, startLine);
      push(c, 'value');
      continue;
    }
    if (c === '`') { i++; readTemplateChunk(); continue; }
    if (c === '/') {
      const prev = tokens[tokens.length - 1];
      const regexHere = lastKind === 'none' || lastKind === 'punct' && prev !== ')' && prev !== ']' || lastKind === 'word' && REGEX_AFTER_WORDS.has(prev);
      if (regexHere) {
        i++;
        let inClass = false;
        while (i < code.length) {
          const r = code[i];
          if (r === '\\') { i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          i++;
        }
        i++;
        while (i < code.length && /[a-z]/i.test(code[i])) i++;
        push('/regex/', 'value');
        continue;
      }
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 80));
    if (word) {
      const w = word[0];
      // Sin ";": la sentencia abierta termina si su expresión ya puede terminar (después de un valor, una palabra o un
      // cierre) y empieza otra declaración en su mismo nivel.
      const prev = tokens[tokens.length - 1];
      const kind = lastKindNow();
      const ended = kind === 'value' || kind === 'word' || (kind === 'punct' && (prev === ')' || prev === ']' || prev === '}'));
      if (statement && stack.length === statement.depth && ended && STATEMENT_WORDS.has(w)) closeStatement(i);
      i += w.length;
      if (w === 'import' && stack.length === 0 && !statement) statement = { depth: 0, start: i };
      push(w, 'word');
      continue;
    }
    const num = /^\d[\w.]*/.exec(code.slice(i, i + 40));
    if (num) { i += num[0].length; push(num[0], 'value'); continue; }
    // Signos.
    if (c === '(' || c === '[' || c === '{') {
      const t = tokens;
      const callee = t[t.length - 1];
      const skipCall = c === '(' && (SKIPPED_CALLEES.has(callee) || (t[t.length - 3] === 'console' && t[t.length - 2] === '.'));
      stack.push({ close: c === '(' ? ')' : c === '[' ? ']' : '}', skip: skipCall });
      push(c, 'punct');
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const frame = stack.pop();
      i++;
      if (frame?.template) { readTemplateChunk(); continue; }
      push(c, 'punct');
      continue;
    }
    if (c === '=' && next !== '=' && next !== '>' && !statement) {
      // "const NOMBRE =" o "const NOMBRE: tipo =": la declaración de una constante cubierta.
      const t = tokens;
      const name = t[t.length - 2] === ':' ? t[t.length - 3] : t[t.length - 1];
      const declared = t.includes('const') || t.includes('let');
      if (name && covered.has(name) && declared) statement = { depth: stack.length, start: code.lastIndexOf(name, i), name };
    }
    if (c === ';' && statement && stack.length === statement.depth) closeStatement(i + 1);
    push(c, 'punct');
    i++;
  }
  return { literals, constants };
}
