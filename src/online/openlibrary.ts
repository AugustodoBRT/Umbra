export interface OpenLibraryBook { key: string; title: string; authors: string[]; year: string; poster?: string; subjects: string[]; readable: boolean }
export const openLibraryHost = 'https://openlibrary.org/';
export const openLibraryPageSize = 40;
const fields = 'key,title,author_name,first_publish_year,cover_i,subject,has_fulltext';
// An ISBN-10/13 typed with or without hyphens searches by edition instead of by words.
export const isbnOf = (query: string) => { const digits = query.replace(/[\s-]/g,''); return /^(?:97[89]\d{10}|\d{9}[\dXx])$/.test(digits) ? digits.toUpperCase() : undefined; };
// Without a query the catalog lists the most wanted books, like a popular row; searches are free text.
export function openLibraryURL(query: string,skip: number,portuguese: boolean) {
  const url = new URL('search.json',openLibraryHost);
  url.searchParams.set('q',isbnOf(query) ? `isbn:${isbnOf(query)}` : query.trim() || 'language:por'); url.searchParams.set('fields',fields); url.searchParams.set('limit',String(openLibraryPageSize)); url.searchParams.set('offset',String(Math.max(0,skip)));
  if (!query.trim()) url.searchParams.set('sort','want_to_read');
  if (portuguese) url.searchParams.set('language','por');
  return url.href;
}
export const openLibraryItemURL = (key: string) => { const url = new URL('search.json',openLibraryHost); url.searchParams.set('q',`key:/works/${key}`); url.searchParams.set('fields',fields); url.searchParams.set('limit','1'); return url.href; };
export const openLibraryPage = (key: string) => `${openLibraryHost}works/${key}`;
export const openLibraryId = (key: string) => `ol:${key}`;
export function openLibraryKey(id: string) {
  const key = id.startsWith('ol:') ? id.slice(3) : ''; if (!/^OL\d+W$/.test(key)) throw new Error('Título do Open Library inválido.'); return key;
}
export function parseOpenLibrary(body: string): OpenLibraryBook[] {
  const data = JSON.parse(body); if (!Array.isArray(data?.docs)) throw new Error('O Open Library retornou uma resposta inválida.');
  return data.docs.flatMap((doc: any): OpenLibraryBook[] => {
    const key = typeof doc?.key === 'string' ? doc.key.replace('/works/','') : ''; if (!/^OL\d+W$/.test(key) || typeof doc.title !== 'string' || !doc.title.trim()) return [];
    const text = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    return [{ key,title: doc.title.trim().slice(0,500),authors: text(doc.author_name).slice(0,10),year: Number.isInteger(doc.first_publish_year) ? String(doc.first_publish_year) : '',poster: Number.isInteger(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,subjects: text(doc.subject).slice(0,6),readable: !!doc.has_fulltext }];
  });
}
// Titles from different catalogs differ in case, accents and subtitles; compare only the leading words.
export const sameTitle = (a: string,b: string) => { const flat = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').trim(); const [x,y] = [flat(a),flat(b)]; return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };
