#Requires -Version 7.0
[CmdletBinding()]
param(
    [string] $BuildRoot,
    [string] $JavaHome = $env:JAVA_HOME,
    [string] $StudioHome = (Join-Path $env:ProgramFiles 'Android/Android Studio'),
    [string] $D8Jar
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (!$BuildRoot) {
    $BuildRoot = Join-Path (Split-Path -Parent $repo) ((Split-Path -Leaf $repo) + '-build/android-sms')
}
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot, $repo)
if (!$JavaHome) { $JavaHome = Join-Path $StudioHome 'jbr' }
if (!$D8Jar) { $D8Jar = Join-Path $StudioHome 'plugins/android/lib/r8.jar' }
$java = Join-Path $JavaHome 'bin/java.exe'
$javac = Join-Path $JavaHome 'bin/javac.exe'
$jar = Join-Path $JavaHome 'bin/jar.exe'
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
foreach ($required in @($java, $javac, $jar, $keytool, $D8Jar)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) {
        throw 'Use an existing Android Studio installation, or specify -StudioHome, -JavaHome and -D8Jar.'
    }
}

function Invoke-Checked {
    param([string] $Tool, [string[]] $Arguments)
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Tool) failed with exit code $LASTEXITCODE" }
}

$tools = Join-Path $BuildRoot 'tools'
$signing = Join-Path $BuildRoot 'signing'
$run = Join-Path $BuildRoot ('build-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $tools,$signing,$run -Force | Out-Null
$buildLock = [IO.File]::Open((Join-Path $BuildRoot 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    function Get-BuildJar {
        param([string] $Uri, [string] $Sha256)
        $filename = Split-Path -Leaf ([uri]$Uri).AbsolutePath
        $destination = Join-Path $tools $filename
        if (!(Test-Path -LiteralPath $destination -PathType Leaf)) {
            $download = Join-Path $run $filename
            Invoke-WebRequest -Uri $Uri -OutFile $download -TimeoutSec 120
            if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $Sha256) {
                throw "Unexpected SHA-256 for $filename"
            }
            Move-Item -LiteralPath $download -Destination $destination
        }
        if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $Sha256) {
            throw "Cached tool check failed for $filename"
        }
        return $destination
    }

    $aaptJar = Get-BuildJar `
        'https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/8.13.2-14304508/aapt2-8.13.2-14304508-windows.jar' `
        '5DC730C3DC454B76D779A46036C06FD9C874039A31E22214434ECDBE64C3300A'
    $signerJar = Get-BuildJar `
        'https://dl.google.com/dl/android/maven2/com/android/tools/build/apksig/8.13.2/apksig-8.13.2.jar' `
        'C070ED1394629D74641AA0906F60B2FFA1EE77E6366A1F93437F59717B1AEB89'
    $androidJar = Get-BuildJar `
        'https://repo.maven.apache.org/maven2/org/robolectric/android-all/15-robolectric-14663667-2/android-all-15-robolectric-14663667-2.jar' `
        '34FFC4B2AB328BB255D5E4752A20D50F815A739DBE4340B6819057B2F56CC132'
    $aaptDirectory = Join-Path $run 'aapt2'
    [IO.Compression.ZipFile]::ExtractToDirectory($aaptJar, $aaptDirectory)
    $aapt = Join-Path $aaptDirectory 'aapt2.exe'

    $classes = Join-Path $run 'classes'
    $tests = Join-Path $run 'tests'
    $generated = Join-Path $run 'generated'
    $dex = Join-Path $run 'dex'
    New-Item -ItemType Directory -Path $classes,$tests,$generated,$dex | Out-Null
    $compiled = Join-Path $run 'resources.zip'
    $unsigned = Join-Path $run 'unsigned.apk'
    $bytecode = Join-Path $run 'classes.jar'
    $verified = Join-Path $run 'Rainfall-SMS.apk'
    $tempOption = '-Djava.io.tmpdir=' + $run

    $sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.java' -File -Recurse |
        Select-Object -ExpandProperty FullName)
    $logicTest = Join-Path $PSScriptRoot 'test/ReviewNoticeTest.java'
    $logicSource = Join-Path $PSScriptRoot 'src/com/rainfallstudio/sms'
    Invoke-Checked $javac @('--release', '11', '-encoding', 'UTF-8', '-d', $tests,
        (Join-Path $logicSource 'ReviewNotice.java'), (Join-Path $logicSource 'InboxAddress.java'), $logicTest)
    Invoke-Checked $java @($tempOption, '-cp', $tests, 'com.rainfallstudio.sms.ReviewNoticeTest')

    Invoke-Checked $aapt @('compile', '--dir', (Join-Path $PSScriptRoot 'res'), '-o', $compiled)
    Invoke-Checked $aapt @('link', '-I', $androidJar, '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'),
        '--java', $generated, '-0', 'arsc', '-o', $unsigned, $compiled)
    $rSource = Join-Path $generated 'com/rainfallstudio/sms/R.java'
    Invoke-Checked $javac (@('--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-cp', $androidJar,
        '-d', $classes, $rSource) + $sources)
    Invoke-Checked $jar @('--create', '--file', $bytecode, '-C', $classes, '.')
    Invoke-Checked $java @($tempOption, '-cp', $D8Jar, 'com.android.tools.r8.D8', '--release',
        '--min-api', '26', '--lib', $androidJar, '--lib', $JavaHome, '--output', $dex, $bytecode)

    $archive = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
    try {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $dex 'classes.dex'), 'classes.dex') | Out-Null
    } finally {
        $archive.Dispose()
    }

    $keyStore = Join-Path $signing 'rainfall-sms.p12'
    $passwordFile = Join-Path $signing 'signing-password.key'
    if (!(Test-Path -LiteralPath $keyStore)) {
        if (!(Test-Path -LiteralPath $passwordFile)) {
            [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)))
        }
        $env:RAINFALL_SMS_SIGNING_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
        Invoke-Checked $keytool @('-genkeypair', '-storetype', 'PKCS12', '-keystore', $keyStore,
            '-storepass:env', 'RAINFALL_SMS_SIGNING_PASSWORD', '-alias', 'rainfall-sms', '-keyalg', 'RSA',
            '-keysize', '3072', '-validity', '7305', '-dname', 'CN=Rainfall Studio SMS', '-noprompt')
    } else {
        $env:RAINFALL_SMS_SIGNING_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
    }

    Invoke-Checked $java @($tempOption, '-cp', $signerJar, (Join-Path $PSScriptRoot 'tools/SignApk.java'),
        $unsigned, $verified, $keyStore)
    Invoke-Checked $aapt @('dump', 'badging', $verified)
    $hash = (Get-FileHash -LiteralPath $verified -Algorithm SHA256).Hash.ToLowerInvariant()
    $apk = Join-Path $BuildRoot 'Rainfall-SMS.apk'
    $verifiedHash = $verified + '.sha256'
    Set-Content -LiteralPath $verifiedHash -Value ($hash + '  Rainfall-SMS.apk') -Encoding utf8NoBOM
    $prior = Join-Path $run 'previous.apk'
    if (Test-Path -LiteralPath $apk -PathType Leaf) {
        [IO.File]::Replace($verified, $apk, $prior)
    } else {
        [IO.File]::Move($verified, $apk)
    }
    try {
        $checksum = $apk + '.sha256'
        if (Test-Path -LiteralPath $checksum -PathType Leaf) {
            [IO.File]::Replace($verifiedHash, $checksum, (Join-Path $run 'previous.apk.sha256'))
        } else {
            [IO.File]::Move($verifiedHash, $checksum)
        }
    } catch {
        if (Test-Path -LiteralPath $prior -PathType Leaf) {
            [IO.File]::Replace($prior, $apk, (Join-Path $run 'promotion-incomplete.apk'))
        } else {
            [IO.File]::Move($apk, (Join-Path $run 'promotion-incomplete.apk'))
        }
        throw
    }
    Write-Output "RAINFALL_SMS_BUILD_RUN=$run"
    Write-Output "RAINFALL_SMS_APK=$apk"
    Write-Output "RAINFALL_SMS_SHA256=$hash"
} finally {
    [Environment]::SetEnvironmentVariable('RAINFALL_SMS_SIGNING_PASSWORD', $null)
    $buildLock.Dispose()
}
