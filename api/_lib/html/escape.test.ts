// api/_lib/html/escape.test.ts

import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape';

describe('escapeHtml', () => {
  it('escapa & < > " y \'', () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
    );
  });

  it('escapa primero el & (no deja entidades a medias)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('deja igual el texto sin caracteres especiales, con tildes y ñ', () => {
    expect(escapeHtml('Ñuñoa · Agencia Starken 3,2 kg')).toBe('Ñuñoa · Agencia Starken 3,2 kg');
  });

  it('un número se escribe tal cual; null y undefined, vacío', () => {
    expect(escapeHtml(8430)).toBe('8430');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
