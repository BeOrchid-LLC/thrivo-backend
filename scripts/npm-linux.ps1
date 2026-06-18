param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NpmArgs = @("install")
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path $repoRoot).Path

docker run --rm `
  -v "${repoRoot}:/app" `
  -w /app `
  node:22-bookworm `
  npm @NpmArgs
