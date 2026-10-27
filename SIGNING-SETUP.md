# Signed releases

The release workflow signs `LyricsStatus.exe` before calculating its SHA-256 hash and publishing the GitHub release. The updater therefore verifies the exact signed file that users download.

## One-time Microsoft setup

Create an Azure Artifact Signing account and a code-signing certificate profile. Complete Microsoft's identity verification and assign the `Artifact Signing Certificate Profile Signer` role to the identity used by GitHub Actions.

The account and certificate profile must use the same regional endpoint. The endpoint is shown in the Azure portal under the Artifact Signing account.

## One-time GitHub setup

Create these repository secrets under Settings > Secrets and variables > Actions:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`
- `AZURE_ARTIFACT_SIGNING_PROFILE`

Create an Azure app registration for the workflow and add a federated credential for this GitHub repository. Give that app the `Artifact Signing Certificate Profile Signer` role on the certificate profile. The workflow uses GitHub's OIDC token, so no certificate private key is stored in the repository.

Create a release by pushing a tag such as `v3.0.30`. The workflow tests the app, builds the EXE, signs it, verifies the signature, calculates the hash, and publishes `LyricsStatus.exe` plus `latest.json`.
