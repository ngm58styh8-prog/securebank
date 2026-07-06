#!/usr/bin/env ruby
# GlobalVest static server with deposit email notifications.

require "json"
require "webrick"
require "net/smtp"

ROOT = File.expand_path(__dir__)
CONFIG_PATH = File.join(ROOT, "email.config.json")
PORT = (ENV["PORT"] || "8765").to_i

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

trap("INT") { server.shutdown }

puts ""
puts "GlobalVest running at http://localhost:#{PORT}"
puts "  User:  http://localhost:#{PORT}/index.html"
puts "  Admin: http://localhost:#{PORT}/admin.html"
unless File.exist?(CONFIG_PATH)
  puts ""
  puts "  Email: copy email.config.example.json -> email.config.json to send real deposit emails."
end
puts ""
puts "Press Ctrl+C to stop."
puts ""

server.start
