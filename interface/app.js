// Interface do monitor eVOLVER. Fala só com a API, pelo proxy /api/ do nginx.

const API = "/api";
const ATUALIZAR_MS = 5000;

let selecionada = null;

const $ = (id) => document.getElementById(id);

const escapar = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const numero = (valor, casas) => (valor == null ? "—" : Number(valor).toFixed(casas));

const hora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");

async function pedir(caminho, opcoes) {
  const resposta = await fetch(API + caminho, opcoes);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe = corpo?.detail;
    throw new Error(typeof detalhe === "string" ? detalhe : `Erro ${resposta.status} na API.`);
  }
  return corpo;
}

// ------------------------------------------------------------ visão geral

async function atualizarSaude() {
  const el = $("saude");
  try {
    const s = await pedir("/saude");
    const ok = s.banco && s.broker;
    el.className = "saude " + (ok ? "ok" : "erro");
    el.textContent = ok ? "sistema ok" : `banco ${s.banco ? "ok" : "fora"} · broker ${s.broker ? "ok" : "fora"}`;
  } catch {
    el.className = "saude erro";
    el.textContent = "API fora do ar";
  }
}

async function atualizarCelulas() {
  const grade = $("celulas");
  let celulas;
  try {
    celulas = await pedir("/celulas");
  } catch (erro) {
    grade.innerHTML = `<p class="vazio">${escapar(erro.message)}</p>`;
    return;
  }
  if (celulas.length === 0) {
    grade.innerHTML = '<p class="vazio">Nenhuma célula se anunciou ainda.</p>';
    return;
  }
  grade.innerHTML = celulas.map((c) => `
    <button class="cartao ${c.id_celula === selecionada ? "selecionado" : ""}" data-id="${escapar(c.id_celula)}">
      <div class="topo">
        <span class="id">${escapar(c.id_celula)}</span>
        <span class="etiqueta ${escapar(c.estado)}">${escapar(c.estado)}</span>
      </div>
      <dl>
        <dt>Temperatura</dt><dd>${numero(c.temperatura_c, 2)} °C</dd>
        <dt>OD</dt><dd>${numero(c.od, 4)}</dd>
        <dt>pH</dt><dd>${numero(c.ph, 2)}</dd>
      </dl>
      <div class="rodape">
        última leitura ${hora(c.ultima_leitura_em)}
        ${c.alertas_abertos > 0 ? `· <span class="alerta-n">${c.alertas_abertos} alerta(s)</span>` : ""}
      </div>
    </button>`).join("");
}

async function atualizarAlertas() {
  const corpo = $("alertas");
  try {
    const alertas = await pedir("/alertas");
    corpo.innerHTML = alertas.length === 0
      ? '<tr><td colspan="4" class="vazio">Nenhum alerta aberto.</td></tr>'
      : alertas.map((a) => `
        <tr>
          <td>${hora(a.aberto_em)}</td>
          <td>${escapar(a.id_celula)}</td>
          <td>${escapar(a.tipo.replaceAll("_", " "))}</td>
          <td>${escapar(a.mensagem)}</td>
        </tr>`).join("");
  } catch (erro) {
    corpo.innerHTML = `<tr><td colspan="4" class="vazio">${escapar(erro.message)}</td></tr>`;
  }
}

// ------------------------------------------------------------ detalhe

function desenharGrafico(svg, leituras, campo, casas) {
  const pontos = leituras
    .filter((l) => l[campo] != null)
    .map((l) => ({ t: new Date(l.ts_origem).getTime(), v: l[campo] }));
  const largura = svg.clientWidth || 300;
  const altura = 160;
  const margem = { esq: 44, dir: 8, topo: 8, base: 20 };
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);

  if (pontos.length < 2) {
    svg.innerHTML = `<text x="${largura / 2}" y="${altura / 2}" text-anchor="middle">Sem leituras suficientes</text>`;
    return;
  }

  const t0 = pontos[0].t, t1 = pontos[pontos.length - 1].t;
  let vMin = Math.min(...pontos.map((p) => p.v));
  let vMax = Math.max(...pontos.map((p) => p.v));
  if (vMax - vMin < 1e-9) { vMin -= 1; vMax += 1; }
  const folga = (vMax - vMin) * 0.08;
  vMin -= folga; vMax += folga;

  const x = (t) => margem.esq + (t - t0) / (t1 - t0 || 1) * (largura - margem.esq - margem.dir);
  const y = (v) => margem.topo + (1 - (v - vMin) / (vMax - vMin)) * (altura - margem.topo - margem.base);

  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const horaCurta = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  svg.innerHTML = `
    <line class="eixo" x1="${margem.esq}" x2="${largura - margem.dir}" y1="${y(vMin)}" y2="${y(vMin)}"/>
    <line class="eixo" x1="${margem.esq}" x2="${largura - margem.dir}" y1="${y(vMax)}" y2="${y(vMax)}"/>
    <text x="${margem.esq - 6}" y="${y(vMax) + 4}" text-anchor="end">${(vMax).toFixed(casas)}</text>
    <text x="${margem.esq - 6}" y="${y(vMin) + 4}" text-anchor="end">${(vMin).toFixed(casas)}</text>
    <text x="${margem.esq}" y="${altura - 4}">${horaCurta(t0)}</text>
    <text x="${largura - margem.dir}" y="${altura - 4}" text-anchor="end">${horaCurta(t1)}</text>
    <path class="linha" d="${caminho}"/>`;
}

async function atualizarDetalhe() {
  if (!selecionada) return;
  const id = encodeURIComponent(selecionada);
  try {
    const [leituras, pedidos] = await Promise.all([
      pedir(`/celulas/${id}/leituras`),
      pedir(`/celulas/${id}/setpoints`),
    ]);
    desenharGrafico($("g-temperatura_c"), leituras, "temperatura_c", 1);
    desenharGrafico($("g-od"), leituras, "od", 3);
    desenharGrafico($("g-ph"), leituras, "ph", 2);

    $("pedidos").innerHTML = pedidos.length === 0
      ? '<tr><td colspan="4" class="vazio">Nenhum pedido ainda.</td></tr>'
      : pedidos.slice(0, 10).map((p) => `
        <tr>
          <td>${hora(p.solicitado_em)}</td>
          <td>${numero(p.temperatura_c, 1)} °C</td>
          <td><span class="etiqueta ${escapar(p.estado)}">${escapar(p.estado)}</span>
              ${p.motivo ? `<br><small>${escapar(p.motivo)}</small>` : ""}</td>
          <td>${escapar(p.solicitado_por)}</td>
        </tr>`).join("");
  } catch (erro) {
    $("pedidos").innerHTML = `<tr><td colspan="4" class="vazio">${escapar(erro.message)}</td></tr>`;
  }
}

function selecionar(id) {
  selecionada = id;
  $("detalhe").hidden = false;
  $("detalhe-id").textContent = id;
  $("csv").href = `${API}/celulas/${encodeURIComponent(id)}/leituras.csv`;
  $("setpoint-msg").textContent = "";
  document.querySelectorAll(".cartao").forEach((c) =>
    c.classList.toggle("selecionado", c.dataset.id === id));
  atualizarDetalhe();
}

$("celulas").addEventListener("click", (evento) => {
  const cartao = evento.target.closest(".cartao");
  if (cartao) selecionar(cartao.dataset.id);
});

$("form-setpoint").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const form = evento.currentTarget;
  const msg = $("setpoint-msg");
  const botao = form.querySelector("button");
  const dados = new FormData(form);
  botao.disabled = true;
  msg.className = "msg";
  msg.textContent = "Enviando…";
  try {
    const pedido = await pedir(`/celulas/${encodeURIComponent(selecionada)}/setpoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        temperatura_c: Number(dados.get("temperatura_c")),
        solicitado_por: dados.get("solicitado_por") || "anonimo",
      }),
    });
    msg.className = "msg ok";
    msg.textContent = `Pedido ${pedido.id_pedido} enviado. Acompanhe o estado na tabela.`;
    atualizarDetalhe();
  } catch (erro) {
    msg.className = "msg erro";
    msg.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});

// ------------------------------------------------------------ ciclo

function atualizarTudo() {
  atualizarSaude();
  atualizarCelulas();
  atualizarAlertas();
  atualizarDetalhe();
}

atualizarTudo();
setInterval(atualizarTudo, ATUALIZAR_MS);
