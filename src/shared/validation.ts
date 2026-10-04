import { z } from 'zod';
export const idSchema = z.string().uuid();
export const personalSchema = z.object({ rating: z.number().min(.5).max(10).multipleOf(.5).nullable(), review: z.string().max(20000), spoilers: z.boolean(), favorite: z.boolean(), watchlist: z.boolean(), watched: z.boolean(), tags: z.array(z.string().trim().min(1).max(80)).max(50) });
export const editSchema = z.object({ title: z.string().trim().min(1).max(300), year: z.number().int().min(1880).max(2200).nullable(), overview: z.string().max(20000), tags: z.array(z.string().trim().min(1).max(80)).max(50) });
export const candidateSchema = z.object({ id: z.number().int().positive(), kind: z.enum(['movie','series']), title: z.string().max(300), originalTitle: z.string().max(300), year: z.number().int().nullable(), overview: z.string().max(20000), poster: z.string().nullable(), confidence: z.number().min(0).max(1) });
export const settingsSchema = z.object({ completedPercent: z.number().int().min(50).max(100), hideSpoilers: z.boolean(), autoScan: z.boolean(), reopenLastLibrary: z.boolean().optional() });
