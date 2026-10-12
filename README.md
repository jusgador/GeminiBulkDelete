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

---

# Copilot Bulk Delete (userscript)

A mesma ferramenta para o Microsoft 365 Copilot (https://m365.cloud.microsoft/chat),
que também não exclui chats em massa.

## Instalação

Com o Tampermonkey instalado, abra:
https://raw.githubusercontent.com/jusgador/GeminiBulkDelete/main/copilot-bulk-delete.user.js

## Uso

O painel aparece logo abaixo do título "Chats" na barra lateral, com os mesmos botões do
script do Gemini (seleção em massa, todas / limpar / inverter, últimos X dias, mais antigos,
excluir selecionados, parar). Diferenças:

- **Carregar todos** rola a lista até o fim repetidamente até ela parar de crescer. O Copilot
  carrega a lista em páginas de ~10 chats, então use este botão antes de "Selecionar todas".
- As datas mostradas são as da última atividade e são exatas (não há estimativa).
- Chats que estão dentro de Notebooks não aparecem na lista lateral e não são alcançados.

## Como funciona

- Cada chat da lista é um `div.fui-SplitNavItem` com o link `a[href*="/chat/conversation/"]`
  e o botão "Mais" `[data-chat-history-more-button-conversation-id="<id>"]` (out/2026).
- As datas vêm das props React do item (`chatItem.updateTimeUtc`), sem chamadas extras.
- A exclusão usa o menu do próprio Copilot ("Mais → Excluir" e o botão "Excluir" do diálogo
  `[role="alertdialog"]`). Antes de confirmar, o script confere que o diálogo cita o título
  do chat; se não citar, cancela e registra a falha.

Se a Microsoft mudar a interface, ajuste o objeto `SEL` no início do script.
