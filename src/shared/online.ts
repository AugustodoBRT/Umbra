import type { Personal } from './types';
export type OnlineType = 'movie'|'series'|'book'|'audiobook';
export interface AddonCatalog { id: string; type: OnlineType; name: string; search: boolean; pagination: boolean; genres: string[]; searchRequired?: boolean }
export interface AddonSummary { id: string; name: string; description: string; host: string; enabled: boolean; resources: string[]; catalogs: AddonCatalog[]; kind?: 'stremio'|'opds'|'abb'; types: string[]; sourceResources: { types: string[]; idPrefixes?: string[] }[] }
export interface OnlineVideo { id: string; title: string; season: number; episode: number; overview?: string; released?: string }
export interface OnlineLocalization { description?: string; genres?: string[]; updatedAt: string }
export interface OnlineItem { id: string; addonId: string; type: OnlineType; name: string; year: string; description: string; poster?: string; background?: string; genres: string[]; imdbRating: number | null; videos: OnlineVideo[]; personal: Personal; metadataLanguage?: 'pt-BR'; translationNote?: string; authors?: string[]; narrators?: string[] }
export interface SourceLanguage { code: string; label: string; country?: string }
export interface SourceDetails { filename: string; quality: string[]; size: string; seeders: number | null; audio: SourceLanguage[]; subtitles: SourceLanguage[]; languages: SourceLanguage[]; audioNote: string; subtitleNote: string; linkedSubtitles: boolean }
export interface OnlineSource { id: string; addonId: string; addonName: string; name: string; description: string; transport: 'torrent'|'http'; provider: string; releaseGroup: string; details?: SourceDetails; external?: boolean; format?: string; part?: number }
export interface SourceResult { sources: OnlineSource[]; errors: string[] }
export interface SeasonPlan { id: string; title: string; season: number; source: string; episodes: { video: OnlineVideo; sources: OnlineSource[]; selected: string | null; error?: string }[] }
export interface DownloadJob { id: string; title: string; itemName: string; sourceName: string; season?: number; episode?: number; state: 'queued'|'metadata'|'downloading'|'paused'|'completed'|'error'|'cancelled'; downloaded: number; total: number; speed: number; peers: number; root: string; directory: string; fileName: string; error?: string; createdAt: string }
export interface DownloadsSnapshot { jobs: DownloadJob[]; root: string; torrentAvailable: boolean }

export interface CatalogResult { items: OnlineItem[]; errors: string[]; searched: number; skipped: number }
