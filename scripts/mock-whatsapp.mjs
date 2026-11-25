// Carregado apenas no servidor Next iniciado pelo Playwright.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "graph.facebook.com") return original(input, init);

  const request = new Request(input, init);
  const payload = await request.json();
  if (url.pathname !== "/v24.0/10001/messages"
    || request.method !== "POST" || request.headers.get("authorization") !== "Bearer token-ficticio"
    || payload.to !== "10002" || payload.type !== "text" || payload.messaging_product !== "whatsapp"
    || !payload.text?.body?.startsWith("Resposta fictícia")) return new Response(null, { status: 400 });
  if (payload.text.body.endsWith(" sem confirmação")) return new Response(null, { status: 503 });
  return Response.json({ messages: [{ id: "identificador-ficticio" }] });
};
