# Arquitetura do Umbra

## Responsabilidades

| Diretório | Responsabilidade |
| --- | --- |
| `src/renderer` | React, navegação, busca/filtros, componentes, detalhes, teclado e estado visual |
| `src/main` | Ciclo de vida Electron, seleção nativa, credenciais, protocolo e IPC |
| `src/shared` | Contratos TypeScript e validações Zod |
| `src/library` | Validação de caminhos, inferência, varredura, SHA-256, ffprobe, miniaturas |
| `src/storage` | SQLite, migrações, lock, transações, pessoal, sessões, listas, backup e configuração/credenciais do computador |
| `src/metadata` | TMDB/OMDb, candidatos, associação conservadora e imagens offline |
| `src/online` | Protocolo Stremio, complementos, catálogos e revisão de fontes por temporada |
| `src/downloads` | Fila persistente, transferência HTTP e worker Python/libtorrent |
| `src/playback` | Player integrado, protocolo de mídia, conversão e progresso |
| `scripts` | Build, desenvolvimento, seleção do runtime e teste desktop |

## Limites de confiança

Renderer tem `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP restritiva, navegação e novas janelas bloqueadas. Preload expõe métodos específicos, sem expor `ipcRenderer`, comandos arbitrários, caminhos de reprodução escolhidos pelo renderer ou segredos. O main verifica emissor/frame/origem de IPC e valida UUIDs, notas, textos, candidatos e controles.

Vídeos são resolvidos de IDs do catálogo para caminhos relativos, depois verificados com `realpath` dentro da raiz autorizada. Arquivos atravessando a raiz e symlinks externos são recusados. Protocolo `cinessd://app` serve somente o build; `cinessd://asset` serve apenas imagens das pastas de cache. Operações de mídia usam `spawn` com argumentos separados, sem shell.

Cada biblioteca tem um UUID no manifesto; obras têm UUIDs locais independentes do TMDB. Temporadas/episódios são obras com parentesco. `file_works` permite várias edições por obra e vários episódios por arquivo. Metadados e proveniência são separados dos dados pessoais; as correções locais sobrescrevem dados externos na leitura. Progresso e sessões usam ID do arquivo, que pode ser preservado após renomeação comprovada. Coleções contêm IDs de obras.

## Consistência e desconexão

Bloqueio por criação atômica de diretório, mantido durante toda a conexão. Não há dependência de symlink/permissões Unix no SSD. Migrações 1–4 usam `user_version`, `BEGIN IMMEDIATE`, rollback e rejeitam versões futuras. Migração 3 reconstrói a tabela de arquivos para separar conteúdo substituído no mesmo caminho, preservando referências. Migração 4 adiciona `watched_history` e o registro de exclusões `file_removals`; bibliotecas antigas recebem histórico usando suas conclusões e marcações manuais existentes.

Não se marcam arquivos como ausentes se a descoberta daquela pasta falhou. Cancelar uma varredura mantém importações já concluídas e não aplica a etapa final de ausências. Falhas de inspeção são recuperáveis e ficam no resumo. Uma verificação do manifesto e do token de lock a cada 2 segundos detecta perda/troca da raiz. Operações assíncronas verificam o disco antes de aplicar resultados; desconectar cancela scanner/rede, aguarda operações, encerra o player e fecha o banco. O banco não é recriado num ponto de montagem vazio.

Backup usa `node:sqlite.backup`, com uma operação por vez e espera antes de fechar. Exportação não inclui chaves e inclui histórico arquivado. Imagens novas são gravadas em temporário e renomeadas. Vídeos são apagados somente no fluxo explícito de exclusão do título.

`library/removal.ts` valida fontes autorizadas, arquivos regulares, tamanho/mtime e ausência de symlinks; recusa vídeos associados a outro título. Scanner/provedores são cancelados e aguardados, a reprodução do título salva o progresso e encerra antes da exclusão. Novos downloads ficam suspensos durante a operação; downloads pendentes do título impedem excluir. Um registro `preparing` precede a movimentação dos vídeos para `Biblioteca/.exclusoes/<UUID>`. Em uma transação, assistidos são arquivados como JSON independente das tabelas de vídeos, referências locais são removidas e o registro passa a `committed`. Depois, os vídeos temporários são apagados. Ao abrir, operações `preparing` restauram via cópia exclusiva sem sobrescrever; operações `committed` terminam a limpeza. Falha de limpeza mantém o registro e avisa o usuário. Não há exclusão recursiva de pastas do usuário.

A configuração do computador lembra caminho, UUID e nome da última biblioteca e a opção de reabertura. Antes de abrir automaticamente, valida o manifesto existente; um SSD ausente ou trocado não provoca criação de diretórios. A configuração antiga contendo apenas `lastRoot` continua compatível.

Credenciais preferem o cofre do sistema via Electron `safeStorage`, recusando `basic_text`. Sem cofre, ficam em AES-256-GCM com chave aleatória local, diretório 0700 e arquivos 0600. Essa alternativa não protege contra a própria conta. Escritas usam arquivo temporário, fsync e rename; arquivos antigos do cofre são migrados, e falhas de leitura preservam os arquivos originais. Nenhum segredo entra em snapshots, exportações ou no SSD.

Salvar chaves agenda enriquecimento automático depois da varredura; conectar e terminar importação também consultam pendências. A tarefa publica progresso, erros e candidatos para revisão. Só título e ano exatos com candidato forte único autorizam associação automática. Candidatos ficam em cache SQLite por 24 horas; uma busca explícita força consulta. Confirmar série carrega temporadas com arquivos locais, mantendo notas pessoais independentes.

## Catálogo online e downloads

`online.sqlite` fica no computador, separado do catálogo portátil. Guarda metadados visitados e avaliações/lista online; não contém URLs das fontes. Configuração de complementos, fila e dados de retomada ficam em documentos criptografados de `Credentials`, sem expor endereços privados no renderer. Os manifests são validados e apenas dados JSON são consumidos, sem executar JavaScript do complemento. Recursos são filtrados por tipo e prefixo de ID, preservando a configuração na URL-base. Imagens passam pelo protocolo restrito `cinessd://online-image`, com limite de tamanho e MIME.

Detalhes online consultam TMDB por IMDb ID exato com `language=pt-BR`, usando a credencial já configurada. Sinopse e gêneros ficam em `online.sqlite.translations`, separados dos metadados do complemento para evitar que novas buscas sobrescrevam a tradução. Cache por sete dias, com preservação do texto salvo em falhas. Nomes, IDs, fontes e notas do complemento permanecem associados ao mesmo título. Obras locais associadas usam o título original e descrições pt-BR, com fallback de sinopse em inglês; atualização explícita de metadados também renova obras já identificadas.

Fontes recebem IDs opacos vinculados ao título/episódio no main. Uma revisão de temporada consulta episódios em grupos de três e combina complemento/nome/provedor/grupo; alternativas sem correspondência exigem seleção explícita. A fila trabalha com um arquivo por vez e persiste estados. Transferências HTTP usam temporários privados e validam Range ao retomar. Um worker Python utiliza libtorrent do sistema, recebe comandos JSON por stdin, mantém prioridades zeradas até validar metadados e baixa somente o arquivo selecionado. Dados de retomada são salvos periodicamente e ao pausar.

`shared/sourceDetails.ts` interpreta detalhes anunciados pelo complemento sem consultar o vídeo nem acessar links de legendas. Qualidade e idiomas em nomes/bandeiras são indícios; apenas linhas explicitamente rotuladas separam áudio de legendas. Idiomas do campo Stremio `subtitles` são exibidos como legendas oferecidas separadamente, e seus URLs não entram nos detalhes enviados ao renderer. `SourceCard` usa SVGs locais para as bandeiras e mantém detalhes desconhecidos como não informados.

Downloads verificam identidade do manifesto e confinamento da pasta. Diretórios intermediários com links são rejeitados; nomes são sanitizados para portabilidade. Publicação usa `renameat2(RENAME_NOREPLACE)` no Linux, inclusive em exFAT, evitando substituir vídeos existentes. Temporários incompletos são ocultos; o scanner importa após publicação. Ao fechar ou desconectar uma biblioteca, downloads ativos são pausados; ao reabrir, o usuário os retoma. Sem índice de arquivo, pacotes de série exigem correspondência única de temporada/episódio. Torrents BitTorrent v2 ainda não foram validados.

## Reprodução local

O renderer usa um elemento HTML5 video, com MP4 H.264/AAC direto e suporte a Range pelo protocolo cinessd://media. O main resolve somente IDs do catálogo, limita o acesso à sessão ativa por um token aleatório e verifica a identidade da biblioteca. MKV e codecs incompatíveis passam por FFmpeg para H.264/AAC fMP4 via pipe e MediaSource. A saída é limitada a 1080p, com buffer de leitura de aproximadamente 20 segundos e remoção de segmentos já reproduzidos. Não se grava uma cópia convertida no disco.

Seek e troca de faixa criam uma nova fonte com offset lógico; relatórios de tokens anteriores são ignorados. Legendas de texto passam a WebVTT e ajustam timestamps ao offset. Legendas bitmap são incorporadas ao vídeo durante a conversão. Processos FFmpeg são encerrados e aguardados antes de desconectar ou excluir vídeos, liberando handles do Windows. Volume, velocidade e pausa são aplicados no elemento video; tela cheia permanece na mesma BrowserWindow. Progresso é salvo a cada três segundos e ao encerrar. A conclusão padrão é 90%, ajustável nas configurações.

Tempo efetivamente reproduzido soma avanços plausíveis entre amostras de 500 ms, limitado pelo tempo monotônico e corrigido pela velocidade. Saltos de seek não viram horas assistidas; é uma aproximação, não telemetria por frame. Faixas preferidas são salvas por idioma/título, evitando depender apenas do número da faixa. A próxima seleção de episódio considera temporada/número; se o próximo catalogado estiver ausente, o botão principal não pula silenciosamente para outro. Autoplay não foi implementado.

## Empacotamento e desempenho

O Windows x64 usa NSIS por usuário e um executável portable via electron-builder. Electron, FFmpeg/ffprobe e um worker Python/libtorrent construído com PyInstaller acompanham o pacote em resources/bin. Downloads do FFmpeg têm versão fixa e SHA-256 verificado. CI executa o app empacotado no Windows com coleção Unicode, seleção nativa simulada, duas faixas de áudio, legendas e exclusão durante conversão. O manifesto e SQLite são os mesmos do Linux. O executável pode ficar no computador e a biblioteca em qualquer pasta autorizada; nenhum caminho do desenvolvedor é necessário.

Atualmente o main gerencia SQLite e escaneia um arquivo de cada vez, mantendo inspeção/hash em operações assíncronas. O snapshot monta agregados por obra com consultas adicionais: para catálogos muito grandes, evoluir para queries agrupadas/paginadas e um worker de scanner/armazenamento. Validar ganho com uma biblioteca real grande antes de aumentar concorrência e consumo de I/O do SSD.

## Documentação consultada

- [Electron: segurança](https://www.electronjs.org/docs/latest/tutorial/security) e [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
- [Node: SQLite, transações e backup](https://nodejs.org/api/sqlite.html).
- [Electron: protocolo de mídia](https://www.electronjs.org/docs/latest/api/protocol) e [FFmpeg: fragmented MP4](https://ffmpeg.org/ffmpeg-formats.html).
- [Vite: guia](https://vite.dev/guide/).
- [TMDB: início](https://developer.themoviedb.org/docs/getting-started), [busca de filmes](https://developer.themoviedb.org/reference/search-movie), [temporadas](https://developer.themoviedb.org/reference/tv-season-details), [atribuição](https://developer.themoviedb.org/docs/faq).
- [OMDb: parâmetros e avaliações](https://www.omdbapi.com/).
- [Stremio: protocolo](https://stremio.github.io/stremio-addon-sdk/protocol.html), [manifests](https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html) e [streams](https://stremio.github.io/stremio-addon-sdk/api/responses/stream.html).
- [Torrentio: código](https://github.com/TheBeastLT/torrentio-scraper) e [configuração](https://torrentio.strem.fun/configure).
- [libtorrent: bindings Python](https://www.libtorrent.org/python_binding.html) e [torrent_handle](https://www.libtorrent.org/reference-Torrent_Handle.html).

Consultadas em 04/10/2026. O runtime `node:sqlite` foi verificado no Electron instalado no Arch; outras distribuições de Electron precisam manter esse suporte.
