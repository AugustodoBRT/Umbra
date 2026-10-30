import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOPDS } from '../src/online/opds';

const entry = (id: number,title: string) => `<entry><id>https://www.gutenberg.org/ebooks/${id}.opds</id><title>${title}</title><content type="text">Machado de Assis</content><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/${id}.opds"/><link type="image/png" rel="http://opds-spec.org/image/thumbnail" href="data:image/png;base64,AAAA"/></entry>`;
const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Books: Language: Portuguese</title><id>x</id><link rel="search" type="application/opensearchdescription+xml" href="https://www.gutenberg.org/catalog/osd-books.xml"/>${entry(55752,'Dom Casmurro (Portuguese)')}${entry(54829,'Quincas Borba (Portuguese)')}<entry><id>popular</id><title>Populares</title><link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/search.opds/?sort_order=downloads"/></entry></feed>`;

test('livros do Gutenberg que apontam para o próprio feed viram títulos com detalhe preguiçoso, não seções',() => {
  const result = parseOPDS(feed,'https://www.gutenberg.org/ebooks/search.opds/?query=l.pt');
  assert.deepEqual(result.books.map(book => [book.name,book.detail,book.links.length,book.authors]),[['Dom Casmurro (Portuguese)','https://www.gutenberg.org/ebooks/55752.opds',0,[]],['Quincas Borba (Portuguese)','https://www.gutenberg.org/ebooks/54829.opds',0,[]]]);
  assert.deepEqual(result.navigation.map(link => link.name),['Populares']);
});
