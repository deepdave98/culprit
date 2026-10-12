# Development

- Run `npm run check`, `npm test`, and `npm run build` after code changes.
- Keep result claims limited to captured evidence. Synthetic fixtures are not external validation.
- Do not change application source files during diagnosis.
- Keep generated reports, browser artifacts, `dist`, and `graphify-out` out of Git.
- Commits use `deepdave98`, without generated-by or co-author trailers.

# Repository graph

Run `/Users/deepdave/.local/bin/graphify-repo sync .` at the start of repository work and after validation, when available. Run it again after adding the first source files to an empty checkout. Each checkout owns its own `graphify-out`.

Query the graph first for architecture and impact questions, then verify the returned source paths. Respect `.gitignore` and `.graphifyignore`; do not force updates to hide extraction failures. Inspect `graphify-out/.codex-sync.log` and report unresolved sync failures. Code AST refresh does not imply semantic document/media refresh.

If adding a Conductor setup command, append `/Users/deepdave/.local/bin/graphify-repo init .` after project setup.
