// ===================================================================
// INTEGRAÇÃO COM O GOOGLE DRIVE
// ===================================================================
// Todos os PDFs ficam armazenados numa única conta Google (institucional
// deste projeto), organizados em pastas por unidade gestora e por módulo.
// O app nunca guarda a senha/chave dessa conta — ele pede um "passe"
// temporário (access token) pra Cloud Function obterTokenDrive sempre
// que precisa subir, ver ou baixar um arquivo.

let cacheTokenDrive = { valor: null, expiraEm: 0 };

/** Devolve um access token válido, renovando com a Cloud Function se preciso */
async function obterAccessTokenDrive() {
  const agora = Date.now();
  // Renova um pouco antes de expirar (margem de 60s) pra evitar corrida
  if (cacheTokenDrive.valor && agora < cacheTokenDrive.expiraEm - 60000) {
    return cacheTokenDrive.valor;
  }

  const idToken = await estado.usuario.getIdToken();
  const resposta = await fetch(URL_FUNCAO_TOKEN_DRIVE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!resposta.ok) {
    throw new Error("Não foi possível conectar ao Google Drive no momento.");
  }

  const dados = await resposta.json();
  cacheTokenDrive.valor = dados.access_token;
  cacheTokenDrive.expiraEm = agora + dados.expires_in * 1000;
  return cacheTokenDrive.valor;
}

/**
 * Garante que existe (ou cria) a pasta da unidade gestora + submódulo no
 * Drive, e devolve o ID dessa pasta. Os IDs ficam guardados no Firestore
 * pra não precisar procurar no Drive toda vez.
 */
async function obterOuCriarPastaModulo(nomeModulo) {
  const refEntidade = db.collection("entidades").doc(estado.entidadeAtual);
  const doc = await refEntidade.get();
  const dados = doc.data();
  const pastasDrive = dados.pastasDrive || {};

  if (pastasDrive[nomeModulo]) {
    return pastasDrive[nomeModulo];
  }

  const token = await obterAccessTokenDrive();

  // Cria a pasta raiz da entidade, se ainda não existir
  let pastaRaizId = pastasDrive._raiz;
  if (!pastaRaizId) {
    pastaRaizId = await criarPastaDrive(token, `SOFT+ Indexação - ${dados.nome}`, null);
    pastasDrive._raiz = pastaRaizId;
  }

  const pastaModuloId = await criarPastaDrive(token, nomeModulo, pastaRaizId);
  pastasDrive[nomeModulo] = pastaModuloId;

  await refEntidade.update({ pastasDrive });
  return pastaModuloId;
}

async function criarPastaDrive(token, nome, pastaPaiId) {
  const metadados = {
    name: nome,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (pastaPaiId) metadados.parents = [pastaPaiId];

  const resposta = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadados),
  });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.error?.message || "Erro ao criar pasta no Drive");
  return dados.id;
}

/**
 * Envia um arquivo PDF pro Drive, dentro da pasta do módulo indicado.
 * Devolve { driveFileId, nomeArquivo, tamanhoBytes, paginas }
 */
async function enviarPdfParaDrive(arquivo, nomeModulo, aoProgredir) {
  if (arquivo.type !== "application/pdf") {
    throw new Error("Só é permitido anexar arquivos em PDF.");
  }

  aoProgredir?.("Lendo o documento...");
  const paginas = await contarPaginasPdf(arquivo);

  aoProgredir?.("Conectando ao Google Drive...");
  const token = await obterAccessTokenDrive();
  const pastaId = await obterOuCriarPastaModulo(nomeModulo);

  const metadados = {
    name: arquivo.name,
    parents: [pastaId],
  };

  const limite = "-------soft-plus-boundary-------";
  const corpo =
    `--${limite}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadados)}\r\n` +
    `--${limite}\r\n` +
    `Content-Type: application/pdf\r\n\r\n`;

  const bytesArquivo = await arquivo.arrayBuffer();
  const rodape = `\r\n--${limite}--`;

  const corpoCompleto = new Blob([corpo, bytesArquivo, rodape]);

  aoProgredir?.("Enviando arquivo...", 0);
  const dados = await enviarComProgresso(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${limite}`,
    },
    corpoCompleto,
    (percentual) => aoProgredir?.("Enviando arquivo...", percentual)
  );

  return {
    driveFileId: dados.id,
    nomeArquivo: arquivo.name,
    tamanhoBytes: arquivo.size,
    paginas,
    dataUpload: new Date().toISOString(),
    usuarioUpload: estado.usuario.email,
  };
}

/**
 * Envia dados via XMLHttpRequest (em vez de fetch), porque só o XHR
 * expõe o evento de progresso do upload (fetch não avisa quantos bytes
 * já foram enviados, só quando termina por completo).
 */
function enviarComProgresso(url, cabecalhos, corpo, aoProgresso) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(cabecalhos).forEach(([nome, valor]) => xhr.setRequestHeader(nome, valor));

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) {
        aoProgresso(Math.round((evento.loaded / evento.total) * 100));
      }
    };

    xhr.onload = () => {
      let dados;
      try {
        dados = JSON.parse(xhr.responseText);
      } catch (erro) {
        dados = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        aoProgresso(100);
        resolve(dados);
      } else {
        reject(new Error(dados.error?.message || "Falha ao enviar o arquivo para o Drive."));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de rede ao enviar o arquivo. Verifique sua conexão."));

    xhr.send(corpo);
  });
}

/** Abre o PDF numa aba nova, buscando os bytes com autenticação */
async function visualizarAnexo(driveFileId) {
  const token = await obterAccessTokenDrive();
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resposta.ok) throw new Error("Não foi possível abrir o documento.");
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

/** Baixa o PDF para o computador do usuário */
async function baixarAnexo(driveFileId, nomeArquivo) {
  const token = await obterAccessTokenDrive();
  const resposta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resposta.ok) throw new Error("Não foi possível baixar o documento.");
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

/** Exclui o arquivo do Drive (usado quando um anexo é removido de um registro) */
async function excluirAnexoDrive(driveFileId) {
  const token = await obterAccessTokenDrive();
  await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Conta as páginas do PDF localmente, usando PDF.js, antes do upload */
async function contarPaginasPdf(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  return pdf.numPages;
}
