import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Attachment {
  content?: string;
  filename?: string;
  path?: string;
}

interface EmailRequest {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Attachment[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subject, html, text, attachments } = await req.json() as EmailRequest

    if (!RESEND_API_KEY) {
      throw new Error('No RESEND_API_KEY configured')
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Gescon360 <onboarding@resend.dev>', // Actualizar con tu dominio verificado
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>?/gm, ''),
        attachments
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})