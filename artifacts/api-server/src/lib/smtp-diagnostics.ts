/** Fixed diagnostic messages only: never return raw provider text or credentials. */
export function smtpConnectionDiagnostic(error: unknown, microsoft: boolean) {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof e.code === "string" ? e.code : "";
  const text = `${typeof e.response === "string" ? e.response : ""} ${typeof e.message === "string" ? e.message : ""}`.toLowerCase();
  if (/smtpclientauthentication.*disabled|5\.7\.139|smtp auth.*disabled|basic authentication.*disabled|5\.7\.30/.test(text)) {
    return { code: "SMTP_AUTH_BLOCKED", error: "Microsoft is blocking password-based SMTP access for this mailbox or organization. A correct password cannot override this policy. Use Sign in with Microsoft, or ask your administrator to review the mailbox's SMTP AUTH and authentication policy. Do not disable organization-wide security protections." };
  }
  if (code === "EAUTH" || Number(e.responseCode) === 535 || Number(e.responseCode) === 534) {
    return { code: "SMTP_AUTHENTICATION_REJECTED", error: microsoft
      ? "Microsoft rejected password-based authentication. This does not necessarily mean the password is wrong. Use the full mailbox sign-in address; if MFA is enabled, try an app password only if your organization offers and permits it. If unavailable or rejected, use Sign in with Microsoft. Your administrator may need to approve access."
      : "The mail provider rejected authentication. Check the full mailbox username and password. If the provider requires an app password, use that instead of your normal password." };
  }
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(code) && !/certificate|tls|ssl/.test(text)) {
    return { code: "SMTP_NETWORK_FAILURE", error: "The mail server could not be reached or the connection timed out. This is not proof of a wrong password. Check the SMTP host and port and ask the hosting administrator to verify outbound port 587 access, firewall rules, and DNS. Retry after the network issue is resolved." };
  }
  if (["EDNS", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return { code: "SMTP_DNS_FAILURE", error: "The SMTP hostname could not be resolved. Check the hostname and your hosting server's DNS configuration." };
  if (/certificate|tls|ssl/.test(text) || code === "ETLS") return { code: "SMTP_TLS_FAILURE", error: "A secure SMTP connection could not be established. For Microsoft 365 use smtp.office365.com, port 587, STARTTLS. Check the server clock and trusted certificates. Mailflow will not disable certificate validation to bypass this error." };
  return { code: "SMTP_CONNECTION_TEST_FAILED", error: "The mail connection could not be verified. Check the host, port and encryption, then retry. Microsoft 365 users can use Sign in with Microsoft when password-based SMTP is restricted." };
}
