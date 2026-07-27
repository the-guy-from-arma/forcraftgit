# Faircroft RP Desktop

Official Windows desktop client for `faircroft.online`.

## Local development

```powershell
pnpm install
pnpm start
```

## Build the installer

```powershell
pnpm dist
```

The NSIS installer, update metadata, and checksums are written to `desktop/release/`.

## Publish an update

1. Increase `version` in `desktop/package.json`.
2. Commit and push the release.
3. Create and push a tag such as `desktop-v1.0.1`, or run the desktop release workflow manually.
4. The workflow publishes the installer and `latest.yml` to GitHub Releases.
5. Installed clients download the update and offer to restart immediately. Choosing Later installs it automatically when the app closes.

The GitHub workflow requires repository Actions permission to write release contents.

For a trusted Windows publisher signature, configure:

- `WINDOWS_CERTIFICATE_BASE64`: the production `.pfx` certificate encoded as base64.
- `WINDOWS_CERTIFICATE_PASSWORD`: the private-key password.

Without those secrets the installer remains functional, but Windows SmartScreen may show an unknown-publisher warning.
