# Natter on the desktop

Natter is a UI for NATS™. The `natter` binary serves a web UI on localhost. You can start it from a terminal, or from your app launcher into a browser app window. The desktop app wraps the same server in a native window.

## The desktop app

Releases also include a desktop build: Natter in a window of its own, with a tray icon and an installer.

| OS | Download |
|---|---|
| macOS | `natter-desktop_darwin_universal.dmg`. Drag Natter to Applications |
| Windows | `natter-desktop_windows_amd64-setup.exe`. Installs for your user only, no admin rights needed |
| Linux | `natter_<version>_amd64.deb` or `.rpm`, `natter-desktop_linux_amd64.AppImage`, or `natter-bin` from the AUR |

On Linux it needs GTK 4 and WebKitGTK 6.0, which the packages pull in. The AppImage expects them on the system.

- **One window.** Starting Natter again shows the window that is already open. Closing the window hides it, and Natter keeps running in the tray. Quit from the tray menu, or with Cmd+Q on macOS.
- **No terminal, no token to copy.** The app starts Natter's normal server on a free loopback port and opens the window signed in. The Launch token never leaves the process.
- **Updates.** The macOS app, the Windows install and the AppImage check for updates once a day, and when you choose **Check for Updates…** in the tray. They install only updates signed with Natter's release key. A deb, rpm or AUR install updates through your package manager.
- **Ctrl+K / Cmd+K** opens the command palette, as in the browser. No menu claims it.
- **NVIDIA on Linux.** WebKitGTK cannot draw through NVIDIA's DMA-BUF path, so on NVIDIA the app turns that renderer off (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) before the window opens.

Running servers, `go install` and the commands below use the plain `natter` binary. The desktop build ignores `-bind`, `-port`, `-allowed-host`, `-dev` and `-redirect-file`, and takes `-vault-key`.

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
