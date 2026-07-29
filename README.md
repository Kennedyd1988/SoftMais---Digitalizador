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

## Changelog

**v1.1** — Adicionada importação/exportação de planilhas XLSX para
Credores, Licitações, Processos de Despesa, Legislação e Documentos
Diversos, com aba de instruções, exemplo preenchido, resolução de
identificadores entre cadastros e gravação em lotes.

**v1.0** — Primeira entrega: estrutura completa (credores PF/PJ,
licitações, processos de despesa, legislação, documentos diversos,
cadastros de apoio, usuários com papéis e permissões, unidades gestoras
múltiplas), integração com Google Drive via Cloud Function, contagem de
páginas automática, anexos por volume, PWA instalável.
