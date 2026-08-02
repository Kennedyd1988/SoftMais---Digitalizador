// ===================================================================
// MÓDULOS DE PROCESSOS
// ===================================================================

/** Verifica se o registro tem anexo, com fallback pra registros antigos sem o campo quantidadeAnexos */
function temAnexo(registro) {
  return (registro.quantidadeAnexos ?? (registro.anexos || []).length) > 0;
}

// -------------------------------------------------------------
// FILTROS COMBINÁVEIS (busca + ano + sem/com anexo, ao mesmo tempo)
// -------------------------------------------------------------
// O Firestore só permite um filtro "forte" (intervalo/desigualdade) por
// consulta sem precisar de índice composto. Por isso, em vez de mandar
// os três filtros juntos pro banco, escolhemos qual deles vira a
// consulta principal (o mais restritivo disponível) e aplicamos os
// outros filtros ativos em cima do resultado já buscado, no navegador.
// Isso permite os três funcionarem juntos sem precisar criar nenhum
// índice novo no Firestore.

function filtrarPorAnoClientSide(registros, ano) {
  if (!ano) return registros;
  return registros.filter((r) => String(r.ano) === String(ano));
}

function filtrarPorCompetenciaClientSide(registros, ano) {
  if (!ano) return registros;
  return registros.filter((r) => (r.competenciaKey || "").startsWith(String(ano)));
}

function filtrarPorAnexoClientSide(registros, filtroAnexo) {
  if (!filtroAnexo) return registros;
  return filtroAnexo === "sem" ? registros.filter((r) => !temAnexo(r)) : registros.filter((r) => temAnexo(r));
}

function filtrarPorTextoClientSide(registros, termo, campos) {
  if (!termo) return registros;
  const termoNorm = normalizarTexto(termo);
  return registros.filter((r) => campos.some((campo) => (r[campo] || "").toString().toLowerCase().includes(termoNorm)));
}

/**
 * Liga os botões "Sem anexo"/"Com anexo" — só controla o próprio estado
 * (mutuamente exclusivos entre si) e avisa quando muda, através do
 * callback `aoMudar`. Não mexe mais em busca/ano — isso permite os três
 * filtros ficarem ativos ao mesmo tempo.
 */
function configurarFiltrosAnexo(aoMudar) {
  const botaoSem = document.getElementById("btn-filtro-sem-anexo");
  const botaoCom = document.getElementById("btn-filtro-com-anexo");
  let ativo = null; // 'sem' | 'com' | null

  function alternar(novo) {
    ativo = ativo === novo ? null : novo;
    botaoSem.classList.toggle("botao-filtro-ativo", ativo === "sem");
    botaoCom.classList.toggle("botao-filtro-ativo", ativo === "com");
    aoMudar();
  }

  botaoSem.addEventListener("click", () => alternar("sem"));
  botaoCom.addEventListener("click", () => alternar("com"));

  return {
    obterAtivo: () => ativo,
    resetar() {
      ativo = null;
      botaoSem.classList.remove("botao-filtro-ativo");
      botaoCom.classList.remove("botao-filtro-ativo");
    },
  };
}

/** HTML da barra flutuante que aparece quando algum registro é selecionado pra exportação em lote (item 7) */
function htmlBarraSelecaoExportacao() {
  return `
    <div id="barra-selecao-exportacao" class="barra-selecao oculto">
      <span id="texto-selecao-exportacao"></span>
      <div>
        <button type="button" class="botao-secundario" id="btn-limpar-selecao">Limpar seleção</button>
        <button type="button" class="botao-primario" id="btn-exportar-selecionados">📦 Exportar selecionados</button>
      </div>
    </div>
  `;
}

/**
 * Gerencia a seleção de vários registros numa lista, pra exportar todos
 * os PDFs anexados de uma vez, compactados num .zip (item 7).
 */
function criarGerenciadorSelecao(nomeArquivoZipPrefixo) {
  const registrosSelecionados = new Map(); // id -> registro

  function atualizarBarra() {
    const barra = document.getElementById("barra-selecao-exportacao");
    if (!barra) return;
    const quantidade = registrosSelecionados.size;
    barra.classList.toggle("oculto", quantidade === 0);
    const texto = document.getElementById("texto-selecao-exportacao");
    if (texto) texto.textContent = `${quantidade} registro(s) selecionado(s)`;
  }

  function alternarSelecao(registro, selecionado) {
    if (selecionado) registrosSelecionados.set(registro.id, registro);
    else registrosSelecionados.delete(registro.id);
    atualizarBarra();
  }

  function limpar() {
    registrosSelecionados.clear();
    document.querySelectorAll(".checkbox-selecao-registro").forEach((c) => (c.checked = false));
    atualizarBarra();
  }

  function ligarBotoes() {
    document.getElementById("btn-limpar-selecao")?.addEventListener("click", limpar);

    document.getElementById("btn-selecionar-todos")?.addEventListener("click", () => {
      // Marca todos os checkboxes visíveis no momento (respeitando o
      // filtro/busca atual e o que já foi carregado com "Carregar mais")
      document.querySelectorAll(".checkbox-selecao-registro").forEach((checkbox) => {
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("change"));
        }
      });
    });

    document.getElementById("btn-exportar-selecionados")?.addEventListener("click", async (evento) => {
      const todosOsAnexos = [...registrosSelecionados.values()].flatMap((r) => r.anexos || []);
      if (todosOsAnexos.length === 0) {
        mostrarToast("Os registros selecionados não têm nenhum PDF anexado.", "info");
        return;
      }
      const barra = criarBarraProgressoInline(
        document.getElementById("barra-selecao-exportacao"),
        "Exportando"
      );
      await executarComFeedback(evento.target, async () => {
        try {
          await exportarAnexosComoZip(
            todosOsAnexos,
            `${nomeArquivoZipPrefixo}-${new Date().toISOString().slice(0, 10)}.zip`,
            (percentualGeral, feitos, total) => barra.atualizarPercentual(percentualGeral, `Exportando ${feitos}/${total}`)
          );
          mostrarToast("Exportação concluída.", "sucesso");
        } catch (erro) {
          mostrarToast(erro.message, "erro");
        } finally {
          barra.remover();
        }
      }, "Exportando...");
    });
  }

  return { alternarSelecao, limpar, ligarBotoes };
}

/**
 * Modal que lista os Processos de Despesa vinculados a uma Licitação
 * (item 5), com botão pra baixar todos os PDFs desses processos de
 * uma vez, compactados num .zip (item 6).
 */
/** HTML de uma linha de anexo somente-leitura (ver/baixar com percentual), reaproveitado nos modais de vínculo */
function htmlLinhaAnexoSomenteLeitura(anexo) {
  return `
    <div class="linha-anexo-wrapper">
      <div class="linha-anexo">
        <span class="nome-anexo">📄 ${anexo.nomeArquivo} <span class="texto-secundario">(${anexo.paginas ?? "?"} pág. · ${formatarTamanhoArquivo(anexo.tamanhoBytes)})</span></span>
        <div class="acoes-anexo">
          <button type="button" class="botao-icone" title="Visualizar" data-acao="ver-anexo" data-id="${anexo.driveFileId}" data-nome="${anexo.nomeArquivo}">👁️</button>
          <button type="button" class="botao-icone" title="Baixar" data-acao="baixar-anexo" data-id="${anexo.driveFileId}" data-nome="${anexo.nomeArquivo}">⬇️</button>
        </div>
      </div>
      <div class="barra-progresso-container oculto" data-barra="${anexo.driveFileId}">
        <div class="barra-progresso-preenchimento" style="width:0%"></div>
      </div>
    </div>
  `;
}

/** Liga os botões ver/baixar de todas as linhas de anexo somente-leitura dentro de um container */
function ligarAcoesAnexoSomenteLeitura(container) {
  container.querySelectorAll('[data-acao="ver-anexo"]').forEach((botao) => {
    botao.addEventListener("click", async (evento) => {
      const alvo = evento.currentTarget;
      const containerBarra = container.querySelector(`[data-barra="${alvo.dataset.id}"]`);
      const preenchimento = containerBarra.querySelector(".barra-progresso-preenchimento");
      alvo.disabled = true;
      try {
        await visualizarAnexo(alvo.dataset.id, (percentual) => {
          containerBarra.classList.remove("oculto");
          preenchimento.style.width = `${percentual}%`;
        });
      } catch (erro) {
        mostrarToast(erro.message, "erro");
      } finally {
        alvo.disabled = false;
        containerBarra.classList.add("oculto");
        preenchimento.style.width = "0%";
      }
    });
  });
  container.querySelectorAll('[data-acao="baixar-anexo"]').forEach((botao) => {
    botao.addEventListener("click", async (evento) => {
      const alvo = evento.currentTarget;
      const containerBarra = container.querySelector(`[data-barra="${alvo.dataset.id}"]`);
      const preenchimento = containerBarra.querySelector(".barra-progresso-preenchimento");
      alvo.disabled = true;
      try {
        await baixarAnexo(alvo.dataset.id, alvo.dataset.nome, (percentual) => {
          containerBarra.classList.remove("oculto");
          preenchimento.style.width = `${percentual}%`;
        });
      } catch (erro) {
        mostrarToast(erro.message, "erro");
      } finally {
        alvo.disabled = false;
        containerBarra.classList.add("oculto");
        preenchimento.style.width = "0%";
      }
    });
  });
}

/**
 * Modal "de espiada" que mostra os dados da Licitação vinculada a uma
 * Despesa, sem sair da tela da Despesa — ao fechar, continua exatamente
 * onde estava. Só navega de verdade se clicar em "Editar Licitação
 * completa", que é uma ação explícita.
 */
async function abrirModalResumoLicitacaoVinculada(licitacaoId, botaoOrigem) {
  let licitacao = null;
  try {
    const carregar = async () => {
      const doc = await colecaoEntidade("licitacoes").doc(licitacaoId).get();
      if (doc.exists) licitacao = { id: doc.id, ...doc.data() };
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
  if (!licitacao) {
    mostrarToast("Não foi possível encontrar a licitação vinculada.", "erro");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>Licitação vinculada — ${licitacao.numero}/${licitacao.ano}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-resumo-licitacao">✕</button>
      </div>
      <div class="corpo-modal">
        <p><strong>Modalidade:</strong> ${licitacao.modalidadeNome || "Não informada"}</p>
        <p class="texto-secundario">${licitacao.objeto}</p>
        <div class="lista-anexos-vinculados" style="border-top:none; padding-top:0; margin-top:12px">
          ${
            (licitacao.anexos || []).length === 0
              ? `<p class="texto-secundario">Sem anexo.</p>`
              : licitacao.anexos.map(htmlLinhaAnexoSomenteLeitura).join("")
          }
        </div>
      </div>
      <div class="rodape-modal">
        <button class="botao-secundario" id="btn-editar-licitacao-completa">✏️ Editar Licitação completa</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#btn-fechar-resumo-licitacao").addEventListener("click", () => modal.remove());
  ligarAcoesAnexoSomenteLeitura(modal);

  modal.querySelector("#btn-editar-licitacao-completa").addEventListener("click", () => {
    modal.remove();
    fecharModal(); // aqui sim fecha a despesa, porque é uma escolha explícita de ir editar a licitação
    navegarParaRegistro("licitacoes", licitacaoId);
  });
}

async function abrirModalDespesasVinculadas(licitacao, botaoOrigem) {
  let despesas = [];
  try {
    const carregar = async () => {
      const snapshot = await colecaoEntidade("processosDespesa")
        .where("licitacaoId", "==", licitacao.id)
        .orderBy("criadoEm", "desc")
        .get();
      despesas = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
  const totalAnexos = despesas.reduce((soma, d) => soma + (d.anexos || []).length, 0);

  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal">
        <h3>Despesas vinculadas — ${licitacao.numero}/${licitacao.ano}</h3>
        <button class="botao-fechar-modal" id="btn-fechar-vinculados">✕</button>
      </div>
      <div class="corpo-modal">
        <p class="texto-secundario">${despesas.length} processo(s) de despesa vinculado(s), ${totalAnexos} anexo(s) ao todo.</p>
        <button type="button" class="botao-secundario" id="btn-exportar-zip-vinculados" ${totalAnexos === 0 ? "disabled" : ""}>
          📦 Exportar todos os PDFs (.zip)
        </button>
        <div id="area-progresso-export-zip"></div>
        <div class="lista-despesas-vinculadas" style="margin-top:14px">
          ${
            despesas.length === 0
              ? `<p class="texto-secundario">Nenhum processo de despesa vinculado ainda.</p>`
              : despesas.map((d) => `
                  <div class="cartao-registro linha-despesa-vinculada" data-id="${d.id}" style="flex-direction:column; align-items:stretch;">
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                      <div>
                        <strong>Empenho ${d.numeroEmpenho}</strong> — ${d.credorNome || ""}
                        <div class="texto-secundario">${formatarMoeda(d.valor)}</div>
                      </div>
                      <button type="button" class="botao-secundario" data-acao="abrir-processo" title="Abrir o processo completo">✏️ Editar processo completo</button>
                    </div>
                    <div class="lista-anexos-vinculados">
                      ${
                        (d.anexos || []).length === 0
                          ? `<p class="texto-secundario" style="margin:6px 0 0">Sem anexo.</p>`
                          : (d.anexos || []).map(htmlLinhaAnexoSomenteLeitura).join("")
                      }
                    </div>
                  </div>
                `).join("")
          }
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#btn-fechar-vinculados").addEventListener("click", () => modal.remove());
  ligarAcoesAnexoSomenteLeitura(modal);

  modal.querySelectorAll('[data-acao="abrir-processo"]').forEach((botao) => {
    botao.addEventListener("click", () => {
      const idDespesa = botao.closest(".linha-despesa-vinculada").dataset.id;
      modal.remove();
      fecharModal(); // aqui sim fecha a licitação, porque é uma escolha explícita de ir editar a despesa
      navegarParaRegistro("despesas", idDespesa);
    });
  });

  modal.querySelector("#btn-exportar-zip-vinculados")?.addEventListener("click", async (evento) => {
    const todosOsAnexos = despesas.flatMap((d) => d.anexos || []);
    const barra = criarBarraProgressoInline(modal.querySelector("#area-progresso-export-zip"), "Exportando");
    await executarComFeedback(evento.target, async () => {
      try {
        await exportarAnexosComoZip(
          todosOsAnexos,
          `despesas-licitacao-${licitacao.numero}-${licitacao.ano}.zip`,
          (percentualGeral, feitos, total) => barra.atualizarPercentual(percentualGeral, `Exportando ${feitos}/${total}`)
        );
        mostrarToast("Exportação concluída.", "sucesso");
      } catch (erro) {
        mostrarToast(erro.message, "erro");
      } finally {
        barra.remover();
      }
    }, "Exportando...");
  });
}

/** Gera as opções de um <select> de anos, do mais recente pro mais antigo */
function gerarOpcoesAno(anoSelecionado) {
  const anoAtual = new Date().getFullYear();
  let html = `<option value="">Todos os anos</option>`;
  for (let ano = anoAtual + 1; ano >= anoAtual - 15; ano--) {
    html += `<option value="${ano}" ${String(ano) === String(anoSelecionado) ? "selected" : ""}>${ano}</option>`;
  }
  return html;
}

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
      <select id="filtro-ano" class="filtro-ano">${gerarOpcoesAno()}</select>
      <button type="button" class="botao-secundario" id="btn-filtro-sem-anexo">📋 Sem anexo</button>
      <button type="button" class="botao-secundario" id="btn-filtro-com-anexo">📎 Com anexo</button>
      <button type="button" class="botao-secundario" id="btn-selecionar-todos">☑️ Selecionar todos</button>
    </div>
    ${htmlBarraSelecaoExportacao()}
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("licitacoes").orderBy("criadoEm", "desc"));
  const gerenciadorSelecao = criarGerenciadorSelecao("licitacoes");
  gerenciadorSelecao.ligarBotoes();
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
          numero,
          numeroNormalizado: normalizarTexto(numero),
          ano,
          modalidadeId,
          modalidadeNome: nomeModalidade,
          modalidadeNomeNormalizado: normalizarTexto(nomeModalidade),
          objeto,
          objetoNormalizado: normalizarTexto(objeto),
          anexos: [],
          quantidadeAnexos: 0,
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
          <strong>${registro.numero}/${registro.ano}</strong> — ${mapaModalidades[registro.modalidadeId] || "Modalidade não informada"}
          <div class="texto-secundario">${registro.objeto}</div>
          <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
        </div>
      </div>
      <div class="acoes-cartao">
        ${temAnexo(registro) ? `<span class="badge-anexo" title="Tem anexo">📎</span>` : ""}
        <button class="botao-icone" data-acao="ver-vinculados" title="Ver Despesas Vinculadas">🔗</button>
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
    cartao.querySelector('[data-acao="ver-vinculados"]').addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirModalDespesasVinculadas(registro, evento.currentTarget);
    });
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
      ${
        registro
          ? `<button type="button" class="botao-secundario botao-link-vinculado" id="btn-ver-despesas-vinculadas">🔗 Ver Despesas Vinculadas</button>`
          : ""
      }
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
          numeroNormalizado: normalizarTexto(campoNumero.value),
          ano: parseInt(document.getElementById("campo-ano").value, 10),
          modalidadeId: campoModalidade.value,
          modalidadeNome: mapaModalidades[campoModalidade.value] || "",
          modalidadeNomeNormalizado: normalizarTexto(mapaModalidades[campoModalidade.value] || ""),
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          anexos: controleAnexos.obterAnexos(),
          quantidadeAnexos: controleAnexos.obterAnexos().length,
        };
        if (registro) {
          const numeroOuAnoMudou = registro.numero !== dados.numero || registro.ano !== dados.ano;
          await colecaoEntidade("licitacoes").doc(registro.id).update(dados);
          await registrarHistorico("licitacoes", registro.id, "editar", `Licitação ${dados.numero}/${dados.ano} editada.`);
          if (numeroOuAnoMudou) {
            await sincronizarLicitacaoEmDespesas(registro.id, dados.numero, dados.ano);
          }
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          const referenciaNova = await colecaoEntidade("licitacoes").add(dados);
          await registrarHistorico("licitacoes", referenciaNova.id, "criar", `Licitação ${dados.numero}/${dados.ano} criada.`);
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
      () => {},
      () => {
        const numero = document.getElementById("campo-numero")?.value.trim();
        const ano = document.getElementById("campo-ano")?.value.trim();
        const campoModalidade = document.getElementById("campo-modalidade");
        const modalidadeTexto = campoModalidade?.selectedOptions[0]?.text || "";
        const temModalidade = modalidadeTexto && modalidadeTexto !== "Selecione...";
        return numero && ano
          ? `${temModalidade ? modalidadeTexto + "-" : ""}Licitacao-${numero}-${ano}`
          : "";
      }
    );

    modal.querySelector("#btn-ver-despesas-vinculadas")?.addEventListener("click", (evento) => {
      abrirModalDespesasVinculadas(registro, evento.target);
    });
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
      await registrarHistorico("licitacoes", registro.id, "excluir", `Licitação ${registro.numero}/${registro.ano} excluída.`);
      fecharModal();
      mostrarToast("Licitação excluída com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  /**
   * Quando o número/ano de uma licitação muda, o "identificador" que
   * fica copiado nas despesas vinculadas (usado só pra exibição, ex:
   * "015/2026") fica desatualizado. Pergunta se quer sincronizar.
   */
  async function sincronizarLicitacaoEmDespesas(licitacaoId, numero, ano) {
    const snapshot = await colecaoEntidade("processosDespesa").where("licitacaoId", "==", licitacaoId).get();
    if (snapshot.empty) return;
    if (!confirm(`O número/ano dessa licitação mudou, e ela está vinculada a ${snapshot.size} despesa(s). Atualizar o identificador exibido nelas também?`)) return;
    const novoIdentificador = `${numero}/${ano}`;
    const lote = db.batch();
    snapshot.docs.forEach((doc) => lote.update(doc.ref, { licitacaoIdentificador: novoIdentificador }));
    await lote.commit();
    mostrarToast(`${snapshot.size} despesa(s) atualizada(s) com o novo identificador da licitação.`, "sucesso");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  const filtrosAnexo = configurarFiltrosAnexo(() => aplicarFiltrosLicitacoes());

  async function aplicarFiltrosLicitacoes() {
    const termoOriginal = document.getElementById("campo-busca").value.trim();
    const ano = document.getElementById("filtro-ano").value;
    const filtroAnexo = filtrosAnexo.obterAtivo();
    const lista = document.getElementById("lista-registros");
    const botaoMais = document.getElementById("btn-carregar-mais");

    // Nenhum filtro ativo: volta pro comportamento padrão paginado
    if (!termoOriginal && !ano && !filtroAnexo) {
      paginador = criarPaginador(colecaoEntidade("licitacoes").orderBy("criadoEm", "desc"));
      carregarPagina(true);
      return;
    }

    botaoMais.classList.add("oculto");
    lista.innerHTML = "";

    try {
      let registros;
      // Escolhe a consulta principal (a mais restritiva disponível) e
      // aplica os demais filtros ativos em cima do resultado, no navegador.
      if (termoOriginal) {
        registros = await buscarLicitacoesMultiCampoArray(termoOriginal);
        registros = filtrarPorAnoClientSide(registros, ano);
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else if (ano) {
        const snapshot = await colecaoEntidade("licitacoes").where("ano", "==", parseInt(ano, 10)).get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else {
        const consulta = filtroAnexo === "sem"
          ? colecaoEntidade("licitacoes").where("quantidadeAnexos", "==", 0)
          : colecaoEntidade("licitacoes").where("quantidadeAnexos", ">", 0);
        const snapshot = await consulta.get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }

      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      if (registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  let temporizadorBuscaLicitacoes;
  document.getElementById("campo-busca").addEventListener("input", () => {
    clearTimeout(temporizadorBuscaLicitacoes);
    temporizadorBuscaLicitacoes = setTimeout(() => aplicarFiltrosLicitacoes(), 300);
  });
  document.getElementById("filtro-ano").addEventListener("change", () => aplicarFiltrosLicitacoes());

  carregarPagina(true);

  if (registroPendenteParaAbrir?.chave === "licitacoes") {
    const idPendente = registroPendenteParaAbrir.id;
    registroPendenteParaAbrir = null;
    const doc = await colecaoEntidade("licitacoes").doc(idPendente).get();
    if (doc.exists) abrirFormulario({ id: doc.id, ...doc.data() });
  }
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
      <select id="filtro-ano" class="filtro-ano">${gerarOpcoesAno()}</select>
      <button type="button" class="botao-secundario" id="btn-filtro-sem-anexo">📋 Sem anexo</button>
      <button type="button" class="botao-secundario" id="btn-filtro-com-anexo">📎 Com anexo</button>
      <button type="button" class="botao-secundario" id="btn-selecionar-todos">☑️ Selecionar todos</button>
    </div>
    ${htmlBarraSelecaoExportacao()}
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade(nomeColecao).orderBy("criadoEm", "desc"));
  const gerenciadorSelecao = criarGerenciadorSelecao(nomeColecao);
  gerenciadorSelecao.ligarBotoes();
  const tipos = await carregarOpcoesSelect("tiposDocumento");
  const mapaTipos = Object.fromEntries(tipos.map((t) => [t.id, t.nome]));
  const mapaTipoPorNome = Object.fromEntries(tipos.map((t) => [normalizarTexto(t.nome), t.id]));

  if (usuarioPodeEditar()) {
    const colunasModulo = [
      { chave: "tipo", rotulo: "Tipo", obrigatorio: true, exemplo: tipos[0]?.nome || "Portaria", ajuda: "Precisa ser igual ao nome já cadastrado em Tipos de Documento." },
      { chave: "numero", rotulo: "Número", obrigatorio: true, exemplo: "032/2026" },
      { chave: "ano", rotulo: "Ano", obrigatorio: true, exemplo: new Date().getFullYear() },
      { chave: "objeto", rotulo: "Objeto", obrigatorio: true, exemplo: "Nomeação de servidor" },
    ];
    adicionarBotoesImportExport(document.getElementById("acoes-cabecalho"), {
      titulo: tituloPlural,
      nomeColecao,
      colunas: colunasModulo,
      montarDocumento: async (linha) => {
        const nomeTipo = (linha["Tipo"] || "").toString().trim();
        const numero = (linha["Número"] || "").toString().trim();
        const ano = parseInt(linha["Ano"], 10);
        const objeto = (linha["Objeto"] || "").toString().trim();
        const tipoId = mapaTipoPorNome[normalizarTexto(nomeTipo)];
        if (!tipoId) throw new Error(`Tipo "${nomeTipo}" não encontrado. Cadastre-o antes de importar.`);
        if (!numero) throw new Error("Número é obrigatório.");
        if (!ano) throw new Error("Ano é obrigatório.");
        if (!objeto) throw new Error("Objeto é obrigatório.");
        return {
          tipoId, numero,
          numeroNormalizado: normalizarTexto(numero),
          ano, objeto,
          objetoNormalizado: normalizarTexto(objeto),
          anexos: [],
          quantidadeAnexos: 0,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => ({
        "Tipo": mapaTipos[registro.tipoId] || "",
        "Número": registro.numero || "",
        "Ano": registro.ano || "",
        "Objeto": registro.objeto || "",
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
          <strong>${mapaTipos[registro.tipoId] || "Tipo não informado"} nº ${registro.numero}${registro.ano ? "/" + registro.ano : ""}</strong>
          <div class="texto-secundario">${registro.objeto}</div>
          <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
        </div>
      </div>
      ${
        usuarioPodeEditar()
          ? `<div class="acoes-cartao">
               ${temAnexo(registro) ? `<span class="badge-anexo" title="Tem anexo">📎</span>` : ""}
               <button class="botao-icone" data-acao="editar">✏️</button>
               <button class="botao-icone" data-acao="excluir">🗑️</button>
             </div>`
          : ""
      }
    `;
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("click", (evento) => evento.stopPropagation());
    cartao.querySelector(".checkbox-selecao-registro").addEventListener("change", (evento) =>
      gerenciadorSelecao.alternarSelecao(registro, evento.target.checked)
    );
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
      <label>Ano *</label>
      <input type="number" id="campo-ano" value="${registro?.ano || new Date().getFullYear()}">
      <label>Objeto *</label>
      <textarea id="campo-objeto" rows="3">${registro?.objeto || ""}</textarea>
      <div id="secao-anexos"></div>
    `, async (botaoSalvar) => {
      const campoTipo = document.getElementById("campo-tipo");
      const campoNumero = document.getElementById("campo-numero");
      const campoAno = document.getElementById("campo-ano");
      const campoObjeto = document.getElementById("campo-objeto");
      [campoTipo, campoNumero, campoAno, campoObjeto].forEach(limparCampoInvalido);

      let valido = true;
      if (!campoTipo.value) { marcarCampoInvalido(campoTipo, "Selecione o tipo."); valido = false; }
      if (!campoNumero.value.trim()) { marcarCampoInvalido(campoNumero, "Informe o número."); valido = false; }
      if (!campoAno.value) { marcarCampoInvalido(campoAno, "Informe o ano."); valido = false; }
      if (!campoObjeto.value.trim()) { marcarCampoInvalido(campoObjeto, "Informe o objeto."); valido = false; }
      if (!valido) return;

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          tipoId: campoTipo.value,
          numero: campoNumero.value.trim(),
          numeroNormalizado: normalizarTexto(campoNumero.value),
          ano: parseInt(campoAno.value, 10),
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          anexos: controleAnexos.obterAnexos(),
          quantidadeAnexos: controleAnexos.obterAnexos().length,
        };
        if (registro) {
          await colecaoEntidade(nomeColecao).doc(registro.id).update(dados);
          await registrarHistorico(nomeColecao, registro.id, "editar", `${tituloSingular} nº ${dados.numero} editado.`);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          const referenciaNova = await colecaoEntidade(nomeColecao).add(dados);
          await registrarHistorico(nomeColecao, referenciaNova.id, "criar", `${tituloSingular} nº ${dados.numero} criado.`);
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
      () => {},
      () => {
        const campoTipo = document.getElementById("campo-tipo");
        const tipoTexto = campoTipo?.selectedOptions[0]?.text || "";
        const numero = document.getElementById("campo-numero")?.value.trim();
        const ano = document.getElementById("campo-ano")?.value.trim();
        return tipoTexto && numero && tipoTexto !== "Selecione..." ? `${tipoTexto}-${numero}${ano ? "-" + ano : ""}` : "";
      }
    );
  }

  async function excluirRegistroModulo(registro, botaoExcluir) {
    if (!confirm(`Excluir este registro (${mapaTipos[registro.tipoId] || ""} nº ${registro.numero})? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade(nomeColecao).doc(registro.id).delete();
      await registrarHistorico(nomeColecao, registro.id, "excluir", `${tituloSingular} nº ${registro.numero} excluído.`);
      fecharModal();
      mostrarToast(`${tituloSingular} excluído com sucesso.`, "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  const filtrosAnexo = configurarFiltrosAnexo(() => aplicarFiltrosModulo());

  async function aplicarFiltrosModulo() {
    const termo = document.getElementById("campo-busca").value.trim();
    const ano = document.getElementById("filtro-ano").value;
    const filtroAnexo = filtrosAnexo.obterAtivo();
    const lista = document.getElementById("lista-registros");
    const botaoMais = document.getElementById("btn-carregar-mais");

    if (!termo && !ano && !filtroAnexo) {
      paginador = criarPaginador(colecaoEntidade(nomeColecao).orderBy("criadoEm", "desc"));
      carregarPagina(true);
      return;
    }

    botaoMais.classList.add("oculto");
    lista.innerHTML = "";

    try {
      let registros;
      if (termo) {
        registros = await buscarPorSubstringGenerico(
          nomeColecao,
          termo,
          ["numeroNormalizado", "objetoNormalizado"],
          { campoAno: ano ? "ano" : null, valorAno: ano }
        );
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else if (ano) {
        const snapshot = await colecaoEntidade(nomeColecao).where("ano", "==", parseInt(ano, 10)).get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else {
        const consulta = filtroAnexo === "sem"
          ? colecaoEntidade(nomeColecao).where("quantidadeAnexos", "==", 0)
          : colecaoEntidade(nomeColecao).where("quantidadeAnexos", ">", 0);
        const snapshot = await consulta.get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }

      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      if (registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  let temporizadorBuscaModulo;
  document.getElementById("campo-busca").addEventListener("input", () => {
    clearTimeout(temporizadorBuscaModulo);
    temporizadorBuscaModulo = setTimeout(() => aplicarFiltrosModulo(), 300);
  });
  document.getElementById("filtro-ano").addEventListener("change", () => aplicarFiltrosModulo());

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
      <input type="text" id="campo-busca" placeholder="Buscar por empenho, ordem de pagamento, credor ou objeto...">
      <select id="filtro-ano" class="filtro-ano">${gerarOpcoesAno()}</select>
      <button type="button" class="botao-secundario" id="btn-filtro-sem-anexo">📋 Sem anexo</button>
      <button type="button" class="botao-secundario" id="btn-filtro-com-anexo">📎 Com anexo</button>
      <button type="button" class="botao-secundario" id="btn-selecionar-todos">☑️ Selecionar todos</button>
    </div>
    ${htmlBarraSelecaoExportacao()}
    <div id="lista-registros" class="lista-cartoes"></div>
    <button id="btn-carregar-mais" class="botao-secundario oculto">Carregar mais</button>
  `;

  let paginador = criarPaginador(colecaoEntidade("processosDespesa").orderBy("criadoEm", "desc"));
  const gerenciadorSelecao = criarGerenciadorSelecao("despesas");
  gerenciadorSelecao.ligarBotoes();
  const [unidadesOrc, fontesRecurso] = await Promise.all([
    carregarOpcoesSelect("unidadesOrcamentarias"),
    carregarOpcoesSelect("fontesRecurso"),
  ]);

  // Credores e licitações completos só são baixados quando o usuário
  // realmente clica em Importar ou Exportar — não no carregamento da
  // página, que deve mostrar a lista rápido independente do tamanho
  // dessas outras coleções. O resultado fica em cache (memoizado) pra
  // não buscar de novo se a pessoa importar e exportar na mesma visita.
  let dadosAuxiliaresDespesaCache = null;
  async function obterDadosAuxiliaresDespesa() {
    if (dadosAuxiliaresDespesaCache) return dadosAuxiliaresDespesaCache;
    const [credoresSnapshot, licitacoesSnapshot] = await Promise.all([
      colecaoEntidade("credores").get(),
      colecaoEntidade("licitacoes").get(),
    ]);
    const credoresCompletos = credoresSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    const licitacoesCompletas = licitacoesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    dadosAuxiliaresDespesaCache = {
      mapaCredorPorDocumento: Object.fromEntries(
        credoresCompletos.map((c) => [normalizarDocumento(c.documento), c])
      ),
      mapaCredorPorId: Object.fromEntries(credoresCompletos.map((c) => [c.id, c])),
      mapaLicitacaoPorIdentificador: Object.fromEntries(
        licitacoesCompletas.map((l) => [`${l.numero}/${l.ano}`, l.id])
      ),
    };
    return dadosAuxiliaresDespesaCache;
  }

  if (usuarioPodeEditar()) {
    const mapaUnidadeOrcPorNome = Object.fromEntries(unidadesOrc.map((u) => [normalizarTexto(u.nome), u.id]));
    const mapaUnidadeOrcPorId = Object.fromEntries(unidadesOrc.map((u) => [u.id, u.nome]));
    const mapaFontePorNome = Object.fromEntries(fontesRecurso.map((f) => [normalizarTexto(f.nome), f.id]));
    const mapaFontePorId = Object.fromEntries(fontesRecurso.map((f) => [f.id, f.nome]));

    const colunasDespesas = [
      { chave: "numeroEmpenho", rotulo: "Número do Empenho", obrigatorio: true, exemplo: "0123/2026" },
      { chave: "ordemPagamento", rotulo: "Ordem de Pagamento", obrigatorio: true, exemplo: "045/2026" },
      { chave: "elementoDespesa", rotulo: "Elemento de Despesa", obrigatorio: true, exemplo: "3.3.90.30.00", ajuda: "Formato: 9.9.99.99.99 (ex: 3.3.90.30.00)." },
      { chave: "documentoCredor", rotulo: "CPF/CNPJ do Credor", obrigatorio: true, exemplo: "12.345.678/0001-90", ajuda: "O credor precisa já estar cadastrado em Credores/Fornecedores." },
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
        const { mapaCredorPorDocumento, mapaLicitacaoPorIdentificador } = await obterDadosAuxiliaresDespesa();

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
          numeroEmpenhoNormalizado: normalizarTexto(numeroEmpenho),
          ordemPagamento,
          ordemPagamentoNormalizado: normalizarTexto(ordemPagamento),
          elementoDespesa,
          credorId: credor.id,
          credorNome: credor.nome,
          credorNomeNormalizado: normalizarTexto(credor.nome),
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
          quantidadeAnexos: 0,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        };
      },
      montarLinhaExportacao: async (registro) => {
        const { mapaCredorPorId } = await obterDadosAuxiliaresDespesa();
        return {
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
        };
      },
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
          <strong>Empenho ${registro.numeroEmpenho}</strong> — ${registro.credorNome || ""}
          <div class="texto-secundario">${registro.objeto}</div>
          <div class="texto-secundario">${formatarMoeda(registro.valor)} · Pagamento em ${formatarData(registro.dataPagamento)}</div>
          <div class="texto-secundario">Ordem de Pagamento: ${registro.ordemPagamento || "-"} · Elemento: <span class="num">${registro.elementoDespesa || "-"}</span></div>
          <div class="texto-secundario">${(registro.anexos || []).length} anexo(s)</div>
        </div>
      </div>
      <div class="acoes-cartao">
        ${temAnexo(registro) ? `<span class="badge-anexo" title="Tem anexo">📎</span>` : ""}
        ${registro.licitacaoId ? `<button class="botao-icone" data-acao="ver-vinculada" title="Ver Licitação vinculada">🔗</button>` : ""}
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
    cartao.querySelector('[data-acao="ver-vinculada"]')?.addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirModalResumoLicitacaoVinculada(registro.licitacaoId, evento.currentTarget);
    });
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

      <label>Licitação de origem *</label>
      <input type="text" id="campo-licitacao-busca" placeholder="Digite número/ano para vincular..." value="${registro?.licitacaoIdentificador || ""}" autocomplete="off" ${registro?.semLicitacaoVinculada ? "disabled" : ""}>
      <input type="hidden" id="campo-licitacao-id" value="${registro?.licitacaoId || ""}">
      <div id="resultados-licitacao" class="lista-autocomplete oculto"></div>
      <label class="item-checkbox" style="margin-top:8px">
        <input type="checkbox" id="campo-sem-licitacao" ${registro?.semLicitacaoVinculada ? "checked" : ""}>
        Processo sem licitação vinculada
      </label>
      ${
        registro?.licitacaoId
          ? `<button type="button" class="botao-secundario botao-link-vinculado" id="btn-ver-licitacao-vinculada">🔗 Ver Licitação vinculada</button>`
          : ""
      }

      <label>Folha vinculada (opcional)</label>
      <input type="text" id="campo-folha-busca" placeholder="Digite pra buscar uma folha..." value="${registro?.folhaNome || ""}" autocomplete="off">
      <input type="hidden" id="campo-folha-id" value="${registro?.folhaId || ""}">
      <div id="resultados-folha" class="lista-autocomplete oculto"></div>
      <p class="texto-secundario" style="margin-top:4px">Vincular a uma Folha liga esta despesa a todos os servidores dela, sem precisar vincular um por um.</p>
      ${
        registro?.folhaId
          ? `<button type="button" class="botao-secundario botao-link-vinculado" id="btn-ver-servidores-folha">🔗 Ver Servidores da Folha</button>`
          : ""
      }

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
      const campoLicitacaoId = document.getElementById("campo-licitacao-id");
      const campoSemLicitacao = document.getElementById("campo-sem-licitacao");

      [campoNumeroEmpenho, campoOrdemPagamento, campoElementoDespesa, campoUnidadeOrc, campoFonteRecurso, campoObjeto, campoDataPagamento, campoValor]
        .forEach(limparCampoInvalido);
      limparCampoInvalido(document.getElementById("campo-licitacao-busca"));

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
      if (!campoSemLicitacao.checked && !campoLicitacaoId.value) {
        marcarCampoInvalido(document.getElementById("campo-licitacao-busca"), 'Vincule uma licitação, ou marque "Processo sem licitação vinculada".');
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
          numeroEmpenhoNormalizado: normalizarTexto(campoNumeroEmpenho.value),
          ordemPagamento: campoOrdemPagamento.value.trim(),
          ordemPagamentoNormalizado: normalizarTexto(campoOrdemPagamento.value),
          elementoDespesa: campoElementoDespesa.value.trim(),
          credorId: campoCredorId.value,
          credorNome: document.getElementById("campo-credor-busca").value.trim(),
          credorNomeNormalizado: normalizarTexto(document.getElementById("campo-credor-busca").value),
          unidadeOrcamentariaId: campoUnidadeOrc.value,
          fonteRecursoId: campoFonteRecurso.value,
          licitacaoId: campoSemLicitacao.checked ? null : (document.getElementById("campo-licitacao-id").value || null),
          licitacaoIdentificador: campoSemLicitacao.checked ? null : (document.getElementById("campo-licitacao-busca").value.trim() || null),
          semLicitacaoVinculada: campoSemLicitacao.checked,
          folhaId: document.getElementById("campo-folha-id").value || null,
          folhaNome: document.getElementById("campo-folha-busca").value.trim() || null,
          objeto: campoObjeto.value.trim(),
          objetoNormalizado: normalizarTexto(campoObjeto.value),
          dataPagamento: campoDataPagamento.value,
          // competênciaKey guarda o "AAAA-MM" fixo, útil para filtrar por período
          // sem depender de conversão de fuso na data de pagamento em si.
          competenciaKey: campoDataPagamento.value.slice(0, 7),
          valor: parseFloat(campoValor.value),
          anexos: controleAnexos.obterAnexos(),
          quantidadeAnexos: controleAnexos.obterAnexos().length,
        };
        if (registro) {
          await colecaoEntidade("processosDespesa").doc(registro.id).update(dados);
          await registrarHistorico("processosDespesa", registro.id, "editar", `Empenho ${dados.numeroEmpenho} editado.`);
        } else {
          dados.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
          const referenciaNova = await colecaoEntidade("processosDespesa").add(dados);
          await registrarHistorico("processosDespesa", referenciaNova.id, "criar", `Empenho ${dados.numeroEmpenho} criado.`);
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
      () => {},
      () => {
        const numeroEmpenho = document.getElementById("campo-numero-empenho")?.value.trim();
        const credorNome = document.getElementById("campo-credor-busca")?.value.trim();
        return numeroEmpenho ? `Empenho-${numeroEmpenho}${credorNome ? "-" + credorNome : ""}` : "";
      }
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
      rotulo: (item) => `${item.numero}/${item.ano} — ${item.modalidadeNome || "Modalidade não informada"} — ${item.objeto}`.slice(0, 90),
    });

    modal.querySelector("#btn-ver-licitacao-vinculada")?.addEventListener("click", (evento) => {
      abrirModalResumoLicitacaoVinculada(registro.licitacaoId, evento.target);
    });

    configurarAutocomplete({
      inputBusca: modal.querySelector("#campo-folha-busca"),
      inputId: modal.querySelector("#campo-folha-id"),
      resultadosEl: modal.querySelector("#resultados-folha"),
      buscar: (termo) => buscarRegistrosPorNome("folhas", termo),
      rotulo: (item) => `${item.nome} (${(item.servidoresIds || []).length} servidor(es))`,
    });

    modal.querySelector("#btn-ver-servidores-folha")?.addEventListener("click", (evento) => {
      abrirModalServidoresDaFolha(registro.folhaId, evento.target);
    });

    modal.querySelector("#campo-sem-licitacao").addEventListener("change", (evento) => {
      const campoBusca = modal.querySelector("#campo-licitacao-busca");
      campoBusca.disabled = evento.target.checked;
      if (evento.target.checked) {
        campoBusca.value = "";
        modal.querySelector("#campo-licitacao-id").value = "";
        limparCampoInvalido(campoBusca);
      }
    });
  }

  async function excluirDespesa(registro, botaoExcluir) {
    if (!confirm(`Excluir o processo de despesa "Empenho ${registro.numeroEmpenho}"? Os anexos também serão removidos do Drive.`)) return;
    await executarComFeedback(botaoExcluir, async () => {
      for (const anexo of registro.anexos || []) {
        try { await excluirAnexoDrive(anexo.driveFileId); } catch (e) { console.warn("Falha ao remover anexo do Drive:", e); }
      }
      await colecaoEntidade("processosDespesa").doc(registro.id).delete();
      await registrarHistorico("processosDespesa", registro.id, "excluir", `Empenho ${registro.numeroEmpenho} excluído.`);
      fecharModal();
      mostrarToast("Processo de despesa excluído com sucesso.", "sucesso");
      paginador.reiniciar();
      carregarPagina(true);
    }, "Excluindo...");
  }

  document.getElementById("btn-novo")?.addEventListener("click", () => abrirFormulario());
  document.getElementById("btn-carregar-mais").addEventListener("click", () => carregarPagina(false));

  const filtrosAnexo = configurarFiltrosAnexo(() => aplicarFiltrosDespesas());

  async function aplicarFiltrosDespesas() {
    const termo = document.getElementById("campo-busca").value.trim();
    const ano = document.getElementById("filtro-ano").value;
    const filtroAnexo = filtrosAnexo.obterAtivo();
    const lista = document.getElementById("lista-registros");
    const botaoMais = document.getElementById("btn-carregar-mais");

    if (!termo && !ano && !filtroAnexo) {
      paginador = criarPaginador(colecaoEntidade("processosDespesa").orderBy("criadoEm", "desc"));
      carregarPagina(true);
      return;
    }

    botaoMais.classList.add("oculto");
    lista.innerHTML = "";

    try {
      let registros;
      if (termo) {
        registros = await buscarDespesasMultiCampoArray(termo);
        registros = filtrarPorCompetenciaClientSide(registros, ano);
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else if (ano) {
        const snapshot = await colecaoEntidade("processosDespesa")
          .orderBy("competenciaKey")
          .startAt(`${ano}-01`)
          .endAt(`${ano}-12`)
          .get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        registros = filtrarPorAnexoClientSide(registros, filtroAnexo);
      } else {
        const consulta = filtroAnexo === "sem"
          ? colecaoEntidade("processosDespesa").where("quantidadeAnexos", "==", 0)
          : colecaoEntidade("processosDespesa").where("quantidadeAnexos", ">", 0);
        const snapshot = await consulta.get();
        registros = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }

      registros.forEach((registro) => lista.appendChild(criarCartao(registro)));
      if (registros.length === 0) {
        lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
      }
    } catch (erro) {
      tratarErroConsultaFirestore(erro);
    }
  }

  let temporizadorBuscaDespesas;
  document.getElementById("campo-busca").addEventListener("input", () => {
    clearTimeout(temporizadorBuscaDespesas);
    temporizadorBuscaDespesas = setTimeout(() => aplicarFiltrosDespesas(), 300);
  });
  document.getElementById("filtro-ano").addEventListener("change", () => aplicarFiltrosDespesas());

  carregarPagina(true);

  if (registroPendenteParaAbrir?.chave === "despesas") {
    const idPendente = registroPendenteParaAbrir.id;
    registroPendenteParaAbrir = null;
    const doc = await colecaoEntidade("processosDespesa").doc(idPendente).get();
    if (doc.exists) abrirFormulario({ id: doc.id, ...doc.data() });
  }
}

/**
 * Busca dedicada da Despesa: consulta em paralelo por prefixo em três
 * campos diferentes (número do empenho, credor e objeto) e junta os
 * resultados sem duplicar. O Firestore só permite consulta por prefixo
 * num campo por vez, por isso a necessidade de 3 consultas separadas em
 * vez de uma única "busca em tudo".
 */
/**
 * Busca dedicada da Licitação: consulta em paralelo por prefixo em três
 * campos (número, modalidade e objeto) e, se o termo digitado parecer
 * um ano (4 dígitos), soma também uma busca exata por ano. Junta tudo
 * sem duplicar.
 */
/**
 * Busca licitações por número, modalidade e objeto (e, se digitado no
 * formato "número/ano", filtra os dois juntos). Devolve um array, pra
 * poder ser combinada com outros filtros (ano, sem/com anexo) em cima
 * do resultado.
 */
/**
 * Busca por SUBSTRING (o termo pode estar em qualquer parte do texto,
 * não só no começo) — o Firestore não tem índice nativo pra isso, então
 * busca dentro de um conjunto limitado (pelo ano, se filtrado, ou a
 * coleção toda, que nesses módulos costuma ter no máximo alguns
 * milhares de registros) e filtra no navegador.
 */
async function buscarPorSubstringGenerico(nomeColecao, termoOriginal, camposParaChecar, opcoes = {}) {
  const termoNormalizado = normalizarTexto(termoOriginal);
  if (!termoNormalizado) return [];

  let consulta = colecaoEntidade(nomeColecao);
  if (opcoes.campoAno && opcoes.valorAno) {
    consulta = consulta.where(opcoes.campoAno, "==", parseInt(opcoes.valorAno, 10));
  } else if (opcoes.campoCompetencia && opcoes.valorAnoCompetencia) {
    consulta = consulta
      .orderBy(opcoes.campoCompetencia)
      .startAt(`${opcoes.valorAnoCompetencia}-01`)
      .endAt(`${opcoes.valorAnoCompetencia}-12`);
  }

  const snapshot = await consulta.limit(3000).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((registro) => camposParaChecar.some((campo) => (registro[campo] || "").toString().includes(termoNormalizado)));
}

async function buscarLicitacoesMultiCampoArray(termoOriginal) {
  const [parteNumero, parteAno] = termoOriginal.split("/").map((p) => p.trim());
  const termo = normalizarTexto(parteNumero);
  const anoValido = /^\d{4}$/.test(parteAno || "");
  if (!termo) return [];

  const encontrados = new Map();

  if (anoValido) {
    // Formato "número/ano": busca só por número (prefixo) e depois
    // filtra pelo ano no próprio navegador — evita precisar de um
    // índice composto no Firestore pra cruzar prefixo + igualdade.
    const snapshot = await colecaoEntidade("licitacoes")
      .orderBy("numeroNormalizado")
      .startAt(termo)
      .endAt(termo + "\uf8ff")
      .limit(TAMANHO_PAGINA)
      .get();
    const anoNumero = parseInt(parteAno, 10);
    snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((registro) => registro.ano === anoNumero)
      .forEach((registro) => encontrados.set(registro.id, registro));
  } else {
    // Busca geral por substring: número, modalidade ou objeto contendo
    // o termo em qualquer posição (não só no começo do texto)
    const encontradosLista = await buscarPorSubstringGenerico(
      "licitacoes",
      termo,
      ["numeroNormalizado", "modalidadeNomeNormalizado", "objetoNormalizado"]
    );
    encontradosLista.forEach((registro) => encontrados.set(registro.id, registro));

    if (/^\d{4}$/.test(termoOriginal)) {
      const snapshotAno = await colecaoEntidade("licitacoes").where("ano", "==", parseInt(termoOriginal, 10)).limit(TAMANHO_PAGINA).get();
      snapshotAno.docs.forEach((doc) => {
        if (!encontrados.has(doc.id)) encontrados.set(doc.id, { id: doc.id, ...doc.data() });
      });
    }
  }

  return [...encontrados.values()];
}

/**
 * Busca despesas por empenho, ordem de pagamento, credor, elemento de
 * despesa e objeto. Devolve um array, pra poder ser combinada com
 * outros filtros (ano, sem/com anexo) em cima do resultado.
 */
async function buscarDespesasMultiCampoArray(termoOriginal) {
  const termo = normalizarTexto(termoOriginal);
  if (!termo) return [];

  return buscarPorSubstringGenerico(
    "processosDespesa",
    termo,
    ["numeroEmpenhoNormalizado", "ordemPagamentoNormalizado", "credorNomeNormalizado", "objetoNormalizado", "elementoDespesa"]
  );
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
  const termoOriginal = termo.trim();
  const [parteNumero, parteAno] = termoOriginal.split("/").map((p) => p.trim());
  const termoNormalizado = normalizarTexto(parteNumero);
  if (!termoNormalizado) return [];
  const anoValido = /^\d{4}$/.test(parteAno || "");

  if (anoValido) {
    // Formato "número/ano": número por prefixo, filtrado por ano no navegador
    const snapshot = await colecaoEntidade("licitacoes")
      .orderBy("numeroNormalizado")
      .startAt(termoNormalizado)
      .endAt(termoNormalizado + "\uf8ff")
      .limit(20)
      .get();
    const anoNumero = parseInt(parteAno, 10);
    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((registro) => registro.ano === anoNumero)
      .slice(0, 10);
  }

  const consultas = ["numeroNormalizado", "modalidadeNomeNormalizado"].map((campo) =>
    colecaoEntidade("licitacoes")
      .orderBy(campo)
      .startAt(termoNormalizado)
      .endAt(termoNormalizado + "\uf8ff")
      .limit(10)
      .get()
  );
  if (/^\d{4}$/.test(termoOriginal)) {
    consultas.push(colecaoEntidade("licitacoes").where("ano", "==", parseInt(termoOriginal, 10)).limit(10).get());
  }

  const resultadosPorConsulta = await Promise.all(consultas);
  const encontrados = new Map();
  resultadosPorConsulta.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      if (!encontrados.has(doc.id)) encontrados.set(doc.id, { id: doc.id, ...doc.data() });
    });
  });
  return [...encontrados.values()].slice(0, 10);
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
      try {
        const snapshot = await colecaoEntidade(nomeColecao)
          .orderBy(campoNormalizado)
          .startAt(termo)
          .endAt(termo + "\uf8ff")
          .limit(TAMANHO_PAGINA)
          .get();
        snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
        if (snapshot.empty) {
          lista.innerHTML = `<p class="texto-secundario">Nenhum resultado encontrado.</p>`;
        }
        document.getElementById("btn-carregar-mais").classList.add("oculto");
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });
}
