# Fontes e atribuição

This product uses the TMDB API but is not endorsed or certified by TMDB.

TMDB é a fonte dos metadados e imagens obtidos através de sua API. O logotipo em `src/renderer/tmdb-logo.svg` é o asset oficial Primary short (blue), baixado de:

https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg

[Atribuição e logotipos](https://www.themoviedb.org/about/logos-attribution) · [FAQ da API](https://developer.themoviedb.org/docs/faq)

Avaliações IMDb são obtidas via [OMDb](https://www.omdbapi.com/), um provedor independente. Umbra não se apresenta como afiliado ao IMDb, OMDb ou TMDB.

React, Electron, SQLite, Vite, Lucide e as ferramentas de desenvolvimento mantêm suas próprias licenças, disponíveis em seus pacotes. No Linux, FFmpeg/ffprobe e mpv são ferramentas do sistema. No Windows, o pacote inclui a distribuição GPL do FFmpeg 9.0.2 da BtbN, com documentação e licenças em `resources/licenses/media`. A versão e SHA-256 estão fixados em `scripts/prepare-windows.mjs`; o arquivo original acompanha os assets da release. [Código correspondente FFmpeg](https://github.com/FFmpeg/FFmpeg/tree/46d8f462ee), [receitas, dependências e fontes da distribuição BtbN](https://github.com/BtbN/FFmpeg-Builds), [licenciamento FFmpeg](https://ffmpeg.org/legal.html). A licença MIT do código do Umbra não substitui as condições das ferramentas incluídas.

O motor mpv Windows usa a distribuição x86_64 baseline de shinchiro de 04/10/2026 (commit `413ff0b1cd`). Versão, origem e SHA-256 estão fixados em `scripts/prepare-mpv.mjs`; o arquivo original acompanha a release, com manual, proveniência e avisos em `resources/licenses/media/mpv`. [Fonte mpv correspondente](https://github.com/mpv-player/mpv/tree/413ff0b1cd), [licenças e componentes](https://github.com/mpv-player/mpv/blob/413ff0b1cd/Copyright), [receitas e dependências da distribuição](https://github.com/shinchiro/mpv-winbuild-cmake). A superfície `packaging/player-host` e o adaptador Umbra são código próprio; nenhum código do shell Stremio foi copiado. O processo mpv separado é controlado por seu protocolo JSON IPC documentado.

O catálogo online consulta [Cinemeta](https://v3-cinemeta.strem.io/manifest.json). Complementos usam o [protocolo aberto do Stremio](https://stremio.github.io/stremio-addon-sdk/protocol.html); Umbra não é afiliado ao Stremio. [Torrentio](https://github.com/TheBeastLT/torrentio-scraper) é um serviço externo e seu código não foi incorporado ao aplicativo.

Downloads torrent usam [libtorrent](https://www.libtorrent.org/), com licença BSD, através dos bindings Python. No Linux, o motor vem do sistema; o Windows inclui libtorrent 2.1.1 e Python 3.12 em um worker independente, com licença e metadados da distribuição. [Python: licença](https://docs.python.org/3/license.html). O empacotamento usa [PyInstaller 6.16.0](https://github.com/pyinstaller/pyinstaller/tree/v6.16.0), cuja exceção do bootloader permite distribuir o worker. Avisos ficam em `resources/licenses/media`.

As bandeiras dos idiomas são SVGs locais de [flag-icons](https://github.com/lipis/flag-icons), sob licença MIT. A licença original acompanha os arquivos em `src/renderer/flags/LICENSE`. Os SVGs são incorporados ao build e não consultam um serviço externo.
