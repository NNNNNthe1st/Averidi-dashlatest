# Averidi Dashboard: how to run and review

## 1. Start the app (GitHub Codespaces, recommended)

1. Upload this project to the GitHub repository and open it in a **Codespace** (Code > Codespaces > Create).
2. In the Codespace terminal run:

   ```sh
   nvm install 22 && nvm use 22
   npm run averidi:start
   ```

   The first run prepares the database and builds the app. This takes a few minutes. Later runs are faster.
3. When the terminal shows **"Averidi Dashboard: https://...-3000.app.github.dev/dashboard/app/signup"**, open that link.
   (In the Codespace **Ports** tab, port 3000 should be set to **Private**.)
4. **Create an account.** If no email provider is set up, the verification link is **printed in the terminal**. Open it, then sign in.

   **To send real verification emails through Resend:** add two Codespaces secrets (GitHub > Settings > Codespaces > Secrets, give the repo access), then restart the Codespace and run `npm run averidi:start` again:
   - `DASHBOARD_EMAIL_API_KEY`: your Resend API key (starts with `re_`)
   - `DASHBOARD_EMAIL_FROM`: the sender, for example `Averidi <no-reply@averidi.com>` (the domain must be verified in Resend)

   The start message then says "Email: sent through Resend". If something is wrong it says why.
5. Enter a business name and you are in Studio.

To stop: press **Ctrl+C** in the terminal. Your data stays for next time.

Running on your own computer instead: Node 22, Docker and openssl are needed. Run `npm run averidi:start` and open https://localhost:3000/dashboard/app/signup (accept the browser's local certificate warning once).

## 2. Try it with a file

1. Studio > **Sales performance** > choose a CSV or Excel file > **Upload and prepare Sales dashboard**.
2. The app reads the file and fills in the setup automatically. The **"We set this up for you"** box lists every choice it made (currency, date format, discounts and so on). Change any of them under **Review saved business answers**.
3. Click **Create dashboard with available results**.

## 3. Connect Google Sheets

### One-time Google Cloud setup (in the Google account that owns the app)

1. Go to https://console.cloud.google.com and create a project (for example "Averidi Dashboard").
2. **APIs & Services > Library**: enable **Google Sheets API**.
3. **OAuth consent screen**: External, app name "Averidi", add the scope `https://www.googleapis.com/auth/spreadsheets.readonly`. Keep it in **Testing** and add the Google accounts that will test it under **Test users**.
4. **Credentials > Create credentials > OAuth client ID > Web application.** Under **Authorized redirect URIs** add the address printed by `npm run averidi:start`, for example:
   - Codespaces: `https://YOUR-CODESPACE-NAME-3000.app.github.dev/dashboard/app/api/connectors/callback`
   - Local: `https://localhost:3000/dashboard/app/api/connectors/callback`
5. Copy the **Client ID** and **Client Secret**.

### Turn it on in the app

```sh
npm run averidi:google-sheets      # paste the Client ID and Client Secret when asked
npm run averidi:start              # restart
```

The start message now says **"Google Sheets: enabled"** and shows the exact redirect URI to register.
(Codespaces secrets `DASHBOARD_CONNECTOR_GOOGLE_SHEETS_CLIENT_ID` and `DASHBOARD_CONNECTOR_GOOGLE_SHEETS_CLIENT_SECRET` also work.)

### Use it

1. In Studio, under the file picker, click **Connect a Google Sheet** (or go to More tools and settings > Data connections).
2. Paste the sheet link, give it a name, **Create connection**.
3. Click **Connect** and sign in with Google (read-only access).
4. Click **Refresh data** to import the rows.
5. Back in Studio: **Sales performance > Use previously uploaded data**, pick the sheet, **Prepare this data for Sales**.

## 4. Connect Shopify

### One-time Shopify setup (in the Averidi Shopify Partner account)

1. Go to https://dev.shopify.com/dashboard and sign in with the Partner account.
2. **Create a test store:** Stores > **Create store** (development store). Tick the option to add test data if offered, or add a few test orders.
3. **Create the app:** Apps > **Create app**, name it "Averidi".
4. In the app's **Versions** page, create a version with:
   - **App URL:** `https://averidi.com` (any page is fine for now)
   - **Embed app in Shopify admin:** off
   - **Scopes:** `read_orders`
   - **Redirect URLs:** the address printed by `npm run averidi:start`, for example `https://YOUR-CODESPACE-NAME-3000.app.github.dev/dashboard/app/api/connectors/callback`
   Then **Release** the version.
5. Open the app's **Settings** and copy the **Client ID** and **Client secret**.

### Turn it on in the app

```sh
npm run averidi:shopify      # paste the Client ID and Client secret when asked
npm run averidi:start        # restart
```

The start message now says **"Shopify: enabled"**.
(Codespaces secrets `DASHBOARD_CONNECTOR_SHOPIFY_CLIENT_ID` and `DASHBOARD_CONNECTOR_SHOPIFY_CLIENT_SECRET` also work.)

### Use it

1. More tools and settings > **Connections**, choose **Shopify**.
2. Enter the store address (for example `averidi-test` or `averidi-test.myshopify.com`), give it a name, **Create connection**.
3. Click **Connect**, approve the app in Shopify, then click **Refresh data** to import orders.
4. Back in Studio: **Sales performance > Use previously uploaded data**, pick the Shopify data, **Prepare this data for Sales**.

Note: Shopify only shares the last 60 days of orders unless the app is later approved for full order history.

## What changed in this delivery

- **Automatic setup:** no more upfront questions. Currency, date order and number format are detected from the data or the user's region, common sales settings are applied, and every choice is shown and can be edited.
- **Dashboard headline cards:** large values are shown compactly (for example $118.7M, full value on hover). Missing metrics say "Not in data" instead of breaking the card.
- **Google Sheets connection:** simplified screen (paste the link, the tab is optional), a link from Studio, and one-command setup.
- **One-command start** (`npm run averidi:start`) for Codespaces and local review, with verification links in the terminal when no email provider is set.

- **Shopify connection:** store owners enter their store address, approve the app and import orders.

Not included in this delivery: other connectors, linking to averidi.com accounts, going live on the averidi.com domain, AI analyst.
