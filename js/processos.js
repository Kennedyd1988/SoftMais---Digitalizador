// ===================================================================
// MÓDULOS DE PROCESSOS
// ===================================================================

/** Carrega uma lista pequena de cadastro (modalidade, unidade orç., etc.) para popular um <select> */
async function carregarOpcoesSelect(nomeColecao) {
  const snapshot = await colecaoEntidade(nomeColecao).orderBy("nomeNormalizado").limit(500).get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function montarOpcoesHtml(lista, idSelecionado) {
  return lista
    .map((item) => `<option value="${item.id}" ${item.id === idSelecionado ? "selected" : ""}>${item.codigo ? item.codigo + " — " : ""}${item.nome}</option>`)
    .join("");
}

// -------------------------------------------------------------
// LICITAÇÕES
// -------------------------------------------------------------
async function renderizarLicitacoes(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Licitações</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Nova Licitação</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por número, ano ou objeto...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(colecaoEntidade("licitacoes").orderBy("criadoEm", "desc"));
  const modalidades = await carregarOpcoesSelect("modalidadesLicitacao");
  const mapaModalidades = Object.fromEntries(modalidades.map((m) => [m.id, m.nome]));
  const mapaModalidadePorNome = Object.fromEntries(modalidades.map((m) => [normalizarTexto(m.nome), m.id]));

  if (usuarioPodeEditar()) {
    const colunasLicitacoes = [
      { chave: "numero", rotulo: "Número", obrigatorio: true, exemplo: "015" },
      { chave: "ano", rotulo: "Ano", obrigatorio: true, exemplo: new Date().getFullYear() },
      { chave: "modalidade", rotulo: "Modalidade", obrigatorio: true, exemplo: modalidades[0]?.nome || "Pregão Eletrônico", ajuda: "Precisa ser igual ao nome já cadastrado em Modalidades de Licitação." },
      { chave: "objeto", rotulo: "Objeto", obrigatorio: true, exemplo: "Aquisição de material de expediente" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Licitações",
      nomeColecao: "licitacoes",
      colunas: colunasLicitacoes,
      montarDocumento: async (linha) => {
        const numero = (linha["Número"] || "").toString().trim();
        const ano = parseInt(linha["Ano"], 10);
        const objeto = (linha["Objeto"] || "").toString().trim();
        const nomeModalidade = (linha["Modalidade"] || "").toString().trim();
        if (!numero) throw new Error("Número é obrigatório.");
        if (!ano) throw new Error("Ano é obrigatório.");
        if (!objeto) throw new Error("Objeto é obrigatório.");
        const modalidadeId = mapaModalidadePorNome[normalizarTexto(nomeModalidade)];
        if (!modalidadeId) throw new Error(`Modalidade "${nomeModalidade}" não encontrada. Cadastre-a antes de importar.`);
        return {
          numero, ano, modalidadeId, objeto,
          objetoNormalizado: normalizarTexto(objeto),
          anexos: [],
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Número": registro.numero || "",
        "Ano": registro.ano || "",
        "Modalidade": mapaModalidades[registro.modalidadeId] || "",
        "Objeto": registro.objeto || "",
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    const registros = await paginador.carregarProximaPagina();
    registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
    document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>${registro.numero}/${registro.ano}</strong> — ${mapaModalidades[registro.modalidadeId] || "Modalidade não informada"}
        <div class="texto-secundario">${registro.objeto}</div>
        <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
      </div>
      ${
        usuarioPodeEditar()
          ? `<div class="acoes-cartao">
               <button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>
             </div>`
          : ""
      }
    `;
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) =>
      excluirLicitacao(registro, evento.target)
    );
    if (!usuarioPodeEditar()) {
      cartao.classList.add("cartao-clicavel");
      cartao.addEventListener("click", () => abrirFormulario(registro));
    }
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Nova"} Licitação`, `
      <div class="linha-formulario">
        <div>
          <label>Número *</label>
          <input type="text" id="campo-numero" value="${registro?.numero || ""}">
        </div>
        <div>
          <label>Ano *</label>
          <input type="number" id="campo-ano" value="${registro?.ano || new Date().getFullYear()}">
        </div>
      </div>
      <label>Modalidade *</label>
      <select id="campo-modalidade">
        <option value="">Selecione...</option>
        ${montarOpcoesHtml(modalidades, registro?.modalidadeId)}
      </select>
      <label>Objeto *</label>
      <textarea id="campo-objeto" rows="3">${registro?.objeto || ""}</textarea>
      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoNumero = document.getElementById("campo-numero");
      const campoModalidade = document.getElementById("campo-modalidade");
      const campoObjeto = document.getElementById("campo-objeto");
      [campoNumero, campoModalidade, campoObjeto].forEach(limparCampoInvalido);

      let valido = true;
      if (!campoNumero.value.trim()) { marcarCampoInvalido(campoNumero, "Informe o número."); valido = false; }
      if (!campoModalidade.value) { marcarCampoInvalido(campoModalidade, "Selecione a modalidade."); valido = false; }
      if (!campoObjeto.value.trim()) { marcarCampoInvalido(campoObjeto, "Informe o objeto."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          numero: campoNumero.value.trim(),
          ano: parseInt(document.getElementById("campo-ano").value, 10),
          modalidadeId: campoModalidade.value,
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          anexos: controleAnexos.obterAnexos(),
        };
        if (registro) {
          await colecaoEntidade("licitacoes").doc(registro.id).update(dados);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          await colecaoEntidade("licitacoes").add(dados);
        }
        fecharModal();
        mostrarToast("Licitação salva com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    }, registro ? (botao) => excluirLicitacao(registro, botao) : null);

    const controleAnexos = renderizarSecaoAnexos(
      modal.querySelector("#secao-anexos"),
      registro?.anexos,
      "licitacoes",
      () => {}
    );
  }

  async function excluirLicitacao(registro, botaoExcluir) {
    const referenciado = await existeReferenciaPara("licitacoes", registro.id);
    if (referenciado) {
      mostrarToast(
        `Não é possível excluir: esta licitação está vinculada a registros em ${referenciado}.`,
        "erro"
      );
      return;
    }
    if (!confirm(`Excluir a licitação "${registro.numero}/${registro.ano}"? Os anexos também serão removidos do Drive.`)) return;

    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade("licitacoes").doc(registro.id).delete();
      fecharModal();
      mostrarToast("Licitação excluída com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));
  configurarBuscaGenerica("licitacoes", criarCartao, paginador, carregarPagina);

  carregarPagina(true);
}

// -------------------------------------------------------------
// LEGISLAÇÃO e DOCUMENTOS DIVERSOS (mesma estrutura: tipo + número + objeto)
// -------------------------------------------------------------
async function renderizarModuloTipoNumeroObjeto(area, nomeColecao, tituloSingular, tituloPlural) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>${tituloPlural}</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por número ou objeto...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(colecaoEntidade(nomeColecao).orderBy("criadoEm", "desc"));
  const tipos = await carregarOpcoesSelect("tiposDocumento");
  const mapaTipos = Object.fromEntries(tipos.map((t) => [t.id, t.nome]));
  const mapaTipoPorNome = Object.fromEntries(tipos.map((t) => [normalizarTexto(t.nome), t.id]));

  if (usuarioPodeEditar()) {
    const colunasModulo = [
      { chave: "tipo", rotulo: "Tipo", obrigatorio: true, exemplo: tipos[0]?.nome || "Portaria", ajuda: "Precisa ser igual ao nome já cadastrado em Tipos de Documento." },
      { chave: "numero", rotulo: "Número", obrigatorio: true, exemplo: "032/2026" },
      { chave: "objeto", rotulo: "Objeto", obrigatorio: true, exemplo: "Nomeação de servidor" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: tituloPlural,
      nomeColecao,
      colunas: colunasModulo,
      montarDocumento: async (linha) => {
        const nomeTipo = (linha["Tipo"] || "").toString().trim();
        const numero = (linha["Número"] || "").toString().trim();
        const objeto = (linha["Objeto"] || "").toString().trim();
        const tipoId = mapaTipoPorNome[normalizarTexto(nomeTipo)];
        if (!tipoId) throw new Error(`Tipo "${nomeTipo}" não encontrado. Cadastre-o antes de importar.`);
        if (!numero) throw new Error("Número é obrigatório.");
        if (!objeto) throw new Error("Objeto é obrigatório.");
        return {
          tipoId, numero, objeto,
          objetoNormalizado: normalizarTexto(objeto),
          anexos: [],
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Tipo": mapaTipos[registro.tipoId] || "",
        "Número": registro.numero || "",
        "Objeto": registro.objeto || "",
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    const registros = await paginador.carregarProximaPagina();
    registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
    document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>${mapaTipos[registro.tipoId] || "Tipo não informado"} nº ${registro.numero}</strong>
        <div class="texto-secundario">${registro.objeto}</div>
        <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
      </div>
      ${
        usuarioPodeEditar()
          ? `<div class="acoes-cartao">
               <button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>
             </div>`
          : ""
      }
    `;
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) =>
      excluirRegistroModulo(registro, evento.target)
    );
    if (!usuarioPodeEditar()) {
      cartao.classList.add("cartao-clicavel");
      cartao.addEventListener("click", () => abrirFormulario(registro));
    }
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} ${tituloSingular}`, `
      <label>Tipo *</label>
      <select id="campo-tipo">
        <option value="">Selecione...</option>
        ${montarOpcoesHtml(tipos, registro?.tipoId)}
      </select>
      <label>Número *</label>
      <input type="text" id="campo-numero" value="${registro?.numero || ""}">
      <label>Objeto *</label>
      <textarea id="campo-objeto" rows="3">${registro?.objeto || ""}</textarea>
      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoTipo = document.getElementById("campo-tipo");
      const campoNumero = document.getElementById("campo-numero");
      const campoObjeto = document.getElementById("campo-objeto");
      [campoTipo, campoNumero, campoObjeto].forEach(limparCampoInvalido);

      let valido = true;
      if (!campoTipo.value) { marcarCampoInvalido(campoTipo, "Selecione o tipo."); valido = false; }
      if (!campoNumero.value.trim()) { marcarCampoInvalido(campoNumero, "Informe o número."); valido = false; }
      if (!campoObjeto.value.trim()) { marcarCampoInvalido(campoObjeto, "Informe o objeto."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          tipoId: campoTipo.value,
          numero: campoNumero.value.trim(),
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          anexos: controleAnexos.obterAnexos(),
        };
        if (registro) {
          await colecaoEntidade(nomeColecao).doc(registro.id).update(dados);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          await colecaoEntidade(nomeColecao).add(dados);
        }
        fecharModal();
        mostrarToast(`${tituloSingular} salvo com sucesso.`, "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    }, registro ? (botao) => excluirRegistroModulo(registro, botao) : null);

    const controleAnexos = renderizarSecaoAnexos(
      modal.querySelector("#secao-anexos"),
      registro?.anexos,
      nomeColecao,
      () => {}
    );
  }

  async function excluirRegistroModulo(registro, botaoExcluir) {
    if (!confirm(`Excluir este registro (${mapaTipos[registro.tipoId] || ""} nº ${registro.numero})? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade(nomeColecao).doc(registro.id).delete();
      fecharModal();
      mostrarToast(`${tituloSingular} excluído com sucesso.`, "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));
  configurarBuscaGenerica(nomeColecao, criarCartao, paginador, carregarPagina, "objetoNormalizado");

  carregarPagina(true);
}

function renderizarLegislacao(area) {
  renderizarModuloTipoNumeroObjeto(area, "legislacao", "Legislação", "Legislação");
}
function renderizarDocumentosDiversos(area) {
  renderizarModuloTipoNumeroObjeto(area, "documentosDiversos", "Documento", "Documentos Diversos");
}

// -------------------------------------------------------------
// PROCESSOS DE DESPESA
// -------------------------------------------------------------
async function renderizarDespesas(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Processos de Despesa</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo Processo</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por número do empenho ou objeto...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(colecaoEntidade("processosDespesa").orderBy("criadoEm", "desc"));
  const [unidadesOrc, fontesRecurso] = await Promise.all([
    carregarOpcoesSelect("unidadesOrcamentarias"),
    carregarOpcoesSelect("fontesRecurso"),
  ]);

  if (usuarioPodeEditar()) {
    // Carrega credores e licitações por completo só neste momento (ação
    // explícita de configurar importação/exportação, não é carregamento
    // automático de lista — por isso é aceitável trazer tudo de uma vez).
    const [credoresSnapshot, licitacoesSnapshot] = await Promise.all([
      colecaoEntidade("credores").get(),
      colecaoEntidade("licitacoes").get(),
    ]);
    const credoresCompletos = credoresSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    const licitacoesCompletas = licitacoesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    const mapaCredorPorDocumento = Object.fromEntries(
      credoresCompletos.map((c) => [normalizarDocumento(c.documento), c])
    );
    const mapaCredorPorId = Object.fromEntries(credoresCompletos.map((c) => [c.id, c]));
    const mapaUnidadeOrcPorNome = Object.fromEntries(unidadesOrc.map((u) => [normalizarTexto(u.nome), u.id]));
    const mapaUnidadeOrcPorId = Object.fromEntries(unidadesOrc.map((u) => [u.id, u.nome]));
    const mapaFontePorNome = Object.fromEntries(fontesRecurso.map((f) => [normalizarTexto(f.nome), f.id]));
    const mapaFontePorId = Object.fromEntries(fontesRecurso.map((f) => [f.id, f.nome]));
    const mapaLicitacaoPorIdentificador = Object.fromEntries(
      licitacoesCompletas.map((l) => [`${l.numero}/${l.ano}`, l.id])
    );

    const colunasDespesas = [
      { chave: "numeroEmpenho", rotulo: "Número do Empenho", obrigatorio: true, exemplo: "0123/2026" },
      { chave: "ordemPagamento", rotulo: "Ordem de Pagamento", obrigatorio: true, exemplo: "045/2026" },
      { chave: "elementoDespesa", rotulo: "Elemento de Despesa", obrigatorio: true, exemplo: "3.3.90.30.00", ajuda: "Formato: 9.9.99.99.99 (ex: 3.3.90.30.00)." },
      { chave: "documentoCredor", rotulo: "CPF/CNPJ do Credor", obrigatorio: true, exemplo: credoresCompletos[0]?.documento || "12.345.678/0001-90", ajuda: "O credor precisa já estar cadastrado em Credores/Fornecedores." },
      { chave: "unidadeOrcamentaria", rotulo: "Unidade Orçamentária", obrigatorio: true, exemplo: unidadesOrc[0]?.nome || "Secretaria de Administração" },
      { chave: "fonteRecurso", rotulo: "Fonte de Recurso", obrigatorio: true, exemplo: fontesRecurso[0]?.nome || "Recursos Próprios" },
      { chave: "licitacao", rotulo: "Licitação de Origem (número/ano)", obrigatorio: false, exemplo: "", ajuda: "Opcional. Preencha no formato número/ano, ex: 015/2026." },
      { chave: "objeto", rotulo: "Objeto", obrigatorio: true, exemplo: "Pagamento referente ao fornecimento de materiais" },
      { chave: "dataPagamento", rotulo: "Data de Pagamento (dd/mm/aaaa)", obrigatorio: true, exemplo: "15/03/2026" },
      { chave: "valor", rotulo: "Valor", obrigatorio: true, exemplo: "1500.00" },
    ];

    const padraoElementoDespesaImportacao = /^\d\.\d\.\d{2}\.\d{2}\.\d{2}$/;

    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Processos de Despesa",
      nomeColecao: "processosDespesa",
      colunas: colunasDespesas,
      montarDocumento: async (linha) => {
        const numeroEmpenho = (linha["Número do Empenho"] || "").toString().trim();
        if (!numeroEmpenho) throw new Error("Número do Empenho é obrigatório.");

        const ordemPagamento = (linha["Ordem de Pagamento"] || "").toString().trim();
        if (!ordemPagamento) throw new Error("Ordem de Pagamento é obrigatória.");

        const elementoDespesa = (linha["Elemento de Despesa"] || "").toString().trim();
        if (!elementoDespesa) throw new Error("Elemento de Despesa é obrigatório.");
        if (!padraoElementoDespesaImportacao.test(elementoDespesa)) {
          throw new Error(`Elemento de Despesa "${elementoDespesa}" fora do formato esperado (9.9.99.99.99).`);
        }

        const documentoBruto = (linha["CPF/CNPJ do Credor"] || "").toString().trim();
        if (!documentoBruto) throw new Error("CPF/CNPJ do Credor é obrigatório.");
        const credor = mapaCredorPorDocumento[normalizarDocumento(documentoBruto)];
        if (!credor) throw new Error(`Credor com documento "${documentoBruto}" não encontrado.`);

        const nomeUnidadeOrc = (linha["Unidade Orçamentária"] || "").toString().trim();
        const unidadeOrcamentariaId = mapaUnidadeOrcPorNome[normalizarTexto(nomeUnidadeOrc)];
        if (!unidadeOrcamentariaId) throw new Error(`Unidade Orçamentária "${nomeUnidadeOrc}" não encontrada.`);

        const nomeFonte = (linha["Fonte de Recurso"] || "").toString().trim();
        const fonteRecursoId = mapaFontePorNome[normalizarTexto(nomeFonte)];
        if (!fonteRecursoId) throw new Error(`Fonte de Recurso "${nomeFonte}" não encontrada.`);

        const objeto = (linha["Objeto"] || "").toString().trim();
        if (!objeto) throw new Error("Objeto é obrigatório.");

        const dataPagamento = converterDataPlanilhaParaIso(linha["Data de Pagamento (dd/mm/aaaa)"]);
        if (!dataPagamento) throw new Error("Data de Pagamento é obrigatória.");

        const valorTexto = (linha["Valor"] || "").toString().replace(",", ".");
        const valor = parseFloat(valorTexto);
        if (isNaN(valor)) throw new Error("Valor inválido.");

        const identificadorLicitacao = (linha["Licitação de Origem (número/ano)"] || "").toString().trim();
        let licitacaoId = null;
        if (identificadorLicitacao) {
          licitacaoId = mapaLicitacaoPorIdentificador[identificadorLicitacao] || null;
          if (!licitacaoId) throw new Error(`Licitação "${identificadorLicitacao}" não encontrada.`);
        }

        return {
          numeroEmpenho,
          ordemPagamento,
          elementoDespesa,
          credorId: credor.id,
          credorNome: credor.nome,
          unidadeOrcamentariaId,
          fonteRecursoId,
          licitacaoId,
          licitacaoIdentificador: identificadorLicitacao || null,
          objeto,
          objetoNormalizado: normalizarTexto(objeto),
          dataPagamento,
          competenciaKey: dataPagamento.slice(0, 7),
          valor,
          anexos: [],
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Número do Empenho": registro.numeroEmpenho || "",
        "Ordem de Pagamento": registro.ordemPagamento || "",
        "Elemento de Despesa": registro.elementoDespesa || "",
        "CPF/CNPJ do Credor": mapaCredorPorId[registro.credorId]?.documento || "",
        "Unidade Orçamentária": mapaUnidadeOrcPorId[registro.unidadeOrcamentariaId] || "",
        "Fonte de Recurso": mapaFontePorId[registro.fonteRecursoId] || "",
        "Licitação de Origem (número/ano)": registro.licitacaoIdentificador || "",
        "Objeto": registro.objeto || "",
        "Data de Pagamento (dd/mm/aaaa)": formatarData(registro.dataPagamento),
        "Valor": registro.valor || 0,
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    const registros = await paginador.carregarProximaPagina();
    registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
    document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>Empenho ${registro.numeroEmpenho}</strong> — ${registro.credorNome || ""}
        <div class="texto-secundario">${registro.objeto}</div>
        <div class="texto-secundario">${formatarMoeda(registro.valor)} · Pagamento em ${formatarData(registro.dataPagamento)}</div>
        <div class="texto-secundario">Ordem de Pagamento: ${registro.ordemPagamento || "-"} · Elemento: <span class="num">${registro.elementoDespesa || "-"}</span></div>
        <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
      </div>
      ${
        usuarioPodeEditar()
          ? `<div class="acoes-cartao">
               <button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>
             </div>`
          : ""
      }
    `;
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) =>
      excluirDespesa(registro, evento.target)
    );
    if (!usuarioPodeEditar()) {
      cartao.classList.add("cartao-clicavel");
      cartao.addEventListener("click", () => abrirFormulario(registro));
    }
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} Processo de Despesa`, `
      <label>Número do Empenho *</label>
      <input type="text" id="campo-numero-empenho" value="${registro?.numeroEmpenho || ""}">

      <div class="linha-formulario">
        <div>
          <label>Ordem de Pagamento *</label>
          <input type="text" id="campo-ordem-pagamento" value="${registro?.ordemPagamento || ""}">
        </div>
        <div>
          <label>Elemento de Despesa *</label>
          <input type="text" id="campo-elemento-despesa" placeholder="Ex: 3.3.90.30.00" value="${registro?.elementoDespesa || ""}">
        </div>
      </div>

      <label>Credor/Fornecedor *</label>
      <input type="text" id="campo-credor-busca" placeholder="Digite para buscar..." value="${registro?.credorNome || ""}" autocomplete="off">
      <input type="hidden" id="campo-credor-id" value="${registro?.credorId || ""}">
      <div id="resultados-credor" class="lista-autocomplete oculto"></div>

      <div class="linha-formulario">
        <div>
          <label>Unidade Orçamentária *</label>
          <select id="campo-unidade-orc">
            <option value="">Selecione...</option>
            ${montarOpcoesHtml(unidadesOrc, registro?.unidadeOrcamentariaId)}
          </select>
        </div>
        <div>
          <label>Fonte de Recurso *</label>
          <select id="campo-fonte-recurso">
            <option value="">Selecione...</option>
            ${montarOpcoesHtml(fontesRecurso, registro?.fonteRecursoId)}
          </select>
        </div>
      </div>

      <label>Licitação de origem (opcional)</label>
      <input type="text" id="campo-licitacao-busca" placeholder="Digite número/ano para vincular..." value="${registro?.licitacaoIdentificador || ""}" autocomplete="off">
      <input type="hidden" id="campo-licitacao-id" value="${registro?.licitacaoId || ""}">
      <div id="resultados-licitacao" class="lista-autocomplete oculto"></div>

      <label>Objeto *</label>
      <textarea id="campo-objeto" rows="3">${registro?.objeto || ""}</textarea>

      <div class="linha-formulario">
        <div>
          <label>Data do Pagamento *</label>
          <input type="date" id="campo-data-pagamento" value="${registro?.dataPagamento || ""}">
        </div>
        <div>
          <label>Valor (R$) *</label>
          <input type="number" step="0.01" id="campo-valor" value="${registro?.valor || ""}">
        </div>
      </div>

      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoNumeroEmpenho = document.getElementById("campo-numero-empenho");
      const campoOrdemPagamento = document.getElementById("campo-ordem-pagamento");
      const campoElementoDespesa = document.getElementById("campo-elemento-despesa");
      const campoCredorId = document.getElementById("campo-credor-id");
      const campoUnidadeOrc = document.getElementById("campo-unidade-orc");
      const campoFonteRecurso = document.getElementById("campo-fonte-recurso");
      const campoObjeto = document.getElementById("campo-objeto");
      const campoDataPagamento = document.getElementById("campo-data-pagamento");
      const campoValor = document.getElementById("campo-valor");

      [campoNumeroEmpenho, campoOrdemPagamento, campoElementoDespesa, campoUnidadeOrc, campoFonteRecurso, campoObjeto, campoDataPagamento, campoValor]
        .forEach(limparCampoInvalido);

      let valido = true;
      if (!campoNumeroEmpenho.value.trim()) { marcarCampoInvalido(campoNumeroEmpenho, "Informe o número do empenho."); valido = false; }
      if (!campoOrdemPagamento.value.trim()) { marcarCampoInvalido(campoOrdemPagamento, "Informe a ordem de pagamento."); valido = false; }
      const padraoElementoDespesa = /^\d\.\d\.\d{2}\.\d{2}\.\d{2}$/;
      if (!campoElementoDespesa.value.trim()) {
        marcarCampoInvalido(campoElementoDespesa, "Informe o elemento de despesa.");
        valido = false;
      } else if (!padraoElementoDespesa.test(campoElementoDespesa.value.trim())) {
        marcarCampoInvalido(campoElementoDespesa, "Formato esperado: 9.9.99.99.99 (ex: 3.3.90.30.00).");
        valido = false;
      }
      if (!campoCredorId.value) { marcarCampoInvalido(document.getElementById("campo-credor-busca"), "Selecione um credor da lista."); valido = false; }
      if (!campoUnidadeOrc.value) { marcarCampoInvalido(campoUnidadeOrc, "Selecione a unidade orçamentária."); valido = false; }
      if (!campoFonteRecurso.value) { marcarCampoInvalido(campoFonteRecurso, "Selecione a fonte de recurso."); valido = false; }
      if (!campoObjeto.value.trim()) { marcarCampoInvalido(campoObjeto, "Informe o objeto."); valido = false; }
      if (!campoDataPagamento.value) { marcarCampoInvalido(campoDataPagamento, "Informe a data de pagamento."); valido = false; }
      if (!campoValor.value) { marcarCampoInvalido(campoValor, "Informe o valor."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          numeroEmpenho: campoNumeroEmpenho.value.trim(),
          ordemPagamento: campoOrdemPagamento.value.trim(),
          elementoDespesa: campoElementoDespesa.value.trim(),
          credorId: campoCredorId.value,
          credorNome: document.getElementById("campo-credor-busca").value.trim(),
          unidadeOrcamentariaId: campoUnidadeOrc.value,
          fonteRecursoId: campoFonteRecurso.value,
          licitacaoId: document.getElementById("campo-licitacao-id").value || null,
          licitacaoIdentificador: document.getElementById("campo-licitacao-busca").value.trim() || null,
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          dataPagamento: campoDataPagamento.value,
          // competênciaKey guarda o "AAAA-MM" fixo, útil para filtrar por período
          // sem depender de conversão de fuso na data de pagamento em si.
          competenciaKey: campoDataPagamento.value.slice(0, 7),
          valor: parseFloat(campoValor.value),
          anexos: controleAnexos.obterAnexos(),
        };
        if (registro) {
          await colecaoEntidade("processosDespesa").doc(registro.id).update(dados);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          await colecaoEntidade("processosDespesa").add(dados);
        }
        fecharModal();
        mostrarToast("Processo de despesa salvo com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    }, registro ? (botao) => excluirDespesa(registro, botao) : null);

    const controleAnexos = renderizarSecaoAnexos(
      modal.querySelector("#secao-anexos"),
      registro?.anexos,
      "processosDespesa",
      () => {}
    );

    configurarAutocomplete({
      inputBusca: modal.querySelector("#campo-credor-busca"),
      inputId: modal.querySelector("#campo-credor-id"),
      resultadosEl: modal.querySelector("#resultados-credor"),
      buscar: (termo) => buscarRegistrosPorNome("credores", termo),
    });

    configurarAutocomplete({
      inputBusca: modal.querySelector("#campo-licitacao-busca"),
      inputId: modal.querySelector("#campo-licitacao-id"),
      resultadosEl: modal.querySelector("#resultados-licitacao"),
      buscar: (termo) => buscarLicitacoesPorTermo(termo),
      rotulo: (item) => `${item.numero}/${item.ano} — ${item.objeto}`.slice(0, 80),
    });
  }

  async function excluirDespesa(registro, botaoExcluir) {
    if (!confirm(`Excluir o processo de despesa "Empenho ${registro.numeroEmpenho}"? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade("processosDespesa").doc(registro.id).delete();
      fecharModal();
      mostrarToast("Processo de despesa excluído com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));
  configurarBuscaGenerica("processosDespesa", criarCartao, paginador, carregarPagina, "objetoNormalizado");

  carregarPagina(true);
}

async function buscarRegistrosPorNome(nomeColecao, termo) {
  const normalizado = normalizarTexto(termo);
  if (!normalizado) return [];
  const snapshot = await colecaoEntidade(nomeColecao)
    .orderBy("nomeNormalizado")
    .startAt(normalizado)
    .endAt(normalizado + "\uf8ff")
    .limit(10)
    .get();
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function buscarLicitacoesPorTermo(termo) {
  const normalizado = termo.trim();
  if (!normalizado) return [];
  const snapshot = await colecaoEntidade("licitacoes").orderBy("numero").limit(200).get();
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => `${l.numero}/${l.ano}`.includes(normalizado))
    .slice(0, 10);
}

/** Componente simples de busca com resultados em lista (autocomplete) */
function configurarAutocomplete({ inputBusca, inputId, resultadosEl, buscar, rotulo }) {
  let temporizador;
  inputBusca.addEventListener("input", () => {
    inputId.value = ""; // invalida seleção anterior até escolher de novo
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      const resultados = await buscar(inputBusca.value);
      resultadosEl.innerHTML = "";
      if (resultados.length === 0) {
        resultadosEl.classList.add("oculto");
        return;
      }
      resultados.forEach((item) => {
        const linha = document.createElement("div");
        linha.className = "item-autocomplete";
        linha.textContent = rotulo ? rotulo(item) : item.nome;
        linha.addEventListener("click", () => {
          inputBusca.value = rotulo ? rotulo(item) : item.nome;
          inputId.value = item.id;
          resultadosEl.classList.add("oculto");
        });
        resultadosEl.appendChild(linha);
      });
      resultadosEl.classList.remove("oculto");
    }, 300);
  });

  document.addEventListener("click", (evento) => {
    if (!resultadosEl.contains(evento.target) && evento.target !== inputBusca) {
      resultadosEl.classList.add("oculto");
    }
  });
}

/** Liga o campo de busca de uma lista paginada a uma consulta por prefixo normalizado */
function configurarBuscaGenerica(nomeColecao, criarCartao, paginador, carregarPagina, campoNormalizado = "objetoNormalizado") {
  let temporizador;
  document.getElementById("campo-busca").addEventListener("input", (evento) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      const termo = normalizarTexto(evento.target.value);
      const lista = document.getElementById("lista-registros");
      lista.innerHTML = "";
      if (!termo) {
        paginador.reiniciar();
        carregarPagina(true);
        return;
      }
      const snapshot = await colecaoEntidade(nomeColecao)
        .orderBy(campoNormalizado)
        .startAt(termo)
        .endAt(termo + "\uf8ff")
        .limit(TAMANHO_PAGINA)
        .get();
      snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }, 300);
  });
}
