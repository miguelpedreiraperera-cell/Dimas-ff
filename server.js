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
   CONFIGURAÇÃO DO CUPOM
========================= */

const COUPON_CODE = "ZERO3";

const COUPON_DISCOUNT = 0.10;

const COUPON_MINIMUM = 7;

const MIN_PAYMENT = 5;


/* =========================
   REQUISIÇÃO PARA O ASAAS
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
    await response.json()
      .catch(() => ({}));

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
   TESTE DO ASAAS
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
        coupon
      } = req.body;


      /* =========================
         VALOR ORIGINAL
      ========================= */

      const originalAmount =
        Number(amount);

      if(
        !Number.isFinite(originalAmount) ||
        originalAmount <= 0
      ){

        return res.status(400).json({

          error:
            "Valor do pagamento inválido."
        });
      }


      /* =========================
         ID DO JOGADOR
      ========================= */

      if(!playerId){

        return res.status(400).json({

          error:
            "ID do jogador não informado."
        });
      }


      /* =========================
         CPF
      ========================= */

      if(!cpf){

        return res.status(400).json({

          error:
            "CPF ou CNPJ não informado."
        });
      }


      const cleanCpf =
        String(cpf)
          .replace(/\D/g,"");


      if(
        cleanCpf.length !== 11 &&
        cleanCpf.length !== 14
      ){

        return res.status(400).json({

          error:
            "CPF ou CNPJ inválido."
        });
      }


      /* =========================
         CUPOM
      ========================= */

      const normalizedCoupon =
        String(coupon || "")
          .trim()
          .toUpperCase();


      let finalAmount =
        originalAmount;

      let discountAmount = 0;

      let couponApplied = false;


      if(normalizedCoupon){

        if(
          normalizedCoupon !==
          COUPON_CODE
        ){

          return res.status(400).json({

            error:
              "Cupom inválido."
          });
        }


        if(
          originalAmount <
          COUPON_MINIMUM
        ){

          return res.status(400).json({

            error:
              "O cupom ZERO3 só pode ser usado em compras de R$ 7,00 ou mais."
          });
        }


        discountAmount =
          Number(
            (
              originalAmount *
              COUPON_DISCOUNT
            ).toFixed(2)
          );


        finalAmount =
          Number(
            (
              originalAmount -
              discountAmount
            ).toFixed(2)
          );


        couponApplied = true;
      }


      /* =========================
         VALOR MÍNIMO DO PIX
      ========================= */

      if(finalAmount < MIN_PAYMENT){

        return res.status(400).json({

          error:
            "O valor final da cobrança não pode ser menor que R$ 5,00."
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

            body:
              JSON.stringify({

                name:
                  `Cliente Dimas FF - ${playerId}`,

                cpfCnpj:
                  cleanCpf,

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

            body:
              JSON.stringify({

                customer:
                  customer.id,

                billingType:
                  "PIX",

                value:
                  finalAmount,

                dueDate:
                  new Date()
                    .toISOString()
                    .slice(0,10),

                description:
                  couponApplied
                    ? `${product} - ID ${playerId} - Cupom ZERO3 10%`
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

        originalAmount:
          originalAmount,

        discount:
          discountAmount,

        amount:
          finalAmount,

        couponApplied:
          couponApplied,

        coupon:
          couponApplied
            ? COUPON_CODE
            : null,

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


    } catch(error){

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


    } catch(error){

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

      online: true,

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

    console.log(
      `Cupom ${COUPON_CODE}: 10% de desconto a partir de R$ ${COUPON_MINIMUM.toFixed(2)}`
    );
  }
);
