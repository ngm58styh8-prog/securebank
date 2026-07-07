# frozen_string_literal: true

require "net/http"
require "uri"
require "securerandom"
require "base64"
require "json"

module EmailVerification
  CODE_TTL_SEC = 600
  RESEND_COOLDOWN_SEC = 60

  module_function

  def load_dotenv!
    path = File.join(File.expand_path("..", __dir__), ".env.local")
    return unless File.exist?(path)

    File.readlines(path).each do |line|
      line = line.strip
      next if line.empty? || line.start_with?("#")

      key, val = line.split("=", 2)
      next unless key && val

      val = val.strip.delete_prefix('"').delete_suffix('"').delete_prefix("'").delete_suffix("'")
      ENV[key] ||= val
    end
  end

  def supabase_service_role_key
    load_dotenv!
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"].to_s.strip
    if key.empty?
      key = ENV["SUPABASE_SECRET_KEY"].to_s.strip
    end
    if key.empty? && ENV["SUPABASE_SECRET_KEYS"]
      begin
        keys = JSON.parse(ENV["SUPABASE_SECRET_KEYS"])
        key = keys["default"].to_s.strip if keys.is_a?(Hash)
        key = keys.values.find { |v| v.to_s.strip != "" }.to_s.strip if key.empty? && keys.is_a?(Hash)
      rescue JSON::ParserError
        key = ""
      end
    end
    key
  end

  def supabase_service_role_jwt?
    supabase_service_role_key.start_with?("eyJ")
  end

  def supabase_secret_key?
    supabase_service_role_key.start_with?("sb_secret_")
  end

  def jwt_role(key)
    return nil unless key.start_with?("eyJ")

    part = key.split(".")[1]
    return nil unless part

    padded = part.tr("-_", "+/") + ("=" * ((4 - part.length % 4) % 4))
    payload = JSON.parse(Base64.decode64(padded))
    payload["role"]
  rescue StandardError
    nil
  end

  def validate_service_role_key!
    key = supabase_service_role_key
    raise "SUPABASE_SERVICE_ROLE_KEY is empty." if key.empty?
    if key.start_with?("sb_publishable_")
      raise "SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use the service_role JWT or sb_secret_ key."
    end
    if supabase_service_role_jwt?
      raise "SUPABASE_SERVICE_ROLE_KEY JWT must have role service_role." unless jwt_role(key) == "service_role"
    elsif !supabase_secret_key?
      raise "SUPABASE_SERVICE_ROLE_KEY must be a service_role JWT or sb_secret_ key."
    end
    key
  end

  def configured?
    ENV["SUPABASE_URL"].to_s.strip != "" &&
      !supabase_service_role_key.empty? &&
      ENV["RESEND_API_KEY"].to_s.strip != ""
  end

  def missing_env
    missing = []
    missing << "SUPABASE_URL" if ENV["SUPABASE_URL"].to_s.strip.empty?
    begin
      validate_service_role_key!
    rescue StandardError => e
      missing << e.message
    end
    missing << "RESEND_API_KEY" if ENV["RESEND_API_KEY"].to_s.strip.empty?
    missing << "RESEND_FROM_EMAIL" if ENV["RESEND_FROM_EMAIL"].to_s.strip.empty?
    missing
  end

  def normalize_email(email)
    email.to_s.strip.downcase
  end

  def generate_code
    format("%06d", SecureRandom.random_number(1_000_000))
  end

  def supabase_jwt_key?
    supabase_service_role_jwt?
  end

  def supabase_request(method, path, body = nil)
    validate_service_role_key!
    base = ENV["SUPABASE_URL"].to_s.chomp("/")
    uri = URI("#{base}/rest/v1/#{path}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"

    klass = {
      "GET" => Net::HTTP::Get,
      "POST" => Net::HTTP::Post,
      "PATCH" => Net::HTTP::Patch,
      "DELETE" => Net::HTTP::Delete
    }[method]
    req = klass.new(uri)
    key = supabase_service_role_key
    req["apikey"] = key
    req["Authorization"] = "Bearer #{key}" if supabase_service_role_jwt?
    req["Content-Type"] = "application/json"
    req["Prefer"] = "return=minimal"
    req.body = body.to_json if body
    res = http.request(req)
    [res.code.to_i, res.body]
  end

  def resend_from_address
    from = ENV["RESEND_FROM_EMAIL"].to_s.strip
    from.empty? ? "GlobalVest Bank <noreply@globalvestbank.com>" : from
  end

  def resend_reply_to
    reply = ENV["RESEND_REPLY_TO"].to_s.strip
    reply.empty? ? "support@globalvestbank.com" : reply
  end

  def resend_site_url
    url = ENV["RESEND_SITE_URL"].to_s.strip
    url.empty? ? "https://globalvestbank.com" : url.chomp("/")
  end

  def verification_email_content(code, recipient_email)
    site_url = resend_site_url
    support = resend_reply_to
    login_url = "#{site_url}/login.html"
    safe_code = code.to_s.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")
    safe_email = recipient_email.to_s.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")

    text = <<~TEXT.strip
      GlobalVest Bank

      Use this one-time code to finish signing in or creating your account:

      #{code}

      This code expires in 10 minutes and can only be used once.

      Sign in: #{login_url}

      This message was sent to #{recipient_email}. If you did not request it, you can safely ignore this email.

      Questions? Contact #{support}

      — GlobalVest Bank
      #{site_url}
    TEXT

    html = <<~HTML.strip
      <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
      <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GlobalVest Bank sign-in code</title></head>
      <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr><td style="padding:28px 32px 8px;">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">GlobalVest Bank</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#111827;">Your sign-in code</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Enter this one-time code to verify your email and continue to your account.</p>
      <div style="margin:0 0 24px;padding:18px 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
      <span style="font-size:32px;font-weight:700;letter-spacing:0.35em;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">#{safe_code}</span></div>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#6b7280;">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6b7280;">Sent to <strong>#{safe_email}</strong></p>
      <a href="#{login_url}" style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Continue to GlobalVest Bank</a>
      </td></tr>
      <tr><td style="padding:8px 32px 28px;border-top:1px solid #f3f4f6;">
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">If you did not request this code, you can safely ignore this email.</p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">Need help? Email <a href="mailto:#{support}" style="color:#4b5563;">#{support}</a></p>
      </td></tr></table></td></tr></table></body></html>
    HTML

    {
      subject: "Your GlobalVest Bank sign-in code",
      text: text,
      html: html
    }
  end

  def resend_email(to, code)
    uri = URI("https://api.resend.com/emails")
    content = verification_email_content(code, to)
    ref = "gv-verify-#{to.to_s.gsub(/[^a-z0-9@._-]/i, '')}"

    body = {
      from: resend_from_address,
      to: [to],
      reply_to: resend_reply_to,
      subject: content[:subject],
      text: content[:text],
      html: content[:html],
      headers: {
        "X-Auto-Response-Suppress" => "All",
        "X-Entity-Ref-ID" => ref
      },
      tags: [{ name: "category", value: "email_verification" }]
    }

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    req = Net::HTTP::Post.new(uri)
    req["Authorization"] = "Bearer #{ENV['RESEND_API_KEY']}"
    req["Content-Type"] = "application/json"
    req.body = body.to_json
    res = http.request(req)
    raise "Resend error: #{res.body}" unless res.code.to_i.between?(200, 299)
  end

  def create_and_send(email, enforce_cooldown: false)
    load_dotenv!
    return { ok: false, status: 503, error: "Missing env: #{missing_env.join(', ')}" } unless configured?

    email = normalize_email(email)
    return { ok: false, status: 400, error: "Please enter a valid email address." } unless email.include?("@")

    if enforce_cooldown
      status, body = supabase_request(
        "GET",
        "email_verifications?email=eq.#{URI.encode_www_form_component(email)}&order=created_at.desc&limit=1"
      )
      if status == 200
        rows = JSON.parse(body)
        if rows.is_a?(Array) && rows.any?
          created = Time.parse(rows.first["created_at"]) rescue nil
          if created && (Time.now - created) < RESEND_COOLDOWN_SEC
            retry_after = (RESEND_COOLDOWN_SEC - (Time.now - created)).ceil
            return {
              ok: false, status: 429,
              error: "Please wait #{retry_after} seconds before requesting another code.",
              retryAfter: retry_after
            }
          end
        end
      end
    end

    code = generate_code
    expires_at = (Time.now + CODE_TTL_SEC).utc.iso8601

    supabase_request(
      "DELETE",
      "email_verifications?email=eq.#{URI.encode_www_form_component(email)}&verified=eq.false"
    )

    status, res_body = supabase_request("POST", "email_verifications", {
      email: email, code: code, expires_at: expires_at, verified: false
    })
    raise "Supabase insert failed: #{res_body}" unless status.between?(200, 299)

    resend_email(email, code)

    { ok: true, status: 200, email: email, expiresInSeconds: CODE_TTL_SEC }
  rescue StandardError => e
    { ok: false, status: 500, error: e.message }
  end

  def verify(email, code)
    load_dotenv!
    return { ok: false, status: 503, error: "Missing env: #{missing_env.join(', ')}" } unless configured?

    email = normalize_email(email)
    code = code.to_s.strip
    return { ok: false, status: 400, error: "Enter a valid 6-digit verification code." } unless code.match?(/^\d{6}$/)

    status, body = supabase_request(
      "GET",
      "email_verifications?email=eq.#{URI.encode_www_form_component(email)}&verified=eq.false&order=created_at.desc&limit=1"
    )
    raise "Supabase lookup failed: #{body}" unless status == 200

    rows = JSON.parse(body)
    row = rows.is_a?(Array) ? rows.first : nil
    return { ok: false, status: 400, error: "No active verification code found. Request a new code." } unless row

    if Time.parse(row["expires_at"]) < Time.now
      return { ok: false, status: 400, error: "Verification code has expired. Request a new code." }
    end

    return { ok: false, status: 400, error: "Invalid verification code." } unless row["code"] == code

    patch_status, = supabase_request(
      "PATCH",
      "email_verifications?id=eq.#{row['id']}",
      { verified: true }
    )
    raise "Supabase update failed" unless patch_status.between?(200, 299)

    mark_account_verified(email)

    { ok: true, status: 200, email: email }
  rescue StandardError => e
    { ok: false, status: 500, error: e.message }
  end

  def mark_account_verified(email)
    path = File.join(File.expand_path("..", __dir__), "data", "accounts.json")
    return unless File.exist?(path)

    accounts = JSON.parse(File.read(path))
    return unless accounts.is_a?(Hash) && accounts[email].is_a?(Hash)

    accounts[email]["emailVerified"] = true
    accounts[email]["emailVerificationCode"] = nil
    File.write(path, JSON.pretty_generate(accounts))
  rescue StandardError
    nil
  end

  def deliverability_warnings
    warnings = []
    from = resend_from_address
    email = from[/\<([^>]+)\>/, 1] || from

    if email.end_with?("@resend.dev") || email.end_with?("@resend.com") || email == "onboarding@resend.dev"
      warnings << "RESEND_FROM_EMAIL uses a Resend sandbox address (#{email}). Verify globalvestbank.com in Resend and use noreply@globalvestbank.com."
    end

    if ENV["RESEND_FROM_EMAIL"].to_s.strip.empty?
      warnings << "RESEND_FROM_EMAIL is not set. Using default #{resend_from_address} — verify this domain in Resend."
    end

    warnings
  end

  def health
    load_dotenv!
    missing = missing_env
    warnings = deliverability_warnings
    {
      ok: missing.empty?,
      configured: missing.empty?,
      inboxReady: missing.empty? && warnings.empty?,
      missing: missing,
      deliverabilityWarnings: warnings,
      message: if missing.any?
                 "Missing: #{missing.join(', ')}"
               elsif warnings.any?
                 "Configured, but sender may land in spam: #{warnings.first}"
               else
                 "Email verification is configured for inbox delivery."
               end
    }
  end
end
