# SECURITY

Every executing prompt that adds a permission, a rate limit, a secret, an upload, or a new trust boundary updates the matching section.

## 1. Permissions matrix

Format: one row per permission string, one column per role (`user`, `owner`, `moderator`, `admin`, `super_admin`) with `yes` or `no`, plus the endpoints that require it.

| Permission              | user | owner | moderator | admin | super_admin | Endpoints |
| ----------------------- | ---- | ----- | --------- | ----- | ----------- | --------- |
| (filled by prompt B1.2) |      |       |           |       |             |           |

## 2. Rate limits

Format: one row per limited endpoint group.

| Key                               | Endpoint(s) | Limit | Window | Scope (ip, user, ip+identifier) | Prompt |
| --------------------------------- | ----------- | ----- | ------ | ------------------------------- | ------ |
| (filled by prompt B0.3 and later) |             |       |        |                                 |        |

## 3. Secrets inventory

Format: where each secret lives and how to rotate it. Never write real values.

| Secret                            | Location (env or settings key) | Used by | Rotation procedure | Prompt |
| --------------------------------- | ------------------------------ | ------- | ------------------ | ------ |
| (filled by prompt B1.1 and later) |                                |         |                    |        |

## 4. Upload policy

Format: one row per upload kind: allowed types, max size, processing, storage path, who can upload, who can read.

## 5. Threat notes

Short notes of known risks and the mitigation implemented, one bullet each, with the prompt ID.
