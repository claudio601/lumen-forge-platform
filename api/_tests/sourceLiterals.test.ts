// api/_tests/sourceLiterals.test.ts
// El lector de literales de la guarda de textos del bot (sourceLiterals.ts). Se comparó una vez con el AST de
// TypeScript en todos los .ts de api/ (mismo texto y línea de cada literal); aquí quedan los casos difíciles.

import { describe, expect, it } from 'vitest';
import { sourceLiterals } from './sourceLiterals';

const texts = (code: string, covered?: Set<string>) =>
  sourceLiterals(code, covered).literals.map((l) => (l.skipped ? '(omitido) ' : '') + l.text);

describe('sourceLiterals', () => {
  it('interpreta los escapes (\\u, \\u{…}, \\x, \\n) y guarda el texto crudo', () => {
    const [lit] = sourceLiterals("const a = '\\u00a1Hola! \\u{1F44B}\\n\\x41';").literals;
    expect(lit.text).toBe('¡Hola! 👋\nA');
    expect(lit.raw).toBe("'\\u00a1Hola! \\u{1F44B}\\n\\x41'");
  });

  it('las comillas dentro de una expresión regular o de un comentario no abren un texto', () => {
    const code = [
      "const RE = /[\"'«]x\\/y/gi; // 'no es texto'",
      "/* \"tampoco\" */ const b = x / 2 / y;",
      "const c = (t) => /'/.test(t) ? 'uno dos' : \"tres cuatro\";",
    ].join('\n');
    expect(texts(code)).toEqual(['uno dos', 'tres cuatro']);
  });

  it('las plantillas con ${…} anidado dan sus trozos', () => {
    expect(texts('const t = `hola ${a ? `x ${b}` : { c: 1 }.c} fin`;')).toEqual(['hola ', 'x ', '', ' fin']);
  });

  it('omite console.*, RegExp, Error e import/export', () => {
    const code = [
      "import { a } from './modulo';",
      "export * from './otro';",
      "console.log('[x] un log ' + f('dentro del log'));",
      "throw new Error('un error largo');",
      "const r = new RegExp('una expresion');",
      "const ok = 'texto al cliente';",
    ].join('\n');
    expect(texts(code)).toEqual([
      '(omitido) ./modulo', '(omitido) ./otro', '(omitido) [x] un log ', '(omitido) dentro del log',
      '(omitido) un error largo', '(omitido) una expresion', 'texto al cliente',
    ]);
  });

  it('una constante cubierta: sus literales quedan omitidos y su declaración se devuelve entera', () => {
    const code = "export const A: string =\n  'uno ' +\n  'dos';\nexport const B = 'tres';";
    const res = sourceLiterals(code, new Set(['A']));
    expect(res.literals.map((l) => [l.text, l.skipped, l.line])).toEqual([['uno ', true, 2], ['dos', true, 3], ['tres', false, 4]]);
    expect(res.constants).toEqual([{ name: 'A', source: "A: string =\n  'uno ' +\n  'dos';" }]);
  });

  // (revisión 16-11) Sin ";" la declaración cubierta seguía hasta el próximo ";" y omitía los literales de las funciones
  // siguientes (un texto nuevo al cliente pasaba la guarda).
  it('una constante cubierta sin ";" termina donde empieza la declaración siguiente', () => {
    const code = [
      "export const A = 'uno ' +",
      "  'dos'",
      "export function f(): string { return 'texto nuevo'; }",
      "const B = 'tres'",
      "import { c } from './m'",
      "const D = 'cuatro';",
    ].join('\n');
    const res = sourceLiterals(code, new Set(['A', 'B']));
    expect(res.literals.map((l) => [l.text, l.skipped])).toEqual([['uno ', true], ['dos', true], ['texto nuevo', false], ['tres', true], ['./m', true], ['cuatro', false]]);
    expect(res.constants).toEqual([{ name: 'A', source: "A = 'uno ' +\n  'dos'" }, { name: 'B', source: "B = 'tres'" }]);
  });

  it('una palabra de declaración dentro de una expresión no corta la sentencia', () => {
    const res = sourceLiterals("export const A = 'uno ' +\n  // const en un comentario\n  'dos';\nconst b = 'tres';", new Set(['A']));
    expect(res.literals.map((l) => [l.text, l.skipped])).toEqual([['uno ', true], ['dos', true], ['tres', false]]);
  });

  it('index: dónde empieza cada literal en el código', () => {
    const code = "x.push('uno'); const t = `a ${b} c`;";
    expect(sourceLiterals(code).literals.map((l) => [l.text, code.slice(l.index, l.index + 1)])).toEqual([['uno', "'"], ['a ', '`'], [' c', '}']]);
  });
});
