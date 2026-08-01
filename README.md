# SOFT+ Indexação de Documentos

Aplicativo de indexação e digitalização de processos públicos em PDF
(empenhos, licitações, dispensas, portarias, decretos, leis, folha de
pagamento, etc.), com suporte a múltiplas unidades gestoras. Segue o
mesmo padrão arquitetural dos demais apps SOFT+: front-end estático
(HTML/CSS/JS puro), Firebase (Auth + Firestore) como backend, GitHub
Pages como hospedagem, PWA instalável.

## O que ainda falta fazer antes do app funcionar

1. **Preencher `js/firebase-config.js`** com os dados reais do projeto
   (Firebase Console → Configurações do projeto → Seus apps → app Web).
2. **Publicar as regras de segurança** (`firestore.rules`) no Firebase
   Console → Firestore Database → Regras — copie e cole o conteúdo do
   arquivo e publique.
3. **Criar os ícones do PWA** (`icons/icone-192.png` e `icons/icone-512.png`)
   com a logo do SOFT+, nos tamanhos indicados.
4. **Criar a primeira unidade gestora e o primeiro usuário administrador**
   diretamente pelo Firebase Console (Firestore → coleção `entidades` e
   coleção `usuarios`), já que o próprio app exige login de administrador
   para cadastrar os demais. Depois desse primeiro registro manual, tudo
   o mais pode ser feito pela tela de "Usuários" e "Unidades Gestoras"
   dentro do app.
   - Documento em `usuarios/{uid}` (uid = o mesmo ID gerado ao criar o
     usuário no Authentication): `{ nome, email, papel: "administrador",
     unidadesGestoras: [], abasPermitidas: [] }`
5. **Subir os arquivos no GitHub Pages**, do mesmo jeito que os outros
   apps SOFT+ (edição direta pelo editor web do GitHub).
6. **Índices do Firestore**: algumas buscas (por texto normalizado,
   ordenação por data de criação) podem pedir a criação de um índice na
   primeira vez que rodarem — se aparecer um erro no console do
   navegador com um link do tipo "create it here", é só clicar; o
   Firestore cria automaticamente.

## Como dar a uma unidade gestora sua PRÓPRIA conta do Google Drive

Por padrão, todas as unidades gestoras compartilham a mesma conta do
Drive (a configurada nas variáveis de ambiente da Cloud Function). Se
uma unidade gestora nova precisar de uma conta separada (ex: um cliente
diferente, com Drive próprio), siga esses passos — reaproveitando o
mesmo Client ID/Secret já existente, sem precisar criar credencial OAuth
nova nem Cloud Function nova:

1. **Redeploy da Cloud Function** (só precisa fazer uma vez, para
   habilitar esse recurso): copie o conteúdo de `index.js` desta entrega
   por cima do código atual da função `obter-token-drive`, no Google
   Cloud Console → Cloud Run → clique na função → "✏️ Editar e implantar
   uma nova revisão" → cole o código novo na aba `index.js` → Implantar.
   Não precisa mexer nas variáveis de ambiente.
2. **Gerar o Refresh Token da conta nova**: acesse
   [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground),
   configure com o **mesmo Client ID e Client Secret** já usados (⚙️ →
   "Use your own OAuth credentials"), autorize o escopo
   `https://www.googleapis.com/auth/drive.file`, faça login com a **conta
   Google nova** (a que vai ser dona do armazenamento dessa unidade
   gestora específica), e troque o código de autorização pelo token —
   o mesmo processo já documentado mais abaixo neste README.
3. **Salvar no app**: vá em **Unidades Gestoras** (menu, só
   administrador) → abra a unidade gestora desejada → cole o Refresh
   Token novo no campo "Refresh Token do Google Drive (opcional)" →
   Salvar.

Pronto — a partir daí, todo upload/visualização/download feito com essa
unidade gestora selecionada usa a conta do Drive dela, automaticamente.
Unidades gestoras sem esse campo preenchido continuam usando a conta
compartilhada padrão.

**Sobre segurança**: esse token não fica no documento principal da
unidade gestora (que qualquer usuário dela pode ler) — fica numa
subcoleção separada (`entidades/{id}/config/drive`), protegida por regra
do Firestore pra só administrador conseguir ler ou escrever.

## Decisões técnicas e por quê

- **Armazenamento dos PDFs no Google Drive, não no Firebase Storage**:
  mantém o app fora de qualquer camada paga do Firebase; o Drive é
  "gratuito" dentro da cota da conta institucional escolhida.
- **Conexão permanente ao Drive via Cloud Function** (`obter-token-drive`):
  como o app é 100% estático, não é possível guardar com segurança o
  Client Secret do Google no navegador. A Cloud Function guarda essas
  credenciais protegidas no servidor e devolve só um passe de acesso
  temporário (1h), sempre que o app (autenticado via Firebase) precisa.
  Isso é a única peça do sistema que não é hospedagem estática pura —
  está documentado no fluxo de criação, item por item, na conversa que
  originou este app.
- **Escopo `drive.file` (não sensível)**: o app só enxerga os arquivos
  que ele mesmo cria no Drive, nunca a conta inteira. Isso evitou todo o
  processo de verificação/revisão do Google para publicar o app em
  produção.
- **Sem OCR**: descartado por decisão do cliente. Os documentos ficam
  indexados por metadados digitados (número, objeto, tipo, credor,
  etc.), não pelo conteúdo escaneado da imagem.
- **Contagem de páginas do PDF**: feita no navegador com PDF.js, no
  momento do upload, sem custo e sem precisar de serviço externo.
- **Anexos organizados por Volume**: cada anexo tem um número de volume,
  permitindo agrupar vários PDFs dentro do mesmo processo (reflete como
  os processos físicos são organizados na prática).
- **Paginação em lotes de 50**, sempre com cursor (`startAfter`), nunca
  carregando a lista inteira.
- **Campo `objetoNormalizado`/`nomeNormalizado`**: usado pra permitir
  busca sem acento/maiúscula, sem precisar carregar tudo pro cliente.
- **`competenciaKey` no processo de despesa**: guarda o "AAAA-MM" fixo
  da data de pagamento, útil se um dia for preciso filtrar por período
  sem depender de conversão de fuso horário sobre a data em si.
- **Checagem de vínculo antes de excluir** cadastros de apoio (modalidade,
  unidade orçamentária, fonte de recurso, tipo de documento, credor,
  licitação): impede excluir um registro que já está sendo referenciado
  em outro lugar, evitando dado órfão.
- **Segunda instância do Firebase** (`appSecundario`/`authSecundario`):
  usada só na criação de novos usuários, pra não deslogar o administrador
  que está cadastrando.

- **Versionamento de arquivos (`?v=2` no fim dos links de JS/CSS)**:
  criado depois de descobrir que o Service Worker (e às vezes o próprio
  cache do navegador) insistia em servir versões antigas dos arquivos
  mesmo depois de atualizados no GitHub, mascarando correções como se
  não tivessem funcionado. Sempre que um arquivo `.js` ou `.css` for
  alterado, é preciso aumentar o número da versão (`?v=3`, `?v=4`...) no
  `index.html`, na mesma linha do arquivo alterado — isso força o
  navegador a tratar como um recurso novo, sem precisar pedir pro usuário
  limpar cache manualmente toda vez.

## Limitações conhecidas

- A regra "nunca deixar o sistema sem nenhum administrador" está
  implementada apenas na interface (`js/usuarios.js`), não nas regras do
  Firestore — checar essa condição via `firestore.rules` exigiria uma
  consulta adicional dentro da própria regra, o que o Firestore permite
  mas encarece cada escrita. Se for necessário reforçar isso no backend
  no futuro, dá pra mover essa checagem para dentro da própria Cloud
  Function já existente.
- O campo `unidadesGestoras` do usuário é uma lista simples dentro do
  próprio documento — para entidades com centenas de usuários, isso
  pode exigir revisão (mover para uma coleção de índice separada, como
  já foi feito em outro app SOFT+ com `membrosIndice`).
- A busca de licitação para vincular a um processo de despesa (campo
  "Licitação de origem") carrega até 200 licitações da unidade gestora
  atual e filtra no navegador — funciona bem até esse volume; se a
  unidade gestora acumular milhares de licitações, vale trocar por um
  campo normalizado tipo `identificadorNormalizado` e consulta por
  prefixo, igual já é feito para credores.
- Upload de PDF: sem limite técnico do lado do app, mas vale orientar a
  digitalização em qualidade "documento" (não altíssimo DPI), pra não
  gerar arquivos desnecessariamente grandes.

## Importação/Exportação de planilhas (XLSX)

Disponível em Credores, Licitações, Processos de Despesa, Legislação e
Documentos Diversos, seguindo o padrão do projeto:

- **Modelo**: baixa um `.xlsx` com aba de instruções (explicando cada
  coluna e como os identificadores conectam com outros cadastros) e uma
  aba "Dados" já com uma linha de exemplo preenchida.
- **Importar**: lê a aba "Dados" da planilha enviada, valida cada linha,
  resolve os identificadores (nome da modalidade, CPF/CNPJ do credor,
  nome da unidade orçamentária etc.) para o ID interno correspondente, e
  grava tudo em lotes (nunca documento por documento em sequência).
  Linhas com erro (ex: modalidade não cadastrada) não travam a
  importação inteira — ficam de fora e aparecem listadas no resumo final,
  com o número da linha e o motivo.
  Registros pré-existentes referenciados por nome/documento precisam já
  estar cadastrados antes de importar (ex: para importar despesas, os
  credores, unidades orçamentárias e fontes de recurso citados na
  planilha já precisam existir no sistema).
- **Exportar**: gera um `.xlsx` com todos os registros da unidade gestora
  atual, no mesmo formato de colunas do modelo de importação — útil tanto
  para relatório quanto para reimportar em outra unidade gestora.

## Número da versão visível no app

O app mostra a versão atual (ex: "v2.5") no rodapé do menu lateral e na
tela de login — útil pra conferir rapidamente se o navegador já está
com a versão mais recente depois de uma atualização (se o número não
bater com o que eu informar na entrega, é sinal de cache antigo).

A constante `VERSAO_APP` fica no topo do arquivo `js/core.js`. **Sempre
que uma entrega alterar código**, essa constante deve ser atualizada
junto com o número de versão do cache-busting (`?v=`) nos scripts do
`index.html` — os dois devem ficar sincronizados.

## Testando localmente, sem subir pro GitHub

Sim, dá pra testar tudo localmente antes de subir — importante quando
tem outra pessoa mexendo no repositório ao mesmo tempo. Só um detalhe:
**não dá pra simplesmente abrir o `index.html` clicando duas vezes**
(o Firebase Auth não funciona bem com o protocolo `file://`). É preciso
rodar um servidor local simples:

- **Com Python instalado** (Windows/Mac já costuma vir): abra um
  terminal na pasta do app e rode `python -m http.server 8000` (ou
  `python3 -m http.server 8000` no Mac/Linux) → acesse
  `http://localhost:8000` no navegador.
- **Com VS Code**: instale a extensão "Live Server", clique com o botão
  direito no `index.html` → "Open with Live Server".

**Antes de testar**, autorize esse endereço local nos dois lugares onde
o app precisa de permissão (isso é só adicionar, não remove nem afeta o
que já está autorizado pra produção):
1. **Firebase Console** → Authentication → Settings → Authorized
   domains → adicionar `localhost`.
2. **Google Cloud Console** → Google Auth Platform → Clientes → o
   cliente "SOFT+ Digitalizador - Web" → em "Origens JavaScript
   autorizadas", adicionar `http://localhost:8000` (ajuste a porta se
   usar outra).

Depois disso, o app funciona 100% localmente — login, Firestore, Drive,
tudo — sem precisar publicar nada no GitHub Pages até você confirmar que
está tudo certo.

## Changelog

**v4.8** — Botão **🔗** adicionado direto no cartão da listagem (ao
lado de editar/excluir), em Licitações e Processos de Despesa — abre o
mesmo modal "de espiada" (Despesas Vinculadas / Licitação vinculada)
sem precisar abrir o registro pra editar primeiro. Em Despesas, só
aparece quando o processo realmente tem uma licitação vinculada.

**v4.7** — Mudança importante nas 4 telas com anexo (Licitações,
Despesas, Legislação, Documentos Diversos):
- **Filtros combináveis**: busca por texto, filtro de ano e "Sem
  anexo"/"Com anexo" agora funcionam **juntos**, em vez de um resetar o
  outro. Por trás dos panos, só um vira consulta ao Firestore (o mais
  restritivo disponível) e os demais são aplicados em cima do resultado,
  no navegador — assim combinam sem precisar de nenhum índice composto
  novo.
- **Busca ampliada**: Despesas passou a buscar também por Elemento de
  Despesa (além de empenho, ordem de pagamento, credor e objeto).
  Legislação e Documentos Diversos passaram a buscar por Número também
  (antes só buscavam por Objeto) — precisou de um campo novo
  (`numeroNormalizado`), então registros cadastrados antes dessa versão
  só aparecem nessa busca depois de reindexados (Manutenção → Reindexar
  Legislação/Documentos Diversos).

**v4.6** — "Licitação de origem" virou obrigatória no cadastro de
Processo de Despesa — ou você vincula uma licitação, ou marca a nova
caixa **"Processo sem licitação vinculada"**, que libera salvar sem
vínculo (e desabilita/limpa o campo de busca enquanto marcada). Não
tem como mais salvar uma despesa sem decidir um dos dois.
**Atenção**: despesas cadastradas antes dessa versão, sem licitação
vinculada e sem essa marcação, vão pedir essa decisão da próxima vez
que forem abertas e salvas — é o comportamento esperado, não é bug.

**v4.5** — Duas correções na Atualização em Massa:
- A busca de "Selecionar da lista" só checava o campo Objeto em
  qualquer coleção — corrigido pra buscar nos mesmos campos usados no
  resto do app (número do empenho, ordem de pagamento, credor, número
  da licitação, modalidade, etc.), dependendo da coleção escolhida.
- O "Novo valor" pra campos relacionados (ex: Licitação de origem) era
  uma lista fixa de até 500 itens sem busca nenhuma — virou um campo de
  busca com sugestões, igual ao resto do app, muito mais fácil de achar
  o registro certo sem se confundir.

**v4.4** — O dropdown de "Novo valor" na Atualização em Massa agora
mostra a modalidade quando o registro é uma licitação (ex: "015/2026 —
Inexigibilidade — Contratação..."), igual já acontece no autocomplete
de "Licitação de origem" dentro da Despesa. Licitações ainda não
reindexadas (sem `modalidadeNome` preenchido) aparecem sem essa parte —
rode Manutenção → Reindexar Licitações se precisar.

**v4.3** — Atualização em Massa reconstruída, com os 3 pedidos do
cliente:
1. **Selecionar registros específicos**: além de filtrar por critério
   (campo = valor), agora dá pra buscar e marcar manualmente quais
   registros exatos você quer atualizar, com checkbox numa lista.
2. **Campo a atualizar por dropdown**: em vez de digitar o nome do
   campo (sujeito a erro de digitação), escolhe de uma lista com os
   campos conhecidos de cada coleção.
3. **Campos relacionados a outra tabela**: quando o campo escolhido é
   uma referência (ex: Fonte de Recurso, Credor, Licitação de origem),
   o "novo valor" vira um dropdown com os registros de verdade daquela
   tabela (pelo nome, não pelo ID) — e, quando existe um nome copiado
   por conveniência junto ao vínculo (ex: nome do credor gravado direto
   na despesa), esse nome é sincronizado automaticamente, evitando
   dado inconsistente.

**v4.2** — Nova ferramenta na aba Manutenção: **⚙️ Atualização em
Massa**. Permite gravar o mesmo valor num campo específico, em vários
registros de uma coleção de uma vez (com filtro opcional pra escolher
quais registros afeta), sem precisar editar um por um nem escrever
nenhum script técnico. Sempre pede pra contar quantos registros seriam
afetados antes de liberar o botão de aplicar, e pede confirmação antes
de gravar de verdade — não tem desfazer automático depois. Funciona bem
pra campos simples (texto, número, sim/não); não deve ser usada pra
campos de lista como "anexos".

**v4.1** — Trocado o percentual em texto (fácil de passar despercebido)
por uma barra de progresso visual de verdade nos botões individuais
"👁️ Visualizar" e "⬇️ Baixar" de cada anexo — tanto na tela normal de
edição quanto nos modais "de espiada" (Despesas/Licitação vinculadas).

**v4.0** — Mudança de comportamento por pedido do cliente: o botão
"🔗 Ver Licitação vinculada" (dentro da Despesa) não navega mais pra
outra tela — agora abre um modal "de espiada" com os dados da licitação
e seus anexos (ver/baixar com progresso), igual ao "Ver Despesas
Vinculadas" já fazia do lado da Licitação. Fechar o modal mantém você
exatamente na tela da Despesa, sem perder o lugar. Só navega de verdade
se clicar explicitamente em "✏️ Editar Licitação completa" (mesma ideia
aplicada em "Abrir processo", dentro do modal de Despesas Vinculadas,
renomeado pra "✏️ Editar processo completo" pra deixar claro que essa
é a única ação que sai da tela atual).

**v3.9** — O modal "Despesas Vinculadas" (dentro da Licitação) agora
mostra os anexos de cada processo individualmente, com botões de
👁️ visualizar e ⬇️ baixar (e percentual de progresso), em vez de só um
botão que levava pro registro completo. O botão "Abrir processo" continua
disponível separadamente, pra quem quiser editar o processo em si.

**v3.8** — Corrigido o botão "🔗 Ver Licitação vinculada" (dentro da
Despesa): ele navegava até a lista de Licitações, mas não abria o
registro específico — faltava o mesmo mecanismo de "abrir automático"
que já existia do lado inverso (Despesas). Agora abre direto.

**v3.7** — O autocomplete de "Licitação de origem" (dentro do Processo
de Despesa) agora mostra a modalidade junto na lista de sugestões (ex:
"1/2025 — Inexigibilidade — Contratação..."), não só número/ano/objeto
— facilita diferenciar licitações com número parecido.

**v3.6** — Corrigida a busca por "número/ano" de Licitações (tanto na
lista quanto no vínculo dentro da Despesa): estava funcionando como
"ou" (número batendo OU ano batendo, mostrando qualquer um dos dois
soltos) em vez de "e" (os dois precisam bater juntos). Agora digitar
"1/2025" só traz a licitação número 1 do ano 2025, não qualquer
licitação começando com "1" nem qualquer licitação de 2025.

**v3.5** — Duas correções na busca/navegação de Licitações:
- A busca (tanto na lista de Licitações quanto no campo "Licitação de
  origem" dentro da Despesa) agora entende o formato completo
  "número/ano" (ex: digitar "015/2026"), separando a parte do número da
  parte do ano automaticamente. Antes, digitar com a barra "/" incluída
  quebrava a busca porque o número sozinho no banco não tem a barra.
- O botão "🔗 Ver Despesas Vinculadas" ganhou tratamento de erro
  visível — antes, se a consulta falhasse por qualquer motivo, nada
  acontecia ao clicar, sem nenhum aviso. Agora mostra "Carregando..." no
  botão e, se der erro, avisa com um toast (inclusive apontando se for
  falta de índice do Firestore).

**Lembrete importante**: essas correções de busca só valem pra
registros que já têm os campos `numeroNormalizado`/
`modalidadeNomeNormalizado` preenchidos. Licitações cadastradas antes da
v3.0 (como as usadas nos testes) precisam ser reindexadas primeiro —
**Manutenção → Reindexar Licitações** — antes de aparecerem nessas
buscas. O botão "🔗 Ver Licitação vinculada" dentro da Despesa também só
aparece depois que o vínculo realmente foi salvo com sucesso (ou seja,
depois que a busca já estiver funcionando e você conseguir selecionar a
licitação na lista de sugestões).

**v3.4** — Completada a cobertura de barras de progresso: agora também
nos botões individuais "👁️ Visualizar" e "⬇️ Baixar" de cada anexo (que
antes não davam nenhum feedback durante o download), mostrando o
percentual ao lado do botão. A exportação em `.zip` também passou a
calcular o percentual geral considerando o progresso *dentro* de cada
arquivo (bytes já baixados do PDF atual), não só a contagem de arquivos
concluídos — fica mais preciso pra PDFs grandes. Tanto o download
individual quanto o do `.zip` agora usam `XMLHttpRequest` em vez de
`fetch`, pelo mesmo motivo do upload: só o XHR expõe o progresso de
verdade enquanto a operação está rolando.

**v3.3** — Barra de progresso com percentual adicionada em todos os
lugares que antes só mostravam texto genérico ("Importando...",
"Exportando...", "Reindexando..."): exportação de PDFs em lote (.zip),
importação e exportação de planilha (atualiza linha por linha), e todos
os reindexadores da aba Manutenção (atualiza conforme grava os lotes no
Firestore). Criado um componente reutilizável (`criarBarraProgressoInline`)
pra não repetir essa lógica em cada lugar.

**v3.2** — Correção definitiva do alinhamento do checkbox de seleção: a
tentativa anterior (v3.1) resolveu o alinhamento vertical, mas deixou
um espaço grande entre o checkbox e o texto, porque o cartão tinha 3
elementos lado a lado (checkbox, conteúdo, ações) disputando o espaço
livre de forma desigual. Agora o checkbox e o conteúdo ficam agrupados
num mesmo bloco interno, então o cartão volta a ter só 2 elementos no
nível principal (o bloco checkbox+conteúdo, e as ações) — mesmo
comportamento confiável que já existia antes de mexer nisso.

**v3.1** — Corrigido o alinhamento vertical do checkbox de seleção nos
cartões com várias linhas (ficava centralizado no meio do cartão em vez
de alinhado no topo). Adicionado o botão "☑️ Selecionar todos", que
marca de uma vez todos os registros já carregados na tela (respeitando
o filtro/busca atual).

**v3.0** — Entrega grande, por pedido do cliente:
- **Drive por unidade gestora**: cada unidade gestora pode ter sua
  própria conta do Google Drive (Refresh Token configurável em Unidades
  Gestoras, guardado numa subcoleção protegida só pra administrador).
  **Exige redeploy da Cloud Function** — veja a seção "Como dar a uma
  unidade gestora sua própria conta do Google Drive" acima.
- **Busca de Licitações corrigida**: antes só considerava o campo
  Objeto, apesar do texto prometer número/ano/objeto. Agora busca de
  verdade por número, modalidade e objeto (e por ano, se digitar 4
  dígitos). A mesma melhoria foi aplicada na busca usada pra vincular
  uma Licitação a um Processo de Despesa.
- **Navegação cruzada**: dentro de uma Despesa vinculada a uma
  Licitação, aparece o botão "🔗 Ver Licitação vinculada". Dentro de uma
  Licitação já salva, aparece "🔗 Ver Despesas Vinculadas", que abre a
  lista de todos os processos de despesa ligados a ela.
- **Exportação de PDFs em lote**: dentro da lista de despesas vinculadas
  a uma licitação, um botão baixa todos os PDFs de uma vez, compactados
  num `.zip`. Além disso, Licitações, Despesas, Legislação e Documentos
  Diversos ganharam checkbox de seleção em cada cartão + uma barra
  "Exportar selecionados", pra exportar os PDFs de vários registros
  escolhidos à mão de uma só vez.
- **Filtro "📎 Com anexo"**: complementa o "📋 Sem anexo" que já existia,
  nos mesmos 4 módulos. Também foi adicionada uma marcação visual (📎)
  ao lado do botão editar nos cartões que já têm algum anexo.
- Reindexador de Licitações (aba Manutenção) atualizado pra também
  preencher os campos novos de busca (número e modalidade normalizados).

**Atenção**: assim como aconteceu com outros campos de busca no
passado, licitações cadastradas antes dessa versão só vão aparecer na
busca por número/modalidade depois de reindexadas (Manutenção →
Reindexar Licitações) ou salvas de novo manualmente. O mesmo vale pros
filtros "Com anexo"/"Sem anexo" em qualquer registro cadastrado antes da
v1.5/v1.9 que ainda não tenha sido reindexado.

**v2.7** — Reestruturada a aba Relatórios, por pedido do cliente: em
vez do valor em R$ e do detalhamento por Unidade Orçamentária/Fonte de
Recurso, agora mostra uma única tabela dividida por tipo (Processos de
Despesa, Licitações, Legislação, Documentos Diversos) com três colunas:
quantidade de registros, quantidade de arquivos PDF anexados e
quantidade de páginas — mais uma linha de total geral. O PDF exportado
segue o mesmo formato.

**v2.6** — Número da versão do app agora fica visível no rodapé do menu
lateral e na tela de login (ex: "v2.6"), pra facilitar conferir se o
navegador já está com a versão mais recente depois de uma atualização.

**v2.5** — **Correção real na aba Relatórios**: a API de agregação do
Firestore (`AggregateField.sum`, `count()`) tem relatos conhecidos de
não funcionar de forma confiável no SDK "compat" (o formato usado neste
app), o que estava causando o erro genérico "Erro ao carregar a lista"
sempre que o relatório era gerado. Trocado por um cálculo direto a
partir dos documentos buscados (soma e contagem em JavaScript comum),
sem depender dessa API — mais simples e garantido de funcionar. Também
adicionada a modalidade no nome do PDF ao anexar em Licitações (Legislação
e Documentos Diversos já incluíam o tipo).

**v2.4** — Adicionada barra de progresso com percentual real durante o
envio do PDF pro Google Drive. Foi preciso trocar o envio de `fetch`
para `XMLHttpRequest`, porque o `fetch` não expõe nenhum evento de
progresso de upload (só avisa quando termina por completo) — o `XHR` é
a única forma de acompanhar quantos bytes já foram enviados em tempo
real, mesmo sendo uma API mais antiga.

**v2.3** — **Correção importante nos Relatórios**: o detalhamento
"Despesas por Unidade Orçamentária" e "por Fonte de Recurso" combinava
um filtro de intervalo (competência do ano) com um filtro de igualdade
(a unidade/fonte específica) — essa combinação exige um índice composto
no Firestore, que não existia, e o erro estava sendo engolido
silenciosamente, fazendo essas duas tabelas aparecerem sempre vazias
mesmo havendo despesas no período. Corrigido: agora os documentos do ano
são buscados uma única vez (mesma consulta simples já usada pro total) e
agrupados/somados no navegador, sem depender de índice composto nenhum.

Também adicionado o filtro **"📋 Sem anexo"** em Licitações, Despesas,
Legislação e Documentos Diversos — mostra só os registros que ainda não
têm nenhum PDF anexado, útil pra achar o que falta digitalizar. Precisou
de um campo novo (`quantidadeAnexos`) gravado em cada registro; por isso
a tela de Manutenção ganhou reindexadores para Licitações e para
Legislação/Documentos Diversos (que já preenchem esse campo junto com o
que já faziam), e o reindexador de Despesas também passou a corrigir
esse campo.

**v2.2** — Removido o botão "📷 Digitalizar" (captura por câmera) por
decisão do cliente. A renomeação automática do PDF com base nos dados
do cadastro (v2.1) continua funcionando normalmente pro botão "+
Adicionar PDF".

**v2.1** — PDFs anexados agora são renomeados automaticamente com base
nos dados do cadastro em que estão sendo indexados (ex: um anexo de
despesa vira `Empenho-203002-Francisca-Cristiana-Vol1.pdf` em vez de
manter o nome original do arquivo/foto). Funciona tanto pra upload comum
quanto pra digitalização pela câmera. Se os campos principais do
formulário ainda estiverem vazios no momento do envio, mantém o nome
original (não força um nome incompleto).

**v2.0** — Novo botão **📷 Digitalizar** na seção de anexos: tira fotos
pela câmera (celular ou webcam do PC), permite capturar várias páginas,
remove página errada antes de finalizar, monta um PDF automaticamente e
mostra uma prévia — só vira anexo de verdade depois de "Usar este
documento". **Limitação conhecida, documentada por transparência**: não
é possível integrar com scanners físicos (TWAIN/WIA) direto do
navegador — essa tecnologia não existe em nenhum navegador moderno sem
instalar um serviço adicional pago no computador, o que fugiria do
conceito de app 100% estático deste projeto. Pra usar um scanner de
mesa, o caminho é digitalizar pelo programa do próprio scanner e depois
anexar o PDF gerado pelo botão "+ Adicionar PDF" (que já funciona).

**v1.9** — Nova aba **Manutenção** (só administrador): ferramenta de
reindexação em massa. "Reindexar Processos de Despesa" varre todos os
registros e recalcula os campos de busca (número do empenho, ordem de
pagamento, credor, objeto, competência) que ficaram faltando em
registros cadastrados antes dessas buscas existirem — sem precisar abrir
um por um. "Preencher Ano" (Legislação e Documentos Diversos) tenta
descobrir o ano automaticamente a partir do número do documento (formato
"123/2026"); quando não consegue, lista o registro pra preenchimento
manual. Tudo em lote, nunca documento por documento em sequência.

**v1.8** — Adicionado versionamento (`?v=`) nos arquivos JS/CSS
carregados pelo `index.html`, para eliminar de vez os problemas de
cache que fizeram parecer que correções de código não tinham funcionado
(o navegador/Service Worker continuava rodando a versão antiga mesmo
depois do arquivo atualizado no GitHub). A partir de agora, toda entrega
que alterar `.js`/`.css` já vem com esse número aumentado.

**v1.7** — Corrigida lentidão no carregamento da lista de Processos de
Despesa: a tela estava baixando a coleção inteira de Credores e de
Licitações toda vez que era aberta (só pra montar a planilha de
importação/exportação), mesmo que o usuário só quisesse ver a lista.
Agora essa busca só acontece de verdade quando o botão Importar ou
Exportar é clicado, e fica em cache pro resto da visita à página.

**v1.6** — A busca de Processos de Despesa estava cobrindo só três dos
quatro campos prometidos: número do empenho, credor e objeto — faltava
**Ordem de Pagamento**. Corrigido, agora busca nos quatro. Mesma
observação de antes: despesas cadastradas antes dessa correção só
passam a aparecer na busca por Ordem de Pagamento depois de serem
abertas e salvas de novo (ou reindexadas em massa, se um dia isso virar
necessário para muitos registros).

**v1.5** — Filtro por ano em Licitações, Despesas, Legislação e
Documentos Diversos (Legislação e Documentos Diversos ganharam campo
"Ano" novo, que não existia antes). Nova aba **Relatórios**: totais e
contagens por ano — total em R$ e quantidade de despesas, com
detalhamento por Unidade Orçamentária e por Fonte de Recurso, mais
contagem de Licitações, Legislação e Documentos Diversos do ano. Todos
os totais calculados no servidor via agregação do Firestore (`count()` e
`aggregate(sum)`), nunca baixando os processos inteiros para somar no
cliente. O relatório pode ser exportado em PDF (jsPDF), com cabeçalho,
tabelas e rodapé com numeração de página, reaproveitáveis para relatórios
futuros. **Atenção:** despesas cadastradas antes da v1.3 não têm Unidade
Orçamentária/Fonte de Recurso com o novo campo Código, e licitações,
legislação e documentos cadastrados antes dessa versão podem não entrar
na contagem por ano do relatório se não tiverem o campo `ano` preenchido
(Legislação e Documentos Diversos antigos precisam ser abertos e salvos
de novo para ganhar esse campo).

**v1.4** — Corrigida a busca de Processos de Despesa: antes só filtrava
pelo campo Objeto (apesar do texto do campo prometer buscar também por
número do empenho); agora consulta em paralelo três campos — número do
empenho, credor e objeto — e junta os resultados. Como o Firestore só
permite busca por prefixo em um campo por consulta, a solução usa 3
consultas simultâneas em vez de uma só. **Atenção:** despesas cadastradas
antes dessa versão não têm os campos `numeroEmpenhoNormalizado` e
`credorNomeNormalizado` gravados, então não aparecerão em buscas por
número do empenho ou credor até serem abertas e salvas de novo (mesmo
sem alterar nada, o simples "Salvar" já preenche os campos que faltam).

**v1.3** — Novos campos: Processo de Despesa ganhou "Ordem de Pagamento"
e "Elemento de Despesa" (validado no formato 9.9.99.99.99); Unidade
Orçamentária e Fonte de Recurso ganharam campo "Código", exibido também
nos seletores desses cadastros dentro do formulário de despesa. Todos
refletidos na planilha modelo, importação e exportação de despesas.
Também padronizados os ícones de editar/excluir na listagem de
Licitações, Despesas, Legislação e Documentos Diversos (mesmo padrão
visual do Credor).

**v1.2** — Padronização visual com a identidade oficial SOFT+: logo real
(`logo-horizontal.png` na tela de login, `logo-simbolo.png` no cabeçalho),
ícones do PWA reais, mesma paleta de cores e tipografia (Inter, Source
Serif 4, IBM Plex Mono) usada nos demais apps da marca. Corrigido também
o carregamento do PDF.js (versão trocada para 3.11.174, já que a partir
da v4 a biblioteca virou 100% módulo ES e não expõe mais a variável
global `pdfjsLib` em `<script>` comum).

**v1.1** — Adicionada importação/exportação de planilhas XLSX para
Credores, Licitações, Processos de Despesa, Legislação e Documentos
Diversos, com aba de instruções, exemplo preenchido, resolução de
identificadores entre cadastros e gravação em lotes.

**v1.0** — Primeira entrega: estrutura completa (credores PF/PJ,
licitações, processos de despesa, legislação, documentos diversos,
cadastros de apoio, usuários com papéis e permissões, unidades gestoras
múltiplas), integração com Google Drive via Cloud Function, contagem de
páginas automática, anexos por volume, PWA instalável.
