# Turning on SignPath signing

The release workflow already contains the signing steps; they are skipped until the settings below exist.

## 1. In SignPath (after the Foundation approves the project)

1. **Trusted build system:** add the predefined *GitHub.com* trusted build system to the organization and link it to the Tasklight project.
2. **Artifact configurations:** create two, with exactly these slugs:

   `app-exe` (signs the app itself):

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <pe-file product-name="Tasklight">
       <authenticode-sign />
     </pe-file>
   </artifact-configuration>
   ```

   `installer` (signs the per-user installer):

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <pe-file product-name="Tasklight">
       <authenticode-sign />
     </pe-file>
   </artifact-configuration>
   ```

   Both files are uploaded unzipped (`archive: false`), so the root element is `<pe-file>`, not `<zip-file>`. Their version info already says `ProductName = Tasklight`, which the restriction above enforces.
3. **Signing policy:** the release signing policy with manual approval; approver = you. Note its slug.
4. **CI user / API token:** a user with *submitter* permission on the project; create an API token for it.

## 2. In GitHub (repository → Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Variable | `SIGNPATH_ORGANIZATION_ID` | your SignPath organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | the project slug, e.g. `tasklight` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | the signing policy slug, e.g. `release-signing` |
| Secret | `SIGNPATH_API_TOKEN` | the CI user's API token |

Setting `SIGNPATH_ORGANIZATION_ID` is what switches signing on.

## 3. Releasing

Push a version tag as usual. The Windows job then pauses twice, once for `Tasklight.exe` and once for the installer; approve each request in SignPath (you have up to an hour each). The job then checks both signatures are valid, verifies the installed exe is byte-identical to the signed one, and publishes.

To turn signing off again, delete the `SIGNPATH_ORGANIZATION_ID` variable.
