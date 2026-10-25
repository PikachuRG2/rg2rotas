import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ParsedOrder = {
  address: string;
  street: string;
  instructions: string;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    address: { type: "string", description: "Endereço completo de entrega (rua, número, bairro, cidade)" },
    street: { type: "string", description: "Nome da rua com número, ex.: R. 55, 1071" },
    instructions: { type: "string", description: "Instruções de entrega (portão, interfone, referência, troco). Vazio se não houver." },
  },
  required: ["address", "street", "instructions"],
} as const;

export const parseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => {
    const text = String(d.text ?? "").trim().slice(0, 4000);
    if (text.length < 10) throw new Error("Cole o texto completo do pedido.");
    return { text };
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("IA não configurada.");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "Você lê textos de pedidos de delivery (iFood, WhatsApp etc.) colados por um motoboy e extrai o endereço de entrega e as instruções. Responda só com o JSON pedido. Se não houver endereço, deixe address e street vazios.",
          },
          { role: "user", content: data.text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "order", strict: true, schema },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`AI Gateway ${res.status}: ${body}`);
      if (res.status === 429) throw new Error("Muitas leituras seguidas. Tente de novo em alguns segundos.");
      if (res.status === 402 || res.status === 403) throw new Error("Leitura por IA indisponível no momento (créditos).");
      throw new Error("Não consegui ler o pedido agora.");
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("A IA não encontrou o endereço nesse texto.");
    const parsed = JSON.parse(content) as ParsedOrder;
    if (!parsed.address.trim()) throw new Error("Não achei um endereço nesse pedido.");
    return parsed;
  });
