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

## Changelog

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
