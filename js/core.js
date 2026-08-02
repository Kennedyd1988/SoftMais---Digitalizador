// ===================================================================
// NÚCLEO DO APP — autenticação, permissões, navegação, utilidades
// ===================================================================

// ===================================================================
// VERSÃO DO APP — atualizada a cada entrega, visível no rodapé do menu
// e na tela de login, para facilitar conferir se o navegador já está
// com a versão mais recente (ajuda a identificar problema de cache).
// ===================================================================
const VERSAO_APP = "8.11";
document.addEventListener("DOMContentLoaded", () => {
  const elementoLogin = document.getElementById("versao-app-login");
  if (elementoLogin) elementoLogin.textContent = `v${VERSAO_APP}`;
});

// Estado global em memória (não usar localStorage/sessionStorage —
// mantemos tudo em variáveis JS, recarregadas a cada login)
const estado = {
  usuario: null, // objeto do Firebase Auth
  dadosUsuario: null, // documento de usuarios/{uid}: papel, unidadesGestoras, abasPermitidas
  entidadeAtual: null, // id da unidade gestora selecionada
  entidadeAtualNome: "",
  entidadeAtualDados: null, // documento completo da entidade (endereço, logo, etc. — usado nos relatórios)
};

// -------------------------------------------------------------
// UTILIDADES GERAIS
// -------------------------------------------------------------

/** Remove acento e caixa alta, para permitir busca "joao" = "João" */
/**
 * Escapa texto livre digitado pelo usuário antes de colocar dentro de
 * HTML (ex: campo "Objeto") — evita que alguém digite algo parecido com
 * código e isso acabe rodando na tela de quem for ver aquele registro.
 */
function escaparHtml(texto) {
  if (texto === null || texto === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(texto);
  return div.innerHTML;
}

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Mostra uma mensagem rápida no rodapé da tela (toast) */
function mostrarToast(mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-visivel"), 10);
  setTimeout(() => {
    toast.classList.remove("toast-visivel");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/** Formata valor em Real (R$) */
function formatarMoeda(valor) {
  return (valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Formata data ISO (AAAA-MM-DD) para dd/mm/aaaa, sem depender de fuso do navegador */
function formatarData(dataIso) {
  if (!dataIso) return "-";
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Trata erros de consulta ao Firestore de forma visível ao usuário —
 * antes disso, uma consulta que falhasse (ex: por falta de índice
 * composto) deixava a tela em branco sem nenhum aviso.
 */
function tratarErroConsultaFirestore(erro) {
  console.error("Erro ao consultar o Firestore:", erro);
  if (erro?.message?.includes("requires an index") || erro?.code === "failed-precondition") {
    mostrarToast(
      "Essa consulta precisa de um índice novo no Firestore. Veja o link no Console do navegador (F12) para criá-lo.",
      "erro"
    );
  } else {
    mostrarToast("Erro ao carregar a lista. Tente novamente.", "erro");
  }
}

/**
 * Cria uma barra de progresso visual (com percentual) dentro de um
 * elemento — reutilizada em qualquer operação demorada e em lote
 * (upload, exportação em zip, importação/exportação de planilha,
 * reindexação em massa), pra nunca deixar o usuário sem saber quanto
 * falta.
 */
function criarBarraProgressoInline(container, rotuloInicial = "Processando") {
  const div = document.createElement("div");
  div.className = "barra-progresso-inline";
  div.innerHTML = `
    <div class="texto-status-upload">${rotuloInicial}...</div>
    <div class="barra-progresso-container">
      <div class="barra-progresso-preenchimento" style="width:0%"></div>
    </div>
  `;
  container.appendChild(div);
  const textoEl = div.querySelector(".texto-status-upload");
  const barraEl = div.querySelector(".barra-progresso-preenchimento");
  return {
    atualizar(feitos, total, rotulo = rotuloInicial) {
      const percentual = total > 0 ? Math.round((feitos / total) * 100) : 0;
      textoEl.textContent = `${rotulo}... ${feitos}/${total} (${percentual}%)`;
      barraEl.style.width = `${percentual}%`;
    },
    atualizarPercentual(percentual, rotulo = rotuloInicial) {
      textoEl.textContent = `${rotulo}... ${percentual}%`;
      barraEl.style.width = `${percentual}%`;
    },
    remover() {
      div.remove();
    },
  };
}

/** Botão de ação com estado "processando..." — evita tela parada sem feedback */
async function executarComFeedback(botao, funcaoAssincrona, textoProcessando = "Salvando...") {
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = textoProcessando;
  try {
    await funcaoAssincrona();
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

/** Marca um campo obrigatório com borda vermelha + mensagem específica */
function marcarCampoInvalido(elemento, mensagem) {
  elemento.classList.add("campo-invalido");
  let aviso = elemento.parentElement.querySelector(".aviso-campo");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.className = "aviso-campo";
    elemento.parentElement.appendChild(aviso);
  }
  aviso.textContent = mensagem;
}

function limparCampoInvalido(elemento) {
  elemento.classList.remove("campo-invalido");
  const aviso = elemento.parentElement.querySelector(".aviso-campo");
  if (aviso) aviso.remove();
}

// -------------------------------------------------------------
// PAGINAÇÃO GENÉRICA (padrão: 50 registros por vez, com cursor)
// -------------------------------------------------------------
const TAMANHO_PAGINA = 50;

/**
 * Cria um controlador de paginação para uma consulta Firestore.
 * Nunca baixa a coleção inteira — só o lote atual, avançando com
 * startAfter a partir do último documento carregado.
 */
function criarPaginador(consultaBase) {
  let ultimoDocumento = null;
  let acabou = false;

  return {
    async carregarProximaPagina() {
      if (acabou) return [];
      let consulta = consultaBase.limit(TAMANHO_PAGINA);
      if (ultimoDocumento) {
        consulta = consulta.startAfter(ultimoDocumento);
      }
      const snapshot = await consulta.get();
      if (snapshot.empty || snapshot.docs.length < TAMANHO_PAGINA) {
        acabou = true;
      }
      if (!snapshot.empty) {
        ultimoDocumento = snapshot.docs[snapshot.docs.length - 1];
      }
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },
    reiniciar() {
      ultimoDocumento = null;
      acabou = false;
    },
    get temMais() {
      return !acabou;
    },
  };
}

// -------------------------------------------------------------
// PERMISSÕES
// -------------------------------------------------------------

/** Papéis possíveis: 'administrador' | 'cadastrador' | 'leitura' */
function usuarioEhAdministrador() {
  return estado.dadosUsuario?.papel === "administrador";
}

function usuarioPodeEditar() {
  const papel = estado.dadosUsuario?.papel;
  return papel === "administrador" || papel === "cadastrador";
}

/** Verifica se o usuário tem a aba/módulo liberado */
function usuarioTemAcessoAba(nomeAba) {
  if (usuarioEhAdministrador()) return true;
  return (estado.dadosUsuario?.abasPermitidas || []).includes(nomeAba);
}

/** Verifica se o usuário tem acesso à unidade gestora atualmente selecionada */
function usuarioTemAcessoEntidade(entidadeId) {
  if (usuarioEhAdministrador()) return true;
  return (estado.dadosUsuario?.unidadesGestoras || []).includes(entidadeId);
}

// -------------------------------------------------------------
// AUTENTICAÇÃO
// -------------------------------------------------------------

auth.onAuthStateChanged(async (usuario) => {
  if (usuario) {
    estado.usuario = usuario;
    try {
      const doc = await db.collection("usuarios").doc(usuario.uid).get();
      if (!doc.exists) {
        mostrarToast(
          "Seu usuário não tem cadastro de permissões. Contate o administrador.",
          "erro"
        );
        await auth.signOut();
        return;
      }
      estado.dadosUsuario = doc.data();
      iniciarApp();
    } catch (erro) {
      console.error("Erro ao carregar dados do usuário:", erro);
      mostrarToast("Erro ao carregar permissões. Tente novamente.", "erro");
    }
  } else {
    estado.usuario = null;
    estado.dadosUsuario = null;
    mostrarTelaLogin();
  }
});

function mostrarTelaLogin() {
  document.getElementById("tela-login").classList.remove("oculto");
  document.getElementById("app-container").classList.add("oculto");
  document.getElementById("tela-selecao-entidade").classList.add("oculto");
}

async function fazerLogin(email, senha) {
  await auth.signInWithEmailAndPassword(email, senha);
}

async function fazerLogout() {
  await auth.signOut();
}

// -------------------------------------------------------------
// INICIALIZAÇÃO DO APP (após login confirmado)
// -------------------------------------------------------------

async function iniciarApp() {
  document.getElementById("tela-login").classList.add("oculto");
  document.getElementById("nome-usuario-logado").textContent =
    estado.dadosUsuario.nome || estado.usuario.email;

  const entidades = await carregarListaEntidadesDoUsuario();
  if (entidades.length === 0) {
    mostrarToast("Nenhuma unidade gestora liberada para este usuário.", "erro");
    return;
  }

  popularSeletorEntidadeHeader(entidades);

  if (entidades.length === 1) {
    // Só uma opção — não faz sentido pedir pra escolher, abre direto
    abrirAppComEntidade(entidades[0]);
  } else {
    mostrarTelaSelecaoEntidade(entidades);
  }
}

/** Carrega a lista de unidades gestoras que o usuário pode acessar (sem selecionar nenhuma ainda) */
async function carregarListaEntidadesDoUsuario() {
  let entidades = [];
  if (usuarioEhAdministrador()) {
    const snapshot = await db.collection("entidades").orderBy("nome").get();
    entidades = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    const ids = estado.dadosUsuario.unidadesGestoras || [];
    const consultas = await Promise.all(
      ids.map((id) => db.collection("entidades").doc(id).get())
    );
    entidades = consultas
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  return entidades;
}

function popularSeletorEntidadeHeader(entidades) {
  const seletor = document.getElementById("seletor-entidade");
  seletor.innerHTML = "";
  entidades.forEach((entidade) => {
    const opcao = document.createElement("option");
    opcao.value = entidade.id;
    opcao.textContent = entidade.nome;
    seletor.appendChild(opcao);
  });
  seletor.addEventListener("change", () => {
    const entidade = entidades.find((e) => e.id === seletor.value);
    definirEntidadeAtual(entidade);
    navegarPara(paginaAtual || "inicio");
  });
}

function definirEntidadeAtual(entidade) {
  estado.entidadeAtual = entidade.id;
  estado.entidadeAtualNome = entidade.nome;
  estado.entidadeAtualDados = entidade;
}

/** Mostra a tela de escolha de unidade gestora (só quando o usuário tem acesso a mais de uma) */
function mostrarTelaSelecaoEntidade(entidades) {
  const lista = document.getElementById("lista-entidades-selecao");
  lista.innerHTML = entidades.map((entidade) => `
    <button type="button" class="item-selecao-entidade" data-id="${entidade.id}">
      ${entidade.logoBase64 ? `<img src="${entidade.logoBase64}" alt="">` : `<span class="icone-entidade-generico">🏢</span>`}
      <span>${entidade.nome}</span>
    </button>
  `).join("");

  document.getElementById("tela-selecao-entidade").classList.remove("oculto");

  lista.querySelectorAll(".item-selecao-entidade").forEach((botao) => {
    botao.addEventListener("click", () => {
      const entidade = entidades.find((e) => e.id === botao.dataset.id);
      document.getElementById("seletor-entidade").value = entidade.id;
      document.getElementById("tela-selecao-entidade").classList.add("oculto");
      abrirAppComEntidade(entidade);
    });
  });
}

function abrirAppComEntidade(entidade) {
  definirEntidadeAtual(entidade);
  document.getElementById("seletor-entidade").value = entidade.id;
  document.getElementById("app-container").classList.remove("oculto");
  montarMenuLateral();
}

// -------------------------------------------------------------
// NAVEGAÇÃO ENTRE MÓDULOS (single page, sem reload)
// -------------------------------------------------------------

const ITENS_MENU = [
  { chave: "inicio", rotulo: "Início", icone: "🏠", modulo: null, grupo: null },

  { chave: "credores", rotulo: "Credores/Fornecedores", icone: "🧾", modulo: "credores", grupo: "Cadastros" },
  { chave: "modalidades-licitacao", rotulo: "Modalidades de Licitação", icone: "⚙️", modulo: "config", grupo: "Cadastros" },
  { chave: "unidades-orcamentarias", rotulo: "Unidades Orçamentárias", icone: "⚙️", modulo: "config", grupo: "Cadastros" },
  { chave: "fontes-recurso", rotulo: "Fontes de Recurso", icone: "⚙️", modulo: "config", grupo: "Cadastros" },
  { chave: "tipos-documento", rotulo: "Tipos de Documento", icone: "⚙️", modulo: "config", grupo: "Cadastros" },

  { chave: "licitacoes", rotulo: "Licitações", icone: "📑", modulo: "licitacoes", grupo: "Licitações e Demais Processos" },
  { chave: "despesas", rotulo: "Processos de Despesa", icone: "💰", modulo: "despesas", grupo: "Licitações e Demais Processos" },
  { chave: "legislacao", rotulo: "Legislação", icone: "⚖️", modulo: "legislacao", grupo: "Licitações e Demais Processos" },
  { chave: "documentos-diversos", rotulo: "Documentos Diversos", icone: "📂", modulo: "documentosDiversos", grupo: "Licitações e Demais Processos" },

  { chave: "servidores", rotulo: "Servidores", icone: "👥", modulo: "servidores", grupo: "Recursos Humanos" },
  { chave: "folhas", rotulo: "Folhas", icone: "📋", modulo: "folhas", grupo: "Recursos Humanos" },
  { chave: "processos-pessoal", rotulo: "Processos de Pessoal", icone: "🧑‍💼", modulo: "processosPessoal", grupo: "Recursos Humanos" },
  { chave: "atos-administrativos", rotulo: "Atos Administrativos", icone: "📜", modulo: "atosAdministrativos", grupo: "Recursos Humanos" },
  { chave: "tipos-documento-pessoal", rotulo: "Tipos de Documento de Pessoal", icone: "⚙️", modulo: "config", grupo: "Recursos Humanos" },
  { chave: "tipos-ato-administrativo", rotulo: "Tipos de Ato Administrativo", icone: "⚙️", modulo: "config", grupo: "Recursos Humanos" },

  { chave: "relatorios", rotulo: "Relatórios", icone: "📊", modulo: "relatorios", grupo: "Relatórios" },
  { chave: "relatorios-detalhados", rotulo: "Relatórios Detalhados", icone: "🔎", modulo: "relatorios", grupo: "Relatórios" },

  { chave: "usuarios", rotulo: "Usuários", icone: "👤", modulo: "usuarios", somenteAdmin: true, grupo: "Administração" },
  { chave: "unidades-gestoras", rotulo: "Unidades Gestoras", icone: "🏢", modulo: "unidadesGestoras", somenteAdmin: true, grupo: "Administração" },
  { chave: "manutencao", rotulo: "Manutenção", icone: "🔧", modulo: "manutencao", somenteAdmin: true, grupo: "Administração" },
  { chave: "historico", rotulo: "Histórico", icone: "🕒", modulo: "historico", somenteAdmin: true, grupo: "Administração" },
];

let paginaAtual = "inicio";

// Usado pelos botões de navegação cruzada (ex: "Ver Licitação vinculada"
// dentro de uma Despesa) — guarda qual registro deve abrir
// automaticamente assim que a aba de destino terminar de carregar.
let registroPendenteParaAbrir = null; // { chave, id }
function navegarParaRegistro(chave, id) {
  registroPendenteParaAbrir = { chave, id };
  navegarPara(chave);
}

function montarMenuLateral() {
  const menu = document.getElementById("menu-lateral");
  menu.innerHTML = "";

  let grupoAtual = undefined; // undefined != null, força criar o cabeçalho do primeiro grupo
  let containerGrupoAtual = menu;

  ITENS_MENU.forEach((item) => {
    if (item.somenteAdmin && !usuarioEhAdministrador()) return;
    if (item.modulo === "config" && !usuarioEhAdministrador() && !usuarioPodeEditar()) return;
    if (item.modulo && item.modulo !== "config" && item.chave !== "usuarios" && item.chave !== "unidades-gestoras") {
      if (!usuarioTemAcessoAba(item.modulo)) return;
    }

    if (item.grupo !== grupoAtual) {
      grupoAtual = item.grupo;
      if (grupoAtual) {
        const cabecalho = document.createElement("button");
        cabecalho.type = "button";
        cabecalho.className = "grupo-menu";
        cabecalho.innerHTML = `<span class="seta-grupo-menu">▶</span> ${grupoAtual}`;

        const containerItens = document.createElement("div");
        containerItens.className = "itens-grupo-menu oculto"; // começa recolhido

        cabecalho.addEventListener("click", () => {
          const recolhido = containerItens.classList.toggle("oculto");
          cabecalho.querySelector(".seta-grupo-menu").textContent = recolhido ? "▶" : "▼";
        });

        menu.appendChild(cabecalho);
        menu.appendChild(containerItens);
        containerGrupoAtual = containerItens;
      } else {
        containerGrupoAtual = menu; // itens sem grupo (ex: Início) ficam soltos, fora de qualquer grupo recolhível
      }
    }

    const botao = document.createElement("button");
    botao.className = "item-menu";
    botao.dataset.chave = item.chave;
    botao.innerHTML = `<span class="icone-menu">${item.icone}</span> ${item.rotulo}`;
    botao.addEventListener("click", () => navegarPara(item.chave));
    containerGrupoAtual.appendChild(botao);
  });

  const rodapeVersao = document.createElement("div");
  rodapeVersao.className = "versao-app";
  rodapeVersao.textContent = `SOFT+ Indexação — v${VERSAO_APP}`;
  menu.appendChild(rodapeVersao);

  document.getElementById("versao-app-login").textContent = `v${VERSAO_APP}`;

  navegarPara("inicio");
}

function navegarPara(chave) {
  paginaAtual = chave;

  document.querySelectorAll(".item-menu").forEach((botao) => {
    botao.classList.toggle("item-menu-ativo", botao.dataset.chave === chave);
  });

  // Fecha o menu em telas pequenas depois de navegar
  document.getElementById("menu-lateral").classList.remove("menu-aberto");

  const area = document.getElementById("area-conteudo");
  area.innerHTML = "";

  switch (chave) {
    case "inicio":
      renderizarInicio(area);
      break;
    case "credores":
      renderizarCredores(area);
      break;
    case "licitacoes":
      renderizarLicitacoes(area);
      break;
    case "despesas":
      renderizarDespesas(area);
      break;
    case "legislacao":
      renderizarLegislacao(area);
      break;
    case "documentos-diversos":
      renderizarDocumentosDiversos(area);
      break;
    case "servidores":
      renderizarServidores(area);
      break;
    case "folhas":
      renderizarFolhas(area);
      break;
    case "processos-pessoal":
      renderizarProcessosPessoal(area);
      break;
    case "atos-administrativos":
      renderizarAtosAdministrativos(area);
      break;
    case "relatorios":
      renderizarRelatorios(area);
      break;
    case "relatorios-detalhados":
      renderizarRelatoriosDetalhados(area);
      break;
    case "modalidades-licitacao":
      renderizarCadastroSimples(area, "modalidadesLicitacao", "Modalidade de Licitação");
      break;
    case "unidades-orcamentarias":
      renderizarCadastroSimples(area, "unidadesOrcamentarias", "Unidade Orçamentária", {
        rotulo: "Código", exemplo: "10000", obrigatorio: true,
      });
      break;
    case "fontes-recurso":
      renderizarCadastroSimples(area, "fontesRecurso", "Fonte de Recurso", {
        rotulo: "Código", exemplo: "1.500.0000", obrigatorio: true,
      });
      break;
    case "tipos-documento":
      renderizarCadastroSimples(area, "tiposDocumento", "Tipo de Documento");
      break;
    case "tipos-documento-pessoal":
      renderizarCadastroSimples(area, "tiposDocumentoPessoal", "Tipo de Documento de Pessoal");
      break;
    case "tipos-ato-administrativo":
      renderizarCadastroSimples(area, "tiposAtoAdministrativo", "Tipo de Ato Administrativo");
      break;
    case "usuarios":
      renderizarUsuarios(area);
      break;
    case "unidades-gestoras":
      renderizarUnidadesGestoras(area);
      break;
    case "manutencao":
      renderizarManutencao(area);
      break;
    case "historico":
      renderizarHistorico(area);
      break;
    default:
      area.innerHTML = "<p>Página não encontrada.</p>";
  }
}

async function renderizarInicio(area) {
  const logoEntidade = estado.entidadeAtualDados?.logoBase64;
  area.innerHTML = `
    <div class="cartao-boas-vindas">
      ${logoEntidade ? `<img src="${logoEntidade}" alt="Logo" class="logo-boas-vindas">` : ""}
      <div>
        <h2>Bem-vindo(a), ${estado.dadosUsuario.nome || estado.usuario.email}</h2>
        <p>Unidade gestora atual: <strong>${estado.entidadeAtualNome}</strong></p>
      </div>
    </div>
    <div id="area-dashboard"><p class="texto-secundario" style="margin-top:16px">Calculando resumo do ano...</p></div>
  `;

  // Cada módulo do dashboard só aparece se o usuário tem acesso àquela aba
  const acesso = {
    despesas: usuarioEhAdministrador() || usuarioTemAcessoAba("despesas"),
    licitacoes: usuarioEhAdministrador() || usuarioTemAcessoAba("licitacoes"),
    legislacao: usuarioEhAdministrador() || usuarioTemAcessoAba("legislacao"),
    documentosDiversos: usuarioEhAdministrador() || usuarioTemAcessoAba("documentosDiversos"),
    processosPessoal: usuarioEhAdministrador() || usuarioTemAcessoAba("processosPessoal"),
    atosAdministrativos: usuarioEhAdministrador() || usuarioTemAcessoAba("atosAdministrativos"),
  };

  if (!Object.values(acesso).some(Boolean)) {
    document.getElementById("area-dashboard").innerHTML = `<p class="texto-secundario" style="margin-top:16px">Use o menu ao lado para acessar os cadastros e processos.</p>`;
    return;
  }

  try {
    const [snapshotDespesas, snapshotLicitacoes, snapshotLegislacao, snapshotDocumentos, snapshotPessoal, snapshotAtos] = await Promise.all([
      acesso.despesas ? colecaoEntidade("processosDespesa").get() : null,
      acesso.licitacoes ? colecaoEntidade("licitacoes").get() : null,
      acesso.legislacao ? colecaoEntidade("legislacao").get() : null,
      acesso.documentosDiversos ? colecaoEntidade("documentosDiversos").get() : null,
      acesso.processosPessoal ? colecaoEntidade("processosPessoal").get() : null,
      acesso.atosAdministrativos ? colecaoEntidade("atosAdministrativos").get() : null,
    ]);

    const despesas = snapshotDespesas ? snapshotDespesas.docs.map((doc) => doc.data()) : [];
    const semAnexoDespesas = despesas.filter((d) => !temAnexoGenerico(d)).length;
    const semLicitacao = despesas.filter((d) => !d.licitacaoId && !d.semLicitacaoVinculada).length;

    const pessoal = snapshotPessoal ? snapshotPessoal.docs.map((doc) => doc.data()) : [];
    const semAnexoPessoal = pessoal.filter((p) => !temAnexoGenerico(p)).length;

    const cartoesModulos = [
      acesso.despesas ? { rotulo: "Processos de Despesa", valor: snapshotDespesas.size } : null,
      acesso.licitacoes ? { rotulo: "Licitações", valor: snapshotLicitacoes.size } : null,
      acesso.legislacao ? { rotulo: "Atos de Legislação", valor: snapshotLegislacao.size } : null,
      acesso.documentosDiversos ? { rotulo: "Documentos Diversos", valor: snapshotDocumentos.size } : null,
      acesso.processosPessoal ? { rotulo: "Processos de Pessoal", valor: snapshotPessoal.size } : null,
      acesso.atosAdministrativos ? { rotulo: "Atos Administrativos", valor: snapshotAtos.size } : null,
    ].filter(Boolean);

    const cartoesAtencao = [
      acesso.despesas && semAnexoDespesas > 0
        ? { id: "card-despesas-sem-anexo", cor: "var(--vermelho-erro)", valor: semAnexoDespesas, rotulo: `Despesa(s) sem PDF anexado`, destino: "despesas" }
        : null,
      acesso.despesas && semLicitacao > 0
        ? { id: "card-despesas-sem-licitacao", cor: "var(--amber, #b3790f)", valor: semLicitacao, rotulo: `Despesa(s) sem decisão de licitação`, destino: "despesas" }
        : null,
      acesso.processosPessoal && semAnexoPessoal > 0
        ? { id: "card-pessoal-sem-anexo", cor: "var(--vermelho-erro)", valor: semAnexoPessoal, rotulo: `Processo(s) de Pessoal sem PDF anexado`, destino: "processos-pessoal" }
        : null,
    ].filter(Boolean);

    document.getElementById("area-dashboard").innerHTML = `
      <h3 style="margin-top:20px">Resumo Geral (todos os registros)</h3>
      <div class="grade-resumo">
        ${cartoesModulos.map((c) => `
          <div class="cartao-resumo">
            <div class="numero-resumo num">${c.valor}</div>
            <div class="rotulo-resumo">${c.rotulo}</div>
          </div>`).join("")}
      </div>

      ${
        cartoesAtencao.length > 0
          ? `<h3>Pontos de atenção</h3>
             <div class="grade-resumo">
               ${cartoesAtencao.map((c) => `
                 <div class="cartao-resumo cartao-atencao" id="${c.id}" style="cursor:pointer">
                   <div class="numero-resumo num" style="color:${c.cor}">${c.valor}</div>
                   <div class="rotulo-resumo">${c.rotulo}</div>
                 </div>`).join("")}
             </div>`
          : `<p class="texto-secundario">Nenhum ponto de atenção — tudo com anexo e decisão registrada.</p>`
      }
    `;

    cartoesAtencao.forEach((c) => {
      document.getElementById(c.id)?.addEventListener("click", () => navegarPara(c.destino));
    });
  } catch (erro) {
    console.error(erro);
    document.getElementById("area-dashboard").innerHTML = `<p class="texto-secundario" style="margin-top:16px">Não foi possível calcular o resumo agora. Use o menu ao lado pra acessar os cadastros e processos.</p>`;
  }
}

/** Verifica se um registro tem anexo, com fallback pra registros antigos sem quantidadeAnexos (versão local, sem depender de processos.js) */
function temAnexoGenerico(registro) {
  return (registro.quantidadeAnexos ?? (registro.anexos || []).length) > 0;
}

/**
 * Lê um arquivo de imagem, redimensiona no navegador (mantendo
 * proporção) e devolve como base64 — evita guardar imagens grandes
 * sem necessidade (nunca usamos Firebase Storage nesse app).
 */
function redimensionarImagemParaBase64(arquivo, larguraMaxima = 300) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (eventoLeitor) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, larguraMaxima / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Não foi possível ler essa imagem."));
      img.src = eventoLeitor.target.result;
    };
    leitor.onerror = () => reject(new Error("Não foi possível ler esse arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

// Referência de coleção da entidade atual (atalho usado pelos módulos)
function colecaoEntidade(nomeSubcolecao) {
  return db
    .collection("entidades")
    .doc(estado.entidadeAtual)
    .collection(nomeSubcolecao);
}

// -------------------------------------------------------------
// HISTÓRICO DE ALTERAÇÕES (auditoria)
// -------------------------------------------------------------
const ROTULOS_COLECAO_HISTORICO = {
  credores: "Credor/Fornecedor",
  licitacoes: "Licitação",
  processosDespesa: "Processo de Despesa",
  legislacao: "Legislação",
  documentosDiversos: "Documento Diverso",
  servidores: "Servidor",
  folhas: "Folha",
  processosPessoal: "Processo de Pessoal",
  atosAdministrativos: "Ato Administrativo",
};

/**
 * Grava uma linha no histórico de alterações, pra fins de auditoria —
 * quem mexeu em quê e quando. Não trava a operação principal: se der
 * erro ao gravar o histórico (ex: perda de conexão), só registra no
 * console, não impede o salvamento/exclusão de ter acontecido.
 */
async function registrarHistorico(nomeColecao, documentoId, acao, resumo) {
  try {
    await colecaoEntidade("historico").add({
      colecao: nomeColecao,
      documentoId,
      acao, // 'criar' | 'editar' | 'excluir'
      resumo,
      usuarioEmail: estado.usuario?.email || "desconhecido",
      usuarioNome: estado.dadosUsuario?.nome || "",
      dataHora: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (erro) {
    console.warn("Não foi possível gravar o histórico desta ação:", erro);
  }
}

async function renderizarHistorico(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Histórico de Alterações</h2>
    </div>
    <div class="barra-busca">
      <select id="historico-filtro-colecao" class="filtro-ano">
        <option value="">Todos os tipos</option>
        <option value="credores">Credores/Fornecedores</option>
        <option value="licitacoes">Licitações</option>
        <option value="processosDespesa">Processos de Despesa</option>
        <option value="legislacao">Legislação</option>
        <option value="documentosDiversos">Documentos Diversos</option>
        <option value="servidores">Servidores</option>
        <option value="folhas">Folhas</option>
        <option value="processosPessoal">Processos de Pessoal</option>
        <option value="atosAdministrativos">Atos Administrativos</option>
      </select>
      <select id="historico-filtro-usuario" class="filtro-ano"><option value="">Todos os usuários</option></select>
    </div>
    <div class="barra-busca">
      <div><label class="rotulo-inline">Período — de</label><input type="date" id="historico-filtro-data-de"></div>
      <div><label class="rotulo-inline">até</label><input type="date" id="historico-filtro-data-ate"></div>
      <button type="button" class="botao-secundario" id="historico-btn-limpar">Limpar filtros</button>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("historico").orderBy("dataHora", "desc"));

  // Carrega os usuários pra popular o filtro (só quem tem acesso a esta unidade gestora aparece de fato usado, mas listar todos é suficiente aqui)
  db.collection("usuarios").orderBy("nomeNormalizado").get().then((snapshot) => {
    const seletor = document.getElementById("historico-filtro-usuario");
    snapshot.docs.forEach((doc) => {
      const opcao = document.createElement("option");
      opcao.value = doc.data().email;
      opcao.textContent = doc.data().nome || doc.data().email;
      seletor.appendChild(opcao);
    });
  });

  function formatarDataHora(timestamp) {
    if (!timestamp?.toDate) return "-";
    return timestamp.toDate().toLocaleString("pt-BR");
  }

  const ROTULOS_ACAO = { criar: "✅ Criou", editar: "✏️ Editou", excluir: "🗑️ Excluiu" };

  function criarCartaoHistorico(item) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>${ROTULOS_ACAO[item.acao] || item.acao}</strong> — ${ROTULOS_COLECAO_HISTORICO[item.colecao] || item.colecao}
        <div class="texto-secundario">${escaparHtml(item.resumo || "")}</div>
        <div class="texto-secundario">${item.usuarioNome || item.usuarioEmail} · ${formatarDataHora(item.dataHora)}</div>
      </div>
    `;
    return cartao;
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((item) => lista.appendChild(criarCartaoHistorico(item)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhuma alteração registrada ainda.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  async function aplicarFiltrosHistorico() {
    const colecaoEscolhida = document.getElementById("historico-filtro-colecao").value;
    const usuarioEscolhido = document.getElementById("historico-filtro-usuario").value;
    const dataDe = document.getElementById("historico-filtro-data-de").value;
    const dataAte = document.getElementById("historico-filtro-data-ate").value;

    // Sem período: usa o padrão de paginação normal (com filtro de
    // coleção no servidor, se marcado), e filtra usuário no cliente.
    if (!dataDe && !dataAte) {
      const consultaBase = colecaoEscolhida
        ? colecaoEntidade("historico").where("colecao", "==", colecaoEscolhida).orderBy("dataHora", "desc")
        : colecaoEntidade("historico").orderBy("dataHora", "desc");
      paginador = criarPaginador(consultaBase);
      if (!usuarioEscolhido) {
        carregarPagina(true);
        return;
      }
    }

    // Com período (ou usuário sem período): busca um lote bem maior e
    // filtra tudo no cliente, já que combinar range de data com outros
    // filtros de igualdade pediria índice composto.
    const lista = document.getElementById("lista-registros");
    document.getElementById("btn-carregar-mais").classList.add("oculto");
    lista.innerHTML = `<p class="texto-secundario">Filtrando...</p>`;

    try {
      let consulta = colecaoEntidade("historico").orderBy("dataHora", "desc").limit(2000);
      const snapshot = await consulta.get();
      let registros = snapshot.docs.map((doc) => doc.data());

      if (colecaoEscolhida) registros = registros.filter((r) => r.colecao === colecaoEscolhida);
      if (usuarioEscolhido) registros = registros.filter((r) => r.usuarioEmail === usuarioEscolhido);
      if (dataDe) registros = registros.filter((r) => r.dataHora?.toDate && r.dataHora.toDate() >= new Date(dataDe + "T00:00:00"));
      if (dataAte) registros = registros.filter((r) => r.dataHora?.toDate && r.dataHora.toDate() <= new Date(dataAte + "T23:59:59"));

      lista.innerHTML = "";
      registros.forEach((item) => lista.appendChild(criarCartaoHistorico(item)));
      if (registros.length === 0) lista.innerHTML = `<p class="texto-secundario">Nenhuma alteração encontrada com esses filtros.</p>`;
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  ["historico-filtro-colecao", "historico-filtro-usuario", "historico-filtro-data-de", "historico-filtro-data-ate"].forEach((id) => {
    document.getElementById(id).addEventListener("change", aplicarFiltrosHistorico);
  });
  document.getElementById("historico-btn-limpar").addEventListener("click", () => {
    document.getElementById("historico-filtro-colecao").value = "";
    document.getElementById("historico-filtro-usuario").value = "";
    document.getElementById("historico-filtro-data-de").value = "";
    document.getElementById("historico-filtro-data-ate").value = "";
    paginador = criarPaginador(colecaoEntidade("historico").orderBy("dataHora", "desc"));
    carregarPagina(true);
  });

  carregarPagina(true);
}

