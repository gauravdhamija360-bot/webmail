# Yoover Mail DNS and VPS Checklist

Use this checklist when deploying this stack on your Ubuntu VPS.

## 1. DNS records

Use your real VPS public IP: `162.222.206.152`.

### A records

```dns
yoover.com.           A      162.222.206.152
www.yoover.com.       A      162.222.206.152
mail.yoover.com.      A      162.222.206.152
smtp.yoover.com.      A      162.222.206.152
imap.yoover.com.      A      162.222.206.152
pop3.yoover.com.      A      162.222.206.152
email.yoover.com.     A      162.222.206.152
app.yoover.com.       A      162.222.206.152
dev.yoover.com.       A      162.222.206.152
development.yoover.com. A    162.222.206.152
mobile.yoover.com.    A      162.222.206.152
```

### MX record

Use `mail.yoover.com` as the mail exchanger.

```dns
yoover.com.           MX 10  mail.yoover.com.
```

### SPF record

This tells receivers that your VPS can send mail for `yoover.com`.

```dns
yoover.com.           TXT    "v=spf1 mx a:mail.yoover.com ip4:162.222.206.152 ~all"
```

If you want mail to align more tightly with `mail.yoover.com` as an SMTP identity, also add:

```dns
mail.yoover.com.      TXT    "v=spf1 a ip4:162.222.206.152 ~all"
```

### DMARC record

Start with monitoring first:

```dns
_dmarc.yoover.com.    TXT    "v=DMARC1; p=none; rua=mailto:postmaster@yoover.com; adkim=r; aspf=r"
```

After verifying delivery, you can tighten this later to `quarantine` or `reject`.

## 2. DKIM for Gmail "signed-by"

If you want Gmail to show `signed-by: mail.yoover.com`, then your outbound mail must be DKIM-signed with:

- domain: `mail.yoover.com`
- selector: choose one, for example `default`

Create a DKIM key pair on the VPS:

```bash
openssl genrsa -out dkim-mail-yoover-com.key 2048
openssl rsa -in dkim-mail-yoover-com.key -pubout -out dkim-mail-yoover-com.pub
```

Then publish the public key as a TXT record:

```dns
default._domainkey.mail.yoover.com. TXT "v=DKIM1; k=rsa; p=PASTE_PUBLIC_KEY_HERE"
```

Notes:

- the `p=` value must be your public key in one line without the `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----` lines
- if you prefer Gmail to show `signed-by: yoover.com`, then publish DKIM under `yoover.com` instead

## 3. PTR / reverse DNS for Gmail "mailed-by"

Set the reverse DNS of `162.222.206.152` to:

```text
mail.yoover.com
```

This is usually configured in your VPS provider panel, not in your DNS zone editor.

For best trust alignment:

- PTR should be `mail.yoover.com`
- `mail.yoover.com` should resolve back to the same `162.222.206.152`
- outbound SMTP hostname should be `mail.yoover.com`

## 4. Firewall ports on Ubuntu VPS

Open these ports:

```text
25    SMTP inbound
465   SMTP over SSL/TLS
587   SMTP with STARTTLS
993   IMAP over SSL/TLS
995   POP3 over SSL/TLS
80    HTTP
443   HTTPS
```

If using `ufw`:

```bash
sudo ufw allow 25/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp
sudo ufw allow 995/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

## 5. TLS certificate files expected by this repo

Place real mail certificate files here:

```text
certs/yoover.com.pem
certs/yoover.com-key.pem
```

The certificate should cover at least:

- `mail.yoover.com`
- `smtp.yoover.com`
- `imap.yoover.com`
- `pop3.yoover.com`

A wildcard `*.yoover.com` certificate also works.

## 6. Final client settings

These are the settings your users should use:

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

## 7. Gmail expectations

For Gmail to show `mailed-by: mail.yoover.com` and `signed-by: mail.yoover.com`, all of these must align:

- outbound server identity should use `mail.yoover.com`
- PTR of the server IP should be `mail.yoover.com`
- DKIM must sign with `d=mail.yoover.com`
- SPF and DMARC must not conflict

If one of these does not align, Gmail may still deliver the mail, but the visible labels can differ.
