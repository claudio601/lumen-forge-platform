// «Recordar mis datos en este dispositivo» (especificación del 23-10-2026, §5): el módulo que
// lee, valida, mezcla, guarda y borra 'elights_contact'. Datos inventados: correos example.com
// y el RUT de prueba de los tests de /cotizacion (rango 44 millones, sin asignar).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVED_CONTACT_MAX_AGE_MS,
  SAVED_CONTACT_STORAGE_KEY,
  SAVED_CONTACT_VERSION,
  clearSavedContact,
  mergeSavedContact,
  prefillFor,
  purgeSavedContact,
  readSavedContact,
  saveSavedContact,
  savedContactAvailable,
  type SavedContact,
} from './savedContact';

const KEY = SAVED_CONTACT_STORAGE_KEY;
const NOW = Date.parse('2026-10-23T14:03:12.000Z');
const DAY = 24 * 60 * 60 * 1000;
const RUT = '44.444.444-4';

const ANA: SavedContact = {
  nombre: 'PRUEBA Ana - borrar',
  email: 'prueba-ana@example.com',
  telefono: '+56 9 0000 0921',
};

const seed = (value: unknown) => localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));
const stored = () => JSON.parse(localStorage.getItem(KEY)!);
const record = (data: object, at = new Date(NOW).toISOString(), v = SAVED_CONTACT_VERSION) => ({ v, at, data });

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('savedContact: guardar, leer y borrar', () => {
  it("guarda en 'elights_contact' {v, at, data} con la hora del envío y lo lee de vuelta", () => {
    expect(saveSavedContact('instalacion', ANA, NOW)).toBe(true);
    expect(Object.keys(stored())).toEqual(['v', 'at', 'data']);
    expect(stored()).toEqual({ v: 1, at: '2026-10-23T14:03:12.000Z', data: ANA });
    expect(readSavedContact(NOW + 1000)).toEqual({ at: '2026-10-23T14:03:12.000Z', data: ANA });
  });

  it('las claves van siempre en el mismo orden, recortadas y con el RUT con formato', () => {
    saveSavedContact('cotizacion', {
      rut: '444444444', direccion: ' Prueba 123 ', giro: 'Prueba', empresa: 'PRUEBA SpA', tipoCliente: 'empresa',
      telefono: ' +56 9 0000 0921 ', email: ' prueba-ana@example.com ', nombre: ' PRUEBA Ana - borrar ',
    }, NOW);
    expect(Object.keys(stored().data)).toEqual(['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'giro', 'direccion', 'rut']);
    expect(stored().data).toMatchObject({ ...ANA, rut: RUT, direccion: 'Prueba 123' });
  });

  it('clearSavedContact borra lo guardado', () => {
    saveSavedContact('instalacion', ANA, NOW);
    clearSavedContact();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readSavedContact(NOW)).toBeNull();
  });

  it('sin nada guardado: null, sin escribir nada', () => {
    expect(readSavedContact(NOW)).toBeNull();
    purgeSavedContact(NOW);
    expect(localStorage.length).toBe(0);
  });
});

describe('savedContact: lo que no sirve se borra al leerlo', () => {
  it.each([
    ['otra versión del formato (v 2)', record(ANA, undefined, 2)],
    ['sin versión', { at: new Date(NOW).toISOString(), data: ANA }],
    ['vencido (12 meses desde el último envío)', record(ANA, new Date(NOW - SAVED_CONTACT_MAX_AGE_MS).toISOString())],
    ['con `at` más de 1 día en el futuro', record(ANA, new Date(NOW + DAY + 60_000).toISOString())],
    ['con `at` ilegible', record(ANA, 'ayer')],
    ['JSON roto', '{"v":1,"at":'],
    ['un arreglo', '[1,2]'],
    ['sin correo', record({ nombre: 'PRUEBA Ana - borrar' })],
  ])('%s', (_, value) => {
    seed(value);
    expect(readSavedContact(NOW)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a 1 día de vencer y con el reloj adelantado menos de 1 día, sigue vigente', () => {
    seed(record(ANA, new Date(NOW - SAVED_CONTACT_MAX_AGE_MS + DAY).toISOString()));
    expect(readSavedContact(NOW)?.data).toEqual(ANA);
    seed(record(ANA, new Date(NOW + DAY - 60_000).toISOString()));
    expect(readSavedContact(NOW)?.data).toEqual(ANA);
  });

  it('purgeSavedContact borra lo vencido y deja lo vigente', () => {
    seed(record(ANA, new Date(NOW - 400 * DAY).toISOString()));
    purgeSavedContact(NOW);
    expect(localStorage.getItem(KEY)).toBeNull();
    seed(record(ANA));
    purgeSavedContact(NOW);
    expect(stored().data).toEqual(ANA);
  });
});

describe('savedContact: al leer solo se aceptan valores conocidos y válidos', () => {
  it('ignora claves desconocidas, textos demasiado largos, una región fuera de REGIONS, un tipo raro y un RUT inválido', () => {
    seed(record({
      ...ANA,
      comentarios: 'no va', website: 'bot', consent: { privacy: true }, m2: '1200', ciudad: 'Santiago',
      empresa: 'x'.repeat(201),
      giro: 'Prueba',
      region: 'Región de Narnia',
      tipoCliente: 'hogar',
      rut: '44.444.444-5',
      comuna: 42,
    }));
    expect(readSavedContact(NOW)?.data).toEqual({ ...ANA, giro: 'Prueba' });
  });

  it('acepta la región de la lista, el tipo empresa y un RUT válido (con K)', () => {
    seed(record({ ...ANA, tipoCliente: 'empresa', region: 'Valparaiso', rut: '44444407k' }));
    expect(readSavedContact(NOW)?.data).toEqual({ ...ANA, tipoCliente: 'empresa', region: 'Valparaiso', rut: '44.444.407-K' });
  });
});

describe('savedContact: almacenamiento bloqueado', () => {
  it('si getItem lanza: no se cae, no hay datos y la casilla se quita', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(readSavedContact(NOW)).toBeNull();
    expect(() => purgeSavedContact(NOW)).not.toThrow();
    expect(savedContactAvailable()).toBe(false);
  });

  it('si setItem lanza: guardar devuelve false sin caerse y la casilla se quita', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota llena'); });
    expect(saveSavedContact('instalacion', ANA, NOW)).toBe(false);
    expect(savedContactAvailable()).toBe(false);
  });

  it('si removeItem lanza: borrar no se cae', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(() => clearSavedContact()).not.toThrow();
    seed('{roto');
    expect(readSavedContact(NOW)).toBeNull();
  });

  it('con el almacenamiento disponible, la prueba no deja nada escrito', () => {
    expect(savedContactAvailable()).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});

describe('savedContact: mezcla de un envío confirmado con lo guardado', () => {
  const empresa: SavedContact = { ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Ana SpA', giro: 'Prueba', direccion: 'Prueba 123', rut: RUT };

  it('un correo distinto reemplaza todo, sin mezclar', () => {
    const otro = { nombre: 'PRUEBA Beto - borrar', email: 'prueba-beto@example.com', telefono: '+56 9 0000 0922' };
    expect(mergeSavedContact('instalacion', { ...empresa, comuna: 'Santiago', region: 'Valparaiso' }, otro)).toEqual(otro);
  });

  it('con el mismo correo (aunque cambien las mayúsculas), un campo vacío no borra lo guardado', () => {
    expect(mergeSavedContact('cotizador', empresa, { ...ANA, email: 'PRUEBA-ANA@example.com ', telefono: '', nombre: 'PRUEBA Ana B.' })).toEqual({
      ...empresa,
      email: 'PRUEBA-ANA@example.com',
      nombre: 'PRUEBA Ana B.',
    });
  });

  it('/instalacion no borra la empresa ni escribe la comuna', () => {
    const prev = { ...empresa, comuna: 'Maipú', region: 'Región Metropolitana' };
    const next = mergeSavedContact('instalacion', prev, { ...ANA, comuna: 'Santiago', empresa: 'Otra', tipoCliente: 'persona' } as SavedContact);
    expect(next).toEqual(prev);
  });

  it('una empresa con otro nombre borra el RUT, el giro y la dirección que no vinieron', () => {
    expect(mergeSavedContact('estudio-luminico', empresa, { ...ANA, empresa: 'PRUEBA Otra Ltda.' })).toEqual({
      ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Otra Ltda.',
    });
    // El mismo nombre (otras mayúsculas o espacios) no es otra empresa
    expect(mergeSavedContact('estudio-luminico', empresa, { ...ANA, empresa: ' prueba  ana spa ' })).toEqual({ ...empresa, empresa: 'prueba  ana spa' });
    // En /solicitar-pedido el RUT es opcional: otra empresa sin RUT no hereda el de la anterior
    expect(mergeSavedContact('solicitar-pedido', empresa, { ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Otra Ltda.' })).toEqual({
      ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Otra Ltda.',
    });
  });

  it('/cotizador con razón social pasa el tipo a empresa; sin ella no lo pasa a persona ni guarda giro ni RUT sueltos', () => {
    const persona = { ...ANA, tipoCliente: 'persona' as const };
    expect(mergeSavedContact('cotizador', persona, { ...ANA, empresa: 'PRUEBA Ana SpA', giro: 'Prueba', rut: RUT })).toEqual({
      ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Ana SpA', giro: 'Prueba', rut: RUT,
    });
    expect(mergeSavedContact('cotizador', persona, { ...ANA, giro: 'Prueba', rut: RUT, direccion: 'Prueba 123' })).toEqual(persona);
    expect(mergeSavedContact('cotizador', null, ANA)).toEqual(ANA);
  });

  it('/cotizador no guarda un RUT inválido (no revisa el dígito verificador)', () => {
    expect(mergeSavedContact('cotizador', null, { ...ANA, empresa: 'PRUEBA Ana SpA', rut: '44.444.444-5' })).toEqual({
      ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Ana SpA',
    });
  });

  it('con selector, la empresa se guarda solo si se envió como empresa; como persona, la guardada queda', () => {
    expect(mergeSavedContact('cotizacion', null, { ...ANA, tipoCliente: 'persona', empresa: 'PRUEBA Ana SpA', rut: RUT })).toEqual({
      ...ANA, tipoCliente: 'persona',
    });
    expect(mergeSavedContact('cotizacion', empresa, { ...ANA, tipoCliente: 'persona' })).toEqual({ ...empresa, tipoCliente: 'persona' });
  });

  it('comuna y región solo desde /solicitar-pedido; la región solo de la lista', () => {
    expect(mergeSavedContact('solicitar-pedido', null, { ...ANA, tipoCliente: 'persona', comuna: 'Maipú', region: 'Región Metropolitana' })).toEqual({
      ...ANA, tipoCliente: 'persona', comuna: 'Maipú', region: 'Región Metropolitana',
    });
    expect(mergeSavedContact('solicitar-pedido', null, { ...ANA, tipoCliente: 'persona', region: 'Otra' })).toEqual({ ...ANA, tipoCliente: 'persona' });
    expect(mergeSavedContact('cotizacion', null, { ...ANA, tipoCliente: 'persona', comuna: 'Maipú', region: 'Valparaiso' })).toEqual({ ...ANA, tipoCliente: 'persona' });
  });

  it('sin correo no guarda nada', () => {
    expect(mergeSavedContact('instalacion', null, { nombre: 'PRUEBA', telefono: '+56 9 0000 0921' })).toBeNull();
    expect(saveSavedContact('instalacion', { nombre: 'PRUEBA' }, NOW)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('saveSavedContact mezcla con lo vigente y reemplaza lo vencido', () => {
    saveSavedContact('cotizacion', empresa, NOW);
    saveSavedContact('instalacion', { ...ANA, telefono: '+56 9 0000 0929' }, NOW + DAY);
    expect(stored()).toEqual({ v: 1, at: new Date(NOW + DAY).toISOString(), data: { ...empresa, telefono: '+56 9 0000 0929' } });
    seed(record(empresa, new Date(NOW - 400 * DAY).toISOString()));
    saveSavedContact('instalacion', ANA, NOW);
    expect(stored().data).toEqual(ANA);
  });
});

describe('savedContact: lo que completa cada formulario', () => {
  const all: SavedContact = {
    ...ANA, tipoCliente: 'empresa', empresa: 'PRUEBA Ana SpA', giro: 'Prueba', direccion: 'Prueba 123', rut: RUT, comuna: 'Maipú', region: 'Valparaiso',
  };

  it('cada formulario lee solo sus claves (tabla de §3)', () => {
    expect(Object.keys(prefillFor('cotizacion', all))).toEqual(['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'giro', 'direccion', 'rut']);
    expect(Object.keys(prefillFor('solicitar-pedido', all))).toEqual(['nombre', 'email', 'telefono', 'tipoCliente', 'empresa', 'rut', 'comuna', 'region']);
    expect(Object.keys(prefillFor('cotizador', all))).toEqual(['nombre', 'email', 'telefono', 'empresa', 'giro', 'direccion', 'rut']);
    expect(Object.keys(prefillFor('estudio-luminico', all))).toEqual(['nombre', 'email', 'telefono', 'empresa']);
    expect(Object.keys(prefillFor('instalacion', all))).toEqual(['nombre', 'email', 'telefono', 'comuna']);
  });

  it('un valor que supera el tope de un formulario no se completa ahí', () => {
    const long = { ...all, empresa: 'E'.repeat(160) };
    expect(prefillFor('cotizacion', long).empresa).toBe(long.empresa); // hasta 200
    expect(prefillFor('cotizador', long)).not.toHaveProperty('empresa'); // hasta 150
    expect(prefillFor('estudio-luminico', long)).not.toHaveProperty('empresa'); // hasta 120
  });
});
