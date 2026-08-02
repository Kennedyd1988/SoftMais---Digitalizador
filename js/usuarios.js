// ===================================================================
// GESTÃO DE USUÁRIOS
// ===================================================================
const ABAS_PERMISSIVEIS = [
  { chave: "credores", rotulo: "Credores/Fornecedores" },
  { chave: "licitacoes", rotulo: "Licitações" },
  { chave: "despesas", rotulo: "Processos de Despesa" },
  { chave: "legislacao", rotulo: "Legislação" },
  { chave: "documentosDiversos", rotulo: "Documentos Diversos" },
  { chave: "servidores", rotulo: "Servidores" },
  { chave: "folhas", rotulo: "Folhas" },
  { chave: "processosPessoal", rotulo: "Processos de Pessoal" },
  { chave: "atosAdministrativos", rotulo: "Atos Administrativos" },
  { chave: "relatorios", rotulo: "Relatórios" },
];

async function renderizarUsuarios(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Usuários</h2>
      <button class="botao-primario" id="btn-novo">+ Novo Usuário</button>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
  `;

  const entidadesSnapshot = await db.collection("entidades").orderBy("nome").get();
  const todasEntidades = entidadesSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  async function carregarLista() {
    const lista = document.getElementById("lista-registros");
    lista.innerHTML = "";
    const snapshot = await db.collection("usuarios").orderBy("nomeNormalizado").get();
    snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro cartao-clicavel";
    const rotulosPapel = { administrador: "Administrador", cadastrador: "Cadastrador", leitura: "Leitura" };
    cartao.innerHTML = `
      <div>
        <strong>${registro.nome}</strong> — ${registro.email}
        <div class="texto-secundario">${rotulosPapel[registro.papel] || registro.papel}</div>
      </div>
    `;
    cartao.addEventListener("click", () => abrirFormulario(registro));
    return cartao;
  }

  function abrirFormulario(registro = null) {
    const modal = criarModal(`${registro ? "Editar" : "Novo"} Usuário`, `
      <label>Nome *</label>
      <input type="text" id="campo-nome" value="${registro?.nome || ""}">
      <label>E-mail *</label>
      <input type="email" id="campo-email" value="${registro?.email || ""}" ${registro ? "disabled" : ""}>
      ${!registro ? `<label>Senha inicial *</label><input type="password" id="campo-senha">` : ""}
      <label>Papel *</label>
      <select id="campo-papel">
        <option value="administrador" ${registro?.papel === "administrador" ? "selected" : ""}>Administrador</option>
        <option value="cadastrador" ${registro?.papel === "cadastrador" ? "selected" : ""}>Cadastrador</option>
        <option value="leitura" ${registro?.papel === "leitura" ? "selected" : ""}>Leitura</option>
      </select>

      <label>Unidades gestoras liberadas</label>
      <div class="lista-checkboxes" id="lista-entidades">
        ${todasEntidades.map((e) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${e.id}" ${(registro?.unidadesGestoras || []).includes(e.id) ? "checked" : ""}>
            ${e.nome}
          </label>
        `).join("")}
      </div>

      <label>Abas liberadas (ignorado se o papel for Administrador)</label>
      <div class="lista-checkboxes" id="lista-abas">
        ${ABAS_PERMISSIVEIS.map((a) => `
          <label class="item-checkbox">
            <input type="checkbox" value="${a.chave}" ${(registro?.abasPermitidas || []).includes(a.chave) ? "checked" : ""}>
            ${a.rotulo}
          </label>
        `).join("")}
      </div>
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      const campoEmail = document.getElementById("campo-email");
      limparCampoInvalido(campoNome);
      limparCampoInvalido(campoEmail);

      const nome = campoNome.value.trim();
      const email = campoEmail.value.trim();
      let valido = true;
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); valido = false; }
      if (!email) { marcarCampoInvalido(campoEmail, "Informe o e-mail."); valido = false; }
      if (!valido) return;

      const papel = document.getElementById("campo-papel").value;
      const unidadesGestoras = [...document.querySelectorAll("#lista-entidades input:checked")].map((c) => c.value);
      const abasPermitidas = [...document.querySelectorAll("#lista-abas input:checked")].map((c) => c.value);

      // Nunca deixar o sistema ficar sem nenhum administrador
      if (registro && registro.papel === "administrador" && papel !== "administrador") {
        const totalAdmins = (await db.collection("usuarios").where("papel", "==", "administrador").get()).size;
        if (totalAdmins <= 1) {
          mostrarToast("Não é possível rebaixar o único administrador do sistema.", "erro");
          return;
        }
      }

      await executarComFeedback(botaoSalvar, async () => {
        if (registro) {
          await db.collection("usuarios").doc(registro.id).update({
            nome, nomeNormalizado: normalizarTexto(nome), papel, unidadesGestoras, abasPermitidas,
          });
        } else {
          const senha = document.getElementById("campo-senha").value;
          if (!senha || senha.length < 6) {
            mostrarToast("A senha inicial precisa ter ao menos 6 caracteres.", "erro");
            return;
          }
          // Usa a instância secundária do Firebase para não deslogar o
          // administrador que está criando a conta.
          const credencial = await authSecundario.createUserWithEmailAndPassword(email, senha);
          await db.collection("usuarios").doc(credencial.user.uid).set({
            nome, nomeNormalizado: normalizarTexto(nome), email, papel, unidadesGestoras, abasPermitidas,
          });
          await authSecundario.signOut();
        }
        fecharModal();
        mostrarToast("Usuário salvo com sucesso.", "sucesso");
        carregarLista();
      });
    });
  }

  document.getElementById("btn-novo").addEventListener("click", () => abrirFormulario());
  carregarLista();
}

// ===================================================================
// UNIDADES GESTORAS (multiempresa/multiente — mesmo padrão do app de igrejas)
// ===================================================================
async function renderizarUnidadesGestoras(area) {
  area.innerHTML = `
    <div class="cabecalho-pagina">
      <h2>Unidades Gestoras</h2>
      <button class="botao-primario" id="btn-novo">+ Nova Unidade Gestora</button>
    </div>
    <div id="lista-registros" class="lista-cartoes"></div>
  `;

  async function carregarLista() {
    const lista = document.getElementById("lista-registros");
    lista.innerHTML = "";
    const snapshot = await db.collection("entidades").orderBy("nome").get();
    snapshot.docs.forEach((doc) => lista.appendChild(criarCartao({ id: doc.id, ...doc.data() })));
  }

  function criarCartao(registro) {
    const cartao = document.createElement("div");
    cartao.className = "cartao-registro cartao-clicavel";
    cartao.innerHTML = `<div><strong>${registro.nome}</strong><div class="texto-secundario">${registro.cnpj || ""}</div></div>`;
    cartao.addEventListener("click", () => abrirFormulario(registro));
    return cartao;
  }

  async function abrirFormulario(registro = null) {
    let refreshTokenAtual = "";
    if (registro) {
      const docConfig = await db.collection("entidades").doc(registro.id).collection("config").doc("drive").get();
      refreshTokenAtual = docConfig.exists ? docConfig.data().refreshToken || "" : "";
    }

    const modal = criarModal(`${registro ? "Editar" : "Nova"} Unidade Gestora`, `
      <label>Nome *</label>
      <input type="text" id="campo-nome" value="${registro?.nome || ""}">
      <label>CNPJ</label>
      <input type="text" id="campo-cnpj" value="${registro?.cnpj || ""}">
      <label>Endereço</label>
      <input type="text" id="campo-endereco" value="${registro?.endereco || ""}" placeholder="Rua, número, bairro, cidade/UF, CEP">
      <div class="linha-formulario">
        <div>
          <label>Telefone</label>
          <input type="text" id="campo-telefone" value="${registro?.telefone || ""}">
        </div>
        <div>
          <label>E-mail</label>
          <input type="email" id="campo-email" value="${registro?.email || ""}">
        </div>
      </div>
      <label>Responsável (nome e cargo)</label>
      <input type="text" id="campo-responsavel" value="${registro?.responsavel || ""}" placeholder="Ex: Fulano de Tal — Prefeito Municipal">

      <label>Logo (aparece no cabeçalho dos relatórios em PDF)</label>
      <div style="display:flex; align-items:center; gap:12px; margin-top:4px">
        <img id="preview-logo" src="${registro?.logoBase64 || ""}" style="max-width:120px; max-height:60px; ${registro?.logoBase64 ? "" : "display:none"}; border:1px solid var(--cinza-borda); border-radius:6px; padding:4px">
        <input type="file" id="campo-logo" accept="image/*">
      </div>
      <input type="hidden" id="campo-logo-base64" value="${registro?.logoBase64 || ""}">

      <label style="margin-top:14px">Refresh Token do Google Drive (opcional)</label>
      <input type="text" id="campo-drive-refresh-token" value="${refreshTokenAtual}" placeholder="Deixe em branco pra usar a conta compartilhada padrão">
      <p class="texto-secundario" style="margin-top:4px">
        Só preencha se esta unidade gestora tiver sua PRÓPRIA conta do
        Google Drive (separada das demais). Veja no README como gerar
        esse token pra uma conta nova. Fica guardado à parte, visível só
        pra administradores.
      </p>
    `, async (botaoSalvar) => {
      const campoNome = document.getElementById("campo-nome");
      limparCampoInvalido(campoNome);
      const nome = campoNome.value.trim();
      if (!nome) { marcarCampoInvalido(campoNome, "Informe o nome."); return; }

      await executarComFeedback(botaoSalvar, async () => {
        const dados = {
          nome,
          cnpj: document.getElementById("campo-cnpj").value.trim(),
          endereco: document.getElementById("campo-endereco").value.trim(),
          telefone: document.getElementById("campo-telefone").value.trim(),
          email: document.getElementById("campo-email").value.trim(),
          responsavel: document.getElementById("campo-responsavel").value.trim(),
          logoBase64: document.getElementById("campo-logo-base64").value || null,
        };
        let entidadeId = registro?.id;
        if (registro) {
          await db.collection("entidades").doc(registro.id).update(dados);
        } else {
          const refNovo = await db.collection("entidades").add(dados);
          entidadeId = refNovo.id;
        }

        // Guarda o refresh token à parte, numa subcoleção só legível por
        // administrador (ver firestore.rules) — nunca no documento
        // principal da entidade, que qualquer usuário dela pode ler.
        const refreshToken = document.getElementById("campo-drive-refresh-token").value.trim();
        if (refreshToken !== refreshTokenAtual) {
          // O token mudou (era outra conta, ou não tinha nenhuma antes)
          // — as pastas do Drive já cacheadas na entidade pertencem à
          // conta ANTIGA e não existem na conta nova. Sem limpar isso,
          // o próximo upload tenta usar uma pasta que não existe mais
          // pra essa conta, e dá erro "File not found".
          await db.collection("entidades").doc(entidadeId).update({ pastasDrive: {} });
        }
        await db.collection("entidades").doc(entidadeId).collection("config").doc("drive")
          .set({ refreshToken: refreshToken || null });

        fecharModal();
        mostrarToast("Unidade gestora salva com sucesso.", "sucesso");
        carregarLista();
      });
    });

    modal.querySelector("#campo-logo").addEventListener("change", async (evento) => {
      const arquivo = evento.target.files[0];
      if (!arquivo) return;
      try {
        const base64 = await redimensionarImagemParaBase64(arquivo, 300);
        modal.querySelector("#campo-logo-base64").value = base64;
        const preview = modal.querySelector("#preview-logo");
        preview.src = base64;
        preview.style.display = "";
      } catch (erro) {
        mostrarToast(erro.message, "erro");
      }
    });
  }

  document.getElementById("btn-novo").addEventListener("click", () => abrirFormulario());
  carregarLista();
}
