// src/components/forms/FileAttachments.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Campo «Adjuntar archivos (opcional)» del cotizador (/cotizador), según la especificación
// «Adjuntar archivos» (22-10-2026, §1). Va después de «Comentarios adicionales», dentro del
// fieldset que se habilita al hidratar: en el HTML del prerender se ve igual, deshabilitado.
//
// - Al elegir solo se revisan la extensión, el peso y la cantidad (las mismas reglas del
//   servidor, api/_lib/attachments/rules.ts). Todavía no se sube nada: la subida es al
//   enviar (decisión D1 del dueño) y la hace SmartQuotePage (attachments.ts).
// - Los errores van bajo el campo, en una región aria-live. Si falla una subida, o hoy no se
//   pueden recibir archivos (D2), el aviso trae sus botones y el foco pasa al primero.
// - Contacto solo ventas@elights.cl. Los nombres de archivo nunca van a la consola.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_FILES, checkSelectedFile, formatBytes } from '../../../api/_lib/attachments/rules';
import { ACCEPT, ATTACHMENT_TEXTS, randomId, type AttachmentItem, type UploadProblem } from './attachments';

interface FileAttachmentsProps {
  /** Prefijo de los ids (el formulario usa «sq»). */
  idPrefix: string;
  items: AttachmentItem[];
  /** Lista nueva después de elegir o quitar. */
  onChange: (items: AttachmentItem[]) => void;
  /** Mientras se envía: no se elige ni se quita nada. */
  busy?: boolean;
  problem?: UploadProblem | null;
  onRetry: () => void;
  onSkipFailed: () => void;
  onSendWithout: () => void;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

const FileAttachments = ({ idPrefix, items, onChange, busy = false, problem = null, onRetry, onSkipFailed, onSendWithout }: FileAttachmentsProps) => {
  const [selectionErrors, setSelectionErrors] = useState<string[]>([]);
  const firstAction = useRef<HTMLButtonElement>(null);
  const ids = {
    input: `${idPrefix}-archivos`,
    title: `${idPrefix}-archivos-title`,
    help: `${idPrefix}-archivos-help`,
    errors: `${idPrefix}-archivos-errors`,
  };

  // Un aviso nuevo de la subida lleva el foco a su primer botón (el visitante estaba en «Enviar»).
  useEffect(() => {
    if (problem) firstAction.current?.focus();
  }, [problem]);

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    // Vacía el selector: así se puede volver a elegir un archivo que se quitó
    e.target.value = '';
    if (!chosen.length) return;
    const errors: string[] = [];
    const next = [...items];
    let overLimit = false;
    for (const file of chosen) {
      const check = checkSelectedFile(file);
      if (check.ok === false) {
        if (check.reason === 'format') errors.push(ATTACHMENT_TEXTS.format(file.name));
        else if (check.reason === 'empty') errors.push(ATTACHMENT_TEXTS.empty(file.name));
        else errors.push(ATTACHMENT_TEXTS.size(file.name, file.size));
        continue;
      }
      if (next.some((item) => sameFile(item.file, file))) continue; // el mismo archivo dos veces
      if (next.length >= MAX_FILES) {
        overLimit = true;
        continue;
      }
      next.push({ id: randomId(), file, ext: check.ext });
    }
    if (overLimit) errors.push(ATTACHMENT_TEXTS.tooMany);
    setSelectionErrors(errors);
    if (next.length !== items.length) onChange(next);
  };

  const remove = (id: string) => {
    setSelectionErrors([]);
    onChange(items.filter((item) => item.id !== id));
  };

  const failed = problem?.kind === 'failed' ? items.find((item) => item.id === problem.id) : undefined;
  const hasErrors = selectionErrors.length > 0 || Boolean(failed) || problem?.kind === 'limit';

  return (
    <div role="group" aria-labelledby={ids.title} aria-describedby={ids.help}>
      <p id={ids.title} className="text-sm font-medium mb-1">
        {ATTACHMENT_TEXTS.title}
      </p>
      <p id={ids.help} className="text-xs text-muted-foreground mb-2">
        {ATTACHMENT_TEXTS.help}
      </p>
      {/* El selector nativo, oculto a la vista pero no al teclado: la etiqueta hace de botón y
          muestra el foco (peer-focus-visible). Dentro del fieldset: deshabilitado antes de hidratar. */}
      <input
        id={ids.input}
        name="archivos"
        type="file"
        multiple
        accept={ACCEPT}
        disabled={busy}
        onChange={handleSelect}
        aria-describedby={hasErrors ? `${ids.help} ${ids.errors}` : ids.help}
        className="peer sr-only"
      />
      <label
        htmlFor={ids.input}
        className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium cursor-pointer hover:bg-accent hover:text-accent-foreground peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {ATTACHMENT_TEXTS.choose}
      </label>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Archivos elegidos">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-all">{item.file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(item.file.size)}</span>
              <Button type="button" variant="ghost" size="sm" className="shrink-0 h-8 px-2" disabled={busy} onClick={() => remove(item.id)}>
                <X className="h-4 w-4" aria-hidden="true" />
                {ATTACHMENT_TEXTS.remove}
                <span className="sr-only"> {item.file.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Siempre presente, para que el lector de pantalla anuncie lo que aparezca */}
      <div id={ids.errors} aria-live="polite" className="text-sm leading-snug">
        {selectionErrors.map((message) => (
          <p key={message} className="mt-2 break-words text-red-700">
            {message}
          </p>
        ))}
        {failed && (
          <div className="mt-2">
            <p className="break-words text-red-700">{ATTACHMENT_TEXTS.uploadFailed(failed.file.name)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button ref={firstAction} type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>
                {ATTACHMENT_TEXTS.retry}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onSkipFailed}>
                {ATTACHMENT_TEXTS.skipFile}
              </Button>
            </div>
          </div>
        )}
        {problem?.kind === 'limit' && (
          <div className="mt-2">
            <p className="text-red-700">{ATTACHMENT_TEXTS.dailyLimit}</p>
            <div className="mt-2">
              <Button ref={firstAction} type="button" variant="outline" size="sm" disabled={busy} onClick={onSendWithout}>
                {ATTACHMENT_TEXTS.sendWithout}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileAttachments;
