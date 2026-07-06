#!/usr/bin/env ruby
# GlobalVest static server with deposit email notifications.

require "json"
require "webrick"
require "net/smtp"
require "fileutils"

require_relative "lib/email_verification"

ROOT = File.expand_path(__dir__)
CONFIG_PATH = File.join(ROOT, "email.config.json")
ACCOUNTS_REGISTRY_PATH = File.join(ROOT, "data", "accounts.json")
ADMIN_REGISTRY_PATH = File.join(ROOT, "data", "admin.json")
PORT = (ENV["PORT"] || "8765").to_i

def normalize_registry_email(email)
  email.to_s.strip.downcase
end

def ensure_accounts_registry_dir
  FileUtils.mkdir_p(File.dirname(ACCOUNTS_REGISTRY_PATH))
end

def load_accounts_registry
  ensure_accounts_registry_dir
  return {} unless File.exist?(ACCOUNTS_REGISTRY_PATH)

  data = JSON.parse(File.read(ACCOUNTS_REGISTRY_PATH))
  return {} unless data.is_a?(Hash)

  normalized = {}
  data.each do |key, entry|
    next unless entry.is_a?(Hash)

    email_key = normalize_registry_email(key)
    next if email_key.empty? || !email_key.include?("@")

    if normalized[email_key]
      normalized[email_key] = normalized[email_key].merge(entry)
    else
      normalized[email_key] = entry
    end
  end

  normalized
rescue JSON::ParserError, StandardError
  {}
end

def save_accounts_registry(accounts)
  ensure_accounts_registry_dir
  File.write(ACCOUNTS_REGISTRY_PATH, JSON.pretty_generate(accounts))
end

def load_admin_registry
  ensure_accounts_registry_dir
  return nil unless File.exist?(ADMIN_REGISTRY_PATH)

  data = JSON.parse(File.read(ADMIN_REGISTRY_PATH))
  data.is_a?(Hash) ? data : nil
rescue JSON::ParserError, StandardError
  nil
end

def save_admin_registry(admin)
  ensure_accounts_registry_dir
  File.write(ADMIN_REGISTRY_PATH, JSON.pretty_generate(admin))
end

def send_api_json(res, status, payload)
  res.status = status
  res["Content-Type"] = "application/json"
  res["Access-Control-Allow-Origin"] = "*"
  res["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
  res["Access-Control-Allow-Headers"] = "Content-Type"
  res.body = JSON.generate(payload)
end

def load_email_config
  if File.exist?(CONFIG_PATH)
    JSON.parse(File.read(CONFIG_PATH))
  else
    {
      "smtp_host" => ENV["SMTP_HOST"].to_s,
      "smtp_port" => (ENV["SMTP_PORT"] || "587").to_i,
      "smtp_user" => ENV["SMTP_USER"].to_s,
      "smtp_pass" => ENV["SMTP_PASS"].to_s,
      "from_email" => ENV["SMTP_FROM"].to_s,
      "from_name" => ENV["SMTP_FROM_NAME"] || "GlobalVest"
    }
  end
rescue JSON::ParserError
  {}
end

def send_smtp_email(to_addr, subject, body)
  cfg = load_email_config
  host = cfg["smtp_host"] || cfg["smtpHost"]
  port = (cfg["smtp_port"] || cfg["smtpPort"] || 587).to_i
  user = cfg["smtp_user"] || cfg["smtpUser"]
  pass = cfg["smtp_pass"] || cfg["smtpPass"]
  from_email = cfg["from_email"] || cfg["fromEmail"]
  from_email = user if from_email.to_s.empty?
  from_name = cfg["from_name"] || cfg["fromName"] || "GlobalVest"

  if host.to_s.empty? || user.to_s.empty? || pass.to_s.empty?
    return {
      "ok" => false,
      "error" => "Email not configured. Copy email.config.example.json to email.config.json and add SMTP credentials."
    }
  end

  message = <<~MAIL
    From: #{from_name} <#{from_email}>
    To: #{to_addr}
    Subject: #{subject}
    MIME-Version: 1.0
    Content-Type: text/plain; charset=UTF-8

    #{body}
  MAIL

  smtp = Net::SMTP.new(host, port)
  smtp.enable_starttls_auto
  smtp.start(user, pass) do |mailer|
    mailer.send_message(message, from_email, to_addr)
  end

  { "ok" => true }
rescue StandardError => e
  { "ok" => false, "error" => e.message }
end

server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: ROOT,
  BindAddress: "0.0.0.0"
)

server.mount_proc "/api/send-email" do |req, res|
  res["Content-Type"] = "application/json"
  res["Access-Control-Allow-Origin"] = "*"
  res["Access-Control-Allow-Methods"] = "POST, OPTIONS"
  res["Access-Control-Allow-Headers"] = "Content-Type"

  if req.request_method == "OPTIONS"
    res.status = 204
    res.body = ""
    next
  end

  unless req.request_method == "POST"
    res.status = 405
    res.body = JSON.generate("ok" => false, "error" => "Method not allowed")
    next
  end

  begin
    payload = JSON.parse(req.body)
    to_addr = payload["to"].to_s.strip
    subject = payload["subject"].to_s.strip
    body = payload["body"].to_s.strip

    if to_addr.empty? || subject.empty? || body.empty?
      res.status = 400
      res.body = JSON.generate("ok" => false, "error" => "Missing to, subject, or body.")
      next
    end

    result = send_smtp_email(to_addr, subject, body)
    res.status = result["ok"] ? 200 : 503
    res.body = JSON.generate(result)
  rescue JSON::ParserError
    res.status = 400
    res.body = JSON.generate("ok" => false, "error" => "Invalid JSON body.")
  rescue StandardError => e
    res.status = 500
    res.body = JSON.generate("ok" => false, "error" => e.message)
  end
end

server.mount_proc "/api/accounts" do |req, res|
  if req.request_method == "OPTIONS"
    res.status = 204
    res["Access-Control-Allow-Origin"] = "*"
    res["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
    res["Access-Control-Allow-Headers"] = "Content-Type"
    res.body = ""
    next
  end

  begin
    if req.request_method == "GET"
      accounts = load_accounts_registry
      send_api_json(res, 200, { "ok" => true, "accounts" => accounts, "count" => accounts.length })
      next
    end

    unless ["PUT", "POST"].include?(req.request_method)
      send_api_json(res, 405, { "ok" => false, "error" => "Method not allowed" })
      next
    end

    payload = JSON.parse(req.body)
    email = normalize_registry_email(payload["email"])
    account = payload["account"]

    if email.empty? || !email.include?("@") || !account.is_a?(Hash)
      send_api_json(res, 400, { "ok" => false, "error" => "Missing or invalid email/account payload." })
      next
    end

    accounts = load_accounts_registry
    if accounts[email] && accounts[email].is_a?(Hash)
      account = accounts[email].merge(account)
    end
    account["serverSyncedAt"] = Time.now.utc.iso8601
    accounts[email] = account
    save_accounts_registry(accounts)

    send_api_json(res, 200, { "ok" => true, "email" => email, "count" => accounts.length })
  rescue JSON::ParserError
    send_api_json(res, 400, { "ok" => false, "error" => "Invalid JSON body." })
  rescue StandardError => e
    send_api_json(res, 500, { "ok" => false, "error" => e.message })
  end
end

server.mount_proc "/api/admin-data" do |req, res|
  if req.request_method == "OPTIONS"
    res.status = 204
    res["Access-Control-Allow-Origin"] = "*"
    res["Access-Control-Allow-Methods"] = "GET, PUT, POST, OPTIONS"
    res["Access-Control-Allow-Headers"] = "Content-Type"
    res.body = ""
    next
  end

  begin
    if req.request_method == "GET"
      admin = load_admin_registry
      send_api_json(res, 200, { "ok" => true, "admin" => admin })
      next
    end

    unless ["PUT", "POST"].include?(req.request_method)
      send_api_json(res, 405, { "ok" => false, "error" => "Method not allowed" })
      next
    end

    payload = JSON.parse(req.body)
    admin = payload["admin"]

    unless admin.is_a?(Hash) && admin["email"]
      send_api_json(res, 400, { "ok" => false, "error" => "Missing or invalid admin payload." })
      next
    end

    existing = load_admin_registry
    if existing.is_a?(Hash)
      admin = existing.merge(admin)
    end
    admin["serverSyncedAt"] = Time.now.utc.iso8601
    save_admin_registry(admin)

    send_api_json(res, 200, { "ok" => true, "email" => admin["email"] })
  rescue JSON::ParserError
    send_api_json(res, 400, { "ok" => false, "error" => "Invalid JSON body." })
  rescue StandardError => e
    send_api_json(res, 500, { "ok" => false, "error" => e.message })
  end
end

def handle_verification_api(req, res, action)
  if req.request_method == "OPTIONS"
    res.status = 204
    res["Access-Control-Allow-Origin"] = "*"
    res["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    res["Access-Control-Allow-Headers"] = "Content-Type"
    res.body = ""
    return
  end

  begin
    if action == "health" && req.request_method == "GET"
      result = EmailVerification.health
      send_api_json(res, result[:ok] ? 200 : 503, result)
      return
    end

    return send_api_json(res, 405, { "ok" => false, "error" => "Method not allowed" }) unless req.request_method == "POST"

    payload = JSON.parse(req.body)
    email = payload["email"]
    code = payload["code"]

    result = case action
             when "send" then EmailVerification.create_and_send(email, enforce_cooldown: false)
             when "resend" then EmailVerification.create_and_send(email, enforce_cooldown: true)
             when "verify" then EmailVerification.verify(email, code)
             else { ok: false, status: 404, error: "Unknown action" }
             end

    send_api_json(res, result[:status] || 500, result)
  rescue JSON::ParserError
    send_api_json(res, 400, { "ok" => false, "error" => "Invalid JSON body." })
  rescue StandardError => e
    send_api_json(res, 500, { "ok" => false, "error" => e.message })
  end
end

server.mount_proc "/api/send-verification" do |req, res|
  handle_verification_api(req, res, "send")
end

server.mount_proc "/api/resend-verification" do |req, res|
  handle_verification_api(req, res, "resend")
end

server.mount_proc "/api/verify-email" do |req, res|
  handle_verification_api(req, res, "verify")
end

server.mount_proc "/api/verification-health" do |req, res|
  handle_verification_api(req, res, "health")
end

trap("INT") { server.shutdown }

puts ""
puts "GlobalVest running at http://localhost:#{PORT}"
puts "  User:  http://localhost:#{PORT}/index.html"
puts "  Admin: http://localhost:#{PORT}/admin.html"
unless File.exist?(CONFIG_PATH)
  puts ""
  puts "  Email: copy email.config.example.json -> email.config.json to send real deposit emails."
end
EmailVerification.load_dotenv!
if EmailVerification.configured?
  puts "  Verification: Resend + Supabase configured (.env.local or ENV)."
elsif !EmailVerification.missing_env.empty?
  puts "  Verification: copy .env.example → .env.local for signup email codes."
end
puts ""
puts "Press Ctrl+C to stop."
puts ""

server.start
