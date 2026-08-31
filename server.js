const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = (
  process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3"
).replace(/\/$/, "");

async function asaasRequest(path, options = {}) {
  if (!ASAAS_API_KEY) {
    throw new Error("ASAAS_API_KEY não foi configurada no Render.");
  }

  const response = await fetch(`${ASAAS_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DimasFF/1.0",
      "access_token": ASAAS_API_KEY,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Resposta do Asaas:", response.status, data);

    const message =
      data?.errors?.map(e => e.description).join("; ") ||
      "Erro na API do Asaas.";

    throw new Error(message);
  }

  return data;
}

app.get("/api/asaas-test", async (req, res) => {
  try {
    const data = await asaasRequest("/customers", {
      method: "GET"
    });

    res.json({
      success: true,
      message: "Conexão com o Asaas funcionando.",
      environment: ASAAS_URL.includes("sandbox")
        ? "Sandbox"
        : "Produção",
      customers: data?.totalCount ?? null
    });
  } catch (error) {
    console.error("Teste Asaas:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/create-pix", async (req, res) => {
  try {
    const {
      amount,
      product,
      playerId,
      cpfCnpj,
      email,
      coupon,
      purchaseType
    } = req.body;

    const original = Number(amount);

    if (!Number.isFinite(original) || original <= 0) {
      return res.status(400).json({
        error: "Valor do pagamento inválido."
      });
    }

    /*
      DIAMANTES:
      precisa apenas do ID do jogador.

      CONTAS:
      precisa de e-mail.
    */

    const type = purchaseType === "account"
      ? "account"
      : "diamonds";

    const cleanPlayerId = String(playerId || "").trim();

    if (type === "diamonds" && !cleanPlayerId) {
      return res.status(400).json({
        error: "ID do jogador não informado."
      });
    }

    const cleanEmail = String(email || "").trim();

    if (type === "account") {
      if (!cleanEmail) {
        return res.status(400).json({
          error: "E-mail não informado."
        });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({
          error: "E-mail inválido."
        });
      }
    }

    const cpf = String(cpfCnpj || "").replace(/\D/g, "");

    if (!cpf) {
      return res.status(400).json({
        error: "CPF não informado."
      });
    }

    if (cpf.length !== 11 && cpf.length !== 14) {
      return res.status(400).json({
        error: "CPF/CNPJ inválido."
      });
    }

    let finalAmount = original;
    let discountApplied = false;

    const code = String(coupon || "")
      .trim()
      .toUpperCase();

    if (code) {
      if (code !== "ZERO3") {
        return res.status(400).json({
          error: "Cupom inválido."
        });
      }

      if (original < 7) {
        return res.status(400).json({
          error:
            "O cupom ZERO3 só pode ser usado em compras de R$ 7,00 ou mais."
        });
      }

      finalAmount = Number((original * 0.90).toFixed(2));
      discountApplied = true;
    }

    /*
      Monta o cliente do Asaas.

      Para DIAMANTES não enviamos e-mail.
      Para CONTAS enviamos o e-mail informado.
    */

    const customerData = {
      name: `Cliente Dimas FF - ${
        cleanPlayerId || "Conta"
      }`,
      cpfCnpj: cpf,
      externalReference: `dimas-ff-${
        cleanPlayerId || "conta"
      }-${Date.now()}`
    };

    if (type === "account") {
      customerData.email = cleanEmail;
    }

    const customer = await asaasRequest("/customers", {
      method: "POST",
      body: JSON.stringify(customerData)
    });

    const payment = await asaasRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.id,
        billingType: "PIX",
        value: finalAmount,
        dueDate: new Date().toISOString().slice(0, 10),
        description:
          `${product}` +
          `${discountApplied ? " - Cupom ZERO3 (10% OFF)" : ""}` +
          `${cleanPlayerId ? ` - ID ${cleanPlayerId}` : ""}`,
        externalReference: `DIMAS-FF-${Date.now()}`
      })
    });

    const pix = await asaasRequest(
      `/payments/${encodeURIComponent(payment.id)}/pixQrCode`,
      {
        method: "GET"
      }
    );

    res.json({
      success: true,
      paymentId: payment.id,
      status: payment.status,
      amount: finalAmount,
      originalAmount: original,
      discountApplied,
      product,
      playerId: cleanPlayerId || null,
      payload: pix.payload,
      encodedImage: pix.encodedImage,
      expirationDate: pix.expirationDate
    });

  } catch (error) {
    console.error("Erro ao criar Pix:", error);

    const text = String(error.message || "");

    if (
      text.toLowerCase().includes("chave pix") ||
      text.toLowerCase().includes("pix key")
    ) {
      return res.status(400).json({
        error:
          "A chave Pix para recebimentos ainda está em análise no Asaas. Tente novamente mais tarde."
      });
    }

    res.status(500).json({
      error:
        error.message ||
        "Não foi possível gerar o Pix."
    });
  }
});

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
    console.error(
      "Erro ao consultar pagamento:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Erro ao consultar pagamento."
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    online: true,
    service: "Dimas FF",
    environment: ASAAS_URL.includes("sandbox")
      ? "Sandbox"
      : "Produção"
  });
});

app.listen(PORT, () => {
  console.log(
    `Dimas FF backend rodando na porta ${PORT}`
  );

  console.log(
    `Asaas: ${
      ASAAS_URL.includes("sandbox")
        ? "Sandbox"
        : "Produção"
    }`
  );
});
