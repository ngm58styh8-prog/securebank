# frozen_string_literal: true

require "net/http"
require "uri"
require "securerandom"

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

  def configured?
    %w[SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY].all? do |k|
      ENV[k] && !ENV[k].strip.empty?
    end
  end

  def missing_env
    %w[SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY RESEND_FROM_EMAIL].reject do |k|
      ENV[k] && !ENV[k].to_s.strip.empty?
    end
  end

  def normalize_email(email)
    email.to_s.strip.downcase
  end

  def generate_code
    format("%06d", SecureRandom.random_number(1_000_000))
  end

  def supabase_request(method, path, body = nil)
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
    req["apikey"] = ENV["SUPABASE_SERVICE_ROLE_KEY"]
    req["Authorization"] = "Bearer #{ENV['SUPABASE_SERVICE_ROLE_KEY']}"
    req["Content-Type"] = "application/json"
    req["Prefer"] = "return=minimal"
    req.body = body.to_json if body
    res = http.request(req)
    [res.code.to_i, res.body]
  end

  def resend_email(to, code)
    uri = URI("https://api.resend.com/emails")
    from = ENV["RESEND_FROM_EMAIL"].to_s.strip
    from = "GlobalVest <onboarding@resend.dev>" if from.empty?

    body = {
      from: from,
      to: [to],
      subject: "Verify your GlobalVest account",
      text: "Your GlobalVest verification code is:\n\n#{code}\n\nThis code expires in 10 minutes."
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

  def health
    load_dotenv!
    missing = missing_env
    {
      ok: missing.empty?,
      configured: missing.empty?,
      missing: missing,
      message: missing.empty? ? "Email verification is configured." : "Missing: #{missing.join(', ')}"
    }
  end
end
