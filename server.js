const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

const ASAAS_URL = (
  process.env.ASAAS_URL ||
  "https://api-sandbox.asaas.com/v3"
).replace(/\/$/, "");

async function asaasRequest(path, options = {}) {
  if (!ASAAS_API_KEY) {
    throw new Error("A chave da API do Asaas não foi configurada no Render.");
  }

  const response = await fetch(`${ASAAS_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "access_token": ASAAS_API_KEY,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.errors?.map(e => e.description).join("; ") ||
      "Erro na API do Asaas.";

    throw new Error(message);
  }

  return data;
}


/* TESTE DO SERVIDOR */

app.get("/health", (req, res) => {
  res.json({
    online: true,
    service: "Dimas FF"
  });
});


/* CRIAR PAGAMENTO PIX */

app.post("/api/create-pix", async (req, res) => {
  try {
    const { amount, product, playerId } = req.body;

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        error: "Valor inválido."
      });
    }

    if (!playerId) {
      return res.status(400).json({
        error: "ID do jogador não informado."
      });
    }

    if (!product) {
      return res.status(400).json({
        error: "Produto não informado."
      });
    }


    /* CRIAR CLIENTE */

    const customer = await asaasRequest("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: `Cliente Dimas FF - ${playerId}`,
        externalReference: `dimas-ff-${playerId}`
      })
    });


    /* CRIAR COBRANÇA PIX */

    const payment = await asaasRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.id,
        billingType: "PIX",
        value: Number(value.toFixed(2)),
        dueDate: new Date().toISOString().slice(0, 10),
        description: `${product} - ID ${playerId}`,
        externalReference: `DIMAS-FF-${Date.now()}`
      })
    });


    /* PEGAR QR CODE PIX */

    const pix = await asaasRequest(
      `/payments/${payment.id}/pixQrCode`,
      {
        method: "GET"
      }
    );


    res.json({
      paymentId: payment.id,
      status: payment.status,
      amount: value,
      payload: pix.payload,
      encodedImage: pix.encodedImage,
      expirationDate: pix.expirationDate
    });

  } catch (error) {

    console.error("Erro ao criar Pix:", error);

    res.status(500).json({
      error: error.message || "Erro ao criar pagamento."
    });

  }
});


/* VERIFICAR PAGAMENTO */

app.get("/api/payment-status/:paymentId", async (req, res) => {

  try {

    const payment = await asaasRequest(
      `/payments/${encodeURIComponent(req.params.paymentId)}`,
      {
        method: "GET"
      }
    );

    res.json({
      paymentId: payment.id,
      status: payment.status
    });

  } catch (error) {

    console.error("Erro ao verificar pagamento:", error);

    res.status(500).json({
      error:
        error.message ||
        "Erro ao consultar pagamento."
    });

  }

});


/* INICIAR SERVIDOR */

app.listen(PORT, "0.0.0.0", () => {

  console.log(
    `Dimas FF backend rodando na porta ${PORT}`
  );

});
