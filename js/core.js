// ===================================================================
// NÚCLEO DO APP — autenticação, permissões, navegação, utilidades
// ===================================================================

// ===================================================================
// VERSÃO DO APP — atualizada a cada entrega, visível no rodapé do menu
// e na tela de login, para facilitar conferir se o navegador já está
// com a versão mais recente (ajuda a identificar problema de cache).
// ===================================================================
const VERSAO_APP = "5.2";
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
  { chave: "historico", rotulo: "Histórico", icone: "🕒", modulo: "historico", somenteAdmin: true },
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
    case "historico":
      renderizarHistorico(area);
      break;
    default:
      area.innerHTML = "<p>Página não encontrada.</p>";
  }
}

async function renderizarInicio(area) {
  area.innerHTML = `
    <div class="cartao-boas-vindas">
      <h2>Bem-vindo(a), ${estado.dadosUsuario.nome || estado.usuario.email}</h2>
      <p>Unidade gestora atual: <strong>${estado.entidadeAtualNome}</strong></p>
    </div>
    <div id="area-dashboard"><p class="texto-secundario" style="margin-top:16px">Calculando resumo do ano...</p></div>
  `;

  if (!usuarioTemAcessoAba("despesas") && !usuarioEhAdministrador()) {
    // Usuário sem acesso a Despesas não precisa do dashboard financeiro
    document.getElementById("area-dashboard").innerHTML = `<p class="texto-secundario" style="margin-top:16px">Use o menu ao lado para acessar os cadastros e processos.</p>`;
    return;
  }

  try {
    const anoAtual = new Date().getFullYear();
    const inicioCompetencia = `${anoAtual}-01`;
    const fimCompetencia = `${anoAtual}-12`;

    const [snapshotDespesas, snapshotLicitacoes, snapshotLegislacao, snapshotDocumentos] = await Promise.all([
      colecaoEntidade("processosDespesa").where("competenciaKey", ">=", inicioCompetencia).where("competenciaKey", "<=", fimCompetencia).get(),
      colecaoEntidade("licitacoes").where("ano", "==", anoAtual).get(),
      colecaoEntidade("legislacao").where("ano", "==", anoAtual).get(),
      colecaoEntidade("documentosDiversos").where("ano", "==", anoAtual).get(),
    ]);

    const despesas = snapshotDespesas.docs.map((doc) => doc.data());
    const totalValor = despesas.reduce((soma, d) => soma + (d.valor || 0), 0);
    const semAnexo = despesas.filter((d) => !temAnexoGenerico(d)).length;
    const semLicitacao = despesas.filter((d) => !d.licitacaoId && !d.semLicitacaoVinculada).length;

    document.getElementById("area-dashboard").innerHTML = `
      <h3 style="margin-top:20px">Resumo de ${anoAtual}</h3>
      <div class="grade-resumo">
        <div class="cartao-resumo">
          <div class="numero-resumo num">${formatarMoeda(totalValor)}</div>
          <div class="rotulo-resumo">Total de Despesas (${despesas.length} processo(s))</div>
        </div>
        <div class="cartao-resumo">
          <div class="numero-resumo num">${snapshotLicitacoes.size}</div>
          <div class="rotulo-resumo">Licitações</div>
        </div>
        <div class="cartao-resumo">
          <div class="numero-resumo num">${snapshotLegislacao.size}</div>
          <div class="rotulo-resumo">Atos de Legislação</div>
        </div>
        <div class="cartao-resumo">
          <div class="numero-resumo num">${snapshotDocumentos.size}</div>
          <div class="rotulo-resumo">Documentos Diversos</div>
        </div>
      </div>

      ${
        semAnexo > 0 || semLicitacao > 0
          ? `<h3>Pontos de atenção</h3>
             <div class="grade-resumo">
               ${semAnexo > 0 ? `
                 <div class="cartao-resumo cartao-atencao" id="card-despesas-sem-anexo" style="cursor:pointer">
                   <div class="numero-resumo num" style="color:var(--vermelho-erro)">${semAnexo}</div>
                   <div class="rotulo-resumo">Despesa(s) de ${anoAtual} sem PDF anexado</div>
                 </div>` : ""}
               ${semLicitacao > 0 ? `
                 <div class="cartao-resumo cartao-atencao" id="card-despesas-sem-licitacao" style="cursor:pointer">
                   <div class="numero-resumo num" style="color:var(--amber, #b3790f)">${semLicitacao}</div>
                   <div class="rotulo-resumo">Despesa(s) de ${anoAtual} sem decisão de licitação</div>
                 </div>` : ""}
             </div>`
          : `<p class="texto-secundario">Nenhum ponto de atenção nas despesas de ${anoAtual} — todas têm anexo e decisão de licitação registrada.</p>`
      }
    `;

    document.getElementById("card-despesas-sem-anexo")?.addEventListener("click", () => navegarPara("despesas"));
    document.getElementById("card-despesas-sem-licitacao")?.addEventListener("click", () => navegarPara("despesas"));
  } catch (erro) {
    console.error(erro);
    document.getElementById("area-dashboard").innerHTML = `<p class="texto-secundario" style="margin-top:16px">Não foi possível calcular o resumo agora. Use o menu ao lado pra acessar os cadastros e processos.</p>`;
  }
}

/** Verifica se um registro tem anexo, com fallback pra registros antigos sem quantidadeAnexos (versão local, sem depender de processos.js) */
function temAnexoGenerico(registro) {
  return (registro.quantidadeAnexos ?? (registro.anexos || []).length) > 0;
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
      </select>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("historico").orderBy("dataHora", "desc"));

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
        <div class="texto-secundario">${item.resumo || ""}</div>
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
  document.getElementById("historico-filtro-colecao").addEventListener("change", (evento) => {
    const colecaoEscolhida = evento.target.value;
    const consulta = colecaoEscolhida
      ? colecaoEntidade("historico").where("colecao", "==", colecaoEscolhida).orderBy("dataHora", "desc")
      : colecaoEntidade("historico").orderBy("dataHora", "desc");
    paginador = criarPaginador(consulta);
    carregarPagina(true);
  });

  carregarPagina(true);
}

