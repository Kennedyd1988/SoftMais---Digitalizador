// ===================================================================
// IMPORTAÇÃO E EXPORTAÇÃO DE PLANILHAS (XLSX)
// ===================================================================
// Ferramentas genéricas, reaproveitadas pelos 5 módulos que precisam de
// importação/exportação em massa: Credores, Licitações, Processos de
// Despesa, Legislação e Documentos Diversos.

/** Converte uma célula de data da planilha (texto dd/mm/aaaa ou data nativa do Excel) para AAAA-MM-DD */
function converterDataPlanilhaParaIso(valor) {
  if (!valor) return "";
  if (typeof valor === "number") {
    const data = XLSX.SSF.parse_date_code(valor);
    return `${data.y}-${String(data.m).padStart(2, "0")}-${String(data.d).padStart(2, "0")}`;
  }
  const texto = valor.toString().trim();
  const partes = texto.split("/");
  if (partes.length === 3) {
    const [dia, mes, ano] = partes;
    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }
  return texto; // assume que já veio em AAAA-MM-DD
}

/** Remove tudo que não for letra/número, útil pra comparar CPF/CNPJ digitado de formas diferentes */
function normalizarDocumento(texto) {
  return (texto || "").toString().replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Gera o modelo de planilha para importação: uma aba de instruções
 * explicando cada coluna e como os identificadores conectam com outros
 * cadastros, e uma aba "Dados" já com uma linha de exemplo preenchida.
 */
function baixarModeloPlanilha(tituloModulo, colunas) {
  const linhasInstrucao = [
    [`Modelo de importação — ${tituloModulo}`],
    [""],
    ["Coluna", "Obrigatório?", "Como preencher"],
    ...colunas.map((c) => [c.rotulo, c.obrigatorio ? "Sim" : "Não", c.ajuda || ""]),
    [""],
    ["Preencha a aba \"Dados\" a partir da linha 2 (a linha de exemplo pode ser apagada)."],
    ["Não altere os nomes das colunas na primeira linha da aba \"Dados\"."],
  ];
  const planilhaInstrucoes = XLSX.utils.aoa_to_sheet(linhasInstrucao);
  planilhaInstrucoes["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 60 }];

  const linhaExemplo = {};
  colunas.forEach((c) => (linhaExemplo[c.rotulo] = c.exemplo || ""));
  const planilhaDados = XLSX.utils.json_to_sheet([linhaExemplo], {
    header: colunas.map((c) => c.rotulo),
  });

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilhaInstrucoes, "Instruções");
  XLSX.utils.book_append_sheet(livro, planilhaDados, "Dados");
  XLSX.writeFile(livro, `modelo-${normalizarNomeArquivo(tituloModulo)}.xlsx`);
}

/** Exporta uma lista de linhas (já em formato de planilha) para um arquivo XLSX */
function exportarParaPlanilha(tituloModulo, colunas, linhas) {
  const planilha = XLSX.utils.json_to_sheet(linhas, { header: colunas.map((c) => c.rotulo) });
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Dados");
  const dataHoje = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(livro, `${normalizarNomeArquivo(tituloModulo)}-${dataHoje}.xlsx`);
}

function normalizarNomeArquivo(texto) {
  return normalizarTexto(texto).replace(/\s+/g, "-");
}

/** Lê a aba "Dados" de um arquivo XLSX enviado pelo usuário */
function lerPlanilhaImportacao(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (evento) => {
      try {
        const livro = XLSX.read(evento.target.result, { type: "array" });
        const nomeAba = livro.SheetNames.includes("Dados") ? "Dados" : livro.SheetNames[0];
        const linhas = XLSX.utils.sheet_to_json(livro.Sheets[nomeAba], { defval: "" });
        resolve(linhas);
      } catch (erro) {
        reject(new Error("Não foi possível ler o arquivo. Confira se é uma planilha .xlsx válida."));
      }
    };
    leitor.onerror = () => reject(new Error("Erro ao ler o arquivo."));
    leitor.readAsArrayBuffer(arquivo);
  });
}

/**
 * Grava uma lista de documentos na coleção indicada, em lotes (nunca um
 * por um em sequência), respeitando o limite de 500 operações por lote
 * do Firestore.
 */
async function gravarDocumentosEmLotes(nomeColecao, documentos) {
  const TAMANHO_LOTE = 400;
  let gravados = 0;
  for (let inicio = 0; inicio < documentos.length; inicio += TAMANHO_LOTE) {
    const lote = db.batch();
    const fatia = documentos.slice(inicio, inicio + TAMANHO_LOTE);
    fatia.forEach((documento) => {
      const referencia = colecaoEntidade(nomeColecao).doc();
      lote.set(referencia, documento);
    });
    await lote.commit();
    gravados += fatia.length;
  }
  return gravados;
}

/**
 * Adiciona os botões "Modelo", "Importar" e "Exportar" num cabeçalho de
 * página, e liga toda a lógica de ler o arquivo, validar, resolver
 * referências (ex: nome da modalidade → ID) e gravar em lotes.
 *
 * @param {HTMLElement} container - onde inserir os botões
 * @param {Object} opcoes
 *   titulo: string
 *   nomeColecao: string
 *   colunas: [{ chave, rotulo, obrigatorio, exemplo, ajuda }]
 *   montarDocumento: async (linhaPlanilha) => { dados } ou lança Error com o motivo
 *   montarLinhaExportacao: async (registro) => objeto simples pra planilha
 */
function adicionarBotoesImportExport(container, opcoes) {
  const grupo = document.createElement("div");
  grupo.className = "grupo-botoes-planilha";
  grupo.innerHTML = `
    <button type="button" class="botao-secundario" id="btn-modelo-planilha">📄 Modelo</button>
    <button type="button" class="botao-secundario" id="btn-importar-planilha">⬆️ Importar</button>
    <button type="button" class="botao-secundario" id="btn-exportar-planilha">⬇️ Exportar</button>
    <input type="file" id="campo-arquivo-planilha" accept=".xlsx" class="oculto">
  `;
  container.appendChild(grupo);

  grupo.querySelector("#btn-modelo-planilha").addEventListener("click", () => {
    baixarModeloPlanilha(opcoes.titulo, opcoes.colunas);
  });

  const inputArquivo = grupo.querySelector("#campo-arquivo-planilha");
  grupo.querySelector("#btn-importar-planilha").addEventListener("click", () => inputArquivo.click());

  inputArquivo.addEventListener("change", async () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) return;
    inputArquivo.value = "";

    const botao = grupo.querySelector("#btn-importar-planilha");
    await executarComFeedback(botao, async () => {
      try {
        const linhas = await lerPlanilhaImportacao(arquivo);
        if (linhas.length === 0) {
          mostrarToast("A planilha não tem nenhuma linha de dados.", "erro");
          return;
        }

        const documentosValidos = [];
        const erros = [];

        for (let i = 0; i < linhas.length; i++) {
          try {
            const dados = await opcoes.montarDocumento(linhas[i]);
            documentosValidos.push(dados);
          } catch (erroLinha) {
            erros.push(`Linha ${i + 2}: ${erroLinha.message}`);
          }
        }

        if (documentosValidos.length > 0) {
          await gravarDocumentosEmLotes(opcoes.nomeColecao, documentosValidos);
        }

        mostrarResumoImportacao(documentosValidos.length, erros);
        if (documentosValidos.length > 0 && opcoes.aoImportarComSucesso) {
          opcoes.aoImportarComSucesso();
        }
      } catch (erro) {
        mostrarToast(erro.message, "erro");
      }
    }, "Importando...");
  });

  grupo.querySelector("#btn-exportar-planilha").addEventListener("click", async () => {
    const botao = grupo.querySelector("#btn-exportar-planilha");
    await executarComFeedback(botao, async () => {
      const snapshot = await colecaoEntidade(opcoes.nomeColecao).get();
      const linhas = [];
      for (const doc of snapshot.docs) {
        const linha = await opcoes.montarLinhaExportacao({ id: doc.id, ...doc.data() });
        linhas.push(linha);
      }
      if (linhas.length === 0) {
        mostrarToast("Não há registros para exportar.", "info");
        return;
      }
      exportarParaPlanilha(opcoes.titulo, opcoes.colunas, linhas);
    }, "Exportando...");
  });
}

function mostrarResumoImportacao(totalImportado, erros) {
  const corpo = `
    <p><strong>${totalImportado}</strong> registro(s) importado(s) com sucesso.</p>
    ${
      erros.length > 0
        ? `<p><strong>${erros.length}</strong> linha(s) com erro (não foram importadas):</p>
           <div class="lista-erros-importacao">${erros.map((e) => `<div>${e}</div>`).join("")}</div>`
        : ""
    }
  `;
  const modal = document.createElement("div");
  modal.className = "fundo-modal";
  modal.innerHTML = `
    <div class="caixa-modal">
      <div class="cabecalho-modal"><h3>Resultado da importação</h3>
        <button class="botao-fechar-modal" id="btn-fechar-resumo">✕</button>
      </div>
      <div class="corpo-modal">${corpo}</div>
      <div class="rodape-modal"><button class="botao-primario" id="btn-ok-resumo">OK</button></div>
    </div>
  `;
  document.body.appendChild(modal);
  const fechar = () => modal.remove();
  modal.querySelector("#btn-fechar-resumo").addEventListener("click", fechar);
  modal.querySelector("#btn-ok-resumo").addEventListener("click", fechar);
}
