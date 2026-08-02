// ===================================================================
// MÓDULO DE RH: Servidores, Folhas, Processos de Pessoal e
// Processos de Ato Administrativo
// ===================================================================

// -------------------------------------------------------------
// SERVIDORES
// -------------------------------------------------------------
async function renderizarServidores(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Servidores</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo Servidor</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por nome ou matrícula...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(colecaoEntidade("servidores").orderBy("nomeNormalizado"));

  if (usuarioPodeEditar()) {
    const colunasServidores = [
      { chave: "nome", rotulo: "Nome do Servidor", obrigatorio: true, exemplo: "Fulano de Tal" },
      { chave: "matricula", rotulo: "Matrícula", obrigatorio: false, exemplo: "12345" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Servidores",
      nomeColecao: "servidores",
      colunas: colunasServidores,
      montarDocumento: async (linha) => {
        const nome = (linha["Nome do Servidor"] || "").toString().trim();
        if (!nome) throw new Error("Nome do Servidor é obrigatório.");
        return {
          nome,
          nomeNormalizado: normalizarTexto(nome),
          matricula: (linha["Matrícula"] || "").toString().trim(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Nome do Servidor": registro.nome || "",
        "Matrícula": registro.matricula || "",
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum registro encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>${registro.nome}</strong>
        ${registro.matricula ? `<div class="texto-secundario">Matrícula: ${registro.matricula}</div>` : ""}
      </div>
      <div class="acoes-cartao">
        <button class="botao-icone" data-acao="ver-vinculados" title="Ver Processos Vinculados">🔗</button>
        ${
          usuarioPodeEditar()
            ? `<button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>`
            : ""
        }
      </div>
    `;
    cartao.querySelector('[data-acao="ver-vinculados"]').addEventListener("click", (evento) =>
      abrirModalVinculadosServidor(registro, evento.currentTarget)
    );
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", () => excluirServidor(registro));
    return cartao;
  }

  function abrirFormulario(registro = null) {
    criarModal(`${registro ? "Editar" : "Novo"} Servidor`, `
      <label>Nome do Servidor *</label>
      <input type="text" id="campo-nome" value="${(registro?.nome || "").replace(/"/g, "&quot;")}">
      <label>Matrícula</label>
      <input type="text" id="campo-matricula" value="${registro?.matricula || ""}">
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      limparCampoInvalido(campoNome);
      const nome = campoNome.value.trim();
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); return; }

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          nome,
          nomeNormalizado: normalizarTexto(nome),
          matricula: document.getElementById("campo-matricula").value.trim(),
        };
        if (registro) {
          await colecaoEntidade("servidores").doc(registro.id).update(dados);
          await registrarHistorico("servidores", registro.id, "editar", `Servidor "${nome}" editado.`);
        } else {
          const refNova = await colecaoEntidade("servidores").add(dados);
          await registrarHistorico("servidores", refNova.id, "criar", `Servidor "${nome}" criado.`);
        }
        fecharModal();
        mostrarToast("Servidor salvo com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    });
  }

  async function excluirServidor(registro) {
    if (!confirm(`Excluir "${registro.nome}"? Isso não remove os processos já vinculados a ele, só o cadastro do servidor.`)) return;
    await colecaoEntidade("servidores").doc(registro.id).delete();
    await registrarHistorico("servidores", registro.id, "excluir", `Servidor "${registro.nome}" excluído.`);
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
        const snapshot = await colecaoEntidade("servidores")
          .orderBy("nomeNormalizado")
          .startAt(termo)
          .endAt(termo + "\uf8ff")
          .limit(TAMANHO_PAGINA)
          .get();
        snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
        if (snapshot.empty) lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
        document.getElementById("btn-carregar-mais").classList.add("oculto");
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  carregarPagina(true);
}

// -------------------------------------------------------------
// FOLHAS (agrupam vários servidores, pra vincular numa Despesa de uma vez)
// -------------------------------------------------------------
async function renderizarFolhas(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Folhas</h2>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Nova Folha</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por nome...">
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  const paginador = criarPaginador(colecaoEntidade("folhas").orderBy("nomeNormalizado"));

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum registro encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div>
        <strong>${registro.nome}</strong>
        <div class="texto-secundario">${(registro.servidoresIds || []).length} servidor(es)</div>
      </div>
      <div class="acoes-cartao">
        <button class="botao-icone" data-acao="ver-despesas" title="Ver Despesas Vinculadas">🔗</button>
        ${
          usuarioPodeEditar()
            ? `<button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>`
            : ""
        }
      </div>
    `;
    cartao.querySelector('[data-acao="ver-despesas"]').addEventListener("click", (evento) =>
      abrirModalDespesasDaFolha(registro, evento.currentTarget)
    );
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", () => excluirFolha(registro));
    return cartao;
  }

  async function abrirFormulario(registro = null) {
    const servidores = await carregarOpcoesSelect("servidores");
    const selecionadosAtuais = new Set(registro?.servidoresIds || []);

    criarModal(`${registro ? "Editar" : "Nova"} Folha`, `
      <label>Nome da Folha *</label>
      <input type="text" id="campo-nome" value="${(registro?.nome || "").replace(/"/g, "&quot;")}" placeholder="Ex: Folha da Educação">
      <label>Servidores desta Folha</label>
      <input type="text" id="campo-busca-servidor-folha" placeholder="Digite pra buscar e marcar servidores...">
      <div class="lista-checkboxes" id="lista-servidores-folha" style="max-height:260px; margin-top:8px">
        ${servidores.map((s) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${s.id}" ${selecionadosAtuais.has(s.id) ? "checked" : ""}>
            ${s.nome}
          </label>
        `).join("")}
      </div>
      <p class="texto-secundario" id="contagem-servidores-folha" style="margin-top:4px">${selecionadosAtuais.size} servidor(es) marcado(s).</p>
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      limparCampoInvalido(campoNome);
      const nome = campoNome.value.trim();
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); return; }

      await executarComFeedback(botaoSalvar, async () => {
        const checkboxesMarcados = [...document.querySelectorAll("#lista-servidores-folha input:checked")];
        const servidoresIds = checkboxesMarcados.map((c) => c.value);
        const servidoresNomes = servidoresIds.map((id) => servidores.find((s) => s.id === id)?.nome).filter(Boolean);

        const dados = {
          nome,
          nomeNormalizado: normalizarTexto(nome),
          servidoresIds,
          servidoresNomes,
        };
        if (registro) {
          await colecaoEntidade("folhas").doc(registro.id).update(dados);
          await registrarHistorico("folhas", registro.id, "editar", `Folha "${nome}" editada (${servidoresIds.length} servidor(es)).`);
        } else {
          const refNova = await colecaoEntidade("folhas").add(dados);
          await registrarHistorico("folhas", refNova.id, "criar", `Folha "${nome}" criada (${servidoresIds.length} servidor(es)).`);
        }
        fecharModal();
        mostrarToast("Folha salva com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    });

    // Filtro rápido dentro da lista de checkboxes (não precisa ir ao banco de novo, já tem tudo carregado)
    document.getElementById("campo-busca-servidor-folha").addEventListener("input", (evento) => {
      const termo = normalizarTexto(evento.target.value);
      document.querySelectorAll("#lista-servidores-folha .item-checkbox").forEach((label) => {
        label.classList.toggle("oculto", termo && !normalizarTexto(label.textContent).includes(termo));
      });
    });
    document.getElementById("lista-servidores-folha").addEventListener("change", () => {
      const total = document.querySelectorAll("#lista-servidores-folha input:checked").length;
      document.getElementById("contagem-servidores-folha").textContent = `${total} servidor(es) marcado(s).`;
    });
  }

  async function excluirFolha(registro) {
    const snapshot = await colecaoEntidade("processosDespesa").where("folhaId", "==", registro.id).limit(1).get();
    if (!snapshot.empty) {
      mostrarToast("Não é possível excluir: esta folha está vinculada a algum Processo de Despesa.", "erro");
      return;
    }
    if (!confirm(`Excluir a folha "${registro.nome}"?`)) return;
    await colecaoEntidade("folhas").doc(registro.id).delete();
    await registrarHistorico("folhas", registro.id, "excluir", `Folha "${registro.nome}" excluída.`);
    mostrarToast("Excluída com sucesso.", "sucesso");
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
        const snapshot = await colecaoEntidade("folhas")
          .orderBy("nomeNormalizado")
          .startAt(termo)
          .endAt(termo + "\uf8ff")
          .limit(TAMANHO_PAGINA)
          .get();
        snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
        if (snapshot.empty) lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
        document.getElementById("btn-carregar-mais").classList.add("oculto");
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  carregarPagina(true);
}

/** Modal "de espiada" com os Processos de Despesa vinculados a uma Folha */
async function abrirModalDespesasDaFolha(folha, botaoOrigem) {
  let despesas = [];
  try {
    const carregar = async () => {
      const snapshot = await colecaoEntidade("processosDespesa").where("folhaId", "==", folha.id).orderBy("criadoEm", "desc").get();
      despesas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    };
    if (botaoOrigem) await executarComFeedback(botaoOrigem, carregar, "Carregando...");
    else await carregar();
  } catch (erro) {
    tratarErroConsultaFirestore(erro);
    return;
  }

  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>Despesas vinculadas — Folha ${folha.nome}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-despesas-folha">✕</button>
      </div>
      <div class="corpo-modal">
        <p class="texto-secundario">${(folha.servidoresIds || []).length} servidor(es) nesta folha · ${despesas.length} processo(s) de despesa vinculado(s).</p>
        ${
          despesas.length === 0
            ? `<p class="texto-secundario">Nenhum processo de despesa vinculado ainda.</p>`
            : despesas.map((d) => `
                <div class="cartao-registro linha-vinculado-servidor" data-id="${d.id}" style="cursor:pointer">
                  <div><strong>Empenho ${d.numeroEmpenho}</strong> — ${d.credorNome || ""}<div class="texto-secundario">${formatarMoeda(d.valor)}</div></div>
                </div>`).join("")
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#btn-fechar-despesas-folha").addEventListener("click", () => modal.remove());
  modal.querySelectorAll(".linha-vinculado-servidor").forEach((linha) => {
    linha.addEventListener("click", () => {
      const id = linha.dataset.id;
      modal.remove();
      navegarParaRegistro("despesas", id);
    });
  });
}

// -------------------------------------------------------------
// PROCESSOS DE PESSOAL (documento individual de UM servidor)
// -------------------------------------------------------------
async function renderizarProcessosPessoal(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Processos de Pessoal</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo Processo</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por servidor, tipo ou observações...">
      <select id="filtro-ano" class="filtro-ano">${gerarOpcoesAno()}</select>
      <button type="button" class="botao-secundario" id="btn-filtro-sem-anexo">📋 Sem anexo</button>
      <button type="button" class="botao-secundario" id="btn-filtro-com-anexo">📎 Com anexo</button>
      <button type="button" class="botao-secundario" id="btn-selecionar-todos">☑️ Selecionar todos</button>
    </div>
    ${htmlBarraSelecaoExportacao()}
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("processosPessoal").orderBy("criadoEm", "desc"));
  const gerenciadorSelecao = criarGerenciadorSelecao("processos-pessoal");
  gerenciadorSelecao.ligarBotoes();
  const tipos = await carregarOpcoesSelect("tiposDocumentoPessoal");

  if (usuarioPodeEditar()) {
    const colunas = [
      { chave: "tipo", rotulo: "Tipo de Documento", obrigatorio: true, exemplo: tipos[0]?.nome || "Atestado Médico" },
      { chave: "servidor", rotulo: "Nome do Servidor", obrigatorio: false, exemplo: "Fulano de Tal", ajuda: "Deixe em branco se o processo não for de um servidor específico. O servidor precisa já estar cadastrado." },
      { chave: "competencia", rotulo: "Competência (mm/aaaa)", obrigatorio: false, exemplo: "03/2026" },
      { chave: "exercicio", rotulo: "Exercício", obrigatorio: true, exemplo: new Date().getFullYear() },
      { chave: "observacoes", rotulo: "Observações", obrigatorio: false, exemplo: "" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Processos de Pessoal",
      nomeColecao: "processosPessoal",
      colunas,
      montarDocumento: async (linha) => {
        const nomeTipo = (linha["Tipo de Documento"] || "").toString().trim();
        const tipo = tipos.find((t) => normalizarTexto(t.nome) === normalizarTexto(nomeTipo));
        if (!tipo) throw new Error(`Tipo "${nomeTipo}" não encontrado. Cadastre-o antes de importar.`);
        const exercicio = parseInt(linha["Exercício"], 10);
        if (!exercicio) throw new Error("Exercício é obrigatório.");

        const nomeServidor = (linha["Nome do Servidor"] || "").toString().trim();
        let servidor = null;
        if (nomeServidor) {
          const snap = await colecaoEntidade("servidores").where("nomeNormalizado", "==", normalizarTexto(nomeServidor)).limit(1).get();
          if (snap.empty) throw new Error(`Servidor "${nomeServidor}" não encontrado.`);
          servidor = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        const competenciaTexto = (linha["Competência (mm/aaaa)"] || "").toString().trim();
        const competencia = /^\d{2}\/\d{4}$/.test(competenciaTexto)
          ? `${competenciaTexto.split("/")[1]}-${competenciaTexto.split("/")[0]}`
          : "";

        const observacoes = (linha["Observações"] || "").toString().trim();

        return {
          tipoId: tipo.id, tipoNome: tipo.nome, tipoNomeNormalizado: normalizarTexto(tipo.nome),
          servidorId: servidor?.id || null,
          servidorNome: servidor?.nome || null,
          servidorNomeNormalizado: servidor ? normalizarTexto(servidor.nome) : null,
          competencia,
          exercicio,
          observacoes,
          observacoesNormalizado: normalizarTexto(observacoes),
          anexos: [],
          quantidadeAnexos: 0,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Tipo de Documento": registro.tipoNome || "",
        "Nome do Servidor": registro.servidorNome || "",
        "Competência (mm/aaaa)": registro.competencia ? `${registro.competencia.slice(5,7)}/${registro.competencia.slice(0,4)}` : "",
        "Exercício": registro.exercicio || "",
        "Observações": registro.observacoes || "",
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum registro encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div class="linha-com-checkbox">
        <input type="checkbox" class="checkbox-selecao-registro" title="Selecionar pra exportação em lote">
        <div>
          <strong>${registro.tipoNome || "Tipo não informado"}</strong> ${registro.servidorNome ? "— " + registro.servidorNome : ""}
          <div class="texto-secundario">${registro.observacoes || ""}</div>
          <div class="texto-secundario">Exercício ${registro.exercicio || "-"} ${registro.competencia ? "· Competência " + registro.competencia.slice(5,7) + "/" + registro.competencia.slice(0,4) : ""}</div>
          <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
        </div>
      </div>
      <div class="acoes-cartao">
        ${temAnexo(registro) ? `<span class="badge-anexo" title="Tem anexo">📎</span>` : ""}
        ${registro.servidorId ? `<button class="botao-icone" data-acao="ver-servidor" title="Ver Servidor">🔗</button>` : ""}
        ${
          usuarioPodeEditar()
            ? `<button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>`
            : ""
        }
      </div>
    `;
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("click", (evento) => evento.stopPropagation());
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("change", (evento) =>
      gerenciadorSelecao.alternarSelecao(registro, evento.target.checked)
    );
    cartao.querySelector('[data-acao="ver-servidor"]')?.addEventListener("click", async (evento) => {
      evento.stopPropagation();
      const doc = await colecaoEntidade("servidores").doc(registro.servidorId).get();
      if (doc.exists) abrirModalVinculadosServidor({ id: doc.id, ...doc.data() }, evento.currentTarget);
    });
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) => excluirRegistro(registro, evento.target));
    if (!usuarioPodeEditar()) {
      cartao.classList.add("cartao-clicavel");
      cartao.addEventListener("click", () => abrirFormulario(registro));
    }
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} Processo de Pessoal`, `
      <label>Tipo de Documento *</label>
      <select id="campo-tipo">
        <option value="">Selecione...</option>
        ${montarOpcoesHtml(tipos, registro?.tipoId)}
      </select>

      <label>Servidor (opcional)</label>
      <input type="text" id="campo-servidor-busca" placeholder="Digite pra buscar..." value="${registro?.servidorNome || ""}" autocomplete="off">
      <input type="hidden" id="campo-servidor-id" value="${registro?.servidorId || ""}">
      <div id="resultados-servidor" class="lista-autocomplete oculto"></div>

      <div class="linha-formulario">
        <div>
          <label>Competência (mm/aaaa)</label>
          <input type="month" id="campo-competencia" value="${registro?.competencia || ""}">
        </div>
        <div>
          <label>Exercício *</label>
          <input type="number" id="campo-exercicio" value="${registro?.exercicio || new Date().getFullYear()}">
        </div>
      </div>

      <label>Observações adicionais</label>
      <textarea id="campo-observacoes" rows="3">${registro?.observacoes || ""}</textarea>

      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoTipo = document.getElementById("campo-tipo");
      const campoExercicio = document.getElementById("campo-exercicio");
      [campoTipo, campoExercicio].forEach(limparCampoInvalido);

      let valido = true;
      if (!campoTipo.value) { marcarCampoInvalido(campoTipo, "Selecione o tipo."); valido = false; }
      if (!campoExercicio.value) { marcarCampoInvalido(campoExercicio, "Informe o exercício."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const servidorNome = document.getElementById("campo-servidor-busca").value.trim();
        const observacoes = document.getElementById("campo-observacoes").value.trim();
        const dados = {
          tipoId: campoTipo.value,
          tipoNome: tipos.find((t) => t.id === campoTipo.value)?.nome || "",
          tipoNomeNormalizado: normalizarTexto(tipos.find((t) => t.id === campoTipo.value)?.nome || ""),
          servidorId: document.getElementById("campo-servidor-id").value || null,
          servidorNome: servidorNome || null,
          servidorNomeNormalizado: servidorNome ? normalizarTexto(servidorNome) : null,
          competencia: document.getElementById("campo-competencia").value || null,
          exercicio: parseInt(campoExercicio.value, 10),
          observacoes,
          observacoesNormalizado: normalizarTexto(observacoes),
          anexos: controleAnexos.obterAnexos(),
          quantidadeAnexos: controleAnexos.obterAnexos().length,
        };
        if (registro) {
          await colecaoEntidade("processosPessoal").doc(registro.id).update(dados);
          await registrarHistorico("processosPessoal", registro.id, "editar", `Processo de Pessoal (${dados.tipoNome}${dados.servidorNome ? " - " + dados.servidorNome : ""}) editado.`);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          const refNova = await colecaoEntidade("processosPessoal").add(dados);
          await registrarHistorico("processosPessoal", refNova.id, "criar", `Processo de Pessoal (${dados.tipoNome}${dados.servidorNome ? " - " + dados.servidorNome : ""}) criado.`);
        }
        fecharModal();
        mostrarToast("Processo de Pessoal salvo com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    }, registro ? (botao) => excluirRegistro(registro, botao) : null);

    const controleAnexos = renderizarSecaoAnexos(
      modal.querySelector("#secao-anexos"),
      registro?.anexos,
      "processosPessoal",
      () => {},
      () => {
        const tipoTexto = document.getElementById("campo-tipo")?.selectedOptions[0]?.text || "";
        const servidorTexto = document.getElementById("campo-servidor-busca")?.value.trim() || "";
        const temTipo = tipoTexto && tipoTexto !== "Selecione...";
        return temTipo ? `${tipoTexto}${servidorTexto ? "-" + servidorTexto : ""}` : "";
      }
    );

    configurarAutocomplete({
      inputBusca: modal.querySelector("#campo-servidor-busca"),
      inputId: modal.querySelector("#campo-servidor-id"),
      resultadosEl: modal.querySelector("#resultados-servidor"),
      buscar: (termo) => buscarRegistrosPorNome("servidores", termo),
    });
  }

  async function excluirRegistro(registro, botaoExcluir) {
    if (!confirm(`Excluir este Processo de Pessoal? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade("processosPessoal").doc(registro.id).delete();
      await registrarHistorico("processosPessoal", registro.id, "excluir", `Processo de Pessoal (${registro.tipoNome}) excluído.`);
      fecharModal();
      mostrarToast("Excluído com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  const filtrosAnexo = configurarFiltrosAnexo(() => aplicarFiltrosPessoal());

  async function aplicarFiltrosPessoal() {
    const termo = document.getElementById("campo-busca").value.trim();
    const exercicio = document.getElementById("filtro-ano").value;
    const filtroAnexo = filtrosAnexo.obterAtivo();
    const lista = document.getElementById("lista-registros");
    const botaoMais = document.getElementById("btn-carregar-mais");

    if (!termo && !exercicio && !filtroAnexo) {
      paginador = criarPaginador(colecaoEntidade("processosPessoal").orderBy("criadoEm", "desc"));
      carregarPagina(true);
      return;
    }

    botaoMais.classList.add("oculto");
    lista.innerHTML = "";

    try {
      let registros;
      if (termo) {
        registros = await buscarPorSubstringGenerico(
          "processosPessoal",
          termo,
          ["servidorNomeNormalizado", "tipoNomeNormalizado", "observacoesNormalizado"],
          { campoAno: exercicio ? "exercicio" : null, valorAno: exercicio }
        );
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else if (exercicio) {
        const snapshot = await colecaoEntidade("processosPessoal").where("exercicio", "==", parseInt(exercicio, 10)).get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else {
        const consulta = filtroAnexo === "sem"
          ? colecaoEntidade("processosPessoal").where("quantidadeAnexos", "==", 0)
          : colecaoEntidade("processosPessoal").where("quantidadeAnexos", ">", 0);
        const snapshot = await consulta.get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }

      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      if (registros.length === 0) lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  let temporizadorBusca;
  document.getElementById("campo-busca").addEventListener("input", () => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(() => aplicarFiltrosPessoal(), 300);
  });
  document.getElementById("filtro-ano").addEventListener("change", () => aplicarFiltrosPessoal());
  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  carregarPagina(true);

  if (registroPendenteParaAbrir?.chave === "processos-pessoal") {
    const idPendente = registroPendenteParaAbrir.id;
    registroPendenteParaAbrir = null;
    const doc = await colecaoEntidade("processosPessoal").doc(idPendente).get();
    if (doc.exists) abrirFormulario({ id: doc.id, ...doc.data() });
  }
}

// -------------------------------------------------------------
// PROCESSOS DE ATO ADMINISTRATIVO (documento formal, pode ter vários servidores)
// -------------------------------------------------------------
async function renderizarAtosAdministrativos(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Atos Administrativos</h2>
      <div class="acoes-cabecalho" id="acoes-cabecalho"></div>
      ${usuarioPodeEditar() ? `<button class="botao-primario" id="btn-novo">+ Novo Ato</button>` : ""}
    </div>
    <div class="barra-busca">
      <input type="text" id="campo-busca" placeholder="Buscar por número, tipo ou descrição...">
      <select id="filtro-ano" class="filtro-ano">${gerarOpcoesAno()}</select>
      <button type="button" class="botao-secundario" id="btn-filtro-sem-anexo">📋 Sem anexo</button>
      <button type="button" class="botao-secundario" id="btn-filtro-com-anexo">📎 Com anexo</button>
      <button type="button" class="botao-secundario" id="btn-selecionar-todos">☑️ Selecionar todos</button>
    </div>
    ${htmlBarraSelecaoExportacao()}
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("atosAdministrativos").orderBy("criadoEm", "desc"));
  const gerenciadorSelecao = criarGerenciadorSelecao("atos-administrativos");
  gerenciadorSelecao.ligarBotoes();
  const tipos = await carregarOpcoesSelect("tiposAtoAdministrativo");

  if (usuarioPodeEditar()) {
    const colunas = [
      { chave: "tipo", rotulo: "Tipo do Ato", obrigatorio: true, exemplo: tipos[0]?.nome || "Portaria" },
      { chave: "numero", rotulo: "Número", obrigatorio: true, exemplo: "032/2026" },
      { chave: "exercicio", rotulo: "Exercício", obrigatorio: true, exemplo: new Date().getFullYear() },
      { chave: "competencia", rotulo: "Competência (mm/aaaa)", obrigatorio: false, exemplo: "03/2026" },
      { chave: "dataEmissao", rotulo: "Data de Emissão (dd/mm/aaaa)", obrigatorio: false, exemplo: "15/03/2026" },
      { chave: "descricao", rotulo: "Descrição/Assunto", obrigatorio: true, exemplo: "Nomeação de servidor" },
      { chave: "servidores", rotulo: "Servidores Envolvidos", obrigatorio: false, exemplo: "Fulano de Tal; Ciclano da Silva", ajuda: "Separe vários nomes por ponto e vírgula ( ; ). Todos precisam já estar cadastrados." },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: "Atos Administrativos",
      nomeColecao: "atosAdministrativos",
      colunas,
      montarDocumento: async (linha) => {
        const nomeTipo = (linha["Tipo do Ato"] || "").toString().trim();
        const tipo = tipos.find((t) => normalizarTexto(t.nome) === normalizarTexto(nomeTipo));
        if (!tipo) throw new Error(`Tipo "${nomeTipo}" não encontrado. Cadastre-o antes de importar.`);
        const numero = (linha["Número"] || "").toString().trim();
        if (!numero) throw new Error("Número é obrigatório.");
        const exercicio = parseInt(linha["Exercício"], 10);
        if (!exercicio) throw new Error("Exercício é obrigatório.");
        const descricao = (linha["Descrição/Assunto"] || "").toString().trim();
        if (!descricao) throw new Error("Descrição/Assunto é obrigatório.");

        const competenciaTexto = (linha["Competência (mm/aaaa)"] || "").toString().trim();
        const competencia = /^\d{2}\/\d{4}$/.test(competenciaTexto)
          ? `${competenciaTexto.split("/")[1]}-${competenciaTexto.split("/")[0]}`
          : "";
        const dataEmissao = converterDataPlanilhaParaIso(linha["Data de Emissão (dd/mm/aaaa)"]) || "";

        const nomesServidores = (linha["Servidores Envolvidos"] || "").toString().split(";").map((n) => n.trim()).filter(Boolean);
        const servidoresIds = [], servidoresNomes = [];
        for (const nome of nomesServidores) {
          const snap = await colecaoEntidade("servidores").where("nomeNormalizado", "==", normalizarTexto(nome)).limit(1).get();
          if (snap.empty) throw new Error(`Servidor "${nome}" não encontrado.`);
          servidoresIds.push(snap.docs[0].id);
          servidoresNomes.push(snap.docs[0].data().nome);
        }

        return {
          tipoId: tipo.id, tipoNome: tipo.nome, tipoNomeNormalizado: normalizarTexto(tipo.nome),
          numero, numeroNormalizado: normalizarTexto(numero),
          exercicio, competencia, dataEmissao,
          descricao, descricaoNormalizado: normalizarTexto(descricao),
          servidoresIds, servidoresNomes,
          anexos: [], quantidadeAnexos: 0,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Tipo do Ato": registro.tipoNome || "",
        "Número": registro.numero || "",
        "Exercício": registro.exercicio || "",
        "Competência (mm/aaaa)": registro.competencia ? `${registro.competencia.slice(5,7)}/${registro.competencia.slice(0,4)}` : "",
        "Data de Emissão (dd/mm/aaaa)": registro.dataEmissao ? formatarData(registro.dataEmissao) : "",
        "Descrição/Assunto": registro.descricao || "",
        "Servidores Envolvidos": (registro.servidoresNomes || []).join("; "),
      }),
      aoImportarComSucesso: () => { paginador.reiniciar(); carregarPagina(true); },
    });
  }

  async function carregarPagina(limpar = false) {
    const lista = document.getElementById("lista-registros");
    if (limpar) lista.innerHTML = "";
    try {
      const registros = await paginador.carregarProximaPagina();
      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      document.getElementById("btn-carregar-mais").classList.toggle("oculto", !paginador.temMais);
      if (limpar && registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum registro encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
      document.getElementById("btn-carregar-mais").classList.add("oculto");
    }
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro";
    cartao.innerHTML = `
      <div class="linha-com-checkbox">
        <input type="checkbox" class="checkbox-selecao-registro" title="Selecionar pra exportação em lote">
        <div>
          <strong>${registro.tipoNome || "Tipo"} nº ${registro.numero}</strong>
          <div class="texto-secundario">${registro.descricao || ""}</div>
          <div class="texto-secundario">Exercício ${registro.exercicio || "-"} ${(registro.servidoresNomes || []).length > 0 ? "· " + registro.servidoresNomes.length + " servidor(es) envolvido(s)" : ""}</div>
          <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
        </div>
      </div>
      <div class="acoes-cartao">
        ${temAnexo(registro) ? `<span class="badge-anexo" title="Tem anexo">📎</span>` : ""}
        ${
          usuarioPodeEditar()
            ? `<button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>`
            : ""
        }
      </div>
    `;
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("click", (evento) => evento.stopPropagation());
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("change", (evento) =>
      gerenciadorSelecao.alternarSelecao(registro, evento.target.checked)
    );
    cartao.querySelector('[data-acao="editar"]')?.addEventListener("click", () => abrirFormulario(registro));
    cartao.querySelector('[data-acao="excluir"]')?.addEventListener("click", (evento) => excluirRegistro(registro, evento.target));
    if (!usuarioPodeEditar()) {
      cartao.classList.add("cartao-clicavel");
      cartao.addEventListener("click", () => abrirFormulario(registro));
    }
    return cartao;
  }

  async function abrirFormulario(registro = null) {
    const servidoresDisponiveis = await carregarOpcoesSelect("servidores");
    const selecionadosAtuais = new Set(registro?.servidoresIds || []);

    const modal = criarModal(`${registro ? "Editar" : "Novo"} Ato Administrativo`, `
      <div class="linha-formulario">
        <div>
          <label>Tipo do Ato *</label>
          <select id="campo-tipo">
            <option value="">Selecione...</option>
            ${montarOpcoesHtml(tipos, registro?.tipoId)}
          </select>
        </div>
        <div>
          <label>Número *</label>
          <input type="text" id="campo-numero" value="${registro?.numero || ""}">
        </div>
      </div>
      <div class="linha-formulario">
        <div>
          <label>Exercício *</label>
          <input type="number" id="campo-exercicio" value="${registro?.exercicio || new Date().getFullYear()}">
        </div>
        <div>
          <label>Competência (mm/aaaa)</label>
          <input type="month" id="campo-competencia" value="${registro?.competencia || ""}">
        </div>
      </div>
      <label>Data de Emissão</label>
      <input type="date" id="campo-data-emissao" value="${registro?.dataEmissao || ""}">
      <label>Descrição/Assunto *</label>
      <textarea id="campo-descricao" rows="3">${registro?.descricao || ""}</textarea>

      <label>Servidores Envolvidos</label>
      <input type="text" id="campo-busca-servidor-ato" placeholder="Digite pra buscar e marcar servidores...">
      <div class="lista-checkboxes" id="lista-servidores-ato" style="max-height:220px; margin-top:8px">
        ${servidoresDisponiveis.map((s) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${s.id}" ${selecionadosAtuais.has(s.id) ? "checked" : ""}>
            ${s.nome}
          </label>
        `).join("")}
      </div>
      <p class="texto-secundario" id="contagem-servidores-ato" style="margin-top:4px">${selecionadosAtuais.size} servidor(es) marcado(s).</p>

      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoTipo = document.getElementById("campo-tipo");
      const campoNumero = document.getElementById("campo-numero");
      const campoExercicio = document.getElementById("campo-exercicio");
      const campoDescricao = document.getElementById("campo-descricao");
      [campoTipo, campoNumero, campoExercicio, campoDescricao].forEach(limparCampoInvalido);

      let valido = true;
      if (!campoTipo.value) { marcarCampoInvalido(campoTipo, "Selecione o tipo."); valido = false; }
      if (!campoNumero.value.trim()) { marcarCampoInvalido(campoNumero, "Informe o número."); valido = false; }
      if (!campoExercicio.value) { marcarCampoInvalido(campoExercicio, "Informe o exercício."); valido = false; }
      if (!campoDescricao.value.trim()) { marcarCampoInvalido(campoDescricao, "Informe a descrição."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const checkboxesMarcados = [...document.querySelectorAll("#lista-servidores-ato input:checked")];
        const servidoresIds = checkboxesMarcados.map((c) => c.value);
        const servidoresNomes = servidoresIds.map((id) => servidoresDisponiveis.find((s) => s.id === id)?.nome).filter(Boolean);
        const descricao = campoDescricao.value.trim();

        const dados = {
          tipoId: campoTipo.value,
          tipoNome: tipos.find((t) => t.id === campoTipo.value)?.nome || "",
          tipoNomeNormalizado: normalizarTexto(tipos.find((t) => t.id === campoTipo.value)?.nome || ""),
          numero: campoNumero.value.trim(),
          numeroNormalizado: normalizarTexto(campoNumero.value),
          exercicio: parseInt(campoExercicio.value, 10),
          competencia: document.getElementById("campo-competencia").value || null,
          dataEmissao: document.getElementById("campo-data-emissao").value || null,
          descricao,
          descricaoNormalizado: normalizarTexto(descricao),
          servidoresIds,
          servidoresNomes,
          anexos: controleAnexos.obterAnexos(),
          quantidadeAnexos: controleAnexos.obterAnexos().length,
        };
        if (registro) {
          await colecaoEntidade("atosAdministrativos").doc(registro.id).update(dados);
          await registrarHistorico("atosAdministrativos", registro.id, "editar", `${dados.tipoNome} nº ${dados.numero} editado.`);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          const refNova = await colecaoEntidade("atosAdministrativos").add(dados);
          await registrarHistorico("atosAdministrativos", refNova.id, "criar", `${dados.tipoNome} nº ${dados.numero} criado.`);
        }
        fecharModal();
        mostrarToast("Ato Administrativo salvo com sucesso.", "sucesso");
        paginador.reiniciar();
        carregarPagina(true);
      });
    }, registro ? (botao) => excluirRegistro(registro, botao) : null);

    const controleAnexos = renderizarSecaoAnexos(
      modal.querySelector("#secao-anexos"),
      registro?.anexos,
      "atosAdministrativos",
      () => {},
      () => {
        const tipoTexto = document.getElementById("campo-tipo")?.selectedOptions[0]?.text || "";
        const numero = document.getElementById("campo-numero")?.value.trim();
        const temTipo = tipoTexto && tipoTexto !== "Selecione...";
        return temTipo && numero ? `${tipoTexto}-${numero}` : "";
      }
    );

    modal.querySelector("#campo-busca-servidor-ato").addEventListener("input", (evento) => {
      const termo = normalizarTexto(evento.target.value);
      modal.querySelectorAll("#lista-servidores-ato .item-checkbox").forEach((label) => {
        label.classList.toggle("oculto", termo && !normalizarTexto(label.textContent).includes(termo));
      });
    });
    modal.querySelector("#lista-servidores-ato").addEventListener("change", () => {
      const total = modal.querySelectorAll("#lista-servidores-ato input:checked").length;
      modal.querySelector("#contagem-servidores-ato").textContent = `${total} servidor(es) marcado(s).`;
    });
  }

  async function excluirRegistro(registro, botaoExcluir) {
    if (!confirm(`Excluir "${registro.tipoNome} nº ${registro.numero}"? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade("atosAdministrativos").doc(registro.id).delete();
      await registrarHistorico("atosAdministrativos", registro.id, "excluir", `${registro.tipoNome} nº ${registro.numero} excluído.`);
      fecharModal();
      mostrarToast("Excluído com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  const filtrosAnexo = configurarFiltrosAnexo(() => aplicarFiltrosAtos());

  async function aplicarFiltrosAtos() {
    const termoOriginal = document.getElementById("campo-busca").value.trim();
    const exercicio = document.getElementById("filtro-ano").value;
    const filtroAnexo = filtrosAnexo.obterAtivo();
    const lista = document.getElementById("lista-registros");
    const botaoMais = document.getElementById("btn-carregar-mais");

    if (!termoOriginal && !exercicio && !filtroAnexo) {
      paginador = criarPaginador(colecaoEntidade("atosAdministrativos").orderBy("criadoEm", "desc"));
      carregarPagina(true);
      return;
    }

    botaoMais.classList.add("oculto");
    lista.innerHTML = "";

    try {
      let registros;
      if (termoOriginal) {
        registros = await buscarPorSubstringGenerico(
          "atosAdministrativos",
          termoOriginal,
          ["numeroNormalizado", "tipoNomeNormalizado", "descricaoNormalizado"],
          { campoAno: exercicio ? "exercicio" : null, valorAno: exercicio }
        );
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else if (exercicio) {
        const snapshot = await colecaoEntidade("atosAdministrativos").where("exercicio", "==", parseInt(exercicio, 10)).get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else {
        const consulta = filtroAnexo === "sem"
          ? colecaoEntidade("atosAdministrativos").where("quantidadeAnexos", "==", 0)
          : colecaoEntidade("atosAdministrativos").where("quantidadeAnexos", ">", 0);
        const snapshot = await consulta.get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }

      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      if (registros.length === 0) lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  let temporizadorBusca;
  document.getElementById("campo-busca").addEventListener("input", () => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(() => aplicarFiltrosAtos(), 300);
  });
  document.getElementById("filtro-ano").addEventListener("change", () => aplicarFiltrosAtos());
  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  carregarPagina(true);

  if (registroPendenteParaAbrir?.chave === "atos-administrativos") {
    const idPendente = registroPendenteParaAbrir.id;
    registroPendenteParaAbrir = null;
    const doc = await colecaoEntidade("atosAdministrativos").doc(idPendente).get();
    if (doc.exists) abrirFormulario({ id: doc.id, ...doc.data() });
  }
}

/** Modal "de espiada" com os servidores de uma Folha, aberto a partir de um Processo de Despesa vinculado a ela */
async function abrirModalServidoresDaFolha(folhaId, botaoOrigem) {
  let folha = null;
  try {
    const carregar = async () => {
      const doc = await colecaoEntidade("folhas").doc(folhaId).get();
      if (doc.exists) folha = { id: doc.id, ...doc.data() };
    };
    if (botaoOrigem) await executarComFeedback(botaoOrigem, carregar, "Carregando...");
    else await carregar();
  } catch (erro) {
    tratarErroConsultaFirestore(erro);
    return;
  }
  if (!folha) {
    mostrarToast("Não foi possível encontrar a folha vinculada.", "erro");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>Servidores — Folha ${folha.nome}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-servidores-folha">✕</button>
      </div>
      <div class="corpo-modal">
        <p class="texto-secundario">${(folha.servidoresNomes || []).length} servidor(es) nesta folha.</p>
        ${
          (folha.servidoresNomes || []).length === 0
            ? `<p class="texto-secundario">Nenhum servidor cadastrado nesta folha.</p>`
            : folha.servidoresNomes.map((nome) => `<div class="cartao-registro"><div>${nome}</div></div>`).join("")
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#btn-fechar-servidores-folha").addEventListener("click", () => modal.remove());
}

/**
 * Modal "de espiada" que junta tudo que está vinculado a um servidor:
 * Processos de Pessoal dele, Atos Administrativos em que ele aparece
 * entre os "servidores envolvidos", e Processos de Despesa que o
 * incluem indiretamente através de alguma Folha vinculada.
 */
async function abrirModalVinculadosServidor(servidor, botaoOrigem) {
  let pessoal = [], atos = [], despesas = [];
  try {
    const carregar = async () => {
      const [snapPessoal, snapAtos, snapFolhas] = await Promise.all([
        colecaoEntidade("processosPessoal").where("servidorId", "==", servidor.id).orderBy("criadoEm", "desc").get(),
        colecaoEntidade("atosAdministrativos").where("servidoresIds", "array-contains", servidor.id).orderBy("criadoEm", "desc").get(),
        colecaoEntidade("folhas").where("servidoresIds", "array-contains", servidor.id).get(),
      ]);
      pessoal = snapPessoal.docs.map((d) => ({ id: d.id, ...d.data() }));
      atos = snapAtos.docs.map((d) => ({ id: d.id, ...d.data() }));

      const folhaIds = snapFolhas.docs.map((d) => d.id);
      if (folhaIds.length > 0) {
        // "in" só aceita até 10 valores por consulta — faz em blocos se precisar
        const blocos = [];
        for (let i = 0; i < folhaIds.length; i += 10) blocos.push(folhaIds.slice(i, i + 10));
        const resultados = await Promise.all(
          blocos.map((bloco) => colecaoEntidade("processosDespesa").where("folhaId", "in", bloco).get())
        );
        const vistos = new Set();
        resultados.forEach((snap) => snap.docs.forEach((d) => {
          if (!vistos.has(d.id)) { vistos.add(d.id); despesas.push({ id: d.id, ...d.data() }); }
        }));
      }
    };
    if (botaoOrigem) {
      await executarComFeedback(botaoOrigem, carregar, "Carregando...");
    } else {
      await carregar();
    }
  } catch (erro) {
    tratarErroConsultaFirestore(erro);
    return;
  }

  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>Vinculados a ${servidor.nome}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-vinculados-servidor">✕</button>
      </div>
      <div class="corpo-modal">
        <h4>Processos de Pessoal (${pessoal.length})</h4>
        ${
          pessoal.length === 0
            ? `<p class="texto-secundario">Nenhum.</p>`
            : pessoal.map((p) => `
                <div class="cartao-registro linha-vinculado-servidor" data-colecao="processosPessoal" data-id="${p.id}" style="cursor:pointer">
                  <div><strong>${p.tipoNome || "Tipo não informado"}</strong><div class="texto-secundario">${p.observacoes || ""} · ${p.exercicio || ""}</div></div>
                </div>`).join("")
        }
        <h4 style="margin-top:18px">Atos Administrativos (${atos.length})</h4>
        ${
          atos.length === 0
            ? `<p class="texto-secundario">Nenhum.</p>`
            : atos.map((a) => `
                <div class="cartao-registro linha-vinculado-servidor" data-colecao="atosAdministrativos" data-id="${a.id}" style="cursor:pointer">
                  <div><strong>${a.tipoNome || "Tipo"} nº ${a.numero || ""}</strong><div class="texto-secundario">${(a.descricao || "").slice(0, 80)}</div></div>
                </div>`).join("")
        }
        <h4 style="margin-top:18px">Processos de Despesa via Folha (${despesas.length})</h4>
        ${
          despesas.length === 0
            ? `<p class="texto-secundario">Nenhum.</p>`
            : despesas.map((d) => `
                <div class="cartao-registro linha-vinculado-servidor" data-colecao="processosDespesa" data-id="${d.id}" style="cursor:pointer">
                  <div><strong>Empenho ${d.numeroEmpenho}</strong><div class="texto-secundario">${formatarMoeda(d.valor)} · Folha: ${d.folhaNome || ""}</div></div>
                </div>`).join("")
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#btn-fechar-vinculados-servidor").addEventListener("click", () => modal.remove());
  modal.querySelectorAll(".linha-vinculado-servidor").forEach((linha) => {
    linha.addEventListener("click", () => {
      const colecaoDestino = linha.dataset.colecao;
      const idDestino = linha.dataset.id;
      modal.remove();
      const CHAVE_POR_COLECAO = { processosPessoal: "processos-pessoal", atosAdministrativos: "atos-administrativos", processosDespesa: "despesas" };
      navegarParaRegistro(CHAVE_POR_COLECAO[colecaoDestino], idDestino);
    });
  });
}
