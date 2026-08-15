[CmdletBinding()]
param(
    [string]$GitleaksPath = 'C:\Tools\gitleaks\8.29.1\gitleaks.exe',
    [switch]$SelfTestOnly
)

$ErrorActionPreference = 'Stop'

function Remove-StoryArkTempDirectory {
    param([Parameter(Mandatory)][string]$Path)

    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'

    if (-not $resolvedPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a directory outside the system temp folder: $resolvedPath"
    }

    if (Test-Path -LiteralPath $resolvedPath) {
        Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    }
}

function Test-GitleaksInstallation {
    $selfTestDirectory = Join-Path ([System.IO.Path]::GetTempPath()) (
        'storyark-gitleaks-selftest-' + [guid]::NewGuid().ToString('N')
    )

    New-Item -ItemType Directory -Path $selfTestDirectory | Out-Null

    try {
        $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        $randomBytes = New-Object byte[] 36
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
        $secretBody = -join $(
            for ($index = 0; $index -lt $randomBytes.Length; $index++) {
                $alphabet[$randomBytes[$index] % $alphabet.Length]
            }
        )

        $syntheticSecret = ('gh' + 'p_') + $secretBody
        $selfTestFile = Join-Path $selfTestDirectory 'synthetic-secret.txt'
        [System.IO.File]::WriteAllText($selfTestFile, $syntheticSecret)

        & $GitleaksPath dir $selfTestDirectory --redact --no-banner --no-color *> $null
        $selfTestExitCode = $LASTEXITCODE

        if ($selfTestExitCode -ne 1) {
            throw "Gitleaks self-test failed: expected exit code 1, received $selfTestExitCode. Do not trust a zero-result scan."
        }
    }
    finally {
        Remove-StoryArkTempDirectory -Path $selfTestDirectory
    }
}

if (-not (Test-Path -LiteralPath $GitleaksPath -PathType Leaf)) {
    throw "Gitleaks was not found at: $GitleaksPath"
}

Write-Host '[1/3] Verifying that Gitleaks can detect a synthetic secret...'
Test-GitleaksInstallation
Write-Host '      Self-test passed.'

if ($SelfTestOnly) {
    $global:LASTEXITCODE = 0
    return
}

$repositoryRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repositoryRoot)) {
    throw 'Run this script from inside the StoryArk Git repository.'
}

$candidateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) (
    'storyark-gitleaks-candidates-' + [guid]::NewGuid().ToString('N')
)
New-Item -ItemType Directory -Path $candidateDirectory | Out-Null

try {
    Write-Host '[2/3] Scanning tracked and non-ignored files in the current workspace...'
    $candidateFiles = & git -C $repositoryRoot ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) {
        throw 'Git could not enumerate the files that may enter the repository.'
    }

    foreach ($relativePath in $candidateFiles) {
        $sourcePath = Join-Path $repositoryRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            continue
        }

        $destinationPath = Join-Path $candidateDirectory $relativePath
        $destinationParent = Split-Path -Parent $destinationPath
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
    }

    & $GitleaksPath dir $candidateDirectory --redact --no-banner --no-color
    $workspaceScanExitCode = $LASTEXITCODE
    if ($workspaceScanExitCode -eq 1) {
        throw 'Potential secret found in the current workspace. Review the redacted finding above before committing.'
    }
    if ($workspaceScanExitCode -ne 0) {
        throw "The workspace scan did not finish normally (exit code $workspaceScanExitCode)."
    }
}
finally {
    Remove-StoryArkTempDirectory -Path $candidateDirectory
}

Write-Host '[3/3] Scanning the complete history of this new repository...'
& $GitleaksPath git $repositoryRoot --redact --no-banner --no-color
$historyScanExitCode = $LASTEXITCODE
if ($historyScanExitCode -eq 1) {
    throw 'Potential secret found in Git history. Review the redacted finding above before pushing or publishing.'
}
if ($historyScanExitCode -ne 0) {
    throw "The history scan did not finish normally (exit code $historyScanExitCode)."
}

Write-Host 'Secret scan passed: current commit candidates and repository history contain no detected leaks.'
