// api/_lib/whatsapp/flowComuna.test.ts
// Bot de WhatsApp, PR 3 del plan (B4): la comuna en el flujo.
// - §10 (T4, T5 y T11), con mensajes parecidos e inventados.
// - La comuna sale de la lista oficial, con frase de ubicación o como respuesta a la pregunta por ella;
//   nunca de un correo, una calle, una pregunta por sucursal ni de lo que Claude diga solo.
// - Con dos comunas quedan las dos: la de la instalación y "Otras comunas mencionadas".
// Cada caso corre con un Claude simulado que acierta y con otro que se equivoca.
// Solo datos inventados: correos @example.com y direcciones de prueba.

import { afterEach, describe, expect, it } from 'vitest';
import * as flow from './flowEngine';

const NO_SIGNALS = { wantsHuman: false, qualifiesForDeal: false };
const PHONE = '+56900000601';
type Claude = Parameters<typeof flow.processFlowStep>[2];
const step = (body: string, claude: Claude = {}) => flow.processFlowStep(PHONE, body, claude, NO_SIGNALS);

afterEach(() => flow.clearFlowState(PHONE));

describe('§10: comuna en el primer mensaje', () => {
  it.each<[string, Claude]>([
    ['acierta', { nombre: 'Andrés Prueba', correo: 'andres.prueba@example.com', producto: 'focos', proyecto_o_uso: 'patio' }],
    ['se equivoca', { nombre: 'Andrés Prueba', correo: 'andres.prueba@example.com', producto: 'focos', proyecto_o_uso: 'patio', comuna_o_ciudad: 'Santiago' }],
  ])('T4: sin comuna en el texto queda vacía y el bot la pregunta (Claude %s)', (_label, claude) => {
    const r = step('Soy Andrés Prueba, andres.prueba@example.com, quiero focos para un patio', claude);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    const next = step('Luz cálida, son 6', { tipo_de_luz: 'calida', cantidad: '6' });
    expect(next.captured.comuna_o_ciudad).toBeUndefined();
    expect(next.reply).toMatch(/comuna/i);
  });

  it.each<[string, Claude]>([
    ['acierta', {}],
    ['se equivoca', { comuna_o_ciudad: 'Retiro' }],
  ])('T5: "Ya compré, ¿cuál es la dirección de retiro?" no deja Retiro ni da la dirección (Claude %s)', (_label, claude) => {
    const r = step('Ya compré, ¿cuál es la dirección de retiro?', claude);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
    expect(r.reply).not.toMatch(/Quinta Normal|direcci[oó]n de (la )?bodega/i);
  });

  it.each<[string, Claude]>([
    ['acierta', { producto: 'BESTLED', cantidad: '25', comuna_o_ciudad: 'La Serena' }],
    ['se equivoca', { producto: 'BESTLED', cantidad: '25', comuna_o_ciudad: 'Serena' }],
    ['no la da', { producto: 'BESTLED', cantidad: '25' }],
  ])('T11: "…para un pasaje en La Serena" da La Serena (Claude %s)', (_label, claude) => {
    expect(step('Quiero cotizar 25 BESTLED para un pasaje en La Serena', claude).captured.comuna_o_ciudad).toBe('La Serena');
  });

  it('"Es para una bodega en Lampa" da Lampa', () => {
    expect(step('Necesito 20 focos LED luz fría. Es para una bodega en Lampa', {}).captured.comuna_o_ciudad).toBe('Lampa');
  });

  it('la comuna queda con su nombre oficial', () => {
    expect(step('Necesito 20 paneles para una oficina en nunoa', { comuna_o_ciudad: 'nunoa' }).captured.comuna_o_ciudad).toBe('Ñuñoa');
  });

  it.each<[string, Claude]>([
    ['un correo', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' }],
  ])('%s no da la comuna', (_label, claude) => {
    expect(step('Necesito 20 paneles, mi correo es santiago.prueba@example.com', claude).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('una pregunta por sucursal no da la comuna', () => {
    expect(step('¿Tienen sucursal en Concepción?', { comuna_o_ciudad: 'Concepción' }).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('la razón social no da la comuna', () => {
    const r = step('Necesito 20 paneles. Razón social Comercial Los Andes SpA', { empresa: 'Comercial Los Andes SpA', comuna_o_ciudad: 'Los Andes' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
  });
});

describe('respuesta a la pregunta por la comuna', () => {
  // El primer mensaje trae todo menos la comuna: el bot pregunta solo la comuna.
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina' };

  it('el bot pregunta la comuna', () => {
    const r = step(FIRST, FIRST_CLAUDE);
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.reply).toMatch(/comuna/i);
  });

  it.each([
    ['Lampa', 'Lampa'],
    ['Santiago', 'Santiago'],
    ['santiago', 'Santiago'],
    ['Soy de Maipú', 'Maipú'],
    ['Maipú, Región Metropolitana', 'Maipú'],
    ['Av. Santiago Bueras 1234, Lampa', 'Lampa'],
    ['En la comuna de Pudahuel', 'Pudahuel'],
  ])('"%s" da %s', (answer, comuna) => {
    step(FIRST, FIRST_CLAUDE);
    expect(step(answer, {}).captured.comuna_o_ciudad).toBe(comuna);
  });

  it.each([
    ['santiago.prueba@example.com', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' }],
    ['Av. Santiago Bueras 1234', { comuna_o_ciudad: 'Santiago' }],
    ['no sé', { comuna_o_ciudad: 'Santiago' }],
  ])('"%s" no da Santiago', (answer, claude) => {
    step(FIRST, FIRST_CLAUDE);
    expect(step(answer, claude).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('sin la pregunta, la comuna sola no cuenta', () => {
    const r = step('Necesito 20 paneles LED luz fría. Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', comuna_o_ciudad: 'Lampa' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
  });
});

describe('dos comunas', () => {
  it.each<[string, Claude, string, string[]]>([
    ['acierta', { comuna_o_ciudad: 'Lampa' }, 'Lampa', ['Viña del Mar']],
    ['no la da', {}, 'Lampa', ['Viña del Mar']],
    ['elige la de la factura', { comuna_o_ciudad: 'Viña del Mar' }, 'Lampa', ['Viña del Mar']],
  ])('la obra en Lampa y la facturación en Viña del Mar: quedan las dos (Claude %s)', (_label, claude, comuna, otras) => {
    const r = step('Necesito 20 focos. La obra es en Lampa y la facturación en Viña del Mar', claude);
    expect(r.captured.comuna_o_ciudad).toBe(comuna);
    expect(r.captured.comunas_otras).toEqual(otras);
  });

  it('dos lugares de obra: la que eligió Claude y la otra', () => {
    const r = step('Necesito focos para una bodega en Lampa y otra en Colina', { comuna_o_ciudad: 'Colina' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.comunas_otras).toEqual(['Lampa']);
  });

  it('la facturación en otra comuna después no cambia la comuna capturada', () => {
    step('Necesito 20 paneles LED luz fría para una oficina en Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' });
    const r = step('La factura sale a nombre de la empresa de Las Condes', { comuna_o_ciudad: 'Las Condes' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Las Condes']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('una comuna nueva que el cliente afirma cambia la capturada y queda anotada', () => {
    step('Necesito 20 paneles LED luz fría para una oficina en Lampa', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' });
    const r = step('Perdón, es en Colina', { comuna_o_ciudad: 'Colina' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Lampa, ahora Colina']);
  });
});

describe('instalación', () => {
  it('la comuna de la instalación sigue las mismas reglas', () => {
    const r = step('Busco un instalador para una casa, mi correo es santiago.prueba@example.com', { correo: 'santiago.prueba@example.com', comuna_o_ciudad: 'Santiago' });
    expect(r.captured.install_comuna).toBeUndefined();
    const next = step('Lampa', { comuna_o_ciudad: 'Lampa' });
    expect(next.captured.install_comuna).toBe('Lampa');
  });

  // Hallazgo 5 de Codex: la comuna de la instalación se corrige y anota otras comunas igual que la de productos.
  it.each<[string, Claude]>([
    ['acierta', { comuna_o_ciudad: 'Colina' }],
    ['no la da', {}],
    ['repite la anterior', { comuna_o_ciudad: 'Lampa' }],
  ])('"Perdón, es en Colina" corrige la comuna de la instalación (Claude %s)', (_label, claude) => {
    expect(step('Busco un instalador para una casa en Lampa', {}).captured.install_comuna).toBe('Lampa');
    const r = step('Perdón, es en Colina', claude);
    expect(r.captured.install_comuna).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Lampa, ahora Colina']);
  });

  it('las otras comunas que llegan después quedan anotadas', () => {
    step('Busco un instalador para una casa en Lampa', {});
    const r = step('Soy Ana Prueba, la facturación es en Viña del Mar', { nombre: 'Ana Prueba', comuna_o_ciudad: 'Viña del Mar' });
    expect(r.captured.install_comuna).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.captured.cambios).toBeUndefined();
  });
});

describe('el propósito del lugar (hallazgo 2 de Codex)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina en Lampa';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };

  it('"Los datos de facturación son de Viña del Mar" no cambia la comuna capturada', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('Los datos de facturación son de Viña del Mar', { comuna_o_ciudad: 'Viña del Mar' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each<[string, string]>([
    ['Quiero retirar el pedido en Quinta Normal', 'Quinta Normal'],
    ['¿Puedo ir a su local en Maipú?', 'Maipú'],
    ['En Concepción tienen sucursal?', 'Concepción'],
  ])('"%s" no da la comuna (Claude dice %s)', (text, claudeComuna) => {
    const r = step(text, { comuna_o_ciudad: claudeComuna });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it.each([
    'Quiero retirar el pedido en Quinta Normal',
    '¿Puedo ir a su local en Maipú?',
  ])('"%s" tampoco cambia una comuna capturada', (text) => {
    step(FIRST, FIRST_CLAUDE);
    const r = step(text, { comuna_o_ciudad: 'Maipú' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.cambios).toBeUndefined();
  });
});

describe('la razón social sin Claude (hallazgo 3 de Codex)', () => {
  it('"Somos Iluminación de Los Andes SpA" no da Los Andes', () => {
    const r = step('Somos Iluminación de Los Andes SpA, necesitamos 20 paneles LED', {});
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
  });
});

describe('correcciones (hallazgo 4 de Codex)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina en Lampa';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };

  it.each<[string, Claude]>([
    ['acierta', { comuna_o_ciudad: 'Colina' }],
    ['no la da', {}],
    ['repite la anterior', { comuna_o_ciudad: 'Lampa' }],
  ])('"Corrijo: ahora es en Colina, antes era en Lampa" cambia a Colina (Claude %s)', (_label, claude) => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('Corrijo: ahora es en Colina, antes era en Lampa', claude);
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Lampa, ahora Colina']);
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it.each(['Corrijo: Colina', 'Corrección: Colina', 'Perdón, es Colina', 'en realidad es Colina', 'mejor dicho Colina'])('"%s" cambia a Colina', (text) => {
    step(FIRST, FIRST_CLAUDE);
    expect(step(text, {}).captured.comuna_o_ciudad).toBe('Colina');
  });
});

describe('formas comunes de dar la comuna (hallazgos 6 y 7 de Codex)', () => {
  it('"La comuna es: Lampa" da Lampa fuera de la respuesta', () => {
    expect(step('Necesito 20 paneles LED luz fría. La comuna es: Lampa', {}).captured.comuna_o_ciudad).toBe('Lampa');
  });

  it.each([
    ['victoria', 'Victoria'],
    ['la granja', 'La Granja'],
    ['Retiro', 'Retiro'],
  ])('"…para una bodega en %s" da %s', (written, comuna) => {
    expect(step('Necesito 20 focos para una bodega en ' + written, {}).captured.comuna_o_ciudad).toBe(comuna);
  });

  it('"…para una oficina en Lampa y son 20" da Lampa y la cantidad 20', () => {
    const r = step('Necesito paneles LED para una oficina en Lampa y son 20', {});
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.cantidad).toBe('20');
  });

  it('"La facturación es en Lampa, la obra también es en Lampa" da Lampa', () => {
    const r = step('Necesito 20 focos. La facturación es en Lampa, la obra también es en Lampa', { comuna_o_ciudad: 'Lampa' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toBeUndefined();
  });
});

describe('estado guardado por una versión anterior (hallazgo 8 de Codex)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina en Lampa';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };
  const withComuna = (value: unknown) => {
    const saved = flow.getFlowState(PHONE);
    flow.saveFlowState(PHONE, { ...saved, captured: { ...saved.captured, comuna_o_ciudad: value as string } });
  };

  it('una comuna que no está en la lista se borra y el bot la vuelve a preguntar', () => {
    step(FIRST, FIRST_CLAUDE);
    expect(flow.getFlowState(PHONE).stage).toBe('stage3');
    withComuna('Moragas');
    expect(flow.getFlowState(PHONE).captured.comuna_o_ciudad).toBeUndefined();
    const r = step('Soy Andrés Prueba, andres.prueba@example.com', { nombre: 'Andrés Prueba', correo: 'andres.prueba@example.com' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.shouldCreateDeal).toBe(false);
    expect(r.reply).toMatch(/comuna/i);
    const next = step('Lampa', {});
    expect(next.captured.comuna_o_ciudad).toBe('Lampa');
    expect(next.shouldCreateDeal).toBe(true);
  });

  it.each([
    ['nunoa', 'Ñuñoa'],
    ['Maipú, Región Metropolitana', 'Maipú'],
    ['Santiago Centro', 'Santiago'],
  ])('"%s" queda con su nombre oficial (%s)', (value, comuna) => {
    step(FIRST, FIRST_CLAUDE);
    withComuna(value);
    expect(flow.getFlowState(PHONE).captured.comuna_o_ciudad).toBe(comuna);
  });

  it('un valor que no es texto se borra', () => {
    step(FIRST, FIRST_CLAUDE);
    withComuna({ comuna: 'Lampa' });
    expect(flow.getFlowState(PHONE).captured.comuna_o_ciudad).toBeUndefined();
  });

  it('la comuna de la instalación tampoco queda fuera de la lista', () => {
    step('Busco un instalador para una casa en Lampa', {});
    const saved = flow.getFlowState(PHONE);
    flow.saveFlowState(PHONE, { ...saved, captured: { ...saved.captured, install_comuna: 'Moragas', comunas_otras: ['Moragas', 'nunoa'] } });
    expect(flow.getFlowState(PHONE).captured.install_comuna).toBeUndefined();
    expect(flow.getFlowState(PHONE).captured.comunas_otras).toEqual(['Ñuñoa']);
    const r = step('Soy Ana Prueba, ana.prueba@example.com', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' });
    expect(r.captured.install_comuna).toBeUndefined();
    expect(r.reply).toMatch(/comuna/i);
  });
});

describe('direcciones de leads (casos inventados)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina' };

  it('"Dirección: Fundo El Prueba de Lampa Km 8 s/n, Colina" da Colina', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('Dirección: Fundo El Prueba de Lampa Km 8 s/n, Colina', { comuna_o_ciudad: 'Lampa' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it('la dirección de los datos de la empresa va a otras comunas, no a la de la obra', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('RUT 11.111.111-1, Dirección: Av. Prueba 123, oficina 5, Providencia', { comuna_o_ciudad: 'Providencia' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toEqual(['Providencia']);
  });

  it('también con la razón social que Claude saca del texto', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('Razón social Comercial Prueba SpA, Dirección: Av. Prueba 123, Providencia', { empresa: 'Comercial Prueba SpA', comuna_o_ciudad: 'Providencia' });
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toEqual(['Providencia']);
  });
});

describe('revisión de los arreglos (casos inventados)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina en Lampa';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };

  it.each([
    ['Necesito 20 focos para la obra en Lampa de Constructora Prueba SpA', 'Lampa'],
    ['Necesito 20 focos para la bodega en Quilicura de Comercial Prueba Ltda', 'Quilicura'],
    ['NECESITO 20 FOCOS PARA BODEGA EN LAMPA EMPRESA PRUEBA SPA', 'Lampa'],
    ['Soy instalador, mi cliente necesita 30 paneles para su oficina en Las Condes', 'Las Condes'],
    ['Mi cliente necesita 40 focos para su bodega en Lampa', 'Lampa'],
    ['Hola, necesito factura por 20 paneles para Maipú', 'Maipú'],
    ['Necesito 30 paneles para Puente Alto con factura', 'Puente Alto'],
    ['Necesito 20 focos para Lampa con boleta', 'Lampa'],
    ['Necesito cambiar y retirar los tubos de una bodega en Lampa', 'Lampa'],
    ['Necesito retirar 20 equipos fluorescentes de una bodega en Lampa', 'Lampa'],
    ['Necesito 20 focos con despacho a domicilio en Maipú', 'Maipú'],
    ['Necesito 20 focos para mi casa, mi domicilio es en La Florida', 'La Florida'],
    ['Necesitamos paneles para la sucursal de Temuco', 'Temuco'],
    ['Necesito despachar 20 focos a Lampa. RUT 76.111.111-1, Dirección: Av. Prueba 123, Colina', 'Lampa'],
  ])('mensaje nuevo sin Claude: "%s" da %s', (text, comuna) => {
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe(comuna);
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it('"despacho a vicuña mackenna 1234, la florida" nunca da Vicuña', () => {
    expect(step('Necesito despacho a vicuña mackenna 1234, la florida', {}).captured.comuna_o_ciudad).not.toBe('Vicuña');
  });

  it.each([
    ['Puente Alto Constructora Prueba SpA', 'Puente Alto'],
    ['vicuña mackenna 1234, la florida', 'La Florida'],
    ['Mi domicilio es en La Florida', 'La Florida'],
  ])('respuesta a la pregunta por la comuna: "%s" da %s', (answer, comuna) => {
    step('Necesito 20 paneles LED luz fría para una oficina', { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina' });
    const r = step(answer, {});
    expect(r.captured.comuna_o_ciudad).toBe(comuna);
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it.each(['Antes dije Lampa pero es Colina', 'No es Lampa, es Colina', 'Es Colina, no Lampa'])('"%s" cambia la comuna a Colina', (text) => {
    step(FIRST, FIRST_CLAUDE);
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Lampa, ahora Colina']);
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it.each<[string, Claude]>([
    ['Soy Ana Prueba de Maipú', { nombre: 'Ana Prueba' }],
    ['Ana Prueba, ana.prueba@example.com, desde Maipú', { nombre: 'Ana Prueba', correo: 'ana.prueba@example.com' }],
  ])('instalación: "%s" no reemplaza la comuna de la casa en Lampa', (text, claude) => {
    expect(step('Busco un instalador para una casa en Lampa', {}).captured.install_comuna).toBe('Lampa');
    const r = step(text, claude);
    expect(r.captured.install_comuna).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Maipú']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('productos: "Soy Ana Prueba, desde Maipú" tampoco reemplaza la comuna de la obra', () => {
    step(FIRST, FIRST_CLAUDE);
    const r = step('Soy Ana Prueba, desde Maipú', { nombre: 'Ana Prueba' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Maipú']);
    expect(r.captured.cambios).toBeUndefined();
  });
});

describe('ronda 2 de Codex: etiquetas de obra, factura, razón social y origen (H5 a H8)', () => {
  const FIRST = 'Necesito 20 paneles LED luz fría para una oficina en Lampa';
  const FIRST_CLAUDE: Claude = { producto: 'paneles LED', tipo_de_luz: 'fria', cantidad: '20', proyecto_o_uso: 'oficina', comuna_o_ciudad: 'Lampa' };

  // Las dos regresiones de la tabla: con 4b5d1fc cambiaban a Colina.
  it.each(['Comuna: Colina con retiro en su local', 'La obra está dentro de Colina.'])('H5: con Lampa capturada, "%s" cambia a Colina', (text) => {
    step(FIRST, FIRST_CLAUDE);
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toContain('Comuna/ciudad: antes Lampa, ahora Colina');
  });

  it.each([
    'Necesito 20 paneles LED. Comuna de la obra: Colina con datos de facturación',
    'Necesito 20 paneles LED. *Comuna de la obra:* Colina con retiro en su local',
  ])('H5: "%s" da Colina en un mensaje nuevo (Claude vacío)', (text) => {
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it.each([
    'Facturación:\nDirección: Prueba 123\nComuna: Viña del Mar',
    'Facturación:\n*Dirección*: Prueba 123\n*Comuna*: Viña del Mar',
  ])('H6: el bloque de factura no cambia la comuna de la obra: %j', (text) => {
    step(FIRST, FIRST_CLAUDE);
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('H6: el bloque de factura tampoco llena una comuna vacía', () => {
    const r = step('Necesito 20 paneles LED para una oficina.\nFacturación:\nDirección: Prueba 123\nComuna: Viña del Mar', {});
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
  });

  it('H7: "Somos iluminación de los andes spa" con Claude vacío no da Los Andes', () => {
    const r = step('Somos iluminación de los andes spa, necesitamos 20 paneles LED', {});
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it('H7: "Necesito focos para un spa en Pucón" sigue dando Pucón', () => {
    expect(step('Necesito 20 focos para un spa en Pucón', {}).captured.comuna_o_ciudad).toBe('Pucón');
  });

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['elige el origen', { comuna_o_ciudad: 'Maipú' }],
    ['elige la obra', { comuna_o_ciudad: 'Lampa' }],
  ])('H8: "Soy de Maipú. La obra es en Lampa." da Lampa (Claude %s)', (_label, claude) => {
    const r = step('Necesito 20 paneles LED. Soy de Maipú. La obra es en Lampa.', claude);
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Maipú']);
  });

  it('H8: sin una comuna de obra, el origen sigue llenando la vacía', () => {
    const r = step('Necesito 20 paneles LED. Soy de Maipú', {});
    expect(r.captured.comuna_o_ciudad).toBe('Maipú');
  });

  it('H8: con dos comunas de obra, Claude elige entre ellas', () => {
    const r = step('Soy de Maipú. Necesito focos para una bodega en Lampa y otra en Colina', { comuna_o_ciudad: 'Colina' });
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.comunas_otras).toEqual(['Maipú', 'Lampa']);
  });
});

describe('revisión adversaria de la ronda 2: origen, razón social, calificador, H8 con la pregunta abierta y fin del bloque de factura', () => {
  const FIRST = 'Necesito 20 focos LED luz cálida para una bodega en Lampa';

  /** Lampa capturada con Claude vacío; el segundo mensaje no cambia la comuna. */
  function keepsLampa(text: string) {
    expect(step(FIRST, {}).captured.comuna_o_ciudad).toBe('Lampa');
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect((r.captured.cambios ?? []).filter((c) => c.startsWith('Comuna/ciudad'))).toEqual([]);
    return r;
  }

  // Regresión del arreglo de H5: un "de" sin "soy", "somos" o "vengo" pasaba a ser la obra.
  it.each([
    'Mi señora es de Colina',
    'La empresa es de Colina',
    'El dueño es de Colina',
    'Ana Prueba, de Colina',
    'ana prueba de colina',
    'Les escribe ana prueba de Colina',
    'Me recomendó un amigo de Colina',
    'Trabajo en una empresa de Colina',
  ])('con Lampa capturada, "%s" deja Colina en otras comunas', (text) => {
    expect(keepsLampa(text).captured.comunas_otras).toEqual(['Colina']);
  });

  // Regresión del arreglo de H7: la razón social en minúsculas presentada de otra forma.
  it.each([
    'Les escribo de iluminacion de los andes spa',
    'Empresa: iluminacion de los andes spa',
    'Mi empresa: iluminacion de los andes spa',
    'Ana Prueba, iluminacion de los andes spa',
    'Ana Prueba\niluminacion de los andes spa',
    'Cotización a nombre de iluminacion de los andes spa',
    'Pertenezco a iluminacion de los andes spa',
  ])('con Lampa capturada, "%s" no da Los Andes', (text) => {
    expect(keepsLampa(text).captured.comunas_otras).toBeUndefined();
  });

  it.each([
    'Les escribo de iluminacion de los andes spa, necesito 20 paneles LED',
    'Ana Prueba, iluminacion de los andes spa. Necesito 20 paneles LED',
  ])('con la comuna vacía, "%s" tampoco la llena con Los Andes', (text) => {
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  // Regresión: el calificador con guion ya no excluía la comuna de la etiqueta.
  it.each([
    ['Comuna: Providencia - facturación', ['Providencia']],
    ['Comuna: Providencia – facturación', ['Providencia']],
    ['Comuna: Quinta Normal - retiro', undefined],
  ])('con Lampa capturada, "%s" no cambia la obra', (text, otras) => {
    expect(keepsLampa(text).captured.comunas_otras).toEqual(otras);
  });

  // H8 con la pregunta por la comuna abierta: "soy" y "desde" contestaban, pero son de donde es la persona.
  it.each<[string, Claude]>([
    ['Soy de Maipú. La obra es en Lampa.', {}],
    ['Soy de Maipú, la casa queda en Lampa', {}],
    ['Ana Prueba, soy de Maipú. La bodega está en Lampa', {}],
    ['Soy de Maipú. La obra es en Lampa.', { comuna_o_ciudad: 'Maipú' }],
    ['Desde Maipú. La obra es en Lampa.', { comuna_o_ciudad: 'Maipú' }],
  ])('H8: el bot pregunta la comuna y "%s" da Lampa (Claude %j)', (text, claude) => {
    expect(step('Necesito 20 focos LED luz cálida para una casa', {}).reply).toMatch(/comuna/i);
    const r = step(text, claude);
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Maipú']);
  });

  it('H8: con la pregunta abierta, "Soy de Maipú" solo sigue llenando la comuna', () => {
    expect(step('Necesito 20 focos LED luz cálida para una casa', {}).reply).toMatch(/comuna/i);
    expect(step('Soy de Maipú', {}).captured.comuna_o_ciudad).toBe('Maipú');
  });

  // H6: la etiqueta del lugar que sigue al bloque de factura lo corta.
  it.each([
    'Dirección de la bodega: Otra 456',
    'Destino: Otra 456',
    'Lugar de trabajo: Otra 456',
    'Dónde se instalan: Otra 456',
    'Se instalan en: Otra 456',
    'Bodega:\nDirección: Otra 456',
    '',
  ])('H6: en un solo mensaje, después de la factura, %j da Lampa', (middle) => {
    const r = step('Necesito 20 focos LED luz cálida para una bodega.\nFacturación:\nDirección: Prueba 123\nComuna: Viña del Mar\n' + middle + '\nComuna: Lampa', {});
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.reply).not.toMatch(/comuna o ciudad/i);
  });
});

describe('ronda 3 de Codex: obra, empresa y factura (R8)', () => {
  const MAIPU = 'Necesito 20 paneles LED luz fría para una oficina en Maipú';

  it.each([
    'Facturación:\nGiro: Despacho de encomiendas\nDirección: Prueba 123\nComuna: Viña del Mar',
    'Facturación:\nObservaciones: requiere factura electrónica\nDirección: Prueba 123\nComuna: Viña del Mar',
  ])('con Maipú capturada, el bloque de factura no la cambia aunque un valor diga "despacho" o "requiere": %j', (text) => {
    expect(step(MAIPU, {}).captured.comuna_o_ciudad).toBe('Maipú');
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Maipú');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it('con la comuna vacía, el mismo bloque tampoco la llena', () => {
    const r = step('Necesito 20 paneles LED para una oficina.\nFacturación:\nGiro: Despacho de encomiendas\nDirección: Prueba 123\nComuna: Viña del Mar', {});
    expect(r.captured.comuna_o_ciudad).toBeUndefined();
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
  });

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['elige la empresa', { comuna_o_ciudad: 'Colina' }],
  ])('"Nuestra empresa está en Colina. La obra está en Lampa." con la comuna vacía da Lampa (Claude %s)', (_label, claude) => {
    const r = step('Nuestra empresa está en Colina. La obra está en Lampa.', claude);
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Colina']);
  });

  it('con Lampa capturada, "Nuestra empresa está en Colina" no la cambia', () => {
    step('Necesito 20 paneles LED luz fría para una oficina en Lampa', {});
    const r = step('Nuestra empresa está en Colina', {});
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toEqual(['Colina']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['toma el local', { proyecto_o_uso: 'local' }],
  ])('"La obra se encuentra en Colina con retiro en su local." da Colina y no deja "local" como proyecto (Claude %s)', (_label, claude) => {
    const r = step('La obra se encuentra en Colina con retiro en su local.', claude);
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['toma el local', { proyecto_o_uso: 'local' }],
  ])('"Comuna: Colina con retiro en su local" no deja "local" como proyecto (Claude %s)', (_label, claude) => {
    const r = step('Necesito 20 paneles LED. Comuna: Colina con retiro en su local', claude);
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.proyecto_o_uso).toBeUndefined();
  });

  it('con la oficina capturada, "Comuna: Colina con retiro en su local" cambia la comuna y no el proyecto', () => {
    step(MAIPU, {});
    const r = step('Comuna: Colina con retiro en su local', {});
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.proyecto_o_uso).toBe('oficina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Colina']);
  });

  it.each([
    ['Necesito 20 focos para su local en Colina', 'local'],
    ['Necesito retirar los tubos de la bodega en Colina', 'bodega'],
  ])('el local o la bodega del cliente siguen siendo el proyecto: "%s"', (text, proyecto) => {
    expect(step(text, {}).captured.proyecto_o_uso).toBe(proyecto);
  });
});

describe('revisión adversaria de R8 (ronda 3) en el flujo', () => {
  const MAIPU = 'Necesito 20 paneles LED luz fría para una oficina en Maipú';
  const ONE_LINE = 'Facturación: Prueba SpA, necesito 20 paneles LED luz fría para Lampa';

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['elige Lampa', { comuna_o_ciudad: 'Lampa', producto: 'paneles LED', cantidad: '20', tipo_de_luz: 'fria' }],
  ])('el encabezado y el pedido en una línea: con la comuna vacía da Lampa (Claude %s)', (_label, claude) => {
    const r = step(ONE_LINE, claude);
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.comunas_otras).toBeUndefined();
  });

  it('con Maipú capturada, "Facturación: Prueba SpA, ahora necesito los paneles para Lampa" cambia a Lampa', () => {
    step(MAIPU, {});
    const r = step('Facturación: Prueba SpA, ahora necesito los paneles para Lampa', { comuna_o_ciudad: 'Lampa' });
    expect(r.captured.comuna_o_ciudad).toBe('Lampa');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Lampa']);
  });

  it.each([
    'Facturación:\n- Giro: Despacho de encomiendas\n- Dirección: Prueba 123\n- Comuna: Viña del Mar',
    'Facturación:\n1. Giro: Despacho de encomiendas\n2. Dirección: Prueba 123\n3. Comuna: Viña del Mar',
    'Facturación:\n📌 Giro: Despacho de encomiendas\n📌 Comuna: Viña del Mar',
    'Facturación:\nGiro - Despacho de encomiendas\nComuna: Viña del Mar',
    'Facturación:\n- Observaciones: requiere factura electrónica\n- Comuna: Viña del Mar',
  ])('con Maipú capturada, la factura en lista no la cambia: %j', (text) => {
    step(MAIPU, {});
    const r = step(text, {});
    expect(r.captured.comuna_o_ciudad).toBe('Maipú');
    expect(r.captured.comunas_otras).toEqual(['Viña del Mar']);
    expect(r.captured.cambios).toBeUndefined();
  });

  it.each<[string, Claude]>([
    ['vacío', {}],
    ['elige la empresa', { comuna_o_ciudad: 'Colina' }],
  ])('con la comuna vacía, la obra explícita gana a "Somos una empresa ubicada en Colina" y sus variantes (Claude %s)', (_label, claude) => {
    for (const text of [
      'Somos una empresa ubicada en Colina. La obra está en Lampa.',
      'Estamos ubicados en Colina. La obra está en Lampa.',
      'Estamos en Colina. La obra está en Lampa.',
      'Nuestra constructora está en Colina. La obra está en Lampa.',
      'Trabajamos en Colina. La obra está en Lampa.',
    ]) {
      flow.clearFlowState(PHONE);
      const r = step(text, claude);
      expect(r.captured.comuna_o_ciudad, text).toBe('Lampa');
      expect(r.captured.comunas_otras, text).toEqual(['Colina']);
    }
  });

  it('con Maipú capturada, "Perdón, la empresa está en Colina" corrige la comuna', () => {
    step(MAIPU, {});
    const r = step('Perdón, la empresa está en Colina', {});
    expect(r.captured.comuna_o_ciudad).toBe('Colina');
    expect(r.captured.cambios).toEqual(['Comuna/ciudad: antes Maipú, ahora Colina']);
  });

  it.each([
    'Necesito 20 paneles LED, pasaré por su tienda',
    'Necesito 20 paneles LED, iré a su local',
    'Necesito 20 paneles LED, paso a buscarlos a su tienda',
  ])('la tienda de eLIGHTS no queda como proyecto: "%s"', (text) => {
    expect(step(text, {}).captured.proyecto_o_uso).toBeUndefined();
  });

  it('"los vamos a pasar a la oficina" es la oficina del cliente: sigue siendo el proyecto', () => {
    expect(step('Necesito 20 paneles, los vamos a pasar a la oficina', {}).captured.proyecto_o_uso).toBe('oficina');
  });
});
