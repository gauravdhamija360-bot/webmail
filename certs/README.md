Place your VPS mail TLS certificate files in this directory before starting the mail stack.

Expected filenames:
- yoover.com.pem
- yoover.com-key.pem

The certificate should cover at least:
- smtp.yoover.com
- imap.yoover.com
- pop3.yoover.com
- mail.yoover.com

A wildcard certificate for `*.yoover.com` also works.
