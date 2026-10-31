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
      expect(JSON.stringify(r.captured)).not.toContain('[object Object]');
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
    expect(JSON.stringify(r.captured)).not.toContain('[object Object]');
    expect(r.captured.producto).toBe('paneles LED');
  });
});
