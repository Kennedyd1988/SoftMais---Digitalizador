// ===================================================================
// MANUTENÇÃO — reindexação em massa (só administrador)
// ===================================================================
// Sempre que um campo de busca novo é adicionado ao sistema (ex:
// numeroEmpenhoNormalizado), registros cadastrados antes dessa mudança
// não têm esse campo gravado, e ficam "invisíveis" pra busca até serem
// salvos de novo. Abrir um por um não é viável com muitos registros —
// essa tela varre a coleção inteira e corrige em lote.

async function renderizarManutencao(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Manutenção</h2>
    </div>
    <p class="texto-secundario">
      Ferramentas para corrigir registros cadastrados antes de alguma
      atualização do sistema, sem precisar abrir um por um.
    </p>

    <div class="cartao-manutencao">
      <h3>Reindexar campos de busca — Processos de Despesa</h3>
      <p class="texto-secundario">
        Preenche os campos internos usados na busca (número do empenho,
        ordem de pagamento, credor, objeto) e a contagem de anexos (usada
        no filtro "Sem anexo") em processos de despesa cadastrados antes
        desses recursos existirem. Não altera nenhum dado visível do
        registro, só os campos de apoio à busca/filtro.
      </p>
      <button class="botao-primario" id="btn-reindexar-despesas">Reindexar Processos de Despesa</button>
      <div id="resultado-despesas" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Preencher contagem de anexos — Licitações</h3>
      <p class="texto-secundario">
        Preenche os campos internos usados na busca (número e modalidade)
        e a contagem de anexos (usada nos filtros "Sem anexo"/"Com anexo")
        em licitações cadastradas antes desses recursos existirem.
      </p>
      <button class="botao-primario" id="btn-reindexar-licitacoes">Reindexar Licitações</button>
      <div id="resultado-licitacoes" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>Preencher Ano e contagem de anexos — Legislação e Documentos Diversos</h3>
      <p class="texto-secundario">
        Esses dois módulos ganharam o campo "Ano" depois de já existirem
        registros cadastrados. Esta ferramenta tenta descobrir o ano
        automaticamente a partir do número (quando estiver no formato
        "123/2026", por exemplo), e já aproveita pra preencher a contagem
        de anexos também. Registros em que não for possível identificar o
        ano automaticamente ficam listados para você preencher manualmente.
      </p>
      <button class="botao-primario" id="btn-reindexar-legislacao">Reindexar Legislação</button>
      <div id="resultado-legislacao" class="resultado-manutencao"></div>
      <button class="botao-primario" id="btn-reindexar-documentos" style="margin-top:10px">Reindexar Documentos Diversos</button>
      <div id="resultado-documentos" class="resultado-manutencao"></div>
    </div>

    <div class="cartao-manutencao">
      <h3>⚙️ Atualização em Massa</h3>
      <p class="texto-secundario">
        Atualiza o mesmo campo em vários registros de uma coleção de uma
        vez só. Sempre confira a contagem/seleção antes de aplicar — não
        tem como desfazer automaticamente depois.
      </p>

      <label>Coleção</label>
      <select id="massa-colecao">
        <option value="credores">Credores/Fornecedores</option>
        <option value="licitacoes">Licitações</option>
        <option value="processosDespesa">Processos de Despesa</option>
        <option value="legislacao">Legislação</option>
        <option value="documentosDiversos">Documentos Diversos</option>
        <option value="modalidadesLicitacao">Modalidades de Licitação</option>
        <option value="unidadesOrcamentarias">Unidades Orçamentárias</option>
        <option value="fontesRecurso">Fontes de Recurso</option>
        <option value="tiposDocumento">Tipos de Documento</option>
      </select>

      <label>Campo a atualizar *</label>
      <select id="massa-campo-atualizar"></select>

      <div id="massa-area-novo-valor">
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor" placeholder="Ex: 2026, true, Nome novo...">
        <p class="texto-secundario" style="margin-top:4px" id="massa-ajuda-valor">Números e "true"/"false" são convertidos automaticamente; qualquer outro texto é gravado como texto mesmo.</p>
      </div>

      <label style="margin-top:18px">Quais registros atualizar?</label>
      <div class="lista-checkboxes" style="flex-direction:row; gap:18px; padding:10px">
        <label class="item-checkbox"><input type="radio" name="massa-modo" value="filtro" checked> Filtrar por critério</label>
        <label class="item-checkbox"><input type="radio" name="massa-modo" value="lista"> Selecionar da lista</label>
      </div>

      <div id="massa-bloco-filtro">
        <div class="linha-formulario">
          <div><input type="text" id="massa-filtro-campo" placeholder="Campo do filtro (ex: ano)"></div>
          <div><input type="text" id="massa-filtro-valor" placeholder="Valor (ex: 2025)"></div>
        </div>
        <p class="texto-secundario" style="margin-top:4px">Deixe os dois em branco pra afetar todos os registros da coleção.</p>
        <button type="button" class="botao-secundario" id="btn-contar-massa" style="margin-top:8px">🔎 Contar registros afetados</button>
      </div>

      <div id="massa-bloco-lista" class="oculto">
        <input type="text" id="massa-busca-registros" placeholder="Digite pra buscar os registros...">
        <div id="massa-lista-resultados" class="lista-checkboxes" style="max-height:240px; margin-top:8px"></div>
        <p class="texto-secundario" id="massa-contagem-selecionados" style="margin-top:6px">0 registro(s) selecionado(s).</p>
      </div>

      <button type="button" class="botao-primario" id="btn-aplicar-massa" disabled style="margin-top:16px">✅ Aplicar atualização</button>
      <div id="resultado-massa" class="resultado-manutencao"></div>
    </div>
  `;

  configurarAtualizacaoEmMassa();

  document.getElementById("btn-reindexar-despesas").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os processos de despesa da unidade gestora atual. Pode levar alguns segundos dependendo da quantidade. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-despesas");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await reindexarDespesas((feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      resultadoEl.innerHTML = `
        <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} atualizado(s).</p>
      `;
      mostrarToast("Reindexação de despesas concluída.", "sucesso");
    }, "Reindexando...");
  });

  document.getElementById("btn-reindexar-licitacoes").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todas as licitações da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-licitacoes");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await reindexarLicitacoes((feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      resultadoEl.innerHTML = `
        <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} atualizado(s).</p>
      `;
      mostrarToast("Reindexação de licitações concluída.", "sucesso");
    }, "Reindexando...");
  });

  document.getElementById("btn-reindexar-legislacao").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Legislação da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-legislacao");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("legislacao", (feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      exibirResultadoAno("resultado-legislacao", resultado);
      mostrarToast("Preenchimento de ano (Legislação) concluído.", "sucesso");
    }, "Processando...");
  });

  document.getElementById("btn-reindexar-documentos").addEventListener("click", async (evento) => {
    if (!confirm("Isso vai revisar todos os registros de Documentos Diversos da unidade gestora atual. Continuar?")) return;
    const resultadoEl = document.getElementById("resultado-documentos");
    const barra = criarBarraProgressoInline(resultadoEl, "Gravando");
    await executarComFeedback(evento.target, async () => {
      const resultado = await preencherAnoAutomatico("documentosDiversos", (feitos, total) => barra.atualizar(feitos, total, "Gravando"));
      barra.remover();
      exibirResultadoAno("resultado-documentos", resultado);
      mostrarToast("Preenchimento de ano (Documentos Diversos) concluído.", "sucesso");
    }, "Processando...");
  });

  // ---------- Atualização em Massa ----------
  let docsAfetadosMassa = null;

  document.getElementById("btn-contar-massa").addEventListener("click", async (evento) => {
    const colecao = document.getElementById("massa-colecao").value;
    const filtroCampo = document.getElementById("massa-filtro-campo").value.trim();
    const filtroValorTexto = document.getElementById("massa-filtro-valor").value.trim();
    const resultadoEl = document.getElementById("resultado-massa");
    const botaoAplicar = document.getElementById("btn-aplicar-massa");

    await executarComFeedback(evento.target, async () => {
      try {
        let consulta = colecaoEntidade(colecao);
        if (filtroCampo && filtroValorTexto) {
          consulta = consulta.where(filtroCampo, "==", converterValorMassa(filtroValorTexto));
        }
        const snapshot = await consulta.get();
        docsAfetadosMassa = snapshot.docs;
        resultadoEl.innerHTML = `<p>🔎 <strong>${snapshot.size}</strong> registro(s) seriam afetados com esse filtro.</p>`;
        botaoAplicar.disabled = snapshot.size === 0;
      } catch (erro) {
        docsAfetadosMassa = null;
        botaoAplicar.disabled = true;
        tratarErroConsultaFirestore(erro);
      }
    }, "Contando...");
  });

  document.getElementById("btn-aplicar-massa").addEventListener("click", async (evento) => {
    const colecao = document.getElementById("massa-colecao").value;
    const campoAtualizar = document.getElementById("massa-campo-atualizar").value.trim();
    const novoValorTexto = document.getElementById("massa-novo-valor").value;
    const resultadoEl = document.getElementById("resultado-massa");

    if (!campoAtualizar) {
      mostrarToast("Informe qual campo você quer atualizar.", "erro");
      return;
    }
    if (!docsAfetadosMassa) {
      mostrarToast('Clique em "Contar registros afetados" antes de aplicar.', "erro");
      return;
    }

    const novoValor = converterValorMassa(novoValorTexto);
    if (!confirm(`Isso vai gravar o campo "${campoAtualizar}" = "${novoValorTexto}" em ${docsAfetadosMassa.length} registro(s) da coleção. Não tem como desfazer automaticamente depois. Continuar?`)) return;

    await executarComFeedback(evento.target, async () => {
      const barra = criarBarraProgressoInline(resultadoEl, "Atualizando");
      try {
        const TAMANHO_LOTE = 400;
        let feitos = 0;
        for (let inicio = 0; inicio < docsAfetadosMassa.length; inicio += TAMANHO_LOTE) {
          const lote = db.batch();
          const fatia = docsAfetadosMassa.slice(inicio, inicio + TAMANHO_LOTE);
          fatia.forEach((doc) => {
            lote.update(colecaoEntidade(colecao).doc(doc.id), { [campoAtualizar]: novoValor });
          });
          await lote.commit();
          feitos += fatia.length;
          barra.atualizar(feitos, docsAfetadosMassa.length, "Atualizando");
        }
        barra.remover();
        resultadoEl.innerHTML = `<p>✅ ${feitos} registro(s) atualizado(s) com sucesso.</p>`;
        mostrarToast("Atualização em massa concluída.", "sucesso");
        docsAfetadosMassa = null;
        document.getElementById("btn-aplicar-massa").disabled = true;
      } catch (erro) {
        barra.remover();
        tratarErroConsultaFirestore(erro);
      }
    }, "Aplicando...");
  });
}

// ===================================================================
// ATUALIZAÇÃO EM MASSA — metadados de campos por coleção
// ===================================================================
// Lista de campos conhecidos de cada coleção, pra popular o dropdown
// "Campo a atualizar" (em vez de digitar o nome livre, sujeito a erro
// de digitação). Quando um campo tem "relacionado", ele referencia um
// documento de outra coleção — nesse caso, em vez de digitar o ID, a
// ferramenta mostra um dropdown com os registros daquela coleção pra
// escolher pelo nome, e grava o ID por trás dos panos.
const CAMPOS_POR_COLECAO = {
  credores: [
    { campo: "tipo", rotulo: "Tipo (PF/PJ)" },
    { campo: "nome", rotulo: "Nome/Razão Social" },
    { campo: "documento", rotulo: "CPF/CNPJ" },
    { campo: "telefone", rotulo: "Telefone" },
    { campo: "email", rotulo: "E-mail" },
  ],
  licitacoes: [
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "modalidadeId", rotulo: "Modalidade", relacionado: "modalidadesLicitacao" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  processosDespesa: [
    { campo: "numeroEmpenho", rotulo: "Número do Empenho" },
    { campo: "ordemPagamento", rotulo: "Ordem de Pagamento" },
    { campo: "elementoDespesa", rotulo: "Elemento de Despesa" },
    { campo: "credorId", rotulo: "Credor/Fornecedor", relacionado: "credores" },
    { campo: "unidadeOrcamentariaId", rotulo: "Unidade Orçamentária", relacionado: "unidadesOrcamentarias" },
    { campo: "fonteRecursoId", rotulo: "Fonte de Recurso", relacionado: "fontesRecurso" },
    { campo: "licitacaoId", rotulo: "Licitação de origem", relacionado: "licitacoes" },
    { campo: "objeto", rotulo: "Objeto" },
    { campo: "dataPagamento", rotulo: "Data de Pagamento (AAAA-MM-DD)" },
    { campo: "valor", rotulo: "Valor" },
  ],
  legislacao: [
    { campo: "tipoId", rotulo: "Tipo", relacionado: "tiposDocumento" },
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  documentosDiversos: [
    { campo: "tipoId", rotulo: "Tipo", relacionado: "tiposDocumento" },
    { campo: "numero", rotulo: "Número" },
    { campo: "ano", rotulo: "Ano" },
    { campo: "objeto", rotulo: "Objeto" },
  ],
  modalidadesLicitacao: [{ campo: "nome", rotulo: "Nome" }],
  unidadesOrcamentarias: [{ campo: "nome", rotulo: "Nome" }, { campo: "codigo", rotulo: "Código" }],
  fontesRecurso: [{ campo: "nome", rotulo: "Nome" }, { campo: "codigo", rotulo: "Código" }],
  tiposDocumento: [{ campo: "nome", rotulo: "Nome" }],
};

/** Campos usados pra buscar/pesquisar registros de cada coleção (busca por prefixo, um ou mais campos por coleção) */
const CAMPOS_BUSCA_POR_COLECAO = {
  credores: ["nomeNormalizado"],
  modalidadesLicitacao: ["nomeNormalizado"],
  unidadesOrcamentarias: ["nomeNormalizado"],
  fontesRecurso: ["nomeNormalizado"],
  tiposDocumento: ["nomeNormalizado"],
  licitacoes: ["numeroNormalizado", "modalidadeNomeNormalizado", "objetoNormalizado"],
  processosDespesa: ["numeroEmpenhoNormalizado", "ordemPagamentoNormalizado", "credorNomeNormalizado", "objetoNormalizado"],
  legislacao: ["objetoNormalizado"],
  documentosDiversos: ["objetoNormalizado"],
};

/** Busca registros de uma coleção em vários campos ao mesmo tempo, juntando os resultados sem duplicar */
async function buscarRegistrosMultiCampoMassa(colecao, termo) {
  const termoNormalizado = normalizarTexto(termo);
  if (!termoNormalizado) return [];
  const campos = CAMPOS_BUSCA_POR_COLECAO[colecao] || ["nomeNormalizado"];
  const consultas = campos.map((campo) =>
    colecaoEntidade(colecao)
      .orderBy(campo)
      .startAt(termoNormalizado)
      .endAt(termoNormalizado + "\uf8ff")
      .limit(20)
      .get()
  );
  const resultadosPorConsulta = await Promise.all(consultas);
  const encontrados = new Map();
  resultadosPorConsulta.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      if (!encontrados.has(doc.id)) encontrados.set(doc.id, { id: doc.id, ...doc.data() });
    });
  });
  return [...encontrados.values()];
}

/**
 * Quando um campo relacionado é alterado, alguns dados denormalizados
 * (nomes copiados por conveniência de exibição) precisam ser
 * atualizados junto, senão ficam "desencontrados" do vínculo real.
 * Cada função recebe os dados do registro relacionado escolhido e
 * devolve os campos extras a gravar.
 */
const DENORMALIZACOES_MASSA = {
  "processosDespesa.credorId": (d) => ({ credorNome: d.nome, credorNomeNormalizado: d.nomeNormalizado }),
  "processosDespesa.licitacaoId": (d) => ({ licitacaoIdentificador: `${d.numero}/${d.ano}` }),
  "licitacoes.modalidadeId": (d) => ({ modalidadeNome: d.nome, modalidadeNomeNormalizado: d.nomeNormalizado }),
};

/** Monta um rótulo legível pra um registro qualquer, tentando os campos mais prováveis */
function rotularRegistroMassa(dados) {
  if (dados.numeroEmpenho) return `Empenho ${dados.numeroEmpenho} — ${dados.credorNome || ""}`;
  if (dados.numero && dados.ano) {
    const modalidade = dados.modalidadeNome ? ` — ${dados.modalidadeNome}` : "";
    const objeto = dados.objeto ? ` — ${dados.objeto.slice(0, 50)}` : "";
    return `${dados.numero}/${dados.ano}${modalidade}${objeto}`;
  }
  if (dados.nome) return dados.codigo ? `${dados.codigo} — ${dados.nome}` : dados.nome;
  if (dados.objeto) return dados.objeto.slice(0, 70);
  return "(sem identificação)";
}

function converterValorMassa(texto) {
  if (texto === "true") return true;
  if (texto === "false") return false;
  if (texto.trim() !== "" && !isNaN(texto) && !isNaN(parseFloat(texto))) return parseFloat(texto);
  return texto;
}

function configurarAtualizacaoEmMassa() {
  const seletorColecao = document.getElementById("massa-colecao");
  const seletorCampo = document.getElementById("massa-campo-atualizar");
  const areaNovoValor = document.getElementById("massa-area-novo-valor");
  const botaoAplicar = document.getElementById("btn-aplicar-massa");
  const resultadoEl = document.getElementById("resultado-massa");

  let docsAfetadosMassa = null; // modo "filtro"
  const selecionadosMassa = new Map(); // modo "lista": id -> dados

  function popularCamposDaColecao() {
    const colecao = seletorColecao.value;
    const campos = CAMPOS_POR_COLECAO[colecao] || [];
    seletorCampo.innerHTML = campos.map((c) => `<option value="${c.campo}" data-relacionado="${c.relacionado || ""}">${c.rotulo}</option>`).join("");
    atualizarAreaNovoValor();
    resetarSelecoes();
  }

  async function atualizarAreaNovoValor() {
    const opcaoSelecionada = seletorCampo.selectedOptions[0];
    const relacionado = opcaoSelecionada?.dataset.relacionado;

    if (relacionado) {
      areaNovoValor.innerHTML = `
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor-busca" placeholder="Digite pra buscar..." autocomplete="off">
        <input type="hidden" id="massa-novo-valor-id">
        <div id="massa-novo-valor-resultados" class="lista-autocomplete oculto"></div>
        <p class="texto-secundario" style="margin-top:4px">Escolha o registro correto de "${relacionado}" — o vínculo (ID) é gravado automaticamente, e nomes copiados por conveniência (se houver) são sincronizados junto.</p>
      `;
      configurarAutocomplete({
        inputBusca: document.getElementById("massa-novo-valor-busca"),
        inputId: document.getElementById("massa-novo-valor-id"),
        resultadosEl: document.getElementById("massa-novo-valor-resultados"),
        buscar: (termo) => buscarRegistrosMultiCampoMassa(relacionado, termo),
        rotulo: (item) => rotularRegistroMassa(item),
      });
    } else {
      areaNovoValor.innerHTML = `
        <label>Novo valor *</label>
        <input type="text" id="massa-novo-valor" placeholder="Ex: 2026, true, Nome novo...">
        <p class="texto-secundario" style="margin-top:4px">Números e "true"/"false" são convertidos automaticamente; qualquer outro texto é gravado como texto mesmo.</p>
      `;
    }
  }

  function resetarSelecoes() {
    docsAfetadosMassa = null;
    selecionadosMassa.clear();
    botaoAplicar.disabled = true;
    resultadoEl.innerHTML = "";
    document.getElementById("massa-lista-resultados").innerHTML = "";
    document.getElementById("massa-contagem-selecionados").textContent = "0 registro(s) selecionado(s).";
  }

  seletorColecao.addEventListener("change", popularCamposDaColecao);
  seletorCampo.addEventListener("change", () => { atualizarAreaNovoValor(); resetarSelecoes(); });
  popularCamposDaColecao();

  // ---------- Alternar entre "Filtrar por critério" e "Selecionar da lista" ----------
  document.querySelectorAll('input[name="massa-modo"]').forEach((radio) => {
    radio.addEventListener("change", (evento) => {
      document.getElementById("massa-bloco-filtro").classList.toggle("oculto", evento.target.value !== "filtro");
      document.getElementById("massa-bloco-lista").classList.toggle("oculto", evento.target.value !== "lista");
      resetarSelecoes();
    });
  });

  // ---------- Modo "Filtrar por critério" ----------
  document.getElementById("btn-contar-massa").addEventListener("click", async (evento) => {
    const colecao = seletorColecao.value;
    const filtroCampo = document.getElementById("massa-filtro-campo").value.trim();
    const filtroValorTexto = document.getElementById("massa-filtro-valor").value.trim();

    await executarComFeedback(evento.target, async () => {
      try {
        let consulta = colecaoEntidade(colecao);
        if (filtroCampo && filtroValorTexto) {
          consulta = consulta.where(filtroCampo, "==", converterValorMassa(filtroValorTexto));
        }
        const snapshot = await consulta.get();
        docsAfetadosMassa = snapshot.docs;
        resultadoEl.innerHTML = `<p>🔎 <strong>${snapshot.size}</strong> registro(s) seriam afetados com esse filtro.</p>`;
        botaoAplicar.disabled = snapshot.size === 0;
      } catch (erro) {
        docsAfetadosMassa = null;
        botaoAplicar.disabled = true;
        tratarErroConsultaFirestore(erro);
      }
    }, "Contando...");
  });

  // ---------- Modo "Selecionar da lista" ----------
  let temporizadorBuscaMassa;
  document.getElementById("massa-busca-registros").addEventListener("input", (evento) => {
    clearTimeout(temporizadorBuscaMassa);
    temporizadorBuscaMassa = setTimeout(async () => {
      const colecao = seletorColecao.value;
      const termo = evento.target.value.trim();
      const listaEl = document.getElementById("massa-lista-resultados");
      if (!termo) { listaEl.innerHTML = ""; return; }

      try {
        const registros = await buscarRegistrosMultiCampoMassa(colecao, termo);
        listaEl.innerHTML = registros.map((dados) => {
          const marcado = selecionadosMassa.has(dados.id);
          return `
            <label class="item-checkbox">
              <input type="checkbox" data-id="${dados.id}" ${marcado ? "checked" : ""}>
              ${rotularRegistroMassa(dados)}
            </label>
          `;
        }).join("") || `<p class="texto-secundario">Nenhum resultado.</p>`;

        listaEl.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
          checkbox.addEventListener("change", async (ev) => {
            const id = ev.target.dataset.id;
            if (ev.target.checked) {
              const doc = await colecaoEntidade(colecao).doc(id).get();
              selecionadosMassa.set(id, doc.data());
            } else {
              selecionadosMassa.delete(id);
            }
            document.getElementById("massa-contagem-selecionados").textContent = `${selecionadosMassa.size} registro(s) selecionado(s).`;
            botaoAplicar.disabled = selecionadosMassa.size === 0;
          });
        });
      } catch (erro) {
        tratarErroConsultaFirestore(erro);
      }
    }, 300);
  });

  // ---------- Aplicar ----------
  botaoAplicar.addEventListener("click", async (evento) => {
    const colecao = seletorColecao.value;
    const campoAtualizar = seletorCampo.value;
    const modo = document.querySelector('input[name="massa-modo"]:checked').value;

    const opcaoCampo = seletorCampo.selectedOptions[0];
    const relacionado = opcaoCampo?.dataset.relacionado;
    let novoValor;
    let extrasDenormalizados = {};

    if (relacionado) {
      const campoIdOculto = document.getElementById("massa-novo-valor-id");
      if (!campoIdOculto?.value) { mostrarToast("Busque e selecione o novo valor na lista de sugestões.", "erro"); return; }
      novoValor = campoIdOculto.value;
      const docRelacionado = await colecaoEntidade(relacionado).doc(novoValor).get();
      const funcaoDenormalizacao = DENORMALIZACOES_MASSA[`${colecao}.${campoAtualizar}`];
      if (funcaoDenormalizacao && docRelacionado.exists) {
        extrasDenormalizados = funcaoDenormalizacao(docRelacionado.data());
      }
    } else {
      const inputTexto = document.getElementById("massa-novo-valor");
      novoValor = converterValorMassa(inputTexto.value);
    }

    const idsAlvo = modo === "filtro"
      ? (docsAfetadosMassa || []).map((d) => d.id)
      : [...selecionadosMassa.keys()];

    if (idsAlvo.length === 0) {
      mostrarToast(modo === "filtro" ? 'Clique em "Contar registros afetados" antes.' : "Selecione ao menos um registro na lista.", "erro");
      return;
    }

    if (!confirm(`Isso vai atualizar o campo "${campoAtualizar}" em ${idsAlvo.length} registro(s). Não tem como desfazer automaticamente depois. Continuar?`)) return;

    await executarComFeedback(evento.target, async () => {
      const barra = criarBarraProgressoInline(resultadoEl, "Atualizando");
      try {
        const TAMANHO_LOTE = 400;
        let feitos = 0;
        for (let inicio = 0; inicio < idsAlvo.length; inicio += TAMANHO_LOTE) {
          const lote = db.batch();
          const fatia = idsAlvo.slice(inicio, inicio + TAMANHO_LOTE);
          fatia.forEach((id) => {
            lote.update(colecaoEntidade(colecao).doc(id), { [campoAtualizar]: novoValor, ...extrasDenormalizados });
          });
          await lote.commit();
          feitos += fatia.length;
          barra.atualizar(feitos, idsAlvo.length, "Atualizando");
        }
        barra.remover();
        resultadoEl.innerHTML = `<p>✅ ${feitos} registro(s) atualizado(s) com sucesso.</p>`;
        mostrarToast("Atualização em massa concluída.", "sucesso");
        docsAfetadosMassa = null;
        selecionadosMassa.clear();
        botaoAplicar.disabled = true;
      } catch (erro) {
        barra.remover();
        tratarErroConsultaFirestore(erro);
      }
    }, "Aplicando...");
  });
}
function exibirResultadoAno(idElemento, resultado) {
  const el = document.getElementById(idElemento);
  el.innerHTML = `
    <p>✅ ${resultado.totalRevisados} registro(s) revisado(s), ${resultado.totalAtualizados} preenchido(s) automaticamente.</p>
    ${
      resultado.naoIdentificados.length > 0
        ? `<p>⚠️ ${resultado.naoIdentificados.length} registro(s) sem ano identificável — precisam ser preenchidos manualmente:</p>
           <div class="lista-erros-importacao">${resultado.naoIdentificados.map((n) => `<div>${n}</div>`).join("")}</div>`
        : ""
    }
  `;
}

/**
 * Varre todos os processos de despesa e recalcula os campos normalizados
 * de busca a partir dos dados que já existem no registro (não pede nada
 * novo ao usuário, só corrige o que já deveria ter sido salvo).
 */
async function reindexarDespesas(aoProgredir) {
  const snapshot = await colecaoEntidade("processosDespesa").get();
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    const numeroEmpenhoNormalizadoEsperado = normalizarTexto(dados.numeroEmpenho || "");
    if (dados.numeroEmpenhoNormalizado !== numeroEmpenhoNormalizadoEsperado) {
      atualizacao.numeroEmpenhoNormalizado = numeroEmpenhoNormalizadoEsperado;
    }

    const ordemPagamentoNormalizadoEsperado = normalizarTexto(dados.ordemPagamento || "");
    if (dados.ordemPagamentoNormalizado !== ordemPagamentoNormalizadoEsperado) {
      atualizacao.ordemPagamentoNormalizado = ordemPagamentoNormalizadoEsperado;
    }

    const credorNomeNormalizadoEsperado = normalizarTexto(dados.credorNome || "");
    if (dados.credorNomeNormalizado !== credorNomeNormalizadoEsperado) {
      atualizacao.credorNomeNormalizado = credorNomeNormalizadoEsperado;
    }

    const objetoNormalizadoEsperado = normalizarTexto(dados.objeto || "");
    if (dados.objetoNormalizado !== objetoNormalizadoEsperado) {
      atualizacao.objetoNormalizado = objetoNormalizadoEsperado;
    }

    // Aproveita e corrige a competenciaKey também, se a data existir mas a chave não bater
    if (dados.dataPagamento) {
      const competenciaEsperada = dados.dataPagamento.slice(0, 7);
      if (dados.competenciaKey !== competenciaEsperada) {
        atualizacao.competenciaKey = competenciaEsperada;
      }
    }

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes("processosDespesa", documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/**
 * Varre Legislação ou Documentos Diversos procurando registros sem o
 * campo "ano", e tenta descobrir o ano a partir do número (formato
 * comum "123/2026"). Quando não consegue, lista o registro pra
 * preenchimento manual.
 */
async function preencherAnoAutomatico(nomeColecao, aoProgredir) {
  const snapshot = await colecaoEntidade(nomeColecao).get();
  const documentosParaAtualizar = [];
  const naoIdentificados = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    if (!dados.ano) {
      const correspondencia = (dados.numero || "").match(/(\d{4})/);
      const anoEncontrado = correspondencia ? parseInt(correspondencia[1], 10) : null;
      const anoValido = anoEncontrado && anoEncontrado >= 1990 && anoEncontrado <= new Date().getFullYear() + 1;

      if (anoValido) {
        atualizacao.ano = anoEncontrado;
      } else {
        naoIdentificados.push(`${dados.numero || "(sem número)"} — ${(dados.objeto || "").slice(0, 60)}`);
      }
    }

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
    naoIdentificados,
  };
}

/** Preenche só a contagem de anexos (usada pelo filtro "Sem anexo") — usado por Licitações */
/** Preenche número/modalidade normalizados e contagem de anexos em Licitações (usado pela busca nova) */
async function reindexarLicitacoes(aoProgredir) {
  const [snapshot, modalidades] = await Promise.all([
    colecaoEntidade("licitacoes").get(),
    carregarOpcoesSelect("modalidadesLicitacao"),
  ]);
  const mapaModalidades = Object.fromEntries(modalidades.map((m) => [m.id, m.nome]));
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const atualizacao = {};

    const numeroNormalizadoEsperado = normalizarTexto(dados.numero || "");
    if (dados.numeroNormalizado !== numeroNormalizadoEsperado) {
      atualizacao.numeroNormalizado = numeroNormalizadoEsperado;
    }

    const modalidadeNomeEsperado = mapaModalidades[dados.modalidadeId] || "";
    if (dados.modalidadeNome !== modalidadeNomeEsperado) {
      atualizacao.modalidadeNome = modalidadeNomeEsperado;
      atualizacao.modalidadeNomeNormalizado = normalizarTexto(modalidadeNomeEsperado);
    }

    const objetoNormalizadoEsperado = normalizarTexto(dados.objeto || "");
    if (dados.objetoNormalizado !== objetoNormalizadoEsperado) {
      atualizacao.objetoNormalizado = objetoNormalizadoEsperado;
    }

    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      atualizacao.quantidadeAnexos = quantidadeAnexosEsperada;
    }

    if (Object.keys(atualizacao).length > 0) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao });
    }
  });

  await aplicarAtualizacoesEmLotes("licitacoes", documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/** Preenche só a contagem de anexos (usada pelo filtro "Sem anexo") — utilitário genérico */
async function reindexarQuantidadeAnexos(nomeColecao, aoProgredir) {
  const snapshot = await colecaoEntidade(nomeColecao).get();
  const documentosParaAtualizar = [];

  snapshot.docs.forEach((doc) => {
    const dados = doc.data();
    const quantidadeAnexosEsperada = (dados.anexos || []).length;
    if (dados.quantidadeAnexos !== quantidadeAnexosEsperada) {
      documentosParaAtualizar.push({ id: doc.id, atualizacao: { quantidadeAnexos: quantidadeAnexosEsperada } });
    }
  });

  await aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir);

  return {
    totalRevisados: snapshot.size,
    totalAtualizados: documentosParaAtualizar.length,
  };
}

/** Aplica uma lista de atualizações parciais em lotes (nunca documento por documento em sequência) */
async function aplicarAtualizacoesEmLotes(nomeColecao, documentosParaAtualizar, aoProgredir) {
  const TAMANHO_LOTE = 400;
  let feitos = 0;
  const total = documentosParaAtualizar.length;
  aoProgredir?.(0, total);
  for (let inicio = 0; inicio < documentosParaAtualizar.length; inicio += TAMANHO_LOTE) {
    const lote = db.batch();
    const fatia = documentosParaAtualizar.slice(inicio, inicio + TAMANHO_LOTE);
    fatia.forEach(({ id, atualizacao }) => {
      lote.update(colecaoEntidade(nomeColecao).doc(id), atualizacao);
    });
    await lote.commit();
    feitos += fatia.length;
    aoProgredir?.(feitos, total);
  }
}
