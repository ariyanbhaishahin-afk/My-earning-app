# My Earning App — Full Demo MVP (v0.2)

A mobile-first rewards app with a separate admin console and a Node.js API. This is an independently implemented demo inspired by common rewards/wallet app patterns; it does not reuse UMoney proprietary code, branding, or assets.

## Included
- Responsive user app: registration, phone-based demo login, wallet, coins, daily/sample tasks, referral code, transaction ledger, withdrawal request.
- Admin console: protected admin login, overview, user list, demo coin credits, task reward controls, withdrawal approve/reject, refund on reject.
- Backend API with signed expiring bearer tokens, server-side balance updates, JSON persistence, and separate user/admin roles.
- PWA manifest/service worker for browser installation on supported Android browsers.
- Android Studio WebView wrapper source scaffold (`android/`).

## Run locally
Requires Node.js 18+; no npm packages are required.

```sh
cp .env.example .env
# Set ADMIN_PASSWORD and APP_SECRET in your environment before starting.
ADMIN_PASSWORD='use-a-strong-password' APP_SECRET='use-a-long-random-secret' npm start
```

Open `http://localhost:3000` on your computer or phone on the same Wi-Fi. For phone access, use your computer's LAN IP and allow the port through its firewall.

Default demo admin login when environment variables are not set:
- Username: `admin`
- Password: `ChangeMe123!`

**Change this password and APP_SECRET before exposing the server to any network.**

## Android app / APK
The `android/` directory is an Android Studio WebView wrapper source scaffold. Before building, replace `APP_URL` in `android/app/src/main/java/com/myearning/app/MainActivity.java` with the deployed HTTPS URL of this app. Then open the `android/` folder in Android Studio and build an APK (`Build > Build Bundle(s) / APK(s) > Build APK(s)`). Sign a release APK with your own private signing key before distribution.

This workspace did not have the Android SDK/Gradle toolchain installed, so a compiled/signed APK is **not included**. The Android wrapper source is included.

## Important demo limitations
- Registration/login is not OTP-verified. Phone number alone is used for demo login; this is not safe for real accounts.
- All coins and balances are simulated. 100 demo coins = ₹1 demo balance only.
- Withdrawal approval is an admin status change only. No UPI transfer is made.
- Recharge, bank/UPI payments, KYC, identity verification, referral abuse detection, support tickets, push notifications and production-grade audit/security infrastructure are not integrated.
- Data is stored in a local JSON file. This is suitable only for a small demo, not production scale or financial records.

## Before a public launch
Use a managed database (e.g. PostgreSQL), OTP authentication, HTTPS hosting, rate limiting, robust admin MFA/RBAC, immutable accounting ledger, backups, audit logs, privacy policy/terms, fraud monitoring, KYC/AML and legal review as applicable. Integrate only RBI-authorized/appropriately regulated payment and recharge partners. Never use this demo's simulated balance as real money.
