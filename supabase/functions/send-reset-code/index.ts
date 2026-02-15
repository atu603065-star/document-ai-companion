import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username } = await req.json();
    if (!username || typeof username !== 'string') {
      return new Response(JSON.stringify({ error: 'Username is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find user profile with email
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('email, username, user_id')
      .ilike('username', username.trim().toLowerCase())
      .maybeSingle();

    if (profileError || !profile) {
      // Don't reveal if user exists
      return new Response(JSON.stringify({ success: true, message: 'Nếu tài khoản tồn tại và có email, mã sẽ được gửi.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!profile.email) {
      return new Response(JSON.stringify({ error: 'Tài khoản chưa liên kết email. Không thể khôi phục mật khẩu.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate old codes
    await supabase
      .from('password_reset_codes')
      .update({ used: true })
      .eq('username', profile.username)
      .eq('used', false);

    // Store new code
    await supabase.from('password_reset_codes').insert({
      username: profile.username,
      email: profile.email,
      code,
      expires_at: expiresAt.toISOString(),
    });

    // Send email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AnndChat <onboarding@resend.dev>',
        to: [profile.email],
        subject: `Mã khôi phục mật khẩu: ${code}`,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
            <h2 style="text-align: center; color: #333;">🔐 AnndChat</h2>
            <p>Xin chào <strong>${profile.username}</strong>,</p>
            <p>Mã khôi phục mật khẩu của bạn là:</p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background: #f3f4f6; padding: 12px 24px; border-radius: 8px;">${code}</span>
            </div>
            <p style="color: #666; font-size: 14px;">Mã này có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error('Resend error:', errBody);
      return new Response(JSON.stringify({ error: 'Không thể gửi email. Vui lòng thử lại sau.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mask email for display
    const parts = profile.email.split('@');
    const masked = parts[0].substring(0, 2) + '***@' + parts[1];

    return new Response(JSON.stringify({ success: true, maskedEmail: masked }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
