// scripts/jumpseller/schema.ts
// Validación (zod) de lo que la sincronización LEE de la API de Jumpseller.
// Solo se validan los campos que se usan; el resto se ignora (y nunca se copia
// al snapshot: la normalización trabaja con una lista blanca de campos).

import { z } from 'zod';

const nullableString = z.string().nullable().optional();

export const rawCategorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  parent_id: z.number().int().positive().nullable(),
});

const rawProductCategorySchema = z.object({
  id: z.number().int().positive(),
  parent_id: z.number().int().positive().nullable().optional(),
});

const rawImageSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().url(),
  position: z.number().int().nullable().optional(),
});

const rawVariantSchema = z.object({
  id: z.number().int().positive(),
  position: z.number().int().nullable().optional(),
  price: z.coerce.number(),
  sku: nullableString,
  options: z
    .array(z.object({ name: z.string().nullable().optional(), value: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});

export const rawProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  permalink: z.string().min(1),
  sku: nullableString,
  price: z.coerce.number(),
  status: z.string(),
  brand: nullableString,
  featured: z.boolean().nullable().optional(),
  categories: z.array(rawProductCategorySchema).nullable().optional(),
  images: z.array(rawImageSchema).nullable().optional(),
  variants: z.array(rawVariantSchema).nullable().optional(),
  /** HTML de la descripción: solo se guarda limpio (sanitize-description.ts), en su propio archivo. */
  description: nullableString,
});

export type RawCategory = z.infer<typeof rawCategorySchema>;
export type RawProduct = z.infer<typeof rawProductSchema>;

export interface ValidationIssue {
  index: number;
  id: unknown;
  message: string;
}

/** Valida una lista; devuelve los válidos y los problemas (con id, sin volcar el objeto). */
export function validateList<T>(schema: z.ZodType<T>, items: unknown[]): { valid: T[]; issues: ValidationIssue[] } {
  const valid: T[] = [];
  const issues: ValidationIssue[] = [];
  items.forEach((item, index) => {
    const r = schema.safeParse(item);
    if (r.success) valid.push(r.data);
    else {
      const first = r.error.issues[0];
      issues.push({
        index,
        id: (item as { id?: unknown })?.id,
        message: `${first.path.join('.') || '(raíz)'}: ${first.message}`,
      });
    }
  });
  return { valid, issues };
}
