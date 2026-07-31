// ===================================================================
// NÚCLEO DO APP — autenticação, permissões, navegação, utilidades
// ===================================================================

// ===================================================================
// VERSÃO DO APP — atualizada a cada entrega, visível no rodapé do menu
// e na tela de login, para facilitar conferir se o navegador já está
// com a versão mais recente (ajuda a identificar problema de cache).
// ===================================================================
const VERSAO_APP = "4.7";
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
};

// -------------------------------------------------------------
// UTILIDADES GERAIS
// -------------------------------------------------------------

/** Remove acento e caixa alta, para permitir busca "joao" = "João" */
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
  document.getElementById("app-container").classList.remove("oculto");
  document.getElementById("nome-usuario-logado").textContent =
    estado.dadosUsuario.nome || estado.usuario.email;

  await carregarUnidadesGestorasDoUsuario();
  montarMenuLateral();
}

/** Carrega a lista de unidades gestoras que o usuário pode acessar */
async function carregarUnidadesGestorasDoUsuario() {
  const seletor = document.getElementById("seletor-entidade");
  seletor.innerHTML = "";

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

  if (entidades.length === 0) {
    mostrarToast(
      "Nenhuma unidade gestora liberada para este usuário.",
      "erro"
    );
    return;
  }

  entidades.forEach((entidade) => {
    const opcao = document.createElement("option");
    opcao.value = entidade.id;
    opcao.textContent = entidade.nome;
    seletor.appendChild(opcao);
  });

  estado.entidadeAtual = entidades[0].id;
  estado.entidadeAtualNome = entidades[0].nome;

  seletor.addEventListener("change", () => {
    const entidade = entidades.find((e) => e.id === seletor.value);
    estado.entidadeAtual = entidade.id;
    estado.entidadeAtualNome = entidade.nome;
    navegarPara(paginaAtual || "inicio");
  });
}

// -------------------------------------------------------------
// NAVEGAÇÃO ENTRE MÓDULOS (single page, sem reload)
// -------------------------------------------------------------

const ITENS_MENU = [
  { chave: "inicio", rotulo: "Início", icone: "🏠", modulo: null },
  { chave: "credores", rotulo: "Credores/Fornecedores", icone: "🧾", modulo: "credores" },
  { chave: "licitacoes", rotulo: "Licitações", icone: "📑", modulo: "licitacoes" },
  { chave: "despesas", rotulo: "Processos de Despesa", icone: "💰", modulo: "despesas" },
  { chave: "legislacao", rotulo: "Legislação", icone: "⚖️", modulo: "legislacao" },
  { chave: "documentos-diversos", rotulo: "Documentos Diversos", icone: "📂", modulo: "documentosDiversos" },
  { chave: "relatorios", rotulo: "Relatórios", icone: "📊", modulo: "relatorios" },
  { chave: "modalidades-licitacao", rotulo: "Modalidades de Licitação", icone: "⚙️", modulo: "config" },
  { chave: "unidades-orcamentarias", rotulo: "Unidades Orçamentárias", icone: "⚙️", modulo: "config" },
  { chave: "fontes-recurso", rotulo: "Fontes de Recurso", icone: "⚙️", modulo: "config" },
  { chave: "tipos-documento", rotulo: "Tipos de Documento", icone: "⚙️", modulo: "config" },
  { chave: "usuarios", rotulo: "Usuários", icone: "👤", modulo: "usuarios", somenteAdmin: true },
  { chave: "unidades-gestoras", rotulo: "Unidades Gestoras", icone: "🏢", modulo: "unidadesGestoras", somenteAdmin: true },
  { chave: "manutencao", rotulo: "Manutenção", icone: "🔧", modulo: "manutencao", somenteAdmin: true },
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

  ITENS_MENU.forEach((item) => {
    if (item.somenteAdmin && !usuarioEhAdministrador()) return;
    if (item.modulo === "config" && !usuarioEhAdministrador() && !usuarioPodeEditar()) return;
    if (item.modulo && item.modulo !== "config" && item.chave !== "usuarios" && item.chave !== "unidades-gestoras") {
      if (!usuarioTemAcessoAba(item.modulo)) return;
    }

    const botao = document.createElement("button");
    botao.className = "item-menu";
    botao.dataset.chave = item.chave;
    botao.innerHTML = `<span class="icone-menu">${item.icone}</span> ${item.rotulo}`;
    botao.addEventListener("click", () => navegarPara(item.chave));
    menu.appendChild(botao);
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
    case "relatorios":
      renderizarRelatorios(area);
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
    case "usuarios":
      renderizarUsuarios(area);
      break;
    case "unidades-gestoras":
      renderizarUnidadesGestoras(area);
      break;
    case "manutencao":
      renderizarManutencao(area);
      break;
    default:
      area.innerHTML = "<p>Página não encontrada.</p>";
  }
}

function renderizarInicio(area) {
  area.innerHTML = `
    <div class="cartao-boas-vindas">
      <h2>Bem-vindo(a), ${estado.dadosUsuario.nome || estado.usuario.email}</h2>
      <p>Unidade gestora atual: <strong>${estado.entidadeAtualNome}</strong></p>
      <p>Use o menu ao lado para acessar os cadastros e processos.</p>
    </div>
  `;
}

// Referência de coleção da entidade atual (atalho usado pelos módulos)
function colecaoEntidade(nomeSubcolecao) {
  return db
    .collection("entidades")
    .doc(estado.entidadeAtual)
    .collection(nomeSubcolecao);
}
