# Fetch outstanding transcripts, unattended, from this machine.
#
# WHY THIS EXISTS. Transcripts are the one job that cannot run on shared cloud
# infrastructure: YouTube answers a GitHub runner with "Sign in to confirm
# you're not a bot" (proven, workflow run 31432973678), and Oracle's Singapore
# region has no Always Free capacity in any fault domain at any permitted size.
#
# But this desktop's IP is not datacenter-flagged, and every transcript in the
# corpus was fetched from it. The fragile half therefore does not need Oracle
# to become autonomous -- it needs a scheduler on a machine that already works.
# Oracle remains the better long-term home because it does not depend on a
# desktop being switched on; this closes the gap until then.
#
# WHAT IT DOES, in order:
#   1. starts the local yt-dlp service if it is not already listening
#   2. enqueues any content item still missing a transcript
#   3. drains transcript AND competitor_scan jobs -- everything else belongs
#      to GitHub Actions
#
# competitor_scan is here for the same reason transcripts are: it asks a
# platform for a profile listing, and a datacenter address gets refused.
# Measured 2026-08-25, yt-dlp profile extractors: YouTube works, Instagram and
# TikTok are both broken upstream -- so today this samples YouTube rivals and
# records the other two as unreachable rather than as empty.
#
# Safe to run on a timer: every stage is idempotent, jobs are leased so two
# overlapping runs cannot double-process, and a video with no caption track is
# recorded as such and never asked about again.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

function Read-EnvValue([string]$name) {
    $line = Get-Content ".env.local" | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
    if (-not $line) { return $null }
    return $line.Substring($name.Length + 1).Trim().Trim('"').Trim("'")
}

# --- 1. The transcript service -------------------------------------------
# Bound to loopback: the worker calls it from this same machine, so there is
# no reason to expose a scraping service to the network.
$listening = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Output "starting yt-dlp service on 127.0.0.1:8787"
    $secret = Read-EnvValue "TIKTOK_DISCOVER_SECRET"
    $env:DISCOVER_SECRET = $secret
    $env:HOST = "127.0.0.1"
    Start-Process -FilePath "python" `
        -ArgumentList "deploy/tiktok-discover/server.py" `
        -WorkingDirectory $repo -WindowStyle Hidden
    Start-Sleep -Seconds 8
} else {
    Write-Output "yt-dlp service already listening"
}

# --- 2 & 3. Enqueue, then drain transcripts only --------------------------
# Every variable the worker needs comes from .env.local, so this file is the
# single source of configuration and nothing is duplicated into the task.
foreach ($name in @("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY",
                    "TIKTOK_DISCOVER_URL", "TIKTOK_DISCOVER_SECRET",
                    "YOUTUBE_API_KEY")) {
    $v = Read-EnvValue $name
    if ($v) { Set-Item -Path "env:$name" -Value $v }
}
# The worker reads DISCOVER_SECRET; the project stores it under the TikTok name.
$env:DISCOVER_SECRET = $env:TIKTOK_DISCOVER_SECRET

Write-Output "enqueuing outstanding transcript work"
node worker/enqueue.mjs --kinds=transcript,competitor_scan

Write-Output "draining transcript jobs"
node --experimental-strip-types --import ./scripts/register-alias.mjs `
    worker/index.mjs --once --kinds=transcript,competitor_scan

Write-Output "done $(Get-Date -Format o)"
