import { z } from 'zod';

// Single source for the label-note schema, shared by PUT /accounts/:id/label
// and POST /accounts/labels/bulk (R42-C: the class is "every endpoint accepting
// a note", and it has two members).
//
// The newline rejection is C24/I24.1. A note is operator-authored free text
// entered through a single-line input, so a `\r` or `\n` there is always a
// mistake — rejecting at the boundary keeps it out of the database entirely.
// (Provider- and HR-supplied fields cannot be guarded this way; the CSV export
// strips newlines per-cell instead — see apps/web/src/lib/csv-export.ts.)
export const noteSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[^\r\n]*$/, 'note must not contain line breaks')
  .optional();
