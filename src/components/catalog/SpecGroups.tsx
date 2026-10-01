// Especificaciones técnicas en el formato de las fichas BESTLED: filas "etiqueta | valor"
// en tres grupos (Eléctrico y fotométrico, Construcción y operación, Componentes y
// control) y las aplicaciones. Lo usan los BESTLED (contenido editorial) y el resto de
// los productos (tabla de Jumpseller ordenada en la sincronización: scripts/jumpseller/spec-groups.ts).

import type { SpecRow } from '@/data/catalog/jumpseller.types';

export interface SpecGroupsProps {
  electricos?: readonly SpecRow[];
  construccion?: readonly SpecRow[];
  componentes?: readonly SpecRow[];
  applications?: readonly string[];
  /** Tablas que no son "etiqueta | valor" (p. ej. la comparativa de una familia), en HTML limpio. */
  tablesHtml?: string;
}

const GROUPS = [
  ['electricos', 'Eléctrico y fotométrico'],
  ['construccion', 'Construcción y operación'],
  ['componentes', 'Componentes y control'],
] as const;

const SpecGroups = ({ applications, tablesHtml, ...rows }: SpecGroupsProps) => {
  const groups = GROUPS.map(([key, title]) => ({ title, rows: rows[key] ?? [] })).filter(g => g.rows.length > 0);
  return (
    <section className="mb-12">
      <h2 className="text-xl font-bold mb-6">Especificaciones técnicas</h2>
      {groups.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl">
          {groups.map(g => (
            <div key={g.title}>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">{g.title}</h3>
              <div className="border rounded-xl overflow-hidden">
                {g.rows.map((s, i) => {
                  const zebra = i % 2 === 0 ? 'bg-surface' : 'bg-background';
                  // Valores de varias líneas (packaging, modos de control): debajo de la etiqueta
                  return s.value.includes('\n') ? (
                    <div key={i} className={'px-4 py-2.5 text-sm ' + zebra}>
                      <span className="block text-muted-foreground">{s.label}</span>
                      <span className="block font-medium whitespace-pre-line mt-0.5">{s.value}</span>
                    </div>
                  ) : (
                    <div key={i} className={'flex justify-between gap-3 px-4 py-2.5 text-sm ' + zebra}>
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-medium text-right">{s.value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {tablesHtml && (
        // HTML limpio en la sincronización (scripts/jumpseller/sanitize-description.ts): solo tablas
        <div
          className="mt-6 max-w-4xl overflow-x-auto rounded-xl border text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_tr:nth-child(odd)]:bg-surface [&_td:first-child]:text-muted-foreground [&_table+table]:mt-4"
          dangerouslySetInnerHTML={{ __html: tablesHtml }}
        />
      )}
      {applications && applications.length > 0 && (
        <div className="mt-8 max-w-3xl">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">Aplicaciones</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {applications.map(a => (
              <div key={a} className="flex items-center gap-2 text-sm bg-surface rounded-lg p-3">
                <span className="h-2 w-2 bg-primary rounded-full shrink-0" />
                {a}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SpecGroups;
