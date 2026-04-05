# Ubuntu VPS Deploy Steps

Use these steps on your Ubuntu VPS after uploading this project.

## 1. Install Docker and Docker Compose plugin

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and log back in after adding your user to the `docker` group.

## 2. Upload project

Put the project on your VPS, for example:

```bash
mkdir -p ~/apps
cd ~/apps
```

Upload the full `config-generated` folder there.

## 3. Add real TLS cert files

This repo expects these files:

```text
certs/yoover.com.pem
certs/yoover.com-key.pem
```

They should be real certificate files for your production mail/web setup, not the local placeholders.

## 4. Review critical values

Before starting, confirm these files:

- `Caddyfile`
- `docker-compose.yml`
- `config/wildduck-webmail/default.toml`
- `config/wildduck/dbs.toml`
- `config/zone-mta/dbs-production.toml`
- `config/haraka/wildduck.yaml`

## 5. Open firewall ports

```bash
sudo ufw allow 25/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp
sudo ufw allow 995/tcp
sudo ufw reload
sudo ufw status
```

## 6. Start the stack

From the project root:

```bash
docker compose up -d --build --remove-orphans
```

## 7. Check status

```bash
docker compose ps -a
docker compose logs --tail=80 caddy
docker compose logs --tail=80 wildduck
docker compose logs --tail=80 zonemta
docker compose logs --tail=80 haraka
docker compose logs --tail=80 wildduck-webmail
```

## 8. Confirm ports

```bash
ss -tulpn | grep -E ':25|:80|:443|:465|:587|:993|:995'
```

You want to see:

- `25`
- `80`
- `443`
- `465`
- `587`
- `993`
- `995`

## 9. Test web access

Open these in a browser:

- `https://yoover.com`
- `https://www.yoover.com`
- `https://mail.yoover.com`
- `https://yoover.com/test-signup`

## 10. Test mail ports from the VPS

```bash
openssl s_client -connect imap.yoover.com:993 -servername imap.yoover.com
openssl s_client -connect pop3.yoover.com:995 -servername pop3.yoover.com
openssl s_client -connect smtp.yoover.com:465 -servername smtp.yoover.com
openssl s_client -starttls smtp -connect smtp.yoover.com:587 -servername smtp.yoover.com
```

## 11. Generate DKIM key pair on VPS

Example:

```bash
mkdir -p ~/dkim
cd ~/dkim
openssl genrsa -out dkim-mail-yoover-com.key 2048
openssl rsa -in dkim-mail-yoover-com.key -pubout -out dkim-mail-yoover-com.pub
```

Then convert the public key into one line:

```bash
awk 'NF {sub(/-----BEGIN PUBLIC KEY-----/, ""); sub(/-----END PUBLIC KEY-----/, ""); printf "%s", $0}' dkim-mail-yoover-com.pub
```

Use that value in DNS for:

```text
default._domainkey.mail.yoover.com
```

## 12. Reverse DNS / PTR

In your VPS provider panel, set:

```text
YOUR_VPS_IP -> mail.yoover.com
```

## 13. Common issues

### Gmail does not show `mailed-by: mail.yoover.com`

Check:

- `mail.yoover.com` A record
- PTR to `mail.yoover.com`
- SPF includes your VPS IP

### Gmail does not show `signed-by: mail.yoover.com`

Check:

- DKIM TXT exists for `default._domainkey.mail.yoover.com`
- outbound server is signing with `mail.yoover.com`

### SMTP 587 fails

Check:

- firewall allows `587`
- `docker compose ps` shows `587->587`
- `openssl s_client -starttls smtp` succeeds

### IMAP or POP3 fail

Check:

- firewall allows `993` and `995`
- certificate files are valid
- DNS names point to the VPS
