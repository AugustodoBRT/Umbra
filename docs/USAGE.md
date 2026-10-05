# Guia do Umbra

## Primeiro uso: escolha pelo próprio app

1. Monte o SSD pelo gerenciador de arquivos do sistema.
2. Abra o Umbra em **Explorar**. Para seus arquivos locais, abra **Início → Conectar minha biblioteca**, se ainda não houver uma biblioteca conectada.
3. No seletor de pastas, escolha a raiz do SSD, ou uma pasta que contenha toda a sua coleção. Confirme em **Carregar minha biblioteca**.
4. A primeira escolha autoriza a varredura recursiva da pasta selecionada. Veja progresso, cancelamento e avisos em **Importação**. Não é preciso digitar caminhos.
5. Abra um título e escolha **Assistir**. O vídeo abre dentro do Umbra, com controles de áudio, legendas, volume e retomada.

Depois da primeira escolha, o aplicativo **reabre a última biblioteca automaticamente**, preservando notas, listas e progresso. A opção **Reabrir minha biblioteca ao iniciar**, em Configurações, permite voltar à escolha manual. Se o SSD estiver ausente ou o manifesto tiver outra identidade, o app oferece reconexão sem criar outro catálogo no caminho lembrado. A varredura ao conectar também pode ser desativada; para novas bibliotecas ela vem ativada.

O seletor pode receber `SSD/Biblioteca`, caso já exista o catálogo nessa estrutura. Prefira escolher a raiz do SSD desde o início: todos os vídeos devem estar abaixo dela. Vídeos fora dessa raiz exigem outra biblioteca, pois os caminhos no catálogo são relativos. A varredura ignora `Biblioteca`, `Apps`, arquivos ocultos, links simbólicos, amostras e extras comuns. O scanner não altera nem move vídeos.

Use **Desconectar com segurança** no app antes de ejetar o disco pelo sistema. O botão encerra o player, cancela operações e fecha o banco; a ejeção do dispositivo continua sendo feita pelo sistema.

## Catálogo online, complementos e downloads

**Explorar** mostra filmes e séries do Cinemeta sem exigir SSD, arquivos locais ou chave TMDB. Há busca, seleção de catálogo, gênero e paginação. Cinemeta e Torrentio básico vêm habilitados na primeira configuração de complementos; você pode desativá-los ou removê-los.

Em **Complementos**, cole um link HTTP(S) ou `stremio://` que termine em `/manifest.json`. O Umbra usa o protocolo de catálogo, metadados e fontes do Stremio, sem executar código remoto. Para personalizar Torrentio, use **Configurar Torrentio**, ajuste no navegador, copie o link de instalação com **Copy Link** e cole no app; a nova configuração substitui a anterior desse complemento. O app não precisa do Stremio instalado nem vincula sua conta do Stremio.

Os cartões de fonte separam qualidade, tamanho e pessoas compartilhando, com uma tabela de áudio, legendas e idiomas. Bandeiras são imagens locais, sem depender de emojis do sistema. Áudio e legendas só recebem idiomas quando o complemento os distingue explicitamente; bandeiras e idiomas no nome da versão aparecem como **Idiomas anunciados**. As legendas vinculadas pelo complemento são identificadas como oferecidas separadamente, sem afirmar que estão dentro do vídeo ou que serão baixadas com ele. As faixas efetivas são identificadas pelo ffprobe após o download. **Informações originais** permite consultar a descrição do complemento em texto legível.

1. Abra um filme em **Explorar**, escolha uma fonte e clique em **Baixar filme**.
2. Para séries, escolha a temporada e um episódio de referência para consultar as fontes. Clique em **Usar para a temporada** na fonte desejada.
3. O app consulta todos os episódios daquela temporada no complemento escolhido. A revisão seleciona opções com o mesmo nome de qualidade, provedor e grupo de lançamento, quando informados. Episódios sem correspondência ficam sem seleção: escolha uma alternativa na lista ou baixe só os encontrados. O app não assume que a temporada está completa quando faltam fontes.
4. Na primeira vez, escolha pelo seletor uma pasta de destino, ou use a biblioteca conectada. **Downloads → Escolher pasta** muda o destino e conecta sua biblioteca; downloads antigos mantêm seu destino e são pausados se a biblioteca anterior for desconectada.
5. A fila baixa um arquivo por vez. Veja progresso, tamanho, velocidade e pares; pause, retome, cancele ou abra a pasta de um arquivo concluído. Fechar o app pausa a fila; após reabrir, clique em **Retomar**. Cancelar preserva os arquivos temporários já recebidos.

```text
Destino/
  Filmes/Nome do filme (2026)/Nome do filme (2026).mkv
  Series/Nome da série (2022)/Temporada 04/Nome da série (2022) - S04E01.mkv
  Biblioteca/...
```

Pastas e nomes são criados automaticamente; arquivos existentes são preservados. Vídeos incompletos ficam ocultos em temporários e só aparecem na biblioteca após concluir a gravação; o scanner importa os arquivos concluídos automaticamente. A identidade do manifesto é verificada antes de gravar e durante downloads ativos, para pausar quando o SSD fica indisponível.

No Linux, torrents usam **Python + libtorrent** do sistema. Os executáveis Windows incluem um motor independente; nenhum outro cliente torrent é necessário. O download escolhe o `fileIdx` indicado pelo complemento; sem índice, um pacote de série precisa ter um arquivo que identifique unicamente o episódio. Só o arquivo escolhido recebe prioridade. Torrents são interrompidos ao concluir, sem continuar semeando depois. Fontes HTTP(S) usam retomada por Range quando suportada. YouTube, páginas externas, transmissões HLS/DASH e arquivos compactados não são implementados. O suporte testado a info hashes é BitTorrent v1.

Links configurados, URLs privadas de download e dados de retomada ficam criptografados no computador, com a mesma política das credenciais dos provedores. Eles não entram no SSD nem no renderer. A fila e a lista/avaliações de títulos online ficam neste computador; avaliações locais continuam no catálogo do SSD. **Minha lista online** reúne títulos guardados/avaliados mesmo sem SSD.

## O que já funciona

- Escolha de pasta nativa, manifesto estável, SQLite com quatro migrações, transações e bloqueio exclusivo da biblioteca.
- Importação real recursiva, progresso, cancelamento, arquivos ausentes, duração/resolução/codecs/faixas com ffprobe e miniaturas com FFmpeg.
- Filmes e séries inferidos dos nomes, episódios `S01E02`, `1x02`, especiais e arquivos com vários episódios. Várias versões de um filme ficam disponíveis nos detalhes.
- Grade e lista, busca por título original/local, elenco, gênero e tags; filtros de ano, gênero, disponibilidade, assistido, resolução e notas; ordenação e tamanho dos cartões.
- Início com destaques reais, recentes, favoritos e continuar assistindo; sugestão aleatória entre títulos locais ainda não assistidos.
- Player mpv dentro do aplicativo: pausa, busca exata, volume, velocidade, tela cheia, faixas de áudio/legenda, retomada e conclusão. Legendas de texto, ASS e em imagem são renderizadas pelo motor sem converter o vídeo; sincronização ajustável por arquivo.
- Notas pessoais de 0,5 a 10, remover nota, resenhas privadas e marcação de spoilers, favoritos, tags, minha lista, coleções com ordenação manual e histórico de sessões. Obras, temporadas e episódios têm avaliações independentes.
- Exclusão de filmes/séries com confirmação dos vídeos e do espaço a liberar. Assistidos permanecem no histórico; títulos não concluídos desaparecem do catálogo.
- Pesquisa TMDB por título ou `tmdb:ID`, escolha manual de candidatos, associação automática conservadora, desfazer associação e edição local protegida. Capas e fundos são baixados para o SSD.
- Notas TMDB e IMDb separadas, com votos e data. IMDb vem do OMDb pelo IMDb ID; ausência é `null`, exibida como indisponível. Episódios usam seus próprios identificadores.
- Temporadas listadas após identificar séries; as temporadas com arquivos locais recebem seus metadados automaticamente. **Buscar episódios no TMDB** permite consultar outras temporadas, incluindo episódios sem arquivo local. Esses episódios não podem ser reproduzidos. Proteção de spoilers está ativada por padrão.
- Backup consistente pela API de SQLite, exportação JSON de avaliações/listas/sessões, mudança do ponto de montagem, monitoramento e reconexão depois de uma indisponibilidade.

Não há títulos demonstrativos no aplicativo. Os arquivos usados nos testes são gerados pelo FFmpeg apenas em diretórios temporários.

## Excluir vídeos e consultar assistidos

Nos detalhes do filme ou da série, use **Excluir filme / Excluir série**. A confirmação lista os vídeos que serão apagados permanentemente do SSD. O título também sai da biblioteca, da minha lista e das coleções. Somente vídeos catalogados são apagados; legendas, capas e outros arquivos da pasta são preservados.

**Assistidos** guarda os filmes concluídos pela porcentagem definida em Configurações ou marcados manualmente como assistidos. Basta concluir uma versão do filme. Séries parcialmente vistas guardam os episódios assistidos, suas avaliações e sessões; os episódios não vistos saem do catálogo ao excluir a série. O histórico fica no catálogo do SSD e continua disponível ao reconectar ou reiniciar. Notas/resenhas, imagens e sinopses dos assistidos são preservadas. Títulos ainda não concluídos são removidos sem criar registro no histórico.

Se o título estiver em reprodução, o app salva a posição atual antes da confirmação e encerra o player antes de apagar os vídeos. Downloads pendentes do mesmo título precisam ser cancelados na tela Downloads. Registros de downloads concluídos dos vídeos excluídos saem da fila, permitindo baixar o título novamente; avaliações/lista online são independentes.

Exclusões usam um registro de recuperação e arquivos temporários em `Biblioteca/.exclusoes`. Ao reconectar, operações interrompidas antes de atualizar o catálogo restauram os vídeos; operações confirmadas terminam a limpeza. Não remova essa pasta manualmente durante uma recuperação. Se surgir outro vídeo no caminho original, a recuperação preserva ambos e recusa sobrescrever. Interrupção durante a cópia de restauração pode exigir recuperação manual da cópia preservada. Queda de energia e exFAT físico ainda não foram validados.

## TMDB e OMDb

Em **Configurações → Configurar provedores**, informe a chave API v3 ou o token de leitura do TMDB, e a chave OMDb. Campos vazios preservam as chaves já salvas; use os botões de remoção para desativar um provedor. Salvar as chaves inicia a busca de metadados da biblioteca conectada, sem reiniciar o aplicativo. A biblioteca continua útil sem chaves ou internet.

Sinopses e gêneros usam o idioma `pt-BR` do [TMDB](https://developer.themoviedb.org/docs/languages), mantendo o título original e as edições locais. No catálogo online, abrir um título com IMDb ID busca os detalhes em português usando a mesma chave TMDB, sem trocar nome, fonte de download ou avaliações do catálogo. Traduções ficam salvas neste computador, são reutilizadas sem conexão e consultadas novamente após sete dias. Se não houver tradução ou o provedor falhar, o texto disponível é preservado. Para renovar os detalhes de títulos locais já identificados, use **Atualizar informações da biblioteca** em Configurações; sinopses editadas manualmente continuam protegidas.

Obtenha as credenciais no [TMDB](https://developer.themoviedb.org/docs/getting-started) e no [OMDb](https://www.omdbapi.com/apikey.aspx). Não coloque credenciais no código. Chamadas saem do processo principal, por HTTPS, com timeout e limite de concorrência; o renderer não recebe as chaves. O app prefere o cofre do sistema via `safeStorage`. Quando o Linux só oferece `basic_text`, usa armazenamento local com AES-256-GCM, diretório privado (0700) e arquivos (0600). A chave de criptografia também fica no computador: essa alternativa protege pelo acesso aos arquivos, mas não contra processos executados pela mesma conta. Chaves nunca entram no SSD nem nas exportações. Levar o SSD a outro computador exige configurar os provedores novamente, sem afetar a reprodução offline.

Associação automática exige correspondência exata do título normalizado, ano exato e um único candidato forte. Um resultado sem ano ou com homônimos vai para revisão: abra o título e clique em **Revisar identificação** para confirmar um dos candidatos encontrados. Isso se aplica, por exemplo, a arquivos `From.S04E01...` sem ano no nome. A associação de uma série não copia sua nota para episódios. Notas OMDb indisponíveis não são substituídas por notas TMDB.

Dados e imagens baixados são cache persistente. Ao conectar ou terminar uma importação, o app busca títulos pendentes e notas IMDb ainda ausentes, sem atualizar toda a biblioteca já identificada. Candidatos de identificação ficam em cache por 24 horas; salvar chaves ou solicitar identificação automática força uma nova consulta. A política configurável de expiração dos demais metadados ainda está pendente. Correções de título, ano e sinopse são guardadas como overrides; reidentificar a obra não remove notas, resenhas, listas ou progresso.

O logotipo oficial e o aviso exigido aparecem na seção Sobre/Fontes das configurações. Este aplicativo é pessoal e não comercial. Consulte as [condições e atribuição do TMDB](https://developer.themoviedb.org/docs/faq) e as [condições do OMDb](https://www.omdbapi.com/). O uso desses dados não publica suas avaliações nos provedores.

## Formato portátil e recuperação

```text
SSD/
  Filmes/
  Series/
  Biblioteca/
    biblioteca.json           # formato 1, UUID, nome, data
    catalogo.sqlite           # schema PRAGMA user_version = 4
    capas/
    miniaturas/
    backups/
    .catalogo.lock/owner.json  # temporário enquanto aberta
```

`files.path` e pastas autorizadas são relativos à raiz escolhida (`.` significa toda a raiz). O ponto de montagem não é escrito nas tabelas de vídeos. Identidade de obra, arquivo e sessão são distintas. Depois de uma movimentação, somente um SHA-256 completo e uma correspondência única com caminho anterior ausente podem transferir o ID. Cópias ainda presentes não são unidas. Substituir o conteúdo de um arquivo cria outra identidade, mantém a versão antiga ausente e preserva o histórico original.

O scanner evita recalcular hash de arquivos com tamanho e data de modificação inalterados. A primeira importação lê o conteúdo completo de cada vídeo; em SSDs grandes, pode demorar. Uma mudança de conteúdo que mantenha deliberadamente tamanho **e** timestamp não é detectada pelo atalho incremental. Uma verificação completa opcional está planejada.

SQLite usa journal `DELETE` e `synchronous=FULL`, evitando deixar WAL/shm portátil aberto. O bloqueio é um diretório criado atomicamente, compatível com exFAT. Ao desconectar normalmente, ele é removido. Na reconexão, bloqueios deste computador são recuperados quando o processo dono já terminou, ou quando a mesma sessão encerrou a biblioteca após perder o disco. No Linux, novos bloqueios também registram o boot e o início do processo, permitindo recuperação após reiniciar ou reutilizar um PID. Recuperações simultâneas são protegidas por uma reivindicação exclusiva dentro do diretório de bloqueio. Bloqueios ativos, de outro computador, sem dono válido ou com uma recuperação interrompida não são removidos automaticamente.

Se o app ou o computador caiu, tente conectar novamente: um bloqueio local comprovadamente antigo é recuperado automaticamente. Se ainda houver bloqueio desconhecido (inclusive uma recuperação interrompida):

1. Feche todas as instâncias do Umbra em qualquer computador usando essa biblioteca.
2. Confira `Biblioteca/.catalogo.lock/owner.json` (host e PID) e confirme que o dono não está usando o disco.
3. Remova **somente** o diretório `.catalogo.lock` pelo gerenciador de arquivos.
4. Selecione a biblioteca novamente no app. SQLite recupera o journal quando necessário.

Não exclua `catalogo.sqlite` nem journals de uma transação interrompida. Para restaurar backup: feche o app, guarde uma cópia do catálogo atual e substitua `catalogo.sqlite` pelo backup escolhido. O backup é do banco; para uma cópia completa, copie também o manifesto, capas, miniaturas e os vídeos com a biblioteca fechada. Exporte JSON para guardar avaliações separadamente; a restauração desse JSON pela interface é uma evolução pendente.


## Limitações do player

O motor mpv decodifica o arquivo original dentro da janela do Umbra, usando GPU quando o codec e o driver permitem e CPU quando necessário. A reprodução não recodifica para H.264/AAC nem impõe redução para 1080p ou estéreo. Legendas ASS preservam seus estilos e fontes incorporadas; legendas em imagem são renderizadas pelo motor. HDR em tela física, passthrough e desempenho de filmes 4K longos ainda precisam de testes em equipamentos reais. Não há autoplay do próximo episódio. No Linux, a superfície nativa usa X11/XWayland.

## Tela cheia

Clique no botão de tela cheia, dê dois cliques no vídeo ou pressione F11. Cabeçalho e controles somem após 2,5 segundos sem interação, inclusive com o vídeo pausado; o vídeo então ocupa toda a tela, preservando a proporção original. Quando visíveis, os controles têm uma área própria para continuar acessíveis ao lado da superfície nativa. Mova o mouse ou use Tab para revelá-los. Esc sai da tela cheia; minimizar também devolve a janela à biblioteca. A rolagem da biblioteca permanece disponível no modo minimizado.

Use **Ajustar legenda**, ao lado da escolha de faixa, para alterar tamanho, cor, fundo, contorno e altura. As preferências ficam salvas neste computador para as próximas sessões. **Sincronização** aceita ajustes positivos para atrasar a legenda e negativos para adiantá-la; o ajuste fica salvo para esse vídeo. Enquanto esse painel estiver aberto, os controles ficam visíveis para permitir a edição; feche-o para voltar ao desaparecimento automático. **Restaurar padrão** recupera a aparência inicial. Esses ajustes de aparência funcionam com legendas de texto simples; ASS preserva seus estilos e legendas em imagem mantêm a aparência original.
