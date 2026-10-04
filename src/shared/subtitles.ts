import { z } from 'zod';

export const subtitleAppearanceSchema = z.object({
  fontSize: z.number().int().min(16).max(56),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  background: z.enum(['none','translucent','black']),
  outline: z.boolean(),
  bottom: z.number().int().min(2).max(35)
});
export type SubtitleAppearance = z.infer<typeof subtitleAppearanceSchema>;
export const defaultSubtitleAppearance: SubtitleAppearance = { fontSize: 24,color: '#ffffff',background: 'translucent',outline: true,bottom: 5 };
