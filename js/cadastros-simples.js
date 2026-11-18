// ===================================================================
// CADASTROS SIMPLES (nome único) — reaproveitado por 4 abas diferentes
// ===================================================================
// Modalidade de Licitação, Unidade Orçamentária, Fonte de Recurso e
// Tipo de Documento têm exatamente a mesma estrutura (só um campo
// "nome"), por isso usam essa mesma função genérica em vez de repetir
// código 4 vezes.

async function renderizarCadastroSimples(area, nomeColecao, rotuloSingular, opcoesCampoCodigo = null) {
  // opcoesCampoCodigo, quando informado, ativa um campo extra "Código"
  // (usado hoje por Unidade Orçamentária e Fonte de Recurso). Formato:
  // { rotulo: "Código", exemplo: "10000", obrigatorio: true }
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>${rotuloSingular}s</h2>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar ${rotuloSingular.toLowerCase()}...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(
    colecaoEntidade(nomeColecao).orderBy("nomeNormalizado")
  );

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartaoSimples(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum registro encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartaoSimples(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro cartao-clicavel";
    cartao.innerHTML = `
      <span>${opcoesCampoCodigo && registro.codigo ? `<span class="num">${registro.codigo}</span> — ` : ""}${registro.nome}</span>
      ${
        usuarioPodeEditar()
          ? `<div class="acoes-cartao">
               <button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>
             </div>`
          : ""
      }
    `;
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirFormulario(registro);
    });
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) => {
      evento.stopPropagation();
      excluirRegistro(registro);
    });
    cartao.addEventListener("click", () => abrirFormulario(registro));
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const nomeAtual = registro?.nome || "";
    const codigoAtual = registro?.codigo || "";
    const modal = criarModal(`${registro ? "Editar" : "Novo"} ${rotuloSingular}`, `
      ${
        opcoesCampoCodigo
          ? `<label>${opcoesCampoCodigo.rotulo} ${opcoesCampoCodigo.obrigatorio ? "*" : ""}</label>
             <input type="text" id="campo-codigo" placeholder="Ex: ${opcoesCampoCodigo.exemplo}" value="${codigoAtual}">`
          : ""
      }
      <label>Nome *</label>
      <input type="text" id="campo-nome" value="${nomeAtual.replace(/"/g, "&quot;")}">
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      const campoCodigo = document.getElementById("campo-codigo");
      limparCampoInvalido(campoNome);
      if (campoCodigo) limparCampoInvalido(campoCodigo);

      const nome = campoNome.value.trim();
      let valido = true;
      if (!nome) {
        marcarCampoInvalido(campoNome, "Informe o nome.");
        valido = false;
      }
      if (opcoesCampoCodigo?.obrigatorio && campoCodigo && !campoCodigo.value.trim()) {
        marcarCampoInvalido(campoCodigo, `Informe o ${opcoesCampoCodigo.rotulo.toLowerCase()}.`);
        valido = false;
      }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = { nome, nomeNormalizado: normalizarTexto(nome) };
        if (campoCodigo) dados.codigo = campoCodigo.value.trim();
        if (registro) {
          await colecaoEntidade(nomeColecao).doc(registro.id).update(dados);
        } else {
          await colecaoEntidade(nomeColecao).add(dados);
        }
        fecharModal();
        mostrarToast(`${rotuloSingular} salvo com sucesso.`, "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    });
  }

  async function excluirRegistro(registro) {
    // Antes de apagar, checa se algum registro de outra coleção referencia este,
    // pra não deixar vínculo quebrado (ex: uma despesa referenciando uma fonte
    // de recurso que não existe mais).
    const referenciado = await existeReferenciaPara(nomeColecao, registro.id);
    if (referenciado) {
      mostrarToast(
        `Não é possível excluir: este registro está sendo usado em outro cadastro (${referenciado}).`,
        "erro"
      );
      return;
    }
    if (!confirm(`Excluir "${registro.nome}"?`)) return;
    await colecaoEntidade(nomeColecao).doc(registro.id).delete();
    mostrarToast("Excluído com sucesso.", "sucesso");
    paginador.reiniciar();
    carregarPagina(true);
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  let temporizadorBusca;
  document.getElementById("campo-busca").addEventListener("input", (evento) => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(async () => {
      const termo = normalizarTexto(evento.target.value);
      const lista = document.getElementById("lista-registros");
      lista.innerHTML = "";
      if (!termo) {
        paginador.reiniciar();
        carregarPagina(true);
        return;
      }
      try {
        const snapshot = await colecaoEntidade(nomeColecao)
          .orderBy("nomeNormalizado")
          .startAt(termo)
          .endAt(termo + "\uf8ff")
          .limit(TAMANHO_PAGINA)
          .get();
        snapshot.docs.forEach((doc) =>
          lista.appendChild(criarCartaoSimples({ id: doc.id, ...doc.data() }))
        );
        if (snapshot.empty) {
          lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
        }
        document.getElementById("btn-carregar-mais").classList.add("oculto");
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  carregarPagina(true);
}

/**
 * Checa referências antes de excluir um registro de apoio (ex: modalidade
 * de licitação), evitando deixar dado órfão. Mapa manual das dependências
 * conhecidas do sistema.
 */
const MAPA_REFERENCIAS = {
  modalidadesLicitacao: [{ colecao: "licitacoes", campo: "modalidadeId", rotulo: "Licitações" }],
  unidadesOrcamentarias: [{ colecao: "processosDespesa", campo: "unidadeOrcamentariaId", rotulo: "Processos de Despesa" }],
  fontesRecurso: [{ colecao: "processosDespesa", campo: "fonteRecursoId", rotulo: "Processos de Despesa" }],
  tiposDocumento: [
    { colecao: "legislacao", campo: "tipoId", rotulo: "Legislação" },
    { colecao: "documentosDiversos", campo: "tipoId", rotulo: "Documentos Diversos" },
  ],
  credores: [{ colecao: "processosDespesa", campo: "credorId", rotulo: "Processos de Despesa" }],
  licitacoes: [{ colecao: "processosDespesa", campo: "licitacaoId", rotulo: "Processos de Despesa" }],
};

async function existeReferenciaPara(nomeColecao, id) {
  const referencias = MAPA_REFERENCIAS[nomeColecao] || [];
  for (const referencia of referencias) {
    const snapshot = await colecaoEntidade(referencia.colecao)
      .where(referencia.campo, "==", id)
      .limit(1)
      .get();
    if (!snapshot.empty) return referencia.rotulo;
  }
  return null;
}

// ===================================================================
// CREDORES / FORNECEDORES (PF e PJ)
// ===================================================================

async function renderizarCredores(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Credores / Fornecedores</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por nome ou CPF/CNPJ...">
    </div>
    <!-- Padrão SOFT+: lista em tabela, como no painel do Portal PNTP. -->
    <div class="tabela-caixa">
      <table class="tabela tabela-credores">
        <thead>
          <tr><th>Nome / Razão social</th><th>Tipo</th><th>CPF/CNPJ</th><th>Contato</th>${usuarioPodeEditar() ? `<th class="acoes">Ações</th>` : ""}</tr>
        </thead>
        <tbody id="lista-registros"></tbody>
      </table>
    </div>
    <button id="btn-carregar-mais" class="botao-secundario botao-carregar-mais oculto">Carregar mais</button>
  `;
  const colunasTabela = usuarioPodeEditar() ? 5 : 4;
  const linhaVazia = (texto) => `<tr><td colspan="${colunasTabela}" class="texto-secundario linha-vazia">${texto}</td></tr>`;

  const paginador = criarPaginador(colecaoEntidade("credores").orderBy("nomeNormalizado"));

  if (usuarioPodeEditar()) {
    const colunasCredores = [
      { chave: "tipo", rotulo: "Tipo (PF ou PJ)", obrigatorio: true, exemplo: "PJ", ajuda: "Digite exatamente PF ou PJ." },
      { chave: "nome", rotulo: "Nome/Razão Social", obrigatorio: true, exemplo: "Construtora Exemplo LTDA" },
      { chave: "documento", rotulo: "CPF/CNPJ", obrigatorio: true, exemplo: "12.345.678/0001-90" },
      { chave: "telefone", rotulo: "Telefone", obrigatorio: false, exemplo: "(84) 99999-0000" },
      { chave: "email", rotulo: "E-mail", obrigatorio: false, exemplo: "contato@exemplo.com" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Credores",
      nomeColecao: "credores",
      colunas: colunasCredores,
      montarDocumento: async (linha) => {
        const nome = (linha["Nome/Razão Social"] || "").toString().trim();
        const documento = (linha["CPF/CNPJ"] || "").toString().trim();
        if (!nome) throw new Error("Nome/Razão Social é obrigatório.");
        if (!documento) throw new Error("CPF/CNPJ é obrigatório.");
        const tipoBruto = (linha["Tipo (PF ou PJ)"] || "").toString().trim().toUpperCase();
        return {
          tipo: tipoBruto === "PF" ? "PF" : "PJ",
          nome,
          nomeNormalizado: normalizarTexto(nome),
          documento,
          telefone: (linha["Telefone"] || "").toString().trim(),
          email: (linha["E-mail"] || "").toString().trim(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Tipo (PF ou PJ)": registro.tipo || "",
        "Nome/Razão Social": registro.nome || "",
        "CPF/CNPJ": registro.documento || "",
        "Telefone": registro.telefone || "",
        "E-mail": registro.email || "",
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartaoCredor(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = linhaVazia("Nenhum registro encontrado.");
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartaoCredor(registro) {
    // Agora devolve uma linha de tabela (mantido o nome da função para não
    // mexer nas chamadas). Texto livre sempre passa por escaparHtml.
    const contato = [registro.telefone, registro.email].filter(Boolean).map(escaparHtml).join(" · ");
    const linha = document.createElement("tr");
    linha.className = "linha-clicavel";
    linha.innerHTML = `
      <td><strong>${escaparHtml(registro.nome)}</strong></td>
      <td><span class="etiqueta">${registro.tipo === "PJ" ? "Pessoa jurídica" : "Pessoa física"}</span></td>
      <td class="num">${escaparHtml(registro.documento)}</td>
      <td class="texto-contato">${contato || "—"}</td>
      ${
        usuarioPodeEditar()
          ? `<td class="acoes">
               <button class="botao-secundario botao-pequeno" data-acao="editar">Editar</button>
               <button class="botao-perigo botao-pequeno" data-acao="excluir">Excluir</button>
             </td>`
          : ""
      }
    `;
    linha.querySelector('[data-acao="editar"]')?.addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirFormulario(registro);
    });
    linha.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) => {
      evento.stopPropagation();
      excluirCredor(registro);
    });
    linha.addEventListener("click", () => abrirFormulario(registro));
    return linha;
  }

  // Máscara de CPF/CNPJ. Só formata na digitação; o valor salvo segue o que
  // o usuário vê, como já era antes (cadastros antigos sem máscara continuam
  // abrindo normalmente e não são bloqueados).
  function mascararDocumento(valor, tipo) {
    const d = String(valor).replace(/\D/g, "").slice(0, tipo === "PJ" ? 14 : 11);
    if (tipo === "PJ") {
      return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
    }
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} Credor/Fornecedor`, `
      <div class="grade-form">
        <div class="campo-form">
          <label for="campo-tipo">Tipo *</label>
          <select id="campo-tipo">
            <option value="PF" ${registro?.tipo === "PF" ? "selected" : ""}>Pessoa Física</option>
            <option value="PJ" ${registro?.tipo === "PJ" ? "selected" : ""}>Pessoa Jurídica</option>
          </select>
        </div>
        <div class="campo-form">
          <label for="campo-documento" id="rotulo-documento">CPF *</label>
          <input type="text" id="campo-documento" inputmode="numeric" value="${escaparHtml(registro?.documento || "")}">
        </div>
        <div class="campo-form span-2">
          <label for="campo-nome" id="rotulo-nome">Nome *</label>
          <input type="text" id="campo-nome" value="${escaparHtml(registro?.nome || "")}">
        </div>
        <div class="campo-form">
          <label for="campo-telefone">Telefone</label>
          <input type="text" id="campo-telefone" inputmode="tel" placeholder="(00) 00000-0000" value="${escaparHtml(registro?.telefone || "")}">
        </div>
        <div class="campo-form">
          <label for="campo-email">E-mail</label>
          <input type="text" id="campo-email" inputmode="email" placeholder="contato@exemplo.com.br" value="${escaparHtml(registro?.email || "")}">
        </div>
      </div>
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      const campoDocumento = document.getElementById("campo-documento");
      limparCampoInvalido(campoNome);
      limparCampoInvalido(campoDocumento);

      const nome = campoNome.value.trim();
      const documento = campoDocumento.value.trim();
      let valido = true;
      if (!nome) {
        marcarCampoInvalido(campoNome, "Informe o nome.");
        valido = false;
      }
      if (!documento) {
        marcarCampoInvalido(campoDocumento, "Informe o documento.");
        valido = false;
      }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          tipo: document.getElementById("campo-tipo").value,
          nome,
          nomeNormalizado: normalizarTexto(nome),
          documento,
          telefone: document.getElementById("campo-telefone").value.trim(),
          email: document.getElementById("campo-email").value.trim(),
        };
        if (registro) {
          const nomeMudou = registro.nome !== dados.nome;
          await colecaoEntidade("credores").doc(registro.id).update(dados);
          await registrarHistorico("credores", registro.id, "editar", `Credor "${dados.nome}" editado.`);
          if (nomeMudou) {
            await sincronizarCredorEmDespesas(registro.id, dados.nome, dados.nomeNormalizado);
          }
        } else {
          const referenciaNova = await colecaoEntidade("credores").add(dados);
          await registrarHistorico("credores", referenciaNova.id, "criar", `Credor "${dados.nome}" criado.`);
        }
        fecharModal();
        mostrarToast("Credor salvo com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    });

    // Rótulo e máscara acompanham o tipo escolhido (CPF para pessoa física,
    // CNPJ e razão social para jurídica).
    const campoTipo = document.getElementById("campo-tipo");
    const campoDocumento = document.getElementById("campo-documento");
    const ajustarPorTipo = (reformatar) => {
      const pj = campoTipo.value === "PJ";
      document.getElementById("rotulo-documento").textContent = pj ? "CNPJ *" : "CPF *";
      document.getElementById("rotulo-nome").textContent = pj ? "Razão social *" : "Nome *";
      campoDocumento.placeholder = pj ? "00.000.000/0000-00" : "000.000.000-00";
      if (reformatar) campoDocumento.value = mascararDocumento(campoDocumento.value, campoTipo.value);
    };
    campoTipo.addEventListener("change", () => ajustarPorTipo(true));
    campoDocumento.addEventListener("input", () => {
      campoDocumento.value = mascararDocumento(campoDocumento.value, campoTipo.value);
    });
    ajustarPorTipo(false); // na edição não mexe no documento já salvo
  }

  async function excluirCredor(registro) {
    const referenciado = await existeReferenciaPara("credores", registro.id);
    if (referenciado) {
      mostrarToast(
        `Não é possível excluir: este credor está vinculado a registros em ${referenciado}.`,
        "erro"
      );
      return;
    }
    if (!confirm(`Excluir "${registro.nome}"?`)) return;
    await colecaoEntidade("credores").doc(registro.id).delete();
    await registrarHistorico("credores", registro.id, "excluir", `Credor "${registro.nome}" excluído.`);
    mostrarToast("Excluído com sucesso.", "sucesso");
    paginador.reiniciar();
    carregarPagina(true);
  }

  /**
   * Quando o nome de um credor muda, o nome que fica copiado nas
   * despesas vinculadas (usado por conveniência de exibição/busca) fica
   * desatualizado. Pergunta se quer sincronizar.
   */
  async function sincronizarCredorEmDespesas(credorId, nomeNovo, nomeNormalizadoNovo) {
    const snapshot = await colecaoEntidade("processosDespesa").where("credorId", "==", credorId).get();
    if (snapshot.empty) return;
    if (!confirm(`O nome desse credor mudou, e ele está vinculado a ${snapshot.size} despesa(s). Atualizar o nome exibido nelas também?`)) return;
    const lote = db.batch();
    snapshot.docs.forEach((doc) => lote.update(doc.ref, { credorNome: nomeNovo, credorNomeNormalizado: nomeNormalizadoNovo }));
    await lote.commit();
    mostrarToast(`${snapshot.size} despesa(s) atualizada(s) com o novo nome do credor.`, "sucesso");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  let temporizadorBusca;
  document.getElementById("campo-busca").addEventListener("input", (evento) => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(async () => {
      const termo = normalizarTexto(evento.target.value);
      const lista = document.getElementById("lista-registros");
      lista.innerHTML = "";
      if (!termo) {
        paginador.reiniciar();
        carregarPagina(true);
        return;
      }
      try {
        const snapshot = await colecaoEntidade("credores")
          .orderBy("nomeNormalizado")
          .startAt(termo)
          .endAt(termo + "\uf8ff")
          .limit(TAMANHO_PAGINA)
          .get();
        snapshot.docs.forEach((doc) => lista.appendChild(criarCartaoCredor({ id: doc.id, ...doc.data() })));
        if (snapshot.empty) {
          lista.innerHTML = linhaVazia("Nenhum resultado encontrado.");
        }
        document.getElementById("btn-carregar-mais").classList.add("oculto");
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  carregarPagina(true);
}

// ===================================================================
// MODAL GENÉRICO (usado por todos os formulários do app)
// ===================================================================
function criarModal(titulo, corpoHtml, aoSalvar, aoExcluir = null) {
  const podeEditar = usuarioPodeEditar();
  const fundo = document.createElement("div");
  fundo.className = "fundo-modal";
  fundo.id = "fundo-modal-ativo";
  fundo.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>${titulo}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-modal">✕</button>
      </div>
      <div class="corpo-modal">${corpoHtml}</div>
      <div class="rodape-modal">
        ${aoExcluir && podeEditar ? `<button class="botao-perigo" id="btn-excluir-modal">Excluir</button>` : ""}
        <div class="rodape-modal-direita">
          <button class="botao-secundario" id="btn-cancelar-modal">${podeEditar ? "Cancelar" : "Fechar"}</button>
          ${podeEditar ? `<button class="botao-primario" id="btn-salvar-modal">Salvar</button>` : ""}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(fundo);
  document.getElementById("btn-fechar-modal").addEventListener("click", fecharModal);
  document.getElementById("btn-cancelar-modal").addEventListener("click", fecharModal);
  if (podeEditar) {
    document.getElementById("btn-salvar-modal").addEventListener("click", (evento) =>
      aoSalvar(evento.target)
    );
    if (aoExcluir) {
      document.getElementById("btn-excluir-modal").addEventListener("click", (evento) =>
        aoExcluir(evento.target)
      );
    }
  } else {
    // Modo somente leitura: trava todos os campos do formulário (menos
    // os que já são inerentemente de busca/ação, como campo de anexo,
    // que já vem escondido nesse modo)
    fundo.querySelectorAll(".corpo-modal input, .corpo-modal select, .corpo-modal textarea").forEach((campo) => {
      campo.disabled = true;
    });
  }
  return fundo;
}

function fecharModal() {
  document.getElementById("fundo-modal-ativo")?.remove();
}
