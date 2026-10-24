// src/components/catalog/DialuxStudyBox.tsx
// Caja «Estudio DIALux (servicio cotizado)» bajo los botones de la ficha (auditoría UX, E-02),
// en proyectores, campanas, alumbrado público, antiexplosivos y solares (src/lib/studyLink.ts).
// Antes, 120 fichas mencionaban el estudio y ninguna lo enlazaba. Los textos y sus reglas están
// en src/config/navigation.ts (DIALUX_BOX_TEXT).
// El título no es un h2: la caja no es una sección de la ficha.

import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DIALUX_BOX_TEXT } from '@/config/navigation';

const DialuxStudyBox = ({ href }: { href: string }) => {
  const titleId = useId();
  return (
    <aside aria-labelledby={titleId} className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4" data-dialux-box="">
      <p id={titleId} className="flex items-center gap-2 text-sm font-semibold mb-1">
        <Ruler className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        {DIALUX_BOX_TEXT.title}
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{DIALUX_BOX_TEXT.text}</p>
      <Button asChild size="sm" variant="outline" className="border-primary/30 text-primary hover:bg-accent">
        <Link to={href}>{DIALUX_BOX_TEXT.button}</Link>
      </Button>
    </aside>
  );
};

export default DialuxStudyBox;
