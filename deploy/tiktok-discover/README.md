# TikTok discovery service — setup

A tiny, standalone service that lists a TikTok profile's recent videos, using
`yt-dlp`. It exists because TikTok blocks profile pages for anonymous
scraping, and the extraction library for the free workaround (`yt-dlp`) is
Python, while the rest of this app is Node on Vercel. Rather than restructure
the live Vercel project to mix runtimes, this runs on its own box and the
main app calls it over HTTPS.

**Costs nothing to run**: Oracle Cloud's Always Free tier includes an
Arm-based VM (currently 2 OCPU / 12GB RAM total, reduced from 4/24 in a June
2026 change) that never expires and never bills, unlike a free *trial*. This
one endpoint needs a tiny fraction of that.

**What only you can do**: creating the Oracle Cloud account and the VM
itself requires identity/payment verification — that's account setup only
you can complete. Everything below this point is copy-paste once the VM
exists.

## 1. Create the VM (your side)

1. [Sign up for Oracle Cloud](https://signup.oraclecloud.com/) if you haven't
   (free, no charge unless you explicitly upgrade — but they do ask for a
   card for identity verification).
2. **Compute → Instances → Create instance.**
3. Shape: `VM.Standard.A1.Flex` (Ampere/Arm), **Always Free eligible** —
   1 OCPU / 6GB is plenty for this.
4. Image: **Ubuntu 24.04** (or latest LTS).
5. Add your SSH public key (or let Oracle generate a key pair for you and
   download it).
6. Create. Note the **public IP address** once it's running.

If instance creation fails with "Out of capacity" — a known, common issue
with this free shape — retry in a few minutes, or try a different
Availability Domain in the same region.

## 2. Open the network path (the most common gotcha)

Oracle has **two separate firewalls** that both need a hole for port 443, or
nothing gets through even if everything else is right:

- **Oracle's side**: your VM's subnet → **Security Lists** (or Network
  Security Groups) → add an ingress rule: source `0.0.0.0/0`, TCP, destination
  port `443`.
- **The VM's own OS firewall**: Ubuntu images on OCI ship with `iptables`
  rules that block everything but SSH by default. Run on the VM:

  ```bash
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save   # if installed; otherwise add to /etc/iptables/rules.v4
  ```

## 3. Install everything (on the VM, via SSH)

```bash
ssh ubuntu@<your-vm-ip>

sudo apt update && sudo apt install -y python3-venv python3-pip caddy

sudo mkdir -p /opt/tiktok-discover
sudo chown ubuntu:ubuntu /opt/tiktok-discover
```

Copy `server.py` and `requirements.txt` from this folder onto the VM (e.g.
`scp deploy/tiktok-discover/server.py deploy/tiktok-discover/requirements.txt ubuntu@<ip>:/opt/tiktok-discover/`),
then:

```bash
cd /opt/tiktok-discover
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Generate a secret the same way CRON_SECRET was generated for the main app.
echo "DISCOVER_SECRET=$(openssl rand -hex 32)" > .env
cat .env   # copy this value — you'll add it to Vercel as TIKTOK_DISCOVER_SECRET
```

## 4. Run it as a service

```bash
sudo cp tiktok-discover.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tiktok-discover
sudo systemctl status tiktok-discover   # should say "active (running)"
```

## 5. Put HTTPS in front of it

The service listens on `127.0.0.1:8787` only — it is never exposed directly.
Caddy terminates TLS and proxies to it. You don't need to own a domain:
`sslip.io` gives you a free hostname that resolves to your VM's IP, which is
enough for Caddy to get a real Let's Encrypt certificate.

If your VM's IP is `1.2.3.4`, your hostname is `1-2-3-4.sslip.io`.

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
1-2-3-4.sslip.io {
  reverse_proxy 127.0.0.1:8787
}
EOF
# replace 1-2-3-4 with your actual VM IP, dashes instead of dots

sudo systemctl restart caddy
```

## 6. Verify

```bash
curl https://1-2-3-4.sslip.io/health
# {"ok": true}

curl -H "Authorization: Bearer <your DISCOVER_SECRET>" \
  "https://1-2-3-4.sslip.io/discover?handle=ameerhnaran&limit=3"
```

You should get back real videos with view/like/comment counts.

## 7. Wire it into the app

Add to `.env.local` and to Vercel's environment variables:

```
TIKTOK_DISCOVER_URL=https://1-2-3-4.sslip.io/discover
TIKTOK_DISCOVER_SECRET=<the DISCOVER_SECRET from step 3>
```

Once both are set, TikTok discovery turns on automatically — no other
change needed. If either is missing, TikTok simply stays in
metrics-only mode, exactly as it does today.

## Maintenance

- `yt-dlp` gets patched by its maintainers when TikTok changes something
  that breaks extraction — this is the same tradeoff every scraping-based
  approach in this app carries. Update it periodically:
  ```bash
  cd /opt/tiktok-discover && ./venv/bin/pip install -U yt-dlp
  sudo systemctl restart tiktok-discover
  ```
- Logs: `journalctl -u tiktok-discover -f`
