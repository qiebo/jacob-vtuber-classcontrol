$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = Split-Path -Parent $ProjectDir
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }

Push-Location $RepoDir
try {
    & $Python -m pip install -r "teacher-console\requirements.txt" pyinstaller
    & $Python -m PyInstaller `
        --noconfirm `
        --clean `
        --onefile `
        --name "JacobTeacherConsole" `
        --add-data "teacher-console\teacher_console\static;teacher_console\static" `
        --paths "teacher-console" `
        --hidden-import "uvicorn.logging" `
        --hidden-import "uvicorn.loops.auto" `
        --hidden-import "uvicorn.protocols.http.auto" `
        --hidden-import "uvicorn.protocols.websockets.auto" `
        "teacher-console\run_teacher_console.py"
} finally {
    Pop-Location
}

Write-Host "Built: $RepoDir\dist\JacobTeacherConsole.exe"
