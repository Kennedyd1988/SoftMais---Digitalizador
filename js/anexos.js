// ===================================================================
// COMPONENTE DE ANEXOS (PDF) — organizados por Volume
// ===================================================================
// Reaproveitado por Licitações, Despesas, Legislação e Documentos
// Diversos. Cada anexo fica marcado com um número de Volume, permitindo
// agrupar vários PDFs (ex: "Volume 1", "Volume 2") dentro do mesmo
// processo, do jeito que os processos físicos costumam ser organizados.

/**
 * Renderiza a seção de anexos dentro de um formulário/modal.
 * @param {HTMLElement} container - onde desenhar a seção
 * @param {Array} anexosIniciais - lista de anexos já salvos no registro
 * @param {string} nomeModulo - usado para organizar as pastas no Drive
 * @param {Function} aoMudar - chamado sempre que a lista de anexos muda,
 *                             recebe a lista atualizada
 * @param {Function} [obterNomeBase] - função que lê os campos atuais do
 *   formulário e devolve um texto (ex: "Empenho-203002-Fulano") usado
 *   para renomear o PDF automaticamente. Se não for informada, mantém
 *   o nome original do arquivo enviado.
 */
function renderizarSecaoAnexos(container, anexosIniciais, nomeModulo, aoMudar, obterNomeBase = null) {
  let anexos = [...(anexosIniciais || [])];

  container.innerHTML = `
    <div class="secao-anexos">
      <div class="cabecalho-secao-anexos">
        <label>Anexos (PDF)</label>
        <div class="controles-novo-anexo">
          <input type="number" id="campo-volume" min="1" value="1" title="Número do volume" style="width:70px">
          <label for="campo-volume" class="rotulo-inline">Volume</label>
          <input type="file" id="campo-arquivo-pdf" accept="application/pdf" class="oculto">
          <button type="button" class="botao-secundario" id="btn-selecionar-pdf">+ Adicionar PDF</button>
        </div>
      </div>
      <div id="status-upload-anexo" class="oculto">
        <div class="texto-status-upload" id="texto-status-upload"></div>
        <div class="barra-progresso-container" id="barra-progresso-container">
          <div class="barra-progresso-preenchimento" id="barra-progresso-preenchimento" style="width:0%"></div>
        </div>
      </div>
      <div id="lista-anexos-por-volume"></div>
    </div>
  `;

  const inputArquivo = container.querySelector("#campo-arquivo-pdf");
  const botaoSelecionar = container.querySelector("#btn-selecionar-pdf");
  const statusUpload = container.querySelector("#status-upload-anexo");
  const textoStatusUpload = container.querySelector("#texto-status-upload");
  const barraProgressoContainer = container.querySelector("#barra-progresso-container");
  const barraProgressoPreenchimento = container.querySelector("#barra-progresso-preenchimento");

  botaoSelecionar.addEventListener("click", () => inputArquivo.click());

  inputArquivo.addEventListener("change", () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) return;
    processarNovoArquivo(arquivo);
  });

  async function processarNovoArquivo(arquivoOriginal) {
    const volume = parseInt(container.querySelector("#campo-volume").value, 10) || 1;
    const arquivo = renomearConformeCadastro(arquivoOriginal, volume);

    botaoSelecionar.disabled = true;
    statusUpload.classList.remove("oculto");
    barraProgressoPreenchimento.style.width = "0%";

    try {
      const novoAnexo = await enviarPdfParaDrive(arquivo, nomeModulo, (mensagem, percentual) => {
        textoStatusUpload.textContent =
          percentual !== undefined ? `${mensagem} ${percentual}%` : mensagem;
        barraProgressoPreenchimento.style.width = `${percentual ?? 0}%`;
      });
      novoAnexo.volume = volume;
      anexos.push(novoAnexo);
      redesenharListaAnexos();
      aoMudar(anexos);
      mostrarToast("Anexo enviado com sucesso.", "sucesso");
    } catch (erro) {
      console.error(erro);
      mostrarToast(erro.message || "Erro ao enviar o anexo.", "erro");
    } finally {
      botaoSelecionar.disabled = false;
      statusUpload.classList.add("oculto");
      barraProgressoPreenchimento.style.width = "0%";
      inputArquivo.value = "";
    }
  }

  /** Renomeia o PDF com base nos dados já digitados no formulário no momento do envio */
  function renomearConformeCadastro(arquivo, volume) {
    if (!obterNomeBase) return arquivo;

    const nomeBase = sanitizarNomeArquivo(obterNomeBase());
    if (!nomeBase) return arquivo; // campos ainda vazios — mantém o nome original

    // Evita nomes repetidos quando já existe mais de um anexo no mesmo volume
    const quantosNesseVolume = anexos.filter((a) => (a.volume || 1) === volume).length;
    const sufixo = quantosNesseVolume > 0 ? `-${quantosNesseVolume + 1}` : "";
    const nomeFinal = `${nomeBase}-Vol${volume}${sufixo}.pdf`;

    return new File([arquivo], nomeFinal, { type: arquivo.type || "application/pdf" });
  }

  function redesenharListaAnexos() {
    const listaEl = container.querySelector("#lista-anexos-por-volume");
    listaEl.innerHTML = "";

    if (anexos.length === 0) {
      listaEl.innerHTML = `<p class="texto-secundario">Nenhum anexo ainda.</p>`;
      return;
    }

    // Agrupa por volume, em ordem crescente
    const volumes = [...new Set(anexos.map((a) => a.volume || 1))].sort((a, b) => a - b);

    volumes.forEach((numeroVolume) => {
      const grupo = document.createElement("div");
      grupo.className = "grupo-volume";
      grupo.innerHTML = `<div class="titulo-volume">Volume ${numeroVolume}</div>`;

      anexos
        .filter((a) => (a.volume || 1) === numeroVolume)
        .forEach((anexo) => {
          const linha = document.createElement("div");
          linha.className = "linha-anexo-wrapper";
          linha.innerHTML = `
            <div class="linha-anexo">
              <span class="nome-anexo">📄 ${anexo.nomeArquivo} <span class="texto-secundario">(${anexo.paginas} pág. · ${formatarTamanhoArquivo(anexo.tamanhoBytes)})</span></span>
              <div class="acoes-anexo">
                <button type="button" class="botao-icone" title="Visualizar" data-acao="ver">👁️</button>
                <button type="button" class="botao-icone" title="Baixar" data-acao="baixar">⬇️</button>
                <button type="button" class="botao-icone" title="Remover" data-acao="remover">🗑️</button>
              </div>
            </div>
            <div class="barra-progresso-container oculto" id="barra-${anexo.driveFileId}">
              <div class="barra-progresso-preenchimento" style="width:0%"></div>
            </div>
          `;
          const containerBarra = linha.querySelector(`#barra-${anexo.driveFileId}`);
          const preenchimentoBarra = containerBarra.querySelector(".barra-progresso-preenchimento");
          const atualizarBarra = (percentual) => {
            containerBarra.classList.remove("oculto");
            preenchimentoBarra.style.width = `${percentual}%`;
          };
          const esconderBarra = () => {
            containerBarra.classList.add("oculto");
            preenchimentoBarra.style.width = "0%";
          };
          linha.querySelector('[data-acao="ver"]').addEventListener("click", async (evento) => {
            const botao = evento.currentTarget;
            botao.disabled = true;
            try {
              await visualizarAnexo(anexo.driveFileId, atualizarBarra);
            } catch (erro) {
              mostrarToast(erro.message, "erro");
            } finally {
              botao.disabled = false;
              esconderBarra();
            }
          });
          linha.querySelector('[data-acao="baixar"]').addEventListener("click", async (evento) => {
            const botao = evento.currentTarget;
            botao.disabled = true;
            try {
              await baixarAnexo(anexo.driveFileId, anexo.nomeArquivo, atualizarBarra);
            } catch (erro) {
              mostrarToast(erro.message, "erro");
            } finally {
              botao.disabled = false;
              esconderBarra();
            }
          });
          linha.querySelector('[data-acao="remover"]').addEventListener("click", async () => {
            if (!confirm(`Remover o anexo "${anexo.nomeArquivo}"?`)) return;
            try {
              await excluirAnexoDrive(anexo.driveFileId);
            } catch (erro) {
              console.warn("Não foi possível excluir do Drive (pode já ter sido removido):", erro);
            }
            anexos = anexos.filter((a) => a !== anexo);
            redesenharListaAnexos();
            aoMudar(anexos);
          });
          grupo.appendChild(linha);
        });

      listaEl.appendChild(grupo);
    });
  }

  redesenharListaAnexos();

  return {
    obterAnexos: () => anexos,
  };
}

/** Transforma um texto livre num nome de arquivo seguro (sem acento, sem caractere especial) */
function sanitizarNomeArquivo(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, "-") // troca tudo que não for letra/número por hífen
    .replace(/-+/g, "-") // colapsa hífens repetidos
    .replace(/^-|-$/g, "") // remove hífen do início/fim
    .slice(0, 80);
}

function formatarTamanhoArquivo(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
