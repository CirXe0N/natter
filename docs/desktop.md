# Natter on the desktop

Natter is a UI for NATS™. It is one binary that serves a web UI on localhost. You can start it from a terminal, or from your app launcher into its own window.

## Start it from your app launcher

```sh
natter install-desktop
```

This adds Natter to the app launcher. The entry runs `natter open`, so no terminal is involved:

| OS | What it creates |
|---|---|
| Linux | `$XDG_DATA_HOME/applications/natter.desktop` (usually `~/.local/share/applications`) and its icon in `$XDG_DATA_HOME/natter/` |
| macOS | `~/Applications/Natter.app` |
| Windows | A Start Menu shortcut, `Natter`, and its icon in `%LOCALAPPDATA%\Natter\` |

The entry points at the binary where it is now. If you move the binary, run `natter install-desktop` again. `natter uninstall-desktop` removes the entry.

`natter open` does the same from a shell. If Natter is already running, it opens a new window on that server. Otherwise it starts the server and keeps running until you stop it. The window is signed in, because `natter open` hands it the Launch token URL instead of printing it.

- **The window.** Natter looks for Chrome, Edge, Brave or Chromium in the usual install locations and opens an app window (`--app=`) in it, with your normal browser profile. With none of them installed, it opens your default browser instead.
- **Shared machines.** The Launch token is in the browser's command line, where other users on the same machine can see it (`ps`). `natter open -redirect-file` passes the browser a file that only you can read, which redirects to the Launch token URL. Browsers installed as a Snap or Flatpak may not be allowed to read that file.
- **Server flags.** `natter open` takes the same flags as `natter`, such as `-port` and `-vault-key`. They only apply when it starts the server.
- **Install as an app.** Chromium-based browsers also offer to install Natter as an app, from its manifest. That app starts without the Launch token, so it only works while the natter that signed the browser in is still running. `natter open` is the reliable way in.

## Unsigned-binary warnings

Release binaries are not signed by Apple or Microsoft yet, so both systems warn the first time you run a downloaded copy. Check the download against `checksums.txt` first (see [Verify a download](releasing.md#verify-a-download)). A binary you built yourself with `go install` was never downloaded, so it gets no warning.

### macOS (Gatekeeper)

macOS refuses to open a downloaded `natter` and says Apple could not check it for malicious software. Either:

- remove the quarantine flag the browser added, then run it again:

  ```sh
  xattr -d com.apple.quarantine ./natter
  ```

- or try to run it once, then open **System Settings → Privacy & Security**, find the message about `natter` and choose **Open Anyway**.

`Natter.app` from `natter install-desktop` is created on your Mac, not downloaded, so it carries no quarantine flag.

### Windows (SmartScreen)

Starting a downloaded `natter.exe` from Explorer shows **Windows protected your PC**. Choose **More info**, then **Run anyway**. To clear the downloaded-file mark before the first run instead, in PowerShell:

```powershell
Unblock-File .\natter.exe
```

Smart App Control (Windows 11) can block unsigned programs without offering **Run anyway**. Natter then only runs with Smart App Control turned off, in **Windows Security → App & browser control**.
