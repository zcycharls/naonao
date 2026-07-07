param(
  [string]$SourceIcon = "build\icon.ico"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$IconPath = Resolve-Path (Join-Path $RepoRoot $SourceIcon)
$ResRoot = Join-Path $RepoRoot "android\src\main\res"

Add-Type -AssemblyName System.Drawing

$Source = [System.Drawing.Image]::FromFile($IconPath)
try {
  $FrameDimension = New-Object System.Drawing.Imaging.FrameDimension($Source.FrameDimensionsList[0])
  $FrameCount = $Source.GetFrameCount($FrameDimension)
  $BestIndex = 0
  $BestArea = 0
  for ($i = 0; $i -lt $FrameCount; $i++) {
    $Source.SelectActiveFrame($FrameDimension, $i) | Out-Null
    $Area = $Source.Width * $Source.Height
    if ($Area -gt $BestArea) {
      $BestArea = $Area
      $BestIndex = $i
    }
  }
  $Source.SelectActiveFrame($FrameDimension, $BestIndex) | Out-Null
  $Base = New-Object System.Drawing.Bitmap $Source.Width, $Source.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $BaseGraphics = [System.Drawing.Graphics]::FromImage($Base)
  try {
    $BaseGraphics.Clear([System.Drawing.Color]::Transparent)
    $BaseGraphics.DrawImage($Source, 0, 0, $Source.Width, $Source.Height)
  } finally {
    $BaseGraphics.Dispose()
  }

  $Targets = @(
    @{ Dir = "mipmap-mdpi"; Size = 48 },
    @{ Dir = "mipmap-hdpi"; Size = 72 },
    @{ Dir = "mipmap-xhdpi"; Size = 96 },
    @{ Dir = "mipmap-xxhdpi"; Size = 144 },
    @{ Dir = "mipmap-xxxhdpi"; Size = 192 }
  )

  foreach ($Target in $Targets) {
    $OutDir = Join-Path $ResRoot $Target.Dir
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $OutPath = Join-Path $OutDir "ic_launcher.png"
    $Size = [int]$Target.Size
    $Bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    try {
      $Graphics.Clear([System.Drawing.Color]::Transparent)
      $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $Graphics.DrawImage($Base, 0, 0, $Size, $Size)
      $Bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $Graphics.Dispose()
      $Bitmap.Dispose()
    }
  }

  [pscustomobject]@{
    Source = $IconPath.Path
    SourceFrame = $BestIndex
    SourceSize = "$($Base.Width)x$($Base.Height)"
    Targets = ($Targets | ForEach-Object { "$($_.Dir)/ic_launcher.png:$($_.Size)x$($_.Size)" }) -join ", "
  }
} finally {
  if ($Base) { $Base.Dispose() }
  $Source.Dispose()
}
