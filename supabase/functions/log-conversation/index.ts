// Edge Function: proxy gespreks-log naar Power Automate.
// De webhook-URL (incl. SAS-signature) blijft server-side als secret.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookUrl = Deno.env.get("POWER_AUTOMATE_WEBHOOK_URL");
    if (!webhookUrl) {
      return new Response(
        JSON.stringify({ error: "POWER_AUTOMATE_WEBHOOK_URL niet geconfigureerd" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = await req.json();

    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      console.error("Power Automate error:", upstream.status, txt);
      return new Response(
        JSON.stringify({ error: `HTTP ${upstream.status}: ${txt.slice(0, 200)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("log-conversation error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
