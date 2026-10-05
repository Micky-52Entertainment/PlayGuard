# Installing PlayGuard

PlayGuard runs on **one computer** in the office. Everyone else opens a link in
their browser and installs nothing. Phones open playables through a QR code
with the regular camera.

> По-русски: [КАК-НАЧАТЬ.md](../КАК-НАЧАТЬ.md).

## What you need

| | |
| --- | --- |
| **Computer** | A Mac with macOS 13 (Ventura) or newer, Apple chip or Intel. Or a PC with Windows 10 or 11, 64-bit |
| **Memory** | 8 GB, 16 GB recommended: a check runs several browsers at once |
| **Disk** | About 2 GB for the app, plus room for reports (Settings → Storage shows how much they take) |
| **Network** | The computer, the phones and the teammates on the same Wi-Fi or office network |

Node.js, the browsers for the checks (Chromium and Safari's engine, WebKit) and the video recorder are all inside the app.

## 1. Download

Open **[Releases → latest](https://github.com/Micky-52Entertainment/PlayGuard/releases/latest)** and download the file for your computer:

| Computer | File |
| --- | --- |
| Mac with an Apple chip (M1, M2, M3, M4…) | `PlayGuard-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `PlayGuard-<version>-mac-x64.dmg` |
| Windows | `PlayGuard-<version>-win-x64.exe` |

Not sure which Mac you have? Apple menu  → **About This Mac**: the line **Chip** says "Apple M…"; an Intel Mac has a **Processor** line instead.

The `.zip`, `.blockmap` and `latest*.yml` files on the same page are for automatic updates; you do not need them.

## 2. Install

**Mac.** Open the `.dmg` and drag **PlayGuard** into **Applications**.

**Windows.** Run the `.exe`. The installer asks where to install and adds PlayGuard to the Start menu and the desktop.

## 3. First start

The app is not signed with a paid developer certificate yet, so the system asks once whether to trust it.

**Mac**

1. Open PlayGuard from Applications. macOS says it cannot verify the developer. Press **Done** (or **Cancel**).
2. Open **System Settings → Privacy & Security**, scroll down to "PlayGuard was blocked…" and press **Open Anyway**. Confirm with your password.
3. When macOS asks whether PlayGuard may **find devices on your local network**, press **Allow**: that is how phones and teammates reach it.

**Windows**

1. "Windows protected your PC": press **More info → Run anyway**.
2. When Windows Defender Firewall asks, tick **Private networks** and press **Allow access**.

PlayGuard opens its window. Closing the window keeps it working for the team. Quit it from its icon in the menu bar (Mac) or next to the clock (Windows); the same menu has **Copy link for the team**, **Data folder** and **Check for updates…**.

## 4. Invite the team

The link for teammates is in **Settings → Team** and in the icon menu (**Copy link for the team**). It looks like `http://192.168.1.20:8787`. Anyone on the same network opens it in a browser; the first time it asks for their name, shown next to their checks in the history.

To play a playable on a phone, choose **On a phone** in step 2 of a check and point the phone camera at the QR code.

## Updates

- **Windows:** a new version downloads in the background and installs when you quit PlayGuard.
- **Mac:** PlayGuard says when a new version is out and opens its download page. Download the new `.dmg` and drag it into Applications over the old one.

Checks, reports and settings stay where they are.

## Where your data is

| | |
| --- | --- |
| Mac | `~/Library/Application Support/PlayGuard` |
| Windows | `%APPDATA%\PlayGuard` |

The folder keeps reports, uploaded playables, archives of builds, recorded playthroughs and settings, including AI keys. Updating or removing the app does not touch it.

**Coming from the project folder?** Quit PlayGuard, copy the folders `reports`, `playables`, `batches`, `traces` and `.playable-lab` from the project into the data folder, and start it again.

## Removing

- **Mac:** drag PlayGuard from Applications to the Trash.
- **Windows:** Settings → Apps → PlayGuard → Uninstall.

To remove the history too, delete the data folder above.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Mac: "PlayGuard is damaged and can't be opened" | The download was blocked half-way, or the copy is from an older build. Download the `.dmg` again. If it persists, run `xattr -cr /Applications/PlayGuard.app` in Terminal and open it again |
| Mac: no **Open Anyway** button | Try to open PlayGuard once first; the button appears in Privacy & Security only after that, for about an hour |
| "PlayGuard is already running" | Another PlayGuard holds port 8787, usually one started from the project folder (`PlayGuard.command`, `PlayGuard.bat`, `npm start`). Close it and press **Retry** |
| The phone does not open the QR link | The phone and the computer must be on the same Wi-Fi. Guest networks usually keep devices apart; use the main one. Turn off VPN on the computer. On a Mac, check System Settings → Privacy & Security → **Local Network** → PlayGuard is on |
| Teammates cannot open the link | Same as above. On Windows, the network must be **Private** (Settings → Network → your network → Network profile type), and PlayGuard allowed in Windows Defender Firewall for private networks |
| A check says a browser or the video recorder is missing | Settings → **This computer** shows what is missing and installs it. PlayGuard says what and how big before downloading |

More questions are answered in the **Help** section inside PlayGuard. Still stuck? [Open an issue](https://github.com/Micky-52Entertainment/PlayGuard/issues/new/choose) with a screenshot.

## Running from the source code (developers)

Needs [Node.js](https://nodejs.org) 20 or newer (the CI uses the version in `.nvmrc`) on a Mac or Windows.

```bash
git clone https://github.com/Micky-52Entertainment/PlayGuard.git
cd PlayGuard
npm start
```

Or double-click `PlayGuard.command` (Mac) or `PlayGuard.bat` (Windows). The first start installs what it needs and asks before downloading anything. The browser opens `http://localhost:8787`; keep the start window open while the team uses it.

How a release is made: [docs/RELEASING.md](RELEASING.md). Everything else for developers: [docs/TECHNICAL.md](TECHNICAL.md).
