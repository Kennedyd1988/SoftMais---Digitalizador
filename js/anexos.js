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
 */
function renderizarSecaoAnexos(container, anexosIniciais, nomeModulo, aoMudar) {
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
      <div id="status-upload-anexo" class="oculto"></div>
      <div id="lista-anexos-por-volume"></div>
    </div>
  `;

  const inputArquivo = container.querySelector("#campo-arquivo-pdf");
  const botaoSelecionar = container.querySelector("#btn-selecionar-pdf");
  const statusUpload = container.querySelector("#status-upload-anexo");

  botaoSelecionar.addEventListener("click", () => inputArquivo.click());

  inputArquivo.addEventListener("change", async () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) return;
    const volume = parseInt(container.querySelector("#campo-volume").value, 10) || 1;

    botaoSelecionar.disabled = true;
    statusUpload.classList.remove("oculto");

    try {
      const novoAnexo = await enviarPdfParaDrive(arquivo, nomeModulo, (mensagem) => {
        statusUpload.textContent = mensagem;
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
      inputArquivo.value = "";
    }
  });

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
          linha.className = "linha-anexo";
          linha.innerHTML = `
            <span class="nome-anexo">📄 ${anexo.nomeArquivo} <span class="texto-secundario">(${anexo.paginas} pág. · ${formatarTamanhoArquivo(anexo.tamanhoBytes)})</span></span>
            <div class="acoes-anexo">
              <button type="button" class="botao-icone" title="Visualizar" data-acao="ver">👁️</button>
              <button type="button" class="botao-icone" title="Baixar" data-acao="baixar">⬇️</button>
              <button type="button" class="botao-icone" title="Remover" data-acao="remover">🗑️</button>
            </div>
          `;
          linha.querySelector('[data-acao="ver"]').addEventListener("click", async () => {
            try {
              await visualizarAnexo(anexo.driveFileId);
            } catch (erro) {
              mostrarToast(erro.message, "erro");
            }
          });
          linha.querySelector('[data-acao="baixar"]').addEventListener("click", async () => {
            try {
              await baixarAnexo(anexo.driveFileId, anexo.nomeArquivo);
            } catch (erro) {
              mostrarToast(erro.message, "erro");
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

function formatarTamanhoArquivo(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
