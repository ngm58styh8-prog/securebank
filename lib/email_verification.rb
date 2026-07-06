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

  def supabase_admin_key
    load_dotenv!
    key = ENV["SUPABASE_SECRET_KEY"].to_s.strip
    if key.empty? && ENV["SUPABASE_SECRET_KEYS"]
      begin
        keys = JSON.parse(ENV["SUPABASE_SECRET_KEYS"])
        key = keys["default"].to_s.strip if keys.is_a?(Hash)
        key = keys.values.find { |v| v.to_s.strip != "" }.to_s.strip if key.empty? && keys.is_a?(Hash)
      rescue JSON::ParserError
        key = ""
      end
    end
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"].to_s.strip if key.empty?
    key
  end

  def supabase_secret_key?
    supabase_admin_key.start_with?("sb_secret_")
  end

  def configured?
    ENV["SUPABASE_URL"].to_s.strip != "" &&
      !supabase_admin_key.empty? &&
      ENV["RESEND_API_KEY"].to_s.strip != ""
  end

  def missing_env
    missing = []
    missing << "SUPABASE_URL" if ENV["SUPABASE_URL"].to_s.strip.empty?
    if supabase_admin_key.empty?
      missing << "SUPABASE_ADMIN_KEY (set SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS, or SUPABASE_SERVICE_ROLE_KEY)"
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
    supabase_admin_key.start_with?("eyJ")
  end

  def supabase_rpc(function_name, params = {})
    base = ENV["SUPABASE_URL"].to_s.chomp("/")
    uri = URI("#{base}/rest/v1/rpc/#{function_name}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"

    req = Net::HTTP::Post.new(uri)
    key = supabase_admin_key
    req["apikey"] = key
    req["Authorization"] = "Bearer #{key}" if supabase_jwt_key?
    req["Content-Type"] = "application/json"
    req["Prefer"] = "return=representation"
    req.body = params.to_json
    res = http.request(req)
    raise "Supabase RPC failed: #{res.body}" unless res.code.to_i.between?(200, 299)

    return nil if res.body.nil? || res.body.strip.empty?

    JSON.parse(res.body)
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
    key = supabase_admin_key
    req["apikey"] = key
    req["Authorization"] = "Bearer #{key}" unless supabase_secret_key?
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
      rows = supabase_rpc("globalvest_get_latest_verification", { p_email: email })
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

    code = generate_code
    expires_at = (Time.now + CODE_TTL_SEC).utc.iso8601

    supabase_rpc("globalvest_delete_unverified", { p_email: email })
    supabase_rpc("globalvest_insert_verification", {
      p_email: email,
      p_code: code,
      p_expires_at: expires_at
    })

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

    rows = supabase_rpc("globalvest_get_unverified", { p_email: email })
    row = rows.is_a?(Array) ? rows.first : nil
    return { ok: false, status: 400, error: "No active verification code found. Request a new code." } unless row

    if Time.parse(row["expires_at"]) < Time.now
      return { ok: false, status: 400, error: "Verification code has expired. Request a new code." }
    end

    return { ok: false, status: 400, error: "Invalid verification code." } unless row["code"] == code

    supabase_rpc("globalvest_mark_verified", { p_id: row["id"] })

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
