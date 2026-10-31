import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Addons } from '../src/online/addons';
import { Credentials } from '../src/storage/credentials';
import { OnlineStore } from '../src/storage/online';
import { parseOpenLibrary, isbnOf, openLibraryURL, openLibraryKey, sameTitle } from '../src/online/openlibrary';

const docs = JSON.stringify({ docs: [{ key: '/works/OL1W',title: 'Dom Casmurro',author_name: ['Machado de Assis'],first_publish_year: 1899,cover_i: 77,subject: ['Romance'],has_fulltext: true },{ key: '/works/OL2W',title: 'Harry Potter',author_name: ['J. K. Rowling'] },{ key: 'lixo',title: 'sem chave' }] });
const gutenberg = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Resultados</title><id>x</id><entry><id>1</id><title>Dom Casmurro (Portuguese)</title><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/55752.opds"/></entry><entry><id>2</id><title>Outro livro (Portuguese)</title><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/1.opds"/></entry></feed>`;
const detail = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Dom Casmurro</title><id>d</id><entry><id>e</id><title>Dom Casmurro</title><link type="application/epub+zip" rel="http://opds-spec.org/acquisition" title="EPUB3" href="https://www.gutenberg.org/ebooks/55752.epub3.images"/></entry></feed>`;

test('lê o catálogo do Open Library e monta as consultas',() => {
  assert.deepEqual(parseOpenLibrary(docs).map(book => [book.key,book.title,book.year,book.poster,book.readable]),[['OL1W','Dom Casmurro','1899','https://covers.openlibrary.org/b/id/77-M.jpg',true],['OL2W','Harry Potter','',undefined,false]]);
  const popular = new URL(openLibraryURL('',0,true)); assert.equal(popular.searchParams.get('sort'),'want_to_read'); assert.equal(popular.searchParams.get('language'),'por');
  const free = new URL(openLibraryURL('dom casmurro',40,false)); assert.equal(free.searchParams.get('q'),'dom casmurro'); assert.equal(free.searchParams.get('offset'),'40'); assert.equal(free.searchParams.has('language'),false);
  assert.equal(new URL(openLibraryURL('978-85-359-0277-5',0,false)).searchParams.get('q'),'isbn:9788535902775'); assert.equal(isbnOf('0-306-40615-2'),'0306406152'); assert.equal(isbnOf('1984'),undefined); assert.equal(isbnOf('harry potter 7'),undefined);
  assert.equal(openLibraryKey('ol:OL1W'),'OL1W'); assert.throws(() => openLibraryKey('ol:../x'),/inválido/);
  assert.ok(sameTitle('Dom Casmurro','dom casmurro (Portuguese)')); assert.ok(!sameTitle('Dom Casmurro','Dom Quixote'));
});

test('Open Library lista todos os livros, pagina e oferece Gutenberg e a página do livro como fontes',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'umbra-ol-')); const urls: string[] = [];
  const credentials = new Credentials(directory,{ available: () => false,encrypt: () => Buffer.alloc(0),decrypt: () => '' }); await credentials.saveDocument('addons',[]);
  const store = new OnlineStore(directory);
  const server = createServer((request,response) => { response.setHeader('content-type','application/json'); response.end(docs); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const fetcher = (async (input: any,init: any) => {
    const url = String(input); urls.push(url);
    if (url.startsWith('https://openlibrary.org/search.json')) return new Response(docs);
    if (url.startsWith('https://www.gutenberg.org/ebooks/search.opds/')) return new Response(gutenberg);
    if (url === '/ebooks/55752.opds' || url === 'https://www.gutenberg.org/ebooks/55752.opds') return new Response(detail);
    return fetch(url,init);
  }) as typeof fetch;
  const addons = new Addons(credentials,store,undefined,{ fetch: fetcher }); await addons.initialize();
  try {
    await addons.install('https://openlibrary.org/'); const addon = addons.list().find(a => a.kind === 'openlibrary')!;
    assert.deepEqual(addon.types,['book']); assert.deepEqual(addon.catalogs.map(c => [c.name,c.search,c.pagination,c.searchRequired]),[['Todos os livros',true,true,false],['Em português',true,true,false]]);
    const livres = await addons.catalog(addon.id,'all','book','dom casmurro',40); assert.deepEqual(livres.map((item: { name: string }) => item.name),['Dom Casmurro','Harry Potter']);
    assert.ok(urls.some(url => url.includes('q=dom+casmurro') && url.includes('offset=40')));
    const found = await addons.search('book','harry'); assert.equal(found.searched,2);
    const result = await addons.sources(addon.id,'book',livres[0].id,livres[0].id);
    assert.deepEqual(result.sources.map(s => [s.provider,!!s.external,s.format]),[['Project Gutenberg',false,'epub'],['Open Library',true,undefined]]);
    assert.equal(addons.getStreamForSource(result.sources[1].id).raw.url,'https://openlibrary.org/works/OL1W');
    const semMatch = await addons.sources(addon.id,'book',(await addons.catalog(addon.id,'all','book','harry'))[1].id,'ol:OL2W'); assert.deepEqual(semMatch.sources.map(s => s.provider),['Open Library']);
  } finally { addons.cancel(); server.close(); server.closeAllConnections(); store.close(); await rm(directory,{ recursive: true,force: true }); }
});
