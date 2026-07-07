# frozen_string_literal: true

require "json"
require "digest"
require "securerandom"

module EmailDeliverability
  CONFIG_PATH = File.join(File.expand_path("..", __dir__), "server-lib", "email-config.json")
  CONFIG = JSON.parse(File.read(CONFIG_PATH))

  BRAND_NAME = CONFIG["brandName"]
  DEFAULT_FROM = "#{CONFIG['fromDisplayName']} <#{CONFIG['fromEmail']}>"
  DEFAULT_SUPPORT = CONFIG["replyToEmail"]
  DEFAULT_SITE = CONFIG["siteUrl"]
  DEFAULT_ADDRESS = CONFIG["physicalAddress"]
  BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", ".vercel.app", ".local"].freeze

  module_function

  def clean_env(key)
    ENV[key].to_s.strip.delete_prefix('"').delete_suffix('"').delete_prefix("'").delete_suffix("'")
  end

  def parse_from(from)
    if (m = from.match(/^(.+?)\s*<([^>]+)>$/))
      { name: m[1].strip, email: m[2].strip.downcase }
    else
      { name: CONFIG["fromDisplayName"], email: from.strip.downcase }
    end
  end

  def blocked_host?(hostname)
    host = hostname.to_s.downcase
    BLOCKED_HOSTS.any? do |blocked|
      blocked.start_with?(".") ? host.end_with?(blocked) || host == blocked[1..] : host == blocked
    end
  end

  def normalize_site_url(raw = nil)
    candidate = clean_env("RESEND_SITE_URL")
    candidate = raw.to_s.strip if raw && !raw.to_s.strip.empty?
    candidate = DEFAULT_SITE if candidate.empty?

    candidate = DEFAULT_SITE unless candidate.start_with?("https://")

    uri = URI.parse(candidate)
    return DEFAULT_SITE.chomp("/") if blocked_host?(uri.host)

    (uri.origin + uri.path).chomp("/")
  rescue StandardError
    DEFAULT_SITE.chomp("/")
  end

  def from_address
    raw = clean_env("RESEND_FROM_EMAIL")
    raw.empty? ? DEFAULT_FROM : raw
  end

  def reply_to
    raw = clean_env("RESEND_REPLY_TO")
    raw.empty? ? DEFAULT_SUPPORT : raw
  end

  def physical_address
    raw = clean_env("RESEND_PHYSICAL_ADDRESS")
    raw.empty? ? DEFAULT_ADDRESS : raw
  end

  def sandbox_from?(from)
    email = parse_from(from)[:email]
    email.end_with?("@resend.dev") || email.end_with?("@resend.com") || email == "onboarding@resend.dev"
  end

  def message_id(recipient)
    stamp = Time.now.to_i.to_s(36)
    hash = Digest::SHA256.hexdigest("#{recipient}#{stamp}#{SecureRandom.hex(8)}")[0, 16]
    "<gv-verify-#{stamp}-#{hash}@#{CONFIG['fromEmail'].split('@').last}>"
  end

  def transactional_headers(recipient)
    ref = "gv-verify-#{recipient.to_s.gsub(/[^a-z0-9@._-]/i, '')}"
    {
      "Organization" => CONFIG["organizationHeader"],
      "X-Auto-Response-Suppress" => "All",
      "X-Entity-Ref-ID" => ref,
      "X-Priority" => "3",
      "Message-ID" => message_id(recipient)
    }
  end

  def deliverability_warnings
    warnings = []
    from = from_address
    parsed = parse_from(from)
    expected_domain = CONFIG["fromEmail"].split("@").last

    if sandbox_from?(from)
      warnings << "RESEND_FROM_EMAIL uses a Resend sandbox address (#{parsed[:email]}). Verify #{expected_domain} in Resend."
    end

    if parsed[:email] == CONFIG["replyToEmail"]
      warnings << "RESEND_FROM_EMAIL is support@#{expected_domain}. Use #{DEFAULT_FROM} with Reply-To #{DEFAULT_SUPPORT}."
    elsif !sandbox_from?(from) && parsed[:email] != CONFIG["fromEmail"]
      warnings << "RESEND_FROM_EMAIL is #{parsed[:email]}. Recommended: #{CONFIG['fromEmail']}."
    end

    if clean_env("RESEND_FROM_EMAIL").empty?
      warnings << "RESEND_FROM_EMAIL is not set. Set it to #{DEFAULT_FROM}."
    end

    if clean_env("RESEND_REPLY_TO").empty?
      warnings << "RESEND_REPLY_TO is not set. Set it to #{DEFAULT_SUPPORT}."
    end

    warnings
  end

  def verification_content(code, recipient_email)
    site_url = normalize_site_url
    support = reply_to
    address = physical_address
    login_url = "#{site_url}/login.html"
    safe_code = code.to_s.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")
    safe_email = recipient_email.to_s.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")

    text = <<~TEXT.strip
      #{BRAND_NAME}

      You requested a sign-in code for your account.

      Your code: #{code}

      This code expires in 10 minutes and works once.

      Continue at: #{login_url}

      Sent to: #{recipient_email}
      If you did not request this, ignore this email.

      Support: #{support}
      Website: #{site_url}

      #{address}

      — #{BRAND_NAME}
    TEXT

    html = <<~HTML.strip
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your GlobalVest Bank sign-in code</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f4f6f8;color:#1f2937;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your sign-in code for #{BRAND_NAME} expires in 10 minutes.</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f8;">
          <tr><td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
              <tr><td style="padding:32px 32px 16px;">
                <header>
                  <p style="margin:0 0 4px;font-size:12px;line-height:1.4;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;">#{BRAND_NAME}</p>
                  <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:#111827;">Your sign-in code</h1>
                </header>
                <main>
                  <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Enter this code on the sign-in page to verify your email address.</p>
                  <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7280;">One-time code</p>
                  <p style="margin:0 0 24px;padding:16px 20px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;text-align:center;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:0.28em;font-family:Consolas,Monaco,'Courier New',monospace;color:#111827;">#{safe_code}</p>
                  <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6b7280;">Expires in 10 minutes. Sent to <strong style="color:#374151;">#{safe_email}</strong>.</p>
                  <p style="margin:0 0 24px;"><a href="#{login_url}" style="color:#ffffff;background-color:#1f2937;text-decoration:none;display:inline-block;padding:12px 18px;border-radius:6px;font-size:14px;font-weight:600;">Open GlobalVest Bank</a></p>
                </main>
                <footer>
                  <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6b7280;">Did not request this? You can ignore this message.</p>
                  <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Support: <a href="mailto:#{support}" style="color:#374151;text-decoration:underline;">#{support}</a></p>
                  <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Website: <a href="#{site_url}" style="color:#374151;text-decoration:underline;">#{site_url}</a></p>
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">#{address}</p>
                </footer>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>
    HTML

    {
      subject: "Your GlobalVest Bank sign-in code",
      text: text,
      html: html,
      headers: transactional_headers(recipient_email)
    }
  end
end
