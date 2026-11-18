// ===================================================================
// EXPORTAR PDFs EM PASTAS — gera .zip com a estrutura
//   Módulo / Ano / Subdivisão / Registro / "Vol N - arquivo.pdf"
// com opção de exportar tudo ou filtrar (módulo, período, texto e
// subdivisões específicas).
//
// Por que é uma tela própria (e não um botão em cada lista): o filtro
// precisa cruzar módulos e anos, e o usuário quer conferir quantos PDFs
// e quantos MB serão baixados ANTES de iniciar.
// ===================================================================

// Limite por .zip. O navegador monta o zip em memória; acima de ~1,5 GB
// ele costuma travar ou falhar, por isso dividimos em "Parte 1, 2, 3...".
const LIMITE_BYTES_POR_ZIP = 1.2 * 1024 * 1024 * 1024;
const TAMANHO_ESTIMADO_SEM_DADO = 5 * 1024 * 1024; // quando o anexo não tem tamanhoBytes
const DOWNLOADS_SIMULTANEOS = 3;

/** Definição de cada módulo exportável: coleção, como achar ano e subdivisão, e nome da pasta do registro */
const MODULOS_EXPORTAVEIS = [
  { chave: "licitacoes", aba: "licitacoes", colecao: "licitacoes", pasta: "Licitações" },
  { chave: "despesas", aba: "despesas", colecao: "processosDespesa", pasta: "Processos de Despesa" },
  { chave: "legislacao", aba: "legislacao", colecao: "legislacao", pasta: "Legislação" },
  { chave: "documentosDiversos", aba: "documentosDiversos", colecao: "documentosDiversos", pasta: "Documentos Diversos" },
  // RH: só estes dois módulos têm PDFs (Servidores e Folhas são cadastros sem anexo).
  // Usam o campo "exercicio" (e não "ano") para o período.
  { chave: "processosPessoal", aba: "processosPessoal", colecao: "processosPessoal", pasta: "Processos de Pessoal", campoAno: "exercicio" },
  { chave: "atosAdministrativos", aba: "atosAdministrativos", colecao: "atosAdministrativos", pasta: "Atos Administrativos", campoAno: "exercicio" },
];

/**
 * Deixa o texto seguro como nome de pasta/arquivo (Windows é o mais
 * restritivo: proíbe \ / : * ? " < > | e não aceita nome terminando em
 * ponto ou espaço). O limite de tamanho evita estourar os 260 caracteres
 * de caminho total do Windows ao extrair o zip.
 */
function nomeSeguroParaPasta(texto, limite = 60) {
  let nome = String(texto ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (nome.length > limite) nome = nome.slice(0, limite).trim();
  nome = nome.replace(/[. ]+$/g, "");
  return nome || "Sem nome";
}

/** Lê uma coleção inteira em lotes de 500 (cursor), aplicando o filtro de período no servidor */
async function lerColecaoEmLotes(modulo, anoInicial, anoFinal) {
  let consulta = colecaoEntidade(modulo.colecao);
  if (modulo.chave === "despesas") {
    // Despesas guardam o período em competenciaKey ("AAAA-MM"): um único filtro de intervalo.
    if (anoInicial || anoFinal) {
      consulta = consulta.orderBy("competenciaKey");
      if (anoInicial) consulta = consulta.where("competenciaKey", ">=", `${anoInicial}-01`);
      if (anoFinal) consulta = consulta.where("competenciaKey", "<=", `${anoFinal}-12`);
    } else {
      consulta = consulta.orderBy(firebase.firestore.FieldPath.documentId());
    }
  } else if (anoInicial || anoFinal) {
    const campoAno = modulo.campoAno || "ano";
    consulta = consulta.orderBy(campoAno);
    if (anoInicial) consulta = consulta.where(campoAno, ">=", anoInicial);
    if (anoFinal) consulta = consulta.where(campoAno, "<=", anoFinal);
  } else {
    // documentId (e não criadoEm) para não perder registros importados que não têm esse campo.
    consulta = consulta.orderBy(firebase.firestore.FieldPath.documentId());
  }

  const docs = [];
  let cursor = null;
  while (true) {
    let paginaConsulta = consulta.limit(500);
    if (cursor) paginaConsulta = paginaConsulta.startAfter(cursor);
    const snapshot = await paginaConsulta.get();
    snapshot.docs.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    if (snapshot.docs.length < 500) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  return docs;
}

/** Converte um registro em { ano, subdivisao, nomePastaRegistro } conforme o módulo */
function descreverRegistroParaPasta(modulo, r, mapas) {
  const juntar = (...partes) => partes.filter((p) => p !== undefined && p !== null && String(p).trim() !== "").join(" - ");
  const numeroComAno = (numero, ano) =>
    ano && !String(numero ?? "").includes(String(ano)) ? `${numero}-${ano}` : `${numero ?? ""}`;

  if (modulo.chave === "licitacoes") {
    return {
      ano: r.ano ? String(r.ano) : "Sem ano",
      subdivisao: r.modalidadeNome || "Sem modalidade",
      nomePastaRegistro: juntar(numeroComAno(r.numero, r.ano), r.objeto),
    };
  }
  if (modulo.chave === "despesas") {
    const ano = (r.competenciaKey || "").slice(0, 4);
    return {
      ano: ano || "Sem ano",
      subdivisao: mapas.unidades[r.unidadeOrcamentariaId] || "Sem unidade orçamentária",
      nomePastaRegistro: juntar(r.competenciaKey, `Empenho ${r.numeroEmpenho ?? ""}`.trim(), r.credorNome),
    };
  }
  if (modulo.chave === "processosPessoal") {
    // Exercício pode estar vazio em registros antigos; a competência ("AAAA-MM") serve de reserva.
    const ano = r.exercicio || (r.competencia || "").slice(0, 4);
    return {
      ano: ano ? String(ano) : "Sem ano",
      subdivisao: r.tipoNome || "Sem tipo",
      nomePastaRegistro: juntar(r.competencia, r.servidorNome, r.observacoes),
    };
  }
  if (modulo.chave === "atosAdministrativos") {
    const ano = r.exercicio || (r.dataEmissao || "").slice(0, 4);
    return {
      ano: ano ? String(ano) : "Sem ano",
      subdivisao: r.tipoNome || "Sem tipo",
      nomePastaRegistro: juntar(`${r.tipoNome || "Ato"} nº ${numeroComAno(r.numero, r.exercicio)}`, r.descricao),
    };
  }
  return {
    ano: r.ano ? String(r.ano) : "Sem ano",
    subdivisao: mapas.tipos[r.tipoId] || "Sem tipo",
    nomePastaRegistro: juntar(numeroComAno(r.numero, r.ano), r.objeto),
  };
}

/** Texto para o filtro de busca livre (número, objeto, credor) */
function textoBuscavelDoRegistro(r) {
  return normalizarTexto([r.numero, r.objeto, r.numeroEmpenho, r.credorNome, r.servidorNome, r.descricao, r.observacoes, r.tipoNome].filter(Boolean).join(" "));
}

async function renderizarExportarPastas(area) {
  const modulosPermitidos = MODULOS_EXPORTAVEIS.filter((m) => usuarioTemAcessoAba(m.aba));
  area.innerHTML = `
    <div class="cabecalho-pagina"><h2>📦 Exportar PDFs em Pastas</h2></div>
    <p class="texto-secundario">Gera um ou mais arquivos .zip com os PDFs organizados em
    <strong>Módulo / Ano / Subdivisão / Registro / Volume</strong> (inclui os módulos de RH). Sem nenhum filtro, exporta tudo.</p>

    <div class="cartao-manutencao">
      <label>Módulos</label>
      <div class="lista-checkboxes" id="exp-modulos">
        ${modulosPermitidos.map((m) => `
          <label class="item-checkbox"><input type="checkbox" value="${m.chave}" checked> ${m.pasta}</label>
        `).join("")}
      </div>
      <div class="linha-formulario">
        <div><label>Ano inicial (opcional)</label><input type="number" id="exp-ano-inicial" min="1900" max="2100" placeholder="ex: 2022"></div>
        <div><label>Ano final (opcional)</label><input type="number" id="exp-ano-final" min="1900" max="2100" placeholder="ex: 2024"></div>
      </div>
      <label>Contém o texto (opcional — número, objeto ou credor)</label>
      <input type="text" id="exp-texto" placeholder="ex: pavimentação">
      <div style="margin-top:12px">
        <button type="button" class="botao-primario" id="exp-btn-carregar">🔍 Carregar e conferir</button>
      </div>
      <div id="exp-progresso-carga" class="texto-secundario" style="margin-top:8px"></div>
    </div>

    <div id="exp-resultado" class="oculto"></div>
  `;

  let selecaoAtual = null; // { itens: [...], grupos: [...] }
  let cancelar = false;

  document.getElementById("exp-btn-carregar").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget;
    const chaves = [...document.querySelectorAll("#exp-modulos input:checked")].map((i) => i.value);
    if (chaves.length === 0) { mostrarToast("Marque pelo menos um módulo.", "erro"); return; }
    const anoInicial = parseInt(document.getElementById("exp-ano-inicial").value, 10) || null;
    const anoFinal = parseInt(document.getElementById("exp-ano-final").value, 10) || null;
    if (anoInicial && anoFinal && anoInicial > anoFinal) {
      mostrarToast("O ano inicial não pode ser maior que o final.", "erro");
      return;
    }
    const termo = normalizarTexto(document.getElementById("exp-texto").value);

    botao.disabled = true;
    const status = document.getElementById("exp-progresso-carga");
    try {
      // Nomes são lidos frescos (regra do projeto: não copiar dado vivo).
      status.textContent = "Carregando cadastros...";
      const [tiposSnap, unidadesSnap] = await Promise.all([
        colecaoEntidade("tiposDocumento").get(),
        colecaoEntidade("unidadesOrcamentarias").get(),
      ]);
      const mapas = {
        tipos: Object.fromEntries(tiposSnap.docs.map((d) => [d.id, d.data().nome])),
        unidades: Object.fromEntries(unidadesSnap.docs.map((d) => [d.id, d.data().nome])),
      };

      const itens = []; // um item por PDF
      for (const chave of chaves) {
        const modulo = MODULOS_EXPORTAVEIS.find((m) => m.chave === chave);
        status.textContent = `Carregando ${modulo.pasta}...`;
        const registros = await lerColecaoEmLotes(modulo, anoInicial, anoFinal);
        for (const r of registros) {
          if (!(r.anexos || []).length) continue;
          if (termo && !textoBuscavelDoRegistro(r).includes(termo)) continue;
          const desc = descreverRegistroParaPasta(modulo, r, mapas);
          (r.anexos || []).forEach((anexo) => {
            if (!anexo.driveFileId) return;
            itens.push({ modulo, registro: r, desc, anexo });
          });
        }
      }

      // Agrupa por módulo + subdivisão para o usuário poder desmarcar partes.
      const mapaGrupos = new Map();
      itens.forEach((it) => {
        const chaveGrupo = `${it.modulo.chave}||${it.desc.subdivisao}`;
        if (!mapaGrupos.has(chaveGrupo)) {
          mapaGrupos.set(chaveGrupo, { chaveGrupo, modulo: it.modulo, subdivisao: it.desc.subdivisao, quantidade: 0, bytes: 0 });
        }
        const g = mapaGrupos.get(chaveGrupo);
        g.quantidade++;
        g.bytes += it.anexo.tamanhoBytes || 0;
      });
      const grupos = [...mapaGrupos.values()].sort((a, b) =>
        a.modulo.pasta.localeCompare(b.modulo.pasta, "pt-BR") || a.subdivisao.localeCompare(b.subdivisao, "pt-BR"));

      selecaoAtual = { itens, grupos };
      status.textContent = "";
      desenharResultado();
    } catch (erro) {
      console.error(erro);
      status.textContent = "";
      mostrarToast("Erro ao carregar os registros: " + erro.message, "erro");
    } finally {
      botao.disabled = false;
    }
  });

  function itensSelecionados() {
    const marcados = new Set([...document.querySelectorAll("#exp-grupos input:checked")].map((i) => i.value));
    return selecaoAtual.itens.filter((it) => marcados.has(`${it.modulo.chave}||${it.desc.subdivisao}`));
  }

  function atualizarResumo() {
    const sel = itensSelecionados();
    const bytes = sel.reduce((s, it) => s + (it.anexo.tamanhoBytes || 0), 0);
    const partes = Math.max(1, Math.ceil(bytes / LIMITE_BYTES_POR_ZIP));
    document.getElementById("exp-resumo").innerHTML =
      `<strong>${sel.length}</strong> PDF(s) selecionado(s) · ${formatarTamanhoArquivo(bytes)} · ` +
      `aproximadamente <strong>${sel.length ? partes : 0}</strong> arquivo(s) .zip`;
    document.getElementById("exp-btn-exportar").disabled = sel.length === 0;
  }

  function desenharResultado() {
    const alvo = document.getElementById("exp-resultado");
    alvo.classList.remove("oculto");
    if (selecaoAtual.itens.length === 0) {
      alvo.innerHTML = `<p class="texto-secundario">Nenhum PDF encontrado com esses filtros.</p>`;
      return;
    }
    alvo.innerHTML = `
      <div class="cartao-manutencao">
        <h3>Conferência</h3>
        <p class="texto-secundario">Desmarque o que não quiser exportar.</p>
        <div class="lista-checkboxes" id="exp-grupos" style="max-height:320px">
          ${selecaoAtual.grupos.map((g) => `
            <label class="item-checkbox">
              <input type="checkbox" value="${escaparHtml(g.chaveGrupo)}" checked>
              ${escaparHtml(g.modulo.pasta)} / ${escaparHtml(g.subdivisao)}
              <span class="texto-secundario">— ${g.quantidade} PDF(s), ${formatarTamanhoArquivo(g.bytes)}</span>
            </label>
          `).join("")}
        </div>
        <p id="exp-resumo" style="margin-top:10px"></p>
        <div style="margin-top:8px">
          <button type="button" class="botao-primario" id="exp-btn-exportar">📦 Exportar em pastas (.zip)</button>
          <button type="button" class="botao-secundario oculto" id="exp-btn-cancelar">Cancelar</button>
        </div>
        <div class="barra-progresso-container oculto" id="exp-barra" style="margin-top:10px"><div class="barra-progresso-preenchimento" id="exp-barra-preenchimento"></div></div>
        <p class="texto-secundario" id="exp-status-exportacao"></p>
      </div>`;
    document.getElementById("exp-grupos").addEventListener("change", atualizarResumo);
    document.getElementById("exp-btn-exportar").addEventListener("click", iniciarExportacao);
    document.getElementById("exp-btn-cancelar").addEventListener("click", () => { cancelar = true; });
    atualizarResumo();
  }

  async function iniciarExportacao() {
    const sel = itensSelecionados();
    if (sel.length === 0) return;
    cancelar = false;
    const botao = document.getElementById("exp-btn-exportar");
    const botaoCancelar = document.getElementById("exp-btn-cancelar");
    const barra = document.getElementById("exp-barra");
    const preenchimento = document.getElementById("exp-barra-preenchimento");
    const status = document.getElementById("exp-status-exportacao");
    botao.disabled = true;
    botaoCancelar.classList.remove("oculto");
    barra.classList.remove("oculto");

    try {
      // 1) Define o caminho de cada PDF dentro do zip, sem colisão de nomes.
      const caminhosUsados = new Set();
      const pastasRegistro = new Map(); // id do registro → pasta já definida
      const usarCaminhoUnico = (caminho) => {
        let final = caminho, n = 2;
        while (caminhosUsados.has(final.toLowerCase())) {
          final = caminho.replace(/(\.[^./]+)?$/, ` (${n})$1`);
          n++;
        }
        caminhosUsados.add(final.toLowerCase());
        return final;
      };
      sel.forEach((it) => {
        const idUnico = `${it.modulo.chave}/${it.registro.id}`;
        if (!pastasRegistro.has(idUnico)) {
          const base = [
            nomeSeguroParaPasta(it.modulo.pasta, 40),
            nomeSeguroParaPasta(it.desc.ano, 20),
            nomeSeguroParaPasta(it.desc.subdivisao, 50),
            nomeSeguroParaPasta(it.desc.nomePastaRegistro, 70),
          ].join("/");
          // Dois registros com o mesmo número/objeto não podem cair na mesma pasta.
          let pasta = base, n = 2;
          while ([...pastasRegistro.values()].includes(pasta)) { pasta = `${base} (${n})`; n++; }
          pastasRegistro.set(idUnico, pasta);
        }
        const volume = it.anexo.volume || 1;
        let nomeArquivo = nomeSeguroParaPasta(it.anexo.nomeArquivo || "documento.pdf", 100);
        if (!/^vol/i.test(nomeArquivo)) nomeArquivo = `Vol ${volume} - ${nomeArquivo}`;
        it.caminho = usarCaminhoUnico(`${pastasRegistro.get(idUnico)}/${nomeArquivo}`);
      });
      // Ordem estável: assim as partes do zip ficam agrupadas por pasta.
      sel.sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR", { numeric: true }));

      // 2) Divide em partes pelo tamanho conhecido.
      const partes = [];
      let parteAtual = [], bytesParte = 0;
      sel.forEach((it) => {
        const tam = it.anexo.tamanhoBytes || TAMANHO_ESTIMADO_SEM_DADO;
        if (parteAtual.length && bytesParte + tam > LIMITE_BYTES_POR_ZIP) {
          partes.push(parteAtual); parteAtual = []; bytesParte = 0;
        }
        parteAtual.push(it); bytesParte += tam;
      });
      if (parteAtual.length) partes.push(parteAtual);

      // 3) Baixa e monta cada parte.
      const total = sel.length;
      let concluidos = 0;
      const falhas = [];
      const carimbo = new Date().toISOString().slice(0, 10);
      const nomeEntidade = nomeSeguroParaPasta(estado.entidadeAtualNome || "entidade", 30).replace(/ /g, "_");

      for (let p = 0; p < partes.length; p++) {
        if (cancelar) break;
        const zip = new JSZip();
        const fila = [...partes[p]];
        const linhasIndice = ["Caminho;Módulo;Ano;Subdivisão;Arquivo original"];

        const trabalhador = async () => {
          while (fila.length && !cancelar) {
            const it = fila.shift();
            try {
              const token = await obterAccessTokenDrive(); // renova sozinho (token dura 1h)
              const blob = await baixarComProgresso(
                `https://www.googleapis.com/drive/v3/files/${it.anexo.driveFileId}?alt=media&supportsAllDrives=true`, token);
              zip.file(it.caminho, blob);
              linhasIndice.push([it.caminho, it.modulo.pasta, it.desc.ano, it.desc.subdivisao, it.anexo.nomeArquivo]
                .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"));
            } catch (erro) {
              console.warn("Falha ao baixar", it.caminho, erro);
              falhas.push(it.caminho);
            }
            concluidos++;
            preenchimento.style.width = `${Math.round((concluidos / total) * 100)}%`;
            status.textContent = `Baixando PDFs... ${concluidos} de ${total} (parte ${p + 1} de ${partes.length})`;
          }
        };
        await Promise.all(Array.from({ length: DOWNLOADS_SIMULTANEOS }, trabalhador));
        if (cancelar) break;

        zip.file("_indice.csv", "﻿" + linhasIndice.join("\r\n"));
        if (falhas.length) {
          zip.file("_arquivos_com_erro.txt", "Estes PDFs não puderam ser baixados:\r\n" + falhas.join("\r\n"));
        }
        status.textContent = `Compactando parte ${p + 1} de ${partes.length}...`;
        // STORE: PDF já é compactado, então comprimir de novo só gasta tempo e memória.
        const blobZip = await zip.generateAsync({ type: "blob", compression: "STORE" });
        const nomeZip = `${nomeEntidade}_PDFs_${carimbo}${partes.length > 1 ? `_parte${p + 1}de${partes.length}` : ""}.zip`;
        const url = URL.createObjectURL(blobZip);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeZip;
        link.click();
        // Dá tempo ao navegador de iniciar o download antes de liberar o blob e de pedir o próximo.
        await new Promise((r) => setTimeout(r, 1500));
        URL.revokeObjectURL(url);
      }

      if (cancelar) {
        status.textContent = "Exportação cancelada.";
      } else {
        status.textContent = falhas.length
          ? `Concluído, mas ${falhas.length} PDF(s) falharam (listados em _arquivos_com_erro.txt).`
          : `Concluído: ${total} PDF(s) em ${partes.length} arquivo(s) .zip.`;
        mostrarToast("Exportação concluída.", "sucesso");
      }
    } catch (erro) {
      console.error(erro);
      mostrarToast("Erro na exportação: " + erro.message, "erro");
    } finally {
      botao.disabled = false;
      botaoCancelar.classList.add("oculto");
    }
  }
}
