# DNS Provider Records

Use this as a ready reference for Cloudflare, Namecheap, GoDaddy, Route53, or similar DNS panels.

## Required records

| Type | Host / Name | Value / Target | Priority | Notes |
|---|---|---|---|---|
| A | `@` | `162.222.206.152` |  | Main domain |
| A | `www` | `162.222.206.152` |  | Website |
| A | `mail` | `162.222.206.152` |  | Mail identity / PTR target |
| A | `smtp` | `162.222.206.152` |  | SMTP clients |
| A | `imap` | `162.222.206.152` |  | IMAP clients |
| A | `pop3` | `162.222.206.152` |  | POP3 clients |
| A | `email` | `162.222.206.152` |  | Web alias |
| A | `app` | `162.222.206.152` |  | Web alias |
| A | `dev` | `162.222.206.152` |  | Web alias |
| A | `development` | `162.222.206.152` |  | Web alias |
| A | `mobile` | `162.222.206.152` |  | Web alias |
| MX | `@` | `mail.yoover.com` | `10` | Mail exchanger |
| TXT | `@` | `v=spf1 mx a:mail.yoover.com ip4:162.222.206.152 ~all` |  | SPF |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@yoover.com; adkim=r; aspf=r` |  | DMARC |

## Optional but recommended

| Type | Host / Name | Value / Target | Priority | Notes |
|---|---|---|---|---|
| TXT | `mail` | `v=spf1 a ip4:162.222.206.152 ~all` |  | Helps align `mail.yoover.com` identity |

## DKIM record for Gmail `signed-by: mail.yoover.com`

After generating your DKIM public key, add:

| Type | Host / Name | Value / Target | Notes |
|---|---|---|---|
| TXT | `default._domainkey.mail` | `v=DKIM1; k=rsa; p=PASTE_ONE_LINE_PUBLIC_KEY` | DKIM for `mail.yoover.com` |

## PTR / Reverse DNS

This is not added in your DNS zone editor. Set it in your VPS provider panel:

```text
162.222.206.152 -> mail.yoover.com
```

## Cloudflare note

For mail-related hostnames, use:

- DNS only
- not proxied

Especially for:

- `mail`
- `smtp`
- `imap`
- `pop3`

## Final client settings to publish

### Incoming

```text
IMAP hostname: imap.yoover.com
IMAP port: 993
POP3 hostname: pop3.yoover.com
POP3 port: 995
Security: SSL/TLS
```

### Outgoing

```text
SMTP hostname: smtp.yoover.com
SMTP port: 465
Alternative SMTP port: 587
Authentication: required
Security: SSL/TLS on 465, STARTTLS on 587
```
