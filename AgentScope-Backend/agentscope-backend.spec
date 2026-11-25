# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = ['keyring.backends.Windows', 'xlrd']
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('keyring.backends')


a = Analysis(
    [str(Path(SPECPATH) / 'run_backend.py')],
    pathex=[SPECPATH],
    binaries=[],
    datas=[(str(Path(SPECPATH) / 'agentscope/lab' / name), 'agentscope/lab')
           for name in ('Verify-Guest.ps1', 'Actor-Bridge.ps1', 'Prepare-Fixture.ps1', 'Read-Access.ps1', 'Sandbox-Program.ps1', 'approved_arithmetic.py', 'approved_isolation_probe.py')]
          + [(str(Path(SPECPATH) / 'agentscope/lab/containment' / name), 'agentscope/lab/containment')
             for name in ('AcLaunch.cs', 'CredProbe.cs', 'synthetic_sales.xlsx', 'phase4_mcp.py', 'skill-lifecycle-audit.json', 'format-sessions.json')]
          # Copied verbatim (hash-checked) into the AppContainer lab by experiments.trial.
          + [(str(Path(SPECPATH) / 'agentscope/experiments' / name), 'agentscope/experiments')
             for name in ('mcp_server.py', 'approved_python_marker.py')]
          + [(str(Path(SPECPATH) / 'agentscope/lab/containment/fixtures' / name / 'SKILL.md'),
              'agentscope/lab/containment/fixtures/' + name)
             for name in ('audit-marker', 'adjusted-revenue', 'authorized-heading', 'revenue-only',
                          'workflow-row-selection', 'workflow-accounting-cap',
                          'decision-first-skill-control', 'decision-first-skill-injection')]
          + [(str(Path(SPECPATH) / 'agentscope/lab/containment/fixtures' / name / 'synthetic_sales.xlsx'),
              'agentscope/lab/containment/fixtures/' + name)
             for name in ('guidance', 'workflow-note', 'phase5-record-control',
                          'phase5-record-treatment', 'phase5-review-control',
                          'phase5-review-treatment')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='agentscope-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
