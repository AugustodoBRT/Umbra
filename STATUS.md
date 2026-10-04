# Estado da entrega — 04/10/2026

## Preferência do usuário incorporada

Escolher a biblioteca **no app, pelo seletor nativo**, sem digitar caminho. Depois da primeira escolha, reabrir automaticamente o catálogo nas próximas inicializações, conforme a solicitação posterior do usuário. A opção de reabertura pode ser desativada. Chaves persistem no computador, inclusive no Hyprland sem cofre ativo; salvar chaves inicia a busca de metadados. Nenhum vídeo real do usuário foi escolhido pelo agente.

Solicitação posterior incorporada: excluir filmes/séries apaga os vídeos do SSD e retira o título do catálogo. Filmes concluídos pelo limite configurado ou marcados como assistidos ficam em Assistidos; séries guardam episódios vistos, notas e sessões. Exclusões confirmam arquivos/espaço e têm recuperação registrada. Sinopses e gêneros preferem português via TMDB, com nomes originais e cache online; a chave TMDB é configurada pelo próprio usuário. Somente vídeos sintéticos temporários foram apagados nos testes.

Solicitação posterior incorporada: catálogo online sem SSD e complementos do Stremio usados para **download**, com escolha de fonte por filme/temporada, revisão de episódios e criação das pastas. Sem reprodução de torrents via Stremio. Cinemeta e Torrentio básico são os complementos iniciais; links personalizados podem ser instalados pela interface.

## Identidade Umbra

Marca reformulada com símbolo de abertura de projetor de seis lâminas, sem letras, vetor transparente e variante para fundos claros. Exploração original via geração de imagem preservada em `assets/brand/umbra-logo-generated.png`. Paleta preto/ivório/verde luminoso, títulos editoriais, rótulos monoespaçados e fotograma na abertura. Prancha em `assets/brand/identity-preview.html` e PNG ao lado. Interface local e online verificadas no Electron; largura mínima de 960 px e larguras de 1180/1440 px conferidas com dados vazios em Chromium.

## Etapas

| Etapa do prompt | Estado |
| --- | --- |
| 1 — Núcleo Linux | Implementado e testado com mídia sintética real: projeto executável, seletor, SQLite/migrações, scanner, busca/grade, detalhes, player integrado HTML5/FFmpeg, retomada e nota/resenha persistentes |
| 2 — Catálogo Linux | Implementação inicial: TMDB/OMDb, identificação manual/automática, imagens offline, temporadas/episódios, listas, favoritos, resenhas e interface; provedores autenticados ainda precisam de validação com chaves reais |
| 3 — Robustez | Backup SQLite, exportação JSON, bloqueio, detecção/reconexão e testes críticos implementados; ainda requer testes em SSD exFAT real, falhas físicas e coleções grandes |
| 4 — Windows portátil | NSIS + portable x64 gerados, ferramentas incluídas e aplicativo empacotado aprovado no Windows pelo GitHub Actions |

## Verificação realizada

Versão publicada: [Umbra v0.1.2](https://github.com/AugustodoBRT/Umbra/releases/tag/v0.1.2), com instalador NSIS e executável portátil x64. Build de referência: [`59ae2de`](https://github.com/AugustodoBRT/Umbra/commit/59ae2dea6a7bd43d6e53b577b33221917be71908). [CI Linux e Windows aprovada](https://github.com/AugustodoBRT/Umbra/actions/runs/37243981575). Os SHA-256 dos dois executáveis publicados conferem com `SHA256SUMS.txt`.

O teste Windows abre o executável empacotado sem biblioteca anterior, confirma a versão, conecta uma coleção temporária com nomes Unicode e verifica MP4 direto, conversão MKV, dois áudios, legendas, pausa/busca, volume, velocidade, tela cheia, retomada e exclusão durante reprodução. As preferências de legenda são verificadas depois da gravação em disco. O worker torrent incluído passa a inspeção de disponibilidade e a publicação sem sobrescrita, inclusive com nomes acentuados e codificação de pipe Windows simulada como CP1252.

A mesma build Windows verifica o catálogo online, downloads HTTP locais de filme e temporada em uma raiz sem as pastas Filmes/Series, criação dos diretórios, importação automática e persistência de fila/lista/nota após reiniciar. Capturas do player e dos três downloads concluídos foram inspecionadas. O README mostra o Explorar com filmes reais do Cinemeta, sem baixar seus vídeos.

- `npm run build`: TypeScript e produção Electron/React aprovados.
- `npm test`: **48 testes aprovados**, com FFmpeg/ffprobe reais e um torrent sintético servido por libtorrent local.
- `npm run test:desktop`: aprovado no **Electron do Arch com player dentro da própria janela**. Seletor de pasta determinístico e HTTP dos provedores simulado na automação.
- Fluxos desktop verificados: iniciar sem biblioteca; confirmar pasta; importar; salvar nota 8,5/resenha/favorito/minha lista; reproduzir/pausar/buscar; salvar e retomar após fechar o aplicativo; reabrir automaticamente biblioteca e chaves; carregar metadados após salvar chaves; escolher outra raiz após movê-la; backup; busca/filtros; foco Ctrl+K; detectar perda da raiz e reconectar; iniciar sem SSD sem recriar catálogo; desativar reabertura mantendo chaves; cancelar a confirmação de exclusão; excluir durante reprodução preservando o progresso; excluir título não assistido sem histórico; reiniciar com histórico arquivado e avaliações preservados.
- Capturas `test-results/01-inicio.png` a `09-reabertura-automatica.png` inspecionadas visualmente. São artefatos de teste, com título sintético, e não a biblioteca do usuário.
- Provedores simulados nos testes: título/ano fortes, ambiguidade e candidatos sem ano, cache e atualização explícita, IMDb indisponível sem inventar zero, separação das notas TMDB/IMDb, preservação de edição local e dados pessoais. Credenciais verificadas entre instâncias, com permissões privadas, detecção de adulteração e migração do formato anterior.
- Testes de recuperação usam renomeação da raiz temporária; não houve desconexão física de SSD nem teste de queda de energia.
- Nenhuma chave de API real, filme do usuário ou informação demonstrativa foi incorporada no aplicativo.
- `npm run test:online`: catálogo sem SSD, instalação via interface, fontes HTTP reais locais, escolha da pasta, filme e temporada completa, revisão, nomes/pastas, importação automática, lista/nota online e fila persistentes aprovados no Electron real.
- Cartões de fonte com qualidade, tamanho, pessoas compartilhando e tabela de idiomas: áudio e legendas explícitos separados de idiomas anunciados. Bandeiras SVG locais verificadas na interface; descrição original convertida em texto legível. Testes cobrem idiomas ambíguos, dados ausentes e privacidade de links de legendas.
- Capturas online `10-catalogo-online.png` a `13-downloads-concluidos.png` revisadas. Manifests públicos Cinemeta/Torrentio e catálogo Cinemeta responderam com sucesso; nenhum vídeo de terceiros foi baixado.
- Fila com pausa/retomada HTTP e dados de retomada torrent; remoção de registros concluídos permite baixar novamente; proteção de arquivos existentes, rejeição de links na pasta e importação só dos arquivos completos. Python/libtorrent 2.1.2.0 já estavam instalados; nenhum pacote do sistema foi instalado.

- Traduções online verificadas por IMDb ID exato com resposta TMDB simulada em pt-BR, preservando nomes, fontes e notas. Cache reutilizado após nova busca, reinício e sem conexão; fallback do catálogo quando não há chave/tradução. Biblioteca local mantém título original, atualiza obras já identificadas explicitamente e protege sinopses editadas.
- Exclusão e recuperação verificadas com transação falhando, lote parcialmente movido, reconexão antes/depois do commit, arquivos modificados, symlinks e conflitos de restauração. Capturas `16-confirmar-exclusao.png`, `17-historico-preservado.png` e `18-assistidos.png`.

## Próximas prioridades

1. O usuário selecionar seu SSD no app e validar a biblioteca real: nomes, importação, performance, codecs/legendas, capa e reprodução. A primeira varredura faz SHA-256 completo por arquivo novo, podendo demorar numa coleção grande.
2. Configurar as chaves no próprio app e testar TMDB/OMDb reais, séries, episódios, quotas, imagens e fallback de tradução. Investigar associação de séries inferidas com ano e casos com homônimos.
3. Completar identificação/correção estrutural: juntar/separar obras inferidas erradas, mover episódios entre séries, tratar séries reassociadas a obras diferentes e revisar dados pessoais das temporadas existentes. Hoje corrigir o TMDB da série não remapeia automaticamente seus filhos antigos.
4. Adicionar remoção/edição de pastas autorizadas, seleção de capas personalizadas, escala/tema/idioma e painel de próximas sessões por episódio na home. Atualmente o idioma é pt-BR e o tema é escuro.
5. Implementar política configurável de expiração de notas/metadados e atualização seletiva. Identificação de pendências já usa cache de candidatos por 24 horas; não há atualização de toda a biblioteca na abertura.
6. Testar exFAT real, disco retirado durante gravação, migração/backup após crash, recuperação manual de bloqueio na interface e falhas de espaço. Bloqueios locais de processos encerrados agora são recuperados automaticamente, com testes de concorrência, reinicialização e PID reutilizado; o README explica recuperação manual de lock desconhecido.
7. Otimizar snapshots SQLite para bibliotecas grandes: queries agrupadas/paginação, virtualização de cartões e worker do scanner. Verificação integral opcional para conteúdo alterado sem mudança de tamanho/mtime.
8. Importação de avaliações exportadas, CSV, NFO, estatísticas, comparações, diagnóstico de duplicatas, recomendações explicáveis e melhor suporte a anime/ordens alternativas.
9. Validar HDR, passthrough multicanal, legendas bitmap e desempenho da conversão em bibliotecas reais. Player integrado, faixas, volume e retomada implementados; saída de conversão até 1080p.
10. Validar pacote Linux e testar SSD exFAT físico e mudança de letra no Windows. As builds Windows usam mídia sintética com Unicode e verificam os executáveis incluídos.

## Retomar o desenvolvimento

Leia `Prompt-CineSSD.md`, este arquivo, `README.md` e `ARCHITECTURE.md`. Repositório: https://github.com/AugustodoBRT/Umbra. Instalação e builds documentados no README.

```bash
npm run dev
```

Para a versão construída:

```bash
npm start
```

Para testes de janela, `scripts/desktop-test.ts` usa `/usr/bin/electron` ou `CINESSD_ELECTRON`, configura computador/biblioteca temporários em `/tmp`, gera mídia curta autorizada, encerra recursos e apaga apenas os diretórios temporários criados pelo próprio teste.
