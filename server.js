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
   REQUISIÇÃO ASAAS
========================= */

async function asaasRequest(path, options = {}) {

  if (!ASAAS_API_KEY) {
    throw new Error(
      "ASAAS_API_KEY não foi configurada no Render."
    );
  }

  const response = await fetch(
    `${ASAAS_URL}${path}`,
    {
      ...options,

      headers: {
        "Content-Type": "application/json",
        "User-Agent": "DimasFF/1.0",
        "access_token": ASAAS_API_KEY,
        ...(options.headers || {})
      }
    }
  );

  const data =
    await response.json().catch(() => ({}));


  if (!response.ok) {

    console.error(
      "Resposta do Asaas:",
      {
        status: response.status,
        data
      }
    );

    const message =
      data?.errors
        ?.map(
          error =>
            error.description
        )
        .join("; ") ||
      "Erro na API do Asaas.";

    throw new Error(message);
  }

  return data;
}


/* =========================
   TESTE ASAAS
========================= */

app.get(
  "/api/asaas-test",
  async (req, res) => {

    try {

      const data =
        await asaasRequest(
          "/customers",
          {
            method: "GET"
          }
        );


      res.json({

        success: true,

        message:
          "Conexão com o Asaas funcionando.",

        environment:
          ASAAS_URL.includes("sandbox")
            ? "Sandbox"
            : "Produção",

        customers:
          data?.totalCount ?? null

      });


    } catch (error) {

      console.error(
        "Teste Asaas:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message

      });

    }

  }
);


/* =========================
   CRIAR PIX
========================= */

app.post(
  "/api/create-pix",
  async (req, res) => {

    try {

      const {
        amount,
        product,
        playerId,
        cpf,
        cpfCnpj,
        coupon
      } = req.body;


      /* =========================
         VALOR ORIGINAL
      ========================= */

      const originalValue =
        Number(amount);


      if(
        !Number.isFinite(
          originalValue
        ) ||
        originalValue <= 0
      ){

        return res.status(400).json({

          error:
            "Valor do pagamento inválido."

        });

      }


      /* =========================
         ID
      ========================= */

      if(!playerId){

        return res.status(400).json({

          error:
            "ID do jogador não informado."

        });

      }


      /* =========================
         CPF / CNPJ
      ========================= */

      const document =
        String(
          cpfCnpj || cpf || ""
        )
        .replace(/\D/g,"");


      if(!document){

        return res.status(400).json({

          error:
            "CPF não informado."

        });

      }


      if(
        document.length !== 11 &&
        document.length !== 14
      ){

        return res.status(400).json({

          error:
            "CPF ou CNPJ inválido."

        });

      }


      /* =========================
         CUPOM ZERO3
         10% DE DESCONTO
         MÍNIMO ORIGINAL R$ 7,00
      ========================= */

      let finalValue =
        originalValue;

      let discount = 0;

      let couponUsed = null;


      const couponCode =
        String(
          coupon || ""
        )
        .trim()
        .toUpperCase();


      if(
        couponCode === "ZERO3"
      ){

        /*
         * O mínimo é verificado
         * ANTES do desconto.
         *
         * R$ 7,00 pode usar ZERO3.
         */

        if(
          originalValue < 7
        ){

          return res.status(400).json({

            error:
              "O cupom ZERO3 só pode ser usado em compras de R$ 7,00 ou mais."

          });

        }


        discount =
          Number(
            (
              originalValue * 0.10
            ).toFixed(2)
          );


        finalValue =
          Number(
            (
              originalValue -
              discount
            ).toFixed(2)
          );


        couponUsed =
          "ZERO3";

      }


      /* =========================
         SEGURANÇA
      ========================= */

      if(
        finalValue <= 0
      ){

        return res.status(400).json({

          error:
            "Valor final inválido."

        });

      }


      /* =========================
         CRIAR CLIENTE
      ========================= */

      const customer =
        await asaasRequest(
          "/customers",
          {

            method:
              "POST",

            body:
              JSON.stringify({

                name:
                  `Cliente Dimas FF - ${playerId}`,

                cpfCnpj:
                  document,

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

            method:
              "POST",

            body:
              JSON.stringify({

                customer:
                  customer.id,

                billingType:
                  "PIX",

                value:
                  finalValue,

                dueDate:
                  new Date()
                    .toISOString()
                    .slice(0,10),

                description:
                  couponUsed
                    ? `${product} - ID ${playerId} - Cupom ZERO3 - 10% OFF`
                    : `${product} - ID ${playerId}`,

                externalReference:
                  `DIMAS-FF-${Date.now()}`

              })

          }
        );


      /* =========================
         QR CODE PIX
      ========================= */

      const pix =
        await asaasRequest(
          `/payments/${encodeURIComponent(
            payment.id
          )}/pixQrCode`,
          {

            method:
              "GET"

          }
        );


      /* =========================
         RESPOSTA
      ========================= */

      res.json({

        success:
          true,

        paymentId:
          payment.id,

        status:
          payment.status,

        originalAmount:
          originalValue,

        discount:
          discount,

        amount:
          finalValue,

        coupon:
          couponUsed,

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

  }
);


/* =========================
   STATUS DO PAGAMENTO
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

            method:
              "GET"

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

app.get(
  "/health",
  (req, res) => {

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

  }
);


/* =========================
   INICIAR SERVIDOR
========================= */

app.listen(
  PORT,
  () => {

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

  }
);
