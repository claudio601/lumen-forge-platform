// api/_lib/whatsapp/flowCantidad.test.ts
// Bot de WhatsApp, PR 2 del plan: la cantidad y los datos ya capturados no se inventan ni se pisan.
// - §10 (T1, T2, T3, T7, T11, T12, T13 y T17), con mensajes parecidos e inventados.
// - La prueba del dueño del 16-10: la razón social, el RUT y el correo no tocan la cantidad (30)
//   ni el proyecto (oficina).
// - Varios ítems o números que no son unidades dejan la cantidad vacía.
// - CASO-1: un "1" después de una lista numerada se aclara; "20, luz fría" deja los dos datos.
// - Un dato ya capturado solo cambia con un dato explícito, y el cambio queda anotado.
// - "Soy instalador…" con productos va al flujo de productos; un RUT no es teléfono.
// Cada caso corre con un Claude simulado que acierta y con otro que se equivoca.
// Solo datos inventados: RUT de prueba con dígito válido (módulo 11) y correos @example.com.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000501';
type Claude = Parameters<typeof flow.processFlowStep>[2];
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, NO_SIGNALS);

afterEach(() => flow.clearFlowState(PHONE));

describe('§10: el primer mensaje', () => {
  const cases: Array<{ id: string; body: string; right: Claude; wrong: Claude; cantidad: string | undefined }> = [
    { id: 'T1', body: 'Hola, mi correo es 123prueba.99@example.com', right: { correo: '123prueba.99@example.com' }, wrong: { correo: '123prueba.99@example.com', cantidad: '123' }, cantidad: undefined },
    { id: 'T2', body: 'Necesito panel redondo embutido 15W', right: { producto: 'panel redondo embutido' }, wrong: { producto: 'panel redondo embutido', cantidad: '15' }, cantidad: undefined },
    { id: 'T3', body: 'Busco paneles 120x60, son 8, regulables', right: { producto: 'paneles 120x60', cantidad: '8' }, wrong: { producto: 'paneles 120x60', cantidad: '120' }, cantidad: '8' },
    { id: 'T7', body: 'Hola, necesito 400 plafones', right: { producto: 'plafones', cantidad: '400' }, wrong: { producto: 'plafones', cantidad: '40' }, cantidad: '400' },
    { id: 'T11', body: 'Quiero cotizar 25 BESTLED para un pasaje en Talca', right: { producto: 'BESTLED', cantidad: '25', comuna_o_ciudad: 'Talca' }, wrong: { producto: 'BESTLED', cantidad: 'no especificada' }, cantidad: '25' },
    { id: 'T17', body: 'Quiero algo parecido al modelo PRUEBA12345, 12 unidades', right: { producto: 'similar a PRUEBA12345', cantidad: '12' }, wrong: { producto: 'similar a PRUEBA12345', cantidad: '12345' }, cantidad: '12' },
    { id: 'una potencia', body: 'Necesito 30 paneles de 18W', right: { producto: 'paneles 18W', cantidad: '30' }, wrong: { producto: 'paneles 18W', cantidad: '18' }, cantidad: '30' },
  ];

  for (const c of cases) {
    for (const [who, claude] of [['acierta', c.right], ['se equivoca', c.wrong]] as const) {
      it(`${c.id} (Claude ${who}) → cantidad ${c.cantidad ?? 'vacía'}`, () => {
        const r = step(c.body, claude);
        expect(r.captured.cantidad).toBe(c.cantidad);
        if (!c.cantidad) expect(r.reply).toMatch(/cantidad de unidades/i);
        flow.clearFlowState(PHONE);
      });
    }
  }

  it('T1: el correo se guarda tal cual', () => {
    expect(step('Hola, mi correo es 123prueba.99@example.com', {}).captured.correo).toBe('123prueba.99@example.com');
  });
});

describe('varios ítems o números que no son unidades', () => {
  // Varias cantidades: la cantidad queda vacía, el texto va a la nota y no se vuelve a preguntar.
  for (const body of ['Necesito 30 paneles de 18W y 20 de 24W', 'necesito 2 de 60x60 y 3 de 120x60']) {
    for (const [who, claude] of [['acierta', {}], ['se equivoca', { cantidad: body.match(/\d+/)?.[0] }]] as const) {
      it(`"${body}" (Claude ${who}) → cantidad vacía, texto para la nota y sin repreguntarla`, () => {
        const r = step(body, { producto: 'paneles', ...claude });
        expect(r.captured.cantidad).toBeUndefined();
        expect(r.captured.cantidad_varios).toBe(body);
        expect(r.reply).not.toMatch(/cantidad de unidades/i);
        flow.clearFlowState(PHONE);
      });
    }
  }

  for (const body of ['necesito 2 cotizaciones', 'busco 2 tipos de paneles']) {
    for (const [who, claude] of [['acierta', {}], ['se equivoca', { cantidad: '2' }]] as const) {
      it(`"${body}" (Claude ${who}) → cantidad vacía y el bot la pregunta`, () => {
        const r = step(body, { producto: 'paneles', ...claude });
        expect(r.captured.cantidad).toBeUndefined();
        expect(r.captured.cantidad_varios).toBeUndefined();
        expect(r.reply).toMatch(/cantidad de unidades/i);
        flow.clearFlowState(PHONE);
      });
    }
  }
});

describe('la prueba del dueño del 16-10: razón social, RUT y correo en un mensaje', () => {
  const FIRST = 'Necesito 30 paneles 60x60 luz neutra para una oficina en Providencia';
  const FIRST_CLAUDE = { producto: 'paneles 60x60', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' };
  const DATA = 'Comercial Prueba SpA, RUT 77.123.456-9, compras@comercial-prueba.example.com';
  const claudes: Array<[string, Claude]> = [
    ['acierta', { empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com' }],
    ['lee "Spa" como proyecto y el RUT como cantidad', { empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com', proyecto_o_uso: 'Spa', cantidad: '77123456' }],
    ['toma el dígito verificador y la empresa', { empresa: 'Comercial Prueba SpA', correo: 'compras@comercial-prueba.example.com', proyecto_o_uso: 'Comercial Prueba', cantidad: '9' }],
  ];

  for (const [who, claude] of claudes) {
    it(`Claude ${who}: cantidad 30, proyecto oficina y cierra registrando`, () => {
      const first = step(FIRST, FIRST_CLAUDE);
      expect(first.reply).toBe(flow.MSG3_B2B);
      const r = step(DATA, claude);
      expect(r.captured).toMatchObject({ cantidad: '30', proyecto_o_uso: 'oficina', rut: '77.123.456-9', rut_valido: true });
      expect(r.captured.cambios).toBeUndefined();
      expect(r.reply).toBe(flow.MSG4_B2B);
      expect(r.shouldCreateDeal).toBe(true);
    });
  }

  it('T13: el RUT que no calza se pide de nuevo y no toca la cantidad', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('RUT 77.123.456-8', { cantidad: '77123456' });
    expect(r.reply).toBe(flow.MSG_RUT_INVALID);
    expect(r.captured.cantidad).toBe('30');
    const again = step('771234569', { cantidad: '771234569' });
    expect(again.captured).toMatchObject({ cantidad: '30', rut: '77.123.456-9', rut_valido: true });
  });
});

describe('CASO-1 y respuestas agrupadas', () => {
  const START = 'busco focos LED para una bodega';
  const START_CLAUDE = { producto: 'focos LED', proyecto_o_uso: 'bodega' };

  it('el bot pregunta el color y la cantidad en una lista de 2', () => {
    const r = step(START, START_CLAUDE);
    expect(r.reply).toMatch(/1\) Tipo de luz preferida\n2\) Cantidad de unidades/);
  });

  for (const [who, claude] of [['acierta', {}], ['se equivoca', { cantidad: '1' }]] as const) {
    it(`"1" después de la lista (Claude ${who}) pide aclarar y no salta a la comuna`, () => {
      step(START, START_CLAUDE);
      const r = step('1', claude);
      expect(r.reply).toBe(flow.menuClarifyMsg(1));
      expect(r.reply).toBe('¿Me confirmas a qué te refieres con «1»? Cuéntame qué producto buscas, cuántas unidades y el color de luz.');
      expect(r.captured.cantidad).toBeUndefined();
      expect(flow.getFlowState(PHONE).stage).toBe('stage1');
    });
  }

  for (const [who, claude] of [['acierta', { cantidad: '20', tipo_de_luz: 'fría' }], ['no ve nada', {}]] as const) {
    it(`después, "20, luz fría" (Claude ${who}) deja 20 y fría, y sigue con la comuna`, () => {
      step(START, START_CLAUDE);
      step('1', {});
      const r = step('20, luz fría', claude);
      expect(r.captured.cantidad).toBe('20');
      expect(r.captured.tipo_de_luz).toMatch(/^fr[ií]a$/);
      expect(r.reply).toMatch(/comuna/);
      expect(r.reply).not.toMatch(/luz|cantidad/i);
    });
  }

  it('"20, luz fría" vale también directo, sin el "1"', () => {
    step(START, START_CLAUDE);
    const r = step('20, luz fría', {});
    expect(r.captured).toMatchObject({ cantidad: '20', tipo_de_luz: 'fria' });
  });

  it('un número mayor que la lista es la cantidad', () => {
    step(START, START_CLAUDE);
    expect(step('3', {}).captured.cantidad).toBe('3');
  });

  it('con solo la cantidad, el color pendiente se pregunta junto con la comuna', () => {
    step(START, START_CLAUDE);
    const r = step('20', {});
    expect(r.captured.cantidad).toBe('20');
    expect(r.reply).toMatch(/tipo de luz preferida/);
    expect(r.reply).toMatch(/comuna o ciudad de instalacion/);
  });

  it('después del saludo (lista de 3), "2" pide aclarar', () => {
    expect(step('Hola', {}).reply).toBe(flow.MSG1);
    expect(step('2', { cantidad: '2' }).reply).toBe(flow.menuClarifyMsg(2));
  });

  it('si el bot preguntó solo la cantidad (sin lista), "1" es la cantidad', () => {
    step('Necesito focos LED luz cálida', { producto: 'focos LED', tipo_de_luz: 'cálida' });
    expect(step('1', {}).captured.cantidad).toBe('1');
  });

  it('si la pregunta no era por la cantidad, un número suelto no la cambia', () => {
    expect(step('Necesito focos LED luz cálida, son 10', { producto: 'focos LED', tipo_de_luz: 'cálida', cantidad: '10' }).reply).toBe(flow.MSG2);
    const r = step('30', { cantidad: '30' });
    expect(r.captured.cantidad).toBe('10');
    expect(r.captured.cambios).toBeUndefined();
  });
});

describe('B2: la cantidad es un entero o nada', () => {
  const values: unknown[] = [{ paneles: 20, focos: 10 }, [20, 10], '30', 30, 2.5, 'no especificada'];
  for (const value of values) {
    it(`Claude devuelve ${JSON.stringify(value)}`, () => {
      const r = step('para la bodega, 30', { producto: 'focos LED', cantidad: value as string });
      expect(r.captured.cantidad === undefined || /^\d+$/.test(r.captured.cantidad)).toBe(true);
      expect(typeof r.captured.cantidad === 'string' || r.captured.cantidad === undefined).toBe(true);
      expect(r.captured.cantidad).toBe(value === '30' || value === 30 ? '30' : undefined);
    });
  }
});

describe('no pisar lo ya capturado', () => {
  it('la cantidad solo cambia con una cantidad explícita, y queda anotado', () => {
    step('Necesito 2 paneles LED 60x60', { producto: 'paneles LED 60x60', cantidad: '2' });
    expect(step('gracias', { cantidad: '5' }).captured.cantidad).toBe('2');
    const r = step('mejor que sean 3 paneles', { cantidad: '3' });
    expect(r.captured.cantidad).toBe('3');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 2, ahora 3']);
  });

  it('el color, el producto, el proyecto y la comuna de Claude no pisan sin un dato explícito', () => {
    step('Necesito 10 paneles LED luz neutra para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    const r = step('ok, gracias', { producto: 'focos', tipo_de_luz: 'cálida', proyecto_o_uso: 'Spa', comuna_o_ciudad: 'Maipú' });
    expect(r.captured).toMatchObject({ producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it('un color explícito sí cambia, una sola vez, y queda anotado', () => {
    step('Necesito 10 paneles LED luz neutra', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10' });
    const r = step('mejor luz cálida', { tipo_de_luz: 'cálida' });
    expect(r.captured.tipo_de_luz).toBe('calida');
    expect(r.captured.cambios).toEqual(['Tipo de luz: antes neutra, ahora calida']);
    expect(step('sí, cálida', { tipo_de_luz: 'cálida' }).captured.cambios).toEqual(['Tipo de luz: antes neutra, ahora calida']);
  });

  it('"Spa" como primer proyecto no se toma; "para un spa", sí', () => {
    expect(step('Necesito 10 focos LED, somos Prueba SpA', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'SpA', empresa: 'Prueba SpA' }).captured.proyecto_o_uso).toBeUndefined();
    flow.clearFlowState(PHONE);
    expect(step('Necesito 10 focos LED para un spa', { producto: 'focos LED', cantidad: '10', proyecto_o_uso: 'spa' }).captured.proyecto_o_uso).toBe('spa');
  });
});

describe('instalación', () => {
  for (const [who, claude] of [['acierta', { producto: 'paneles 60x60', tipo_de_luz: 'neutra', cantidad: '50' }], ['no ve nada', {}]] as const) {
    it(`T-INST-3: "soy instalador eléctrico" con productos (Claude ${who}) va al flujo de productos, con 50`, () => {
      const r = step('soy instalador eléctrico, necesito 50 paneles 60x60 luz neutra', claude);
      expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
      expect(flow.getFlowState(PHONE).stage).not.toBe('install_capture');
      expect(r.captured.cantidad).toBe('50');
    });
  }

  it('"busco un instalador" sí es una solicitud de instalación', () => {
    step('Hola, busco un instalador para unos focos en mi casa', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it('un RUT no es el teléfono de la instalación; un celular, sí', () => {
    step('Necesito instalación de focos en mi casa en Maipú. Ana Prueba, ana.prueba@example.com, RUT 77.123.456-9', { nombre: 'Ana Prueba' });
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBeUndefined();
    flow.clearFlowState(PHONE);
    step('Quiero instalar focos en mi casa en Maipú, rut 771234569', {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBeUndefined();
    flow.clearFlowState(PHONE);
    step('Quiero instalar focos en mi casa en Maipú, mi celular es +56 9 1234 5678', {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBe('+56912345678');
  });
});

describe('ronda 2 (Codex y leads reales)', () => {
  it('varios ítems explícitos reemplazan una cantidad ya capturada, y queda anotado', () => {
    step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' });
    const r = step('Cambio a 20 paneles y 30 focos', { cantidad: '10' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('Cambio a 20 paneles y 30 focos');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora varios items']);
  });

  it('una cantidad explícita después de varios ítems los reemplaza, y queda anotado', () => {
    step('Necesito 30 paneles de 18W y 20 de 24W', { producto: 'paneles' });
    const r = step('al final son 40 paneles de 18W', {});
    expect(r.captured.cantidad).toBe('40');
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Cantidad: antes varios items (Necesito 30 paneles de 18W y 20 de 24W), ahora 40']);
  });

  it('el cambio usa el dato que respalda el texto, no el que Claude repite de antes', () => {
    step('Necesito 10 paneles LED luz fría para una oficina', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10', proyecto_o_uso: 'oficina' });
    const r = step('Para patio', { proyecto_o_uso: 'bodega' });
    expect(r.captured.proyecto_o_uso).toBe('patio');
    expect(r.captured.cambios).toEqual(['Proyecto/uso: antes oficina, ahora patio']);
  });

  it('Claude corrige con un dato que está en el mensaje, aunque las reglas no lo conozcan', () => {
    step('Necesito 10 paneles LED luz fría para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    const r = step('Perdón, son tubos T8 y es en Ñuñoa', { producto: 'tubos T8', comuna_o_ciudad: 'Ñuñoa' });
    expect(r.captured.producto).toBe('tubos T8');
    expect(r.captured.comuna_o_ciudad).toBe('Ñuñoa');
  });

  it('la comuna con tilde o ñ se reconoce sin Claude', () => {
    expect(step('Necesito 10 paneles LED luz fría para una bodega en Maipú', {}).captured.comuna_o_ciudad).toBe('Maipú');
  });

  it('"No fría, la quiero cálida" deja cálida, aunque Claude diga fría', () => {
    step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' });
    expect(step('No fría, la quiero cálida', { tipo_de_luz: 'fria' }).captured.tipo_de_luz).toBe('calida');
    flow.clearFlowState(PHONE);
    expect(step('Necesito 10 paneles LED, no fría sino cálida', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' }).captured.tipo_de_luz).toBe('calida');
  });

  it('un estado guardado antes de este cambio (sin la última pregunta) la deduce de la etapa', () => {
    step('Necesito paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria' });
    const old = { ...flow.getFlowState(PHONE) };
    delete old.lastQuestion;
    flow.saveFlowState(PHONE, old);
    expect(step('20', {}).captured.cantidad).toBe('20');
    flow.clearFlowState(PHONE);
    step('Hola', {});
    const greeted = { ...flow.getFlowState(PHONE) };
    delete greeted.lastQuestion;
    flow.saveFlowState(PHONE, greeted);
    expect(step('20, luz fría', {}).captured).toMatchObject({ cantidad: '20', tipo_de_luz: 'fria' });
  });

  it('"1" después de la lista de la etapa 2 repite la pregunta una vez y no avanza', () => {
    expect(step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' }).reply).toBe(flow.MSG2);
    expect(step('1', {}).reply).toBe(flow.MSG2);
    expect(flow.getFlowState(PHONE).stage).toBe('stage2');
    expect(step('para una oficina en Providencia', { proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' }).captured).toMatchObject({ proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia', cantidad: '10' });
  });

  it('después de MSG_MEDIA (pregunta la cantidad, sin lista), "20" es la cantidad', () => {
    flow.recordMediaReply(PHONE);
    expect(step('20', {}).captured.cantidad).toBe('20');
  });

  it('los datos de facturación con dirección no dejan su número como cantidad', () => {
    step('Necesito paneles LED luz neutra para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    expect(step('después te confirmo', {}).reply).toMatch(/cantidad de unidades/);
    const r = step('Comercial Prueba SpA, RUT 77.123.456-9, Calle Prueba 456, bodega 12, compras@example.com', { empresa: 'Comercial Prueba SpA' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.correo).toBe('compras@example.com');
  });

  it('la razón social sin coma no se lleva el resto del mensaje', () => {
    const r = step('Razón social Comercial Prueba SpA necesito 30 paneles LED luz neutra para una oficina', { producto: 'paneles LED', tipo_de_luz: 'neutra' });
    expect(r.captured).toMatchObject({ cantidad: '30', proyecto_o_uso: 'oficina' });
    flow.clearFlowState(PHONE);
    expect(step('Razón social Ana Prueba necesito 30 paneles LED', { producto: 'paneles LED' }).captured.cantidad).toBe('30');
  });

  it('"soy instalador" con productos y una instalación como contexto va a productos; "que me instalen", a instalación', () => {
    const r = step('Soy instalador eléctrico, necesito 50 paneles LED para una instalación en una oficina', { producto: 'paneles LED', cantidad: '50', proyecto_o_uso: 'oficina' });
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
    expect(r.captured.cantidad).toBe('50');
    flow.clearFlowState(PHONE);
    step('Soy instalador, pero busco que me instalen 20 focos en una bodega', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it.each([
    ['Mi correo es ana912345678@example.com, cel 9 8765 4321', '987654321'],
    ['Fono +56 32 212 3456', '+56322123456'],
    ['Código PRUEBA1 912345678', '912345678'],
    ['mi correo es ana912345678@example.com', undefined],
  ])('teléfono de la instalación: "%s" → %s', (text, expected) => {
    step('Busco un instalador para mi casa en Maipú. ' + text, {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBe(expected);
  });

  it('un objeto de Claude nunca queda como dato', () => {
    const odd = { producto: { nombre: 'panel' }, comuna_o_ciudad: ['Maipú'], proyecto_o_uso: { tipo: 'bodega' } } as unknown as Claude;
    const r = step('Necesito 10 paneles LED luz fría', odd);
    expect(r.captured.producto).toBe('paneles LED');
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });
});

describe('ronda 3 (revisión adversaria)', () => {
  const FIRST = 'Necesito 30 paneles LED 60x60 luz neutra para una oficina en Providencia';
  const RIGHT: Claude = { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' };

  it('una pregunta del cliente no cambia lo capturado', () => {
    step(FIRST, RIGHT);
    const r = step('¿tienen tienda en Santiago para retirar? mi correo es ana@example.com', { correo: 'ana@example.com' });
    expect(r.captured).toMatchObject({ proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia', correo: 'ana@example.com' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it('un producto menos preciso, dentro de una pregunta, no reemplaza al capturado', () => {
    step(FIRST, RIGHT);
    const r = step('es para una oficina en Providencia, ¿los paneles led traen driver?', {});
    expect(r.captured.producto).toBe('paneles LED 60x60');
    expect(r.captured.cambios).toBeUndefined();
  });

  it('un segundo producto ("también necesito…") se suma como varios ítems, sin pisar el primero', () => {
    step(FIRST, RIGHT);
    const r = step('y también necesito 10 focos LED para el pasillo', { producto: 'focos LED' });
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', proyecto_o_uso: 'oficina' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('paneles LED 60x60: 30 / y también necesito 10 focos LED para el pasillo');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 30, ahora varios items']);
  });

  it('"calidad" no es luz cálida', () => {
    step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' });
    expect(step('busco buena calidad', { tipo_de_luz: 'fria' }).captured.tipo_de_luz).toBe('fria');
  });

  it('la razón social en mayúsculas no cambia el proyecto ni la comuna', () => {
    step(FIRST, RIGHT);
    const r = step('COMERCIAL BODEGA MAIPU SPA, RUT 77.123.456-9, compras@example.com', { empresa: 'Comercial Bodega Maipu SpA', correo: 'compras@example.com' });
    expect(r.captured).toMatchObject({ proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia', cantidad: '30' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it('la lista de MSG1 contestada en una línea deja la cantidad', () => {
    step('Hola', {});
    const r = step('1. paneles LED, 2. fría, 3. 20', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it('después de la aclaración, "me refería a la opción 2" no es la cantidad, y la aclaración no pide el producto ya dado', () => {
    step('busco paneles LED para una bodega', { producto: 'paneles LED' });
    expect(step('2', {}).reply).toBe(flow.menuClarifyMsg(2));
    expect(flow.getFlowState(PHONE).lastQuestion?.asks).toEqual(['tipo_de_luz', 'cantidad']);
    expect(step('me refería a la opción 2, el tipo de luz', {}).captured.cantidad).toBeUndefined();
  });

  it('un saludo a mitad de la etapa 1 no deja que un número suelto pise la cantidad', () => {
    step('Necesito 30 paneles LED', { producto: 'paneles LED', cantidad: '30' });
    step('Hola', {});
    const r = step('luz fría, es para el piso 2', { tipo_de_luz: 'fria' });
    expect(r.captured.cantidad).toBe('30');
    expect(r.captured.cambios).toBeUndefined();
  });

  it('una cantidad que no es un entero, guardada por la versión anterior, se descarta y se pregunta', () => {
    step('Necesito paneles LED luz fría para una oficina', { producto: 'paneles LED', tipo_de_luz: 'fria', proyecto_o_uso: 'oficina' });
    const saved = flow.getFlowState(PHONE);
    flow.saveFlowState(PHONE, { ...saved, captured: { ...saved.captured, cantidad: 'No especificada' } });
    const r = step('en Providencia', { comuna_o_ciudad: 'Providencia' });
    expect(r.captured.cantidad).toBeUndefined();
  });

  it('"dos paneles" es la cantidad 2', () => {
    expect(step('Necesito dos paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria' }).captured.cantidad).toBe('2');
  });

  it.each([
    ['Me pueden recomendar a alguien como instalador para mi casa?', true],
    ['Soy técnico instalador, necesito 50 paneles 60x60 luz neutra', false],
    ['Somos una empresa de instaladores, necesitamos 50 paneles 60x60 luz neutra', false],
    ['Soy instalador, necesito 50 paneles 60x60 luz neutra para instalar en una oficina', false],
    ['Me dedico a instalar luminarias, necesito 50 paneles 60x60 luz neutra', false],
  ])('instalación: "%s" → flujo de instalación %s', (text, install) => {
    step(text, {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(install);
    if (!install) expect(flow.getFlowState(PHONE).captured.cantidad).toBe('50');
  });

  it.each([
    ['fono (32) 212 3456', '322123456'],
    ['mi teléfono es 32 212 3456', '322123456'],
    ['RUT 21.234.567-9', undefined],
  ])('teléfono de la instalación: "%s" → %s', (text, expected) => {
    step('Busco un instalador para mi casa en Maipú, ' + text, {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBe(expected);
  });
});

describe('ronda 4 (revisión adversaria)', () => {
  it('"tubos led de 120" contestando MSG1: 120 es el largo, no la cantidad, y el bot la pregunta', () => {
    step('Hola', {});
    const r = step('tubos led de 120 luz fría', { producto: 'tubos led', tipo_de_luz: 'fria', cantidad: '120' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.reply).toMatch(/cantidad de unidades/i);
  });

  it('"tubos de 120, fría, 30" contestando MSG1 deja 30', () => {
    step('Hola', {});
    const r = step('tubos de 120, fría, 30', { producto: 'tubos', tipo_de_luz: 'fria', cantidad: '30' });
    expect(r.captured.cantidad).toBe('30');
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it('la lista de MSG1 contestada con "1.-" en varias líneas deja la cantidad', () => {
    step('Hola', {});
    expect(step('1.- paneles LED\n2.- fría\n3.- 20', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20' }).captured.cantidad).toBe('20');
  });

  it.each(['eran 25, no 20', 'cambio: 25 en vez de 20'])('la corrección "%s" cambia la cantidad y queda anotada', (text) => {
    step('Necesito 20 paneles 60x60 luz fría', { producto: 'paneles 60x60', tipo_de_luz: 'fria', cantidad: '20' });
    const r = step(text, { cantidad: '25' });
    expect(r.captured.cantidad).toBe('25');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 20, ahora 25']);
  });

  it('"uno" contesta la pregunta por la cantidad', () => {
    step('Necesito reflector solar de 200W luz fría', { producto: 'reflector solar', tipo_de_luz: 'fria' });
    expect(step('uno', { cantidad: '1' }).captured.cantidad).toBe('1');
  });
});

describe('ronda 5 (Codex, ronda 2)', () => {
  const FIRST = 'Necesito 10 paneles LED luz neutra para una oficina en Santiago';
  const RIGHT: Claude = { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Santiago' };

  it('H3: un modelo distinto del que dice el mensaje (T5 por T8) no reemplaza el producto', () => {
    step('Necesito 10 paneles LED luz neutra', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10' });
    expect(step('Corrijo: tubos T8', { producto: 'tubos T5' }).captured.producto).not.toBe('tubos T5');
  });

  it.each([
    ['No necesito 20 focos', { producto: 'paneles LED', cantidad: '10' }],
    ['No es para bodega', { proyecto_o_uso: 'oficina' }],
    ['No estoy en Maipú', { comuna_o_ciudad: 'Santiago' }],
  ])('H4: lo que el cliente niega ("%s") no cambia el dato', (text, kept) => {
    step(FIRST, RIGHT);
    const r = step(text, {});
    expect(r.captured).toMatchObject(kept);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('H4: "no es para bodega, es para una casa" cambia a casa', () => {
    step(FIRST, RIGHT);
    const r = step('No es para bodega, es para una casa', { proyecto_o_uso: 'casa' });
    expect(r.captured.proyecto_o_uso).toBe('casa');
    expect(r.captured.cambios).toEqual(['Proyecto/uso: antes oficina, ahora casa']);
  });

  it('H4: un color negado no llena el color vacío, aunque Claude lo devuelva', () => {
    step('Necesito 10 paneles LED', { producto: 'paneles LED', cantidad: '10' });
    expect(step('No fría', { tipo_de_luz: 'fria' }).captured.tipo_de_luz).toBeUndefined();
  });

  it('H5: "también" en una corrección no suma un ítem: cambia la cantidad', () => {
    step(FIRST, RIGHT);
    const r = step('También necesito cambiar la cantidad a 20', { cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora 20']);
  });

  it('H5: "además que sean cálidos" es una característica, no otro ítem', () => {
    step(FIRST, RIGHT);
    const r = step('Necesito 20 paneles, además que sean cálidos', { cantidad: '20', tipo_de_luz: 'calida' });
    expect(r.captured).toMatchObject({ cantidad: '20', tipo_de_luz: 'calida' });
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it.each([{ empresa: 'Comercial 25 SpA' }, {}])('H6: el número de la razón social no es la cantidad (Claude %j)', (claude) => {
    step('Necesito paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria' });
    expect(step('Razón social: Comercial 25 SpA', claude).captured.cantidad).toBeUndefined();
  });

  it('H7: "también, ¿tienen 20 focos?" es una pregunta: no suma ni cambia', () => {
    step(FIRST, RIGHT);
    const r = step('También, ¿tienen 20 focos?', {});
    expect(r.captured.cantidad).toBe('10');
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it('H7: lo afirmado antes de una pregunta sin "¿" cuenta', () => {
    step(FIRST, RIGHT);
    const r = step('Ahora necesito 20 paneles, hacen despacho?', { cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora 20']);
  });

  it('H7: una pregunta sin "¿" ni pedido no cambia la comuna', () => {
    step(FIRST, RIGHT);
    expect(step('tienen tienda en Maipú, para retirar?', {}).captured.comuna_o_ciudad).toBe('Santiago');
  });

  it('H8: un producto más preciso, dicho en el mensaje, reemplaza al anterior y queda anotado', () => {
    step('Necesito 10 paneles LED 60x60 luz neutra', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '10' });
    const r = step('Corrijo: paneles LED 60x60 regulables', { producto: 'paneles LED 60x60 regulables' });
    expect(r.captured.producto).toBe('paneles LED 60x60 regulables');
    expect(r.captured.cambios).toEqual(['Producto: antes paneles LED 60x60, ahora paneles LED 60x60 regulables']);
  });

  it('H9: al repetir MSG2, la lista de dos sigue anotada; el segundo número sigue el flujo', () => {
    step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' });
    expect(step('1', {}).reply).toBe(flow.MSG2);
    expect(flow.getFlowState(PHONE).lastQuestion?.listLength).toBe(2);
    step('1', {});
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
  });

  it('H10: un estado anterior, después de pedir el correo para el ejecutivo, no da por pedida la cantidad', () => {
    flow.processFlowStep(PHONE, 'Quiero hablar con un vendedor', {}, { wantsHuman: true, qualifiesForDeal: false });
    const { lastQuestion: _dropped, ...old } = flow.getFlowState(PHONE);
    flow.saveFlowState(PHONE, old as ReturnType<typeof flow.getFlowState>);
    expect(flow.processFlowStep(PHONE, '20', {}, { wantsHuman: true, qualifiesForDeal: false }).captured.cantidad).toBeUndefined();
  });

  it('H11: recordNoQuestion borra la lista anotada (el webhook lo llama si el paso falla)', () => {
    step('Necesito 10 paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '10' });
    flow.recordNoQuestion(PHONE);
    expect(flow.getFlowState(PHONE).lastQuestion).toBeNull();
  });

  it('H12: un instalador que pide cotizar la instalación va al flujo de instalación', () => {
    step('Soy instalador y quiero cotizar instalación para mi casa', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it.each([
    ['fono 900001234. 20 focos', '900001234'],
    ['modelo 900001234', undefined],
  ])('H13: teléfono de la instalación en "%s" → %s', (text, expected) => {
    step('Busco un instalador para mi casa, ' + text, {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBe(expected);
  });

  it('H16: un mensaje de 50.000 letras sin "@" se procesa en menos de 500 ms', () => {
    step('Busco un instalador para mi casa', {});
    const start = performance.now();
    step('a'.repeat(50000), {});
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('ronda 6 (revisión adversaria de la ronda 5)', () => {
  const FIRST = 'Necesito 10 paneles LED luz neutra para una oficina en Santiago';
  const RIGHT: Claude = { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Santiago' };

  it.each([
    'no me acordé también necesito 6 focos',
    'Ah no les comenté también necesito 6 focos',
    'no sé si lo dije también necesito 6 focos',
    'No también necesito 6 focos',
    'no te dije además necesito 6 focos',
  ])('H1: "%s" suma un ítem: el pedido anterior pasa a varios ítems', (text) => {
    step(FIRST, RIGHT);
    const r = step(text, { producto: 'focos', cantidad: '6' });
    expect(r.captured.producto).toBe('paneles LED');
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('paneles LED: 10 / ' + text);
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora varios items']);
  });

  it.each([
    'no eran 10 eran 20',
    'no mejor 20',
    'No mejor que sean 20',
    'no perdón eran 20',
    'no perdon 20',
    'no me equivoqué eran 20',
    'No cambiemos a 20 paneles',
    'No sé cuántos exactamente unos 20',
    'no tengo claro cuantos unos 20',
    'No importa el color que sean 20',
    'Perdón no eran 10 eran 20',
  ])('H2: la corrección sin coma "%s" cambia la cantidad a 20', (text) => {
    step(FIRST, RIGHT);
    const r = step(text, { cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora 20']);
  });

  it.each([
    ['y si necesito 50, cuánto sale?', {}],
    ['Si necesitamos 100 unidades, cuánto sería?', {}],
    ['si quiero 50, me hacen descuento?', { cantidad: '50' }],
    ['si son 50, hay descuento?', {}],
    ['si necesito 100 paneles, cuál es el precio por mayor?', {}],
  ])('H3: la pregunta condicional "%s" no cambia la cantidad', (text, claude) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured.cantidad).toBe('10');
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each([
    ['no es en Santiago es en Temuco', { comuna_o_ciudad: 'Temuco' }, 'comuna_o_ciudad', 'Temuco'],
    ['no estoy en santiago estoy en temuco', { comuna_o_ciudad: 'Temuco' }, 'comuna_o_ciudad', 'Temuco'],
    ['no estoy en Santiago estoy en Pudahuel', { comuna_o_ciudad: 'Pudahuel' }, 'comuna_o_ciudad', 'Pudahuel'],
    ['no es para oficina es para una casa', { proyecto_o_uso: 'casa' }, 'proyecto_o_uso', 'casa'],
    ['No era oficina era bodega', { proyecto_o_uso: 'bodega' }, 'proyecto_o_uso', 'bodega'],
    ['algo no muy caro para una casa', { proyecto_o_uso: 'casa' }, 'proyecto_o_uso', 'casa'],
    ['no era panel era reflector', { producto: 'reflector' }, 'producto', 'reflector'],
    ['No eran paneles eran focos', { producto: 'focos' }, 'producto', 'focos'],
    ['no mejor focos', { producto: 'focos' }, 'producto', 'focos'],
  ] as const)('H4 y H13: la corrección sin coma "%s" cambia el dato', (text, claude, field, expected) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured[field]).toBe(expected);
    expect(r.captured.cambios).toHaveLength(1);
  });

  it.each(['no fría cálida', 'no neutra mejor calida'])('H4: "%s" cambia el color a cálida', (text) => {
    step(FIRST, RIGHT);
    const r = step(text, { tipo_de_luz: 'calida' });
    expect(r.captured.tipo_de_luz).toMatch(/^c[aá]lida$/i);
    expect(r.captured.cambios).toHaveLength(1);
  });

  it('H4: "No tengo factura es para una casa en Temuco" cambia el proyecto y la comuna', () => {
    step(FIRST, RIGHT);
    const r = step('No tengo factura es para una casa en Temuco', { comuna_o_ciudad: 'Temuco', proyecto_o_uso: 'casa' });
    expect(r.captured).toMatchObject({ proyecto_o_uso: 'casa', comuna_o_ciudad: 'Temuco' });
  });

  it.each([
    'quiero saber si tienen reflectores, cuánto salen?',
    'Necesito saber si tienen focos, y cuánto valen?',
    'quisiera saber si tienen en luz cálida, o solo fría?',
    'necesito saber si despachan a Temuco, cuanto cuesta?',
    'Quiero saber si tienen reflectores.',
  ])('H5: la pregunta indirecta "%s" no cambia nada', (text) => {
    step(FIRST, RIGHT);
    const r = step(text, {});
    expect(r.captured).toMatchObject({ producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', comuna_o_ciudad: 'Santiago' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each([
    ['No los quiero fríos', {}],
    ['no las quiero frías', {}],
    ['No la necesito en luz fría', {}],
    ['no lo necesito para bodega', {}],
    ['no lo necesito en Maipú', { comuna_o_ciudad: 'Maipú' }],
  ])('H6: la negación con pronombre "%s" no cambia el dato', (text, claude) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured).toMatchObject({ tipo_de_luz: 'neutra', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Santiago' });
    expect(r.captured.cambios).toBeUndefined();
  });

  it('H7: "50 tubos LED de 120 y 30 de 60" son varios ítems', () => {
    const text = 'Hola, necesito 50 tubos LED de 120 y 30 de 60 para una bodega en Maipú';
    const r = step(text, { producto: 'tubos LED', cantidad: '50', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Maipú' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe(text);
  });

  it('H7: la corrección a dos medidas pasa a varios ítems', () => {
    step('Necesito 40 tubos LED T8 luz fría para una bodega en Maipú', { producto: 'tubos LED T8', tipo_de_luz: 'fría', cantidad: '40', proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Maipú' });
    const r = step('perdón, me equivoqué: son 30 tubos de 120 y 10 de 60', { cantidad: '30' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Cantidad: antes 40, ahora varios items']);
  });

  it('H8: "mejor dos de 60x60 y tres de 120x60" no pisa los 30 con 2: son varios ítems', () => {
    step('Necesito 30 paneles LED luz neutra para una oficina en Providencia', { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '30', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    const r = step('mejor dos de 60x60 y tres de 120x60', {});
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Cantidad: antes 30, ahora varios items']);
  });

  it.each([{}, { cantidad: '10' }])('H8: "quiero cinco de luz fría y cinco de luz cálida" son varios ítems (Claude %j)', (claude) => {
    step('Necesito paneles LED 60x60 para una oficina', { producto: 'paneles LED 60x60', proyecto_o_uso: 'oficina' });
    const r = step('quiero cinco de luz fría y cinco de luz cálida', claude);
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('quiero cinco de luz fría y cinco de luz cálida');
    expect(r.reply).not.toMatch(/cantidad de unidades/i);
  });

  it.each([
    ['Hola, necesito dos cientos focos LED para un galpón', { producto: 'focos LED', proyecto_o_uso: 'galpón' }, '200'],
    ['Hola, necesito tres cientos paneles LED 60x60 para un colegio', { producto: 'paneles LED 60x60', proyecto_o_uso: 'colegio', cantidad: '300' }, '300'],
  ])('H9: "%s" → %s', (text, claude, expected) => {
    expect(step(text, claude).captured.cantidad).toBe(expected);
  });

  it('H10: "un camino de unos dos kilómetros" no es la cantidad', () => {
    const r = step('Hola, necesito luminarias solares para un camino de unos dos kilómetros', { producto: 'luminarias solares', proyecto_o_uso: 'camino' });
    expect(r.captured.cantidad).toBeUndefined();
  });

  it.each([
    ['Necesito 20 focos también', {}],
    ['Y también unos 20 de 120x30', { producto: 'paneles LED 120x30', cantidad: '20' }],
    ['También necesito 4 fuentes de poder', { producto: 'fuentes de poder', cantidad: '4' }],
    ['También quiero 5 más', {}],
    ['20 focos además', {}],
    ['y 6 reflectores también', {}],
    ['Aparte necesito 8 de 18W', {}],
    ['Además 20 perfiles de aluminio', {}],
    ['también 20 de 120x60', {}],
    ['También necesito 20 tubos LED para cambiar los fluorescentes del pasillo', {}],
    ['Además 8 focos con cambio de color', {}],
    ['También necesito 6 reflectores, de la mejor calidad', {}],
    ['Además 12 tubos para reemplazar los fluorescentes en vez de los antiguos', {}],
    ['Perdón, también necesito 5 focos', {}],
    ['Mejor agrega 10 focos', {}],
    ['Necesito 5 paneles más', { cantidad: '15' }],
    ['Y 20 focos más para el patio', { producto: 'focos', cantidad: '20' }],
    ['necesito 5 más', {}],
    ['más 20 focos', {}],
  ])('H11, H12 y H15: "%s" suma un ítem y no pisa lo capturado', (text, claude) => {
    step('Hola, necesito 10 paneles LED 60x60 luz neutra', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '10' });
    step('Para una oficina en Providencia', { proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    const r = step(text, claude);
    expect(r.captured).toMatchObject({ producto: 'paneles LED 60x60', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('paneles LED 60x60: 10 / ' + text);
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora varios items']);
  });

  it('H11: "aparte" al final de la cláusula es "por separado", no otro ítem', () => {
    step(FIRST, RIGHT);
    const r = step('luz cálida, 4 focos solares, que no traigan el panel aparte', { producto: 'focos solares', tipo_de_luz: 'calida', cantidad: '4' });
    expect(r.captured.cantidad).toBe('4');
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it.each([
    ['Hola, cotizo focos para mi patio', { producto: 'focos', proyecto_o_uso: 'patio' }, 'Unos 8 focos LED, luz cálida', {}],
    ['Necesito precio de reflector', { producto: 'reflector' }, 'Son 6 reflectores, luz fría', {}],
    ['Busco ampolleta para el living', { producto: 'ampolleta', proyecto_o_uso: 'living' }, 'necesito 12 ampolletas LED cálidas', {}],
    ['Necesito 10 paneles LED', { producto: 'paneles LED', cantidad: '10' }, 'paneles LED luz fría', { producto: 'paneles LED luz fría', tipo_de_luz: 'fria' }],
  ])('H14: "%s" y después "%s": el mismo producto, sin cambio anotado', (first, c1, second, c2) => {
    step(first, c1);
    const r = step(second, c2);
    expect(r.captured.producto).toBe(c1.producto);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each([
    ['que no sea fría', { tipo_de_luz: 'calida' }, 'calida'],
    ['no quiero luz fría', {}, undefined],
    ['no me gusta la luz fría', {}, undefined],
  ])('H16: el color negado con un verbo ("%s") no llena el color', (text, claude, expected) => {
    step('Necesito 10 paneles LED 60x60', { producto: 'paneles LED 60x60', cantidad: '10' });
    expect(step(text, claude).captured.tipo_de_luz).toBe(expected);
  });

  it.each([
    'Hola, soy electricista, estoy cotizando una instalación para un cliente y necesito 30 paneles LED 60x60 luz neutra',
    'Soy instalador eléctrico, cotizo instalaciones en oficinas y busco proveedor de paneles LED',
    'Soy instalador, tengo que cotizar la instalación de un galpón y necesito 20 campanas LED 150W',
    'Soy electricista y necesito precios de 50 focos LED para armar el presupuesto de la instalación de una casa',
    'Somos instaladores, necesitamos presupuesto para una instalación de 40 tubos LED en un colegio',
    'Soy contratista, estoy cotizando el montaje eléctrico de una bodega, necesito 25 reflectores LED 200W',
    'Soy técnico eléctrico, me pidieron cotizar una instalación de 15 focos embutidos, qué precio tienen?',
  ])('H17: el instalador que cotiza su propia obra ("%s") va al flujo de productos', (text) => {
    step(text, {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
  });

  it('H17: a mitad del flujo, "estoy cotizando la instalación de una oficina" contesta MSG2', () => {
    expect(step('Soy instalador eléctrico, necesito 40 paneles LED 60x60 luz fría', { producto: 'paneles LED 60x60', tipo_de_luz: 'fria', cantidad: '40' }).reply).toBe(flow.MSG2);
    const r = step('Soy instalador, estoy cotizando la instalación de una oficina en Providencia', { proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Providencia' });
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
    expect(r.captured).toMatchObject({ proyecto_o_uso: 'oficina', cantidad: '40' });
  });

  it.each([
    ['La instalación es en una bodega en Quilicura', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Quilicura' }],
    ['Es para instalar en una bodega en Quilicura', {}],
    ['Los voy a instalar en mi casa en Maipú', {}],
  ])('H18: contestar MSG2 con "%s" sigue en el flujo de productos', (text, claude) => {
    expect(step('Necesito 30 paneles LED 60x60 luz neutra para mi empresa', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '30' }).reply).toBe(flow.MSG2);
    const r = step(text, claude);
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
    expect(r.captured.proyecto_o_uso).toBeDefined();
    expect(r.reply).toBe(flow.MSG3_B2B);
  });

  it('H18: a mitad del flujo de productos, "que me los instalen" sí abre el de instalación', () => {
    step('Necesito 30 paneles LED 60x60 luz neutra para mi empresa', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '30' });
    step('También necesito que me los instalen en la bodega', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });
});

describe('ronda 7 (Codex, ronda 3)', () => {
  const FIRST = 'Necesito 10 paneles LED luz neutra para una oficina en Santiago';
  const RIGHT: Claude = { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Santiago' };
  const KEPT = { producto: 'paneles LED', tipo_de_luz: 'neutra', cantidad: '10', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Santiago' };

  it.each([
    ['No necesito 20 focos', {}, 'producto'],
    ['No necesito focos', { producto: 'focos' }, 'producto'],
    ['No es para bodega', {}, 'proyecto_o_uso'],
    ['No es para bodega', { proyecto_o_uso: 'bodega' }, 'proyecto_o_uso'],
    ['No estoy en Maipú', {}, 'comuna_o_ciudad'],
    ['No estoy en Maipú', { comuna_o_ciudad: 'Maipú' }, 'comuna_o_ciudad'],
  ] as const)('R3-1: con el dato vacío, "%s" (Claude %j) no llena %s', (text, claude, field) => {
    const r = step(text, claude);
    expect(r.captured[field]).toBeUndefined();
    expect(r.captured.cantidad).toBeUndefined();
  });

  it.each([
    ['No necesito veinte focos', {}],
    ['No quiero comprar 20 focos', {}],
    ['No quiero comprar 20 focos', { producto: 'focos', cantidad: '20' }],
    ['No vamos a pedir 20 focos', {}],
    ['No quiero que sean fríos', {}],
    ['No necesito focos LED para la bodega en Maipú', {}],
    ['No necesito focos LED para la bodega en Maipú', { proyecto_o_uso: 'bodega', comuna_o_ciudad: 'Maipú' }],
    ['Sin focos, por favor', {}],
  ])('R3-2: la negación "%s" (Claude %j) no cambia nada', (text, claude) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured).toMatchObject(KEPT);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each([
    ['No quiero los paneles neutros, mejor cálidos', { tipo_de_luz: 'calida' }, 'tipo_de_luz', 'calida'],
    ['no necesito luz neutra sino cálida', { tipo_de_luz: 'calida' }, 'tipo_de_luz', 'calida'],
    ['No es para oficina, es para una bodega', { proyecto_o_uso: 'bodega' }, 'proyecto_o_uso', 'bodega'],
    ['No tengo el RUT a mano, son 20 paneles', { cantidad: '20' }, 'cantidad', '20'],
    ['No necesito que sean regulables, son 20', { cantidad: '20' }, 'cantidad', '20'],
  ] as const)('R3-2: lo que se afirma después de la negación ("%s") sí cambia el dato', (text, claude, field, expected) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured[field]).toBe(expected);
    expect(r.captured.cambios).toHaveLength(1);
  });

  it('R3-3: "Necesito 20 paneles, ¿tienen 30 focos?" cambia la cantidad a 20', () => {
    step(FIRST, RIGHT);
    const r = step('Necesito 20 paneles, ¿tienen 30 focos?', { cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.cambios).toEqual(['Cantidad: antes 10, ahora 20']);
  });

  it('R3-3: con los datos vacíos, "Necesito 20 paneles, ¿tienen 30 focos?" deja 20 y no toma los focos de la pregunta', () => {
    const r = step('Necesito 20 paneles, ¿tienen 30 focos?', { cantidad: '20' });
    expect(r.captured.cantidad).toBe('20');
    expect(r.captured.cantidad_varios).toBeUndefined();
    expect(r.captured.producto).not.toBe('focos');
  });

  it.each([
    ['Si necesito 50, cuánto sale', {}],
    ['En caso de necesitar 50 paneles, cuánto sale?', {}],
    ['en caso que necesite 50, hay descuento', { cantidad: '50' }],
    ['Quiero saber si tienen focos, cálidos', {}],
  ])('R3-4: la condición o la pregunta "%s" no cambia nada', (text, claude) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured).toMatchObject(KEPT);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each(['Si, necesito 20', 'si necesito 20 paneles'])('R3-4: "%s" (un sí sin tilde) cambia la cantidad a 20', (text) => {
    step(FIRST, RIGHT);
    expect(step(text, { cantidad: '20' }).captured.cantidad).toBe('20');
  });

  it('R3-5: "Necesito 20 paneles, además que los paneles sean cálidos." es una corrección, no otro ítem', () => {
    step(FIRST, RIGHT);
    const r = step('Necesito 20 paneles, además que los paneles sean cálidos.', { cantidad: '20', tipo_de_luz: 'calida' });
    expect(r.captured).toMatchObject({ cantidad: '20', tipo_de_luz: 'calida' });
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it('R3-5: "Además que los paneles sean cálidos" cambia solo el color', () => {
    step(FIRST, RIGHT);
    const r = step('Además que los paneles sean cálidos', {});
    expect(r.captured).toMatchObject({ ...KEPT, tipo_de_luz: 'calida' });
    expect(r.captured.cantidad_varios).toBeUndefined();
  });

  it.each([
    'Corrijo la comuna a Temuco, también necesito 20 focos.',
    'También necesito 20 focos, corrijo la comuna a Temuco.',
  ])('R3-6: "%s" corrige la comuna y suma el ítem', (text) => {
    step(FIRST, RIGHT);
    const r = step(text, { comuna_o_ciudad: 'Temuco', producto: 'focos', cantidad: '20' });
    expect(r.captured).toMatchObject({ producto: 'paneles LED', comuna_o_ciudad: 'Temuco' });
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('paneles LED: 10 / ' + text);
  });

  it.each([{}, { cantidad: '2' }])('R3-7: al preguntar la cantidad, "2 de 60x60 y tres de 120x60" son varios ítems (Claude %j)', (claude) => {
    step('Necesito paneles LED luz neutra', { producto: 'paneles LED', tipo_de_luz: 'neutra' });
    const r = step('2 de 60x60 y tres de 120x60', claude);
    expect(r.captured.cantidad).toBeUndefined();
    expect(r.captured.cantidad_varios).toBe('2 de 60x60 y tres de 120x60');
  });

  it.each([
    ['Corrijo: tubos T8', { producto: 'tubos T8A' }],
    ['Corrijo: BL200', { producto: 'BL200A' }],
  ])('R3-8: "%s" no respalda el modelo inventado de Claude (%j)', (text, claude) => {
    step(FIRST, RIGHT);
    const r = step(text, claude);
    expect(r.captured.producto).not.toBe(claude.producto);
  });

  it('R3-8: el número con su unidad sí es el mismo ("paneles de 18" respalda "paneles 18W")', () => {
    step(FIRST, RIGHT);
    expect(step('Corrijo: paneles de 18', { producto: 'paneles 18W' }).captured.producto).toBe('paneles 18W');
  });

  it('R3-9: "Corrijo: paneles LED, no regulables" quita el atributo negado', () => {
    step('Necesito 10 paneles LED regulables luz neutra', { producto: 'paneles LED regulables', tipo_de_luz: 'neutra', cantidad: '10' });
    const r = step('Corrijo: paneles LED, no regulables', { producto: 'paneles LED' });
    expect(r.captured.producto).toBe('paneles LED');
    expect(r.captured.cambios).toEqual(['Producto: antes paneles LED regulables, ahora paneles LED']);
  });

  it.each([
    'No quiero instalación, solo los productos',
    'Sin servicio de instalación',
    'No necesito que me los instalen',
  ])('R3-10: a mitad del flujo de productos, "%s" no abre el de instalación', (text) => {
    step('Necesito 30 paneles LED 60x60 luz neutra para mi empresa', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '30' });
    step(text, {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
  });

  it('R3-10: "No quiero instalación, necesito 20 paneles LED" como primer mensaje va al flujo de productos', () => {
    step('No quiero instalación, necesito 20 paneles LED', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
  });

  it.each([
    'quiero un presupuesto para la instalación',
    'cotizar instalación para mi casa',
    'precio de instalación',
  ])('R3-11: a mitad del flujo de productos, "%s" abre el de instalación', (text) => {
    step('Necesito 30 paneles LED 60x60 luz neutra para mi empresa', { producto: 'paneles LED 60x60', tipo_de_luz: 'neutra', cantidad: '30' });
    step(text, {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it('R3-11: "Soy instalador, necesito un presupuesto de instalación" abre el de instalación', () => {
    step('Soy instalador, necesito un presupuesto de instalación', {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(true);
  });

  it.each([
    'Soy instalador, tengo que cotizar la instalación de un galpón, qué paneles tienen?',
    'Soy electricista y necesito precios de focos LED para armar el presupuesto de la instalación de una casa',
    'Soy instalador, me pidieron cotizar la instalación de una oficina',
  ])('R3-11: el instalador que cotiza su obra sin decir cantidad ("%s") va al flujo de productos', (text) => {
    step(text, {});
    expect(flow.getFlowState(PHONE).isInstallFlow).toBe(false);
  });

  it('R3-12: "Razón social: Comercial 25" no es la cantidad', () => {
    step('Necesito paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria' });
    expect(step('Razón social: Comercial 25', {}).captured.cantidad).toBeUndefined();
  });

  it('R3-12: "Razón social: Comercial, 25 paneles" sí trae la cantidad', () => {
    step('Necesito paneles LED luz fría', { producto: 'paneles LED', tipo_de_luz: 'fria' });
    expect(step('Razón social: Comercial, 25 paneles', {}).captured.cantidad).toBe('25');
  });

  it.each([
    ['el modelo es el 900001234.', undefined],
    ['la serie del 900001234', undefined],
    ['mi fono es el 900001234.', '900001234'],
  ])('R3-13: teléfono de la instalación en "%s" → %s', (text, expected) => {
    step('Busco un instalador para mi casa, ' + text, {});
    expect(flow.getFlowState(PHONE).captured.install_telefono).toBe(expected);
  });
});
