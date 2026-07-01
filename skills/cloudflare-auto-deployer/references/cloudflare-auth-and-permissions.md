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
- Prefer GitHub Secrets or the local shell environment.
- Remind the user that the token secret is only shown once by Cloudflare.
