"""Chat-integrated Skill security experiments.

One legitimate task, one selected Skill snapshot, separately isolated Gemini sessions per
condition, and one comparison. Layers are kept apart on purpose:

* ``conditions``  experiment-mode policy: what is mandatory, what SkillGuard adds.
* ``readiness``   one reusable research-environment readiness service.
* ``workbook``    host-side snapshot, independent ground truth and Excel validation.
* ``skillguard``  content inspection and delivery decision for the selected Skill.
* ``mcp_server``  stdlib-only MCP tools executed inside the AppContainer.
* ``trial``       one condition = one fresh AppContainer + one fresh ACP session.
* ``analysis``    evidence -> per-condition outcome -> comparison.
* ``service``     orchestration, persistence, Chat/task integration and routes.
"""
