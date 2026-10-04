# Umbra — identidade visual

## Ideia

Um cinema só seu. A escuridão como espaço para as histórias, com um corte de luz como assinatura. O símbolo é um U de película com cantos internos curvos e uma fenda diagonal transparente. A forma continua reconhecível em uma só cor e em tamanhos pequenos.

- `umbra-logo.svg`: assinatura horizontal, com símbolo e nome. O nome usa a mesma pilha de fontes da interface.
- `umbra-symbol.svg`: desenho vetorial final, transparente, aplicado na interface. Os contornos foram redesenhados para eliminar ruído da geração e garantir leitura em 24 px.
- `umbra-symbol-dark.svg`: versão escura do símbolo para fundos claros.
- `../icon.svg`: versão do símbolo com base escura e um pequeno corte verde, para o ícone desktop.
- `umbra-logo-generated.png`: exploração original gerada pela ferramenta integrada de imagens, preservada sem edição e com transparência.
- `identity-preview.html`: prancha local da identidade, com símbolo, assinatura, cores e tipografia.

## Sistema visual

| Uso | Cor |
| --- | --- |
| Fundo / sala escura | `#090B09` |
| Superfície | `#111310` |
| Texto / película | `#EEEADE` |
| Ação / feixe de luz | `#D7F86A` |
| Divisórias | `#2A2F25` |
| Texto secundário | `#A1A59A` |

Inter/Noto Sans para navegação e controles; Liberation Serif para títulos editoriais; Adwaita Mono/Liberation Mono para pequenos rótulos. Fontes locais com fallbacks de sistema, sem chamadas externas. O verde é uma sinalização, não a cor de todos os títulos. Imagens de filmes mantêm suas cores originais.

Fotogramas, cortes diagonais, pequenos números de arquivo e margens generosas repetem a ideia da marca. Bordas discretas e cantos de 3–5 px substituem a aparência de cartões arredondados. A interface respeita redução de movimento, mantém foco visível e não usa a cor como única indicação de estado.

## Geração

Modo: ferramenta integrada `image_gen`, sem CLI ou chave API.

Prompt final usado:

> Use case: logo-brand. Asset type: production logo symbol for UMBRA, a personal cinema desktop application. Design a distinctive premium geometric U monogram inspired by a strip of film bending into an architectural arch and a projector beam slicing through darkness. One bold continuous U silhouette, two upright stems and a deep sculptural curved bottom, with ONE sharp diagonal negative-space light slit through the upper-right stem; the slit is genuinely transparent. Restrained brutalist Swiss graphic design, confident optical proportions, crisp flat vector-like edges, recognizable at 24px. Single solid warm ivory #eeeade fill, no gradients, no shadow, no stroke, no texture. Center the single symbol in a square composition, symbol fills roughly 75 percent of the canvas. Genuinely transparent background, including all negative space. No text, no letters beyond the abstract U form, no mockup, no board, no app tile, no crescent moon, no play triangle, no film reel, no camera, no decoration. The shape should be original, elegant, sculptural and look like a real independent cinema brand.
