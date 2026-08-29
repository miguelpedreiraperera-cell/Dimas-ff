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


/* =========================
   REQUISIÇÃO PARA O ASAAS
========================= */

async function asaasRequest(path, options = {}) {

  if (!ASAAS_API_KEY) {
    throw new Error(
      "ASAAS_API_KEY não foi configurada no Render."
    );
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

    console.error("Resposta do Asaas:", {
      status: response.status,
      data
    });

    const message =
      data?.errors
        ?.map(error => error.description)
        .join("; ") ||
      "Erro na API do Asaas.";

    throw new Error(message);
  }

  return data;
}


/* =========================
   TESTE DO ASAAS
========================= */

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


/* =========================
   CRIAR PIX
========================= */

app.post("/api/create-pix", async (req, res) => {

  try {

    const {
      amount,
      product,
      playerId,

      // Aceita os dois nomes
      cpf,
      cpfCnpj

    } = req.body;


    /* =========================
       VALOR
    ========================= */

    const value = Number(amount);

    if (!Number.isFinite(value) || value < 5) {

      return res.status(400).json({
        error:
          "O valor mínimo para gerar o Pix é R$ 5,00."
      });

    }


    /* =========================
       ID DO JOGADOR
    ========================= */

    if (!playerId) {

      return res.status(400).json({
        error:
          "ID do jogador não informado."
      });

    }


    /* =========================
       CPF / CNPJ
    ========================= */

    // Aceita tanto "cpf" quanto "cpfCnpj"
    const document =
      cpf ||
      cpfCnpj ||
      "";


    if (!document) {

      return res.status(400).json({
        error:
          "CPF ou CNPJ não informado."
      });

    }


    /* =========================
       LIMPAR DOCUMENTO
    ========================= */

    const cleanCpfCnpj =
      String(document).replace(/\D/g, "");


    /* =========================
       VALIDAR CPF / CNPJ
    ========================= */

    if (
      cleanCpfCnpj.length !== 11 &&
      cleanCpfCnpj.length !== 14
    ) {

      return res.status(400).json({
        error:
          "CPF ou CNPJ inválido."
      });

    }


    /* =========================
       CRIAR CLIENTE
    ========================= */

    const customer =
      await asaasRequest(
        "/customers",
        {
          method: "POST",

          body: JSON.stringify({

            name:
              `Cliente Dimas FF - ${playerId}`,

            cpfCnpj:
              cleanCpfCnpj,

            externalReference:
              `dimas-ff-${playerId}-${Date.now()}`
          })
        }
      );


    /* =========================
       CRIAR COBRANÇA PIX
    ========================= */

    const payment =
      await asaasRequest(
        "/payments",
        {
          method: "POST",

          body: JSON.stringify({

            customer:
              customer.id,

            billingType:
              "PIX",

            value:
              Number(value.toFixed(2)),

            dueDate:
              new Date()
                .toISOString()
                .slice(0, 10),

            description:
              `${product} - ID ${playerId}`,

            externalReference:
              `DIMAS-FF-${Date.now()}`
          })
        }
      );


    /* =========================
       OBTER QR CODE PIX
    ========================= */

    const pix =
      await asaasRequest(
        `/payments/${encodeURIComponent(
          payment.id
        )}/pixQrCode`,
        {
          method: "GET"
        }
      );


    /* =========================
       RESPOSTA
    ========================= */

    res.json({

      success: true,

      paymentId:
        payment.id,

      status:
        payment.status,

      amount:
        value,

      product:
        product,

      playerId:
        playerId,

      payload:
        pix.payload,

      encodedImage:
        pix.encodedImage,

      expirationDate:
        pix.expirationDate
    });


  } catch (error) {

    console.error(
      "Erro ao criar Pix:",
      error
    );

    res.status(500).json({

      error:
        error.message ||
        "Não foi possível gerar o Pix."
    });

  }

});


/* =========================
   CONSULTAR PAGAMENTO
========================= */

app.get(
  "/api/payment-status/:paymentId",
  async (req, res) => {

    try {

      const payment =
        await asaasRequest(
          `/payments/${encodeURIComponent(
            req.params.paymentId
          )}`,
          {
            method: "GET"
          }
        );


      res.json({

        paymentId:
          payment.id,

        status:
          payment.status
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

  }
);


/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {

  res.json({

    online:
      true,

    service:
      "Dimas FF",

    environment:
      ASAAS_URL.includes("sandbox")
        ? "Sandbox"
        : "Produção"
  });

});


/* =========================
   INICIAR SERVIDOR
========================= */

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
