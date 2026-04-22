<#
.SYNOPSIS
  Configure branch protection on `main` and merge open Dependabot PRs that are green.

.DESCRIPTION
  Requires GitHub CLI (`gh`) logged in with permission to edit branch protection and merge PRs:
    gh auth login

  Required status check name must match what GitHub shows on PRs - for this repo the CI workflow
  is named "CI" and the job id is `build`, so the check context is:  CI / build

  If the API returns 422, open a merged PR, click "Details" on the green CI check, and copy the
  exact check name from the URL or checks sidebar, then set $RequiredCheckContext below.

.NOTES
  Classic PAT needs `repo` scope. Fine-grained token needs Contents (read) + Administration
  (write) on the repository to update branch protection.
#>

$ErrorActionPreference = "Stop"

$RequiredCheckContext = "CI / build"

function Resolve-GhExe {
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "${env:ProgramFiles}\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    "$env:LocalAppData\Programs\GitHub CLI\gh.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path -LiteralPath $p) { return $p }
  }
  throw "GitHub CLI (gh) not found. Install from https://cli.github.com/ or: winget install GitHub.cli"
}

function Parse-OwnerRepo {
  param([string]$RemoteUrl)
  if ($RemoteUrl -match "github\.com[:/]([^/]+)/([^/.]+)(\.git)?$") {
    return @{ Owner = $Matches[1]; Repo = $Matches[2] }
  }
  throw "Could not parse owner/repo from git remote: $RemoteUrl"
}

function Invoke-GhJson {
  param([string]$Gh, [string[]]$Args)
  $out = & $Gh @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("gh {0} failed:`n{1}" -f ($Args -join " "), $out)
  }
  return $out | ConvertFrom-Json
}

$gh = Resolve-GhExe
Write-Host "Using gh: $gh"

# Native stderr would surface as a terminating error when $ErrorActionPreference is Stop.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$null = & $gh auth status 2>&1
$authed = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap

if (-not $authed) {
  Write-Host ""
  Write-Host "You are not logged into GitHub CLI. Run this once in an interactive terminal:"
  Write-Host "  & `"$gh`" auth login -h github.com -p https -w"
  Write-Host ""
  Write-Host "Then re-run:"
  Write-Host "  powershell -NoProfile -File scripts/github-repo-hygiene.ps1"
  exit 1
}

$remote = (git remote get-url origin).Trim()
$parsed = Parse-OwnerRepo $remote
$owner = $parsed.Owner
$repo = $parsed.Repo
Write-Host "Repository: $owner/$repo (from origin)"

$body = @{
  required_status_checks        = @{
    strict = $true
    checks = @(
      @{ context = $RequiredCheckContext; app_id = $null }
    )
  }
  enforce_admins                = $false
  required_pull_request_reviews = $null
  restrictions                  = $null
  required_linear_history       = $false
  allow_force_pushes            = $false
  allow_deletions               = $false
  block_creations               = $false
  required_conversation_resolution = $false
  lock_branch                   = $false
  allow_fork_syncing            = $true
} | ConvertTo-Json -Depth 6

Write-Host ""
Write-Host "Applying branch protection on main (required check: $RequiredCheckContext)..."
$tmp = [System.IO.Path]::GetTempFileName()
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tmp, $body, $utf8NoBom)
  & $gh api -X PUT "repos/$owner/$repo/branches/main/protection" --input $tmp
  if ($LASTEXITCODE -ne 0) {
    throw "gh api branch protection failed (exit $LASTEXITCODE)."
  }
}
finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host "Branch protection updated."

Write-Host ""
Write-Host "Listing open Dependabot pull requests..."
$prs = Invoke-GhJson $gh @("pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,author,mergeStateStatus,isDraft,statusCheckRollup")

$db = @($prs | Where-Object {
    $_.author.type -eq "Bot" -and $_.author.login -eq 'dependabot[bot]'
  })

if ($db.Count -eq 0) {
  Write-Host 'No open PRs from dependabot[bot].'
  exit 0
}

Write-Host ("Found {0} Dependabot PR(s)." -f $db.Count)

foreach ($pr in $db) {
  $n = $pr.number
  $title = $pr.title
  $state = $pr.mergeStateStatus
  $draft = $pr.isDraft

  Write-Host ""
  Write-Host "PR #$n - $title"
  Write-Host "  mergeStateStatus=$state isDraft=$draft"

  if ($draft) {
    Write-Host "  skip: draft"
    continue
  }
  if ($state -ne "CLEAN") {
    Write-Host "  skip: not merge-clean (fix CI or resolve conflicts first)"
    continue
  }

  Write-Host "  merging (squash + delete branch)..."
  & $gh pr merge $n --squash --delete-branch -y
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  merge failed - open https://github.com/$owner/$repo/pull/$n and merge manually."
    continue
  }
  Write-Host "  merged."
}

Write-Host ""
Write-Host "Done."
