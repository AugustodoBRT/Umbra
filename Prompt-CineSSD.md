# Prompt — CineSSD

Você é um engenheiro de software e designer de produto responsável por construir o CineSSD: um aplicativo desktop de código aberto, moderno e pessoal para organizar e assistir a filmes e séries armazenados em um SSD externo.

Primeiro implemente uma versão funcional para meu Arch Linux. Prepare a arquitetura para uma futura versão Windows x64 que rode diretamente de uma pasta no SSD, sem instalação nem privilégios de administrador. A versão Windows será uma etapa posterior e precisará de testes em Windows.

## 1. Contexto e experiência desejada

Tenho um SSD externo de 1 TB, atualmente em exFAT. Quero levar meus filmes, séries, capas, avaliações e histórico junto comigo. No Linux, o aplicativo pode ficar instalado no computador; no Windows, o aplicativo ficará no SSD. Não haverá computador servidor, serviço em nuvem ou máquina que precise permanecer ligada em outro lugar.

O app deve ter aparência de um serviço de streaming moderno, com identidade própria: navegação clara, capas em destaque, tipografia legível, boa hierarquia visual e animações discretas. Deve funcionar bem com mouse e teclado, em janela e tela cheia. Idioma inicial: português brasileiro.

A experiência principal é: conectar o SSD, abrir o app, escolher algo na biblioteca e assistir. Internet será usada para enriquecer os metadados; a biblioteca já carregada e a reprodução dos vídeos locais precisam funcionar offline.

## 2. Base técnica

Use Electron, React, TypeScript e SQLite. Use mpv para reprodução e ffprobe/FFmpeg quando necessário para inspecionar arquivos e gerar miniaturas.

No primeiro Linux, o app pode usar mpv e FFmpeg instalados no sistema. Verifique o ambiente existente antes de instalar dependências. Na futura distribuição Windows, inclua as versões Windows e suas dependências dentro da pasta do aplicativo.

Para a primeira versão, é aceitável abrir uma janela de reprodução do mpv controlada pelo app via JSON IPC. Isso precisa ser uma integração real: iniciar o vídeo, acompanhar posição e duração, retomar e receber eventos de fim/fechamento. Planeje o player integrado à janela como evolução; não trate uma janela externa como se o vídeo já estivesse embutido.

Organize o código por responsabilidades, por exemplo:

- renderer: telas, componentes, acessibilidade e estado visual;
- main/preload: acesso controlado ao sistema e ponte tipada com a interface;
- library: descoberta de SSDs/bibliotecas, varredura e identificação de arquivos;
- metadata: provedores TMDB/OMDb, associação de títulos e cache;
- playback: interface de reprodução e integração mpv;
- storage: SQLite, migrações e backups;
- shared: tipos e validação de contratos;
- packaging: configuração específica de cada plataforma.

Confirme os detalhes nas documentações atuais. Faça escolhas rotineiras de implementação e explique decisões que afetem a experiência ou a portabilidade.

## 3. Biblioteca no SSD e portabilidade

Estrutura sugerida, permitindo escolher pastas diferentes:

SSD/
  Filmes/
  Series/
  Biblioteca/
    biblioteca.json
    catalogo.sqlite
    capas/
    miniaturas/
    backups/
  Apps/
    Windows/
      CineSSD.exe
      demais arquivos do aplicativo

O manifesto biblioteca.json contém o identificador estável da biblioteca e sua versão de formato. O banco, imagens, notas pessoais e histórico devem acompanhar o SSD.

Guarde caminhos relativos à raiz da biblioteca, como Filmes/Interestelar (2014)/filme.mkv. Resolva o caminho absoluto somente em tempo de execução. Não fixe /run/media/usuario/SSD nem letras como E: no catálogo.

No Linux, permita selecionar o SSD na primeira execução e localizar novamente a biblioteca se o ponto de montagem mudar. Na versão Windows futura, encontre o manifesto a partir da localização do aplicativo, com seleção manual como alternativa.

Separe os dados compartilhados da biblioteca dos arquivos temporários específicos de cada sistema. Evite que o funcionamento dependa de links simbólicos ou permissões Unix no exFAT.

Implemente migrações versionadas, transações e bloqueio de acesso concorrente à mesma biblioteca. Feche recursos corretamente antes de desconectar o SSD. Se o disco sair durante o uso, interrompa operações com uma mensagem clara, preserve o catálogo e permita reconectar. Faça backup consistente do SQLite pela API apropriada.

## 4. Importação e identificação dos arquivos

- Adicionar e escanear pastas recursivamente, com progresso, cancelamento e resumo.
- Reconhecer vídeos comuns, ignorando legendas, extras, amostras e arquivos temporários quando apropriado.
- Inferir título, ano, série, temporada e episódio a partir dos nomes e das pastas.
- Entender formatos como S01E02 e 1x02, especiais na temporada 0 e arquivos com vários episódios.
- Separar título da obra de nome técnico do arquivo; reconhecer tags como resolução, codecs e grupo de release.
- Guardar tamanho, duração, resolução, codecs, faixas de áudio e legendas obtidos por inspeção real.
- Fazer varreduras incrementais ao abrir ou por ação manual. Não recalcular hashes de toda a coleção a cada inicialização.
- Detectar renomeações/movimentações com uma estratégia de identidade de arquivo; não unir arquivos apenas por nome ou tamanho.
- Representar vários arquivos/edições do mesmo filme e permitir escolher qual reproduzir.
- Marcar arquivos ausentes sem apagar avaliações, metadados e histórico.
- Permitir uma fila de itens que precisam de identificação manual.

Metadados de uma série podem listar episódios que ainda não estão no SSD. A interface deve distinguir disponível localmente de não disponível; somente arquivos presentes podem ser reproduzidos.

## 5. Metadados de filmes e séries

Use TMDB como fonte principal. Buscar:

- título em português, título original e ano;
- sinopse, gêneros, duração e classificação indicativa quando disponível;
- pôster, imagem de fundo, elenco e direção;
- identificadores TMDB e IMDb;
- séries, temporadas, episódios, datas e imagens de episódios;
- situação da série e coleções/franquias quando disponíveis.

Priorize pt-BR, com fallback para outro idioma quando não houver tradução. Associe um arquivo a um resultado usando título, ano e contexto, sem tratar o primeiro resultado de busca como confirmação automática.

Faça associação automática somente quando os critérios forem suficientemente fortes. Nos casos ambíguos, mostre candidatos com capa, título e ano. Permita pesquisar novamente, informar um identificador, desfazer uma associação, editar campos locais e escolher outra capa.

Preserve correções manuais em atualizações. Registre fonte, identificador e data de atualização dos dados externos. Baixe imagens para o SSD e use placeholders elegantes quando faltarem dados. Sem chave ou internet, mantenha disponíveis importação, edição manual, avaliações e reprodução.

## 6. Notas externas e avaliações pessoais

Obtenha a nota do IMDb e quantidade de votos via OMDb, consultando pelo IMDb ID da obra. OMDb é um serviço independente do IMDb e requer chave; respeite os limites e a disponibilidade do provedor.

O TMDB fornece IDs externos, mas sua vote_average é uma nota do TMDB. Exiba fontes distintas: IMDb, TMDB e Minha nota. Nunca apresente a nota do TMDB como nota IMDb.

Para filmes, séries e episódios, mostre a avaliação externa quando disponível, o número de votos e a data da consulta. Uma nota ausente deve ficar indisponível, nunca virar zero ou um número inventado. Não atribua a um episódio a nota geral da série. Se calcular média dos episódios de uma temporada, rotule como média calculada e informe a cobertura.

Minha avaliação:

- nota de 0,5 a 10, em incrementos de 0,5;
- criar, editar e remover nota;
- nota própria para filme, série, temporada e episódio;
- comentário/resenha privada, com opção de marcar spoilers;
- favorito, tags pessoais e listas;
- indicação de data da avaliação e histórico de sessões assistidas;
- não avaliado é um estado diferente de nota baixa.

As avaliações pessoais ficam no SSD, independentes das notas externas. Atualizar ou corrigir metadados não pode apagá-las. Corrigir a associação deve preservar os dados pessoais e permitir revisar a ligação com a nova obra. Uma nota no CineSSD não publica uma avaliação no IMDb ou TMDB.

## 7. Telas e navegação

Menu principal: Início, Filmes, Séries, Minha lista, Coleções, Importação e Configurações.

Início:

- continuar assistindo;
- adicionados recentemente;
- próximos episódios disponíveis de séries em andamento;
- favoritos e títulos ainda não assistidos;
- destaques baseados na própria biblioteca;
- botão Surpreenda-me com filtros opcionais.

Biblioteca:

- grade de pôsteres, busca por título original/local, elenco, gênero e tags;
- filtros por ano, gênero, disponibilidade, assistido, resolução, nota IMDb e minha nota;
- ordenação por título, ano, data de adição e avaliações;
- tamanho ajustável dos cartões e opção de lista;
- resultados e contagens coerentes com os filtros.

Detalhes de filme:

- pôster e imagem de fundo, sinopse, notas separadas e dados principais;
- Assistir/Continuar, avaliação pessoal, favorito e lista;
- versões locais disponíveis, áudio, legendas e qualidade;
- elenco, franquia, comentários e histórico;
- corrigir identificação, editar dados e abrir localização do arquivo.

Detalhes de série:

- informações gerais, nota da série e minha nota;
- seletor de temporada e lista de episódios;
- imagem, título, duração, disponibilidade e progresso por episódio;
- notas de episódio e avaliação pessoal;
- continuar a série e marcar episódios/temporadas como assistidos;
- ocultar sinopses e imagens de episódios ainda não vistos para evitar spoilers.

Coleções/listas: criar, renomear e excluir listas; adicionar/remover títulos; ordenar manualmente. Excluir uma lista não remove arquivos.

Configurações: biblioteca ativa, pastas, idioma, tema, escala, integração de reprodução, chaves dos provedores, frequência de atualização, cache, backup e diagnóstico.

Inclua estados vazios úteis, progresso de importação, erros recuperáveis, confirmação para ações destrutivas, foco de teclado visível e contraste adequado. Construa um pequeno sistema de componentes reutilizáveis para manter o visual consistente.

## 8. Reprodução e progresso

- Reproduzir arquivos presentes no SSD usando seus caminhos resolvidos.
- Retomar do ponto salvo ou começar do início.
- Atualizar progresso durante a reprodução e no encerramento.
- Salvar seleção de áudio/legenda quando possível, resolvendo faixas que mudem entre arquivos.
- Suportar legendas embutidas e externas comuns.
- Ter pausa, busca no tempo, volume, tela cheia e velocidade via integração de reprodução.
- Registrar sessões e conclusão com um critério documentado e ajustável.
- Distinguir progresso, marcação manual de assistido e nota pessoal.
- Em séries, sugerir o próximo episódio local na ordem correta.
- Tornar reprodução automática opcional e cancelável.
- Se o próximo episódio estiver ausente, mostrar isso sem pular silenciosamente para outro.

Os identificadores usados para progresso precisam continuar válidos após renomear arquivos, corrigir títulos ou mudar a letra do SSD.

## 9. Funcionalidades adicionais para evolução

Prepare a arquitetura, mas implemente depois do núcleo:

- estatísticas pessoais de sessões, tempo assistido, gêneros e avaliações;
- comparação entre Minha nota e IMDb;
- exportação/importação de avaliações e listas em JSON/CSV;
- leitura e exportação de metadados em arquivos NFO compatíveis, quando viável;
- escolha de pôster/fundo personalizados;
- painel de armazenamento, duplicatas prováveis e arquivos indisponíveis;
- recomendações locais explicáveis por gênero, favoritas e minhas notas;
- player integrado à janela;
- melhorias de identificação para anime e ordens alternativas de episódios.

Recomendações iniciais podem usar regras determinísticas; não dependam de assinatura de IA. Estatísticas devem distinguir tempo efetivamente reproduzido de duração total de títulos marcados manualmente como assistidos.

## 10. Dados, robustez e segurança

Modele entidades separadas para biblioteca, obras, séries/temporadas/episódios, arquivos/edições, metadados externos, avaliações pessoais, progresso, sessões, listas e associações. Separe a identidade de uma obra da identidade dos seus arquivos. Evite conflitos entre IDs numéricos de filme e série de um mesmo provedor.

Preserve os vídeos originais durante varredura e enriquecimento. Use consultas parametrizadas, validação de entrada e validação de caminhos. Restrinja operações sobre arquivos às pastas autorizadas.

No Electron, use contextIsolation, sandbox quando aplicável, nodeIntegration desativado e uma ponte IPC pequena, tipada e validada. O renderer não acessa diretamente o sistema nem recebe as chaves das APIs. Inicie mpv/FFmpeg com lista de argumentos, sem interpolação em comandos de shell.

Chaves de API são configuráveis. Use o mecanismo de credenciais do computador para os segredos, separado da biblioteca portátil; reconfigurar provedores em outro PC não pode impedir o uso offline. Não coloque chaves reais no repositório, logs ou backups exportados.

Faça chamadas de rede no processo principal, com limites de concorrência, cache, timeout, cancelamento e tratamento de indisponibilidade/quota. Atualizações de notas respeitam uma política de expiração e podem ser acionadas manualmente; abrir o app não deve consultar toda a biblioteca novamente.

Consulte e cumpra as condições dos provedores, incluindo atribuição do TMDB e avisos necessários em Sobre/Fontes. O aplicativo é inicialmente pessoal e não comercial.

## 11. Etapas de entrega

Etapa 1 — núcleo Linux: projeto executável, escolha do SSD, banco/migrações, varredura, busca, grade real, detalhes básicos, reprodução mpv, progresso e nota pessoal persistente.

Etapa 2 — catálogo Linux: TMDB, notas IMDb via OMDb, associação automática/manual, imagens offline, séries completas, listas, favoritos, resenhas e acabamento visual.

Etapa 3 — robustez: backups, reconexão do SSD, exportação, desempenho com bibliotecas grandes e testes das operações críticas.

Etapa 4 — Windows portátil: empacotamento completo em pasta/ZIP, executável e dependências incluídos, descoberta da biblioteca, resolução de caminhos e testes reais em Windows com mudança da letra do SSD. Mantenha o mesmo formato de catálogo do Linux e declare as versões suportadas.

Implemente de forma incremental, com cada etapa utilizável. Antes de editar, examine o projeto existente e instruções locais. Apresente um plano curto e siga para implementar as etapas Linux, com validação e documentação. Se o trabalho exigir mais de uma sessão, deixe o estado e as pendências documentados.

## 12. Critérios de aceitação e entregáveis

- Executar o app no meu Arch seguindo instruções reproduzíveis.
- Importar arquivos reais e reproduzi-los; demonstrar dados reais da minha biblioteca, com fixtures apenas nos testes.
- Persistir nota, resenha e progresso após reiniciar.
- Identificar filmes/séries e resolver ambiguidades manualmente.
- Exibir nota IMDb com fonte correta e tratar ausência de avaliação.
- Usar o catálogo e reproduzir vídeos offline após a obtenção dos metadados.
- Preservar dados pessoais quando metadados forem atualizados.
- Tratar mudanças de caminho e disco indisponível sem apagar o catálogo.
- Validar scanner, associações, transações, migrações e integração de reprodução com testes adequados; usar mídia curta de teste autorizada.
- Ter interface utilizável por teclado e visualmente verificada no Linux.
- Documentar arquitetura, comandos, configuração dos provedores, formato da biblioteca, backup e plano Windows.
- Ao finalizar cada etapa, informar o que funciona, os testes realizados e limitações reais. Não declarar a versão Windows validada antes de testá-la nesse sistema.

O resultado deve ser um aplicativo funcional com uma biblioteca visual moderna, metadados corretos e avaliações pessoais que acompanham meu SSD.

## Documentação inicial

- Electron: https://www.electronjs.org/docs/latest/
- Empacotamento Windows: https://www.electron.build/docs/win/
- mpv: https://mpv.io/manual/stable/
- TMDB: https://developer.themoviedb.org/docs/getting-started
- TMDB — IDs de filmes: https://developer.themoviedb.org/reference/movie-external-ids
- TMDB — IDs de séries: https://developer.themoviedb.org/reference/tv-series-external-ids
- TMDB — IDs de episódios: https://developer.themoviedb.org/reference/tv-episode-external-ids
- OMDb: https://www.omdbapi.com/
- Chave OMDb: https://www.omdbapi.com/apikey.aspx
