# Gemini Bulk Delete (userscript)

Exclusão em massa de conversas em https://gemini.google.com/app via Tampermonkey.

## Instalação

1. Instale o Tampermonkey no Chrome.
2. Abra este link para instalar (o Tampermonkey reconhece a extensão `.user.js`):
   https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/gemini-bulk-delete.user.js
3. Recarregue a página do Gemini.

O script traz `@updateURL`/`@downloadURL` apontando para esse mesmo arquivo, então o
Tampermonkey atualiza automaticamente quando a `@version` no repositório aumentar.

## Uso

Um painel aparece no topo da lista de conversas ("Recentes") na barra lateral.

- **☑ Seleção em massa** liga/desliga o modo de seleção. Com ele ligado, cada
  conversa ganha uma caixa de seleção e a data da última atividade; clicar no
  título marca/desmarca em vez de abrir a conversa.
- **Selecionar todas / Limpar / Inverter** agem sobre as conversas já carregadas na lista.
- **Últimos X dias → Selecionar** marca as conversas com atividade nos últimos X dias.
  **Mais antigas** marca as conversas mais antigas que X dias.
- **Carregar mais** tenta rolar a lista para carregar conversas adicionais. O Gemini só
  carrega mais itens com rolagem real do mouse; se nada carregar, role a barra lateral
  até o fim manualmente e use os botões de seleção de novo.
- **🗑 Excluir selecionadas** pede confirmação e depois exclui uma a uma usando o
  próprio menu do Gemini ("Mais opções → Excluir → Excluir"), mostrando o progresso.
  **■ Parar** interrompe após a conversa atual.

## Como funciona

- Seletores baseados na interface do Gemini (set/2026): `gem-nav-list-item[data-test-id="conversation"]`,
  `[data-test-id="delete-button"]` no menu e `mat-dialog-container` na confirmação.
- As datas vêm do RPC interno `MaZiqc` (lista paginada de conversas, com timestamp).
  Conversas que não aparecem nessa lista recebem uma data estimada pela posição na
  barra lateral (mostrada em itálico, tooltip "Data estimada").
- O painel é construído com `createElement` porque o Gemini bloqueia `innerHTML`
  (política Trusted Types).

Se o Google mudar a interface, ajuste o objeto `SEL` no início do script.
