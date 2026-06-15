# Concord Mobile — App Store Submission Checklist

Target: **Apple App Store first**, then Google Play.
Payments model: **no in-app purchasing** — Concord Coins are bought on the
website (concord-os.org); the app only spends + earns them. This keeps the
build clear of App Store IAP / external-purchase rules (the #1 rejection risk).

## ✅ Done (in code)

- [x] **In-app buying stripped.** `BuyCoinsScreen`, `useExternalPurchase`, and the
      native `ExternalPurchaseLink` StoreKit module are removed. No buy UI or
      external-purchase API ships in the binary. The `checkout-complete` deep
      link still refreshes the wallet when a user returns from a *web* purchase.
- [x] **Production backend URL.** `src/config/api.ts` defaults release builds to
      `https://concord-os.org` (was `http://localhost:5050`, which crashes on
      device). Dev builds still use localhost via `__DEV__`.
- [x] **EAS build/submit config** (`eas.json`) with dev / preview / production
      profiles; production bakes `EXPO_PUBLIC_API_URL=https://concord-os.org`.
- [x] **Apple privacy manifest** (`app.json` → `ios.privacyManifests`):
      required-reason APIs (UserDefaults, FileTimestamp, SystemBootTime,
      DiskSpace) + collected-data types (device ID, coarse location, user
      content), all `NSPrivacyTracking: false`. Apple auto-rejects without this.
- [x] **Permission usage strings** already present in `app.json` (Bluetooth,
      local network, location, NFC) with clear, reviewer-friendly descriptions.

## 🔴 Blocking — needs a human before first build

- [ ] **App icon + splash assets.** `app.json` references `./assets/icon.png`,
      `./assets/splash.png`, `./assets/adaptive-icon.png` — **the `assets/`
      directory does not exist.** The build cannot produce a binary without at
      least `icon.png` (1024×1024, no alpha for iOS). This is a design step, not
      a code step. Drop the files in `concord-mobile/assets/`.

## 🟠 Before submitting (mechanical)

- [ ] **Apple Developer account** ($99/yr) + create the app in App Store Connect.
      Fill `eas.json` → `submit.production.ios`: `appleId`, `ascAppId`,
      `appleTeamId` (currently `REPLACE_WITH_*` placeholders).
- [ ] **Privacy policy URL** (App Store Connect requires a public URL).
- [ ] **App Store screenshots** (6.7" + 6.5" iPhone, 12.9" iPad if
      `supportsTablet` stays true) + app description, keywords, category, age
      rating questionnaire.
- [ ] **Verify the two stub screens** read acceptably to a reviewer:
      `LensesScreen` (hardcoded lens list, no API) and `MarketplaceScreen`
      (store-only, no fetch). Either wire them to `/api/lenses` +
      `/api/marketplace/listings`, or make sure they don't look broken/empty.
- [ ] **Reviewer demo account** — App Review needs working credentials, or a
      clear "no login required" note. The mobile identity is a local keypair
      (no server login), so confirm a reviewer can reach real content offline /
      without an account.

## Build commands

```bash
cd concord-mobile
npm install
npx expo install --check          # align native deps to SDK 52

# First time: generate native projects (regenerates ios/ from app.json config)
npx expo prebuild --platform ios

# Cloud build (no local Xcode needed)
eas build --platform ios --profile production

# Submit to App Store Connect
eas submit --platform ios --profile production
```

## Notes

- `ios/ConcordMobile/` holds only loose native source (no `.pbxproj`) — Expo
  prebuild regenerates the full Xcode project from `app.json`. The
  `privacyManifests` key + permission strings flow through prebuild, so they
  survive regeneration (a loose `.xcprivacy` would be clobbered).
- 19/22 screens are backend-wired and real; the architecture is solid. The gap
  to a submittable build is assets + store paperwork, not engineering.
