"""Contained ACP research lab: the unmodified Antigravity CLI inside a Windows AppContainer.

Research-only. Production chat keeps using ``AntigravityAcpAdapter`` unchanged.

Boundary (each item is checked by ``ContainedLab.preflight`` before any prompt):

* ``agy.exe`` and every descendant run with an AppContainer token at Low integrity, holding
  exactly one capability (``internetClient``), inside a kill-on-close Job Object. The token is
  read back from the suspended process before it runs.
* The container can open only paths whose DACL names its package SID: a copied CLI binary
  (read/execute), a lab home (modify) and a per-trial workspace (modify). The user's profile,
  repositories, other drives, ProgramData writes and Credential Manager are probed and must
  be denied.
* ``internetClient`` permits outbound internet only. Loopback/LAN connections to host services
  are probed and must fail.
* The container receives an explicit environment (no inherited secrets/tokens).

Residual risk that is *not* removed: the container holds the lab's own Antigravity OAuth token
(file storage inside the lab home) and has internet egress, so a prompt-injected agent could
exfiltrate that token or the trial inputs. Use synthetic data and sign the lab out afterwards.
"""

from .lab import ContainedLab, IsolationError, LAB_PROFILE
from .adapter import ContainedAcpAdapter

__all__ = ["ContainedLab", "IsolationError", "LAB_PROFILE", "ContainedAcpAdapter"]
