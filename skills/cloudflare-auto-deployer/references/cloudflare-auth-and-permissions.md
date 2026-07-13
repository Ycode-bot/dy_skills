# Cloudflare Auth And Permissions

Primary sources:
- [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Pages direct upload with Wrangler](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

## Required environment variables

Prefer these names:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`CLOUDFLARE_API_TOKEN` is required for live deploys and token verification.

`CLOUDFLARE_ACCOUNT_ID` is strongly recommended for Cloudflare Pages direct-upload flows because Cloudflare's CI examples use it explicitly.

Project inspection, bootstrap planning, and plan-only deployment commands can run without credentials. Token verification and live deployment cannot.

## Credential setup tutorial

Present these steps in the user's language whenever a required credential is missing. Do not ask the user to paste the complete token into chat.

### 1. Create a least-privilege API token

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Open the user menu, select **My Profile**, then open **API Tokens**.
3. Select **Create Token**, then create a custom token when no suitable template is available.
4. For a Pages direct-upload deployment, add `Account` -> `Cloudflare Pages` -> `Edit`.
5. Restrict **Account Resources** to the account that owns the target Pages project.
6. For a Workers deployment, grant only the Workers permissions and account resources required by that Worker.
7. Create the token and store it immediately. Cloudflare shows the secret only once.

Do not reuse a broad global API key when a narrowly scoped API token is sufficient.

### 2. Find the Account ID

Open the target account in the Cloudflare dashboard. Copy the **Account ID** from the account overview, Workers & Pages overview, or the successful API-token creation dialog. Confirm that it belongs to the same account selected in the token's resource scope.

The Account ID is not secret, but it should still be kept in configuration rather than duplicated throughout project files.

### 3. Configure a local shell

For the current macOS or Linux shell session:

```bash
export CLOUDFLARE_API_TOKEN="your-api-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

For persistent Zsh configuration on macOS or Linux, add the exports to `~/.zshrc`, then reload it:

```bash
source ~/.zshrc
```

For the current Windows PowerShell session:

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-api-token"
$env:CLOUDFLARE_ACCOUNT_ID = "your-account-id"
```

Avoid commands that append secrets to shell files automatically when screen sharing or shell history exposure is a concern. Prefer opening the shell configuration file with a trusted local editor.

### 4. Verify without exposing secrets

Check only whether the variables are present. Do not print their values:

```bash
test -n "$CLOUDFLARE_API_TOKEN" && echo "API token is configured"
test -n "$CLOUDFLARE_ACCOUNT_ID" && echo "Account ID is configured"
```

Then verify the token through the helper:

```bash
node scripts/cloudflare-deploy.mjs verify-token
```

Token verification proves that the token is active. A later authorization error can still mean that its permissions or account-resource scope do not cover the requested Pages or Workers target.

### 5. Configure GitHub Actions

For repository automation, create these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Reference them through `${{ secrets.CLOUDFLARE_API_TOKEN }}` and `${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`. Never paste their values directly into workflow YAML.

### 6. Handle an exposed token

If a token appears in chat, screenshots, terminal logs, committed files, or other shared material, revoke it in Cloudflare, create a replacement, and update the local environment or GitHub Secret.

## Token creation guidance

Cloudflare's official token flow says:
- create a token from the dashboard
- choose a template or custom token
- scope permissions and resources narrowly
- copy the token secret immediately because it is only shown once

For Pages direct upload, Cloudflare's Pages CI guide uses:
- permission group: `Account`
- permission: `Cloudflare Pages`
- access level: `Edit`

For Workers deploys, prefer least privilege and scope the token only to the account and resources needed for that Worker.

## Verification

Cloudflare documents `GET /user/tokens/verify` for checking token status.

Example:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Successful verification returns an active token status plus a message that the token is valid and active.

## Safety rules

- Never commit the token into source control.
- Never paste the token into workflow YAML directly.
- Never ask the user to send the complete token in chat.
- Prefer GitHub Secrets or the local shell environment.
- Remind the user that the token secret is only shown once by Cloudflare.
